// Static checks of the built extension: manifest references, import graph, no dev code, no remote code,
// permissions limited to what the extension needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build.js';
// Node-only constructs a browser module must not contain (comments ignored).
const usesNode = (src) => /from\s+['"]node:|require\(|\bprocess\.|\bBuffer\.|readFileSync/.test(src.replace(/(^|[\s;{}])\/\/(?!\/).*$/gm, '$1'));

const dir = build(fs.mkdtempSync(path.join(os.tmpdir(), 'd360-ext-')));
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(dir, p));
const manifest = JSON.parse(read('manifest.json'));

function jsFiles(d = dir) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsFiles(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
}

test('manifest is MV3 and every referenced file exists', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(exists(manifest.background.service_worker));
  assert.ok(exists(manifest.side_panel.default_path));
  for (const p of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) assert.ok(exists(p), p);
  const html = read(manifest.side_panel.default_path);
  // local files only (the footer's author link is checked separately)
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!/^https:/.test(ref)) assert.ok(exists(path.posix.join('panel', ref)), ref);
});

test('permissions are minimal: sidePanel + cookies, Salesforce hosts only', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['cookies', 'sidePanel']);
  for (const h of manifest.host_permissions) assert.match(h, /^https:\/\/\*\.(my\.salesforce\.com|lightning\.force\.com|my\.salesforce-setup\.com)\/\*$/);
  // nothing that lets web pages or other extensions reach into the extension, no loosened CSP
  for (const key of ['content_scripts', 'externally_connectable', 'web_accessible_resources', 'content_security_policy', 'optional_permissions', 'optional_host_permissions', 'key', 'update_url']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('no message listeners: nothing outside the panel can drive the extension', () => {
  for (const file of jsFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/onMessage(External)?\.addListener|onConnect(External)?\.addListener/.test(src), `listener in ${file}`);
  }
});

test('all relative imports resolve inside the package; no dev code shipped', () => {
  assert.ok(!exists('dev'));
  for (const file of jsFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!src.includes('platform-fake') && !src.includes('fake-org'), `dev reference in ${file}`);
    for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!spec) continue;
      assert.ok(spec.startsWith('.'), `non-relative import ${spec} in ${file}`);
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), spec)), `${spec} missing (from ${path.relative(dir, file)})`);
    }
  }
});

test('no remote code, eval or hard-coded remote endpoints', () => {
  for (const file of jsFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), `eval in ${file}`);
    // strip line comments only where `//` starts a comment (not the `//` inside "https://")
    const code = src.replace(/(^|[\s;{}])\/\/(?!\/).*$/gm, '$1');
    const hosts = [...code.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase());
    // allowed: Salesforce host patterns built at runtime and test fixtures' example domains
    const unexpected = hosts.filter((h) => !/(^|\.)example\.com$|^acme\./.test(h));
    assert.deepEqual(unexpected, [], `remote URL in ${file}`);
  }
  assert.ok(!/<script[^>]+src="https?:/.test(read('panel/panel.html')));
});

test('shipped code uses no Node APIs (it runs in the browser)', () => {
  for (const file of jsFiles()) assert.ok(!usesNode(fs.readFileSync(file, 'utf8')), `Node API in ${path.relative(dir, file)}`);
});

test('the package is exactly src/: no harness, tests or repo files', () => {
  const all = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).split(path.sep).join('/')]));
  assert.deepEqual(all(dir).sort(), all('src').sort());
  for (const f of all(dir)) assert.ok(!/(^|\/)(dev|test|scripts)\/|\.md$|^\.|package\.json/.test(f), f);
});

test('footer: author link opens a new tab without opener access; logo and version are local', () => {
  const html = read('panel/panel.html');
  const links = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>/g)];
  assert.deepEqual(links.map((m) => m[1]), ['https://szymonlewandowski.pl']);
  for (const [tag] of links) { assert.match(tag, /target="_blank"/); assert.match(tag, /rel="noopener noreferrer"/); }
  assert.ok(exists('icons/author.png'));
  assert.match(html, /<footer[\s\S]*id="version"[\s\S]*<\/footer>/);
  assert.ok(!/<header/.test(html), 'no in-panel header: the side panel title bar already names the extension');
  assert.match(html, /class="pill"[^>]*>BETA<\/span><span class="ver" id="version">/, 'BETA pill right before the version');
});

test('panel uses only the Chrome platform after build', () => {
  const panel = read('panel/panel.js');
  assert.match(panel, /import \{ platform \} from '\.\.\/lib\/platform-chrome\.js';/);
  assert.ok(!panel.includes('@platform-start'));
});

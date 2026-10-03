// Builds the extension from src/ (no dependencies, nothing is compiled):
//   dist/extension/                          Chrome: Load unpacked
//   dist/config-snapshot-for-d360-<version>.zip  release asset / Chrome Web Store upload
//   node scripts/build.js [outDir]   (default: dist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../src/core/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Copies src/ to `dir` and points the panel at the Chrome platform only (the harness lives in dev/). */
export function build(dir = path.join(root, 'dist', 'extension')) {
  fs.rmSync(dir, { recursive: true, force: true });
  copyDir(path.join(root, 'src'), dir);
  const panelFile = path.join(dir, 'panel', 'panel.js');
  const src = fs.readFileSync(panelFile, 'utf8');
  const replaced = src.replace(/\/\/ @platform-start[\s\S]*?\/\/ @platform-end/, "import { platform } from '../lib/platform-chrome.js';");
  if (replaced === src) throw new Error('platform markers not found in panel.js');
  fs.writeFileSync(panelFile, replaced);
  return dir;
}

export const zipName = (version) => `config-snapshot-for-d360-${version}.zip`;

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

export function zipDir(dir, zipPath) {
  const entries = listFiles(dir).sort().map((name) => ({ name, data: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
  fs.writeFileSync(zipPath, createZip(entries));
  return entries.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(root, process.argv[2] || 'dist');
  const dir = build(path.join(outDir, 'extension'));
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const zipPath = path.join(outDir, zipName(version));
  const n = zipDir(dir, zipPath);
  console.log(`Built ${path.relative(root, dir)} (${n} files)`);
  console.log(`Zip   ${path.relative(root, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB)`);
}

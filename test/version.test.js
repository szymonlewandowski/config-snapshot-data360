// One version everywhere: package.json, the manifest (and its beta label) and the changelog.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));

test('package.json and manifest carry the same version; version_name starts with it', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
  if (manifest.version_name) assert.ok(manifest.version_name.startsWith(manifest.version), manifest.version_name);
});

test('the changelog has an entry for the current version', () => {
  assert.match(fs.readFileSync('CHANGELOG.md', 'utf8'), new RegExp(`^## \\[${manifest.version.replace(/\./g, '\\.')}\\]`, 'm'));
});

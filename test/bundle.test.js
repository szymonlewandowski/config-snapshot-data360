import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createZip, createZipCompressed, crc32 } from '../src/core/zip.js';
import { bundleFiles, bundleName } from '../src/core/bundle.js';

// Minimal reader: walks the central directory and checks local headers + CRCs.
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(v.getUint32(off, true), 0x04034b50);
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const stored = bytes.subarray(start, start + size);
    const data = method === 8 ? new Uint8Array(zlib.inflateRawSync(stored)) : stored;
    assert.equal(data.length, usize, name);
    assert.equal(crc32(data), crc, name);
    files[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return files;
}

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round-trips UTF-8 names and content', () => {
  const files = readZip(createZip([{ name: 'a.json', data: '{"x":1}' }, { name: 'dir/zażółć.txt', data: 'gęślą jaźń' }, { name: 'empty.txt', data: '' }]));
  assert.deepEqual(files, { 'a.json': '{"x":1}', 'dir/zażółć.txt': 'gęślą jaźń', 'empty.txt': '' });
});

test('compressed zip round-trips and is much smaller for JSON', async () => {
  const big = JSON.stringify({ items: Array.from({ length: 2000 }, (_, i) => ({ name: `Field${i}__c`, type: 'STRING' })) });
  const zip = await createZipCompressed([{ name: 'big.json', data: big }, { name: 'tiny.txt', data: 'x' }, { name: 'ąę.txt', data: 'zażółć gęślą jaźń '.repeat(20) }]);
  const files = readZip(zip);
  assert.equal(files['big.json'], big);
  assert.equal(files['tiny.txt'], 'x');
  assert.ok(zip.length < big.length / 5, `${zip.length} vs ${big.length}`);
});

test('bundle layout: manifest, snapshot, raw only on request, README', () => {
  const collected = { manifest: { source: { orgId: '00DAA0000000001AAA', dataSpace: 'default' } }, snapshot: { model: { dmos: [] } }, raw: { model: { metadata: {} } } };
  const withRaw = bundleFiles(collected, { includeRaw: true }).map((f) => f.name);
  assert.deepEqual(withRaw, ['manifest.json', 'snapshot/model.json', 'raw/model.json', 'README.txt']);
  const noRaw = bundleFiles(collected).map((f) => f.name); // default: no raw
  assert.deepEqual(noRaw, ['manifest.json', 'snapshot/model.json', 'README.txt']);
  // My Domain name when the instance is known, org id otherwise
  assert.equal(bundleName(collected.manifest, new Date(2026, 9, 2, 9, 5)), 'd360-00DAA0000000001-default-20261002-0905.zip');
  assert.equal(bundleName(collected.manifest, new Date(2026, 9, 2, 9, 5), 'https://acme.my.salesforce.com'), 'd360-acme-default-20261002-0905.zip');
  // extra files go after the snapshot, README.txt stays last
  const withExtra = bundleFiles(collected, { extraFiles: [{ name: 'notes/extra.txt', data: 'x' }] });
  assert.deepEqual(withExtra.map((f) => f.name), ['manifest.json', 'snapshot/model.json', 'notes/extra.txt', 'README.txt']);
});

// Redaction of literal values for sharing exports (core/redact.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGet } from '../src/core/salesforce.js';
import { collect, normalize } from '../src/core/export.js';
import { bundleFiles } from '../src/core/bundle.js';
import { redactSnapshot } from '../src/core/redact.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from './fixtures/fake-org.js';

test('redaction removes literal values but keeps structure; raw is never bundled', async () => {
  const collected = await collect(makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch() }), { apiVersion: '67.0' });
  const n = normalize(collected);
  const files = bundleFiles({ ...n, raw: collected.raw }, { includeRaw: true, redact: true });
  const all = files.map((f) => f.data).join('\n');
  assert.ok(!files.some((f) => f.name.startsWith('raw/')));
  assert.ok(!all.includes('"Spring"'), 'static data value leaked');
  assert.ok(all.includes('PurchaseDate__c') && all.includes('in the last number of days'), 'structure lost');
  assert.match(files.find((f) => f.name === 'manifest.json').data, /"redacted": true/);
  const seg = JSON.parse(files.find((f) => f.name === 'snapshot/segments.json').data).segments.find((s) => s.name === 'Recent_Purchasers');
  assert.deepEqual(seg.criteria.children.map((c) => c.values), [['<redacted>'], ['<redacted>']]);
  // the in-memory snapshot is not modified
  assert.deepEqual(n.snapshot.segments.segments.find((s) => s.name === 'Recent_Purchasers').criteria.children[0].values, [30]);
});

test('SQL string literals are redacted, identifiers kept', () => {
  const s = redactSnapshot({ calculatedInsights: { calculatedInsights: [{ expression: "SELECT a FROM X__dlm WHERE X__dlm.Email__c = 'jan@x.pl' AND X__dlm.Name__c = 'O''Brien'", dimensions: [], measures: [] }] } });
  assert.equal(s.calculatedInsights.calculatedInsights[0].expression, "SELECT a FROM X__dlm WHERE X__dlm.Email__c = '<redacted>' AND X__dlm.Name__c = '<redacted>'");
});

test('unknown criteria nodes and data graph filters are redacted entirely', () => {
  const s = redactSnapshot({
    segments: { segments: [{ criteria: { kind: 'and', children: [{ kind: 'raw', type: 'New', raw: { secret: 'x' } }] } }] },
    dataGraphs: { dataGraphs: [{ nodes: [{ filter: "Email = 'a@b.c'" }, { filter: null }] }] },
  });
  assert.equal(s.segments.segments[0].criteria.children[0].raw, '<redacted>');
  assert.deepEqual(s.dataGraphs.dataGraphs[0].nodes.map((n) => n.filter), ['<redacted>', null]);
});

// Optional: an unzipped export with raw/ from a real org (never committed), e.g. REAL_EXPORT_DIR=../my-export npm test
const DIR = process.env.REAL_EXPORT_DIR || '';
test('real export: no filter value from the org survives redaction', { skip: DIR && fs.existsSync(path.join(DIR, 'manifest.json')) ? false : 'set REAL_EXPORT_DIR to an unzipped export with raw/' }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  const raw = {};
  for (const f of fs.readdirSync(path.join(DIR, 'raw'))) raw[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(DIR, 'raw', f), 'utf8'));
  const n = normalize({ manifest, raw });
  const all = bundleFiles({ ...n, raw }, { redact: true, includeRaw: true }).map((f) => f.data).join('\n');
  for (const v of ['SPRING20', 'Electronics', 'Last Order Upsell Qualified', '"Completed"', '"Shipped"']) assert.ok(!all.includes(v), v);
  assert.ok(all.includes('DiscountCode__c'));
});

// Regression tests for the security / robustness review: session handling, paging, escaping, file names, dev server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGet, pickApiVersion, explainError } from '../src/core/salesforce.js';
import { pageAll } from '../src/core/util.js';
import { decodeEntities, parseCriteria } from '../src/core/criteria.js';
import { collect, normalize } from '../src/core/export.js';
import { bundleName } from '../src/core/bundle.js';
import ingestion from '../src/core/modules/ingestion.js';
import activations from '../src/core/modules/activations.js';
import identityResolution from '../src/core/modules/identityResolution.js';
import { resolvePath } from '../dev/serve.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from './fixtures/fake-org.js';

const res = (status, text, extra = {}) => ({ ok: status >= 200 && status < 300, status, type: 'basic', headers: { get: () => null }, text: async () => text, ...extra });

// ---------- HTTP client ----------

test('a hung request times out, is retried, then reported as TIMEOUT', async () => {
  let attempts = 0;
  const hang = (url, init) => new Promise((_, reject) => { attempts++; init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const r = await makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl: hang, timeoutMs: 30, retries: 1, backoffMs: 1 })('/services/data/v67.0/limits');
  assert.equal(r.errorCode, 'TIMEOUT');
  assert.equal(attempts, 2);
  assert.match(explainError(r), /did not respond/);
});

test('user cancel during a request is an AbortError, not a timeout', async () => {
  const ac = new AbortController();
  const hang = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const p = makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl: hang, timeoutMs: 10_000, signal: ac.signal })('/x');
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, { name: 'AbortError' });
});

test('a 200 with an HTML page is an error, not empty data', async () => {
  const r = await makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl: async () => res(200, '<html>Maintenance</html>') })('/services/data/v67.0/ssot/segments');
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'NON_JSON_RESPONSE');
  const empty = await makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl: async () => res(204, '') })('/x');
  assert.equal(empty.ok, true); // an empty 2xx body is legitimate (e.g. 204)
});

test('URL tricks cannot send the token elsewhere', async () => {
  const seen = [];
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl: async (u) => { seen.push(new URL(u).host); return res(200, '{}'); } });
  await assert.rejects(get('@evil.example.com/x'), /Refusing/); // userinfo trick: https://acme...@evil
  await assert.rejects(get('https://acme.my.salesforce.com.evil.example.com/x'), /Refusing/);
  await get('//evil.example.com/x'); // becomes a path on the org host
  assert.deepEqual(seen, ['acme.my.salesforce.com']);
});

test('API version is pinned to the tested one', () => {
  assert.equal(pickApiVersion(['60.0', '66.0', '67.0', '68.0', '69.0']), '67.0');
  assert.equal(pickApiVersion(['62.0', '64.0']), '64.0');
  assert.equal(pickApiVersion(['55.0', '60.0']), null);
});

// ---------- paging ----------

const pager = (data, { clamp = Infinity, ignoreOffset = false, total = true } = {}) => async (offset) => {
  const start = ignoreOffset ? 0 : offset;
  return { batch: data.slice(start, start + Math.min(5, clamp)), totalSize: total ? data.length : undefined };
};
const items = (n) => Array.from({ length: n }, (_, i) => ({ name: `I${i}` }));

test('paging: all rows, also when the server returns fewer rows than asked', async () => {
  assert.equal((await pageAll(pager(items(12)), { pageSize: 5 })).items.length, 12);
  const clamped = await pageAll(pager(items(12), { clamp: 3 }), { pageSize: 5 });
  assert.equal(clamped.items.length, 12); // totalSize keeps the loop going after a short page
});

test('paging: ignored offset is detected instead of looping', async () => {
  const r = await pageAll(pager(items(12), { ignoreOffset: true, total: false }), { pageSize: 5 });
  assert.equal(r.items.length, 5);
  assert.equal(r.info.offsetIgnored, true);
  assert.equal(r.info.pages, 2);
});

test('paging: overlapping pages are de-duplicated, runaway loops are capped', async () => {
  const overlap = async (offset) => ({ batch: items(12).slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + 5) }); // 1-based-like offset
  const r = await pageAll(overlap, { pageSize: 5 });
  assert.equal(r.items.length, 12);
  assert.ok(r.info.duplicates > 0);
  const endless = async (offset) => ({ batch: [{ name: `X${offset}` }, { name: `Y${offset}` }] });
  const capped = await pageAll(endless, { pageSize: 2, maxPages: 7 });
  assert.equal(capped.info.truncated, true);
  assert.equal(capped.info.pages, 7);
});

test('nextPageUrl is followed (DLO 20-row cap, filtered short pages, 1-based stream offsets)', async () => {
  const { getAllOffset } = await import('../src/core/util.js');
  const fetchImpl = makeFakeFetch({ scale: 45 });
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  const dlo = await getAllOffset(get, '/services/data/v67.0/ssot/data-lake-objects');
  assert.equal(dlo.items.length, 47);
  assert.ok(dlo.info.pages >= 3);
  assert.equal(dlo.info.duplicates, 0);
  const streams = await getAllOffset(get, '/services/data/v67.0/ssot/data-streams');
  assert.equal(streams.items.length, 47);
  assert.equal(streams.info.duplicates, 0);
});

test('nextPageUrl to another host or a repeated link is not followed', async () => {
  const { getAllOffset } = await import('../src/core/util.js');
  const bodies = { first: { dataLakeObjects: [{ name: 'A' }], nextPageUrl: 'https://evil.example.com/steal' } };
  const get = async () => ({ ok: true, status: 200, body: bodies.first });
  const r = await getAllOffset(get, '/x');
  assert.equal(r.info.pages, 1); // foreign link ignored
  const loop = async (p) => ({ ok: true, status: 200, body: { dataLakeObjects: [{ name: p }], nextPageUrl: '/services/data/v67.0/same' } });
  const l = await getAllOffset(loop, '/x');
  assert.equal(l.info.offsetIgnored, true);
  assert.equal(l.info.pages, 2);
});

test('paging anomalies become module warnings', () => {
  const out = ingestion.normalize({ dataLakeObjects: [], dataStreams: [], streamDetails: {}, _paging: { dataStreams: { pages: 500, duplicates: 2, offsetIgnored: false, truncated: true } } });
  assert.deepEqual(out.warnings.map((w) => w.code).sort(), ['PAGING_DUPLICATES', 'PAGING_TRUNCATED']);
});

// ---------- data spaces ----------

test('endpoints without a dataspace parameter are filtered by data space', () => {
  const ds = (name) => [{ name, label: name }];
  const dlo = (name, space) => ({ name, label: name, fields: [], dataSpaceInfo: ds(space) });
  const stream = (name, dloName, space) => ({ name, dataLakeObjectInfo: { name: dloName, dataSpaceInfo: ds(space) } });
  const ing = ingestion.normalize({
    dataSpace: 'emea',
    dataLakeObjects: [dlo('A__dll', 'default'), dlo('B__dll', 'emea')],
    dataStreams: [stream('A', 'A__dll', 'default'), stream('B', 'B__dll', 'emea')],
    streamDetails: { B: { mappings: [] } },
  });
  assert.deepEqual(ing.dlos.map((d) => d.name), ['B__dll']);
  assert.deepEqual(ing.dataStreams.map((s) => s.name), ['B']);
  assert.deepEqual(ing.warnings, []);

  const act = activations.normalize({ dataSpace: 'emea', activations: [{ developerName: 'a1', dataSpaceName: 'default' }, { developerName: 'a2', dataSpaceName: 'emea' }], activationTargets: [] });
  assert.deepEqual(act.activations.map((a) => a.name), ['a2']);
  const ir = identityResolution.normalize({ dataSpace: 'emea', rulesets: [{ id: 'r1', dataSpaceName: 'default' }, { id: 'r2', dataSpaceName: 'emea' }, { id: 'r3' }] });
  assert.deepEqual(ir.rulesets.map((r) => r.name), ['r2', 'r3']);
});

test('identity resolution is requested without the unsupported dataspace parameter', async () => {
  const fetchImpl = makeFakeFetch();
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  await collect(get, { apiVersion: '67.0', dataSpace: 'emea', modules: ['identityResolution'] });
  const call = fetchImpl.calls.find((c) => c.includes('identity-resolutions'));
  assert.equal(call, '/services/data/v67.0/ssot/identity-resolutions');
});

// ---------- parallel collection ----------

test('modules run in parallel but never exceed the global request limit', async () => {
  const fetchImpl = makeFakeFetch({ latencyMs: 5 });
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  const parallel = await collect(get, { apiVersion: '67.0', concurrency: 2 });
  assert.ok(fetchImpl.maxInFlight <= 2, `max in flight ${fetchImpl.maxInFlight}`);
  const serialFetch = makeFakeFetch();
  const serial = await collect(makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: serialFetch }), { apiVersion: '67.0', concurrency: 1 });
  assert.equal(serialFetch.maxInFlight, 1);
  const strip = (s) => JSON.parse(JSON.stringify(normalize(s).snapshot));
  assert.deepEqual(strip(parallel), strip(serial));
  assert.deepEqual(Object.keys(parallel.manifest.modules), Object.keys(serial.manifest.modules));
});

test('a session that expires mid-export fails the remaining modules with a clear code', async () => {
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch({ expireAfter: 3 }) });
  const { manifest } = await collect(get, { apiVersion: '67.0', concurrency: 1 });
  const errors = Object.values(manifest.modules).map((m) => m.error).filter(Boolean);
  assert.ok(errors.length >= 5);
  assert.ok(errors.every((e) => /401 INVALID_SESSION_ID/.test(e)), errors[0]);
});

// ---------- parsing ----------

test('numeric HTML entities are decoded, without double decoding', () => {
  assert.equal(decodeEntities('&#34;a&#x22;&quot;'), '"a""');
  assert.equal(decodeEntities('&amp;quot;'), '&quot;');
  assert.equal(parseCriteria('{&#34;type&#34;:&#34;X&#34;}').type, 'X');
});

// ---------- output and dev server ----------

test('bundle file name stays safe whatever the org id contains', () => {
  assert.equal(bundleName({ source: { orgId: '../../00D/evil', dataSpace: 'a b/../c' } }, new Date(2026, 0, 2, 3, 4)), 'd360-00Devil-a_b____c-20260102-0304.zip');
  // My Domain names: sandbox, dev edition, long names cut to 30, non-Salesforce or broken URLs fall back to the org id
  const n = (url) => bundleName({ source: { orgId: '00DAA0000000001AAA', dataSpace: 'default' } }, new Date(2026, 0, 2, 3, 4), url);
  assert.equal(n('https://acme--uat.sandbox.my.salesforce.com'), 'd360-acme--uat-default-20260102-0304.zip');
  assert.equal(n('https://acme-dev-ed.develop.my.salesforce.com'), 'd360-acme-dev-ed-default-20260102-0304.zip');
  assert.equal(n('https://a-very-long-company-name-with-many-parts.my.salesforce.com'), 'd360-a-very-long-company-name-with-default-20260102-0304.zip');
  assert.equal(n('https://evil.example.com'), 'd360-00DAA0000000001-default-20260102-0304.zip');
  assert.equal(n('not a url'), 'd360-00DAA0000000001-default-20260102-0304.zip');
});

test('dev server serves the allowlist only', () => {
  for (const ok of ['/', '/src/panel/panel.js', '/src/core/export.js', '/src/core/modules/model.js', '/dev/platform-fake.js', '/test/fixtures/fake-org.js']) assert.ok(resolvePath(ok), ok);
  for (const bad of ['/.env', '/.ENV', '/.env.local', '/dist/extension/manifest.json', '/dev/serve.js', '/.git/config',
    '/../config-snapshot-data360-x/a.js', '/src/core/../../.env', '/%2e%2e/%2e%2e/secret', '/src/panel/..%2F..%2F.env', '/src/panel/%5c..%5c.env', '/package.json', '/%00']) {
    assert.equal(resolvePath(bad), null, bad);
  }
});

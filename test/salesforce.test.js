import test from 'node:test';
import assert from 'node:assert/strict';
import { myDomainFromUrl, makeGet, connect, explainError } from '../src/core/salesforce.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from './fixtures/fake-org.js';

test('Lightning, setup and sandbox URLs map to the My Domain API host', () => {
  const cases = {
    'https://acme.lightning.force.com/lightning/page/home': 'https://acme.my.salesforce.com',
    'https://acme--uat.sandbox.lightning.force.com/one/one.app': 'https://acme--uat.sandbox.my.salesforce.com',
    'https://acme-dev-ed.develop.lightning.force.com/': 'https://acme-dev-ed.develop.my.salesforce.com',
    'https://acme.my.salesforce-setup.com/lightning/setup/SetupOneHome/home': 'https://acme.my.salesforce.com',
    'https://acme.my.salesforce.com/services/data/': 'https://acme.my.salesforce.com',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(myDomainFromUrl(from), to, from);
});

test('non-Salesforce and malformed URLs are rejected', () => {
  for (const u of ['https://example.com', 'https://lightning.force.com/', 'https://evil.com/?x=.lightning.force.com', 'chrome://extensions', 'not a url']) {
    assert.equal(myDomainFromUrl(u), null, u);
  }
});

test('get sends the bearer token, never to another origin', async () => {
  const fetchImpl = makeFakeFetch();
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  const res = await get('/services/data/v67.0/limits');
  assert.equal(res.ok, true);
  await assert.rejects(get('https://evil.example.com/steal'), /Refusing/);
});

test('redirects are reported, not followed', async () => {
  const fetchImpl = async () => ({ ok: false, status: 0, type: 'opaqueredirect', headers: { get: () => null }, text: async () => '' });
  const res = await makeGet({ instanceUrl: FAKE_INSTANCE, token: 't', fetchImpl })('/services/data/');
  assert.equal(res.errorCode, 'REDIRECT');
});

test('429/503 are retried with backoff, then succeed', async () => {
  let n = 0;
  const base = makeFakeFetch();
  const fetchImpl = async (u, i) => (++n <= 2 ? { ok: false, status: n === 1 ? 429 : 503, type: 'basic', headers: { get: () => null }, text: async () => '' } : base(u, i));
  const res = await makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl, backoffMs: 1 })('/services/data/v67.0/limits');
  assert.equal(res.ok, true);
  assert.equal(n, 3);
});

test('abort stops requests with AbortError', async () => {
  const ac = new AbortController();
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch({ latencyMs: 50 }), signal: ac.signal });
  ac.abort();
  await assert.rejects(get('/services/data/v67.0/limits'), { name: 'AbortError' });
});

test('connect reads version, org, limits and data spaces', async () => {
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch() });
  const s = await connect(get);
  assert.equal(s.apiVersion, '67.0');
  assert.equal(s.orgId, '00DAA0000000001AAA');
  assert.deepEqual(s.dataSpaces, ['default', 'emea']);
  assert.equal(s.dailyApi.Remaining, 14900);
});

test('connect explains an expired session', async () => {
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: 'wrong', fetchImpl: makeFakeFetch() });
  await assert.rejects(connect(get), /Session expired/);
  assert.match(explainError({ errorCode: 'API_DISABLED_FOR_ORG' }), /API Enabled/);
});

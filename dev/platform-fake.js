// Dev harness platform: the panel UI against the synthetic org (test/fixtures/fake-org.js).
// Not shipped (dev/ is outside src/, which is what scripts/build.js packages). Query params:
//   ?tab=<url>        active tab URL (default Lightning URL of the fake org; "none" = no Salesforce tab)
//   ?nosid=1          no session cookie
//   ?fail=<module>    make that module's endpoint return 500
//   ?expired=1        token rejected (401)
//   ?latency=<ms>     per-request delay (default 120)
//   ?scale=<n>        n extra DMOs/DLOs/streams/mappings (load test of the UI)
//   ?expireAfter=<n>  session expires after n authenticated requests (connect + estimate use 4)
import { makeFakeFetch, FAKE_TOKEN } from '../test/fixtures/fake-org.js';

const q = new URLSearchParams(location.search);
const FAIL_PATHS = {
  segments: '/ssot/segments', activations: '/ssot/activations', mappings: '/ssot/data-model-object-mappings',
  ingestion: '/ssot/data-streams', dataGraphs: '/ssot/data-graphs/metadata', model: '/ssot/metadata',
};
const failPath = FAIL_PATHS[q.get('fail')];
const fakeFetch = makeFakeFetch({
  latencyMs: Number(q.get('latency') ?? 120),
  scale: Number(q.get('scale') ?? 0),
  expireAfter: q.has('expireAfter') ? Number(q.get('expireAfter')) : Infinity,
  fail: (u) => (failPath && u.pathname.endsWith(failPath) ? { status: 500, body: [{ errorCode: 'UNKNOWN_EXCEPTION', message: 'Injected failure' }] } : null),
});

export const downloads = [];
window.__downloads = downloads;

export const platform = {
  name: 'fake',
  fetch: fakeFetch,
  async activeTabUrl() {
    const t = q.get('tab');
    return t === 'none' ? 'https://www.example.com/' : t || 'https://acme.lightning.force.com/lightning/page/home';
  },
  async sessionId() {
    if (q.get('nosid')) return null;
    return q.get('expired') ? 'expired-token' : FAKE_TOKEN;
  },
  onTabChange() {},
  download(filename, bytes) {
    downloads.push({ filename, size: bytes.length, bytes }); // bytes: inspect the zip in harness checks
    console.log(`[fake download] ${filename} (${bytes.length} bytes)`);
  },
  version: () => 'dev',
};

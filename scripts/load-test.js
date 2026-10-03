// Load test on the synthetic org: how the export core behaves at "100x" scale.
//   node scripts/load-test.js [extraDmos=2500] [latencyMs=0]
import { makeGet } from '../src/core/salesforce.js';
import { collect, normalize } from '../src/core/export.js';
import { bundleZip } from '../src/core/bundle.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from '../test/fixtures/fake-org.js';

const n = Number(process.argv[2] || 2500);
const latencyMs = Number(process.argv[3] || 0);
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
let requests = 0;
const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch({ scale: n, latencyMs }), onRequest: () => { requests++; } });

const t0 = Date.now();
const collected = await collect(get, { apiVersion: '67.0', concurrency: 6 });
const t1 = Date.now();
const normalized = normalize(collected);
const t2 = Date.now();
const zip = await bundleZip({ ...normalized, raw: collected.raw }, { includeRaw: true });
const t3 = Date.now();

const c = normalized.manifest.counts;
console.log(`extra DMOs: ${n}, latency ${latencyMs} ms, requests: ${requests}`);
console.log(`collect ${t1 - t0} ms | normalize ${t2 - t1} ms | zip ${t3 - t2} ms`);
console.log(`dmos ${c.model.dmos}, streams ${c.ingestion.dataStreams}, mappings ${c.mappings.mappings}, link warnings ${normalized.manifest.linkWarnings.length}`);
console.log(`zip ${mb(zip.length)} | heap used ${mb(process.memoryUsage().heapUsed)} | rss ${mb(process.memoryUsage().rss)}`);

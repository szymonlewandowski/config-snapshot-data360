// End-to-end over the synthetic org: session -> estimate -> collect -> normalize -> link -> zip.
// Runs without a real org or saved exports (safe for CI / a public repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGet, connect } from '../src/core/salesforce.js';
import { collect, normalize, MODULES } from '../src/core/export.js';
import { inventory, estimate, totalCalls } from '../src/core/estimate.js';
import { bundleZip } from '../src/core/bundle.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from './fixtures/fake-org.js';

async function exportAll(opts = {}) {
  const fetchImpl = makeFakeFetch(opts.fake);
  let requests = 0;
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl, backoffMs: 1, onRequest: () => requests++ });
  const session = await connect(get);
  const collected = await collect(get, { apiVersion: session.apiVersion, modules: opts.modules });
  return { session, collected, normalized: normalize(collected), requests, fetchImpl };
}

test('all modules export the synthetic org without warnings', async () => {
  const { normalized } = await exportAll();
  const { snapshot, manifest } = normalized;
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(MODULES).sort());
  assert.deepEqual(manifest.linkWarnings, []);
  for (const [name, part] of Object.entries(snapshot)) {
    const expected = name === 'segments' ? ['SEGMENT_NO_CRITERIA'] : [];
    assert.deepEqual(part.warnings.map((w) => w.code), expected, name);
  }
  for (const m of Object.values(manifest.modules)) assert.equal(m.error, undefined);
});

test('exclusions, quirks and cross-module links hold on the synthetic org', async () => {
  const { snapshot } = (await exportAll()).normalized;
  assert.deepEqual(snapshot.model.dmos.map((d) => d.name), ['Purchase__dlm', 'UnifiedIndividual__dlm', 'ssot__ContactPointEmail__dlm', 'ssot__Individual__dlm']);
  const contact = snapshot.ingestion.dataStreams.find((s) => s.name === 'Contact_Home');
  assert.ok(contact.fieldMappings.every((m) => m.dloField.endsWith('__c'))); // S2: suffix restored
  const ind = snapshot.mappings.mappings.find((m) => m.dmo === 'ssot__Individual__dlm');
  assert.equal(ind.fieldMappings.filter((f) => f.system).length, 2);
  assert.equal(snapshot.activations.activations[0].segment, 'High_Value_Buyers');
  assert.equal(snapshot.dataGraphs.dataGraphs[0].label, 'Customer Profile');
});

test('mappings are not requested for excluded DMOs', async () => {
  const { fetchImpl } = await exportAll({ modules: ['model', 'mappings'] });
  const asked = fetchImpl.calls.filter((c) => c.includes('data-model-object-mappings')).map((c) => new URL(c, FAKE_INSTANCE).searchParams.get('dmoDeveloperName'));
  assert.deepEqual(asked.sort(), ['Purchase__dlm', 'UnifiedIndividual__dlm', 'ssot__ContactPointEmail__dlm', 'ssot__Individual__dlm']);
});

test('estimate matches the real request count for exact modules', async () => {
  const fetchImpl = makeFakeFetch();
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  const inv = await inventory(get, { apiVersion: '67.0' });
  assert.deepEqual(inv, { dmos: 8, dmosInScope: 4, dlos: 2, calculatedInsights: 1 });
  const est = estimate(inv);
  const { manifest } = await collect(get, { apiVersion: '67.0', modules: ['model', 'mappings', 'calculatedInsights', 'identityResolution'] });
  // mappings estimate includes its own metadata call; in a combined run it reuses model's
  assert.equal(manifest.modules.mappings.calls, est.mappings.calls - 1);
  assert.equal(manifest.modules.calculatedInsights.calls, est.calculatedInsights.calls);
  assert.equal(totalCalls(est, ['model', 'identityResolution']).calls, 2);
  assert.equal(totalCalls(est, ['model', 'mappings']).calls, manifest.modules.model.calls + manifest.modules.mappings.calls);
});

test('a failing module is reported and the others still export', async () => {
  const { normalized } = await exportAll({ fake: { fail: (u) => (u.pathname.endsWith('/ssot/segments') ? { status: 500, body: [{ errorCode: 'UNKNOWN_EXCEPTION' }] } : null) } });
  assert.match(normalized.manifest.modules.segments.error, /500/);
  assert.equal(normalized.snapshot.segments, undefined);
  assert.ok(normalized.snapshot.activations.activations.length > 0);
});

test('cancel aborts the whole export', async () => {
  const ac = new AbortController();
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl: makeFakeFetch({ latencyMs: 20 }), signal: ac.signal });
  const run = collect(get, { apiVersion: '67.0', onModule: (name, phase) => { if (name === 'ingestion' && phase === 'start') ac.abort(); } });
  await assert.rejects(run, { name: 'AbortError' });
});

test('the export zips', async () => {
  const { collected, normalized } = await exportAll();
  const zip = await bundleZip({ ...normalized, raw: collected.raw });
  assert.ok(zip.length > 1000);
});

// Larger synthetic org (separate file: scaling mutates the fake org for this process only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGet } from '../src/core/salesforce.js';
import { collect, normalize } from '../src/core/export.js';
import { bundleZip } from '../src/core/bundle.js';
import { makeFakeFetch, FAKE_INSTANCE, FAKE_TOKEN } from './fixtures/fake-org.js';

test('300 extra DMOs: paging over 200, all mappings, no warnings', async () => {
  const fetchImpl = makeFakeFetch({ scale: 300 });
  const get = makeGet({ instanceUrl: FAKE_INSTANCE, token: FAKE_TOKEN, fetchImpl });
  const collected = await collect(get, { apiVersion: '67.0', modules: ['model', 'ingestion', 'mappings'], concurrency: 6 });
  const { snapshot, manifest } = normalize(collected);
  assert.equal(snapshot.model.dmos.length, 304);
  assert.equal(snapshot.ingestion.dlos.length, 302); // 20-row DLO pages + hidden row: only nextPageUrl gets all
  assert.deepEqual(snapshot.ingestion.warnings, []); // no duplicates despite 1-based stream offsets
  assert.equal(snapshot.ingestion.dataStreams.length, 302);
  assert.equal(snapshot.mappings.mappings.length, 303);
  assert.deepEqual(manifest.linkWarnings, []);
  assert.deepEqual(snapshot.ingestion.warnings, []);
  const zip = await bundleZip({ manifest, snapshot, raw: collected.raw }, { includeRaw: true });
  assert.ok(zip.length > 50_000 && zip.length < 2_000_000, `zip ${zip.length}`); // compressed
});

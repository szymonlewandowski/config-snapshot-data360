// Export orchestration (pure JS: runs in the extension and in the tests).
// get(path) is injected and must return { ok, status, body, errorCode? } (GET only).

import model from './modules/model.js';
import ingestion from './modules/ingestion.js';
import mappings from './modules/mappings.js';
import segments from './modules/segments.js';
import activations from './modules/activations.js';
import calculatedInsights from './modules/calculatedInsights.js';
import identityResolution from './modules/identityResolution.js';
import dataGraphs from './modules/dataGraphs.js';
import { link } from './link.js';

export const SCHEMA_VERSION = '0.5';

// Caps requests in flight across all modules (modules run in parallel after model).
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
export const BUNDLE_VERSION = 1;
export const MODULES = { model, ingestion, mappings, segments, activations, calculatedInsights, identityResolution, dataGraphs };

/**
 * Collect raw responses for the selected modules.
 * @returns {Promise<{ manifest: object, raw: Record<string, object> }>}
 */
export async function collect(get, { apiVersion, dataSpace = 'default', modules = Object.keys(MODULES), concurrency = 4, onProgress = () => {}, onModule = () => {} }) {
  const ctx = {
    base: `/services/data/v${apiVersion}`,
    ds: dataSpace === 'default' ? undefined : dataSpace,
    concurrency,
    onProgress,
    raw: {},
  };
  const manifest = {
    bundle: 'data360-export',
    bundleVersion: BUNDLE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: { orgId: null, apiVersion, dataSpace },
    modules: {},
  };

  for (const name of modules) if (!MODULES[name]) throw new Error(`Unknown module: ${name}`);
  const limit = limiter(Math.max(1, concurrency));
  const limitedGet = (p) => limit(() => get(p));

  const ui = await limitedGet('/services/oauth2/userinfo');
  manifest.source.orgId = ui.ok ? ui.body?.organization_id ?? null : null;

  const entries = {};
  const run = async (name) => {
    let calls = 0;
    const counted = (p) => { calls++; return limitedGet(p); };
    const started = Date.now();
    const entry = { fetchedAt: new Date().toISOString() };
    onModule(name, 'start', entry);
    try {
      ctx.raw[name] = await MODULES[name].collect(counted, ctx);
    } catch (e) {
      if (e.name === 'AbortError') throw e; // user cancelled: stop the whole export
      entry.error = e.message;
    }
    entry.calls = calls;
    entry.durationMs = Date.now() - started;
    entries[name] = entry;
    onModule(name, entry.error ? 'error' : 'done', entry);
  };

  // model first: other modules reuse its metadata response; the rest are independent and run in parallel
  const selected = [...new Set(modules)];
  if (selected.includes('model')) await run('model');
  await Promise.all(selected.filter((m) => m !== 'model').map(run));
  // deterministic order regardless of completion order
  manifest.modules = Object.fromEntries(Object.keys(MODULES).filter((m) => entries[m]).map((m) => [m, entries[m]]));
  return { manifest, raw: ctx.raw };
}

/**
 * Normalize collected raw modules into snapshot parts + cross-module warnings.
 * Works offline: input is the output of collect() (or files saved from it).
 */
export function normalize({ manifest, raw }) {
  const snapshot = {};
  for (const name of Object.keys(MODULES)) { // fixed order, independent of collection order
    const data = raw[name];
    if (!data) continue;
    snapshot[name] = { module: name, schemaVersion: SCHEMA_VERSION, ...MODULES[name].normalize(data) };
  }
  const linkWarnings = link(snapshot);
  const counts = Object.fromEntries(Object.entries(snapshot).map(([name, part]) => [
    name,
    Object.fromEntries(Object.entries(part).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
  ]));
  return {
    manifest: { ...manifest, schemaVersion: SCHEMA_VERSION, counts, linkWarnings },
    snapshot,
  };
}

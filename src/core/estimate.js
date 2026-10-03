// Request estimate per module, from one cheap inventory call (/ssot/metadata-entities, api-quirks O4).
// Counts that the inventory cannot know (streams, activations, graphs) are approximated and flagged.
import { isExcludedDmo, qs } from './util.js';

export async function inventory(get, { apiVersion, dataSpace = 'default' }) {
  const ds = dataSpace === 'default' ? undefined : dataSpace;
  const res = await get(`/services/data/v${apiVersion}/ssot/metadata-entities${qs({ dataspace: ds })}`);
  if (!res.ok) return null;
  const items = res.body?.metadata || [];
  // metadata-entities uses "<Category>_Category" names for some system categories (api-quirks M2)
  const norm = (c) => String(c ?? '').replace(/_Category$/, '');
  const dmos = items.filter((e) => e.type === 'DataModelObject').map((e) => ({ name: e.name, category: norm(e.category) }));
  return {
    dmos: dmos.length,
    dmosInScope: dmos.filter((e) => !isExcludedDmo(e)).length,
    dlos: items.filter((e) => e.type === 'DataLakeObject').length,
    calculatedInsights: items.filter((e) => e.type === 'CalculatedInsight').length,
  };
}

// Returns { [module]: { calls, exact, note } }.
export function estimate(inv) {
  const n = (v) => (Number.isFinite(v) ? v : null);
  const dmos = n(inv?.dmosInScope);
  const dlos = n(inv?.dlos);
  return {
    model: { calls: 1, exact: true, note: '1 metadata call' },
    // ~1 stream per DLO; list calls page by 200
    ingestion: { calls: dlos === null ? null : 2 + dlos, exact: false, note: '2 + 1 per data stream (≈ DLO count)' },
    mappings: { calls: dmos === null ? null : 1 + dmos, exact: dmos !== null, note: '1 per DMO in scope' },
    segments: { calls: 1, exact: false, note: '1 per 100 segments' },
    activations: { calls: 2, exact: false, note: '2 + 1 per activation' },
    calculatedInsights: { calls: 4, exact: true, note: '3 definition types + metadata' },
    identityResolution: { calls: 1, exact: true, note: '1 call' },
    dataGraphs: { calls: 1, exact: false, note: '1 + 1 per data graph' },
  };
}

export function totalCalls(est, modules) {
  let sum = 0;
  let exact = true;
  for (const m of modules) {
    const e = est[m];
    if (!e || e.calls === null) { exact = false; continue; }
    sum += e.calls;
    if (!e.exact) exact = false;
  }
  // mappings reuses the model module's metadata response when both run together
  if (modules.includes('model') && modules.includes('mappings') && est.mappings?.calls) sum -= 1;
  return { calls: sum, exact };
}

// mappings: DLO -> DMO field mappings (1 call per DMO; 404 = DMO has no mappings).
import { sorted, cmp, isSystemField, qs, pool, dmoMetadata, isExcludedDmo } from '../util.js';

export default {
  name: 'mappings',
  async collect(get, ctx) {
    const meta = await dmoMetadata(get, ctx);
    const dmos = (meta?.metadata || []).filter((e) => !isExcludedDmo(e)).map((e) => e.name);
    const bodies = await pool(dmos, ctx.concurrency, async (dmo, i) => {
      ctx.onProgress(`mappings: ${i + 1}/${dmos.length}`);
      const res = await get(`${ctx.base}/ssot/data-model-object-mappings${qs({ dmoDeveloperName: dmo, dataspace: ctx.ds })}`);
      return res.ok ? res.body : res.status === 404 ? null : { _error: res.status };
    });
    return { dmoMappings: Object.fromEntries(dmos.map((d, i) => [d, bodies[i]])) };
  },
  normalize(raw) {
    const warnings = [];
    const byName = new Map();
    for (const [dmoName, body] of Object.entries(raw.dmoMappings || {})) {
      if (body?._error) { warnings.push({ code: 'MAPPING_FETCH_FAILED', ref: `dmoMappings[${dmoName}]` }); continue; }
      for (const m of body?.objectSourceTargetMaps || []) {
        if (byName.has(m.developerName)) continue;
        const fieldMappings = (m.fieldMappings || []).map((fm) => ({
          dloField: fm.sourceFieldDeveloperName,
          dmoField: fm.targetFieldDeveloperName,
          system: isSystemField(fm.sourceFieldDeveloperName) || isSystemField(fm.targetFieldDeveloperName),
        })).sort((a, b) => cmp(a.dmoField, b.dmoField));
        byName.set(m.developerName, { name: m.developerName, dlo: m.sourceEntityDeveloperName, dmo: m.targetEntityDeveloperName, status: m.status ?? null, fieldMappings });
      }
    }
    return { mappings: sorted([...byName.values()]), warnings };
  },
};

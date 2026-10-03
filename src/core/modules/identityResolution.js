// identityResolution: rulesets with match and reconciliation rules (list contains full detail, 1 call).
import { sorted, must, inDataSpace } from '../util.js';

export default {
  name: 'identityResolution',
  async collect(get, ctx) {
    ctx.onProgress('identityResolution');
    // The endpoint takes no parameters (spec): rulesets are filtered by dataSpaceName in normalize.
    const body = await must(get, `${ctx.base}/ssot/identity-resolutions`);
    return { dataSpace: ctx.ds ?? 'default', rulesets: body.identityResolutions || [] };
  },
  normalize(raw) {
    const ds = raw.dataSpace ?? 'default';
    const rulesets = sorted((raw.rulesets || []).filter((r) => inDataSpace(ds, r.dataSpaceName ? [r.dataSpaceName] : [])).map((r) => ({
      // No developer name in the API response: the record id is the stable key.
      name: r.id,
      label: r.label ?? r.id,
      description: r.description ?? null,
      object: r.objectApiName ?? null, // e.g. Individual
      configurationType: r.configurationType ?? null,
      status: r.rulesetStatus ?? null,
      runsAutomatically: Boolean(r.doesRunAutomatically),
      primaryDmo: r.secondaryDmo ?? null,
      matchRules: (r.matchRules || []).map((m) => ({
        label: m.label ?? null,
        criteria: (m.criteria || []).map((c) => ({
          dmo: c.entityName,
          field: c.fieldName,
          method: c.matchMethodType ?? null,
          caseSensitive: Boolean(c.caseSensitiveMatch),
          matchOnBlank: Boolean(c.shouldMatchOnBlank),
        })),
      })),
      reconciliationRules: (r.reconciliationRules || []).map((x) => ({
        dmo: x.entityName,
        unifiedDmo: x.unifiedDmoName ?? null,
        linkDmo: x.linkDmoName ?? null,
        ruleType: x.ruleType ?? null,
        ignoreEmpty: Boolean(x.shouldIgnoreEmptyValue),
        fields: x.fields || [],
        sources: x.sources || [],
      })),
      // Aggregate counts only, no profile data.
      stats: {
        sourceProfiles: r.sourceProfiles ?? null,
        matchedSourceProfiles: r.matchedSourceProfiles ?? null,
        totalUnifiedProfiles: r.totalUnifiedProfiles ?? null,
        consolidationRate: r.consolidationRate ?? null,
      },
      lastJob: { status: r.lastJobStatus ?? null, completed: r.lastJobCompleted ?? null },
    })));
    return { rulesets, warnings: [] };
  },
};

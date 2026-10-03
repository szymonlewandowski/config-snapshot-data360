// calculatedInsights: CI definitions (SQL, dimensions, measures) + field types from /ssot/metadata.
import { sorted, cmp, qs, must, pagingWarnings } from '../util.js';

// The list endpoint returns nothing without definitionType, so each type is queried.
const DEFINITION_TYPES = ['CALCULATED_METRIC', 'STREAMING_METRIC', 'EXTERNAL_METRIC'];

// Object.field references in SQL / formulas, e.g. Order__dlm.Amount__c
const REF = /\b([A-Za-z][A-Za-z0-9_]*__(?:dlm|cio|dll))\.([A-Za-z][A-Za-z0-9_]*)\b/g;
export function sqlRefs(...texts) {
  const m = new Map();
  for (const t of texts) for (const [, object, field] of String(t ?? '').matchAll(REF)) m.set(`${object}|${field}`, { object, field });
  return [...m.values()].sort((a, b) => cmp(`${a.object}|${a.field}`, `${b.object}|${b.field}`));
}

export default {
  name: 'calculatedInsights',
  async collect(get, ctx) {
    const insights = [];
    const paging = {};
    for (const type of DEFINITION_TYPES) {
      ctx.onProgress(`calculatedInsights: ${type}`);
      let pageToken;
      const info = { pages: 0, duplicates: 0, offsetIgnored: false, truncated: false };
      for (;;) {
        if (info.pages >= 100) { info.truncated = true; break; }
        const body = await must(get, `${ctx.base}/ssot/calculated-insights${qs({ offset: 0, batchSize: 100, definitionType: type, dataspace: ctx.ds, pageToken })}`);
        info.pages++;
        insights.push(...(body.collection?.items || []));
        const next = body.collection?.nextPageToken;
        if (!next || next === pageToken) break; // a repeated token would loop forever
        pageToken = next;
      }
      paging[`calculatedInsights:${type}`] = info;
    }
    ctx.onProgress('calculatedInsights: metadata');
    const metadata = await must(get, `${ctx.base}/ssot/metadata${qs({ entityType: 'CalculatedInsight', dataspace: ctx.ds })}`);
    return { insights, metadata, _paging: paging };
  },
  normalize(raw) {
    const warnings = pagingWarnings(raw._paging);
    const meta = new Map((raw.metadata?.metadata || []).map((e) => [e.name, e]));
    const seen = new Set();
    const calculatedInsights = sorted((raw.insights || []).filter((c) => !seen.has(c.apiName) && seen.add(c.apiName)).map((c) => {
      const m = meta.get(c.apiName);
      if (!m) warnings.push({ code: 'MISSING_CI_METADATA', ref: `calculatedInsights[${c.apiName}]` });
      const typeOf = (list, name) => (m?.[list] || []).find((f) => f.name === name)?.type ?? null;
      const field = (list) => (f) => ({
        name: f.apiName,
        label: f.displayName ?? f.apiName,
        dataType: f.dataType ?? null,
        type: typeOf(list, f.apiName),
        formula: f.formula ?? null,
      });
      const dimensions = sorted((c.dimensions || []).map(field('dimensions')));
      const measures = sorted((c.measures || []).map((f) => ({ ...field('measures')(f), aggregation: f.fieldAggregationType ?? null })));
      return {
        name: c.apiName,
        label: c.displayName ?? c.apiName,
        definitionType: c.definitionType ?? null,
        status: c.calculatedInsightStatus ?? null,
        creationType: c.creationType ?? null,
        description: c.description ?? null,
        expression: c.expression ?? null,
        dimensions,
        measures,
        schedule: c.publishScheduleInterval ?? null,
        lastRunStatus: c.lastRunStatus ?? null,
        lastRunDate: c.lastRunDateTime ?? null,
        sourceObjects: [...new Set((m?.relationships || []).map((r) => r.fromEntity))].sort(),
        fieldRefs: sqlRefs(c.expression, ...dimensions.map((d) => d.formula), ...measures.map((d) => d.formula)),
      };
    }));
    return { calculatedInsights, warnings };
  },
};

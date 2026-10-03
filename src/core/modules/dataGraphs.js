// dataGraphs: data graph trees (/ssot/data-graphs/metadata, 1 call) + detail per graph (labels, refresh).
import { sorted, qs, must, pool } from '../util.js';

const bool = (v) => v === true || v === 'true';

// Flatten the dgObject tree into nodes with a parent reference (easier to diagram and to check).
function flatten(node, parent, depth, out) {
  out.push({
    object: node.developerName,
    type: node.type ?? null, // Derived | Standard | Custom | Bridge | Calculated | SegmentMembership
    parent,
    depth,
    join: (node.paths || []).map((p) => ({ field: p.fieldName, parentField: p.parentFieldName, cardinality: p.cardinality })),
    fields: (node.fields || []).map((f) => ({
      name: f.developerName,
      dataType: f.dataType ?? null,
      key: bool(f.keyCol),
      lookup: bool(f.lookupCol),
    })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    filter: node.filterCriteria || null,
    recency: (Array.isArray(node.recencyCriteria) ? node.recencyCriteria : []).map((r) => ({
      field: r.fieldName, value: r.value, valueType: r.valueType, unit: r.valueUnit, // time: N DAY | record: N records
    })),
    fragmentDmo: node.memberDmoName ?? null,
  });
  for (const c of node.relatedObjects || []) flatten(c, node.developerName, depth + 1, out);
  return out;
}

export default {
  name: 'dataGraphs',
  async collect(get, ctx) {
    ctx.onProgress('dataGraphs: metadata');
    const meta = await must(get, `${ctx.base}/ssot/data-graphs/metadata${qs({ dataspace: ctx.ds })}`);
    const graphs = meta.dataGraphMetadata || [];
    const details = await pool(graphs, ctx.concurrency, async (g, i) => {
      ctx.onProgress(`dataGraphs: ${i + 1}/${graphs.length}`);
      const res = await get(`${ctx.base}/ssot/data-graphs/${encodeURIComponent(g.developerName)}`);
      return res.ok ? res.body : { _error: res.status };
    });
    return { graphs, details: Object.fromEntries(graphs.map((g, i) => [g.developerName, details[i]])) };
  },
  normalize(raw) {
    const warnings = [];
    const dataGraphs = sorted((raw.graphs || []).map((g) => {
      const d = raw.details?.[g.developerName];
      if (!d || d._error) warnings.push({ code: 'DATA_GRAPH_DETAIL_FAILED', ref: `dataGraphs[${g.developerName}]` });
      const nodes = g.dgObject ? flatten(g.dgObject, null, 0, []) : [];
      return {
        name: g.developerName,
        label: d?.label ?? g.developerName,
        description: g.description ?? null,
        // metadata and detail can report different statuses at the same time (api-quirks D3)
        status: d?.status ?? g.status ?? null,
        metadataStatus: g.status ?? null,
        primaryObject: g.primaryObjectName ?? null,
        primaryObjectType: g.primaryObjectType ?? null,
        refresh: {
          full: d?.fullRefreshConfig?.schedule ?? null, // { frequency, timeGranularity }
          incremental: d ? Boolean(d.incrementalRefreshConfig?.enabled) : null,
        },
        // system DMOs materialized for this graph; excluded from the model module (api-quirks D4)
        systemDmos: {
          ids: g.idDmoName ?? null,
          values: g.valuesDmoName ?? null,
          fragments: nodes.map((n) => n.fragmentDmo).filter(Boolean).sort(),
        },
        nodes,
      };
    }));
    return { dataGraphs, warnings };
  },
};

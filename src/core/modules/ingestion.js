// ingestion: data streams, DLOs and source -> DLO field mappings.
import { sorted, cmp, isSystemField, getAllOffset, qs, pool, pagingWarnings, inDataSpace } from '../util.js';

const SYSTEM_CONNECTORS = ['AIPlatform'];
const dsNames = (info) => (info || []).map((d) => d.name);
const streamInDataSpace = (ds) => (s) => inDataSpace(ds, dsNames(s.dataLakeObjectInfo?.dataSpaceInfo));

export default {
  name: 'ingestion',
  async collect(get, ctx) {
    // Neither endpoint takes a dataspace parameter: results are filtered by data space info (normalize).
    const dataSpace = ctx.ds ?? 'default';
    ctx.onProgress('ingestion: data lake objects');
    const dlo = await getAllOffset(get, `${ctx.base}/ssot/data-lake-objects`);
    ctx.onProgress('ingestion: data streams');
    const streams = await getAllOffset(get, `${ctx.base}/ssot/data-streams`);
    const inDs = streams.items.filter(streamInDataSpace(dataSpace)); // no detail calls for other data spaces
    const details = await pool(inDs, ctx.concurrency, async (s, i) => {
      ctx.onProgress(`ingestion: stream ${i + 1}/${inDs.length}`);
      const res = await get(`${ctx.base}/ssot/data-streams/${encodeURIComponent(s.name)}${qs({ includeMappings: true })}`);
      return res.ok ? res.body : { _error: res.status };
    });
    return {
      dataSpace,
      dataLakeObjects: dlo.items,
      dataStreams: streams.items,
      streamDetails: Object.fromEntries(inDs.map((s, i) => [s.name, details[i]])),
      _paging: { dataLakeObjects: dlo.info, dataStreams: streams.info },
    };
  },
  normalize(raw) {
    const warnings = pagingWarnings(raw._paging);
    const warn = (code, ref) => warnings.push({ code, ref });
    const ds = raw.dataSpace ?? 'default';

    const dlos = sorted((raw.dataLakeObjects || []).filter((d) => inDataSpace(ds, dsNames(d.dataSpaceInfo))).map((d) => {
      const fields = sorted((d.fields || []).map((f) => ({
        name: f.name,
        label: f.label ?? f.name,
        type: f.dataType,
        isPrimaryKey: Boolean(f.isPrimaryKey),
        system: isSystemField(f.name),
      })));
      return { name: d.name, label: d.label ?? d.name, category: d.category, primaryKey: fields.filter((f) => f.isPrimaryKey).map((f) => f.name), fields };
    }));
    const dloIndex = new Map(dlos.map((d) => [d.name, new Set(d.fields.map((f) => f.name))]));

    const dataStreams = sorted((raw.dataStreams || []).filter(streamInDataSpace(ds)).map((s) => {
      const detail = raw.streamDetails?.[s.name];
      const dlo = s.dataLakeObjectInfo?.name ?? null;
      if (dlo && !dloIndex.has(dlo)) warn('MISSING_DLO', `dataStreams[${s.name}].dlo`);
      if (!detail || detail._error) warn('MISSING_STREAM_DETAIL', `dataStreams[${s.name}]`);
      const dloFields = dloIndex.get(dlo);
      const fieldMappings = (detail?.mappings || []).map((m) => {
        // Stream mappings name DLO fields without the __c suffix used by the DLO endpoint.
        let dloField = m.targetFieldName;
        if (dloFields && !dloFields.has(dloField)) {
          if (dloFields.has(`${dloField}__c`)) dloField = `${dloField}__c`;
          else warn('MISSING_FIELD', `dataStreams[${s.name}].fieldMappings[${m.targetFieldName}]`);
        }
        return { sourceField: m.sourceFieldName, dloField };
      }).sort((a, b) => cmp(a.dloField, b.dloField));
      const type = s.connectorInfo?.connectorType ?? null;
      return {
        name: s.name,
        label: s.label ?? s.name,
        connector: { type, name: s.connectorInfo?.connectorDetails?.name ?? null, sourceObject: s.connectorInfo?.connectorDetails?.sourceObject ?? null },
        dlo,
        status: s.status ?? null,
        refreshMode: s.refreshConfig?.refreshMode ?? null,
        lastRunStatus: s.lastRunStatus ?? null,
        lastRefreshDate: s.lastRefreshDate ?? null,
        system: SYSTEM_CONNECTORS.includes(type),
        fieldMappings,
      };
    }));
    return { dataStreams, dlos, warnings };
  },
};

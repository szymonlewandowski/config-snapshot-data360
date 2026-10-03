// activations: activations (detail by id) and activation targets.
import { sorted, cmp, pool, getAllBatched, pagingWarnings, inDataSpace } from '../util.js';
import { decodeEntities } from '../criteria.js';

// Activation endpoints take no dataspace parameter: filter by dataSpaceName.
const sameSpace = (ds) => (x) => inDataSpace(ds, x.dataSpaceName ? [x.dataSpaceName] : []);

// queryPathConfig.configs[].queryPath = [{objectName, fieldName}, {objectName, fieldName}] -> join hops
const hops = (cfg) => (cfg?.configs || []).map(({ queryPath: [from, to] = [] }) => ({
  from: { object: from?.objectName, field: from?.fieldName },
  to: { object: to?.objectName, field: to?.fieldName },
}));

// contactPointPath: HTML-encoded JSON [[{objectApiName, fieldApiName}, {…}], …]
function contactPath(str) {
  try {
    return JSON.parse(decodeEntities(str || '[]')).map(([from, to]) => ({
      from: { object: from?.objectApiName, field: from?.fieldApiName },
      to: { object: to?.objectApiName, field: to?.fieldApiName },
    }));
  } catch { return []; }
}

const limitOf = (l) => (l ? { field: l.attributeName, max: l.maxNumberOfValues, order: l.order } : null);

// Activation filter conditions use {objectName, fieldName} subjects; same node kinds as segment criteria.
function condition(c, type) {
  if (!c) return null;
  if (c.subject?.fieldName) {
    const out = { kind: 'compare', type: String(type || '').replace(/Comparison$/, ''), object: c.subject.objectName, field: c.subject.fieldName, operator: c.operator };
    if (c.values) out.values = c.values;
    else if (c.value !== undefined && c.value !== null) out.values = [c.value];
    return out;
  }
  if (c.filters?.length) return { kind: String(c.operator || 'and').toLowerCase(), children: c.filters.map((f) => condition(f.condition ?? f, f.type)) };
  return { kind: 'raw', type: type ?? null, raw: c };
}

function entityFilter(f) {
  return {
    object: f.entityName,
    where: f.entityFilter ? condition(f.entityFilter.condition, f.entityFilter.type) : null,
    limit: limitOf(f.filterLimit),
    path: hops(f.queryPathConfigForActivateOnToContainer),
  };
}

function refs(a) {
  const m = new Map();
  const add = (object, field) => object && field && m.set(`${object}|${field}`, { object, field });
  const walk = (n) => {
    if (!n) return;
    if (n.kind === 'compare') add(n.object, n.field);
    (n.children || []).forEach(walk);
  };
  const addPath = (p) => p.forEach((h) => { add(h.from.object, h.from.field); add(h.to.object, h.to.field); });
  a.attributes.forEach((x) => { add(x.object, x.field); addPath(x.path); });
  a.contactPoints.forEach((c) => { c.fields.forEach((f) => add(c.object, f)); addPath(c.path); });
  [...a.filters.direct, ...a.filters.related].forEach((f) => { walk(f.where); addPath(f.path); if (f.limit) add(f.object, f.limit.field); });
  return [...m.values()].sort((x, y) => cmp(`${x.object}|${x.field}`, `${y.object}|${y.field}`));
}

export default {
  name: 'activations',
  async collect(get, ctx) {
    const dataSpace = ctx.ds ?? 'default';
    ctx.onProgress('activations: list');
    const listed = await getAllBatched(get, `${ctx.base}/ssot/activations`, 'activations');
    const list = listed.items.filter(sameSpace(dataSpace)); // no detail calls for other data spaces
    const details = await pool(list, ctx.concurrency, async (a, i) => {
      ctx.onProgress(`activations: ${i + 1}/${list.length}`);
      const res = await get(`${ctx.base}/ssot/activations/${encodeURIComponent(a.id)}`);
      return res.ok ? res.body : { _error: res.status, id: a.id, developerName: a.developerName };
    });
    ctx.onProgress('activations: targets');
    const targets = await getAllBatched(get, `${ctx.base}/ssot/activation-targets`, 'activationTargets');
    return { dataSpace, activations: details, activationTargets: targets.items, _paging: { activations: listed.info, activationTargets: targets.info } };
  },
  normalize(raw) {
    const warnings = pagingWarnings(raw._paging);
    const ds = raw.dataSpace ?? 'default';
    const activations = sorted((raw.activations || []).filter(sameSpace(ds)).filter((a) => {
      if (a._error) warnings.push({ code: 'ACTIVATION_FETCH_FAILED', ref: `activations[${a.developerName || a.id}]` });
      return !a._error;
    }).map((a) => {
      const out = {
        name: a.developerName,
        label: a.name ?? a.developerName,
        type: a.activationType ?? null, // SEGMENT | DMO | API_TRIGGERED
        status: a.status ?? null,
        subject: a.activationTargetSubjectConfig?.developerName ?? null,
        segment: a.segmentApiName ?? null,
        target: a.activationTargetName ?? null,
        targetPlatform: a.activationTarget?.platformType ?? null,
        refreshType: a.refreshType ?? null,
        processingType: a.processingType ?? null,
        lastPublishStatus: a.lastPublishStatus ?? null,
        lastPublishDate: a.lastPublishDate ?? null,
        audienceDmos: { history: a.historyAudienceDmoApiName ?? null, latest: a.latestAudienceDmoApiName ?? null },
        attributes: (a.attributesConfig?.attributes || []).map((x) => ({
          object: x.entityName, field: x.name, label: x.label ?? x.name, source: x.source ?? null, path: hops(x.queryPathConfig),
        })),
        contactPoints: (a.contactPointsConfig?.contactPoints || []).map((c) => ({
          object: c.contactPointEntityName,
          fields: (c.fieldConfig?.contactPointFields || []).map((f) => f.name),
          path: contactPath(c.contactPointPath),
        })),
        filters: {
          direct: (a.directDmoFiltersConfig?.filters || []).map(entityFilter),
          related: (a.relatedDmoFiltersConfig?.filters || []).map(entityFilter),
        },
        staticData: (a.staticDataConfig?.staticData || []).map((s) => ({ name: s.name, value: s.value })),
      };
      out.fieldRefs = refs(out);
      return out;
    }));

    const activationTargets = sorted((raw.activationTargets || []).filter(sameSpace(ds)).map((t) => ({
      name: t.name,
      id: t.id,
      platformName: t.platformName ?? null,
      platformType: t.platformType ?? null,
      status: t.status ?? null,
      audienceDmos: { history: t.historyAudienceDmoApiName ?? null, latest: t.latestAudienceDmoApiName ?? null },
    })));
    const targetNames = new Set(activationTargets.map((t) => t.name));
    for (const a of activations) if (a.target && !targetNames.has(a.target)) warnings.push({ code: 'MISSING_TARGET', ref: `activations[${a.name}].target` });
    return { activations, activationTargets, warnings };
  },
};

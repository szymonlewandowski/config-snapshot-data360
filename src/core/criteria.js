// Segment includeCriteria (HTML-entity encoded JSON) -> normalized criteria tree.
// Pure JS. Unknown node types are kept as { kind: 'raw' } so nothing is lost.

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
// Named and numeric (&#39; &#x27;) entities, decoded in a single pass (no double decoding of &amp;quot;).
export const decodeEntities = (s) => s.replace(/&(quot|amp|lt|gt|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e];
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

export function parseCriteria(str) {
  if (!str) return null;
  try { return JSON.parse(decodeEntities(str)); } catch { return { _unparsed: str.slice(0, 200) }; }
}

const ref = (s) => (s ? { object: s.objectApiName, field: s.fieldApiName } : null);
const pathOf = (p) => (p || []).map(([from, to]) => ({ from: ref(from), to: ref(to) }));

function compare(n) {
  const out = {
    kind: 'compare',
    type: n.type.replace(/Comparison$/, ''),
    object: n.subject?.objectApiName,
    field: n.subject?.fieldApiName,
    operator: n.operator,
  };
  if (n.values) out.values = n.values;
  else if (n.value !== undefined && n.value !== null) out.values = [n.value];
  if (n.parameterizedValues?.length) out.param = n.parameterizedValues[0];
  if (n.subjectFieldSourceType) out.source = n.subjectFieldSourceType;
  return out;
}

export function toNode(n) {
  if (!n || typeof n !== 'object') return null;
  if (n._unparsed) return { kind: 'raw', type: 'unparsed', raw: n._unparsed };
  const t = n.type;
  if (t === 'LogicalComparison') {
    return { kind: String(n.operator).toLowerCase(), children: (n.filters || []).map(toNode) };
  }
  if (/Aggregation$/.test(t || '')) {
    return {
      kind: 'aggregate',
      fn: n.aggregateFunction,
      over: n.containerObjectApiName,
      path: pathOf(n.joinPath || n.path),
      where: toNode(n.filter),
      compare: n.comparison ? toNode(n.comparison) : null,
    };
  }
  if (t === 'CalculatedInsight') {
    return {
      kind: 'calculatedInsight',
      object: n.subject?.objectApiName,
      path: pathOf(n.path),
      compare: n.comparison ? toNode(n.comparison) : null,
    };
  }
  if (t === 'Waterfall') {
    return { kind: 'waterfall', segments: (n.segments || []).map((s) => s.segmentId || s.subject?.segmentDevName) };
  }
  if (t === 'NestedSegment') {
    return { kind: 'segment', ref: n.segmentId || n.subject?.segmentDevName };
  }
  if (/Comparison$/.test(t || '') && n.subject?.objectApiName) return compare(n);
  return { kind: 'raw', type: t ?? null, raw: n };
}

// Walk the normalized tree collecting field / segment / calculated insight references.
export function collectRefs(node, acc = { fields: new Map(), segments: new Set(), unknown: new Set() }) {
  if (!node) return acc;
  const addField = (object, field) => object && field && acc.fields.set(`${object}|${field}`, { object, field });
  switch (node.kind) {
    case 'and': case 'or': node.children.forEach((c) => collectRefs(c, acc)); break;
    case 'compare': addField(node.object, node.field); break;
    case 'aggregate': case 'calculatedInsight':
      node.path.forEach((p) => { addField(p.from?.object, p.from?.field); addField(p.to?.object, p.to?.field); });
      collectRefs(node.where, acc);
      collectRefs(node.compare, acc);
      break;
    case 'segment': acc.segments.add(node.ref); break;
    case 'waterfall': node.segments.forEach((s) => acc.segments.add(s)); break;
    default: acc.unknown.add(node.type ?? 'unknown');
  }
  return acc;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function normalizeSegment(s) {
  const criteria = toNode(parseCriteria(s.includeCriteria));
  const refs = collectRefs(criteria);
  return {
    name: s.apiName,
    label: s.displayName ?? s.apiName,
    type: s.segmentType ?? null,
    segmentOn: s.segmentOnApiName ?? null,
    status: s.segmentStatus ?? null,
    parameters: (s.parameters || []).map((p) => ({ name: p.name, type: p.type, isCollection: Boolean(p.isCollection) })),
    criteriaAvailable: Boolean(criteria),
    criteria,
    fieldRefs: [...refs.fields.values()].sort((a, b) => cmp(`${a.object}|${a.field}`, `${b.object}|${b.field}`)),
    segmentRefs: [...refs.segments].sort(),
    unknownNodeTypes: [...refs.unknown].sort(),
  };
}

// Optional redaction for sharing an export outside the team: literal values that may contain business or
// personal data (filter values, static activation data, SQL string literals, data graph filters).
// Structure (objects, fields, operators, joins) is kept, so the documentation stays useful.
// Raw responses contain the originals, so bundles with redaction never include raw/.
export const REDACTED = '<redacted>';

function redactNode(node) {
  if (!node || typeof node !== 'object') return node;
  const out = { ...node };
  if (out.kind === 'compare' && Array.isArray(out.values)) out.values = out.values.map(() => REDACTED);
  if (out.kind === 'raw') out.raw = REDACTED; // unknown node: may carry values anywhere
  if (Array.isArray(out.children)) out.children = out.children.map(redactNode);
  if (Array.isArray(out.segments)) out.segments = [...out.segments]; // waterfall: names only
  for (const k of ['where', 'compare']) if (out[k]) out[k] = redactNode(out[k]);
  return out;
}

// SQL string literals: '...' with '' escapes.
const redactSql = (s) => (typeof s === 'string' ? s.replace(/'(?:[^']|'')*'/g, `'${REDACTED}'`) : s);

export function redactSnapshot(snapshot) {
  const s = structuredClone(snapshot);
  for (const seg of s.segments?.segments || []) seg.criteria = redactNode(seg.criteria);
  for (const a of s.activations?.activations || []) {
    a.staticData = (a.staticData || []).map((x) => ({ ...x, value: REDACTED }));
    for (const f of [...(a.filters?.direct || []), ...(a.filters?.related || [])]) f.where = redactNode(f.where);
  }
  for (const c of s.calculatedInsights?.calculatedInsights || []) {
    c.expression = redactSql(c.expression);
    for (const d of [...(c.dimensions || []), ...(c.measures || [])]) d.formula = redactSql(d.formula);
  }
  for (const g of s.dataGraphs?.dataGraphs || []) for (const n of g.nodes || []) if (n.filter) n.filter = REDACTED;
  return s;
}

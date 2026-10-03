// Shared helpers for modules. Pure JS: no Node or browser APIs.

export const PAGE = 200;

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const byName = (a, b) => cmp(a.name, b.name);
export const sorted = (arr) => [...arr].sort(byName);

export const EXCLUDED_DMO_CATEGORIES = ['Segment_Membership', 'Activation_Audience', 'Vector_Embedding'];

// System DMOs materialized by data graphs (docs/api-quirks.md D4). Their categories are Profile/Related,
// so they can only be recognized by name:
//   Dg_<4 chars>_<15-char node id>_FRAGMENT__dlm / _STATE__dlm   (one per graph node)
//   <GraphName>_<13-digit timestamp>_ID__dlm / _VALUE__dlm         (one pair per graph)
//   DataGraphStateTable__dlm                                        (one per org, created with the first graph)
export const DATA_GRAPH_DMO = [
  /^DataGraphStateTable__dlm$/,
  /^Dg_[A-Za-z0-9]{4}_[A-Za-z0-9]{15}_(FRAGMENT|STATE)__dlm$/,
  /^[A-Za-z0-9_]+_\d{13}_(ID|VALUE)__dlm$/,
];
export const isDataGraphDmo = (name) => DATA_GRAPH_DMO.some((re) => re.test(name));

// DMOs left out of the model module (and therefore out of mappings calls).
export const isExcludedDmo = (e) => EXCLUDED_DMO_CATEGORIES.includes(e.category) || isDataGraphDmo(e.name);
const SYSTEM_FIELDS = new Set(['DataSource__c', 'DataSourceObject__c', 'ssot__DataSourceId__c', 'ssot__DataSourceObjectId__c']);
export const isSystemField = (name) => /^(KQ_|cdp_sys_)/.test(name) || SYSTEM_FIELDS.has(name);

export function arrayOf(body) {
  if (!body || typeof body !== 'object') return [];
  const key = Object.keys(body).find((k) => Array.isArray(body[k]));
  return key ? body[key] : [];
}

export function qs(params) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return s ? `?${s}` : '';
}

export async function must(get, path) {
  const res = await get(path);
  if (!res.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${res.status} ${res.errorCode || ''}`);
  return res.body;
}

const itemKey = (i) => i?.name ?? i?.developerName ?? i?.apiName ?? i?.id ?? JSON.stringify(i);

/**
 * Generic offset paging. fetchPage(offset) -> { batch, totalSize? }.
 * Guards (api-quirks P1, P7): the next offset is the number of rows received (works even if the server
 * returns fewer rows than asked); a short page ends the loop unless totalSize says more rows exist;
 * duplicates across pages are dropped; a page that repeats the first one means the offset was ignored
 * (stop instead of looping); maxPages caps runaway loops and is reported as truncated.
 * @returns {Promise<{ items: any[], info: { pages: number, duplicates: number, offsetIgnored: boolean, truncated: boolean, totalSize: number|null } }>}
 */
export async function pageAll(fetchPage, { pageSize, maxPages = 500 }) {
  const items = [];
  const seen = new Set();
  const info = { pages: 0, duplicates: 0, offsetIgnored: false, truncated: false, totalSize: null };
  let offset = 0;
  let firstKey;
  for (;;) {
    if (info.pages >= maxPages) { info.truncated = true; break; }
    const { batch, totalSize } = await fetchPage(offset);
    info.pages++;
    if (Number.isFinite(totalSize)) info.totalSize = totalSize;
    if (!batch.length) break;
    if (info.pages === 1) firstKey = itemKey(batch[0]);
    else if (itemKey(batch[0]) === firstKey) { info.offsetIgnored = true; break; }
    for (const it of batch) {
      const k = itemKey(it);
      if (seen.has(k)) { info.duplicates++; continue; }
      seen.add(k);
      items.push(it);
    }
    offset += batch.length;
    const moreKnown = info.totalSize !== null && offset < info.totalSize;
    if (batch.length < pageSize && !moreKnown) break;
    if (info.totalSize !== null && offset >= info.totalSize) break;
  }
  return { items, info };
}

/**
 * limit/offset endpoints that return nextPageUrl (data-lake-objects, data-streams). The link is the only
 * reliable way through them (api-quirks P1, P7, verified live): DLOs cap `limit` at 20 and filter rows after
 * paging (short pages mid-list), data streams count `offset` from 1. Only relative /services/data/ links are
 * followed (the client also refuses other origins); a repeated link stops the loop.
 */
export async function getAllOffset(get, path, params = {}, maxPages = 500) {
  const items = [];
  const seen = new Set();
  const visited = new Set();
  const info = { pages: 0, duplicates: 0, offsetIgnored: false, truncated: false, totalSize: null };
  let url = path + qs({ ...params, limit: PAGE, offset: 0 });
  while (url) {
    if (info.pages >= maxPages) { info.truncated = true; break; }
    if (visited.has(url)) { info.offsetIgnored = true; break; }
    visited.add(url);
    const body = await must(get, url);
    info.pages++;
    if (Number.isFinite(body?.totalSize)) info.totalSize = body.totalSize;
    for (const it of arrayOf(body)) {
      const k = itemKey(it);
      if (seen.has(k)) { info.duplicates++; continue; }
      seen.add(k);
      items.push(it);
    }
    const next = body?.nextPageUrl;
    url = typeof next === 'string' && next.startsWith('/services/data/') ? next : null;
  }
  return { items, info };
}

// batchSize/offset paging (segments, activations, activation targets).
export async function getAllBatched(get, path, key, params = {}, batchSize = 100) {
  return pageAll(async (offset) => {
    const body = await must(get, path + qs({ ...params, batchSize, offset }));
    return { batch: body?.[key] || [], totalSize: body?.totalSize };
  }, { pageSize: batchSize });
}

// Warnings for paging anomalies recorded by collect (raw._paging).
export function pagingWarnings(paging = {}) {
  const w = [];
  for (const [list, i] of Object.entries(paging)) {
    if (i.truncated) w.push({ code: 'PAGING_TRUNCATED', ref: `${list} (stopped after ${i.pages} pages)` });
    if (i.offsetIgnored) w.push({ code: 'PAGING_REPEATED', ref: `${list} (the server returned a page or link already seen)` });
    if (i.duplicates) w.push({ code: 'PAGING_DUPLICATES', ref: `${list} (${i.duplicates} removed)` });
  }
  return w;
}

// Endpoints without a dataspace parameter return objects from every data space; keep the selected one.
// Items without data space information are kept.
export const inDataSpace = (ds, names) => !names?.length || names.includes(ds);

// Run fn over items with at most n in flight; result keeps input order.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

// DMO metadata: reuse the model module's raw response when it was collected in the same run.
export async function dmoMetadata(get, ctx) {
  return ctx.raw?.model?.metadata ?? must(get, `${ctx.base}/ssot/metadata${qs({ entityType: 'DataModelObject', dataspace: ctx.ds })}`);
}

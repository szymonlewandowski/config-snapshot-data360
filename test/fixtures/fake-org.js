// Synthetic Data 360 org ("Acme") answering every GET the export modules make, with response shapes copied
// from the real dev org (see docs/api-quirks.md). No real names or IDs: safe for a public repo.
// fakeFetch(url, init) behaves like fetch(); options inject latency or failures for UI and error tests.

const V = '67.0';
const enc = (o) => JSON.stringify(o).replace(/"/g, '&quot;'); // HTML-entity encoded JSON (api-quirks G1, T4)

const f = (name, label, type = 'STRING', businessType = 'TEXT') => ({ name, displayName: label, type, businessType });
const metadataDmo = [
  {
    name: 'ssot__Individual__dlm', displayName: 'Individual', category: 'Profile',
    primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Individual Id', indexOrder: '1' }],
    fields: [f('ssot__Id__c', 'Individual Id'), f('ssot__FirstName__c', 'First Name'), f('ssot__LastName__c', 'Last Name'),
      f('ssot__DataSourceId__c', 'Data Source'), f('KQ_Id__c', 'Key Qualifier Individual Id')],
    relationships: [{ fromEntity: 'ssot__ContactPointEmail__dlm', toEntity: 'ssot__Individual__dlm', fromEntityAttribute: 'ssot__PartyId__c', toEntityAttribute: 'ssot__Id__c', cardinality: 'NTOONE' }],
  },
  {
    name: 'ssot__ContactPointEmail__dlm', displayName: 'Contact Point Email', category: 'Profile',
    primaryKeys: [{ name: 'ssot__Id__c' }],
    fields: [f('ssot__Id__c', 'Contact Point Email Id'), f('ssot__EmailAddress__c', 'Email Address'), f('ssot__PartyId__c', 'Party')],
    relationships: [{ fromEntity: 'ssot__ContactPointEmail__dlm', toEntity: 'ssot__Individual__dlm', fromEntityAttribute: 'ssot__PartyId__c', toEntityAttribute: 'ssot__Id__c', cardinality: 'NTOONE' }],
  },
  {
    name: 'Purchase__dlm', displayName: 'Purchase', category: 'Engagement',
    primaryKeys: [{ name: 'PurchaseId__c' }],
    fields: [f('PurchaseId__c', 'Purchase Id'), f('IndividualId__c', 'Individual Id'), f('Amount__c', 'Amount', 'NUMBER', 'NUMBER'), f('PurchaseDate__c', 'Purchase Date', 'DATE_TIME', 'DATE_TIME')],
    relationships: [{ fromEntity: 'Purchase__dlm', toEntity: 'ssot__Individual__dlm', fromEntityAttribute: 'IndividualId__c', toEntityAttribute: 'ssot__Id__c', cardinality: 'NTOONE' }],
  },
  {
    name: 'UnifiedIndividual__dlm', displayName: 'Unified Individual', category: 'Profile',
    primaryKeys: [{ name: 'ssot__Id__c' }], fields: [f('ssot__Id__c', 'Unified Individual Id')], relationships: [],
  },
  // excluded: segment membership (category) and data graph system DMOs (name)
  { name: 'Individual_SM_1700000000000__dlm', displayName: 'SM', category: 'Segment_Membership', fields: [f('Id__c', 'Id')], relationships: [] },
  { name: 'Dg_AbCd_9pFAA0000000001_FRAGMENT__dlm', displayName: 'Fragment', category: 'Related', fields: [f('x__c', 'x')], relationships: [] },
  { name: 'Profile_1700000000001_ID__dlm', displayName: 'Graph ids', category: 'Related', fields: [f('x__c', 'x')], relationships: [] },
  { name: 'DataGraphStateTable__dlm', displayName: 'State', category: 'Profile', fields: [f('x__c', 'x')], relationships: [] },
];

const dlo = (name, label, category, fields) => ({
  name, label, category, id: `0gO${name.slice(0, 12)}`,
  fields: fields.map(([n, l, t = 'Text', pk = false]) => ({ name: n, label: l, dataType: t, isPrimaryKey: pk })),
  dataSpaceInfo: [{ name: 'default', label: 'default' }],
});
const dataLakeObjects = [
  dlo('Contact_Home__dll', 'Contact_Home', 'Profile', [['Id__c', 'Contact ID', 'Text', true], ['FirstName__c', 'First Name'], ['LastName__c', 'Last Name'], ['Email__c', 'Email'], ['DataSource__c', 'Data Source'], ['KQ_Id__c', 'KQ_Id']]),
  dlo('Purchases__dll', 'Purchases', 'Engagement', [['PurchaseId__c', 'PurchaseId', 'Text', true], ['ContactId__c', 'ContactId'], ['Amount__c', 'Amount', 'Number'], ['PurchaseDate__c', 'PurchaseDate', 'DateTime']]),
];

const stream = (name, connectorType, sourceObject, dloName, refreshMode) => ({
  name, label: name, recordId: `1ds${name}`, status: 'ACTIVE', lastRunStatus: 'SUCCESS', lastRefreshDate: '2026-01-01T00:00:00.000Z',
  connectorInfo: { connectorType, connectorDetails: { name: `${connectorType}_Home`, type: connectorType, ...(sourceObject ? { sourceObject } : {}) } },
  dataLakeObjectInfo: { name: dloName, label: dloName },
  refreshConfig: { refreshMode },
  mappings: [],
});
const dataStreams = [stream('Contact_Home', 'SalesforceDotCom', 'Contact', 'Contact_Home__dll', 'UPSERT'), stream('Purchases', 'UploadedFiles', null, 'Purchases__dll', 'TOTAL_REPLACE')];
// stream detail mappings omit the DLO __c suffix (api-quirks S2)
const streamMappings = {
  Contact_Home: [['Id', 'Id'], ['FirstName', 'FirstName'], ['LastName', 'LastName'], ['Email', 'Email']],
  Purchases: [['PurchaseId', 'PurchaseId'], ['ContactId', 'ContactId'], ['Amount', 'Amount'], ['PurchaseDate', 'PurchaseDate']],
};

const fm = (src, tgt) => ({ developerName: `${src}_fieldmap_${tgt}`, sourceFieldDeveloperName: src, targetFieldDeveloperName: tgt });
const dmoMappings = {
  ssot__Individual__dlm: [{ developerName: 'Contact_Home_map_Individual_1', sourceEntityDeveloperName: 'Contact_Home__dll', targetEntityDeveloperName: 'ssot__Individual__dlm', status: 'ACTIVE',
    fieldMappings: [fm('Id__c', 'ssot__Id__c'), fm('FirstName__c', 'ssot__FirstName__c'), fm('LastName__c', 'ssot__LastName__c'), fm('DataSource__c', 'ssot__DataSourceId__c'), fm('KQ_Id__c', 'KQ_Id__c')] }],
  ssot__ContactPointEmail__dlm: [{ developerName: 'Contact_Home_map_ContactPointEmail_1', sourceEntityDeveloperName: 'Contact_Home__dll', targetEntityDeveloperName: 'ssot__ContactPointEmail__dlm', status: 'ACTIVE',
    fieldMappings: [fm('Id__c', 'ssot__Id__c'), fm('Email__c', 'ssot__EmailAddress__c'), fm('Id__c', 'ssot__PartyId__c')] }],
  Purchase__dlm: [{ developerName: 'Purchases_map_Purchase_1', sourceEntityDeveloperName: 'Purchases__dll', targetEntityDeveloperName: 'Purchase__dlm', status: 'ACTIVE',
    fieldMappings: [fm('PurchaseId__c', 'PurchaseId__c'), fm('ContactId__c', 'IndividualId__c'), fm('Amount__c', 'Amount__c'), fm('PurchaseDate__c', 'PurchaseDate__c')] }],
};

const segments = [
  {
    apiName: 'High_Value_Buyers', displayName: 'High Value Buyers', segmentType: 'UI', segmentOnApiName: 'UnifiedIndividual__dlm', segmentStatus: 'ACTIVE', parameters: [],
    includeCriteria: enc({ type: 'CalculatedInsight', subject: { objectApiName: 'Spend__cio', fieldApiName: 'unified_id__c' },
      path: [[{ objectApiName: 'UnifiedIndividual__dlm', fieldApiName: 'ssot__Id__c' }, { objectApiName: 'Spend__cio', fieldApiName: 'unified_id__c' }]],
      comparison: { type: 'NumberComparison', subject: { objectApiName: 'Spend__cio', fieldApiName: 'spend__c' }, operator: 'greater than', value: 500 } }),
  },
  {
    apiName: 'Recent_Purchasers', displayName: 'Recent Purchasers', segmentType: 'UI', segmentOnApiName: 'Purchase__dlm', segmentStatus: 'ACTIVE', parameters: [],
    includeCriteria: enc({ type: 'LogicalComparison', operator: 'and', filters: [
      { type: 'RelativeToNowDateComparison', subject: { objectApiName: 'Purchase__dlm', fieldApiName: 'PurchaseDate__c' }, operator: 'in the last number of days', value: 30 },
      { type: 'NumberComparison', subject: { objectApiName: 'Purchase__dlm', fieldApiName: 'Amount__c' }, operator: 'greater than', value: 0 },
    ] }),
  },
  { apiName: 'Empty_Criteria', displayName: 'Empty Criteria', segmentType: 'UI', segmentOnApiName: 'UnifiedIndividual__dlm', segmentStatus: 'ACTIVE', parameters: [], includeCriteria: '' },
];

const activationTargets = [{ id: '85UAA0000000001', name: 'Acme Target', platformName: 'DataCloud', platformType: 'DataCloud', status: 'ACTIVE', historyAudienceDmoApiName: 'AA_x__dlm', latestAudienceDmoApiName: 'AAL_x__dlm' }];
const activationDetail = {
  id: '85RAA0000000001', developerName: 'High_Value_Activation', name: 'High Value Activation', activationType: 'SEGMENT', status: 'ACTIVE',
  segmentApiName: 'High_Value_Buyers', activationTargetName: 'Acme Target', activationTarget: { platformType: 'DataCloud' },
  activationTargetSubjectConfig: { developerName: 'UnifiedIndividual__dlm' }, refreshType: 'INCREMENTAL', processingType: 'Batch',
  lastPublishStatus: 'SUCCESS', lastPublishDate: '2026-01-01T00:00:00.000Z', historyAudienceDmoApiName: 'AA_x__dlm', latestAudienceDmoApiName: 'AAL_x__dlm',
  attributesConfig: { attributes: [
    { entityName: 'UnifiedIndividual__dlm', name: 'ssot__Id__c', label: 'Unified Individual Id', source: 'DIRECT', queryPathConfig: { configs: [] } },
    { entityName: 'Purchase__dlm', name: 'Amount__c', label: 'Amount', source: 'RELATED', queryPathConfig: { configs: [
      { queryPath: [{ objectName: 'UnifiedIndividual__dlm', fieldName: 'ssot__Id__c' }, { objectName: 'Purchase__dlm', fieldName: 'IndividualId__c' }] }] } },
  ] },
  contactPointsConfig: { contactPoints: [{ contactPointEntityName: 'ssot__ContactPointEmail__dlm', fieldConfig: { contactPointFields: [{ name: 'ssot__EmailAddress__c' }] },
    contactPointPath: enc([[{ objectApiName: 'UnifiedIndividual__dlm', fieldApiName: 'ssot__Id__c' }, { objectApiName: 'ssot__ContactPointEmail__dlm', fieldApiName: 'ssot__PartyId__c' }]]) }] },
  directDmoFiltersConfig: { filters: [] },
  relatedDmoFiltersConfig: { filters: [] },
  staticDataConfig: { staticData: [{ name: 'Campaign', value: 'Spring' }] },
};

const calculatedInsight = {
  apiName: 'Spend__cio', displayName: 'Spend', definitionType: 'CALCULATED_METRIC', calculatedInsightStatus: 'ACTIVE', creationType: 'Custom',
  expression: 'SELECT SUM(Purchase__dlm.Amount__c) AS spend__c, UnifiedIndividual__dlm.ssot__Id__c AS unified_id__c FROM UnifiedIndividual__dlm JOIN Purchase__dlm ON (UnifiedIndividual__dlm.ssot__Id__c = Purchase__dlm.IndividualId__c) GROUP BY unified_id__c',
  dimensions: [{ apiName: 'unified_id__c', displayName: 'Unified Id', dataType: 'Text', formula: 'UnifiedIndividual__dlm.ssot__Id__c' }],
  measures: [{ apiName: 'spend__c', displayName: 'Spend', dataType: 'Number', formula: 'SUM(Purchase__dlm.Amount__c)', fieldAggregationType: 'AGGREGATABLE' }],
  publishScheduleInterval: 'ONE', lastRunStatus: 'SUCCESS',
};
const ciMetadata = { metadata: [{ name: 'Spend__cio', displayName: 'Spend',
  dimensions: [{ name: 'unified_id__c', type: 'STRING' }], measures: [{ name: 'spend__c', type: 'NUMBER' }],
  relationships: [{ fromEntity: 'UnifiedIndividual__dlm', toEntity: 'Spend__cio' }, { fromEntity: 'Purchase__dlm', toEntity: 'Spend__cio' }] }] };

const identityResolutions = [{
  id: '1irAA0000000001', label: 'Unified Individual', description: 'Email match', objectApiName: 'Individual', configurationType: 'individual',
  rulesetStatus: 'PUBLISHED', doesRunAutomatically: true, secondaryDmo: 'ssot__Individual__dlm',
  matchRules: [{ label: 'Exact Email', criteria: [{ entityName: 'ssot__ContactPointEmail__dlm', fieldName: 'ssot__EmailAddress__c', matchMethodType: 'exactnormalized', caseSensitiveMatch: false, shouldMatchOnBlank: false }] }],
  reconciliationRules: [{ entityName: 'ssot__Individual__dlm', unifiedDmoName: 'UnifiedIndividual__dlm', linkDmoName: 'IndividualIdentityLink__dlm', ruleType: 'lastupdated', shouldIgnoreEmptyValue: true, fields: [], sources: [] }],
  sourceProfiles: 100, matchedSourceProfiles: 10, totalUnifiedProfiles: 95, consolidationRate: 5, lastJobStatus: 'SUCCESS', lastJobCompleted: '2026-01-01T00:00:00.000Z',
}];

const dgField = (developerName, dataType = 'STRING') => ({ developerName, dataType, keyCol: 'false', lookupCol: 'false' });
const dataGraphMetadata = [{
  developerName: 'Profile', description: 'Customer profile graph', status: 'Ready', primaryObjectName: 'UnifiedIndividual__dlm', primaryObjectType: 'Derived',
  idDmoName: 'Profile_1700000000001_ID__dlm', valuesDmoName: 'Profile_1700000000002_VALUE__dlm',
  dgObject: { developerName: 'UnifiedIndividual__dlm', type: 'Derived', fields: [dgField('ssot__Id__c')], paths: [], memberDmoName: 'Dg_AbCd_9pFAA0000000001_FRAGMENT__dlm',
    relatedObjects: [{ developerName: 'Purchase__dlm', type: 'Custom', fields: [dgField('Amount__c', 'NUMBER')], memberDmoName: 'Dg_EfGh_9pFAA0000000002_FRAGMENT__dlm',
      paths: [{ fieldName: 'IndividualId__c', parentFieldName: 'ssot__Id__c', cardinality: 'OneToMany' }],
      recencyCriteria: [{ fieldName: 'PurchaseDate__c', value: '30', valueType: 'time', valueUnit: 'DAY' }], relatedObjects: [] }] },
}];
const dataGraphDetail = { name: 'Profile', label: 'Customer Profile', status: 'ready', fullRefreshConfig: { schedule: { frequency: 7, timeGranularity: 'day' } }, incrementalRefreshConfig: { enabled: false } };

const metadataEntities = [
  ...metadataDmo.map((e) => ({ name: e.name, displayName: e.displayName, type: 'DataModelObject', category: e.category === 'Segment_Membership' ? 'Segment_Membership_Category' : e.category })),
  ...dataLakeObjects.map((d) => ({ name: d.name, displayName: d.label, type: 'DataLakeObject', category: d.category })),
  { name: 'Spend__cio', displayName: 'Spend', type: 'CalculatedInsight', category: '' },
];

// Real paging behaviour (api-quirks P1, P7, verified live):
// data-lake-objects: limit capped at 20, 0-based offset, rows outside the data space are counted and paged
//   but filtered out of each page (short pages mid-list), nextPageUrl while rows remain.
// data-streams: limit up to 200, offset counted from 1 (0 is treated as 1), nextPageUrl while rows remain.
const HIDDEN_DLO = { name: 'EngagementAggregation__dll', hidden: true };
function pageDlo(u) {
  const all = [...dataLakeObjects.slice(0, 1), HIDDEN_DLO, ...dataLakeObjects.slice(1)];
  const limit = Math.min(Number(u.searchParams.get('limit') || 20), 20);
  const offset = Number(u.searchParams.get('offset') || 0);
  const rows = all.slice(offset, offset + limit);
  const body = { dataLakeObjects: rows.filter((r) => !r.hidden), totalSize: all.length };
  if (offset + limit < all.length) body.nextPageUrl = `${B}/ssot/data-lake-objects?limit=${limit}&offset=${offset + limit}`;
  return body;
}
function pageStreams(u) {
  const limit = Math.min(Number(u.searchParams.get('limit') || 10), 200);
  const start = Math.max(1, Number(u.searchParams.get('offset') || 1));
  const body = { dataStreams: dataStreams.slice(start - 1, start - 1 + limit), totalSize: dataStreams.length };
  if (start - 1 + limit < dataStreams.length) body.nextPageUrl = `${B}/ssot/data-streams?limit=${limit}&offset=${start + limit}`;
  return body;
}

// [regex on pathname, (url) => body | { status, body }]
const B = `/services/data/v${V}`;
const routes = [
  [/^\/services\/data\/$/, () => [{ version: '66.0', url: '/services/data/v66.0' }, { version: V, url: B }]],
  [/\/limits$/, () => ({ DailyApiRequests: { Max: 15000, Remaining: 14900 } })],
  [/^\/services\/oauth2\/userinfo$/, () => ({ organization_id: '00DAA0000000001AAA', preferred_username: 'admin@acme.example', name: 'Acme Admin' })],
  [/\/ssot\/data-spaces$/, () => ({ dataSpaces: [{ name: 'default', label: 'default' }, { name: 'emea', label: 'EMEA' }], totalSize: 2 })],
  [/\/ssot\/metadata-entities$/, () => ({ done: true, metadata: metadataEntities })],
  [/\/ssot\/metadata$/, (u) => (u.searchParams.get('entityType') === 'CalculatedInsight' ? ciMetadata : { metadata: metadataDmo })],
  [/\/ssot\/data-lake-objects$/, (u) => pageDlo(u)],
  [/\/ssot\/data-streams$/, (u) => pageStreams(u)],
  [/\/ssot\/data-streams\/([^/]+)$/, (u, m) => {
    const s = dataStreams.find((x) => x.name === decodeURIComponent(m[1]));
    return s ? { ...s, mappings: streamMappings[s.name].map(([a, b]) => ({ sourceFieldName: a, targetFieldName: b })) } : { status: 404, body: [{ errorCode: 'NOT_FOUND' }] };
  }],
  [/\/ssot\/data-model-object-mappings$/, (u) => {
    const maps = dmoMappings[u.searchParams.get('dmoDeveloperName')];
    return maps ? { objectSourceTargetMaps: maps } : { status: 404, body: [{ errorCode: 'NOT_FOUND', message: 'Object source target map not found' }] };
  }],
  [/\/ssot\/segments$/, () => ({ segments, totalSize: segments.length, batchSize: 100, offset: 0 })],
  [/\/ssot\/activations$/, () => ({ activations: [{ id: activationDetail.id, developerName: activationDetail.developerName }], batchSize: 100, offset: 0 })],
  [/\/ssot\/activations\/([^/]+)$/, (u, m) => (m[1] === activationDetail.id ? activationDetail : { status: 400, body: [{ errorCode: 'INVALID_INPUT' }] })],
  [/\/ssot\/activation-targets$/, () => ({ activationTargets, batchSize: 100, offset: 0 })],
  [/\/ssot\/calculated-insights$/, (u) => ({ collection: { count: 1, items: u.searchParams.get('definitionType') === 'CALCULATED_METRIC' ? [calculatedInsight] : [] } })],
  [/\/ssot\/identity-resolutions$/, () => ({ identityResolutions })],
  [/\/ssot\/data-graphs\/metadata$/, () => ({ dataGraphMetadata })],
  [/\/ssot\/data-graphs\/([^/]+)$/, () => dataGraphDetail],
];

export const FAKE_INSTANCE = 'https://acme.my.salesforce.com';
export const FAKE_TOKEN = 'fake-session-token';

// Grow the org for load tests: n extra DMOs, each with a DLO, a stream, a mapping and 40 fields.
let scaled = 0;
function scaleTo(n) {
  for (let i = scaled; i < n; i++) {
    const fields = Array.from({ length: 40 }, (_, k) => `Field${k}__c`);
    metadataDmo.push({ name: `Custom${i}__dlm`, displayName: `Custom ${i}`, category: 'Engagement', primaryKeys: [{ name: 'Field0__c' }],
      fields: fields.map((x) => f(x, x)), relationships: [{ fromEntity: `Custom${i}__dlm`, toEntity: 'ssot__Individual__dlm', fromEntityAttribute: 'Field1__c', toEntityAttribute: 'ssot__Id__c', cardinality: 'NTOONE' }] });
    dataLakeObjects.push(dlo(`Custom${i}__dll`, `Custom ${i}`, 'Engagement', fields.map((x, k) => [x, x, 'Text', k === 0])));
    dataStreams.push(stream(`Custom${i}`, 'UploadedFiles', null, `Custom${i}__dll`, 'UPSERT'));
    streamMappings[`Custom${i}`] = fields.map((x) => [x.replace('__c', ''), x.replace('__c', '')]);
    dmoMappings[`Custom${i}__dlm`] = [{ developerName: `Custom${i}_map`, sourceEntityDeveloperName: `Custom${i}__dll`, targetEntityDeveloperName: `Custom${i}__dlm`, status: 'ACTIVE', fieldMappings: fields.map((x) => fm(x, x)) }];
    metadataEntities.push({ name: `Custom${i}__dlm`, type: 'DataModelObject', category: 'Engagement' }, { name: `Custom${i}__dll`, type: 'DataLakeObject', category: 'Engagement' });
  }
  scaled = Math.max(scaled, n);
}

/**
 * @param {{ latencyMs?: number, fail?: (url: URL) => ({status:number, body:any}|null), token?: string, scale?: number, expireAfter?: number }} opts
 * expireAfter: the session expires after that many authenticated requests (401 INVALID_SESSION_ID afterwards).
 */
export function makeFakeFetch({ latencyMs = 0, fail = () => null, token = FAKE_TOKEN, scale = 0, expireAfter = Infinity } = {}) {
  if (scale) scaleTo(scale);
  let authenticated = 0;
  let inFlight = 0;
  const calls = [];
  async function fakeFetch(input, init = {}) {
    const url = new URL(input);
    calls.push(url.pathname + url.search);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    inFlight++;
    fakeFetch.maxInFlight = Math.max(fakeFetch.maxInFlight, inFlight);
    try {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    } finally {
      inFlight--;
    }
    const respond = (status, body) => ({
      ok: status >= 200 && status < 300, status, type: 'basic',
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    });
    const injected = fail(url);
    if (injected) return respond(injected.status, injected.body);
    const needsAuth = url.pathname !== '/services/data/';
    if (needsAuth && (init.headers?.Authorization !== `Bearer ${token}` || ++authenticated > expireAfter)) return respond(401, [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]);
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      const out = handler(url, m);
      return out && out.status && 'body' in out ? respond(out.status, out.body) : respond(200, out);
    }
    return respond(404, [{ errorCode: 'NOT_FOUND', message: `No fake route for ${url.pathname}` }]);
  }
  fakeFetch.calls = calls;
  fakeFetch.maxInFlight = 0;
  return fakeFetch;
}

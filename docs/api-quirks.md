# Data 360 API: behaviour, exceptions and traps

Everything we found about how the Data 360 Connect API behaves that the Salesforce documentation does not say. Each entry states **what happens**, **how we know** and **how the code handles it**. Code comments refer to the IDs below.

Verified on a Developer Edition org, API v67.0, one data space (`default`), October 2026.

## Authentication and host

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| A1 | The `sid` must come from the cookie of the org's `*.my.salesforce.com` domain. The cookie of `*.lightning.force.com` gives 401 `INVALID_SESSION_ID`. | live test | `core/salesforce.js` `myDomainFromUrl`; the extension reads the cookie for the My Domain derived from the tab |
| A2 | Calling the Lightning domain answers with a 302 to `my.salesforce.com`. Redirects are not followed, so the token is never sent to another host. | live test | `core/salesforce.js`: `redirect: 'manual'`, other origins refused |
| A3 | `/services/data/vXX/ssot/*` works on the core host, although the OpenAPI spec lists the Data 360 tenant host as the server. No token exchange is needed. | live test | none needed |
| A4 | `/services/data/` (the version list) needs no login, so a 200 there does not prove the token works. | live test | the session check uses `/limits` and `userinfo` |

## Paging and performance

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| P1 | `/ssot/data-lake-objects` and `/ssot/data-streams` return **`nextPageUrl`** when more pages exist, and following it is the only reliable way through them (P7, P9). When everything fits on one page there is no link. Segments, activations and targets have no link: `batchSize`/`offset`, offset from 0. | live probe (small page sizes, all items reached, no duplicates) | `core/util.js` `getAllOffset` (follows the link), `getAllBatched` |
| P2 | Segments, activations and targets page with `batchSize`/`offset`. Segments return `totalSize`, activations do not. | responses | `core/modules/segments.js`, `activations.js` |
| P3 | Calculated insights page with `pageToken` (`collection.nextPageToken`). The `offset` parameter is still required. | spec + responses | `core/modules/calculatedInsights.js` |
| P4 | `/ssot/data-model-objects` returns the whole catalogue (1,000+ DMOs, unused ones included) at 20–40 s per page of 200. | live test | not used; DMOs come from `/ssot/metadata` |
| P5 | The `/ssot/data-streams` list takes about 4 s even for 10 streams. | export timings | included in the estimate |
| P6 | DMO relationships endpoint: default limit 20; `ssot__Account__dlm` has 326; a DMO without relationships returns **204 with no body**. | live test | endpoint not used (see M3) |
| P7 | **Data streams count `offset` from 1** (`offset=0` behaves like 1; `nextPageUrl` from `limit=3&offset=1` points to `offset=4`). Activations: the response's `offset` is the next offset and `batchSize` the number returned; offset from 0. Segments: offset from 0, `totalSize`. | live probe | streams: `nextPageUrl`; others: `pageAll` (de-duplication, repeat detection) |
| P8 | The spec gives a page size of 1–200 for all lists, but the server does not always honour it (P9). | spec | page sizes 100/200 |
| P9 | **`/ssot/data-lake-objects` caps `limit` at 20** (`currentPageUrl` shows `limit=20` when 200 was requested) and **filters out DLOs of other data spaces after paging**: pages in the middle can be shorter (e.g. 3 of 5), while `totalSize` counts every row. A "short page means the end" loop fetches only the first ≤20 DLOs. | live probe | `getAllOffset` follows `nextPageUrl`; tests `nextPageUrl is followed` and `scale.test.js` |

Anomalies are reported in the module's `warnings` as `PAGING_TRUNCATED`, `PAGING_REPEATED` or `PAGING_DUPLICATES`.

### The `dataspace` parameter

| Endpoint | `dataspace` | Handling |
|---|---|---|
| `/ssot/metadata`, `/ssot/metadata-entities`, `/ssot/data-model-object-mappings`, `/ssot/segments`, `/ssot/calculated-insights`, `/ssot/data-graphs/metadata` | supported | passed (omitted for `default`) |
| `/ssot/data-lake-objects`, `/ssot/data-streams`, `/ssot/activations`, `/ssot/activation-targets`, `/ssot/identity-resolutions` | **not supported** | results filtered by `dataSpaceInfo` (DLOs, streams) or `dataSpaceName` (activations, targets, identity resolution); items without that information are kept |

## Data model (DMOs, DLOs, relationships)

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| M1 | `/ssot/metadata?entityType=DataModelObject` returns **only the DMOs used in the org**, with fields, types, `primaryKeys` and `relationships`, in one fast call. | compared with the catalogue | `core/modules/model.js` |
| M2 | System DMO categories: `Segment_Membership`, `Activation_Audience`, `Vector_Embedding` (excluded by category; data graph DMOs are excluded by name, see D4). In `/ssot/metadata-entities` the categories have other names (`Segment_Membership_Category`, `Activation_Audience_Category`). | responses | `core/util.js` `EXCLUDED_DMO_CATEGORIES` |
| M3 | `relationships` in `/ssot/metadata` are the **active** ones. `/ssot/data-model-objects/{dmo}/relationships` also returns inactive ones. | compared both | `model.js` uses metadata only |
| M4 | Every relationship appears twice in metadata, once at each end. | responses | de-duplicated by `from|field|to|field` in `model.js` |
| M5 | Identity resolution DMOs (`Unified*`, `*IdentityLink__dlm`) have no DLO → DMO mappings. | export + identity resolution rules | `model.js` marks them `derived` (**name heuristic**, confirmed against the reconciliation rules in tests) |
| M6 | Field types differ by source: DLO `dataType: "Text"`; DMO `type: "STRING"` + `businessType: "TEXT"`; calculated insights `dataType` in the list and `type` in metadata. | responses | stored as returned, no normalisation |
| M7 | DLOs without a data stream exist: search index chunks (`<Object>_chunk__dll`, `<Object>_index__dll`), CRM currency rates, AI audit tables. | export + `/ssot/search-index` | none; shown as "no stream" |
| M8 | The `/ssot/data-lake-objects` list returns the **DLOs of the data space**. `totalSize` and `/ssot/metadata?entityType=DataLakeObject` count more (system DLOs such as `EngagementAggregation__dll`). | compared lists | `totalSize` is not used to detect missing DLOs |

## Data streams and mappings

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| S1 | The `/ssot/data-streams` list **does not include** field mappings, even with `includeMappings=true`. They are only in the stream's details. | responses | `ingestion.js`: one detail call per stream |
| S2 | Stream mappings name the DLO field **without the `__c` suffix** (`MailingStreet`) while `/ssot/data-lake-objects` has it (`MailingStreet__c`). | first snapshot run (hundreds of false warnings) | `ingestion.js`: exact name first, then `+__c`; the full name is stored |
| S3 | Stream mappings do not name the target DMO, only source → DLO fields. | responses | DLO → DMO comes from the `mappings` module |
| S4 | `/ssot/data-model-object-mappings` requires `dmoDeveloperName`: there is no call for all mappings. **404 `NOT_FOUND` means the DMO has no mappings**, not an error. | spec + export | `mappings.js`: 404 → none |
| S5 | System fields in mappings (`KQ_*`, `cdp_sys_*`, `DataSource__c`, `DataSourceObject__c`, `ssot__DataSourceId__c`, `ssot__DataSourceObjectId__c`) are hidden in the Data Cloud UI. | compared with the UI | `core/util.js` `isSystemField`; snapshot flags them `system: true` |
| S6 | Connector types seen: `SalesforceDotCom` (with `sourceObject`), `UploadedFiles` (CSV, `TOTAL_REPLACE`), `AIPlatform` (system). | responses | `ingestion.js`: `system: true` for `AIPlatform` |
| S7 | The UI works with labels, the API with developer names. | compared with the UI | labels stored next to names |

## Segments

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| G1 | `includeCriteria` is a **string of JSON encoded with HTML entities** (`&quot;`). | responses | `core/criteria.js` `decodeEntities` |
| G2 | The `/ssot/segments` list already contains `includeCriteria`; details add nothing essential. | compared list and details | one call per 100 segments |
| G3 | Some segments have **empty** `includeCriteria`, also in their details (nested segments, some UI segments, vector search operators). | responses | `criteriaAvailable: false`, warning `SEGMENT_NO_CRITERIA` |
| G4 | Node types: `LogicalComparison`, `*Comparison`, `NumberAggregation` (with `path`/`joinPath` and `containerObjectApiName`), `CalculatedInsight`, `Waterfall`, `NestedSegment`. A Dynamic segment has an aggregation node **at the top level** with the filter inside. | responses | `criteria.js`; unknown types → `{ kind: 'raw' }` |
| G5 | Dynamic segments have `parameterizedValues` instead of `values` and define them in `parameters[]`. | responses | `compare.param` |
| G6 | Criteria subjects use `objectApiName`/`fieldApiName`. | responses | `criteria.js` |

## Activations

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| T1 | Activation and activation target details are available **by `id` only**; by name: 400 `INVALID_INPUT` or 404 `ITEM_NOT_FOUND`. | live test | `activations.js` uses `id` |
| T2 | The activation list has no attributes, contact points or filters: one detail call per activation. | responses | `activations.js` |
| T3 | Types: `SEGMENT` (with `segmentApiName`), `DMO`, `API_TRIGGERED`. | responses | `activations.segment`; `link` checks it exists |
| T4 | `contactPointPath` is a **string of JSON encoded with HTML entities**. | responses | `activations.js` |
| T5 | Join paths (`queryPathConfig.configs[].queryPath`) and activation filters use **`objectName`/`fieldName`**, not `objectApiName`/`fieldApiName` like segments. | responses | `activations.js` |
| T6 | `activationRecordSchema` is a JSON Schema string (HTML entities) that repeats `attributesConfig`. | responses | ignored |
| T7 | `/ssot/activation-platforms?activationPlatformView=All` returns 403; `/ssot/activation-external-platforms` is a catalogue of platforms, not configuration. | exploration | not used |

## Calculated insights

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| C1 | `/ssot/calculated-insights` **without `definitionType` returns 0 items** although insights exist. Ask separately for `CALCULATED_METRIC`, `STREAMING_METRIC` and `EXTERNAL_METRIC`. | live test | `calculatedInsights.js`: 3 calls |
| C2 | The list contains the full definition (`expression`, `dimensions`, `measures`); details are not needed. | responses | one call per type |
| C3 | Field types are only in `/ssot/metadata?entityType=CalculatedInsight`, which also lists the source objects. | responses | `calculatedInsights.js` merges both |
| C4 | `fieldRefs` are extracted from SQL with an `object__dlm.field` pattern. **Table aliases** (`FROM Order__dlm o … o.Amount__c`) and unprefixed fields are not caught. | code | known limitation |

## Identity resolution

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| I1 | The `/ssot/identity-resolutions` list contains the full rules (`matchRules`, `reconciliationRules`). | responses | one call |
| I2 | **No developer name** in the response: the record `id` is the key (the only org-specific key in a snapshot). | responses | `identityResolution.js`: `name = id` |
| I3 | `objectApiName` is the name without suffix (`Individual`); `secondaryDmo` is the full DMO name. | responses | both stored |
| I4 | Statistics (`sourceProfiles`, `totalUnifiedProfiles`, `consolidationRate`) are aggregates without personal data. | responses | `stats` |

## Data graphs

| # | Behaviour | How we know | Handling |
|---|---|---|---|
| D1 | `/ssot/data-graphs/metadata` returns every data graph with its full tree in one call: `dgObject` → `relatedObjects[]` (recursive); each node has `type` (`Derived`, `Standard`, `Custom`, `Bridge`, `Calculated`, `SegmentMembership`), `fields[]`, `paths[]`, `filterCriteria`, `recencyCriteria`. | responses | `dataGraphs.js` |
| D2 | `/ssot/data-graphs/{name}` adds labels, the refresh schedule (`fullRefreshConfig`, `incrementalRefreshConfig`), node `jsonPath` and `relatedSegments`. There the tree is under `sourceObject` and fields use `sourceFieldName`. | responses | `dataGraphs.js` (one call per graph) |
| D3 | `status` can differ between the two endpoints (metadata said `Inprogress` while details said `ready`; a day later both said ready). Letter case differs too. | two sessions | `status` from details, `metadataStatus` separately |
| D4 | **A data graph creates system DMOs** that appear in `/ssot/metadata` under `Profile`/`Related`, so the category filter does not catch them. One graph with 12 nodes added 18 DMOs. Rules below. | `/ssot/metadata` before and after creating a graph | `core/util.js` `isDataGraphDmo`, `isExcludedDmo`; `test/util.test.js` |
| D5 | A node's `recencyCriteria` can hold two conditions at once: time (`valueType: time`, e.g. 7 days) and count (`valueType: record`, e.g. 10 records). | responses | `dataGraphs.js` |

### Excluding data graph DMOs (D4)

Excluded DMOs are left out of the `model` module, and `mappings` makes no calls for them (each would be a wasted 404). The `dataGraphs` module records their names in `systemDmos`.

| Kind | Name pattern (regex) | Per graph | Where the graph API names it |
|---|---|---|---|
| FRAGMENT | `^Dg_[A-Za-z0-9]{4}_[A-Za-z0-9]{15}_FRAGMENT__dlm$` | 1 per node | node `memberDmoName` (metadata), `fragmentDMOName` (details) |
| STATE | `^Dg_[A-Za-z0-9]{4}_[A-Za-z0-9]{15}_STATE__dlm$` | some nodes | **nowhere**: recognisable by name only |
| ID | `^[A-Za-z0-9_]+_\d{13}_ID__dlm$` | 1 | `idDmoName` |
| VALUE | `^[A-Za-z0-9_]+_\d{13}_VALUE__dlm$` | 1 | `valuesDmoName` |
| state table | `^DataGraphStateTable__dlm$` | 1 per org | **nowhere** |

Notes:
- `\d{13}` is a millisecond timestamp. Segment membership DMOs also have 13 digits (`Individual_SM_<13 digits>__dlm`) but no `_ID`/`_VALUE` suffix, and are excluded by category; a test keeps the patterns apart.
- **False positive risk:** a custom DMO named like `Something_1234567890123_ID__dlm` would be excluded too. Considered unlikely.
- **Miss risk:** other graph kinds (e.g. real-time graphs) may create DMOs with other names. After a new kind of graph appears, compare the DMO count in `/ssot/metadata` with the `model` module.
- The patterns come from one graph in one org.

## Other endpoints

| # | Behaviour |
|---|---|
| O1 | `/ssot/connections` requires `connectorType`; type names come from `/ssot/connectors`. |
| O2 | `/ssot/data-kits` returned 500. |
| O3 | `/ssot/data-governance/access-policies` returned 404 (feature not enabled). |
| O4 | `/ssot/metadata-entities` returns an inventory of DMOs/DLOs/insights without fields in one call: used for the request estimate. |
| O5 | `/limits` shows only `CdpAiInferenceApiMonthlyLimit` for Data 360; there are no visible limits for `/ssot` requests. |

## Not verified yet (no data in the test org)

Multiple data spaces (the `dataspace` parameter), data actions, data transforms, data shares, field tags, segments with exclusions (`excludeCriteria`), activations with direct filters (`directDmoFiltersConfig`), streaming and external calculated insights.

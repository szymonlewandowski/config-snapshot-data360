# Export format (schema 0.5)

What the extension writes, and the contract for anything that reads a snapshot. Breaking changes bump `schemaVersion` and are listed in the [CHANGELOG](../CHANGELOG.md).

## Contents
1. Bundle layout and manifest
2. Conventions
3. model: dmos, relationships
4. ingestion: dataStreams, dlos
5. mappings
6. segments (criteria tree)
7. activations, activationTargets
8. calculatedInsights
9. identityResolution: rulesets
10. dataGraphs
11. Warnings

## 1. Bundle layout and manifest

```
d360-<myDomain>-<dataSpace>-<date>.zip
├── manifest.json
├── snapshot/<module>.json      { module, schemaVersion, ...collections, warnings[] }
├── raw/<module>.json           optional raw API responses (only when the user ticked "include raw")
└── README.txt
```

Read only `manifest.json` and `snapshot/*.json`. `raw/` is a debugging cache, not a contract: its shape follows the Salesforce API and may change with it.

```jsonc
// manifest.json
{
  "bundle": "data360-export", "bundleVersion": 1, "schemaVersion": "0.5",
  "createdAt": "2026-10-02T13:16:52.945Z",
  "source": { "orgId": "00D…", "apiVersion": "67.0", "dataSpace": "default" },
  "redacted": true,                      // only when exported with "Redact filter values"
  "modules": { "model": { "fetchedAt": "…", "calls": 1, "durationMs": 1128, "error": "…only on failure" }, … },
  "counts": { "model": { "dmos": 25, "relationships": 51, "warnings": 0 }, … },
  "linkWarnings": [ { "code": "…", "ref": "…" } ]   // cross-module references that do not resolve
}
```

The modules are `model`, `ingestion`, `mappings`, `segments`, `activations`, `calculatedInsights`, `identityResolution` and `dataGraphs`. Any subset is possible.

## 2. Conventions

- Items are linked **by API name** (`name`). Labels are for display.
- Every collection is sorted by `name`, as are fields, so two exports diff cleanly.
- `system: true` marks technical fields and streams, which outputs hide by default.
- Excluded from `model`: DMOs in the categories `Segment_Membership`, `Activation_Audience` and `Vector_Embedding`, and data graph system DMOs (`Dg_*_FRAGMENT__dlm`, `*_<13 digits>_ID__dlm` / `_VALUE__dlm`, `DataGraphStateTable__dlm`).
- In a redacted export, literals in `criteria`, `filters`, `staticData`, `expression` / `formula` and data graph `filter` read `<redacted>`.

## 3. model

```jsonc
"dmos": [{
  "name": "ssot__Individual__dlm", "label": "Individual",
  "category": "Profile",                  // Profile | Engagement | Related | Other …
  "standard": true,                       // ssot__ prefix
  "derived": null,                        // "identityResolution" for Unified* / *IdentityLink objects
  "primaryKey": ["ssot__Id__c"],
  "fields": [{ "name": "ssot__FirstName__c", "label": "First Name", "type": "STRING", "businessType": "TEXT", "system": false }]
}],
"relationships": [{
  "from": { "dmo": "ssot__ContactPointEmail__dlm", "field": "ssot__PartyId__c" },   // many side
  "to":   { "dmo": "ssot__Individual__dlm", "field": "ssot__Id__c" },              // one side
  "cardinality": "NTOONE"                 // NTOONE | ONETOONE
}]
```

## 4. ingestion

```jsonc
"dataStreams": [{
  "name": "Contact_Home", "label": "Contact_Home",
  "connector": { "type": "SalesforceDotCom", "name": "SalesforceDotCom_Home", "sourceObject": "Contact" },  // sourceObject null for files etc.
  "dlo": "Contact_Home__dll",
  "status": "ACTIVE", "refreshMode": "UPSERT", "lastRunStatus": "SUCCESS", "lastRefreshDate": "…",
  "system": false,                        // true for system connectors (AIPlatform)
  "fieldMappings": [{ "sourceField": "FirstName", "dloField": "FirstName__c" }]   // no sourceField: formula / system value
}],
"dlos": [{
  "name": "Contact_Home__dll", "label": "Contact_Home", "category": "Profile", "primaryKey": ["Id__c"],
  "fields": [{ "name": "FirstName__c", "label": "First Name", "type": "Text", "isPrimaryKey": false, "system": false }]
}]
```

Only streams and DLOs of the exported data space are included.

## 5. mappings

```jsonc
"mappings": [{
  "name": "Contact_Home_map_Individual_1777639231979",
  "dlo": "Contact_Home__dll", "dmo": "ssot__Individual__dlm", "status": "ACTIVE",
  "fieldMappings": [{ "dloField": "FirstName__c", "dmoField": "ssot__FirstName__c", "system": false }]
}]
```

## 6. segments

```jsonc
"segments": [{
  "name": "TEST_Dynamic_Segment", "label": "[TEST] Dynamic Segment",
  "type": "Dynamic",                      // UI | Dynamic | Waterfall | …
  "segmentOn": "UnifiedIndividual__dlm", "status": "ACTIVE",
  "parameters": [{ "name": "category", "type": "TEXT", "isCollection": false }],
  "criteriaAvailable": true,              // false: the API returned no criteria
  "criteria": { "kind": "and", "children": [ … ] },
  "fieldRefs": [{ "object": "Order__dlm", "field": "OrderDate__c" }],
  "segmentRefs": [],                      // segments used by waterfall / nested segments
  "unknownNodeTypes": []
}]
```

Criteria nodes (`kind`):

| kind | fields |
|---|---|
| `and` / `or` | `children[]` |
| `compare` | `type`, `object`, `field`, `operator` (API wording, e.g. `"equal"`, `"in the last number of days"`), `values[]` or `param`, `source` (DIRECT / RELATED) |
| `aggregate` | `fn`, `over` (object), `path[] {from:{object,field}, to:{object,field}}`, `where` (subtree), `compare` |
| `calculatedInsight` | `object` (`__cio`), `path[]`, `compare` |
| `waterfall` | `segments[]` |
| `segment` | `ref` |
| `raw` | `type`, `raw`: an undecoded node, kept as is |

## 7. activations

```jsonc
"activations": [{
  "name": "Test_Standard_Segment1777804028220", "label": "[Test] Standard Segment",
  "type": "SEGMENT",                      // SEGMENT | DMO | API_TRIGGERED
  "status": "ACTIVE", "subject": "UnifiedIndividual__dlm", "segment": "zcxvasdc",
  "target": "Data 360", "targetPlatform": "DataCloud", "refreshType": "INCREMENTAL", "processingType": "Batch",
  "lastPublishStatus": "SUCCESS", "lastPublishDate": "…",
  "audienceDmos": { "history": "AA_…__dlm", "latest": "AAL_…__dlm" },
  "attributes": [{ "object": "Order__dlm", "field": "Amount__c", "label": "Amount", "source": "RELATED", "path": [ hops ] }],
  "contactPoints": [{ "object": "ssot__ContactPointEmail__dlm", "fields": ["ssot__EmailAddress__c"], "path": [ hops ] }],
  "filters": { "direct": [], "related": [{ "object": "Order__dlm", "where": { criteria node }, "limit": { "field": "OrderDate__c", "max": 3, "order": "DESC" }, "path": [ hops ] }] },
  "staticData": [{ "name": "Campaign", "value": "…" }],
  "fieldRefs": [{ "object": "…", "field": "…" }]
}],
"activationTargets": [{ "name": "Data 360", "id": "…", "platformName": "DataCloud", "platformType": "DataCloud", "status": "ACTIVE", "audienceDmos": { … } }]
```

## 8. calculatedInsights

```jsonc
"calculatedInsights": [{
  "name": "LTV__cio", "label": "LTV", "definitionType": "CALCULATED_METRIC", "status": "ACTIVE",
  "creationType": "Custom", "description": null, "expression": "SELECT …",
  "dimensions": [{ "name": "unified_individual_id__c", "label": "…", "dataType": "Text", "type": "STRING", "formula": "UnifiedIndividual__dlm.ssot__Id__c" }],
  "measures":   [{ "name": "ltv__c", "label": "LTV", "dataType": "Number", "type": "NUMBER", "formula": "SUM(Order__dlm.Amount__c)", "aggregation": "AGGREGATABLE" }],
  "schedule": "…", "lastRunStatus": "SUCCESS", "lastRunDate": "…",
  "sourceObjects": ["Order__dlm", "…"], "fieldRefs": [{ "object": "Order__dlm", "field": "Amount__c" }]
}]
```

## 9. identityResolution

```jsonc
"rulesets": [{
  "name": "1irNS000000VY5aYAG",           // record id (the API has no developer name)
  "label": "Unified Individual", "description": "…", "object": "Individual", "configurationType": "individual",
  "status": "PUBLISHED", "runsAutomatically": true, "primaryDmo": "ssot__Individual__dlm",
  "matchRules": [{ "label": "…", "criteria": [{ "dmo": "ssot__ContactPointEmail__dlm", "field": "ssot__EmailAddress__c", "method": "exactnormalized", "caseSensitive": false, "matchOnBlank": false }] }],
  "reconciliationRules": [{ "dmo": "ssot__Individual__dlm", "unifiedDmo": "UnifiedIndividual__dlm", "linkDmo": "IndividualIdentityLink__dlm", "ruleType": "lastupdated", "ignoreEmpty": true, "fields": [], "sources": [] }],
  "stats": { "sourceProfiles": 50, "matchedSourceProfiles": 4, "totalUnifiedProfiles": 48, "consolidationRate": 4 },
  "lastJob": { "status": "SUCCESS", "completed": "…" }
}]
```

## 10. dataGraphs

```jsonc
"dataGraphs": [{
  "name": "Main", "label": "Main", "description": "…", "status": "ready", "metadataStatus": "Ready",
  "primaryObject": "UnifiedIndividual__dlm", "primaryObjectType": "Derived",
  "refresh": { "full": { "frequency": 30, "timeGranularity": "day" }, "incremental": false },
  "systemDmos": { "ids": "…_ID__dlm", "values": "…_VALUE__dlm", "fragments": ["Dg_…_FRAGMENT__dlm"] },
  "nodes": [{                              // depth-first order
    "object": "Order__dlm", "type": "Custom", "parent": "ssot__Individual__dlm", "depth": 3,
    "join": [{ "field": "IndividualId__c", "parentField": "ssot__Id__c", "cardinality": "OneToMany" }],
    "fields": [{ "name": "Amount__c", "dataType": "NUMBER", "key": false, "lookup": false }],
    "filter": null,
    "recency": [{ "field": "OrderDate__c", "value": "7", "valueType": "time", "unit": "DAY" }],
    "fragmentDmo": "Dg_…_FRAGMENT__dlm"
  }]
}]
```

## 11. Warnings

Each module has `warnings: [{ code, ref }]`:

| Code | Meaning |
|---|---|
| `MISSING_FIELD` | A mapping or relationship names a field the object doesn't have |
| `SEGMENT_NO_CRITERIA` | The API returned empty criteria for a segment |
| `SEGMENT_UNKNOWN_NODE` | A criteria node type that isn't decoded (kept as `raw`) |
| `MISSING_SEGMENT` / `MISSING_TARGET` / `MISSING_CI_METADATA` | A reference to a segment, target or insight metadata that isn't in the export |
| `MAPPING_FETCH_FAILED` / `ACTIVATION_FETCH_FAILED` / `DATA_GRAPH_DETAIL_FAILED` | The details of one item couldn't be fetched, so that item is incomplete |
| `PAGING_TRUNCATED` / `PAGING_REPEATED` / `PAGING_DUPLICATES` | The API's paging misbehaved, so the list may be incomplete. Treat it as such |

`manifest.linkWarnings` lists cross-module references that don't resolve, for example a mapping to a DMO missing from `model`, or a segment field on an unknown object.

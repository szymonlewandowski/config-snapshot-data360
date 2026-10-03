// model: DMOs, fields, types and active relationships (/ssot/metadata, 1 call).
import { sorted, cmp, isExcludedDmo, isSystemField, dmoMetadata } from '../util.js';

// DMOs populated by identity resolution, not by DLO mappings.
export const derivedFrom = (name) => (/^Unified/.test(name) || /IdentityLink__dlm$/.test(name) ? 'identityResolution' : null);

export default {
  name: 'model',
  async collect(get, ctx) {
    ctx.onProgress('model: metadata');
    return { metadata: await dmoMetadata(get, ctx) };
  },
  normalize(raw) {
    const warnings = [];
    const entities = (raw.metadata?.metadata || []).filter((e) => !isExcludedDmo(e));
    const dmos = sorted(entities.map((e) => ({
      name: e.name,
      label: e.displayName ?? e.name,
      category: e.category,
      standard: e.name.startsWith('ssot__'),
      derived: derivedFrom(e.name),
      primaryKey: (e.primaryKeys || []).map((pk) => pk.name),
      fields: sorted((e.fields || []).map((f) => ({
        name: f.name,
        label: f.displayName ?? f.name,
        type: f.type,
        businessType: f.businessType,
        system: isSystemField(f.name),
      }))),
    })));
    const index = new Map(dmos.map((d) => [d.name, new Set(d.fields.map((f) => f.name))]));

    const keyed = new Map();
    for (const e of entities) {
      for (const r of e.relationships || []) {
        if (!index.has(r.fromEntity) || !index.has(r.toEntity)) continue; // other end excluded or not in model
        const key = [r.fromEntity, r.fromEntityAttribute, r.toEntity, r.toEntityAttribute].join('|');
        if (keyed.has(key)) continue;
        if (!index.get(r.fromEntity).has(r.fromEntityAttribute)) warnings.push({ code: 'MISSING_FIELD', ref: `relationships[${key}].from` });
        if (!index.get(r.toEntity).has(r.toEntityAttribute)) warnings.push({ code: 'MISSING_FIELD', ref: `relationships[${key}].to` });
        keyed.set(key, {
          from: { dmo: r.fromEntity, field: r.fromEntityAttribute },
          to: { dmo: r.toEntity, field: r.toEntityAttribute },
          cardinality: r.cardinality,
        });
      }
    }
    const relationships = [...keyed.keys()].sort(cmp).map((k) => keyed.get(k));
    return { dmos, relationships, warnings };
  },
};

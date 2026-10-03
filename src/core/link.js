// Cross-module integrity checks. Runs only for module pairs present in the export;
// a missing module is never an error.

export function link(snap) {
  const warnings = [];
  const warn = (code, ref) => warnings.push({ code, ref });
  const fieldIndex = (items, fieldsOf = (o) => o.fields) => (items ? new Map(items.map((o) => [o.name, new Set(fieldsOf(o).map((f) => f.name))])) : null);
  const dmos = fieldIndex(snap.model?.dmos);
  const dlos = fieldIndex(snap.ingestion?.dlos);
  const cis = fieldIndex(snap.calculatedInsights?.calculatedInsights, (c) => [...c.dimensions, ...c.measures]);
  const segments = snap.segments ? new Set(snap.segments.segments.map((s) => s.name)) : null;

  // object.field reference: checked against model (__dlm) or calculatedInsights (__cio) when present.
  // Objects outside the snapshot (e.g. excluded DMO categories) are not reported.
  const checkRef = (ref, object, field) => {
    const idx = /__cio$/.test(object) ? cis : dmos;
    if (idx?.has(object) && field && !idx.get(object).has(field)) warn('MISSING_FIELD', `${ref}[${object}.${field}]`);
  };
  const checkDmo = (ref, name) => { if (dmos && name && !dmos.has(name)) warn('MISSING_DMO', `${ref}[${name}]`); };

  for (const m of snap.mappings?.mappings || []) {
    if (dlos && !dlos.has(m.dlo)) warn('MISSING_DLO', `mappings[${m.name}].dlo`);
    checkDmo(`mappings[${m.name}].dmo`, m.dmo);
    for (const f of m.fieldMappings) {
      if (dlos?.has(m.dlo) && !dlos.get(m.dlo).has(f.dloField)) warn('MISSING_FIELD', `mappings[${m.name}].fieldMappings[${f.dloField}]`);
      checkRef(`mappings[${m.name}].fieldMappings`, m.dmo, f.dmoField);
    }
  }

  for (const s of snap.segments?.segments || []) {
    for (const f of s.fieldRefs) checkRef(`segments[${s.name}].fieldRefs`, f.object, f.field);
    if (cis) for (const f of s.fieldRefs) if (/__cio$/.test(f.object) && !cis.has(f.object)) warn('MISSING_CI', `segments[${s.name}].fieldRefs[${f.object}]`);
  }

  for (const a of snap.activations?.activations || []) {
    if (segments && a.segment && !segments.has(a.segment)) warn('MISSING_SEGMENT', `activations[${a.name}].segment[${a.segment}]`);
    checkDmo(`activations[${a.name}].subject`, a.subject);
    for (const f of a.fieldRefs) checkRef(`activations[${a.name}].fieldRefs`, f.object, f.field);
  }

  for (const c of snap.calculatedInsights?.calculatedInsights || []) {
    for (const f of c.fieldRefs) checkRef(`calculatedInsights[${c.name}].fieldRefs`, f.object, f.field);
  }

  for (const r of snap.identityResolution?.rulesets || []) {
    for (const m of r.matchRules) for (const c of m.criteria) checkRef(`identityResolution[${r.label}].matchRules`, c.dmo, c.field);
    for (const x of r.reconciliationRules) {
      checkDmo(`identityResolution[${r.label}].reconciliationRules.dmo`, x.dmo);
      checkDmo(`identityResolution[${r.label}].reconciliationRules.unifiedDmo`, x.unifiedDmo);
    }
  }
  // Data graph nodes: DMO nodes against model, Calculated nodes against calculatedInsights.
  for (const g of snap.dataGraphs?.dataGraphs || []) {
    for (const n of g.nodes) {
      const ref = `dataGraphs[${g.name}].nodes`;
      if (/__cio$/.test(n.object)) {
        if (cis && !cis.has(n.object)) warn('MISSING_CI', `${ref}[${n.object}]`);
      } else if (n.type !== 'SegmentMembership') {
        // segment membership DMOs are excluded from the model by category
        checkDmo(ref, n.object);
      }
      for (const f of n.fields) checkRef(`${ref}.fields`, n.object, f.name);
      for (const j of n.join) {
        checkRef(`${ref}.join`, n.object, j.field);
        checkRef(`${ref}.join`, n.parent, j.parentField);
      }
    }
  }
  return warnings;
}

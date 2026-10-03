// segments: segment definitions with normalized criteria (1 call per 100 segments).
import { sorted, getAllBatched, pagingWarnings } from '../util.js';
import { normalizeSegment } from '../criteria.js';

export default {
  name: 'segments',
  async collect(get, ctx) {
    ctx.onProgress('segments');
    const { items, info } = await getAllBatched(get, `${ctx.base}/ssot/segments`, 'segments', { dataspace: ctx.ds });
    return { segments: items, _paging: { segments: info } };
  },
  normalize(raw) {
    const warnings = pagingWarnings(raw._paging);
    const segments = sorted((raw.segments || []).map(normalizeSegment));
    const names = new Set(segments.map((s) => s.name));
    for (const s of segments) {
      if (!s.criteriaAvailable) warnings.push({ code: 'SEGMENT_NO_CRITERIA', ref: `segments[${s.name}]` });
      for (const t of s.unknownNodeTypes) warnings.push({ code: 'SEGMENT_UNKNOWN_NODE', ref: `segments[${s.name}].${t}` });
      for (const r of s.segmentRefs) if (!names.has(r)) warnings.push({ code: 'MISSING_SEGMENT', ref: `segments[${s.name}].segmentRefs[${r}]` });
    }
    return { segments, warnings };
  },
};

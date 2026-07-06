function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function pendingAnnotationInputFromOperatorSelection(selection = {}) {
  const target = object(selection.target);
  const evidence = object(selection.evidence);
  return {
    source: text(selection.origin, 'operator_annotation_surface'),
    comment: text(selection.comment) || null,
    target_kind: text(target.kind),
    target_summary: text(target.summary),
    saved_ref: target.savedRef || null,
    capability: selection.readiness || undefined,
    fallback_evidence: array(evidence.fallback),
    artifact_refs: array(evidence.artifacts),
    recommended_next: array(evidence.next).length ? array(evidence.next) : undefined,
    source_capture: evidence.sourceCapture || null,
  };
}

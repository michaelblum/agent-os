function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function summary({
  kind = '',
  stage = '',
  status = '',
  why = '',
  next = null,
  blockers = [],
  missing = [],
  scoped = true,
} = {}) {
  return {
    type: 'work_record.recovery_summary',
    kind: text(kind),
    stage: text(stage),
    status: text(status),
    why: text(why),
    next_command: next ? cloneJson(next) : null,
    blockers: arrayValue(blockers).map(cloneJson),
    missing_inputs: arrayValue(missing).map(text).filter(Boolean),
    scoped,
    executes_actions: false,
    mutates_source: false,
  };
}

export function classifyInspectionRecovery(envelope = {}) {
  const value = objectValue(envelope);
  const inspectionStatus = text(value.status);
  const next = objectValue(value.next_command || value.safe_next_command);
  const continuable = inspectionStatus === 'ready' && arrayValue(next.argv).length > 0;
  return {
    classification: continuable ? 'ready' : inspectionStatus || 'blocked',
    continuable,
    safe_next_descriptor_id: text(next.id),
    missing_artifact_paths: arrayValue(value.missing_artifact_paths || value.missing_inputs),
  };
}

export function buildGuideRecoverySummary(envelope = {}) {
  const value = objectValue(envelope);
  return summary({
    kind: 'guide',
    stage: value.current_stage,
    status: value.stage_status,
    why: value.why,
    next: value.safe_next_command,
    blockers: value.blockers,
    missing: value.missing_inputs,
  });
}

export function buildBundleRecoverySummary(envelope = {}) {
  const value = objectValue(envelope);
  return summary({
    kind: 'bundle',
    stage: value.guide_report?.current_stage || value.current_stage,
    status: value.guide_report?.stage_status || value.status,
    why: value.guide_report?.why || value.why,
    next: value.guide_report?.safe_next_command || value.next_recommended_command || value.safe_next_command,
    blockers: value.diagnostics,
    missing: value.guide_report?.missing_inputs || value.missing_inputs,
  });
}

export function buildInspectionRecoverySummary(envelope = {}) {
  const value = objectValue(envelope);
  return summary({
    kind: 'inspection',
    stage: value.guide_report?.current_stage || value.current_stage,
    status: value.status,
    why: value.why || value.diagnostics?.[0]?.message,
    next: value.next_command || value.safe_next_command,
    blockers: value.diagnostics,
    missing: value.missing_artifact_paths || value.missing_inputs,
  });
}

export function buildStatusRowRecoverySummary(row = {}) {
  const value = objectValue(row);
  return summary({
    kind: 'status_row',
    stage: value.guide_stage,
    status: value.status,
    why: value.why,
    next: value.next_command,
    blockers: value.diagnostics,
    missing: value.missing_saved_outputs,
  });
}

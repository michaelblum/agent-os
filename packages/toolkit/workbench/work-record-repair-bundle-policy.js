export const WORK_RECORD_REPAIR_BUNDLE_TYPE = 'work_record.repair_recovery_bundle';
export const WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION = '2026-07-work-record-repair-recovery-bundle-v0';
export const WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION = '2026-07-work-record-repair-bundle-v0';

export const WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE = 'work_record.repair_recovery_bundle_manifest';

export const WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE = 'work_record.repair_recovery_bundle_inspection';
export const WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION = '2026-07-work-record-repair-recovery-bundle-inspection-v0';

export const WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS = Object.freeze({
  mutates_record: false,
  writes_bundle: false,
  repairs_bundle: false,
  executes_repair: false,
  executes_actions: false,
  runs_recommended_commands: false,
  writes_replacement_record: false,
  writes_supersession_index_entry: false,
  mutates_source_record: false,
  uses_live_ui: false,
  uses_browser: false,
  uses_native_ax: false,
  uses_canvas: false,
  applies_patches: false,
  starts_workflow_engine: false,
  auto_resumes: false,
  automatic_replay_allowed: false,
});

export const WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS = Object.freeze(
  Object.keys(WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS),
);

export const WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_EXACT_OUTPUTS = Object.freeze([
  'reports/finalization-dry-run.json',
  'reports/supersession-lookup.json',
  'repair-attempt-artifact.json',
]);

export const WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_OUTPUT_DIRS = Object.freeze([
  'replacement-records',
  'source-supersession-index',
]);

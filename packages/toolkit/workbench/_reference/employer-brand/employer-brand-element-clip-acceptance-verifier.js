import fs from 'node:fs';
import path from 'node:path';

export const EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_TYPE = 'aos.employer_brand_element_clip_acceptance_report';
export const EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_SCHEMA_VERSION = '2026-05-employer-brand-element-clip-acceptance-report-v0';
export const EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_VERIFIER_VERSION = '2026-05-employer-brand-element-clip-acceptance-verifier-v0';

const NON_GOAL_FLAGS = [
  'new_captures',
  'live_browser_collection',
  'remote_web_collection',
  'pdf_capture_execution',
  'pptx_capture_execution',
  'report_renderer',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_engine',
  'full_page_grabs',
];

const TEXT_CAPTURE_TYPES = new Set(['element_text_extract', 'element_clip_and_text_extract']);
const CAPTURE_READY_STATES = new Set(['locator_ready']);
const RESULT_STATUSES = ['captured', 'blocked', 'failed', 'not_run'];

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveFixturePath(fixtureRoot, relativePath) {
  return path.join(fixtureRoot, relativePath);
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function check(name, passed, message = null, evidence = {}) {
  return {
    name,
    status: passed ? 'pass' : 'fail',
    message: passed ? null : message,
    evidence,
  };
}

function skipped(name, message = null, evidence = {}) {
  return {
    name,
    status: 'not_applicable',
    message,
    evidence,
  };
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function imageAssetEvidence(fixtureRoot, clipPath) {
  if (!clipPath) {
    return {
      exists: false,
      bytes: 0,
      dimensions: null,
    };
  }
  const absolutePath = resolveFixturePath(fixtureRoot, clipPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      exists: false,
      bytes: 0,
      dimensions: null,
    };
  }
  const buffer = fs.readFileSync(absolutePath);
  return {
    exists: true,
    bytes: buffer.length,
    dimensions: pngDimensions(buffer),
  };
}

function textExtractEvidence(fixtureRoot, textExtractPath) {
  if (!textExtractPath) {
    return {
      exists: false,
      bytes: 0,
      non_empty: false,
    };
  }
  const absolutePath = resolveFixturePath(fixtureRoot, textExtractPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      exists: false,
      bytes: 0,
      non_empty: false,
    };
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  return {
    exists: true,
    bytes: Buffer.byteLength(content),
    non_empty: text(content).length > 0,
  };
}

function statusCounts(results) {
  const counts = Object.fromEntries(RESULT_STATUSES.map((status) => [status, 0]));
  for (const result of results) counts[result.status] += 1;
  return counts;
}

function countManifestSlots(manifest) {
  const slots = arrayValue(manifest.planned_slots);
  return {
    captured: slots.filter((slot) => slot.acceptance_result?.status === 'captured').length,
    not_run: slots.filter((slot) => slot.acceptance_result?.status === 'not_run').length,
  };
}

function classifyUnit({ unit, manifest, clip, slot, unitChecks }) {
  if (clip && unitChecks.every((item) => item.status !== 'fail')) return 'captured';
  if (clip) return 'failed';
  if (!CAPTURE_READY_STATES.has(unit.readiness_state)) {
    return slot && unitChecks.every((item) => item.status !== 'fail') ? 'blocked' : 'failed';
  }
  if (manifest.controls?.contains_actual_captures === true) return 'failed';
  return 'not_run';
}

function verifyCapturedUnit({ fixtureRoot, unit, clip, slot }) {
  const checks = [];
  const requiresText = TEXT_CAPTURE_TYPES.has(unit.capture_type);
  const image = imageAssetEvidence(fixtureRoot, clip?.clip_path);
  const textExtract = textExtractEvidence(fixtureRoot, clip?.text_extract_path);

  checks.push(check('target_linkage', clip?.target_id === unit.target_id, 'clip target_id must match planning work unit', {
    expected: unit.target_id,
    actual: clip?.target_id || null,
  }));
  checks.push(check('work_unit_linkage', clip?.work_unit_id === unit.id && slot?.work_unit_id === unit.id, 'clip and planned slot must link to the planning work unit', {
    expected: unit.id,
    clip_work_unit_id: clip?.work_unit_id || null,
    slot_work_unit_id: slot?.work_unit_id || null,
  }));
  checks.push(check('source_metadata_preserved', sameJson(clip?.source_artifact, unit.source_artifact), 'clip source_artifact must preserve planning source metadata', {
    expected: unit.source_artifact,
    actual: clip?.source_artifact || null,
  }));
  checks.push(check('kilos_propagation', sameJson(clip?.kilos_relevance, unit.kilos_relevance), 'clip KILOS relevance must match planning work unit', {
    expected: unit.kilos_relevance,
    actual: clip?.kilos_relevance || null,
  }));
  checks.push(check('acceptance_criteria_references', sameJson(clip?.acceptance_result?.criteria, unit.acceptance_criteria), 'clip acceptance criteria must preserve planning criteria references', {
    expected_count: arrayValue(unit.acceptance_criteria).length,
    actual_count: arrayValue(clip?.acceptance_result?.criteria).length,
  }));
  checks.push(check('citation_metadata_preserved', Array.isArray(clip?.citation_refs), 'clip citation_refs must be preserved as an array', {
    citation_ref_count: arrayValue(clip?.citation_refs).length,
  }));
  checks.push(check('clip_asset_exists', image.exists, 'clip_path must point to an existing local asset', {
    path: clip?.clip_path || null,
  }));
  checks.push(check('clip_asset_non_empty', image.bytes > 0, 'clip asset must be non-empty', {
    path: clip?.clip_path || null,
    bytes: image.bytes,
  }));
  checks.push(check('image_dimensions_available', image.dimensions?.width > 0 && image.dimensions?.height > 0, 'clip asset must expose image dimensions', {
    dimensions: image.dimensions,
  }));
  checks.push(check('full_page_grab_false', clip?.capture_metadata?.full_page_grab === false, 'captured clip must not be a full-page grab', {
    full_page_grab: clip?.capture_metadata?.full_page_grab ?? null,
  }));
  checks.push(requiresText
    ? check('text_extract_present', Boolean(clip?.text_extract_path) && textExtract.exists && textExtract.non_empty && text(clip?.text_extract_content).length > 0, 'capture_type requires a non-empty text extract path, file, and manifest content', {
      path: clip?.text_extract_path || null,
      file_exists: textExtract.exists,
      file_bytes: textExtract.bytes,
      manifest_text_present: text(clip?.text_extract_content).length > 0,
    })
    : skipped('text_extract_present', 'capture_type does not require text extraction'));

  return checks;
}

function verifyBlockedUnit({ unit, slot }) {
  return [
    check('blocked_slot_preserved', Boolean(slot), 'blocked work unit must retain a planned slot', {
      work_unit_id: unit.id,
    }),
    check('blocked_slot_status', slot?.acceptance_result?.status === 'not_run', 'blocked planned slot must remain not_run in the clip manifest', {
      status: slot?.acceptance_result?.status || null,
    }),
    check('blocked_slot_has_no_clip_asset', !slot?.clip_path && !slot?.text_extract_path, 'blocked planned slot must not contain clip or text paths', {
      clip_path: slot?.clip_path || null,
      text_extract_path: slot?.text_extract_path || null,
    }),
    check('blocked_slot_kilos_preserved', sameJson(slot?.kilos_relevance, unit.kilos_relevance), 'blocked planned slot must preserve KILOS relevance', {
      expected: unit.kilos_relevance,
      actual: slot?.kilos_relevance || null,
    }),
    check('blocked_slot_acceptance_criteria_preserved', sameJson(slot?.acceptance_result?.criteria, unit.acceptance_criteria), 'blocked planned slot must preserve acceptance criteria references', {
      expected_count: arrayValue(unit.acceptance_criteria).length,
      actual_count: arrayValue(slot?.acceptance_result?.criteria).length,
    }),
  ];
}

function verifyNotRunReadyUnit({ unit, slot }) {
  return [
    check('planned_slot_preserved', Boolean(slot), 'not-run work unit must retain a planned slot', {
      work_unit_id: unit.id,
    }),
    check('planned_slot_has_no_clip_asset', !slot?.clip_path && !slot?.text_extract_path, 'not-run planned slot must not contain clip or text paths', {
      clip_path: slot?.clip_path || null,
      text_extract_path: slot?.text_extract_path || null,
    }),
  ];
}

function verifyWorkUnit({ fixtureRoot, planningBundle, manifest, unit, clipByWorkUnit, slotByWorkUnit }) {
  const clip = clipByWorkUnit.get(unit.id) || null;
  const slot = slotByWorkUnit.get(unit.id) || null;
  const checks = [];

  checks.push(check('target_work_unit_linkage', arrayValue(planningBundle.work_units).some((candidate) => candidate.id === unit.id && candidate.target_id === unit.target_id), 'work unit must be present in planning bundle', {
    target_id: unit.target_id,
    work_unit_id: unit.id,
  }));

  if (clip) {
    checks.push(...verifyCapturedUnit({ fixtureRoot, unit, clip, slot }));
  } else if (!CAPTURE_READY_STATES.has(unit.readiness_state)) {
    checks.push(...verifyBlockedUnit({ unit, slot }));
  } else {
    checks.push(...verifyNotRunReadyUnit({ unit, slot }));
  }

  const status = classifyUnit({ unit, manifest, clip, slot, unitChecks: checks });
  return {
    work_unit_id: unit.id,
    target_id: unit.target_id,
    source_artifact_id: unit.source_artifact?.id || null,
    source_artifact_kind: unit.source_artifact?.kind || null,
    company_ref_id: unit.company_ref?.company_ref_id || null,
    capture_type: unit.capture_type,
    readiness_state: unit.readiness_state,
    status,
    clip_path: clip?.clip_path || null,
    text_extract_path: clip?.text_extract_path || null,
    blockers: cloneJson(arrayValue(unit.blockers)),
    kilos_relevance: cloneJson(arrayValue(unit.kilos_relevance)),
    acceptance_criteria: cloneJson(arrayValue(unit.acceptance_criteria)),
    checks,
  };
}

export function buildEmployerBrandElementClipAcceptanceReport({
  planningBundle,
  clipManifest,
  plannedClipManifest = null,
  comparativeAuditDataBundle = null,
  fixtureRoot,
  createdAt = null,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  const planning = objectValue(planningBundle);
  const manifest = objectValue(clipManifest);
  const plannedManifest = plannedClipManifest ? objectValue(plannedClipManifest) : null;
  const dataBundle = comparativeAuditDataBundle ? objectValue(comparativeAuditDataBundle) : null;
  const clipByWorkUnit = new Map(arrayValue(manifest.clips).map((clip) => [clip.work_unit_id, clip]));
  const slotByWorkUnit = new Map(arrayValue(manifest.planned_slots).map((slot) => [slot.work_unit_id, slot]));
  const results = arrayValue(planning.work_units).map((unit) => verifyWorkUnit({
    fixtureRoot,
    planningBundle: planning,
    manifest,
    unit,
    clipByWorkUnit,
    slotByWorkUnit,
  }));
  const counts = statusCounts(results);
  const manifestSlotCounts = countManifestSlots(manifest);
  const manifestCountChecks = [
    check('work_unit_count_reconciled', arrayValue(manifest.planned_slots).length === planning.expansion?.work_unit_count, 'manifest planned slots must match planning work unit count', {
      expected: planning.expansion?.work_unit_count ?? null,
      actual: arrayValue(manifest.planned_slots).length,
    }),
    check('captured_count_reconciled', arrayValue(manifest.clips).length === manifest.expected?.captured_work_unit_count && counts.captured === manifest.expected?.captured_work_unit_count, 'captured counts must reconcile between manifest and verifier results', {
      manifest_clip_count: arrayValue(manifest.clips).length,
      manifest_expected_captured_count: manifest.expected?.captured_work_unit_count ?? null,
      verifier_captured_count: counts.captured,
    }),
    check('blocked_count_reconciled', counts.blocked === manifest.expected?.blocked_work_unit_count, 'blocked counts must reconcile between manifest and verifier results', {
      manifest_expected_blocked_count: manifest.expected?.blocked_work_unit_count ?? null,
      verifier_blocked_count: counts.blocked,
      manifest_not_run_slots: manifestSlotCounts.not_run,
    }),
    check('planned_manifest_slot_count_preserved', !plannedManifest || arrayValue(plannedManifest.planned_slots).length === arrayValue(manifest.planned_slots).length, 'populated manifest must preserve planned manifest slot count', {
      planned_manifest_slot_count: plannedManifest ? arrayValue(plannedManifest.planned_slots).length : null,
      populated_manifest_slot_count: arrayValue(manifest.planned_slots).length,
    }),
  ];
  const globalFailures = manifestCountChecks.filter((item) => item.status === 'fail').length;
  const failedCount = counts.failed + globalFailures;
  const accepted = failedCount === 0 && counts.not_run === 0;

  return {
    type: EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_TYPE,
    schema_version: EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_SCHEMA_VERSION,
    id: `element-clip-acceptance-report:${manifest.id || 'fixture'}`,
    label: 'Employer Brand Element Clip Acceptance Verification V0',
    status: accepted ? 'accepted_with_blockers' : 'not_accepted',
    inputs: {
      planning_bundle_path: 'source-artifacts/element-capture-planning-bundle.json',
      planning_bundle_schema: 'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
      clip_manifest_path: 'source-artifacts/element-clip-manifest.json',
      clip_manifest_schema: 'shared/schemas/employer-brand-element-clip-manifest-v0.schema.json',
      planned_clip_manifest_path: 'source-artifacts/element-clip-manifest.planned.json',
      comparative_audit_data_bundle_path: dataBundle ? 'data-bundle.json' : null,
      comparative_audit_data_bundle_id: dataBundle?.id || null,
    },
    summary: {
      target_count: planning.source_plan?.target_count ?? 0,
      work_unit_count: planning.expansion?.work_unit_count ?? 0,
      expected_clip_count: planning.expansion?.expected_clip_count ?? 0,
      captured_count: counts.captured,
      blocked_count: counts.blocked,
      failed_count: failedCount,
      not_run_count: counts.not_run,
      total_result_count: results.length,
      accepted,
      manifest_count_checks_passed: manifestCountChecks.every((item) => item.status === 'pass'),
    },
    controls: {
      read_only: true,
      verifier_only: true,
      capture_execution_authorized: false,
      live_browser_collection_authorized: false,
      remote_web_collection_authorized: false,
      pdf_capture_execution_authorized: false,
      pptx_capture_execution_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
    },
    non_goal_flags: cloneJson(NON_GOAL_FLAGS),
    manifest_count_checks: manifestCountChecks,
    results,
    provenance: {
      created_at: createdAt,
      verifier: EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_VERIFIER_VERSION,
      read_only: true,
      local_fixture_evidence_only: true,
      no_capture_performed: true,
      no_report_rendering_performed: true,
      non_goals: cloneJson(NON_GOAL_FLAGS),
    },
  };
}

export function loadEmployerBrandElementClipAcceptanceReport({
  fixtureRoot,
  createdAt = null,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return buildEmployerBrandElementClipAcceptanceReport({
    planningBundle: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/element-capture-planning-bundle.json')),
    clipManifest: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/element-clip-manifest.json')),
    plannedClipManifest: readJson(resolveFixturePath(fixtureRoot, 'source-artifacts/element-clip-manifest.planned.json')),
    comparativeAuditDataBundle: fs.existsSync(resolveFixturePath(fixtureRoot, 'data-bundle.json'))
      ? readJson(resolveFixturePath(fixtureRoot, 'data-bundle.json'))
      : null,
    fixtureRoot,
    createdAt,
  });
}

export function validateEmployerBrandElementClipAcceptanceReport(report = {}) {
  const errors = [];
  if (report.type !== EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_TYPE) errors.push('type must identify an Employer Brand Element Clip Acceptance Report');
  if (report.schema_version !== EMPLOYER_BRAND_ELEMENT_CLIP_ACCEPTANCE_REPORT_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (report.controls?.capture_execution_authorized !== false) errors.push('capture execution must remain unauthorized');
  if (report.controls?.live_browser_collection_authorized !== false) errors.push('live browser collection must remain unauthorized');
  if (report.controls?.pdf_capture_execution_authorized !== false) errors.push('PDF capture execution must remain unauthorized');
  if (report.controls?.pptx_capture_execution_authorized !== false) errors.push('PPTX capture execution must remain unauthorized');
  if (report.controls?.report_renderer_authorized !== false) errors.push('report rendering must remain unauthorized');
  if (report.controls?.full_page_grabs_authorized !== false) errors.push('full-page grabs must remain unauthorized');
  if (report.summary?.total_result_count !== arrayValue(report.results).length) errors.push('summary total_result_count must equal results length');
  if (report.summary?.failed_count === 0 && report.status !== 'accepted_with_blockers') errors.push('zero-failure reports must be accepted_with_blockers');
  if (arrayValue(report.results).some((result) => !RESULT_STATUSES.includes(result.status))) errors.push('result statuses must be captured, blocked, failed, or not_run');
  return {
    valid: errors.length === 0,
    errors,
  };
}

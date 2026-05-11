import fs from 'node:fs';
import path from 'node:path';

export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_TYPE =
  'aos.employer_brand_live_evidence_capture_failure_review_pack';
export const EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_SCHEMA_VERSION =
  '2026-05-employer-brand-live-evidence-capture-failure-review-pack-v0';

const REPAIR_FIELDS = {
  proposed_selector: null,
  proposed_xpath: null,
  proposed_playwright_locator: null,
  refined_natural_language_target: null,
  replacement_url: null,
  repair_decision: null,
  repair_notes: null,
  reviewed_by: null,
};

const NON_GOALS = [
  'url_opening',
  'browser_codegen',
  'locator_resolution',
  'selector_invention',
  'xpath_invention',
  'playwright_locator_invention',
  'screenshot_capture',
  'clip_generation',
  'text_extraction',
  'login_bypass',
  'paywall_bypass',
  'captcha_bypass',
  'consent_bypass',
  'report_rendering',
  'html_css_polish',
  'pdf_export',
  'docx_export',
  'workflow_execution',
  'target_broadening',
];

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function optionalText(value) {
  const normalized = text(value);
  return normalized || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupCounts(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? null;
    const countKey = value === null ? 'null' : value;
    counts[countKey] = (counts[countKey] || 0) + 1;
    return counts;
  }, {});
}

function loadJson(fixtureRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

function targetDetailsFrom(entry, reviewedLocatorReadiness, reviewedTargetPlan) {
  const readinessTarget = arrayValue(reviewedLocatorReadiness.targets)
    .find((target) => target.target_id === entry.target_id);
  const reviewedTarget = arrayValue(reviewedTargetPlan.targets)
    .find((target) => target.target_id === entry.target_id);
  const citation = objectValue(entry.citation_source_metadata);

  return {
    natural_language_target: optionalText(
      citation.desired_element
        ?? readinessTarget?.desired_element_summary
        ?? reviewedTarget?.desired_element
        ?? reviewedTarget?.target_element,
    ),
    evidence_goal: optionalText(citation.evidence_goal ?? reviewedTarget?.evidence_goal),
    kilos_relevance: cloneJson(arrayValue(entry.kilos_relevance?.length ? entry.kilos_relevance : readinessTarget?.kilos_relevance)),
    expected_clip_count: Number(readinessTarget?.expected_clip_count ?? reviewedTarget?.expected_clip_count ?? 0),
    page_name: optionalText(citation.page_name ?? reviewedTarget?.page_name),
    acceptance_criteria: cloneJson(arrayValue(reviewedTarget?.acceptance_criteria)),
  };
}

function failureClassification(reason) {
  if (reason === 'reviewed_locator_matches_zero_elements') {
    return {
      blocker_class: 'zero_match_locator_failure',
      recommended_next_action: 'needs_operator_locator_repair',
    };
  }
  if (reason === 'login_required') {
    return {
      blocker_class: 'login_or_sign_in_blocker',
      recommended_next_action: 'needs_human_source_decision',
    };
  }
  return {
    blocker_class: 'other_capture_failure',
    recommended_next_action: 'needs_human_failure_triage',
  };
}

function failureItemFromEntry(entry, index, inputs) {
  const details = targetDetailsFrom(entry, inputs.reviewedLocatorReadiness, inputs.reviewedTargetPlan);
  const classification = failureClassification(entry.blocker_reason);
  const captureMetadata = objectValue(entry.capture_metadata);
  return {
    failure_id: `live-evidence-capture-failure:${index + 1}`,
    slot_id: entry.slot_id,
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    company_role: entry.company_role,
    source_category: entry.source_category,
    original_url: entry.original_url,
    final_url: entry.final_url,
    status: entry.status,
    blocker_reason: entry.blocker_reason,
    blocker_class: classification.blocker_class,
    recommended_next_action: classification.recommended_next_action,
    operator_outcome_notes: {
      required_next_action: optionalText(entry.required_next_action),
      operator_visual_review: captureMetadata.operator_visual_review
        ? cloneJson(captureMetadata.operator_visual_review)
        : null,
      title: optionalText(captureMetadata.title),
      current_url: optionalText(captureMetadata.current_url),
      match_count: captureMetadata.match_count ?? null,
      frame_count: captureMetadata.frame_count ?? null,
      total_frame_match_count: captureMetadata.total_frame_match_count ?? null,
    },
    target_context: details,
    reviewed_locator: cloneJson(objectValue(entry.reviewed_locator)),
    locator_provenance: entry.locator_provenance ? cloneJson(entry.locator_provenance) : null,
    url_open_provenance: {
      source_url_open_run_path: 'live-evidence-url-open-run.json',
      status: inputs.urlOpenRun.status,
      final_url: entry.final_url,
      read_only: true,
    },
    citation_source_metadata: entry.citation_source_metadata ? cloneJson(entry.citation_source_metadata) : null,
    capture_metadata: cloneJson(captureMetadata),
    acceptance_checks: cloneJson(arrayValue(entry.acceptance_checks)),
    full_page_grab: entry.full_page_grab === true,
    repair: cloneJson(REPAIR_FIELDS),
    provenance: cloneJson(objectValue(entry.provenance)),
  };
}

function contextItemFromEntry(entry) {
  return {
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    company_role: entry.company_role,
    source_category: entry.source_category,
    original_url: entry.original_url,
    final_url: entry.final_url,
    status: entry.status,
    blocker_reason: entry.blocker_reason,
    required_next_action: entry.required_next_action,
    full_page_grab: entry.full_page_grab === true,
    actionable_repair_item: false,
    provenance: cloneJson(objectValue(entry.provenance)),
  };
}

function groupFailures(failures) {
  const groups = new Map();
  for (const failure of failures) {
    const key = failure.work_unit_id;
    if (!groups.has(key)) {
      groups.set(key, {
        work_unit_id: failure.work_unit_id,
        target_id: failure.target_id,
        company: failure.company,
        company_role: failure.company_role,
        source_category: failure.source_category,
        failure_count: 0,
        slot_ids: [],
        blocker_classes: [],
        failures: [],
      });
    }
    const group = groups.get(key);
    group.failure_count += 1;
    group.slot_ids.push(failure.slot_id);
    group.blocker_classes = unique([...group.blocker_classes, failure.blocker_class]);
    group.failures.push(failure);
  }
  return [...groups.values()];
}

export function buildEmployerBrandLiveEvidenceCaptureFailureReviewPack(inputs = {}, {
  createdAt = null,
} = {}) {
  const manifest = objectValue(inputs.manifest);
  const entries = arrayValue(manifest.entries);
  const failedEntries = entries.filter((entry) => entry.status === 'failed');
  const contextEntries = entries.filter((entry) => entry.status !== 'failed');
  const failures = failedEntries.map((entry, index) => failureItemFromEntry(entry, index, inputs));
  const context = contextEntries.map(contextItemFromEntry);

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_SCHEMA_VERSION,
    id: 'live-evidence-capture-failure-review-pack:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Live Evidence Capture Failure Review Pack',
    status: 'repair_queue_ready',
    source_refs: {
      manifest_path: 'source-artifacts/live-evidence-element-clip-manifest.json',
      reviewed_locator_capture_plan_path: 'live-evidence-reviewed-locator-capture-plan.json',
      reviewed_locator_readiness_path: 'live-evidence-locator-readiness.reviewed.json',
      human_locator_approval_patch_path: 'live-evidence-human-locator-approval-patch.json',
      url_open_run_path: 'live-evidence-url-open-run.json',
      reviewed_target_plan_path: 'live-evidence-target-plan.reviewed.json',
      data_bundle_path: 'data-bundle.json',
      read_only: true,
    },
    summary: {
      executable_unit_count: manifest.summary?.executable_unit_count ?? null,
      planned_output_slot_count: manifest.summary?.planned_output_slot_count ?? null,
      accepted_capture_count: manifest.summary?.captured_slot_count ?? 0,
      failed_executable_slot_count: failures.length,
      non_executable_context_count: context.length,
      full_page_grab_count: manifest.summary?.full_page_grab_count ?? null,
      zero_match_locator_failure_count: failures.filter((failure) => failure.blocker_class === 'zero_match_locator_failure').length,
      login_or_sign_in_blocker_count: failures.filter((failure) => failure.blocker_class === 'login_or_sign_in_blocker').length,
      blocker_reason_counts: groupCounts(failures, 'blocker_reason'),
      blocker_class_counts: groupCounts(failures, 'blocker_class'),
      recommended_next_action_counts: groupCounts(failures, 'recommended_next_action'),
    },
    repair_queue: {
      actionable_failure_count: failures.length,
      groups: groupFailures(failures),
    },
    non_executable_context: context,
    controls: {
      full_page_grab: false,
      open_urls: false,
      run_browser_codegen: false,
      run_locator_resolution: false,
      invent_repair_locators: false,
      bypass_login_or_access_controls: false,
      render_reports: false,
      export_documents: false,
      execute_workflow: false,
    },
    provenance: {
      created_at: createdAt,
      deterministic_from_local_inputs: true,
      repair_fields_initialized_null: true,
      read_only: true,
      no_urls_opened: true,
      no_browser_codegen_run: true,
      no_locator_resolution_run: true,
      no_selectors_invented: true,
      non_goals: cloneJson(NON_GOALS),
    },
  };
}

export function normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(packInput = {}) {
  const pack = objectValue(packInput);
  const groups = arrayValue(pack.repair_queue?.groups).map((groupInput) => {
    const group = objectValue(groupInput);
    const failures = arrayValue(group.failures).map((failure) => ({
      ...cloneJson(objectValue(failure)),
      repair: {
        ...cloneJson(REPAIR_FIELDS),
        ...cloneJson(objectValue(failure.repair)),
      },
    }));
    return {
      ...cloneJson(group),
      failure_count: Number(group.failure_count ?? failures.length),
      slot_ids: cloneJson(arrayValue(group.slot_ids)),
      blocker_classes: cloneJson(arrayValue(group.blocker_classes)),
      failures,
    };
  });
  const failures = groups.flatMap((group) => group.failures);
  const context = arrayValue(pack.non_executable_context).map((entry) => cloneJson(objectValue(entry)));
  return {
    ...cloneJson(pack),
    repair_queue: {
      actionable_failure_count: failures.length,
      groups,
    },
    failures,
    non_executable_context: context,
    summary: {
      ...cloneJson(objectValue(pack.summary)),
      accepted_capture_count: Number(pack.summary?.accepted_capture_count ?? 0),
      failed_executable_slot_count: failures.length,
      non_executable_context_count: context.length,
      zero_match_locator_failure_count: failures.filter((failure) => failure.blocker_class === 'zero_match_locator_failure').length,
      login_or_sign_in_blocker_count: failures.filter((failure) => failure.blocker_class === 'login_or_sign_in_blocker').length,
      blocker_reason_counts: groupCounts(failures, 'blocker_reason'),
      blocker_class_counts: groupCounts(failures, 'blocker_class'),
      recommended_next_action_counts: groupCounts(failures, 'recommended_next_action'),
    },
  };
}

export function validateEmployerBrandLiveEvidenceCaptureFailureReviewPack(packInput = {}) {
  const errors = [];
  const pack = objectValue(packInput);
  const normalized = normalizeEmployerBrandLiveEvidenceCaptureFailureReviewPack(pack);
  if (pack.type !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_TYPE) errors.push('type must identify a capture failure review pack');
  if (pack.schema_version !== EMPLOYER_BRAND_LIVE_EVIDENCE_CAPTURE_FAILURE_REVIEW_PACK_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (normalized.summary.accepted_capture_count !== 0) errors.push('accepted capture count must remain 0');
  if (normalized.summary.failed_executable_slot_count !== 5) errors.push('failed executable slot count must be 5');
  if (normalized.summary.non_executable_context_count !== 14) errors.push('non-executable context count must be 14');
  if (normalized.summary.full_page_grab_count !== 0) errors.push('full_page_grab_count must be 0');
  if (normalized.summary.zero_match_locator_failure_count !== 4) errors.push('zero-match locator failure count must be 4');
  if (normalized.summary.login_or_sign_in_blocker_count !== 1) errors.push('login/sign-in blocker count must be 1');
  if (normalized.repair_queue.actionable_failure_count !== normalized.failures.length) errors.push('repair queue count must match failures');
  for (const [key, value] of Object.entries(objectValue(pack.controls))) {
    if (value !== false) errors.push(`controls.${key} must remain false`);
  }
  for (const failure of normalized.failures) {
    if (failure.full_page_grab !== false) errors.push(`${failure.slot_id} full_page_grab must remain false`);
    for (const [key, value] of Object.entries(failure.repair)) {
      if (value !== null) errors.push(`${failure.slot_id} repair.${key} must remain null`);
    }
    if (failure.blocker_reason === 'reviewed_locator_matches_zero_elements' && failure.recommended_next_action !== 'needs_operator_locator_repair') {
      errors.push(`${failure.slot_id} zero-match failure has wrong next action`);
    }
    if (failure.blocker_reason === 'login_required' && failure.recommended_next_action !== 'needs_human_source_decision') {
      errors.push(`${failure.slot_id} login failure has wrong next action`);
    }
  }
  for (const entry of normalized.non_executable_context) {
    if (entry.actionable_repair_item !== false) errors.push(`${entry.target_id} context must not be actionable`);
    if (entry.full_page_grab !== false) errors.push(`${entry.target_id} context full_page_grab must remain false`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadEmployerBrandLiveEvidenceCaptureFailureReviewPack({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return loadJson(fixtureRoot, 'live-evidence-capture-failure-review-pack.json');
}

export function loadEmployerBrandLiveEvidenceCaptureFailureReviewPackInputs({
  fixtureRoot,
} = {}) {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  return {
    manifest: loadJson(fixtureRoot, 'source-artifacts/live-evidence-element-clip-manifest.json'),
    reviewedLocatorCapturePlan: loadJson(fixtureRoot, 'live-evidence-reviewed-locator-capture-plan.json'),
    reviewedLocatorReadiness: loadJson(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json'),
    humanLocatorApprovalPatch: loadJson(fixtureRoot, 'live-evidence-human-locator-approval-patch.json'),
    urlOpenRun: loadJson(fixtureRoot, 'live-evidence-url-open-run.json'),
    reviewedTargetPlan: loadJson(fixtureRoot, 'live-evidence-target-plan.reviewed.json'),
    dataBundle: loadJson(fixtureRoot, 'data-bundle.json'),
  };
}

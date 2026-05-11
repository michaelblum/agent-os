import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandComparativeAuditDataBundle,
  loadEmployerBrandComparativeAuditDataBundleInputs,
  normalizeEmployerBrandComparativeAuditDataBundle,
  validateEmployerBrandComparativeAuditDataBundle,
} from '../../packages/toolkit/workbench/employer-brand-comparative-audit-data-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(
  repoRoot,
  'shared/schemas/employer-brand-comparative-audit-data-bundle-v0.schema.json',
);
const bundlePath = path.join(fixtureRoot, 'data-bundle.json');

function validateSchema(schema, instance) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      schema,
      instance,
    ],
    { encoding: 'utf8' },
  );
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addFourthCompany(inputs) {
  const next = clone(inputs);
  const acmeRequestId = 'acme_careers_site_planning';
  const phenomAudit = next.companyAudits.find((audit) => audit.company.name === 'Phenom');
  const acmeAudit = clone(phenomAudit);

  acmeAudit.id = 'company-brand-audit:acme-talent';
  acmeAudit.company.name = 'Acme Talent';
  acmeAudit.company.role = 'competitor';
  acmeAudit.provenance.browser_evidence_request_ids = [acmeRequestId];
  acmeAudit.provenance.screenshot_paths = ['screenshots/acme/acme-fixture-culture-card.png'];
  for (const row of [
    ...acmeAudit.source_coverage_summary,
    ...acmeAudit.kilos_analysis,
    ...acmeAudit.messaging_themes,
    acmeAudit.brand_voice_and_tone,
    ...acmeAudit.visual_identity_notes,
    ...acmeAudit.differentiators,
    ...acmeAudit.generic_messaging_or_weak_spots,
    ...acmeAudit.evidence_backed_claims,
  ]) {
    row.request_ids = row.request_ids?.length ? [acmeRequestId] : [];
  }
  acmeAudit.cited_evidence = [{
    request_id: acmeRequestId,
    company: 'Acme Talent',
    source_category: 'careers_site',
    source_url: 'html/acme-careers.html',
    screenshot_path: 'screenshots/acme/acme-fixture-culture-card.png',
    status: 'captured',
    captured_at: '2026-05-07T15:11:04Z',
    extracted_text_excerpt: 'Acme Talent fixture evidence.',
  }];

  next.project.intake.competitor_companies.push({
    name: 'Acme Talent',
    role: 'competitor',
    website_url: 'https://example.com/acme-talent',
    notes: 'Synthetic fourth company for arbitrary-n normalizer coverage.',
  });
  next.sources.sources.push({
    id: 'source:acme-talent-homepage',
    company: 'Acme Talent',
    role: 'competitor',
    url: 'https://example.com/acme-talent',
    evidence_kind: 'public_homepage_reference',
    collection_status: 'not_collected_in_fixture',
    fixture_signal: 'Kinship',
    notes: 'Synthetic source for arbitrary-n normalizer coverage.',
  });
  next.browserEvidenceRegistry.evidence.push({
    ...clone(next.browserEvidenceRegistry.evidence.find((row) => row.company === 'Phenom')),
    request_id: acmeRequestId,
    company: 'Acme Talent',
    source_url: 'html/acme-careers.html',
    url: 'html/acme-careers.html',
    screenshot_path: 'screenshots/acme/acme-fixture-culture-card.png',
    captured_at: '2026-05-07T15:11:04Z',
  });
  next.browserEvidenceRegistry.summary.request_count += 1;
  next.browserEvidenceRegistry.summary.captured_count += 1;
  next.browserEvidenceRegistry.summary.by_status.captured += 1;
  next.companyAuditPaths.push('company-audits/acme-talent.json');
  next.companyAudits.push(acmeAudit);

  const comparative = next.comparativeAudits[0];
  comparative.companies.push({
    name: 'Acme Talent',
    role: 'competitor',
    company_audit_id: acmeAudit.id,
  });
  comparative.source_company_audits.push({
    id: acmeAudit.id,
    company: 'Acme Talent',
    role: 'competitor',
    path: 'company-audits/acme-talent.json',
    request_ids: [acmeRequestId],
  });
  comparative.provenance.derived_from_company_audit_ids.push(acmeAudit.id);
  comparative.citations.push({
    company_audit_id: acmeAudit.id,
    company: 'Acme Talent',
    role: 'competitor',
    request_ids: [acmeRequestId],
  });
  comparative.comparative_synthesis.company_audit_ids.push(acmeAudit.id);
  comparative.comparative_synthesis.request_ids.push(acmeRequestId);
  for (const row of comparative.kilos_positioning_matrix) {
    row.company_audit_ids.push(acmeAudit.id);
    row.request_ids.push(acmeRequestId);
  }

  return next;
}

test('Employer Brand Comparative Audit Data Bundle fixture validates and is generator-stable', async () => {
  const schemaValidation = validateSchema(schemaPath, bundlePath);
  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-data-bundle-'));
  const out = path.join(tmp, 'data-bundle.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-comparative-audit-data-bundle.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(bundlePath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand Comparative Audit Data Bundle normalizes fixture inputs with target counts, KILOS, citations, coverage, and controls', async () => {
  const bundle = loadEmployerBrandComparativeAuditDataBundle({
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandComparativeAuditDataBundle(bundle);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(bundle.project.company_count, 3);
  assert.deepEqual(bundle.companies.map((company) => company.name), ['Symphony Talent', 'Phenom', 'Radancy']);
  assert.deepEqual(bundle.kilos.dimensions.map((row) => row.dimension), [
    'kinship',
    'impact',
    'lifestyle',
    'opportunity',
    'status',
  ]);
  assert.ok(bundle.kilos.dimensions.every((row) => row.companies.length === 3));
  assert.equal(bundle.source_artifact_targets.target_count, 13);
  assert.equal(bundle.source_artifact_targets.target_ids.length, 13);
  assert.equal(bundle.source_artifact_targets.expected_clip_count, 44);
  assert.equal(bundle.live_evidence_targets.target_plan_path, 'live-evidence-target-plan.json');
  assert.equal(bundle.live_evidence_targets.target_plan_schema, 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.review_pack_path, 'live-evidence-target-review-pack.json');
  assert.equal(bundle.live_evidence_targets.review_pack_schema, 'shared/schemas/employer-brand-live-evidence-target-review-pack-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.review_pack_status, 'human_review_required');
  assert.equal(bundle.live_evidence_targets.approval_patch_path, 'live-evidence-target-approval-patch.json');
  assert.equal(bundle.live_evidence_targets.approval_patch_schema, 'shared/schemas/employer-brand-live-evidence-target-approval-patch-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.reviewed_target_plan_path, 'live-evidence-reviewed-target-plan.json');
  assert.equal(bundle.live_evidence_targets.reviewed_target_plan_schema, 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.locator_readiness_path, 'live-evidence-locator-readiness.json');
  assert.equal(bundle.live_evidence_targets.locator_readiness_schema, 'shared/schemas/employer-brand-live-evidence-locator-readiness-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_schema, 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_status, 'operator_plan_ready_with_blocked_entries');
  assert.equal(bundle.live_evidence_targets.url_open_run_path, 'live-evidence-url-open-run.json');
  assert.equal(bundle.live_evidence_targets.url_open_run_status, 'completed_with_blockers');
  assert.equal(bundle.live_evidence_targets.url_open_run_summary.opened_count, 16);
  assert.equal(bundle.live_evidence_targets.url_open_run_summary.reachable_count, 5);
  assert.equal(bundle.live_evidence_targets.url_open_run_summary.redirected_count, 2);
  assert.equal(bundle.live_evidence_targets.url_open_run_summary.network_error_count, 9);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(bundle.live_evidence_targets.url_reachability_check_schema, 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.url_reachability_check_status, 'checked_with_blockers');
  assert.equal(bundle.live_evidence_targets.locator_resolution_result_path, 'live-evidence-locator-resolution-result.json');
  assert.equal(bundle.live_evidence_targets.locator_resolution_result_schema, 'shared/schemas/employer-brand-live-evidence-locator-resolution-result-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.locator_resolution_result_status, 'completed_with_blockers');
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_schema, 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_status, 'human_locator_review_required');
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_path, 'live-evidence-human-locator-approval-patch.json');
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_path, 'live-evidence-locator-readiness.reviewed.json');
  assert.equal(bundle.live_evidence_targets.target_count, 21);
  assert.equal(bundle.live_evidence_targets.expected_clip_count, 21);
  assert.equal(bundle.live_evidence_targets.reviewed_target_count, 18);
  assert.equal(bundle.live_evidence_targets.reviewed_expected_clip_count, 19);
  assert.equal(bundle.live_evidence_targets.reviewed_approved_count, 16);
  assert.equal(bundle.live_evidence_targets.reviewed_draft_count, 2);
  assert.equal(bundle.live_evidence_targets.reviewed_rejected_count, 3);
  assert.equal(bundle.live_evidence_targets.readiness_summary.needs_locator_count, 16);
  assert.equal(bundle.live_evidence_targets.readiness_summary.needs_human_target_review_count, 2);
  assert.equal(bundle.live_evidence_targets.readiness_summary.url_not_checked_count, 0);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.readiness_input_count, 18);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.executable_locator_unit_count, 16);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.blocked_non_executable_count, 2);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.expected_clip_count_for_executable_units, 17);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.locator_ready_count, 0);
  assert.equal(bundle.live_evidence_targets.supervised_locator_plan_summary.url_checks_performed, false);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.executable_target_count, 16);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.checked_count, 16);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.reachable_count, 5);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.redirected_count, 2);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.network_error_count, 9);
  assert.equal(bundle.live_evidence_targets.url_reachability_check_summary.blocked_count, 2);
  assert.equal(bundle.live_evidence_targets.locator_resolution_summary.attempted_count, 7);
  assert.equal(bundle.live_evidence_targets.locator_resolution_summary.locator_ready_count, 0);
  assert.equal(bundle.live_evidence_targets.locator_resolution_summary.needs_human_locator_review_count, 2);
  assert.equal(bundle.live_evidence_targets.locator_resolution_summary.eligible_target_count, 7);
  assert.equal(bundle.live_evidence_targets.locator_resolution_summary.rejected_exclusion_count, 3);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_summary.review_item_count, 9);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_summary.ambiguous_locator_attempt_count, 7);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_summary.needs_human_target_review_count, 2);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_summary.unconfirmed_candidate_count, 7);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_summary.locator_ready_count, 0);
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_summary.locator_ready_decision_count, 4);
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_summary.blocked_count, 1);
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_summary.rejected_count, 1);
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_summary.expected_ready_clip_count, 5);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_summary.locator_ready_count, 4);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_summary.needs_locator_count, 11);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_summary.needs_human_locator_review_count, 1);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_summary.expected_ready_clip_count, 5);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_schema, 'shared/schemas/employer-brand-live-evidence-reviewed-locator-capture-plan-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_summary.executable_unit_count, 4);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_summary.expected_ready_clip_count, 5);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_summary.planned_output_slot_count, 5);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_summary.non_executable_context_count, 14);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_capture_plan_no_capture_assets_produced, true);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_schema, 'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_status, 'repair_queue_ready');
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_summary.accepted_capture_count, 0);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_summary.failed_executable_slot_count, 5);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_summary.non_executable_context_count, 14);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_summary.zero_match_locator_failure_count, 4);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_summary.login_or_sign_in_blocker_count, 1);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_read_only, true);
  assert.equal(bundle.live_evidence_targets.capture_failure_review_pack_no_repairs_fabricated, true);
  assert.equal(bundle.inputs.live_evidence_capture_repair_patch_path, 'live-evidence-capture-repair-patch.json');
  assert.equal(bundle.inputs.live_evidence_capture_repair_promotion_path, 'live-evidence-capture-repair-promotion.json');
  assert.equal(bundle.inputs.live_evidence_repaired_locator_capture_plan_path, 'live-evidence-repaired-locator-capture-plan.json');
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_path, 'live-evidence-capture-repair-patch.json');
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_schema, 'shared/schemas/employer-brand-live-evidence-capture-repair-patch-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_status, 'repair_reviewed');
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_summary.patchable_repair_item_count, 5);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_summary.read_only_context_entry_count, 14);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_summary.filled_repair_decision_count, 5);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_summary.proposed_locator_count, 4);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_summary.all_repair_fields_null, false);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_template_only, true);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_no_unapproved_repairs, true);
  assert.equal(bundle.live_evidence_targets.capture_repair_patch_read_only_context_count, 14);
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_path, 'live-evidence-capture-repair-promotion.json');
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_schema, 'shared/schemas/employer-brand-live-evidence-capture-repair-promotion-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_summary.repaired_executable_slot_count, 4);
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_summary.unavailable_source_slot_count, 1);
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_summary.promoted_capture_count, 0);
  assert.equal(bundle.live_evidence_targets.capture_repair_promotion_no_capture_assets_produced, true);
  assert.equal(bundle.live_evidence_targets.repaired_locator_capture_plan_path, 'live-evidence-repaired-locator-capture-plan.json');
  assert.equal(bundle.live_evidence_targets.repaired_locator_capture_plan_schema, 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.repaired_locator_capture_plan_summary.repaired_executable_slot_count, 4);
  assert.equal(bundle.live_evidence_targets.repaired_locator_capture_plan_summary.unavailable_source_slot_count, 1);
  assert.equal(bundle.live_evidence_targets.repaired_locator_capture_plan_summary.actual_capture_file_count, 0);
  assert.equal(bundle.inputs.live_evidence_repaired_capture_runtime_diagnostics_path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_schema, 'shared/schemas/employer-brand-repaired-capture-runtime-diagnostics-v0.schema.json');
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_status, 'non_runtime_capture_blockers_detected');
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_summary.runtime_capture_invocation_failure_count, 0);
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_summary.locator_failure_count, 4);
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_summary.accepted_capture_count, 0);
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_summary.actual_capture_file_count, 0);
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_read_only, true);
  assert.equal(bundle.live_evidence_targets.repaired_capture_runtime_diagnostics_retry_after_runtime_repair_count, 0);
  assert.equal(bundle.live_evidence_targets.decision_summary.edited_count, 3);
  assert.equal(bundle.live_evidence_targets.decision_summary.unchanged_count, 18);
  assert.equal(bundle.live_evidence_targets.company_count, 3);
  assert.equal(bundle.live_evidence_targets.source_category_count, 7);
  assert.equal(bundle.live_evidence_targets.review_pack_group_count, 3);
  assert.equal(bundle.live_evidence_targets.review_pack_locator_ready_count, 0);
  assert.equal(bundle.live_evidence_targets.review_pack_human_review_required_count, 21);
  assert.equal(bundle.live_evidence_targets.review_pack_pending_decision_count, 21);
  assert.equal(bundle.live_evidence_targets.review_status_counts.human_review_required, 21);
  assert.equal(bundle.live_evidence_targets.grouped_by_company['company:symphony-talent'], 7);
  assert.equal(bundle.live_evidence_targets.grouped_by_source_category.careers_site, 3);
  assert.equal(bundle.live_evidence_targets.locator_placeholders_nullable, true);
  assert.equal(bundle.live_evidence_targets.live_evidence_collected, false);
  assert.equal(bundle.live_evidence_targets.selectors_resolved, false);
  assert.equal(bundle.live_evidence_targets.locator_resolution_read_only_planning_evidence, true);
  assert.equal(bundle.live_evidence_targets.human_locator_review_pack_read_only_planning_evidence, true);
  assert.equal(bundle.live_evidence_targets.human_locator_approval_patch_read_only_planning_evidence, true);
  assert.equal(bundle.live_evidence_targets.reviewed_locator_readiness_read_only_planning_evidence, true);
  assert.equal(bundle.live_evidence_targets.controls.full_page_grabs, false);
  assert.equal(bundle.live_evidence_targets.controls.autonomous_browsing_authorized, false);
  assert.equal(bundle.live_evidence_targets.controls.live_collection_authorized, false);
  assert.equal(bundle.live_evidence_targets.controls.report_renderer_authorized, false);
  assert.equal(bundle.live_evidence_targets.controls.export_execution_authorized, false);
  assert.equal(bundle.live_evidence_targets.controls.workflow_engine_authorized, false);
  assert.equal(bundle.source_artifact_targets.capture_unit, 'page_element');
  assert.equal(bundle.source_artifact_targets.full_page_grabs, false);
  assert.equal(
    bundle.source_artifact_targets.element_capture_planning.planning_bundle_schema,
    'shared/schemas/employer-brand-element-capture-planning-bundle-v0.schema.json',
  );
  assert.equal(
    bundle.source_artifact_targets.element_capture_planning.planning_bundle_path,
    'source-artifacts/element-capture-planning-bundle.json',
  );
  assert.equal(
    bundle.source_artifact_targets.element_capture_planning.clip_manifest_path,
    'source-artifacts/element-clip-manifest.json',
  );
  assert.equal(
    bundle.source_artifact_targets.element_capture_planning.planned_clip_manifest_path,
    'source-artifacts/element-clip-manifest.planned.json',
  );
  assert.equal(
    bundle.source_artifact_targets.element_capture_planning.acceptance_report_path,
    'source-artifacts/element-clip-acceptance-report.json',
  );
  assert.equal(bundle.source_artifact_targets.element_capture_planning.work_unit_count, 37);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.expected_clip_count, 44);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.actual_clip_count, 16);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.acceptance_report_status, 'accepted_with_blockers');
  assert.equal(bundle.source_artifact_targets.element_capture_planning.acceptance_failed_count, 0);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.local_spv5_html_only, true);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.read_only, true);
  assert.equal(bundle.source_artifact_targets.element_capture_planning.planned_only, false);
  assert.deepEqual(bundle.citations.registry_request_ids, [
    'symphony_talent_careers_site_planning',
    'phenom_careers_site_planning',
    'radancy_careers_site_planning',
  ]);
  assert.deepEqual(bundle.citations.missing_registry_request_ids, []);
  assert.equal(bundle.coverage.browser_evidence.request_count, 3);
  assert.equal(bundle.coverage.browser_evidence.captured_count, 3);
  assert.equal(bundle.coverage.planning.planned_count, 21);
  assert.equal(bundle.coverage.planning.missing_planned_count, 18);
  assert.ok(bundle.coverage.by_company.every((row) => row.planned_count === 7 && row.captured_count === 1));

  for (const key of [
    'report_renderer_authorized',
    'report_artifact_authorized',
    'export_execution_authorized',
    'remote_web_collection_authorized',
    'workflow_engine_authorized',
    'full_page_grabs_authorized',
  ]) {
    assert.equal(bundle.controls[key], false);
  }
  for (const nonGoal of ['report_renderer', 'html_css_polish', 'pdf_export', 'docx_export', 'live_collection', 'workflow_engine', 'full_page_grabs']) {
    assert.ok(bundle.provenance.non_goals.includes(nonGoal), `missing non-goal: ${nonGoal}`);
  }
});

test('Employer Brand Comparative Audit Data Bundle normalizer handles arbitrary n companies', () => {
  const inputs = addFourthCompany(loadEmployerBrandComparativeAuditDataBundleInputs({ fixtureRoot }));
  const bundle = normalizeEmployerBrandComparativeAuditDataBundle({
    ...inputs,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandComparativeAuditDataBundle(bundle);

  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(bundle.project.company_count, 4);
  assert.deepEqual(bundle.project.competitor_companies, ['Phenom', 'Radancy', 'Acme Talent']);
  assert.deepEqual(bundle.companies.map((company) => company.name), ['Symphony Talent', 'Phenom', 'Radancy', 'Acme Talent']);
  assert.ok(bundle.kilos.dimensions.every((dimension) => dimension.companies.length === 4));
  assert.equal(bundle.citations.registry_request_count, 4);
  assert.ok(bundle.citations.registry_request_ids.includes('acme_careers_site_planning'));
  assert.deepEqual(bundle.citations.missing_registry_request_ids, []);
  assert.equal(bundle.comparative_audits[0].citation_integrity.company_audit_ids_present, true);
  assert.equal(bundle.comparative_audits[0].citation_integrity.registry_request_ids_present, true);
});

test('Employer Brand Comparative Audit Data Bundle fixture is wired into artifact-bundle provenance metadata', async () => {
  const subject = await readJson(path.join(fixtureRoot, 'subject.json'));
  const sources = await readJson(path.join(fixtureRoot, 'sources.json'));
  const report = subject.artifacts.find((artifact) => artifact.id === 'employer-brand-report');
  const file = report.files.find((item) => item.role === 'employer_brand_comparative_audit_data_bundle');
  const ref = subject.subject_references.find((item) => item.id === 'employer-brand-comparative-audit-data-bundle');
  const patchRef = subject.subject_references.find((item) => item.id === 'live-evidence-target-approval-patch');
  const reviewedRef = subject.subject_references.find((item) => item.id === 'live-evidence-reviewed-target-plan');
  const supervisedLocatorPlanRef = subject.subject_references.find((item) => item.id === 'live-evidence-supervised-locator-plan');
  const urlOpenRunRef = subject.subject_references.find((item) => item.id === 'live-evidence-url-open-run');
  const urlReachabilityCheckRef = subject.subject_references.find((item) => item.id === 'live-evidence-url-reachability-check');
  const locatorResolutionResultRef = subject.subject_references.find((item) => item.id === 'live-evidence-locator-resolution-result');
  const humanLocatorReviewPackRef = subject.subject_references.find((item) => item.id === 'live-evidence-human-locator-review-pack');
  const reviewedLocatorCapturePlanRef = subject.subject_references.find((item) => item.id === 'live-evidence-reviewed-locator-capture-plan');
  const liveElementClipManifestRef = subject.subject_references.find((item) => item.id === 'live-evidence-element-clip-manifest');
  const captureFailureReviewPackRef = subject.subject_references.find((item) => item.id === 'live-evidence-capture-failure-review-pack');
  const captureRepairPatchRef = subject.subject_references.find((item) => item.id === 'live-evidence-capture-repair-patch');
  const captureRepairPromotionRef = subject.subject_references.find((item) => item.id === 'live-evidence-capture-repair-promotion');
  const repairedLocatorCapturePlanRef = subject.subject_references.find((item) => item.id === 'live-evidence-repaired-locator-capture-plan');
  const repairedRuntimeDiagnosticsRef = subject.subject_references.find((item) => item.id === 'live-evidence-repaired-capture-runtime-diagnostics');
  const supervisedLocatorPlanFile = report.files.find((item) => item.role === 'live_evidence_supervised_locator_plan');
  const urlOpenRunFile = report.files.find((item) => item.role === 'live_evidence_url_open_run');
  const urlReachabilityCheckFile = report.files.find((item) => item.role === 'live_evidence_url_reachability_check');
  const locatorResolutionResultFile = report.files.find((item) => item.role === 'live_evidence_locator_resolution_result');
  const humanLocatorReviewPackFile = report.files.find((item) => item.role === 'live_evidence_human_locator_review_pack');
  const reviewedLocatorCapturePlanFile = report.files.find((item) => item.role === 'live_evidence_reviewed_locator_capture_plan');
  const liveElementClipManifestFile = report.files.find((item) => item.role === 'live_evidence_element_clip_manifest');
  const captureFailureReviewPackFile = report.files.find((item) => item.role === 'live_evidence_capture_failure_review_pack');
  const captureRepairPatchFile = report.files.find((item) => item.role === 'live_evidence_capture_repair_patch');
  const captureRepairPromotionFile = report.files.find((item) => item.role === 'live_evidence_capture_repair_promotion');
  const repairedLocatorCapturePlanFile = report.files.find((item) => item.role === 'live_evidence_repaired_locator_capture_plan');
  const repairedRuntimeDiagnosticsFile = report.files.find((item) => item.role === 'live_evidence_repaired_capture_runtime_diagnostics');

  assert.equal(file.path, 'data-bundle.json');
  assert.equal(file.schema, 'shared/schemas/employer-brand-comparative-audit-data-bundle-v0.schema.json');
  assert.equal(file.read_only, true);
  assert.equal(file.provenance_only, true);
  assert.equal(file.metadata.company_count, 3);
  assert.equal(file.metadata.live_evidence_target_plan_path, 'live-evidence-target-plan.json');
  assert.equal(file.metadata.live_evidence_target_review_pack_path, 'live-evidence-target-review-pack.json');
  assert.equal(file.metadata.live_evidence_target_approval_patch_path, 'live-evidence-target-approval-patch.json');
  assert.equal(file.metadata.live_evidence_reviewed_target_plan_path, 'live-evidence-reviewed-target-plan.json');
  assert.equal(file.metadata.live_evidence_locator_readiness_path, 'live-evidence-locator-readiness.json');
  assert.equal(file.metadata.live_evidence_supervised_locator_plan_path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(file.metadata.live_evidence_url_open_run_path, 'live-evidence-url-open-run.json');
  assert.equal(file.metadata.live_evidence_url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(file.metadata.live_evidence_locator_resolution_result_path, 'live-evidence-locator-resolution-result.json');
  assert.equal(file.metadata.live_evidence_human_locator_review_pack_path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_plan_path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(file.metadata.live_evidence_target_count, 21);
  assert.equal(file.metadata.live_evidence_expected_clip_count, 21);
  assert.equal(file.metadata.live_evidence_reviewed_target_count, 18);
  assert.equal(file.metadata.live_evidence_reviewed_expected_clip_count, 19);
  assert.equal(file.metadata.live_evidence_locator_needs_locator_count, 16);
  assert.equal(file.metadata.live_evidence_locator_needs_human_target_review_count, 2);
  assert.equal(file.metadata.live_evidence_locator_url_not_checked_count, 0);
  assert.equal(file.metadata.live_evidence_supervised_locator_executable_unit_count, 16);
  assert.equal(file.metadata.live_evidence_supervised_locator_blocked_non_executable_count, 2);
  assert.equal(file.metadata.live_evidence_supervised_locator_expected_clip_count, 17);
  assert.equal(file.metadata.live_evidence_supervised_locator_url_checks_performed, false);
  assert.equal(file.metadata.live_evidence_url_open_run_status, 'completed_with_blockers');
  assert.equal(file.metadata.live_evidence_url_open_opened_count, 16);
  assert.equal(file.metadata.live_evidence_url_open_reachable_count, 5);
  assert.equal(file.metadata.live_evidence_url_open_redirected_count, 2);
  assert.equal(file.metadata.live_evidence_url_open_network_error_count, 9);
  assert.equal(file.metadata.live_evidence_url_reachability_check_status, 'checked_with_blockers');
  assert.equal(file.metadata.live_evidence_url_reachability_executable_target_count, 16);
  assert.equal(file.metadata.live_evidence_url_reachability_checked_count, 16);
  assert.equal(file.metadata.live_evidence_url_reachability_reachable_count, 5);
  assert.equal(file.metadata.live_evidence_url_reachability_blocked_count, 2);
  assert.equal(file.metadata.live_evidence_url_reachability_redirected_count, 2);
  assert.equal(file.metadata.live_evidence_url_reachability_network_error_count, 9);
  assert.equal(file.metadata.live_evidence_locator_resolution_result_status, 'completed_with_blockers');
  assert.equal(file.metadata.live_evidence_locator_resolution_attempted_count, 7);
  assert.equal(file.metadata.live_evidence_locator_resolution_locator_ready_count, 0);
  assert.equal(file.metadata.live_evidence_locator_resolution_needs_human_locator_review_count, 2);
  assert.equal(file.metadata.live_evidence_locator_resolution_eligible_target_count, 7);
  assert.equal(file.metadata.live_evidence_locator_resolution_rejected_exclusion_count, 3);
  assert.equal(file.metadata.live_evidence_human_locator_review_item_count, 9);
  assert.equal(file.metadata.live_evidence_human_locator_ambiguous_attempt_count, 7);
  assert.equal(file.metadata.live_evidence_human_locator_needs_human_target_review_count, 2);
  assert.equal(file.metadata.live_evidence_human_locator_ready_count, 0);
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_executable_unit_count, 4);
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_expected_ready_clip_count, 5);
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_planned_output_slot_count, 5);
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_non_executable_context_count, 14);
  assert.equal(file.metadata.live_evidence_reviewed_locator_capture_no_capture_assets_produced, true);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_path, 'source-artifacts/live-evidence-element-clip-manifest.json');
  assert.equal(file.metadata.live_evidence_element_clip_manifest_status, 'not_accepted');
  assert.equal(file.metadata.live_evidence_element_clip_manifest_captured_slot_count, 0);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_failed_slot_count, 4);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_blocked_not_run_count, 15);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_full_page_grab_count, 0);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_acceptance_passed, false);
  assert.deepEqual(file.metadata.live_evidence_element_clip_manifest_required_next_actions, ['review_capture_blocker_before_retry']);
  assert.equal(file.metadata.live_evidence_element_clip_manifest_read_only_captured_evidence, true);
  assert.equal(file.metadata.live_evidence_capture_failure_review_pack_path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(file.metadata.live_evidence_capture_failure_review_pack_status, 'repair_queue_ready');
  assert.equal(file.metadata.live_evidence_capture_failure_failed_executable_slot_count, 5);
  assert.equal(file.metadata.live_evidence_capture_failure_accepted_capture_count, 0);
  assert.equal(file.metadata.live_evidence_capture_failure_non_executable_context_count, 14);
  assert.equal(file.metadata.live_evidence_capture_failure_zero_match_locator_failure_count, 4);
  assert.equal(file.metadata.live_evidence_capture_failure_login_or_sign_in_blocker_count, 1);
  assert.equal(file.metadata.live_evidence_capture_failure_no_repairs_fabricated, true);
  assert.equal(file.metadata.live_evidence_capture_repair_patch_path, 'live-evidence-capture-repair-patch.json');
  assert.equal(file.metadata.live_evidence_capture_repair_patch_status, 'repair_reviewed');
  assert.equal(file.metadata.live_evidence_capture_repair_patch_item_count, 5);
  assert.equal(file.metadata.live_evidence_capture_repair_patch_read_only_context_count, 14);
  assert.equal(file.metadata.live_evidence_capture_repair_patch_no_unapproved_repairs, true);
  assert.equal(file.metadata.live_evidence_capture_repair_promotion_path, 'live-evidence-capture-repair-promotion.json');
  assert.equal(file.metadata.live_evidence_capture_repair_promotion_repaired_executable_slot_count, 4);
  assert.equal(file.metadata.live_evidence_capture_repair_promotion_unavailable_source_slot_count, 1);
  assert.equal(file.metadata.live_evidence_repaired_locator_capture_plan_path, 'live-evidence-repaired-locator-capture-plan.json');
  assert.equal(file.metadata.live_evidence_repaired_locator_capture_plan_no_capture_assets_produced, true);
  assert.equal(file.metadata.live_evidence_repaired_capture_runtime_diagnostics_path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(file.metadata.live_evidence_repaired_capture_runtime_diagnostics_runtime_failure_count, 0);
  assert.equal(file.metadata.live_evidence_repaired_capture_runtime_diagnostics_locator_failure_count, 4);
  assert.equal(file.metadata.live_evidence_repaired_capture_runtime_diagnostics_retry_after_runtime_repair_count, 0);
  assert.equal(file.metadata.target_count, 13);
  assert.equal(file.metadata.expected_clip_count, 44);
  assert.equal(file.metadata.report_renderer_authorized, false);
  assert.equal(file.metadata.full_page_grabs_authorized, false);
  assert.equal(file.metadata.element_capture_planning_bundle_path, 'source-artifacts/element-capture-planning-bundle.json');
  assert.equal(file.metadata.element_clip_manifest_path, 'source-artifacts/element-clip-manifest.json');
  assert.equal(file.metadata.planned_element_clip_manifest_path, 'source-artifacts/element-clip-manifest.planned.json');
  assert.equal(file.metadata.element_clip_acceptance_report_path, 'source-artifacts/element-clip-acceptance-report.json');

  assert.equal(ref.subject_type, 'aos.employer_brand_comparative_audit_data_bundle');
  assert.equal(ref.metadata.path, 'data-bundle.json');
  assert.equal(ref.metadata.read_only, true);
  assert.equal(ref.metadata.provenance_only, true);
  assert.equal(ref.metadata.live_evidence_target_approval_patch_path, 'live-evidence-target-approval-patch.json');
  assert.equal(ref.metadata.live_evidence_reviewed_target_plan_path, 'live-evidence-reviewed-target-plan.json');
  assert.equal(ref.metadata.live_evidence_locator_readiness_path, 'live-evidence-locator-readiness.json');
  assert.equal(ref.metadata.live_evidence_supervised_locator_plan_path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(ref.metadata.live_evidence_url_open_run_path, 'live-evidence-url-open-run.json');
  assert.equal(ref.metadata.live_evidence_url_reachability_check_path, 'live-evidence-url-reachability-check.json');
  assert.equal(ref.metadata.live_evidence_locator_resolution_result_path, 'live-evidence-locator-resolution-result.json');
  assert.equal(ref.metadata.live_evidence_human_locator_review_pack_path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(ref.metadata.live_evidence_reviewed_locator_capture_plan_path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(ref.metadata.live_evidence_capture_repair_patch_path, 'live-evidence-capture-repair-patch.json');
  assert.equal(ref.metadata.live_evidence_capture_repair_patch_no_unapproved_repairs, true);
  assert.equal(ref.metadata.live_evidence_capture_repair_promotion_path, 'live-evidence-capture-repair-promotion.json');
  assert.equal(ref.metadata.live_evidence_repaired_locator_capture_plan_path, 'live-evidence-repaired-locator-capture-plan.json');
  assert.equal(ref.metadata.live_evidence_repaired_capture_runtime_diagnostics_path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(patchRef.subject_type, 'aos.employer_brand_live_evidence_target_approval_patch');
  assert.equal(patchRef.metadata.approved_count, 16);
  assert.equal(patchRef.metadata.rejected_count, 3);
  assert.equal(patchRef.metadata.locator_codegen, false);
  assert.equal(reviewedRef.subject_type, 'aos.employer_brand_live_evidence_target_plan');
  assert.equal(reviewedRef.metadata.target_count, 18);
  assert.equal(reviewedRef.metadata.expected_clip_count, 19);
  assert.equal(reviewedRef.metadata.rejected_targets_excluded_from_readiness, true);
  assert.equal(supervisedLocatorPlanRef.subject_type, 'aos.employer_brand_live_evidence_supervised_locator_plan');
  assert.equal(supervisedLocatorPlanRef.metadata.executable_locator_unit_count, 16);
  assert.equal(supervisedLocatorPlanRef.metadata.blocked_non_executable_count, 2);
  assert.equal(supervisedLocatorPlanRef.metadata.expected_clip_count_for_executable_units, 17);
  assert.equal(supervisedLocatorPlanRef.metadata.url_checks_performed, false);
  assert.equal(supervisedLocatorPlanRef.metadata.allowed_outputs_unfilled, true);
  assert.equal(urlOpenRunRef.subject_type, 'aos.employer_brand_live_evidence_url_open_run');
  assert.equal(urlOpenRunRef.metadata.opened_count, 16);
  assert.equal(urlOpenRunRef.metadata.reachable_count, 5);
  assert.equal(urlOpenRunRef.metadata.redirected_count, 2);
  assert.equal(urlOpenRunRef.metadata.network_error_count, 9);
  assert.equal(urlOpenRunRef.metadata.dry_run_only, false);
  assert.equal(urlReachabilityCheckRef.subject_type, 'aos.employer_brand_live_evidence_url_reachability_check');
  assert.equal(urlReachabilityCheckRef.metadata.executable_target_count, 16);
  assert.equal(urlReachabilityCheckRef.metadata.checked_count, 16);
  assert.equal(urlReachabilityCheckRef.metadata.reachable_count, 5);
  assert.equal(urlReachabilityCheckRef.metadata.blocked_count, 2);
  assert.equal(locatorResolutionResultRef.subject_type, 'aos.employer_brand_live_evidence_locator_resolution_result');
  assert.equal(locatorResolutionResultRef.metadata.attempted_count, 7);
  assert.equal(locatorResolutionResultRef.metadata.locator_ready_count, 0);
  assert.equal(locatorResolutionResultRef.metadata.needs_human_locator_review_count, 2);
  assert.equal(locatorResolutionResultRef.metadata.eligible_target_count, 7);
  assert.equal(locatorResolutionResultRef.metadata.rejected_exclusion_count, 3);
  assert.equal(humanLocatorReviewPackRef.subject_type, 'aos.employer_brand_live_evidence_human_locator_review_pack');
  assert.equal(humanLocatorReviewPackRef.metadata.review_item_count, 9);
  assert.equal(humanLocatorReviewPackRef.metadata.ambiguous_locator_attempt_count, 7);
  assert.equal(humanLocatorReviewPackRef.metadata.needs_human_target_review_count, 2);
  assert.equal(humanLocatorReviewPackRef.metadata.unconfirmed_candidates_metadata_only, true);
  assert.equal(humanLocatorReviewPackRef.metadata.locator_fields_null, true);
  assert.equal(humanLocatorReviewPackRef.metadata.locator_ready_count, 0);
  assert.equal(reviewedLocatorCapturePlanRef.subject_type, 'aos.employer_brand_live_evidence_reviewed_locator_capture_plan');
  assert.equal(reviewedLocatorCapturePlanRef.metadata.executable_unit_count, 4);
  assert.equal(reviewedLocatorCapturePlanRef.metadata.expected_ready_clip_count, 5);
  assert.equal(reviewedLocatorCapturePlanRef.metadata.planned_output_slot_count, 5);
  assert.equal(reviewedLocatorCapturePlanRef.metadata.non_executable_context_count, 14);
  assert.equal(reviewedLocatorCapturePlanRef.metadata.no_capture_execution, true);
  assert.equal(liveElementClipManifestRef.subject_type, 'aos.employer_brand_live_evidence_element_clip_manifest');
  assert.equal(liveElementClipManifestRef.metadata.path, 'source-artifacts/live-evidence-element-clip-manifest.json');
  assert.equal(liveElementClipManifestRef.metadata.status, 'not_accepted');
  assert.equal(liveElementClipManifestRef.metadata.captured_slot_count, 0);
  assert.equal(liveElementClipManifestRef.metadata.failed_slot_count, 4);
  assert.equal(liveElementClipManifestRef.metadata.blocked_not_run_count, 15);
  assert.equal(liveElementClipManifestRef.metadata.full_page_grab_count, 0);
  assert.equal(liveElementClipManifestRef.metadata.read_only_captured_evidence, true);
  assert.equal(captureFailureReviewPackRef.subject_type, 'aos.employer_brand_live_evidence_capture_failure_review_pack');
  assert.equal(captureFailureReviewPackRef.metadata.path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(captureFailureReviewPackRef.metadata.status, 'repair_queue_ready');
  assert.equal(captureFailureReviewPackRef.metadata.failed_executable_slot_count, 5);
  assert.equal(captureFailureReviewPackRef.metadata.accepted_capture_count, 0);
  assert.equal(captureFailureReviewPackRef.metadata.non_executable_context_count, 14);
  assert.equal(captureFailureReviewPackRef.metadata.zero_match_locator_failure_count, 4);
  assert.equal(captureFailureReviewPackRef.metadata.login_or_sign_in_blocker_count, 1);
  assert.equal(captureFailureReviewPackRef.metadata.no_repairs_fabricated, true);
  assert.equal(captureRepairPatchRef.subject_type, 'aos.employer_brand_live_evidence_capture_repair_patch');
  assert.equal(captureRepairPatchRef.metadata.path, 'live-evidence-capture-repair-patch.json');
  assert.equal(captureRepairPatchRef.metadata.patchable_repair_item_count, 5);
  assert.equal(captureRepairPatchRef.metadata.read_only_context_entry_count, 14);
  assert.equal(captureRepairPatchRef.metadata.filled_repair_decision_count, 5);
  assert.equal(captureRepairPatchRef.metadata.no_unapproved_repairs, true);
  assert.equal(captureRepairPatchRef.metadata.empty_application_no_op, false);
  assert.equal(captureRepairPatchRef.metadata.new_locator_ready_slot_count, 0);
  assert.equal(captureRepairPatchRef.metadata.promoted_capture_count, 0);
  assert.equal(captureRepairPromotionRef.subject_type, 'aos.employer_brand_live_evidence_capture_repair_promotion');
  assert.equal(captureRepairPromotionRef.metadata.repaired_executable_slot_count, 4);
  assert.equal(captureRepairPromotionRef.metadata.unavailable_source_slot_count, 1);
  assert.equal(captureRepairPromotionRef.metadata.no_capture_assets_produced, true);
  assert.equal(repairedLocatorCapturePlanRef.subject_type, 'aos.employer_brand_live_evidence_repaired_locator_capture_plan');
  assert.equal(repairedLocatorCapturePlanRef.metadata.repaired_executable_slot_count, 4);
  assert.equal(repairedLocatorCapturePlanRef.metadata.unavailable_source_slot_count, 1);
  assert.equal(repairedLocatorCapturePlanRef.metadata.actual_capture_file_count, 0);
  assert.equal(repairedRuntimeDiagnosticsRef.subject_type, 'aos.employer_brand_repaired_capture_runtime_diagnostics');
  assert.equal(repairedRuntimeDiagnosticsRef.metadata.runtime_capture_invocation_failure_count, 0);
  assert.equal(repairedRuntimeDiagnosticsRef.metadata.locator_failure_count, 4);
  assert.equal(repairedRuntimeDiagnosticsRef.metadata.retry_after_runtime_repair_count, 0);
  assert.equal(supervisedLocatorPlanFile.path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(supervisedLocatorPlanFile.schema, 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json');
  assert.equal(urlOpenRunFile.path, 'live-evidence-url-open-run.json');
  assert.equal(urlOpenRunFile.schema, 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json');
  assert.equal(urlReachabilityCheckFile.path, 'live-evidence-url-reachability-check.json');
  assert.equal(urlReachabilityCheckFile.schema, 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json');
  assert.equal(locatorResolutionResultFile.path, 'live-evidence-locator-resolution-result.json');
  assert.equal(locatorResolutionResultFile.schema, 'shared/schemas/employer-brand-live-evidence-locator-resolution-result-v0.schema.json');
  assert.equal(humanLocatorReviewPackFile.path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(humanLocatorReviewPackFile.schema, 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json');
  assert.equal(reviewedLocatorCapturePlanFile.path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(reviewedLocatorCapturePlanFile.schema, 'shared/schemas/employer-brand-live-evidence-reviewed-locator-capture-plan-v0.schema.json');
  assert.equal(reviewedLocatorCapturePlanFile.metadata.contains_actual_captures, false);
  assert.equal(liveElementClipManifestFile.path, 'source-artifacts/live-evidence-element-clip-manifest.json');
  assert.equal(liveElementClipManifestFile.schema, 'shared/schemas/employer-brand-live-evidence-element-clip-manifest-v0.schema.json');
  assert.equal(liveElementClipManifestFile.metadata.status, 'not_accepted');
  assert.equal(liveElementClipManifestFile.metadata.captured_slot_count, 0);
  assert.equal(liveElementClipManifestFile.metadata.failed_slot_count, 4);
  assert.equal(liveElementClipManifestFile.metadata.blocked_not_run_count, 15);
  assert.equal(liveElementClipManifestFile.metadata.full_page_grab_count, 0);
  assert.equal(captureFailureReviewPackFile.path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(captureFailureReviewPackFile.schema, 'shared/schemas/employer-brand-live-evidence-capture-failure-review-pack-v0.schema.json');
  assert.equal(captureFailureReviewPackFile.metadata.status, 'repair_queue_ready');
  assert.equal(captureFailureReviewPackFile.metadata.failed_executable_slot_count, 5);
  assert.equal(captureFailureReviewPackFile.metadata.accepted_capture_count, 0);
  assert.equal(captureFailureReviewPackFile.metadata.no_repairs_fabricated, true);
  assert.equal(captureRepairPatchFile.path, 'live-evidence-capture-repair-patch.json');
  assert.equal(captureRepairPatchFile.schema, 'shared/schemas/employer-brand-live-evidence-capture-repair-patch-v0.schema.json');
  assert.equal(captureRepairPromotionFile.path, 'live-evidence-capture-repair-promotion.json');
  assert.equal(captureRepairPromotionFile.schema, 'shared/schemas/employer-brand-live-evidence-capture-repair-promotion-v0.schema.json');
  assert.equal(repairedLocatorCapturePlanFile.path, 'live-evidence-repaired-locator-capture-plan.json');
  assert.equal(repairedLocatorCapturePlanFile.schema, 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json');
  assert.equal(captureRepairPatchFile.metadata.patchable_repair_item_count, 5);
  assert.equal(captureRepairPatchFile.metadata.read_only_context_entry_count, 14);
  assert.equal(captureRepairPatchFile.metadata.filled_repair_decision_count, 5);
  assert.equal(captureRepairPromotionFile.metadata.repaired_executable_slot_count, 4);
  assert.equal(repairedLocatorCapturePlanFile.metadata.actual_capture_file_count, 0);
  assert.equal(repairedRuntimeDiagnosticsFile.path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(repairedRuntimeDiagnosticsFile.schema, 'shared/schemas/employer-brand-repaired-capture-runtime-diagnostics-v0.schema.json');
  assert.equal(repairedRuntimeDiagnosticsFile.metadata.runtime_capture_invocation_failure_count, 0);
  assert.equal(repairedRuntimeDiagnosticsFile.metadata.locator_failure_count, 4);
  assert.equal(repairedRuntimeDiagnosticsFile.metadata.no_live_capture_attempted, true);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.path, 'data-bundle.json');
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_target_plan_path,
    'live-evidence-target-plan.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_target_review_pack_path,
    'live-evidence-target-review-pack.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_target_approval_patch_path,
    'live-evidence-target-approval-patch.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_reviewed_target_plan_path,
    'live-evidence-reviewed-target-plan.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_supervised_locator_plan_path,
    'live-evidence-supervised-locator-plan.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_url_open_run_path,
    'live-evidence-url-open-run.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_url_reachability_check_path,
    'live-evidence-url-reachability-check.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_locator_resolution_result_path,
    'live-evidence-locator-resolution-result.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_human_locator_review_pack_path,
    'live-evidence-human-locator-review-pack.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_reviewed_locator_capture_plan_path,
    'live-evidence-reviewed-locator-capture-plan.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_path,
    'source-artifacts/live-evidence-element-clip-manifest.json',
  );
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_status, 'not_accepted');
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_captured_slot_count, 0);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_failed_slot_count, 4);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_blocked_not_run_count, 15);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_full_page_grab_count, 0);
  assert.deepEqual(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_element_clip_manifest_required_next_actions,
    ['review_capture_blocker_before_retry'],
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.live_evidence_repaired_capture_runtime_diagnostics_path,
    'live-evidence-repaired-capture-runtime-diagnostics.json',
  );
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_repaired_capture_runtime_diagnostics_runtime_failure_count, 0);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_repaired_capture_runtime_diagnostics_locator_failure_count, 4);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_human_locator_review_item_count, 9);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_human_locator_ambiguous_attempt_count, 7);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_human_locator_needs_human_target_review_count, 2);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_human_locator_ready_count, 0);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_target_count, 21);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.live_evidence_reviewed_target_count, 18);
  assert.equal(sources.live_evidence_target_plan.path, 'live-evidence-target-plan.json');
  assert.equal(sources.live_evidence_target_plan.target_count, 21);
  assert.equal(sources.live_evidence_target_plan.expected_clip_count, 21);
  assert.equal(sources.live_evidence_target_plan.human_review_required_count, 21);
  assert.equal(sources.live_evidence_target_plan.live_collection_authorized, false);
  assert.equal(sources.live_evidence_target_plan.locators_resolved, false);
  assert.equal(sources.live_evidence_target_review_pack.path, 'live-evidence-target-review-pack.json');
  assert.equal(sources.live_evidence_target_review_pack.schema, 'shared/schemas/employer-brand-live-evidence-target-review-pack-v0.schema.json');
  assert.equal(sources.live_evidence_target_review_pack.target_count, 21);
  assert.equal(sources.live_evidence_target_review_pack.company_group_count, 3);
  assert.equal(sources.live_evidence_target_review_pack.locator_ready_count, 0);
  assert.equal(sources.live_evidence_target_review_pack.pending_decision_count, 21);
  assert.equal(sources.live_evidence_target_review_pack.url_reachability_checks_authorized, false);
  assert.equal(sources.live_evidence_target_review_pack.locator_codegen_authorized, false);
  assert.equal(sources.live_evidence_target_review_pack.screenshot_capture_authorized, false);
  assert.equal(sources.live_evidence_target_approval_patch.path, 'live-evidence-target-approval-patch.json');
  assert.equal(sources.live_evidence_target_approval_patch.schema, 'shared/schemas/employer-brand-live-evidence-target-approval-patch-v0.schema.json');
  assert.equal(sources.live_evidence_target_approval_patch.approved_count, 16);
  assert.equal(sources.live_evidence_target_approval_patch.rejected_count, 3);
  assert.equal(sources.live_evidence_target_approval_patch.draft_count, 2);
  assert.equal(sources.live_evidence_target_approval_patch.edited_count, 3);
  assert.equal(sources.live_evidence_target_approval_patch.expected_clip_count_after_rejected_targets_excluded, 19);
  assert.equal(sources.live_evidence_target_approval_patch.locator_codegen, false);
  assert.equal(sources.live_evidence_reviewed_target_plan.path, 'live-evidence-reviewed-target-plan.json');
  assert.equal(sources.live_evidence_reviewed_target_plan.target_count, 18);
  assert.equal(sources.live_evidence_reviewed_target_plan.expected_clip_count, 19);
  assert.equal(sources.live_evidence_reviewed_target_plan.rejected_targets_excluded_from_readiness, true);
  assert.equal(sources.live_evidence_reviewed_target_plan.locator_placeholders_nullable, true);
  assert.equal(sources.live_evidence_supervised_locator_plan.path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(sources.live_evidence_supervised_locator_plan.schema, 'shared/schemas/employer-brand-live-evidence-supervised-locator-plan-v0.schema.json');
  assert.equal(sources.live_evidence_supervised_locator_plan.executable_locator_unit_count, 16);
  assert.equal(sources.live_evidence_supervised_locator_plan.blocked_non_executable_count, 2);
  assert.equal(sources.live_evidence_supervised_locator_plan.expected_clip_count_for_executable_units, 17);
  assert.equal(sources.live_evidence_supervised_locator_plan.url_checks_performed, false);
  assert.equal(sources.live_evidence_supervised_locator_plan.allowed_outputs_unfilled, true);
  assert.equal(sources.live_evidence_supervised_locator_plan.read_only, true);
  assert.equal(sources.live_evidence_url_open_run.path, 'live-evidence-url-open-run.json');
  assert.equal(sources.live_evidence_url_open_run.planned_path, 'live-evidence-url-open-run.planned.json');
  assert.equal(sources.live_evidence_url_open_run.schema, 'shared/schemas/employer-brand-live-evidence-url-open-run-v0.schema.json');
  assert.equal(sources.live_evidence_url_open_run.status, 'completed_with_blockers');
  assert.equal(sources.live_evidence_url_open_run.opened_count, 16);
  assert.equal(sources.live_evidence_url_open_run.reachable_count, 5);
  assert.equal(sources.live_evidence_url_open_run.redirected_count, 2);
  assert.equal(sources.live_evidence_url_open_run.network_error_count, 9);
  assert.equal(sources.live_evidence_url_open_run.dry_run_only, false);
  assert.equal(sources.live_evidence_url_open_run.locator_resolution_authorized, false);
  assert.equal(sources.live_evidence_url_reachability_check.path, 'live-evidence-url-reachability-check.json');
  assert.equal(sources.live_evidence_url_reachability_check.schema, 'shared/schemas/employer-brand-live-evidence-url-reachability-check-v0.schema.json');
  assert.equal(sources.live_evidence_url_reachability_check.executable_target_count, 16);
  assert.equal(sources.live_evidence_url_reachability_check.checked_count, 16);
  assert.equal(sources.live_evidence_url_reachability_check.reachable_count, 5);
  assert.equal(sources.live_evidence_url_reachability_check.redirected_count, 2);
  assert.equal(sources.live_evidence_url_reachability_check.network_error_count, 9);
  assert.equal(sources.live_evidence_url_reachability_check.blocked_count, 2);
  assert.equal(sources.live_evidence_locator_resolution_result.path, 'live-evidence-locator-resolution-result.json');
  assert.equal(sources.live_evidence_locator_resolution_result.schema, 'shared/schemas/employer-brand-live-evidence-locator-resolution-result-v0.schema.json');
  assert.equal(sources.live_evidence_locator_resolution_result.attempted_count, 7);
  assert.equal(sources.live_evidence_locator_resolution_result.locator_ready_count, 0);
  assert.equal(sources.live_evidence_locator_resolution_result.needs_human_locator_review_count, 2);
  assert.equal(sources.live_evidence_locator_resolution_result.eligible_target_count, 7);
  assert.equal(sources.live_evidence_locator_resolution_result.rejected_exclusion_count, 3);
  assert.equal(sources.live_evidence_human_locator_review_pack.path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(sources.live_evidence_human_locator_review_pack.schema, 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json');
  assert.equal(sources.live_evidence_human_locator_review_pack.review_item_count, 9);
  assert.equal(sources.live_evidence_human_locator_review_pack.ambiguous_locator_attempt_count, 7);
  assert.equal(sources.live_evidence_human_locator_review_pack.needs_human_target_review_count, 2);
  assert.equal(sources.live_evidence_human_locator_review_pack.unconfirmed_candidate_count, 7);
  assert.equal(sources.live_evidence_human_locator_review_pack.locator_ready_count, 0);
  assert.equal(sources.live_evidence_human_locator_review_pack.unconfirmed_candidates_metadata_only, true);
  assert.equal(sources.live_evidence_human_locator_review_pack.locator_fields_null, true);
  assert.equal(sources.live_evidence_human_locator_approval_patch.path, 'live-evidence-human-locator-approval-patch.json');
  assert.equal(sources.live_evidence_human_locator_approval_patch.locator_ready_decision_count, 4);
  assert.equal(sources.live_evidence_human_locator_approval_patch.expected_ready_clip_count, 5);
  assert.equal(sources.live_evidence_reviewed_locator_readiness.path, 'live-evidence-locator-readiness.reviewed.json');
  assert.equal(sources.live_evidence_reviewed_locator_readiness.locator_ready_count, 4);
  assert.equal(sources.live_evidence_reviewed_locator_readiness.needs_human_locator_review_count, 1);
  assert.equal(sources.live_evidence_reviewed_locator_capture_plan.path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(sources.live_evidence_reviewed_locator_capture_plan.executable_unit_count, 4);
  assert.equal(sources.live_evidence_reviewed_locator_capture_plan.expected_ready_clip_count, 5);
  assert.equal(sources.live_evidence_reviewed_locator_capture_plan.planned_output_slot_count, 5);
  assert.equal(sources.live_evidence_reviewed_locator_capture_plan.no_capture_execution, true);
  assert.equal(sources.live_evidence_element_clip_manifest.path, 'source-artifacts/live-evidence-element-clip-manifest.json');
  assert.equal(sources.live_evidence_element_clip_manifest.status, 'not_accepted');
  assert.equal(sources.live_evidence_element_clip_manifest.captured_slot_count, 0);
  assert.equal(sources.live_evidence_element_clip_manifest.failed_slot_count, 4);
  assert.equal(sources.live_evidence_element_clip_manifest.blocked_not_run_count, 15);
  assert.equal(sources.live_evidence_element_clip_manifest.full_page_grab_count, 0);
  assert.equal(sources.live_evidence_element_clip_manifest.read_only_captured_evidence, true);
  assert.equal(sources.live_evidence_capture_failure_review_pack.path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(sources.live_evidence_capture_failure_review_pack.status, 'repair_queue_ready');
  assert.equal(sources.live_evidence_capture_failure_review_pack.failed_executable_slot_count, 5);
  assert.equal(sources.live_evidence_capture_failure_review_pack.accepted_capture_count, 0);
  assert.equal(sources.live_evidence_capture_failure_review_pack.non_executable_context_count, 14);
  assert.equal(sources.live_evidence_capture_failure_review_pack.zero_match_locator_failure_count, 4);
  assert.equal(sources.live_evidence_capture_failure_review_pack.login_or_sign_in_blocker_count, 1);
  assert.equal(sources.live_evidence_capture_failure_review_pack.no_repairs_fabricated, true);
  assert.equal(sources.live_evidence_capture_repair_patch.path, 'live-evidence-capture-repair-patch.json');
  assert.equal(sources.live_evidence_capture_repair_patch.patchable_repair_item_count, 5);
  assert.equal(sources.live_evidence_capture_repair_patch.read_only_context_entry_count, 14);
  assert.equal(sources.live_evidence_capture_repair_patch.filled_repair_decision_count, 5);
  assert.equal(sources.live_evidence_capture_repair_patch.no_unapproved_repairs, true);
  assert.equal(sources.live_evidence_capture_repair_patch.empty_application_no_op, false);
  assert.equal(sources.live_evidence_capture_repair_promotion.repaired_executable_slot_count, 4);
  assert.equal(sources.live_evidence_repaired_locator_capture_plan.actual_capture_file_count, 0);
  assert.equal(sources.live_evidence_repaired_capture_runtime_diagnostics.path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(sources.live_evidence_repaired_capture_runtime_diagnostics.runtime_capture_invocation_failure_count, 0);
  assert.equal(sources.live_evidence_repaired_capture_runtime_diagnostics.locator_failure_count, 4);
  assert.equal(subject.metadata.live_evidence_supervised_locator_plan_v0.path, 'live-evidence-supervised-locator-plan.json');
  assert.equal(subject.metadata.live_evidence_supervised_locator_plan_v0.executable_locator_unit_count, 16);
  assert.equal(subject.metadata.live_evidence_url_reachability_check_v0.path, 'live-evidence-url-reachability-check.json');
  assert.equal(subject.metadata.live_evidence_url_reachability_check_v0.executable_target_count, 16);
  assert.equal(subject.metadata.live_evidence_url_reachability_check_v0.checked_count, 16);
  assert.equal(subject.metadata.live_evidence_url_open_run_v0.path, 'live-evidence-url-open-run.json');
  assert.equal(subject.metadata.live_evidence_url_open_run_v0.opened_count, 16);
  assert.equal(subject.metadata.live_evidence_locator_resolution_result_v0.path, 'live-evidence-locator-resolution-result.json');
  assert.equal(subject.metadata.live_evidence_locator_resolution_result_v0.locator_ready_count, 0);
  assert.equal(subject.metadata.live_evidence_locator_resolution_result_v0.needs_human_locator_review_count, 2);
  assert.equal(subject.metadata.live_evidence_locator_resolution_result_v0.eligible_target_count, 7);
  assert.equal(subject.metadata.live_evidence_locator_resolution_result_v0.rejected_exclusion_count, 3);
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.path, 'live-evidence-human-locator-review-pack.json');
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.review_item_count, 9);
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.ambiguous_locator_attempt_count, 7);
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.needs_human_target_review_count, 2);
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.locator_ready_count, 0);
  assert.equal(subject.metadata.live_evidence_human_locator_review_pack_v0.read_only, true);
  assert.equal(subject.metadata.live_evidence_human_locator_approval_patch_v0.path, 'live-evidence-human-locator-approval-patch.json');
  assert.equal(subject.metadata.live_evidence_human_locator_approval_patch_v0.locator_ready_decision_count, 4);
  assert.equal(subject.metadata.live_evidence_reviewed_locator_readiness_v0.path, 'live-evidence-locator-readiness.reviewed.json');
  assert.equal(subject.metadata.live_evidence_reviewed_locator_readiness_v0.locator_ready_count, 4);
  assert.equal(subject.metadata.live_evidence_reviewed_locator_capture_plan_v0.path, 'live-evidence-reviewed-locator-capture-plan.json');
  assert.equal(subject.metadata.live_evidence_reviewed_locator_capture_plan_v0.executable_unit_count, 4);
  assert.equal(subject.metadata.live_evidence_reviewed_locator_capture_plan_v0.expected_ready_clip_count, 5);
  assert.equal(subject.metadata.live_evidence_reviewed_locator_capture_plan_v0.no_capture_execution, true);
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.path, 'source-artifacts/live-evidence-element-clip-manifest.json');
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.status, 'not_accepted');
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.captured_slot_count, 0);
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.failed_slot_count, 4);
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.blocked_not_run_count, 15);
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.full_page_grab_count, 0);
  assert.deepEqual(subject.metadata.live_evidence_element_clip_manifest_v0.required_next_actions, ['review_capture_blocker_before_retry']);
  assert.equal(subject.metadata.live_evidence_element_clip_manifest_v0.read_only_captured_evidence, true);
  assert.equal(subject.metadata.live_evidence_repaired_capture_runtime_diagnostics_v0.path, 'live-evidence-repaired-capture-runtime-diagnostics.json');
  assert.equal(subject.metadata.live_evidence_repaired_capture_runtime_diagnostics_v0.runtime_capture_invocation_failure_count, 0);
  assert.equal(subject.metadata.live_evidence_repaired_capture_runtime_diagnostics_v0.locator_failure_count, 4);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.path, 'live-evidence-capture-failure-review-pack.json');
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.status, 'repair_queue_ready');
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.failed_executable_slot_count, 5);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.accepted_capture_count, 0);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.non_executable_context_count, 14);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.zero_match_locator_failure_count, 4);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.login_or_sign_in_blocker_count, 1);
  assert.equal(subject.metadata.live_evidence_capture_failure_review_pack_v0.no_repairs_fabricated, true);
  assert.equal(subject.metadata.live_evidence_capture_repair_patch_v0.path, 'live-evidence-capture-repair-patch.json');
  assert.equal(subject.metadata.live_evidence_capture_repair_patch_v0.patchable_repair_item_count, 5);
  assert.equal(subject.metadata.live_evidence_capture_repair_patch_v0.read_only_context_entry_count, 14);
  assert.equal(subject.metadata.live_evidence_capture_repair_patch_v0.empty_application_no_op, true);
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.element_capture_planning_bundle_path,
    'source-artifacts/element-capture-planning-bundle.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.element_clip_manifest_path,
    'source-artifacts/element-clip-manifest.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.planned_element_clip_manifest_path,
    'source-artifacts/element-clip-manifest.planned.json',
  );
  assert.equal(
    sources.employer_brand_comparative_audit_data_bundle.element_clip_acceptance_report_path,
    'source-artifacts/element-clip-acceptance-report.json',
  );
  assert.equal(sources.element_capture_planning_bundle.path, 'source-artifacts/element-capture-planning-bundle.json');
  assert.equal(sources.element_capture_planning_bundle.work_unit_count, 37);
  assert.equal(sources.element_capture_planning_bundle.actual_clip_count, 16);
  assert.equal(sources.element_capture_planning_bundle.acceptance_report_status, 'accepted_with_blockers');
  assert.equal(sources.element_capture_planning_bundle.acceptance_failed_count, 0);
  assert.equal(sources.element_clip_acceptance_report.path, 'source-artifacts/element-clip-acceptance-report.json');
  assert.equal(sources.element_clip_acceptance_report.verifier_only, true);
  assert.equal(sources.element_capture_planning_bundle.local_spv5_html_only, true);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.read_only, true);
  assert.equal(sources.employer_brand_comparative_audit_data_bundle.provenance_only, true);
});

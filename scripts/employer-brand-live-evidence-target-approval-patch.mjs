#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_SCHEMA_VERSION,
  EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_TYPE,
  applyEmployerBrandLiveEvidenceTargetApprovalPatch,
  validateEmployerBrandLiveEvidenceTargetApprovalPatch,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-target-approval-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultPatchOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-approval-patch.json';
const defaultReviewedOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-target-plan.json';
const createdAt = '2026-05-08T00:00:00Z';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-target-approval-patch.mjs [--fixture-root <dir>] [--patch-out <file>] [--reviewed-out <file>]

Builds the Employer Brand Live Evidence Target Approval Patch V0 fixture and
applies it to the original target plan to write a derived reviewed target plan.
This is deterministic data shaping only; it does not browse websites, check URLs,
resolve locators, run codegen, capture screenshots, generate clips, render
reports, export files, or run workflows.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    patchOut: defaultPatchOut,
    reviewedOut: defaultReviewedOut,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--patch-out') {
      args.patchOut = argv[index + 1];
      index += 1;
    } else if (arg === '--reviewed-out') {
      args.reviewedOut = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function basePatch(plan, reviewPack) {
  const reviewer = {
    reviewer_id: 'reviewer:gdi-fixture',
    reviewer_name: 'GDI Fixture Reviewer',
    reviewer_role: 'human_approval_proxy',
  };
  const rejectIds = new Set([
    'live-target:symphony-talent:review-platforms',
    'live-target:phenom:review-platforms',
    'live-target:radancy:review-platforms',
  ]);
  const draftIds = new Set([
    'live-target:symphony-talent:employee-stories',
    'live-target:phenom:employee-stories',
  ]);
  const editById = new Map([
    ['live-target:symphony-talent:careers-site', {
      desired_element: 'Human-selected careers homepage hero or EVP proof block that states the employer promise without capturing the full page.',
      evidence_goal: 'Confirm Symphony Talent career-site positioning and visible employee value proposition proof for KILOS scoring.',
      kilos_relevance: ['impact', 'opportunity'],
      expected_clip_count: 2,
      acceptance_criteria: [
        'The captured evidence is scoped to one visible careers-site element, not the full page.',
        'The element includes enough surrounding heading or label text to understand the employer promise out of context.',
        'The element can be reviewed against Impact and Opportunity before capture execution.',
      ],
      notes: 'Approved with tightened target text and two expected element clips for later readiness planning.',
    }],
    ['live-target:phenom:linkedin-presence', {
      desired_element: 'Human-selected LinkedIn Life, Jobs, or recent hiring-proof element that demonstrates talent-facing status or impact.',
      kilos_relevance: ['status', 'impact', 'opportunity'],
      notes: 'Adds Opportunity because hiring proof may carry growth and career path signals.',
    }],
    ['live-target:radancy:awards-recognition', {
      evidence_goal: 'Identify awards, analyst recognition, or public proof that supports Radancy status and market credibility.',
      acceptance_criteria: [
        'The captured evidence is scoped to a recognition, award, or credibility element.',
        'The element visibly names the proof point or recognition source.',
        'The element preserves surrounding context needed to compare Status and Impact signals.',
      ],
    }],
  ]);

  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_TARGET_APPROVAL_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-target-approval-patch:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Comparative Audit Live Evidence Target Approval Patch',
    status: 'approved',
    target_plan_ref: {
      target_plan_id: plan.id,
      target_plan_path: 'live-evidence-target-plan.json',
      target_plan_schema: 'shared/schemas/employer-brand-live-evidence-target-plan-v0.schema.json',
      read_only: true,
      planning_metadata_only: true,
    },
    review_pack_ref: {
      review_pack_id: reviewPack.id,
      review_pack_path: 'live-evidence-target-review-pack.json',
      review_pack_schema: 'shared/schemas/employer-brand-live-evidence-target-review-pack-v0.schema.json',
      read_only: true,
      planning_metadata_only: true,
    },
    reviewer,
    reviewed_at: createdAt,
    decisions: plan.targets.map((target) => ({
      target_id: target.target_id,
      decision: rejectIds.has(target.target_id) ? 'reject' : draftIds.has(target.target_id) ? 'keep_draft' : 'approve',
      reviewer_notes: rejectIds.has(target.target_id)
        ? 'Rejected in this reviewed plan because review-platform targets need separate human source selection before readiness.'
        : draftIds.has(target.target_id)
          ? 'Kept as draft pending more specific page selection before locator work.'
          : 'Approved for later locator planning after this data-only review.',
      edits: editById.get(target.target_id) || {},
    })),
    controls: {
      live_browser_collection: false,
      url_reachability_check: false,
      locator_codegen: false,
      screenshot_capture: false,
      clip_generation: false,
      report_rendering: false,
      html_css_polish: false,
      pdf_docx_export: false,
      workflow_execution: false,
      full_page_grabs: false,
    },
    provenance: {
      created_at: createdAt,
      human_decision_layer: true,
      planning_metadata_only: true,
      read_only: true,
      live_evidence_collected: false,
      url_reachability_checked: false,
      locators_resolved: false,
      locator_codegen_executed: false,
      screenshots_captured: false,
      clips_generated: false,
      report_rendered: false,
      exports_generated: false,
      workflow_executed: false,
      non_goals: [
        'live_browser_collection',
        'url_reachability_check',
        'locator_codegen',
        'screenshot_capture',
        'clip_generation',
        'report_rendering',
        'html_css_polish',
        'pdf_docx_export',
        'workflow_execution',
        'full_page_grabs',
      ],
    },
  };
}

function writeJson(relativePath, value) {
  const out = path.resolve(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const plan = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-plan.json'), 'utf8'));
  const reviewPack = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-review-pack.json'), 'utf8'));
  const patch = basePatch(plan, reviewPack);
  const patchValidation = validateEmployerBrandLiveEvidenceTargetApprovalPatch(patch);
  if (!patchValidation.valid) throw new Error(`Live evidence target approval patch validation failed: ${patchValidation.errors.join('; ')}`);
  const reviewedPlan = applyEmployerBrandLiveEvidenceTargetApprovalPatch(plan, patch, {
    reviewPackInput: reviewPack,
    derivedAt: createdAt,
  });
  writeJson(args.patchOut, patch);
  writeJson(args.reviewedOut, reviewedPlan);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

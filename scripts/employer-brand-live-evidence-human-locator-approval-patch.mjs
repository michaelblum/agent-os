#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_SCHEMA_VERSION,
  EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_TYPE,
  applyEmployerBrandLiveEvidenceHumanLocatorApprovalPatch,
  validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-human-locator-approval-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultPatchOut = `${defaultFixtureRoot}/live-evidence-human-locator-approval-patch.json`;
const defaultReadinessOut = `${defaultFixtureRoot}/live-evidence-locator-readiness.reviewed.json`;
const reviewedAt = '2026-05-08T00:00:00Z';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-human-locator-approval-patch.mjs [--fixture-root <dir>] [--patch-out <file>] [--readiness-out <file>]

Builds the Human Locator Approval Patch V0 fixture and applies it to the
pre-approval locator-readiness fixture. This is data-only patch application; it
does not open URLs, execute locators, run codegen, capture screenshots, generate
clips, render reports, export files, crawl, or bypass controls.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    patchOut: defaultPatchOut,
    readinessOut: defaultReadinessOut,
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
    } else if (arg === '--readiness-out') {
      args.readinessOut = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function reviewItems(pack) {
  return pack.groups.flatMap((group) => group.source_categories.flatMap((source) => source.review_items));
}

function decision(item, decisionName, rest = {}) {
  return {
    review_item_id: item.review_item_id,
    target_id: item.target_id,
    work_unit_id: item.work_unit_id,
    decision: decisionName,
    locator: {},
    human_notes: rest.human_notes || null,
    ...rest,
  };
}

function fixturePatch(reviewPack) {
  const byTarget = new Map(reviewItems(reviewPack).map((item) => [item.target_id, item]));
  const decisions = [
    decision(byTarget.get('live-target:symphony-talent:careers-site'), 'approve_selector', {
      locator: { selector: '[data-testid="hero-employer-brand"], main section.hero' },
      human_notes: 'Operator approved the careers homepage hero/EVP block selector for later supervised capture.',
    }),
    decision(byTarget.get('live-target:symphony-talent:linkedin-presence'), 'provide_playwright_locator', {
      locator: { playwright_locator: "page.getByRole('heading', { name: /Symphony Talent/i }).first()" },
      human_notes: 'Operator supplied a role-based locator for the LinkedIn company identity heading.',
    }),
    decision(byTarget.get('live-target:symphony-talent:employee-stories'), 'refine_natural_language_target', {
      refined_desired_element: 'Find a visible employee story, quote, or talent community proof block linked from the Symphony Talent careers experience.',
      human_notes: 'No locator approved yet; the human clarified what a later supervised pass should find.',
    }),
    decision(byTarget.get('live-target:phenom:careers-site'), 'edit_selector', {
      locator: { selector: 'main [data-component="hero"], main .hero' },
      human_notes: 'Operator edited the selector to include the main hero component fallback only.',
    }),
    decision(byTarget.get('live-target:phenom:employee-stories'), 'mark_blocked', {
      blocker_reason: 'Human reviewer could not identify a stable employee-story target without choosing a new source page.',
      human_notes: 'Blocked for this patch; no locator value is approved.',
    }),
    decision(byTarget.get('live-target:radancy:careers-site'), 'provide_xpath', {
      locator: { xpath: "//main//*[self::section or self::div][.//*[contains(normalize-space(.), 'Talent Acquisition')]][1]" },
      human_notes: 'Operator supplied a scoped XPath for the careers-site value proposition block.',
    }),
    decision(byTarget.get('live-target:radancy:linkedin-presence'), 'reject_target', {
      human_notes: 'Rejected from locator readiness because the LinkedIn page target duplicates other employer-presence evidence.',
    }),
    decision(byTarget.get('live-target:radancy:social-campaigns'), 'keep_draft', {
      human_notes: 'Kept draft until a human chooses the exact campaign example to capture.',
    }),
  ];
  return {
    type: EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_TYPE,
    schema_version: EMPLOYER_BRAND_LIVE_EVIDENCE_HUMAN_LOCATOR_APPROVAL_PATCH_SCHEMA_VERSION,
    id: 'live-evidence-human-locator-approval-patch:symphony-talent-phenom-radancy',
    label: 'Symphony Talent Employer Brand Comparative Audit Human Locator Approval Patch',
    status: 'reviewed',
    review_pack_ref: {
      review_pack_id: reviewPack.id,
      review_pack_path: 'live-evidence-human-locator-review-pack.json',
      review_pack_schema: 'shared/schemas/employer-brand-live-evidence-human-locator-review-pack-v0.schema.json',
      read_only: true,
      planning_metadata_only: true,
    },
    reviewer: {
      reviewer_id: 'reviewer:gdi-fixture',
      reviewer_name: 'GDI Fixture Reviewer',
      reviewer_role: 'human_locator_operator',
    },
    reviewed_at: reviewedAt,
    decisions,
    controls: {
      locator_execution: false,
      codegen_execution: false,
      url_opening: false,
      screenshot_capture: false,
      element_clip_generation: false,
      capture_execution: false,
      report_rendering: false,
      export_execution: false,
      workflow_engine: false,
      full_page_grabs: false,
      autonomous_crawling: false,
      bypasses: false,
    },
    provenance: {
      created_at: reviewedAt,
      explicit_human_locator_approval_required: true,
      unconfirmed_machine_candidates_do_not_promote: true,
      read_only: true,
      planning_metadata_only: true,
      no_locator_execution: true,
      no_codegen_execution: true,
      no_url_opening: true,
      no_screenshots: true,
      no_element_clips: true,
      no_capture_execution: true,
      no_report_renderer: true,
      no_export_work: true,
      no_workflow_engine: true,
      no_full_page_grabs: true,
      no_autonomous_crawling_or_bypasses: true,
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
  const reviewPack = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json'), 'utf8'));
  const locatorReadiness = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-locator-readiness.json'), 'utf8'));
  const patch = fixturePatch(reviewPack);
  const patchValidation = validateEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(patch, reviewPack);
  if (!patchValidation.valid) throw new Error(`Human locator approval patch validation failed: ${patchValidation.errors.join('; ')}`);
  const derivedReadiness = applyEmployerBrandLiveEvidenceHumanLocatorApprovalPatch(locatorReadiness, patch, {
    reviewPackInput: reviewPack,
    derivedAt: reviewedAt,
  });
  writeJson(args.patchOut, patch);
  writeJson(args.readinessOut, derivedReadiness);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

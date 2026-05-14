#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultManifest = 'source-artifacts/live-evidence-element-clip-manifest.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-locator-rereview-needed.mjs [--fixture-root <dir>] [--manifest <file>] [--json]

Reads the live evidence element clip manifest and lists only failed reviewed
locator slots that require human locator re-review. This command is read-only:
it does not browse, capture, resolve locators, generate code, take screenshots,
render reports, export files, or run workflow automation.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    manifest: defaultManifest,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--manifest') {
      args.manifest = argv[index + 1];
      index += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildRereviewNeeded(manifest) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const failed = entries.filter((entry) => (
    entry.status === 'failed'
    && entry.required_next_action === 'human_review_new_locator_required'
  ));
  return {
    type: 'aos.employer_brand_live_evidence_locator_rereview_needed',
    source_manifest_id: manifest.id || null,
    source_manifest_status: manifest.status || null,
    source_manifest_summary: manifest.summary || null,
    required_next_action: 'human_review_new_locator_required',
    count: failed.length,
    slots: failed.map((entry) => ({
      slot_id: entry.slot_id,
      target_id: entry.target_id,
      work_unit_id: entry.work_unit_id,
      company: entry.company,
      source_category: entry.source_category,
      original_url: entry.original_url,
      final_url: entry.final_url,
      reviewed_locator: entry.reviewed_locator,
      locator_provenance: entry.locator_provenance,
      blocker_reason: entry.blocker_reason,
      required_next_action: entry.required_next_action,
      match_count: entry.capture_metadata?.match_count ?? null,
      total_frame_match_count: entry.capture_metadata?.total_frame_match_count ?? null,
      frame_count: entry.capture_metadata?.frame_count ?? null,
      title: entry.capture_metadata?.title ?? null,
      current_url: entry.capture_metadata?.current_url ?? null,
      acceptance_criteria_refs: entry.acceptance_criteria_refs || [],
      kilos_relevance: entry.kilos_relevance || [],
      citation_source_metadata: entry.citation_source_metadata || null,
    })),
    controls: {
      read_only: true,
      reviewed_locator_only: true,
      no_browsing: true,
      no_locator_resolution: true,
      no_locator_codegen: true,
      no_screenshots: true,
      no_full_page_grabs: true,
      no_report_rendering: true,
      no_exports: true,
      no_workflow_automation: true,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const manifestPath = path.isAbsolute(args.manifest)
    ? args.manifest
    : path.join(fixtureRoot, args.manifest);
  const payload = buildRereviewNeeded(readJson(manifestPath));
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`${payload.count} failed reviewed-locator slots require human locator re-review`);
  for (const slot of payload.slots) {
    console.log(`- ${slot.slot_id}: ${slot.company} ${slot.source_category} (${slot.blocker_reason})`);
  }
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

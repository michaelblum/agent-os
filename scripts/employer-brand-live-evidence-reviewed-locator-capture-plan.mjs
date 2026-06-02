#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
  validateEmployerBrandLiveEvidenceReviewedLocatorCapturePlan,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-reviewed-locator-capture-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-reviewed-locator-capture-plan.mjs [--fixture-root <dir>] [--out <file>]

Builds the Employer Brand Reviewed Locator Capture Plan V0 from reviewed
locator readiness and human locator approval fixtures. This is pre-capture
planning only; it does not open URLs, resolve locators, run codegen, capture
screenshots, create clips, extract text, render reports, export files, run
workflows, grab full pages, crawl, or bypass site controls.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: defaultOut,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const out = path.resolve(repoRoot, args.out);
  const plan = buildEmployerBrandLiveEvidenceReviewedLocatorCapturePlan({
    reviewedLocatorReadiness: readJson(path.join(fixtureRoot, 'live-evidence-locator-readiness.reviewed.json')),
    humanLocatorApprovalPatch: readJson(path.join(fixtureRoot, 'live-evidence-human-locator-approval-patch.json')),
    humanLocatorReviewPack: readJson(path.join(fixtureRoot, 'live-evidence-human-locator-review-pack.json')),
    urlOpenRun: readJson(path.join(fixtureRoot, 'live-evidence-url-open-run.json')),
    reviewedTargetPlan: readJson(path.join(fixtureRoot, 'live-evidence-target-plan.reviewed.json')),
    targetPlan: readJsonIfExists(path.join(fixtureRoot, 'live-evidence-target-plan.json')),
    dataBundle: readJsonIfExists(path.join(fixtureRoot, 'data-bundle.json')),
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceReviewedLocatorCapturePlan(plan);
  if (!validation.valid) {
    throw new Error(`Reviewed locator capture plan validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

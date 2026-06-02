#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceLocatorReadiness,
  validateEmployerBrandLiveEvidenceLocatorReadiness,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-locator-readiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-locator-readiness.mjs [--fixture-root <dir>] [--out <file>]

Builds the Employer Brand Live Evidence Locator Readiness V0 bundle from the
reviewed live evidence target plan and approval patch. This is a planning gate
only; it does not browse websites, check URLs, run locator codegen, capture
screenshots, generate clips, render reports, export files, or run workflows.`;
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

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function reviewedTargetPlanInput(fixtureRoot) {
  for (const basename of ['live-evidence-target-plan.reviewed.json', 'live-evidence-reviewed-target-plan.json']) {
    const file = path.join(fixtureRoot, basename);
    if (fs.existsSync(file)) {
      return {
        basename,
        value: JSON.parse(fs.readFileSync(file, 'utf8')),
      };
    }
  }
  throw new Error('Missing reviewed target plan input');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const out = path.resolve(repoRoot, args.out);
  const reviewedPlanInput = reviewedTargetPlanInput(fixtureRoot);
  const readiness = buildEmployerBrandLiveEvidenceLocatorReadiness({
    reviewedTargetPlan: reviewedPlanInput.value,
    approvalPatch: JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json'), 'utf8')),
    reviewPack: readJsonIfExists(path.join(fixtureRoot, 'live-evidence-target-review-pack.json')),
    dataBundle: readJsonIfExists(path.join(fixtureRoot, 'data-bundle.json')),
    urlReachabilityCheck: readJsonIfExists(path.join(fixtureRoot, 'live-evidence-url-reachability-check.json')),
    createdAt: '2026-05-08T00:00:00Z',
    reviewedTargetPlanPath: reviewedPlanInput.basename,
  });
  const validation = validateEmployerBrandLiveEvidenceLocatorReadiness(readiness);
  if (!validation.valid) {
    throw new Error(`Locator readiness validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(readiness, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

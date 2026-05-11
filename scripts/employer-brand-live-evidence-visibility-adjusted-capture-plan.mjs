#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
  loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlanInputs,
  validateEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
  writeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-visibility-adjusted-capture-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-visibility-adjusted-capture-plan.mjs [--fixture-root <dir>] [--out <file>]

Builds the deterministic visibility-adjusted capture plan from the filled
visibility repair patch. This is a planning/provenance step only: it opens no
URLs, runs no capture, resolves no locators, creates no screenshots/clips/text
assets, and keeps full_page_grab=false.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: 'live-evidence-visibility-adjusted-capture-plan.json',
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const inputs = loadEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlanInputs({ fixtureRoot });
  const plan = buildEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(inputs, {
    createdAt: '2026-05-09T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(plan);
  if (!validation.valid) {
    throw new Error(`Visibility-adjusted capture plan validation failed: ${validation.errors.join('; ')}`);
  }
  const out = writeEmployerBrandLiveEvidenceVisibilityAdjustedCapturePlan(plan, {
    fixtureRoot,
    outPath: args.out,
  });
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

main();

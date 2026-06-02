#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceTargetReviewPackFromPlan,
  validateEmployerBrandLiveEvidenceTargetReviewPack,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-target-review-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-review-pack.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-target-review-pack.mjs [--fixture-root <dir>] [--out <file>]

Builds the Employer Brand Live Evidence Target Review Pack V0 fixture from the
checked-in live evidence target plan. This is deterministic review metadata
only; it does not browse URLs, check reachability, resolve locators, run codegen,
capture screenshots, generate clips, render reports, export files, or execute workflows.`;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const targetPlan = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-target-plan.json'), 'utf8'));
  const reviewPack = buildEmployerBrandLiveEvidenceTargetReviewPackFromPlan(targetPlan, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceTargetReviewPack(reviewPack);
  if (!validation.valid) {
    throw new Error(`Live evidence target review pack validation failed: ${validation.errors.join('; ')}`);
  }

  const out = path.resolve(repoRoot, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(reviewPack, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

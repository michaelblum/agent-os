#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceHumanLocatorReviewPack,
  validateEmployerBrandLiveEvidenceHumanLocatorReviewPack,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-human-locator-review-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-human-locator-review-pack.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-human-locator-review-pack.mjs [--fixture-root <dir>] [--out <file>]

Builds the Employer Brand Human Locator Review Pack V0 from durable planning and
URL-open metadata. It does not execute locators, codegen, URL opens,
screenshots, element clips, capture, report rendering, exports, workflows,
full-page grabs, crawling, or bypasses.`;
}

function parseArgs(argv) {
  const args = { fixtureRoot: defaultFixtureRoot, out: defaultOut };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--fixture-root') {
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

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const pack = buildEmployerBrandLiveEvidenceHumanLocatorReviewPack({
    locatorResolutionResult: readJson(fixtureRoot, 'live-evidence-locator-resolution-result.json'),
    locatorReadiness: readJson(fixtureRoot, 'live-evidence-locator-readiness.json'),
    supervisedLocatorPlan: readJson(fixtureRoot, 'live-evidence-supervised-locator-plan.json'),
    reviewedTargetPlan: readJson(fixtureRoot, 'live-evidence-target-plan.reviewed.json'),
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceHumanLocatorReviewPack(pack);
  if (!validation.valid) {
    throw new Error(`Human locator review pack validation failed: ${validation.errors.join('; ')}`);
  }
  const out = path.resolve(repoRoot, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

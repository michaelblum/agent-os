#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceLocatorResolutionResult,
  resolveLocatorFromDurableUrlOpenMetadata,
  validateEmployerBrandLiveEvidenceLocatorResolutionResult,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-locator-resolution-result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-resolution-result.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-locator-resolution-result.mjs [--fixture-root <dir>] [--out <file>] [--execute]

Builds the Employer Brand Live Evidence Locator Resolution Result V0 from the
supervised locator plan and URL-open run. Without --execute, this emits a
blocked/not-run planning fixture and never attempts locator resolution.

--execute only enables the helper execution gate; this CLI still requires an
injectable resolver in code/tests for confident selectors. The built-in
metadata-only resolver records eligible attempts without inventing selectors and
does not browse, screenshot, clip, render, export, run workflows, perform
full-page grabs, crawl, or bypass blockers.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: defaultOut,
    execute: false,
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
    } else if (arg === '--execute') {
      args.execute = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const out = path.resolve(repoRoot, args.out);
  const result = await buildEmployerBrandLiveEvidenceLocatorResolutionResult({
    supervisedLocatorPlan: readJson(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json')),
    urlOpenRun: readJson(path.join(fixtureRoot, 'live-evidence-url-open-run.json')),
    execute: args.execute,
    resolveLocator: args.execute ? resolveLocatorFromDurableUrlOpenMetadata : null,
    resolvedAt: args.execute ? '2026-05-08T00:00:00Z' : null,
    reviewedBy: args.execute ? 'gdi-supervised-locator-resolution-v0' : null,
  });
  const validation = validateEmployerBrandLiveEvidenceLocatorResolutionResult(result);
  if (!validation.valid) {
    throw new Error(`Locator resolution result validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

main().catch((caught) => {
  console.error(caught.message);
  process.exitCode = 1;
});

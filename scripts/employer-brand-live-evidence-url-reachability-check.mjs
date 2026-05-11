#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceUrlReachabilityCheck,
  validateEmployerBrandLiveEvidenceUrlReachabilityCheck,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-url-reachability-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-reachability-check.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-url-reachability-check.mjs [--fixture-root <dir>] [--out <file>] [--without-url-open-run]

Builds the Employer Brand Live Evidence URL Reachability Check V0 fixture from
the supervised locator plan and, by default when present, the checked-in URL-open
run. This script does not open URLs, resolve locators, run codegen, capture
screenshots, create clips, render reports, export files, run workflows, or
perform full-page grabs.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: defaultOut,
    useUrlOpenRun: true,
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
    } else if (arg === '--without-url-open-run') {
      args.useUrlOpenRun = false;
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
  const out = path.resolve(repoRoot, args.out);
  const check = buildEmployerBrandLiveEvidenceUrlReachabilityCheck({
    supervisedLocatorPlan: JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'), 'utf8')),
    urlOpenRun: args.useUrlOpenRun && fs.existsSync(path.join(fixtureRoot, 'live-evidence-url-open-run.json'))
      ? JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-url-open-run.json'), 'utf8'))
      : null,
    createdAt: '2026-05-08T00:00:00Z',
    supervisedLocatorPlanPath: 'live-evidence-supervised-locator-plan.json',
  });
  const validation = validateEmployerBrandLiveEvidenceUrlReachabilityCheck(check);
  if (!validation.valid) {
    throw new Error(`URL reachability check validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(check, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

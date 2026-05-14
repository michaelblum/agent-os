#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceUrlOpenRun,
  validateEmployerBrandLiveEvidenceUrlOpenRun,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-url-open-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-url-open-run.mjs [--fixture-root <dir>] [--out <file>] [--execute] [--timeout-ms <ms>] [--operator <name>]

Builds the Employer Brand Live Evidence URL Open Run V0 artifact.

Without --execute, this writes a not_run fixture and performs no network work.
With --execute, it opens only each executable approved target URL with a bounded
timeout and redirect handling. It does not crawl, follow page links, resolve
locators, identify elements, run codegen, take screenshots, create clips, render
reports, export files, run workflows, perform full-page grabs, or bypass login,
paywall, CAPTCHA, or consent blockers.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: defaultOut,
    execute: false,
    timeoutMs: 10_000,
    operator: null,
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
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--operator') {
      args.operator = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 60_000) {
    throw new Error('--timeout-ms must be between 1000 and 60000');
  }

  return args;
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
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
  const run = await buildEmployerBrandLiveEvidenceUrlOpenRun({
    supervisedLocatorPlan: JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'live-evidence-supervised-locator-plan.json'), 'utf8')),
    urlReachabilityCheck: readJsonIfExists(path.join(fixtureRoot, 'live-evidence-url-reachability-check.json')),
    approvalPatch: readJsonIfExists(path.join(fixtureRoot, 'live-evidence-target-approval-patch.json')),
    execute: args.execute,
    checkedAt: args.execute ? new Date().toISOString() : '2026-05-08T00:00:00Z',
    timeoutMs: args.timeoutMs,
    operator: args.operator,
  });
  const validation = validateEmployerBrandLiveEvidenceUrlOpenRun(run);
  if (!validation.valid) {
    throw new Error(`URL open run validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
  if (!args.execute) {
    console.log('network execution skipped; pass --execute for bounded supervised URL opening');
  }
}

main().catch((caught) => {
  console.error(caught.message);
  process.exitCode = 1;
});

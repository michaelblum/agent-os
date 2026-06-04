#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeEmployerBrandReviewedLiveElementCapture,
  validateEmployerBrandLiveEvidenceElementClipManifest,
  writeEmployerBrandLiveEvidenceElementClipManifest,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-element-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultCapturePlan = 'live-evidence-reviewed-locator-capture-plan.json';
const defaultOut = 'source-artifacts/live-evidence-element-clip-manifest.json';
const requiredGate = 'execute-reviewed-live-element-capture-v0';

function usage() {
  return `Usage: node scripts/employer-brand-reviewed-live-element-capture.mjs --execution-gate ${requiredGate} [--fixture-root <dir>] [--capture-plan <file>] [--out <file>] [--playwright-cli <cmd>] [--dry-run]

Executes only the 4 reviewed locator-ready live capture units and 5 planned
output slots from the reviewed locator capture plan. It opens only approved
original/final URLs, uses only reviewed locator values, captures element clips
only, writes required text extracts, and preserves non-executable context as
blocked/not-run manifest entries.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    capturePlan: defaultCapturePlan,
    out: defaultOut,
    playwrightCli: 'playwright-cli',
    executionGate: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--capture-plan') {
      args.capturePlan = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--playwright-cli') {
      args.playwrightCli = argv[index + 1];
      index += 1;
    } else if (arg === '--execution-gate') {
      args.executionGate = argv[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
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
  const capturePlanPath = path.isAbsolute(args.capturePlan)
    ? args.capturePlan
    : path.join(fixtureRoot, args.capturePlan);
  const manifest = await executeEmployerBrandReviewedLiveElementCapture(readJson(capturePlanPath), {
    fixtureRoot,
    manifestPath: args.out,
    playwrightCli: args.playwrightCli,
    capturedAt: new Date().toISOString(),
    executionGate: args.executionGate,
    dryRun: args.dryRun,
  });
  const validation = validateEmployerBrandLiveEvidenceElementClipManifest(manifest);
  if (!args.dryRun && !validation.valid) {
    throw new Error(`Live element clip manifest validation failed: ${validation.errors.join('; ')}`);
  }
  const absoluteOut = writeEmployerBrandLiveEvidenceElementClipManifest(manifest, {
    fixtureRoot,
    manifestPath: args.out,
  });
  console.log(`wrote ${path.relative(repoRoot, absoluteOut).split(path.sep).join('/')}`);
  console.log(`captured ${manifest.summary.captured_slot_count}/${manifest.summary.planned_output_slot_count} planned slots; preserved ${manifest.summary.blocked_not_run_count} blocked/not-run context entries`);
}

main().catch((caught) => {
  console.error(caught.message);
  process.exitCode = 1;
});

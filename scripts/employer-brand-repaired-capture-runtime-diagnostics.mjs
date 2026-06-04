#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandRepairedCaptureRuntimeDiagnostics,
  validateEmployerBrandRepairedCaptureRuntimeDiagnostics,
  writeEmployerBrandRepairedCaptureRuntimeDiagnostics,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-repaired-capture-runtime-diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'live-evidence-repaired-capture-runtime-diagnostics.json';

function usage() {
  return `Usage: node scripts/employer-brand-repaired-capture-runtime-diagnostics.mjs [--fixture-root <dir>] [--out <file>]

Builds deterministic repaired capture runtime diagnostics from the checked-in
failed repaired-run manifest and repaired locator capture plan. This is
read-only provenance shaping only; it does not open URLs, run Playwright,
resolve locators, capture screenshots, render reports, or export files.`;
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
  const diagnostics = loadEmployerBrandRepairedCaptureRuntimeDiagnostics({
    fixtureRoot,
    createdAt: '2026-05-09T00:44:37.770Z',
  });
  const validation = validateEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics);
  if (!validation.valid) {
    throw new Error(`Runtime diagnostics validation failed: ${validation.errors.join('; ')}`);
  }
  const out = writeEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics, {
    fixtureRoot,
    diagnosticsPath: args.out,
  });
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

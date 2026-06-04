#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandElementClipAcceptanceReport,
  validateEmployerBrandElementClipAcceptanceReport,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-element-clip-acceptance-verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-clip-acceptance-report.json';

function usage() {
  return `Usage: node scripts/employer-brand-element-clip-acceptance-report.mjs [--fixture-root <dir>] [--out <file>]

Builds the read-only Employer Brand Element Clip Acceptance Verification V0
fixture from the checked-in planning bundle, populated clip manifest, planned
clip manifest, and local clip/text assets. This verifier only reads metadata and
files; it does not capture clips, browse, execute PDF/PPTX capture, render
reports, run workflows, export files, or perform full-page grabs.`;
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
  const out = path.resolve(repoRoot, args.out);
  const report = loadEmployerBrandElementClipAcceptanceReport({
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandElementClipAcceptanceReport(report);
  if (!validation.valid) {
    throw new Error(`Acceptance report validation failed: ${validation.errors.join('; ')}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

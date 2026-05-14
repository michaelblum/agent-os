#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyEmployerBrandLiveEvidenceElementClipManifestObjective,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultManifest = 'source-artifacts/live-evidence-element-clip-manifest.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-element-clip-verify.mjs [--fixture-root <dir>] [--manifest <file>] [--json]

Verifies the checked-in live evidence element clip manifest against the
Employer Brand Supervised Live Element Capture V0 objective gates. This command
is read-only: it does not browse, capture screenshots, resolve locators, render
reports, export files, or run workflow automation.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    manifest: defaultManifest,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--manifest') {
      args.manifest = argv[index + 1];
      index += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const manifestPath = path.isAbsolute(args.manifest)
    ? args.manifest
    : path.join(fixtureRoot, args.manifest);
  const result = verifyEmployerBrandLiveEvidenceElementClipManifestObjective(readJson(manifestPath), {
    fixtureRoot,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`live evidence element clip verification: ${result.status}`);
    for (const item of result.diagnostics) {
      console.log(`- ${item.code}: ${item.message}`);
    }
  }
  if (!result.passed) process.exitCode = 1;
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

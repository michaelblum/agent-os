#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandElementCapturePlanningBundle,
  normalizeEmployerBrandElementClipManifest,
  validateEmployerBrandElementCapturePlanningBundle,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-element-capture-planning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-capture-planning-bundle.json';
const defaultManifestOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-clip-manifest.planned.json';

function usage() {
  return `Usage: node scripts/employer-brand-element-capture-planning-bundle.mjs [--fixture-root <dir>] [--out <file>] [--manifest-out <file>]

Builds the planned-only Employer Brand Element Capture Planning Bundle V0 and
the empty Element Clip Manifest V0 skeleton. This is deterministic data shaping
only; it does not browse, screenshot, capture clips, render reports, run
workflows, or export files.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    out: defaultOut,
    manifestOut: defaultManifestOut,
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
    } else if (arg === '--manifest-out') {
      args.manifestOut = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function writeJson(relativePath, value) {
  const out = path.resolve(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const bundle = loadEmployerBrandElementCapturePlanningBundle({
    fixtureRoot,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandElementCapturePlanningBundle(bundle);
  if (!validation.valid) {
    throw new Error(`Planning bundle validation failed: ${validation.errors.join('; ')}`);
  }

  const manifest = normalizeEmployerBrandElementClipManifest({
    planningBundle: bundle,
    createdAt: '2026-05-08T00:00:00Z',
  });

  writeJson(args.out, bundle);
  writeJson(args.manifestOut, manifest);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeEmployerBrandLocalSpv5ElementCapture,
  writeEmployerBrandElementClipManifest,
} from '../packages/toolkit/workbench/employer-brand-element-capture-executor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultPlanningBundle = 'source-artifacts/element-capture-planning-bundle.json';
const defaultManifestOut = 'source-artifacts/element-clip-manifest.json';

function usage() {
  return `Usage: node scripts/employer-brand-local-spv5-element-capture.mjs [--fixture-root <dir>] [--planning-bundle <file>] [--out <file>] [--playwright-cli <cmd>]

Executes only locator-ready work units from source:spv5-html against the local
/Users/Michael/Desktop/SPv5.html artifact. PDF, PPTX, unresolved selectors,
remote web collection, report rendering, exports, workflows, and full-page
grabs remain out of scope.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    planningBundle: defaultPlanningBundle,
    out: defaultManifestOut,
    playwrightCli: 'playwright-cli',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--planning-bundle') {
      args.planningBundle = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--playwright-cli') {
      args.playwrightCli = argv[index + 1];
      index += 1;
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
  const planningBundlePath = path.isAbsolute(args.planningBundle)
    ? args.planningBundle
    : path.join(fixtureRoot, args.planningBundle);
  const manifest = executeEmployerBrandLocalSpv5ElementCapture(readJson(planningBundlePath), {
    fixtureRoot,
    manifestPath: args.out,
    playwrightCli: args.playwrightCli,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const absoluteOut = writeEmployerBrandElementClipManifest(manifest, {
    fixtureRoot,
    manifestPath: args.out,
  });
  console.log(`wrote ${path.relative(repoRoot, absoluteOut).split(path.sep).join('/')}`);
  console.log(`captured ${manifest.expected.captured_work_unit_count} local SPv5 work units; blocked ${manifest.expected.blocked_work_unit_count} planned slots remain`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

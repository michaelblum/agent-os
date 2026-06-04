#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject,
  validateEmployerBrandLiveEvidenceTargetPlan,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-target-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-target-plan.mjs [--fixture-root <dir>] [--out <file>]

Builds the draft Employer Brand Live Evidence Target Plan V0 fixture from
checked-in project intake. This is deterministic planning metadata only; it does
not browse websites, resolve locators, collect evidence, capture screenshots,
render reports, export files, or run workflows.`;
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
  const project = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'intake/project.json'), 'utf8'));
  const plan = buildDraftEmployerBrandLiveEvidenceTargetPlanFromProject(project, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceTargetPlan(plan);
  if (!validation.valid) {
    throw new Error(`Live evidence target plan validation failed: ${validation.errors.join('; ')}`);
  }

  const out = path.resolve(repoRoot, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, out).split(path.sep).join('/')}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

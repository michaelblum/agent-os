#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyEmployerBrandLiveEvidenceCaptureRepairPatch,
  buildEmployerBrandLiveEvidenceCaptureRepairPatch,
  loadEmployerBrandLiveEvidenceCaptureRepairPatchInputs,
  validateEmployerBrandLiveEvidenceCaptureRepairPatch,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-capture-repair-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultPatchOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json';
const defaultApplicationOut = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.application.json';

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-capture-repair-patch.mjs [--fixture-root <dir>] [--patch-out <file>] [--application-out <file>]

Builds the Employer Brand Live Evidence Capture Repair Patch V0 template and
the empty-patch application fixture from local review artifacts. This is a
deterministic HITL repair contract only; it does not open URLs, run browsers,
resolve locators, invent selectors, capture screenshots, create clips, extract
text, render reports, export documents, or execute workflows.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    patchOut: defaultPatchOut,
    applicationOut: defaultApplicationOut,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--patch-out') {
      args.patchOut = argv[index + 1];
      index += 1;
    } else if (arg === '--application-out') {
      args.applicationOut = argv[index + 1];
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
  const inputs = loadEmployerBrandLiveEvidenceCaptureRepairPatchInputs({ fixtureRoot });
  const patch = buildEmployerBrandLiveEvidenceCaptureRepairPatch(inputs, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const validation = validateEmployerBrandLiveEvidenceCaptureRepairPatch(patch, inputs.failureReviewPack);
  if (!validation.valid) {
    throw new Error(`Live evidence capture repair patch validation failed: ${validation.errors.join('; ')}`);
  }
  const application = applyEmployerBrandLiveEvidenceCaptureRepairPatch({
    patchInput: patch,
    failureReviewPackInput: inputs.failureReviewPack,
    reviewedLocatorReadinessInput: inputs.reviewedLocatorReadiness,
    elementClipManifestInput: inputs.manifest,
    appliedAt: '2026-05-08T00:00:00Z',
  });

  writeJson(args.patchOut, patch);
  writeJson(args.applicationOut, application);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

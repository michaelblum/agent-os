#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEmployerBrandLiveEvidenceCaptureRepairPromotion,
  loadEmployerBrandLiveEvidenceCaptureRepairPromotionInputs,
  validateEmployerBrandLiveEvidenceCaptureRepairPromotion,
  validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-capture-repair-promotion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultPromotionOut = `${defaultFixtureRoot}/live-evidence-capture-repair-promotion.json`;
const defaultPlanOut = `${defaultFixtureRoot}/live-evidence-repaired-locator-capture-plan.json`;

function usage() {
  return `Usage: node scripts/employer-brand-live-evidence-capture-repair-promotion.mjs [--fixture-root <dir>] [--promotion-out <file>] [--plan-out <file>]

Promotes filled Employer Brand live-evidence capture repair decisions into a
deterministic next capture-attempt plan. This is planning metadata only; it does
not open URLs, run browsers, resolve locators, capture screenshots, create
clips, extract text, render reports, export documents, or execute workflows.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    promotionOut: defaultPromotionOut,
    planOut: defaultPlanOut,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--promotion-out') {
      args.promotionOut = argv[index + 1];
      index += 1;
    } else if (arg === '--plan-out') {
      args.planOut = argv[index + 1];
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
  const inputs = loadEmployerBrandLiveEvidenceCaptureRepairPromotionInputs({ fixtureRoot });
  const promotion = buildEmployerBrandLiveEvidenceCaptureRepairPromotion(inputs, {
    createdAt: '2026-05-08T00:00:00Z',
  });
  const promotionValidation = validateEmployerBrandLiveEvidenceCaptureRepairPromotion(promotion);
  if (!promotionValidation.valid) {
    throw new Error(`Live evidence capture repair promotion validation failed: ${promotionValidation.errors.join('; ')}`);
  }
  const planValidation = validateEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(promotion.repaired_capture_plan);
  if (!planValidation.valid) {
    throw new Error(`Live evidence repaired locator capture plan validation failed: ${planValidation.errors.join('; ')}`);
  }

  writeJson(args.promotionOut, promotion);
  writeJson(args.planOut, promotion.repaired_capture_plan);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

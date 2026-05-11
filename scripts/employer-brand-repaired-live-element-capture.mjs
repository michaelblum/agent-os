#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkEmployerBrandPlaywrightBrowserReadiness,
  executeEmployerBrandRepairedLiveElementCapture,
  validateEmployerBrandLiveEvidenceElementClipManifest,
  writeEmployerBrandLiveEvidenceElementClipManifest,
} from '../packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultCapturePlan = 'live-evidence-visibility-adjusted-capture-plan.json';
const defaultOut = 'source-artifacts/live-evidence-element-clip-manifest.json';
const requiredGate = 'execute-repaired-live-element-capture-v0';

function usage() {
  return `Usage: node scripts/employer-brand-repaired-live-element-capture.mjs --execution-gate ${requiredGate} [--fixture-root <dir>] [--capture-plan <file>] [--out <file>] [--playwright-cli <cmd>] [--runner playwright-node-api|playwright-cli-run-code] [--timeout-ms <ms>] [--dry-run]
       node scripts/employer-brand-repaired-live-element-capture.mjs --check-browser-readiness [--playwright-cli <cmd>] [--timeout-ms <ms>] [--json]

Executes only the 4 Operator-approved repaired live evidence slots from the
visibility-adjusted capture plan. It preserves the LinkedIn source-unavailable slot
and all non-executable context entries as blocked/not-run, and it does not crawl,
resolve locators, run codegen, create full-page grabs, render reports, export
documents, run workflow automation, or bypass access controls. The default
runner uses Playwright's Node API with a local fixture smoke preflight before
any approved live URL can be opened. Browser readiness check mode is read-only:
it launches and closes local Playwright Chromium only, opens no live target URL,
and reports the exact missing browser executable path plus repair command when
the cache is incomplete.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    capturePlan: defaultCapturePlan,
    out: defaultOut,
    playwrightCli: 'playwright-cli',
    timeoutMs: 45_000,
    executionGate: null,
    dryRun: false,
    runnerType: 'playwright_node_api',
    checkBrowserReadiness: false,
    json: false,
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
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--runner') {
      const value = argv[index + 1];
      args.runnerType = value === 'playwright-cli-run-code' ? 'playwright_cli_run_code' : value.replace(/-/g, '_');
      index += 1;
    } else if (arg === '--execution-gate') {
      args.executionGate = argv[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--check-browser-readiness') {
      args.checkBrowserReadiness = true;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.checkBrowserReadiness) {
    const readiness = await checkEmployerBrandPlaywrightBrowserReadiness({
      playwrightCommand: args.playwrightCli === 'playwright-cli' ? 'playwright' : args.playwrightCli,
      timeoutMs: Math.min(args.timeoutMs, 10_000),
    });
    const payload = {
      status: readiness.status === 0 ? 'ready' : 'not_ready',
      ready: readiness.status === 0,
      readiness: readiness.readiness || null,
      runtime_metadata: readiness.runtime_metadata,
      stdout: readiness.stdout || '',
      stderr: readiness.stderr || '',
    };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (payload.ready) {
      console.log('Playwright browser readiness passed for the Node API runner.');
    } else {
      const missing = payload.runtime_metadata?.missing_browser_executable_path;
      const cache = payload.runtime_metadata?.browser_cache_path;
      const command = payload.runtime_metadata?.repair_command;
      console.log('Playwright browser readiness failed for the Node API runner.');
      if (missing) console.log(`missing executable: ${missing}`);
      if (cache) console.log(`cache path: ${cache}`);
      if (command) console.log(`repair command: ${command}`);
      if (!missing && payload.stderr) console.log(payload.stderr);
    }
    if (readiness.status !== 0) process.exitCode = 1;
    return;
  }

  const fixtureRoot = path.resolve(repoRoot, args.fixtureRoot);
  const capturePlanPath = path.isAbsolute(args.capturePlan)
    ? args.capturePlan
    : path.join(fixtureRoot, args.capturePlan);
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(readJson(capturePlanPath), {
    fixtureRoot,
    manifestPath: args.out,
    playwrightCli: args.playwrightCli,
    timeoutMs: args.timeoutMs,
    capturedAt: new Date().toISOString(),
    executionGate: args.executionGate,
    dryRun: args.dryRun,
    runnerType: args.runnerType,
  });
  const validation = validateEmployerBrandLiveEvidenceElementClipManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Repaired live element clip manifest validation failed: ${validation.errors.join('; ')}`);
  }
  const absoluteOut = writeEmployerBrandLiveEvidenceElementClipManifest(manifest, {
    fixtureRoot,
    manifestPath: args.out,
  });
  console.log(`wrote ${path.relative(repoRoot, absoluteOut).split(path.sep).join('/')}`);
  console.log(`captured ${manifest.summary.captured_slot_count}/${manifest.summary.planned_output_slot_count} repaired slots; failed ${manifest.summary.failed_slot_count}; preserved ${manifest.summary.blocked_not_run_count} unavailable/context entries`);
}

main().catch((caught) => {
  console.error(caught.message);
  process.exitCode = 1;
});

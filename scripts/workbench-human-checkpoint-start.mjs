#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildMarkdownLaunchFailedCheckpoint,
  buildMarkdownReadinessBlockedCheckpoint,
  buildMarkdownWorkbenchCheckpoint,
} from '../packages/toolkit/components/markdown-workbench/checkpoint.js';
import { markdownDiagnostics } from '../packages/toolkit/components/markdown-workbench/model.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = fileURLToPath(import.meta.url);

function outputSnippet(value, limit = 4000) {
  const normalized = String(value || '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

export function classifyLaunchOutput(stdout = '', stderr = '') {
  const output = `${stdout || ''}\n${stderr || ''}`;
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const signals = lines.filter((line) => (
    /content[-_ ]?root/i.test(line)
    && /(refresh|refreshed|restart|restarted|reload|reloaded)/i.test(line)
  ));
  return {
    content_root_refresh_restart_detected: signals.length > 0,
    content_root_refresh_restart_signals: signals.slice(0, 8),
  };
}

function commandText(parts = []) {
  return parts.map((part) => String(part)).join(' ');
}

export function buildLaunchAttemptRecord({
  step,
  command = '',
  exitCode = null,
  stdout = '',
  stderr = '',
  status = '',
  canvasId = '',
  message = '',
} = {}) {
  const record = {
    step,
    command,
    exit_code: Number.isInteger(exitCode) ? exitCode : null,
    stdout_snippet: outputSnippet(stdout),
    stderr_snippet: outputSnippet(stderr),
  };
  if (status) record.status = status;
  if (canvasId) record.canvas_id = canvasId;
  if (message) record.message = message;
  return {
    ...record,
    ...classifyLaunchOutput(stdout, stderr),
  };
}

export function buildSuccessfulLaunchMetadata({
  canvasId,
  launchAttempts = [],
  finalLaunchResult = 'usable',
  extra = {},
} = {}) {
  const refreshSignals = launchAttempts
    .flatMap((attempt) => attempt.content_root_refresh_restart_signals || [])
    .filter(Boolean);
  return {
    canvas_id_requested: canvasId,
    launch_attempts: launchAttempts,
    launch_result: {
      status: finalLaunchResult,
      canvas_id: canvasId,
      content_root_refresh_restart_detected: refreshSignals.length > 0,
      content_root_refresh_restart_signals: refreshSignals.slice(0, 8),
    },
    ...extra,
  };
}

function parseArgs(argv) {
  const out = { target: '', output: '', canvasId: 'markdown-workbench', readiness: 'run', createdBy: 'agent', attach: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') out.target = argv[++i] || '';
    else if (arg === '--output') out.output = argv[++i] || '';
    else if (arg === '--canvas-id') out.canvasId = argv[++i] || out.canvasId;
    else if (arg === '--created-by') out.createdBy = argv[++i] || out.createdBy;
    else if (arg === '--skip-readiness-explicit') out.readiness = 'skip';
    else if (arg === '--attach') out.attach = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!out.target) out.target = arg;
  }
  return out;
}

function usage() {
  console.log(`Usage: scripts/workbench-human-checkpoint-start.mjs --target <file|wiki:path> [--attach] [--output checkpoint.json] [--canvas-id id]

Runs ./aos ready unless --skip-readiness-explicit is supplied, launches the
Markdown Workbench or attaches to an existing canvas, and writes a Workbench
Human Checkpoint V0 record. Add structured annotation intent records later with
scripts/workbench-human-checkpoint-annotate.mjs before resume.`);
}

function runReadiness(mode) {
  if (mode === 'skip') {
    return {
      ready: true,
      record: {
        status: 'skipped_explicit',
        command: 'caller supplied explicit readiness gate',
        exit_code: null,
        diagnostics: {},
        repair_instructions: [],
      },
    };
  }
  const result = spawnSync('./aos', ['ready'], { cwd: repoRoot, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    ready: result.status === 0,
    record: {
      status: result.status === 0 ? 'ready' : 'blocked',
      command: './aos ready',
      exit_code: result.status,
      diagnostics: { output },
      repair_instructions: result.status === 0 ? [] : output.split('\n').filter(Boolean).slice(0, 12),
    },
  };
}

function readInitialTarget(target) {
  if (target.startsWith('wiki:')) {
    const wikiPath = target.replace(/^wiki:/, '');
    const result = spawnSync('./aos', ['wiki', 'show', wikiPath, '--json'], { cwd: repoRoot, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`failed to read wiki target ${wikiPath}: ${result.stderr || result.stdout}`);
    const page = JSON.parse(result.stdout);
    return {
      path: page.path,
      source: { kind: 'wiki', path: page.path, page: { path: page.path, frontmatter: page.frontmatter || {} } },
      content: String(page.raw || ''),
    };
  }
  const resolved = path.resolve(repoRoot, target);
  return {
    path: resolved,
    source: { kind: 'file', path: resolved },
    content: fs.readFileSync(resolved, 'utf8'),
  };
}

function readCanvasState(canvasId) {
  const result = spawnSync('./aos', ['show', 'eval', '--id', canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`failed to read canvas ${canvasId}: ${result.stderr || result.stdout}`);
  const outer = JSON.parse(result.stdout);
  const state = JSON.parse(outer.result || 'null');
  if (!state || typeof state !== 'object') throw new Error(`canvas ${canvasId} did not expose Markdown Workbench state`);
  return state;
}

function writeRecord(record, output) {
  const json = `${JSON.stringify(record, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(repoRoot, output), json);
  else process.stdout.write(json);
}

const args = parseArgs(process.argv.slice(2));
if (process.argv[1] !== modulePath) {
  // Imported for tests.
} else if (args.help || !args.target) {
  usage();
  process.exit(args.help ? 0 : 1);
} else {

const readiness = runReadiness(args.readiness);
if (!readiness.ready) {
  const record = buildMarkdownReadinessBlockedCheckpoint({
    target: args.target,
    readiness: readiness.record,
    createdBy: args.createdBy,
  });
  writeRecord(record, args.output);
  console.error('AOS readiness is blocked; no workbench surface was opened.');
  process.exit(2);
}

let initial;
let launchStatus = 'launched';
const launchAttempts = [];
if (args.attach) {
  try {
    initial = readCanvasState(args.canvasId);
    launchAttempts.push(buildLaunchAttemptRecord({
      step: 'verify_canvas_state',
      command: commandText(['./aos', 'show', 'eval', '--id', args.canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)']),
      exitCode: 0,
      status: 'usable',
      canvasId: args.canvasId,
    }));
    launchStatus = 'attached';
  } catch (error) {
    launchAttempts.push(buildLaunchAttemptRecord({
      step: 'verify_canvas_state',
      command: commandText(['./aos', 'show', 'eval', '--id', args.canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)']),
      exitCode: 1,
      status: 'failed',
      canvasId: args.canvasId,
      message: String(error?.message || error),
    }));
    const record = buildMarkdownLaunchFailedCheckpoint({
      target: args.target,
      readiness: readiness.record,
      launchStatus: 'attach_verify_failed',
      createdBy: args.createdBy,
      metadata: buildSuccessfulLaunchMetadata({
        canvasId: args.canvasId,
        launchAttempts,
        finalLaunchResult: 'failed',
      }),
    });
    writeRecord(record, args.output);
    console.error('Markdown Workbench attach verification failed; no usable surface was confirmed.');
    process.exit(3);
  }
} else {
  const launchCommand = commandText(['packages/toolkit/components/markdown-workbench/launch.sh', args.target]);
  const launch = spawnSync(
    'bash',
    ['packages/toolkit/components/markdown-workbench/launch.sh', args.target],
    {
      cwd: repoRoot,
      env: { ...process.env, CANVAS_ID: args.canvasId },
      encoding: 'utf8',
    },
  );
  launchAttempts.push(buildLaunchAttemptRecord({
    step: 'launch',
    command: launchCommand,
    exitCode: launch.status,
    stdout: launch.stdout,
    stderr: launch.stderr,
    status: launch.status === 0 ? 'completed' : 'failed',
  }));
  if (launch.status !== 0) {
    const record = buildMarkdownLaunchFailedCheckpoint({
      target: args.target,
      readiness: readiness.record,
      launchStatus: 'launch_command_failed',
      createdBy: args.createdBy,
      metadata: {
        canvas_id_requested: args.canvasId,
        launch_attempts: launchAttempts,
      },
    });
    writeRecord(record, args.output);
    console.error('Markdown Workbench launch failed; no usable surface was opened.');
    process.exit(3);
  }
  try {
    initial = readCanvasState(args.canvasId);
    launchAttempts.push(buildLaunchAttemptRecord({
      step: 'verify_canvas_state',
      command: commandText(['./aos', 'show', 'eval', '--id', args.canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)']),
      exitCode: 0,
      canvasId: args.canvasId,
      status: 'usable',
    }));
  } catch (error) {
    launchAttempts.push(buildLaunchAttemptRecord({
      step: 'verify_canvas_state',
      command: commandText(['./aos', 'show', 'eval', '--id', args.canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)']),
      exitCode: 1,
      canvasId: args.canvasId,
      status: 'failed',
      message: String(error?.message || error),
    }));
    const record = buildMarkdownLaunchFailedCheckpoint({
      target: args.target,
      readiness: readiness.record,
      launchStatus: 'launch_verify_failed',
      createdBy: args.createdBy,
      metadata: {
        canvas_id_requested: args.canvasId,
        launch_attempts: launchAttempts,
      },
    });
    writeRecord(record, args.output);
    console.error('Markdown Workbench launch verification failed; no usable surface was confirmed.');
    process.exit(3);
  }
}
const record = buildMarkdownWorkbenchCheckpoint({
  state: {
    path: initial.path,
    source: initial.source,
    content: initial.content,
    diagnostics: markdownDiagnostics(initial.content),
  },
  canvasId: args.canvasId,
  launchStatus,
  readiness: readiness.record,
  createdBy: args.createdBy,
  metadata: buildSuccessfulLaunchMetadata({
    canvasId: args.canvasId,
    launchAttempts,
    finalLaunchResult: launchStatus,
  }),
});
writeRecord(record, args.output);
console.error(record.handoff.instructions);
}

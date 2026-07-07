#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { GateContinuationStore, createDeferResponse } from '../../daemon/gate/continuations.js';

function usage() {
  return `Usage:
  aos gate defer --request gate-request.json --session-id <id> --harness codex [--role worker] [--entrypoint codex_exec_adapter] [--show] --json
  aos gate defer --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"approve_deny"}}' --session-id <id> --harness codex [--role worker] [--show]

	Creates a durable pending user-signal continuation and returns immediately.`;
}

function parseArgs(argv) {
  const parsed = {
    jsonOut: false,
    requestFile: null,
    requestJson: null,
    sessionId: null,
    harness: null,
    role: null,
    cwd: process.cwd(),
    resumePolicy: 'manual',
    adapterHint: 'codex_exec',
    entrypoint: 'codex_exec_adapter',
    show: false,
    help: false,
  };
  const nextValue = (index, flag) => {
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return [argv[index + 1], index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) parsed.requestJson = argv[++index];
      else parsed.jsonOut = true;
    } else if (arg === '--request') [parsed.requestFile, index] = nextValue(index, arg);
    else if (arg === '--session-id') [parsed.sessionId, index] = nextValue(index, arg);
    else if (arg === '--harness') [parsed.harness, index] = nextValue(index, arg);
    else if (arg === '--role') [parsed.role, index] = nextValue(index, arg);
    else if (arg === '--cwd') [parsed.cwd, index] = nextValue(index, arg);
    else if (arg === '--resume-policy') [parsed.resumePolicy, index] = nextValue(index, arg);
    else if (arg === '--adapter-hint') [parsed.adapterHint, index] = nextValue(index, arg);
    else if (arg === '--entrypoint') [parsed.entrypoint, index] = nextValue(index, arg);
    else if (arg === '--show') parsed.show = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (parsed.requestFile && parsed.requestJson) throw new Error('--request and inline --json conflict');
  return parsed;
}

async function requestFromArgs(args) {
  if (args.requestFile) return JSON.parse(await readFile(args.requestFile, 'utf8'));
  if (args.requestJson) return JSON.parse(args.requestJson);
  throw new Error('--request or inline --json request is required');
}

function requestParam(request) {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
}

function showDeferredSurface({ request, continuationId, aosPath = './aos' }) {
  return new Promise((resolve, reject) => {
    const url = `aos://toolkit/components/decision-gate/deferred.html?continuation_id=${encodeURIComponent(continuationId)}&requestB64=${encodeURIComponent(requestParam(request))}`;
    const canvasId = `deferred-${continuationId}`;
    const child = spawn(aosPath, ['show', 'create', '--id', canvasId, '--url', url, '--interactive', '--focus'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ canvas_id: canvasId, url });
      else reject(new Error(stderr.trim() || `${aosPath} show create exited ${code}`));
    });
  });
}

export async function runGateDefer(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  store = new GateContinuationStore(),
} = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!args.jsonOut && !args.requestJson) throw new Error('gate defer requires --json output');
    const request = await requestFromArgs(args);
    const record = await store.create({
      request,
      sessionId: args.sessionId,
      harness: args.harness,
      role: args.role,
      cwd: args.cwd,
      resumePolicy: args.resumePolicy,
      adapterHint: args.adapterHint,
      entrypoint: args.entrypoint,
    });
    const response = createDeferResponse(record);
    if (args.show) {
      response.surface = await showDeferredSurface({
        request,
        continuationId: record.continuation_id,
        aosPath: process.env.AOS_PATH || './aos',
      });
      response.next_action.human = 'Use the opened deferred gate surface, or submit later with aos gate submit --continuation-id <id> --request submission.json --json.';
    }
    stdout.write(`${JSON.stringify(response)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`aos gate defer: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateDefer();
}

#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { GateContinuationStore, createDeferResponse } from '../../daemon/gate/continuations.js';

function usage() {
  return `Usage:
  aos gate defer --request gate-request.json --session-id <id> --harness codex [--entrypoint codex_exec_adapter] --json
  aos gate defer --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"approve_deny"}}' --session-id <id> --harness codex

	Creates a durable pending user-signal continuation and returns immediately.`;
}

function parseArgs(argv) {
  const parsed = {
    jsonOut: false,
    requestFile: null,
    requestJson: null,
    sessionId: null,
    harness: null,
    dock: null,
    cwd: process.cwd(),
    resumePolicy: 'manual',
    adapterHint: 'codex_exec',
    entrypoint: 'codex_exec_adapter',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) parsed.requestJson = argv[++index];
      else parsed.jsonOut = true;
    } else if (arg === '--request') parsed.requestFile = argv[++index];
    else if (arg === '--session-id') parsed.sessionId = argv[++index];
    else if (arg === '--harness') parsed.harness = argv[++index];
    else if (arg === '--dock') parsed.dock = argv[++index];
    else if (arg === '--cwd') parsed.cwd = argv[++index];
    else if (arg === '--resume-policy') parsed.resumePolicy = argv[++index];
    else if (arg === '--adapter-hint') parsed.adapterHint = argv[++index];
    else if (arg === '--entrypoint') parsed.entrypoint = argv[++index];
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
    const record = await store.create({
      request: await requestFromArgs(args),
      sessionId: args.sessionId,
      harness: args.harness,
      dock: args.dock,
      cwd: args.cwd,
      resumePolicy: args.resumePolicy,
      adapterHint: args.adapterHint,
      entrypoint: args.entrypoint,
    });
    stdout.write(`${JSON.stringify(createDeferResponse(record))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`aos gate defer: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateDefer();
}

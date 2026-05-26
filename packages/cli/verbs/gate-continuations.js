#!/usr/bin/env node
import {
  GATE_CONTINUATIONS_READBACK_SCHEMA_VERSION,
  GateContinuationStore,
  gateContinuationDir,
} from '../../daemon/gate/continuations.js';

const STATUSES = new Set(['pending', 'submitted', 'cancelled', 'expired']);

function usage() {
  return `Usage:
  aos gate continuations --json
  aos gate continuations --status pending --json
  aos gate continuations --id <continuation_id> --json
  aos gate continuations --limit 50 --json`;
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    id: null,
    status: null,
    limit: 50,
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
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--id') [parsed.id, index] = nextValue(index, arg);
    else if (arg === '--status') [parsed.status, index] = nextValue(index, arg);
    else if (arg === '--limit') {
      let value;
      [value, index] = nextValue(index, arg);
      parsed.limit = Number(value);
    }
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit < 0) {
    throw new Error('--limit must be a non-negative number');
  }
  if (parsed.status !== null && !STATUSES.has(parsed.status)) {
    throw new Error(`--status must be one of: ${[...STATUSES].join(', ')}`);
  }
  return parsed;
}

export async function runGateContinuations(argv = process.argv.slice(2), {
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
    if (!args.json) throw new Error('gate continuations currently requires --json');
    const continuations = await store.list({ id: args.id, status: args.status, limit: args.limit });
    stdout.write(`${JSON.stringify({
      schema_version: GATE_CONTINUATIONS_READBACK_SCHEMA_VERSION,
      path: gateContinuationDir(),
      count: continuations.length,
      continuations,
    })}\n`);
    return 0;
  } catch (error) {
    stderr.write(`aos gate continuations: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateContinuations();
}

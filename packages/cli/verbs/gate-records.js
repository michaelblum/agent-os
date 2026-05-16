#!/usr/bin/env node
import { GateRecordStore, gateRecordPath } from '../../daemon/gate/records.js';

function usage() {
  return `Usage:
  aos gate records --json
  aos gate records --limit 20 --json
  aos gate records --id gate-123 --json
  aos gate records --status answered --json`;
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    limit: 20,
    gateId: null,
    status: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--limit') parsed.limit = Number(argv[++index]);
    else if (arg === '--id') parsed.gateId = argv[++index];
    else if (arg === '--status') parsed.status = argv[++index];
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit < 0) {
    throw new Error('--limit must be a non-negative number');
  }
  return parsed;
}

export async function runGateRecords(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  store = new GateRecordStore(),
} = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!args.json) throw new Error('gate records currently requires --json');
    const records = await store.list({
      limit: args.limit,
      gateId: args.gateId,
      status: args.status,
    });
    stdout.write(`${JSON.stringify({
      schema_version: 'aos.gate.records.readback.v1',
      path: gateRecordPath(),
      count: records.length,
      records,
    })}\n`);
    return 0;
  } catch (error) {
    stderr.write(`aos gate records: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateRecords();
}

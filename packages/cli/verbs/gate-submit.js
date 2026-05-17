#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { GateRecordStore } from '../../daemon/gate/records.js';
import {
  GateContinuationStore,
  createSubmitResponse,
  shouldStoreContinuationResponse,
} from '../../daemon/gate/continuations.js';

function usage() {
  return `Usage:
  aos gate submit --continuation-id <id> --request submission.json --json [--store-response]
  aos gate submit --continuation-id <id> --json '{"decision":"approve"}' [--store-response]

	Marks a pending deferred gate submitted exactly once and creates one human-authored resume event.`;
}

function parseArgs(argv) {
  const parsed = {
    jsonOut: false,
    continuationId: null,
    requestFile: null,
    requestJson: null,
    storeResponse: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--continuation-id') parsed.continuationId = argv[++index];
    else if (arg === '--request') parsed.requestFile = argv[++index];
    else if (arg === '--json') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) parsed.requestJson = argv[++index];
      else parsed.jsonOut = true;
    } else if (arg === '--store-response') parsed.storeResponse = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (parsed.requestFile && parsed.requestJson) throw new Error('--request and inline --json conflict');
  return parsed;
}

async function requestFromArgs(args) {
  if (args.requestFile) return JSON.parse(await readFile(args.requestFile, 'utf8'));
  if (args.requestJson) return JSON.parse(args.requestJson);
  throw new Error('--request or inline --json submission is required');
}

export async function runGateSubmit(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  store = new GateContinuationStore({ recordStore: new GateRecordStore() }),
} = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!args.jsonOut && !args.requestJson) throw new Error('gate submit requires --json output');
    if (!args.continuationId) throw new Error('--continuation-id is required');
    const submission = await requestFromArgs(args);
    const response = submission && typeof submission === 'object' && 'response' in submission
      ? submission.response
      : submission;
    const result = await store.submit({
      continuationId: args.continuationId,
      response,
      submittedBy: submission?.submitted_by ?? null,
      storeResponse: shouldStoreContinuationResponse(submission, args.storeResponse),
    });
    stdout.write(`${JSON.stringify(createSubmitResponse(result))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`aos gate submit: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateSubmit();
}

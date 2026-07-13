#!/usr/bin/env node

import {
  aosPath,
  currentMode,
  exitError,
  printJSON,
  repoRoot,
} from './lib/aos-cli.mjs';
import { repoBuildAttestation } from './lib/aos-build-attestation.mjs';

function parseArgs(args) {
  let json = false;
  for (const arg of args) {
    if (arg === '--json') json = true;
    else exitError(`Unknown flag: ${arg}. Usage: aos runtime build-attestation [--json]`, 'UNKNOWN_FLAG');
  }
  return { json };
}

const options = parseArgs(process.argv.slice(2));
if (currentMode() !== 'repo') {
  exitError('runtime build-attestation is available only for the repo runtime', 'REPO_RUNTIME_REQUIRED');
}

const attestation = repoBuildAttestation(repoRoot(), aosPath());
if (options.json) printJSON(attestation);
else process.stdout.write(`status=${attestation.status} current=${attestation.current} mode=${attestation.build_mode ?? 'unknown'}\n`);

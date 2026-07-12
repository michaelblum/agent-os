#!/usr/bin/env node

import { exitError, repoRoot } from './lib/aos-cli.mjs';
import { swiftSourceFingerprint } from './lib/aos-build-attestation.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--mode' || (args[1] !== 'dev' && args[1] !== 'release')) {
  exitError('Usage: node scripts/aos-build-fingerprint.mjs --mode <dev|release>', 'INVALID_ARG');
}

process.stdout.write(`${swiftSourceFingerprint(repoRoot(), args[1]).fingerprint}\n`);

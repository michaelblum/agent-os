#!/usr/bin/env node

import { fail, publicError } from './lib/browser-companion/errors.mjs';
import {
  companionStatus,
  installCompanion,
  uninstallCompanion,
  updateCompanion,
} from './lib/browser-companion/lifecycle.mjs';

const USAGE = `Usage:
  aos browser companion status [--json]
  aos browser companion install [--json]
  aos browser companion update [--json]
  aos browser companion uninstall [--json]
`;

function parse(argv) {
  if (argv.some((item) => item === '--help' || item === '-h')) return { help: true };
  const operation = argv[0];
  if (!['status', 'install', 'update', 'uninstall'].includes(operation)) {
    fail('COMPANION_INVALID_ARGUMENT', 'invalid browser companion operation');
  }
  let json = false;
  for (const arg of argv.slice(1)) {
    if (arg === '--json' && !json) json = true;
    else fail('COMPANION_INVALID_ARGUMENT', 'invalid browser companion argument');
  }
  return { operation, json };
}

function textReceipt(receipt) {
  if (receipt.operation === 'status') {
    const version = receipt.installed_version ? ` (${receipt.installed_version})` : '';
    return `Playwright companion: ${receipt.state}${version}\n`;
  }
  const version = receipt.active_version ? ` ${receipt.active_version}` : '';
  return `Playwright companion ${receipt.status}${version}\n`;
}

const argv = process.argv.slice(2);
let operation = ['status', 'install', 'update', 'uninstall'].includes(argv[0]) ? argv[0] : 'status';
try {
  const options = parse(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  operation = options.operation;
  const receipt = operation === 'status'
    ? companionStatus()
    : await ({
      install: installCompanion,
      update: updateCompanion,
      uninstall: uninstallCompanion,
    })[operation]();
  process.stdout.write(options.json ? `${JSON.stringify(receipt)}\n` : textReceipt(receipt));
} catch (error) {
  process.stderr.write(`${JSON.stringify(publicError(error, operation))}\n`);
  process.exitCode = 1;
}

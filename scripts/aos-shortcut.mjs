#!/usr/bin/env node

import {
  parseShortcutRunArgs,
  runAppleShortcut,
} from './lib/aos-shortcut-run.mjs';

const abortController = new AbortController();
process.once('SIGINT', () => abortController.abort());
process.once('SIGTERM', () => abortController.abort());

const SAFE_ERRORS = new Map([
  ['MISSING_SUBCOMMAND', 'shortcut requires a subcommand'],
  ['UNKNOWN_SUBCOMMAND', 'unknown shortcut subcommand'],
  ['MISSING_ARG', 'shortcut run requires one exact name'],
  ['UNKNOWN_ARG', 'shortcut run accepts one exact name'],
  ['UNKNOWN_FLAG', 'shortcut run received an unknown flag'],
  ['INVALID_SHORTCUT_NAME', 'shortcut name must contain 1 to 256 UTF-8 bytes'],
  ['INVALID_TIMEOUT', 'shortcut timeout must be from 1 to 120 seconds'],
  ['SHORTCUT_CANCELED', 'Apple Shortcut execution was canceled'],
  ['SHORTCUT_TIMEOUT', 'Apple Shortcut execution timed out'],
  ['SHORTCUT_OUTPUT_LIMIT', 'Apple Shortcut output exceeded the limit'],
  ['SHORTCUT_FAILED', 'Apple Shortcut execution failed'],
]);

if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
  process.stdout.write('Usage: aos shortcut run <name> [--timeout <duration>] [--json]\n');
  process.exit(0);
}

try {
  const options = parseShortcutRunArgs(process.argv.slice(2));
  const result = await runAppleShortcut({ ...options, signal: abortController.signal });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = error?.code ?? 'SHORTCUT_FAILED';
  process.stderr.write(`${JSON.stringify({
    code,
    error: SAFE_ERRORS.get(code) ?? 'Apple Shortcut execution failed',
  })}\n`);
  process.exitCode = 1;
}

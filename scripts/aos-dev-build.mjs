#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code = 'UNKNOWN_FLAG') {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function usage() {
  return [
    'Usage: aos dev build [--release] [--force] [--no-restart] [--json]',
    '',
    'Wraps repo-root build.sh and always passes --no-restart unless already supplied.',
    'Running this command may rebuild the repo-mode ./aos binary.',
    '',
    'Options:',
    '  --release     Build optimized release binary',
    '  --force       Force rebuild even when inputs appear current',
    '  --no-restart  Do not restart the managed daemon after building',
    '  --json        Emit machine-readable build result',
    '  --help, -h    Print this help without building',
    '',
  ].join('\n');
}

function buildCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const asJSON = args.includes('--json');
  const passthrough = args.filter((arg) => !['--help', '-h', '--json'].includes(arg));
  for (const arg of passthrough) {
    if (!['--release', '--force', '--no-restart'].includes(arg)) {
      error(`Unknown dev build argument: ${arg}`, 'UNKNOWN_FLAG');
    }
  }
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  const buildScript = path.join(repoRoot, 'build.sh');
  if (!fs.existsSync(buildScript)) error(`Missing build script: ${buildScript}`, 'MISSING_BUILD_SCRIPT');
  const buildArgs = [...passthrough];
  if (!buildArgs.includes('--no-restart')) buildArgs.push('--no-restart');
  const result = spawnSync('/bin/bash', [buildScript, ...buildArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? (result.error ? `${result.error.message}\n` : '');
  const binaryRebuilt = exitCode === 0 && /^Rebuilt: \.\/aos\b/m.test(stdout);
  if (asJSON) {
    printJSON({
      status: exitCode === 0 ? 'success' : 'error',
      command: ['bash', 'build.sh', ...buildArgs].join(' '),
      build_wrapper: 'build.sh',
      build_source: 'repo-root/build.sh',
      binary_rebuilt: binaryRebuilt,
      binary_resigned: false,
      exit_code: exitCode,
      stdout,
      stderr,
      next: null,
    });
  } else {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  process.exit(exitCode);
}

const [subcommand, ...rest] = process.argv.slice(2);
if (subcommand === 'build') buildCommand(rest);
else error(`Unknown dev build command: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');

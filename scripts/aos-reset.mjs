#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const modes = ['repo', 'installed'];

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${String(arg).startsWith('--') ? 'flag' : 'argument'}: ${arg}. Usage: aos reset [--mode current|repo|installed|all] [--json]`, String(arg).startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  return {
    status: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
  };
}

function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (modes.includes(override)) return override;
  return process.argv[1]?.includes('.app/Contents/MacOS/') ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function stateDir(mode) {
  return path.join(stateRoot(), mode);
}

function installAppPath() {
  return process.env.AOS_INSTALL_PATH || path.join(os.homedir(), 'Applications/AOS.app');
}

function repoRoot() {
  if (process.env.AOS_REPO_ROOT) return path.resolve(process.env.AOS_REPO_ROOT);
  const sentinel = 'packages/toolkit/components/inspector-panel/index.html';
  const bases = [path.dirname(process.argv[1] || process.cwd()), process.cwd()];
  for (const base of bases) {
    for (const suffix of ['', '..', '../..', '../../..']) {
      const candidate = path.resolve(base, suffix);
      if (fs.existsSync(path.join(candidate, sentinel))) return candidate;
    }
  }
  return null;
}

function serviceLabel(mode) {
  return `com.agent-os.aos.${mode}`;
}

function servicePlistPath(label) {
  return path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
}

function stopLaunchAgent(label) {
  const domain = `gui/${process.getuid()}`;
  if (run('/bin/launchctl', ['print', `${domain}/${label}`]).status !== 0) return false;
  const output = run('/bin/launchctl', ['bootout', domain, servicePlistPath(label)]);
  return output.status === 0 ||
    output.stderr.includes('No such process') ||
    output.stderr.includes('service could not be found');
}

function parseArgs(args) {
  const options = { mode: 'current', json: false };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    switch (arg) {
      case '--json':
        options.json = true;
        i += 1;
        break;
      case '--mode':
        if (i + 1 >= args.length || !['current', 'repo', 'installed', 'all'].includes(args[i + 1])) {
          error('--mode must be current, repo, installed, or all', 'INVALID_ARG');
        }
        options.mode = args[i + 1];
        i += 2;
        break;
      default:
        unknownArg(arg);
    }
  }
  return options;
}

function removeIfExists(target, removedPaths) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removedPaths.push(target);
}

function targetModes(mode) {
  if (mode === 'current') return [currentMode()];
  if (mode === 'all') return modes;
  return [mode];
}

function reset(mode) {
  const selectedModes = targetModes(mode);
  const stoppedServices = [];
  const removedPaths = [];
  const notes = [];

  for (const item of selectedModes) {
    const label = serviceLabel(item);
    if (stopLaunchAgent(label)) stoppedServices.push(label);
  }
  for (const item of selectedModes) {
    removeIfExists(stateDir(item), removedPaths);
  }

  const root = stateRoot();
  if (selectedModes.includes('repo') && fs.existsSync(root)) {
    for (const item of fs.readdirSync(root)) {
      if (!modes.includes(item)) removeIfExists(path.join(root, item), removedPaths);
    }
  }

  if (selectedModes.includes('repo')) {
    const rootPath = repoRoot();
    if (rootPath) {
      removeIfExists(path.join(rootPath, 'aos'), removedPaths);
      removeIfExists(path.join(rootPath, 'dist'), removedPaths);
    }
  }

  const remainingPaths = [
    installAppPath(),
    ...modes.map((item) => servicePlistPath(serviceLabel(item))),
  ].filter((item) => fs.existsSync(item)).sort();

  if (!fs.existsSync(installAppPath())) notes.push('Installed runtime app is not present.');
  else notes.push('Installed runtime app was left in place.');
  if (!stoppedServices.length) notes.push('No matching launch agents were running for the selected reset mode.');

  return {
    status: 'ok',
    reset_mode: mode,
    stopped_services: stoppedServices.sort(),
    removed_paths: removedPaths.sort(),
    remaining_paths: remainingPaths,
    notes,
  };
}

const options = parseArgs(process.argv.slice(2));
const response = reset(options.mode);
if (options.json) {
  printJSON(response);
} else {
  process.stdout.write(`status=${response.status} mode=${response.reset_mode}\n`);
  if (response.stopped_services.length) process.stdout.write(`stopped_services=${response.stopped_services.join(',')}\n`);
  if (response.removed_paths.length) process.stdout.write(`removed_paths=${response.removed_paths.join(',')}\n`);
  if (response.remaining_paths.length) process.stdout.write(`remaining_paths=${response.remaining_paths.join(',')}\n`);
  for (const note of response.notes) process.stdout.write(`${note}\n`);
}

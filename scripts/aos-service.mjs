#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  return {
    status: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
  };
}

function runChecked(executable, args, code, prefix, tolerate = () => false) {
  const result = run(executable, args);
  if (result.status !== 0 && !tolerate(result)) {
    const detail = (result.stderr || result.stdout).trim();
    error(`${prefix}: ${detail}`, code);
  }
  return result;
}

function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'repo' || override === 'installed') return override;
  return process.argv[1]?.includes('.app/Contents/MacOS/') ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
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
  return process.cwd();
}

function expectedBinaryPath(mode) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') return path.join(installAppPath(), 'Contents/MacOS/aos');
  return path.join(repoRoot(), 'aos');
}

function serviceLabel(mode) {
  return `com.agent-os.aos.${mode}`;
}

function servicePaths(mode) {
  const logDir = path.join(stateRoot(), mode);
  const launchAgentsDir = path.join(os.homedir(), 'Library/LaunchAgents');
  const label = serviceLabel(mode);
  return {
    mode,
    label,
    logDir,
    plistPath: path.join(launchAgentsDir, `${label}.plist`),
    stdoutLogPath: path.join(logDir, 'daemon.stdout.log'),
    stderrLogPath: path.join(logDir, 'daemon.log'),
    binaryPath: expectedBinaryPath(mode),
  };
}

function parseOptions(args, extra = new Set()) {
  const options = { mode: currentMode(), json: false, tail: 200 };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    switch (arg) {
      case '--json':
        options.json = true;
        i += 1;
        break;
      case '--mode':
        if (i + 1 >= args.length || !['repo', 'installed'].includes(args[i + 1])) {
          error("--mode must be 'repo' or 'installed'", 'INVALID_ARG');
        }
        options.mode = args[i + 1];
        i += 2;
        break;
      case '--tail':
        if (!extra.has('--tail')) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
        if (i + 1 >= args.length || !/^\d+$/.test(args[i + 1])) {
          error('--tail requires an integer', 'INVALID_ARG');
        }
        options.tail = Number(args[i + 1]);
        i += 2;
        break;
      default:
        error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    }
  }
  return options;
}

function launchDomain() {
  return `gui/${process.getuid()}`;
}

function isServiceLoaded(label) {
  return run('/bin/launchctl', ['print', `${launchDomain()}/${label}`]).status === 0;
}

function servicePID(label) {
  const output = run('/bin/launchctl', ['print', `${launchDomain()}/${label}`]);
  if (output.status !== 0) return null;
  for (const rawLine of output.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('pid = ')) {
      const pid = Number(line.replace('pid = ', ''));
      if (Number.isInteger(pid)) return pid;
    }
  }
  return null;
}

function launchctlBootstrap(plistPath, { tolerateAlreadyBootstrapped = false } = {}) {
  runChecked(
    '/bin/launchctl',
    ['bootstrap', launchDomain(), plistPath],
    'LAUNCHCTL_ERROR',
    'launchctl bootstrap failed',
    (result) => tolerateAlreadyBootstrapped && result.stderr.includes('already bootstrapped'),
  );
}

function launchctlKickstart(label) {
  runChecked('/bin/launchctl', ['kickstart', '-k', `${launchDomain()}/${label}`], 'LAUNCHCTL_ERROR', 'launchctl kickstart failed');
}

function launchctlBootout(plistPath) {
  runChecked(
    '/bin/launchctl',
    ['bootout', launchDomain(), plistPath],
    'LAUNCHCTL_ERROR',
    'launchctl bootout failed',
    (result) => result.stderr.includes('No such process') || result.stderr.includes('service could not be found'),
  );
}

function plistValue(plistPath, keyPath) {
  const output = run('/usr/libexec/PlistBuddy', ['-c', `Print ${keyPath}`, plistPath]);
  if (output.status !== 0) return null;
  const value = output.stdout.trim();
  return value || null;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function guardBinaryExists(filePath) {
  if (!isExecutable(filePath)) {
    error(`Service binary is missing or not executable: ${filePath}`, 'FILE_NOT_FOUND');
  }
}

function escapeXML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plistXML(paths) {
  const values = {
    Label: paths.label,
    RunAtLoad: true,
    KeepAlive: true,
    WorkingDirectory: path.dirname(paths.binaryPath),
    StandardOutPath: paths.stdoutLogPath,
    StandardErrorPath: paths.stderrLogPath,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXML(values.Label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXML(paths.binaryPath)}</string>
    <string>serve</string>
    <string>--idle-timeout</string>
    <string>none</string>
  </array>
  <key>RunAtLoad</key>
  <${values.RunAtLoad ? 'true' : 'false'}/>
  <key>KeepAlive</key>
  <${values.KeepAlive ? 'true' : 'false'}/>
  <key>WorkingDirectory</key>
  <string>${escapeXML(values.WorkingDirectory)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXML(values.StandardOutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXML(values.StandardErrorPath)}</string>
</dict>
</plist>
`;
}

function writeServicePlist(paths) {
  try {
    fs.mkdirSync(paths.logDir, { recursive: true });
    fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true });
    fs.writeFileSync(paths.plistPath, plistXML(paths));
  } catch (err) {
    error(`Failed to write launch agent plist: ${err.message}`, 'WRITE_ERROR');
  }
}

function aosPath() {
  return process.env.AOS_PATH || path.join(repoRoot(), 'aos');
}

function verifyReadiness(mode, json) {
  const args = ['service', '_verify-readiness', '--mode', mode];
  if (json) args.push('--json');
  const env = { ...process.env, AOS_RUNTIME_MODE: mode };
  const result = spawnSync(aosPath(), args, {
    cwd: repoRoot(),
    env,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

function installCommand(args) {
  const options = parseOptions(args);
  const paths = servicePaths(options.mode);
  guardBinaryExists(paths.binaryPath);
  writeServicePlist(paths);
  launchctlBootstrap(paths.plistPath, { tolerateAlreadyBootstrapped: true });
  launchctlKickstart(paths.label);
  verifyReadiness(options.mode, options.json);
}

function startCommand(args) {
  const options = parseOptions(args);
  const paths = servicePaths(options.mode);
  guardBinaryExists(paths.binaryPath);
  if (!fs.existsSync(paths.plistPath)) {
    writeServicePlist(paths);
    launchctlBootstrap(paths.plistPath, { tolerateAlreadyBootstrapped: true });
  } else if (!isServiceLoaded(paths.label)) {
    launchctlBootstrap(paths.plistPath);
  }
  launchctlKickstart(paths.label);
  verifyReadiness(options.mode, options.json);
}

function stopService(mode) {
  const paths = servicePaths(mode);
  if (fs.existsSync(paths.plistPath) && isServiceLoaded(paths.label)) {
    launchctlBootout(paths.plistPath);
  }
}

function stopCommand(args) {
  const options = parseOptions(args);
  stopService(options.mode);
  statusCommand(args);
}

function serviceStatus(mode) {
  const paths = servicePaths(mode);
  const installed = fs.existsSync(paths.plistPath);
  const pid = servicePID(paths.label);
  const actualBinaryPath = installed ? plistValue(paths.plistPath, ':ProgramArguments:0') : null;
  const actualLogPath = installed ? plistValue(paths.plistPath, ':StandardErrorPath') : null;
  const notes = [];

  if (!installed) notes.push('Launch agent plist is not installed.');
  if (installed && !isServiceLoaded(paths.label)) notes.push('Launch agent is installed but not loaded in launchd.');
  if (installed && pid === null) notes.push('Service is not running.');
  if (actualBinaryPath && actualBinaryPath !== paths.binaryPath) {
    notes.push(`Launch agent target differs from the expected ${mode} binary.`);
  }
  if (actualLogPath && actualLogPath !== paths.stderrLogPath) {
    notes.push(`Launch agent log path differs from the expected ${mode} state directory.`);
  }
  if (!isExecutable(paths.binaryPath)) {
    notes.push(`Expected ${mode} service binary is missing or not executable.`);
  }

  return {
    status: notes.length ? 'degraded' : 'ok',
    mode,
    installed,
    running: pid !== null,
    pid: pid ?? undefined,
    launchd_label: paths.label,
    actual_binary_path: actualBinaryPath ?? undefined,
    expected_binary_path: paths.binaryPath,
    actual_log_path: actualLogPath ?? undefined,
    expected_log_path: paths.stderrLogPath,
    plist_path: paths.plistPath,
    state_dir: paths.logDir,
    notes,
  };
}

function statusCommand(args) {
  const options = parseOptions(args);
  const response = serviceStatus(options.mode);
  if (options.json) {
    printJSON(response);
  } else {
    process.stdout.write(`mode=${response.mode} installed=${response.installed} running=${response.running} pid=${response.pid ?? 'none'} label=${response.launchd_label}\n`);
  }
}

function logsCommand(args) {
  const options = parseOptions(args, new Set(['--tail']));
  const logPath = servicePaths(options.mode).stderrLogPath;
  let contents;
  try {
    contents = fs.readFileSync(logPath, 'utf8');
  } catch {
    error(`No service log found at ${logPath}`, 'FILE_NOT_FOUND');
  }
  const lines = contents.split('\n');
  process.stdout.write(`${lines.slice(-options.tail).join('\n')}\n`);
}

const [subcommand, ...rest] = process.argv.slice(2);
if (subcommand === 'install') installCommand(rest);
else if (subcommand === 'start') startCommand(rest);
else if (subcommand === 'stop') stopCommand(rest);
else if (subcommand === 'status') statusCommand(rest);
else if (subcommand === 'logs') logsCommand(rest);
else error(`Unknown service command: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');

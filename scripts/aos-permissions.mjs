#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function exitError(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function repoRoot() {
  if (process.env.AOS_REPO_ROOT) return path.resolve(process.env.AOS_REPO_ROOT);
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(scriptDir, '..');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(repoRoot(), 'aos');
}

function invocationName() {
  return process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
}

function currentMode() {
  const override = process.env.AOS_RUNTIME_MODE?.toLowerCase();
  if (override === 'repo' || override === 'installed') return override;
  return 'repo';
}

function expectedBinaryPath(mode) {
  if (process.env.AOS_SERVICE_BINARY) return path.resolve(process.env.AOS_SERVICE_BINARY);
  if (mode === 'installed') {
    const installPath = process.env.AOS_INSTALL_PATH || path.join(os.homedir(), 'Applications/AOS.app');
    return path.join(installPath, 'Contents/MacOS/aos');
  }
  return path.join(repoRoot(), 'aos');
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${result.error.message}\n` : ''),
  };
}

function runAOS(args) {
  return run(aosPath(), args, {
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
  });
}

function parseJSONOutput(result, label, errorCode = 'PERMISSIONS_PRIMITIVE_FAILED') {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    exitError(`${label} failed${detail ? `: ${detail}` : ''}`, errorCode);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    exitError(`${label} did not return JSON`, 'PERMISSIONS_PRIMITIVE_JSON_INVALID');
  }
}

function parseArgs(args) {
  const subcommand = args[0];
  if (subcommand !== 'check' && subcommand !== 'preflight') {
    exitError(`Unknown permissions subcommand: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
  const usage = `${invocationName()} permissions ${subcommand} [--json]`;
  for (const arg of args.slice(1)) {
    if (arg !== '--json') exitError(`Unknown flag: ${arg}. Usage: ${usage}`, 'UNKNOWN_FLAG');
  }
  return { subcommand };
}

function setupState(marker) {
  const setupCompleted = Boolean(marker.setup_completed);
  const state = {
    marker_exists: Boolean(marker.marker_exists),
    marker_path: marker.marker_path,
    completed_at: marker.completed_at,
    bundle_path: marker.bundle_path,
    current_bundle_path: marker.current_bundle_path,
    bundle_matches_current: Boolean(marker.bundle_matches_current),
    setup_completed: setupCompleted,
  };
  if (!setupCompleted) state.recommended_command = 'aos permissions setup --once';
  return state;
}

function permissionRequirements(permissions) {
  return [
    {
      id: 'accessibility',
      granted: Boolean(permissions.accessibility),
      required_for: ['global input tap', 'mouse/keyboard actions', 'AX element actions'],
      setup_trigger: 'AXIsProcessTrustedWithOptions prompt',
    },
    {
      id: 'screen_recording',
      granted: Boolean(permissions.screen_recording),
      required_for: ['screen capture', 'perception', 'visual debugging'],
      setup_trigger: 'CGRequestScreenCaptureAccess prompt',
    },
    {
      id: 'listen_access',
      granted: Boolean(permissions.listen_access),
      required_for: ['global input tap', 'input event fan-out', 'hotkeys'],
      setup_trigger: 'CGRequestListenEventAccess prompt',
    },
    {
      id: 'post_access',
      granted: Boolean(permissions.post_access),
      required_for: ['synthetic events', 'mouse/keyboard actions', 'AX element actions'],
      setup_trigger: 'CGRequestPostEventAccess prompt',
    },
  ];
}

function daemonViewFromHealth(health) {
  if (!health?.reachable || !health.input_tap) {
    return { comparable: null, block: { reachable: false } };
  }

  const tap = {
    status: health.input_tap.status,
    attempts: health.input_tap.attempts,
  };
  if (health.input_tap.listen_access !== undefined) tap.listen_access = Boolean(health.input_tap.listen_access);
  if (health.input_tap.post_access !== undefined) tap.post_access = Boolean(health.input_tap.post_access);

  const block = {
    reachable: true,
    input_tap: tap,
  };
  if (health.permissions?.accessibility !== undefined) {
    block.accessibility = Boolean(health.permissions.accessibility);
  }

  return {
    comparable: {
      inputTap: {
        status: health.input_tap.status,
        attempts: Number(health.input_tap.attempts ?? 0),
        listenAccess: health.input_tap.listen_access === undefined ? undefined : Boolean(health.input_tap.listen_access),
        postAccess: health.input_tap.post_access === undefined ? undefined : Boolean(health.input_tap.post_access),
      },
      permissions: {
        accessibility: health.permissions?.accessibility === undefined
          ? undefined
          : Boolean(health.permissions.accessibility),
      },
    },
    block,
  };
}

function evaluateReadyForTesting(daemon, cli, setup) {
  if (daemon && daemon.inputTap.status !== 'active') {
    return { ready_for_testing: false, ready_source: 'daemon' };
  }
  if (daemon && daemon.permissions.accessibility !== undefined) {
    return {
      ready_for_testing: Boolean(daemon.permissions.accessibility && cli.screen_recording && setup.setup_completed),
      ready_source: 'daemon',
    };
  }
  return {
    ready_for_testing: Boolean(cli.accessibility && cli.screen_recording && setup.setup_completed),
    ready_source: 'cli',
  };
}

function missingPermissionIDsFor(daemon, cli) {
  const missing = [];
  const accessibility = daemon?.permissions.accessibility ?? cli.accessibility;
  const listen = daemon?.inputTap.listenAccess ?? cli.listen_access;
  const post = daemon?.inputTap.postAccess ?? cli.post_access;
  if (!accessibility) missing.push('accessibility');
  if (!cli.screen_recording) missing.push('screen_recording');
  if (!listen) missing.push('listen_access');
  if (!post) missing.push('post_access');
  return missing;
}

function disagreementFor(daemon, cli) {
  if (!daemon) return undefined;
  const disagreement = {};
  if (daemon.permissions.accessibility !== undefined && daemon.permissions.accessibility !== cli.accessibility) {
    disagreement.accessibility = { cli: cli.accessibility, daemon: daemon.permissions.accessibility };
  }
  if (daemon.inputTap.listenAccess !== undefined && daemon.inputTap.listenAccess !== cli.listen_access) {
    disagreement.listen_access = { cli: cli.listen_access, daemon: daemon.inputTap.listenAccess };
  }
  if (daemon.inputTap.postAccess !== undefined && daemon.inputTap.postAccess !== cli.post_access) {
    disagreement.post_access = { cli: cli.post_access, daemon: daemon.inputTap.postAccess };
  }
  return Object.keys(disagreement).length ? disagreement : undefined;
}

function inputTapRecoveryGuidance(status, attempts) {
  return [
    `Input tap is not active (status=${status}, attempts=${attempts}).`,
    'Try:',
    '  ./aos service restart              # restart the managed daemon and re-check readiness',
    '  ./aos permissions setup --once     # refresh macOS permission onboarding',
    '  ./aos serve --idle-timeout none    # temporary foreground fallback for this session',
  ].join('\n');
}

function inputMonitoringSubGuidance(tap, daemonBinaryPath) {
  const render = (value) => value === undefined || value === null ? 'unknown' : String(Boolean(value));
  return [
    `Daemon lacks Input Monitoring access (listen=${render(tap?.listenAccess)}, post=${render(tap?.postAccess)}).`,
    'In repo mode, prefer:',
    '  ./aos permissions reset-runtime --mode repo',
    '  ./aos permissions setup --once',
    '  ./aos ready --post-permission',
    'Manual Settings fallback: Privacy & Security > Input Monitoring for daemon binary:',
    `  ${daemonBinaryPath}`,
  ].join('\n');
}

function notesFor(cli, setup, daemon, mode) {
  const notes = [];
  if (!cli.accessibility) notes.push('Accessibility permission is not granted (CLI view).');
  if (!cli.screen_recording) notes.push('Screen Recording permission is not granted.');
  if (!cli.listen_access) notes.push('Input Monitoring listen access is not granted (CLI view).');
  if (!cli.post_access) notes.push('Input Monitoring post access is not granted (CLI view).');
  if (!setup.marker_exists) {
    notes.push('Permission onboarding has not been completed for this runtime identity.');
  } else if (!setup.bundle_matches_current && !setup.setup_completed) {
    notes.push('Permission onboarding marker belongs to a different app bundle path.');
  }
  if (setup.recommended_command) {
    notes.push(`Run '${setup.recommended_command}' before interactive testing.`);
  }
  if (!daemon) {
    notes.push('Daemon unreachable; readiness computed from CLI preflights only.');
  } else if (daemon.inputTap.status !== 'active') {
    notes.push(inputTapRecoveryGuidance(daemon.inputTap.status, daemon.inputTap.attempts));
    if (daemon.inputTap.listenAccess === false || daemon.inputTap.postAccess === false) {
      notes.push(inputMonitoringSubGuidance(daemon.inputTap, expectedBinaryPath(mode)));
    }
  }
  return notes;
}

function currentFacts() {
  const permissionsFacts = parseJSONOutput(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  const marker = parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get');
  const daemonResult = runAOS(['__daemon', 'health', '--json']);
  let daemonHealth = null;
  if (daemonResult.exitCode === 0) {
    try {
      daemonHealth = JSON.parse(daemonResult.stdout);
    } catch {
      daemonHealth = null;
    }
  }
  return {
    permissions: permissionsFacts.permissions ?? {},
    setup: setupState(marker),
    daemonHealth,
  };
}

function runCheck() {
  const mode = currentMode();
  const facts = currentFacts();
  const cli = {
    accessibility: Boolean(facts.permissions.accessibility),
    screen_recording: Boolean(facts.permissions.screen_recording),
    listen_access: Boolean(facts.permissions.listen_access),
    post_access: Boolean(facts.permissions.post_access),
  };
  const daemon = daemonViewFromHealth(facts.daemonHealth);
  const evaluation = evaluateReadyForTesting(daemon.comparable, cli, facts.setup);
  const notes = notesFor(cli, facts.setup, daemon.comparable, mode);
  const disagreement = disagreementFor(daemon.comparable, cli);
  const response = {
    status: notes.length ? 'degraded' : 'ok',
    permissions: cli,
    daemon_view: daemon.block,
    cli_view: cli,
    requirements: permissionRequirements(cli),
    setup: facts.setup,
    missing_permissions: missingPermissionIDsFor(daemon.comparable, cli),
    ready_for_testing: evaluation.ready_for_testing,
    ready_source: evaluation.ready_source,
    notes,
  };
  if (disagreement) response.disagreement = disagreement;
  printJSON(response);
}

parseArgs(process.argv.slice(2));
runCheck();

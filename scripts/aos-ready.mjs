#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compactProcessDetail,
  currentMode,
  exitError,
  invocationName,
  printJSON,
  runAOS,
  runNodeScript,
} from './lib/aos-cli.mjs';
import { brokerFacts } from './lib/aos-facts.mjs';
import { nextReadyExecutionStep } from './lib/aos-ready-execution.mjs';
import {
  permissionFixLines,
  permissionResetSafeSequenceLines,
  runtimeVerdict,
} from './lib/aos-readiness.mjs';

function parseArgs(args) {
  const options = { json: false, repair: false, postPermission: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else if (arg === '--repair') options.repair = true;
    else if (arg === '--post-permission') options.postPermission = true;
    else exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} ready [--json] [--repair] [--post-permission]`, 'UNKNOWN_FLAG');
  }
  return options;
}

function currentFacts() {
  return brokerFacts({
    failureCode: 'READY_PRIMITIVE_FAILED',
    jsonCode: 'READY_PRIMITIVE_JSON_INVALID',
    includeRuntime: true,
    includeClean: true,
  });
}

function buildReadyResponse(startup, actionTrace, mode, prefix) {
  const facts = currentFacts();
  const verdict = runtimeVerdict(facts, mode, prefix);
  return {
    status: verdict.status,
    ready: verdict.ready,
    phase: verdict.phase,
    diagnosis: verdict.diagnosis,
    mode,
    ready_source: verdict.ready_source,
    startup,
    runtime: facts.runtime,
    runtime_verdict: verdict,
    tcc_staleness: verdict.tcc_staleness,
    terminal_handoff: verdict.terminal_handoff,
    permissions: facts.permissions,
    permissions_setup: facts.setup,
    blocked_capabilities: verdict.blocked_capabilities,
    blockers: verdict.blockers,
    next_actions: verdict.next_actions,
    action_trace: actionTrace,
    notes: verdict.notes,
  };
}

function stateDir(mode) {
  const root = process.env.AOS_STATE_ROOT
    ? path.resolve(process.env.AOS_STATE_ROOT)
    : path.join(os.homedir(), '.config', 'aos');
  return path.join(root, mode);
}

function staleTccAlertMarkerPath(mode) {
  return path.join(stateDir(mode), 'post-rebuild-tcc-handoff-alert.json');
}

function staleTccAlertKey(staleness) {
  const identity = staleness?.binary_identity ?? {};
  return [
    identity.path,
    identity.cdhash,
    identity.mtime_ms,
    identity.size_bytes,
  ].filter((part) => part !== undefined && part !== null && part !== '').join('|');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commandExists(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function playTccHandoffAlertSound() {
  if (process.env.AOS_TCC_HANDOFF_ALERT_COMMAND) {
    spawnSync('/bin/sh', ['-c', process.env.AOS_TCC_HANDOFF_ALERT_COMMAND], { stdio: 'ignore' });
    return;
  }

  const sound = process.env.AOS_TCC_HANDOFF_ALERT_SOUND || '/System/Library/Sounds/Sosumi.aiff';
  const repeat = parsePositiveInt(process.env.AOS_TCC_HANDOFF_ALERT_REPEAT, 3);
  const volume = process.env.AOS_TCC_HANDOFF_ALERT_VOLUME || '2';
  if (commandExists('/usr/bin/afplay') && fs.existsSync(sound)) {
    for (let i = 0; i < repeat; i += 1) {
      const result = spawnSync('/usr/bin/afplay', ['-v', volume, sound], { stdio: 'ignore' });
      if (result.status !== 0) break;
    }
    return;
  }

  if (commandExists('/usr/bin/osascript')) {
    spawnSync('/usr/bin/osascript', ['-e', `beep ${repeat}`], { stdio: 'ignore' });
  }
}

function maybePlayTccHandoffAlert(response, mode) {
  const handoff = response.terminal_handoff;
  const staleness = response.tcc_staleness;
  if (!handoff?.terminal || staleness?.id !== 'post_rebuild_tcc_stale') return undefined;

  const markerPath = staleTccAlertMarkerPath(mode);
  const key = staleTccAlertKey(staleness);
  if (!key) return { status: 'skipped', reason: 'missing_binary_identity', marker_path: markerPath };
  if (process.env.AOS_TCC_HANDOFF_ALERT === '0') {
    return { status: 'skipped', reason: 'disabled', marker_path: markerPath, key };
  }

  try {
    const existing = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (existing.key === key) {
      return { status: 'skipped', reason: 'already_alerted_for_binary_identity', marker_path: markerPath, key };
    }
  } catch {
    // Missing or invalid marker: play the alert and replace it.
  }

  playTccHandoffAlertSound();
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${JSON.stringify({
      key,
      alerted_at: new Date().toISOString(),
      target_path: staleness.remedy?.target_path,
      cdhash: staleness.binary_identity?.cdhash,
    }, null, 2)}\n`);
  } catch {
    return { status: 'played', marker_status: 'write_failed', marker_path: markerPath, key };
  }
  return { status: 'played', marker_status: 'written', marker_path: markerPath, key };
}

function serviceCommandString(mode, prefix, action) {
  return `${prefix} service ${action} --mode ${mode} --json`;
}

function runReadyServiceAction(action, mode) {
  if (process.env.AOS_TEST_READY_MOCK_SERVICE_ACTIONS === '1') {
    if (process.env.AOS_TEST_READY_SERVICE_ACTION_LOG) {
      fs.appendFileSync(
        process.env.AOS_TEST_READY_SERVICE_ACTION_LOG,
        `${JSON.stringify({ action, mode })}\n`,
      );
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({ status: 'ok', action, mode }),
      stderr: '',
    };
  }
  return runNodeScript('scripts/aos-service.mjs', [action, '--mode', mode, '--json']);
}

function skippedReadyStartup(mode, prefix) {
  return {
    attempted: false,
    command: serviceCommandString(mode, prefix, 'start'),
    exit_code: 0,
    status: 'skipped',
  };
}

function runReadyStartup(mode, prefix, actionTrace) {
  const result = runReadyServiceAction('start', mode);
  return {
    startup: {
      attempted: true,
      command: serviceCommandString(mode, prefix, 'start'),
      exit_code: result.exitCode,
      status: result.exitCode === 0 ? 'ok' : 'degraded',
    },
    actionTrace: [...actionTrace, {
      step: 'service_start',
      result: result.exitCode === 0 ? 'ok' : 'degraded',
      detail: result.exitCode === 0 ? undefined : compactProcessDetail(result),
    }],
  };
}

function waitForReadyResponse(startup, actionTrace, mode, prefix, budgetMs, pollMs = 500) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const response = buildReadyResponse(startup, actionTrace, mode, prefix);
    if (response.ready) {
      const trace = [...actionTrace, {
        step: 'wait_for_recovery',
        result: 'ready',
        detail: 'daemon became ready during repair wait',
      }];
      return buildReadyResponse(startup, trace, mode, prefix);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
  const trace = [...actionTrace, {
    step: 'wait_for_recovery',
    result: 'timed_out',
    detail: `daemon did not become ready within ${budgetMs}ms`,
  }];
  return buildReadyResponse(startup, trace, mode, prefix);
}

function runReadyRuntimeRepair(startup, actionTrace, mode, prefix, budgetMs, reason) {
  const result = runReadyServiceAction('restart', mode);
  const detail = [reason, compactProcessDetail(result)].filter(Boolean).join('\n');
  const trace = [...actionTrace, {
    step: 'service_restart',
    result: result.exitCode === 0 ? 'ok' : 'degraded',
    detail: detail || undefined,
  }];
  const testBudget = Number.parseInt(process.env.AOS_TEST_READY_WAIT_BUDGET_MS ?? '', 10);
  const testPoll = Number.parseInt(process.env.AOS_TEST_READY_WAIT_POLL_MS ?? '', 10);
  return waitForReadyResponse(
    startup,
    trace,
    mode,
    prefix,
    Number.isFinite(testBudget) ? testBudget : budgetMs,
    Number.isFinite(testPoll) ? testPoll : 500,
  );
}

function runReadyCleanRepair(startup, actionTrace, mode, prefix) {
  const result = runAOS(['clean', '--json']);
  const trace = [...actionTrace, {
    step: 'clean',
    result: result.exitCode === 0 ? 'ok' : 'failed',
    detail: compactProcessDetail(result),
  }];
  return buildReadyResponse(startup, trace, mode, prefix);
}

function printReadyHumanHandoff(response, mode, prefix) {
  if (response.phase !== 'human_required') return;
  if (response.terminal_handoff?.reason === 'post_rebuild_tcc_stale') {
    process.stdout.write('\n');
    process.stdout.write('Human action needed:\n');
    process.stdout.write('Post-rebuild TCC reset checkpoint:\n');
    process.stdout.write(`  Runtime mode: ${mode}\n`);
    process.stdout.write(`  Target binary: ${response.terminal_handoff.target_path}\n`);
    process.stdout.write('  Agent: end this turn now; do not run reset-runtime, setup, ready, service restart, or other TCC-backed probes.\n');
    process.stdout.write(`  Human: ${response.terminal_handoff.human_action}\n`);
    process.stdout.write(`  Session: after the user says ${response.terminal_handoff.next_user_signal}, run ${prefix} ready --post-permission\n`);
    return;
  }
  const permissionBlockers = response.blockers.filter((blocker) => blocker.kind === 'permission');
  if (!permissionBlockers.length) return;

  process.stdout.write('\n');
  process.stdout.write('Human action needed:\n');
  process.stdout.write('Preferred permission reset sequence:\n');
  for (const line of permissionResetSafeSequenceLines(permissionBlockers, mode, prefix)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('Affected permissions:\n');
  for (const line of permissionFixLines(permissionBlockers, mode)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('Manual Settings removal is only the fallback if reset-runtime reports that targeted reset is unavailable or failed.\n');
}

function printText(response, mode, prefix) {
  if (response.ready) {
    process.stdout.write(`ready=true mode=${mode} daemon=reachable tap=${response.runtime.input_tap_status ?? 'unknown'}\n`);
    return;
  }

  const daemonState = response.runtime.socket_reachable ? 'reachable' : (response.runtime.daemon_running ? 'running' : 'down');
  process.stdout.write(`ready=false phase=${response.phase} diagnosis=${response.diagnosis} mode=${mode} daemon=${daemonState} tap=${response.runtime.input_tap_status ?? 'unknown'} blocked=${response.blocked_capabilities.join(',')}\n`);
  if (response.action_trace.length) {
    process.stdout.write('Action trace:\n');
    for (const step of response.action_trace) {
      process.stdout.write(`  ${step.step}: ${step.result}\n`);
      if (step.detail) process.stdout.write(`    ${step.detail}\n`);
    }
  }
  for (const blocker of response.blockers) {
    if (response.phase === 'human_required' && blocker.kind === 'permission') continue;
    process.stdout.write(`- ${blocker.message}\n`);
    if (blocker.target_path) process.stdout.write(`  target: ${blocker.target_path}\n`);
    if (blocker.settings_url) process.stdout.write(`  settings: ${blocker.settings_url}\n`);
  }
  printReadyHumanHandoff(response, mode, prefix);
  if (response.terminal_handoff?.terminal) return;
  if (response.next_actions.length) {
    process.stdout.write('Next:\n');
    for (const action of response.next_actions) {
      if (response.phase === 'human_required' && action.type === 'open_settings') continue;
      if (response.terminal_handoff?.terminal && !action.after_user_signal && action.type !== 'manual_tcc_reset') continue;
      if (action.command) process.stdout.write(`  ${action.command}  # ${action.label}\n`);
      else process.stdout.write(`  ${action.label}\n`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const mode = currentMode();
const prefix = invocationName();
let startup = skippedReadyStartup(mode, prefix);
let response = buildReadyResponse(startup, [], mode, prefix);
let stopped = false;
for (let stepCount = 0; stepCount < 8; stepCount += 1) {
  const step = nextReadyExecutionStep(response, {
    repair: options.repair,
    postPermission: options.postPermission,
    prefix,
    mode,
  });
  if (step.type === 'stop') {
    if (step.trace) {
      response = { ...response, action_trace: [...response.action_trace, step.trace] };
    }
    stopped = true;
    break;
  }
  if (step.type === 'start') {
    const started = runReadyStartup(mode, prefix, response.action_trace);
    startup = started.startup;
    response = buildReadyResponse(startup, started.actionTrace, mode, prefix);
  } else if (step.type === 'clean') {
    response = runReadyCleanRepair(startup, response.action_trace, mode, prefix);
  } else if (step.type === 'restart') {
    response = runReadyRuntimeRepair(startup, response.action_trace, mode, prefix, 20_000, null);
  } else if (step.type === 'permission_handoff') {
    response = buildReadyResponse(
      startup,
      [...response.action_trace, step.trace],
      mode,
      prefix,
    );
  } else {
    exitError(`Unknown readiness execution step: ${step.type}`, 'READY_EXECUTION_STEP_INVALID');
  }
}
if (!stopped) exitError('Readiness execution did not converge.', 'READY_EXECUTION_DID_NOT_CONVERGE');

const handoffAlert = options.repair
  ? maybePlayTccHandoffAlert(response, mode)
  : undefined;
if (handoffAlert) response.tcc_handoff_alert = handoffAlert;

if (options.json) printJSON(response);
else printText(response, mode, prefix);

process.exit(response.ready ? 0 : 1);

#!/usr/bin/env node

import fs from 'node:fs';

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
import {
  hasRestartableReadyRuntimeBlocker,
  permissionFixLines,
  permissionResetSafeSequenceLines,
  readyAutoRepairReason,
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
    permissions: facts.permissions,
    permissions_setup: facts.setup,
    blocked_capabilities: verdict.blocked_capabilities,
    blockers: verdict.blockers,
    next_actions: verdict.next_actions,
    action_trace: actionTrace,
    notes: verdict.notes,
  };
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

function decideReadyStartup({ repair, mode, prefix }) {
  const skipServiceStart = process.env.AOS_TEST_SKIP_READY_SERVICE_START === '1';
  const skippedStartup = {
    attempted: false,
    command: serviceCommandString(mode, prefix, 'start'),
    exit_code: 0,
    status: 'skipped',
  };

  if (skipServiceStart) {
    return {
      startup: skippedStartup,
      actionTrace: [{
        step: 'service_start',
        result: 'skipped',
        detail: 'AOS_TEST_SKIP_READY_SERVICE_START=1',
      }],
    };
  }

  const preflight = buildReadyResponse(skippedStartup, [], mode, prefix);
  if (preflight.blockers.some((blocker) => blocker.id === 'stale_daemons')) {
    const actionTrace = [{
      step: 'ready_preflight',
      result: 'stale_daemons',
      detail: 'cleanup must run before service start',
    }];
    return {
      startup: skippedStartup,
      actionTrace,
      readyResponse: { ...preflight, action_trace: actionTrace },
    };
  }

  if (!repair && preflight.ready) {
    const actionTrace = [{
      step: 'ready_preflight',
      result: 'ready',
      detail: 'managed daemon is already reachable, owned by the expected runtime, and input tap is active',
    }];
    return {
      startup: skippedStartup,
      actionTrace,
      readyResponse: { ...preflight, action_trace: actionTrace },
    };
  }

  const result = runReadyServiceAction('start', mode);
  return {
    startup: {
      attempted: true,
      command: serviceCommandString(mode, prefix, 'start'),
      exit_code: result.exitCode,
      status: result.exitCode === 0 ? 'ok' : 'degraded',
    },
    actionTrace: [{
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
  if (response.next_actions.length) {
    process.stdout.write('Next:\n');
    for (const action of response.next_actions) {
      if (response.phase === 'human_required' && action.type === 'open_settings') continue;
      if (action.command) process.stdout.write(`  ${action.command}  # ${action.label}\n`);
      else process.stdout.write(`  ${action.label}\n`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const mode = currentMode();
const prefix = invocationName();
const decision = decideReadyStartup({ repair: options.repair, mode, prefix });
let response = decision.readyResponse ?? buildReadyResponse(decision.startup, decision.actionTrace, mode, prefix);

if (!options.repair && process.env.AOS_TEST_SKIP_READY_SERVICE_START !== '1') {
  const reason = readyAutoRepairReason(response, { postPermission: options.postPermission });
  if (reason) {
    response = runReadyRuntimeRepair(
      decision.startup,
      response.action_trace,
      mode,
      prefix,
      options.postPermission ? 20_000 : 10_000,
      reason,
    );
  }
}

if (options.repair && !response.ready) {
  if (response.blockers.some((blocker) => blocker.id === 'stale_daemons')) {
    response = runReadyCleanRepair(decision.startup, response.action_trace, mode, prefix);
  }
  if (hasRestartableReadyRuntimeBlocker(response)) {
    response = runReadyRuntimeRepair(decision.startup, response.action_trace, mode, prefix, 20_000, null);
  }
  if (!response.ready && response.blockers.some((blocker) => blocker.kind === 'permission')) {
    const trace = [...response.action_trace, {
      step: 'runtime_tcc_reset_handoff',
      result: 'human_required',
      detail: `${prefix} permissions reset-runtime --mode ${mode}`,
    }];
    response = buildReadyResponse(decision.startup, trace, mode, prefix);
  }
}

if (options.json) printJSON(response);
else printText(response, mode, prefix);

process.exit(response.ready ? 0 : 1);

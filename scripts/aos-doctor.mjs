#!/usr/bin/env node

import os from 'node:os';

import {
  currentMode,
  exitError,
  expectedBinaryPath,
  invocationName,
  parseJSONOutput,
  printJSON,
  run,
  runNodeScript,
} from './lib/aos-cli.mjs';
import {
  brokerFacts,
  cleanReport,
  identity,
} from './lib/aos-facts.mjs';
import {
  evaluateReadyForTesting,
  inputMonitoringSubGuidance,
  inputTapRecoveryGuidance,
  permissionRequirements,
  readyEvaluationSnake,
  runtimeVerdict,
} from './lib/aos-readiness.mjs';

function parseArgs(args) {
  for (const arg of args) {
    if (arg !== '--json') exitError(`Unknown flag: ${arg}. Usage: ${invocationName()} doctor [--json]`, 'UNKNOWN_FLAG');
  }
}

function parsePrimitive(result, label) {
  return parseJSONOutput(result, label, {
    failureCode: 'DOCTOR_PRIMITIVE_FAILED',
    jsonCode: 'DOCTOR_PRIMITIVE_JSON_INVALID',
  });
}

function serviceState(mode) {
  const status = parsePrimitive(
    runNodeScript('scripts/aos-service.mjs', ['status', '--mode', mode, '--json']),
    'aos-service status',
  );
  return {
    label: status.label ?? status.launchd_label,
    installed: Boolean(status.installed),
    loaded: Boolean(status.loaded),
    running: Boolean(status.running),
    pid: status.pid,
    plist_path: status.plist_path,
    actual_binary_path: status.actual_binary_path,
    expected_binary_path: status.expected_binary_path,
    actual_log_path: status.actual_log_path,
    expected_log_path: status.expected_log_path,
    target_matches_expected: Boolean(status.target_matches_expected),
    log_path_matches_expected: Boolean(status.log_path_matches_expected),
    notes: status.notes ?? [],
  };
}

function platformState() {
  const swVers = run('/usr/bin/sw_vers', ['-productVersion']);
  return {
    os: 'macOS',
    version: swVers.exitCode === 0 ? swVers.stdout.trim() : os.release(),
  };
}

function doctorNotes({ runtime, permissions, setup, service, verdict }) {
  const notes = [...verdict.notes];
  if (runtime.other_mode_socket_reachable) {
    notes.push(`BROKEN STATE: ${runtime.mode} runtime is active while the ${runtime.mode === 'repo' ? 'installed' : 'repo'} socket is also reachable.`);
  }
  if (!permissions.accessibility && !notes.includes('Accessibility permission is not granted (CLI view).')) notes.push('Accessibility permission is not granted.');
  if (!permissions.screen_recording && !notes.includes('Screen Recording permission is not granted.')) notes.push('Screen Recording permission is not granted.');
  if (!setup.setup_completed && setup.recommended_command) {
    const setupNote = `Run '${setup.recommended_command}' before interactive testing.`;
    if (!notes.includes(setupNote)) notes.push(setupNote);
  }
  if (!service.target_matches_expected) {
    notes.push(`AOS launch agent target does not match the expected ${runtime.mode} runtime binary.`);
  }
  if (!service.log_path_matches_expected) {
    notes.push(`AOS launch agent log path does not match the expected ${runtime.mode} state directory.`);
  }
  if (runtime.legacy_state_items?.length) {
    notes.push(`Legacy shared runtime state still exists in ${runtime.legacy_state_dir}.`);
  }
  if (runtime.repo_artifacts?.length) {
    notes.push(`Repo build artifacts are still present: ${runtime.repo_artifacts.join(', ')}.`);
  }
  if (runtime.socket_reachable && runtime.input_tap && runtime.input_tap.status !== 'active') {
    const recovery = inputTapRecoveryGuidance(runtime.input_tap.status, runtime.input_tap.attempts);
    if (!notes.includes(recovery)) notes.push(recovery);
    if (runtime.input_tap.listen_access === false || runtime.input_tap.post_access === false) {
      const inputMonitoring = inputMonitoringSubGuidance(runtime.input_tap, expectedBinaryPath(runtime.mode));
      if (!notes.includes(inputMonitoring)) notes.push(inputMonitoring);
    }
  }
  return notes;
}

async function buildDoctorResponse() {
  const mode = currentMode();
  const facts = brokerFacts({
    failureCode: 'DOCTOR_PRIMITIVE_FAILED',
    jsonCode: 'DOCTOR_PRIMITIVE_JSON_INVALID',
    includeRuntime: true,
  });
  const service = serviceState(mode);
  const evaluation = evaluateReadyForTesting(facts.daemon, facts.permissions, facts.setup);
  const clean = cleanReport();
  const verdict = runtimeVerdict({ ...facts, cleanReport: clean }, mode, invocationName());
  const notes = doctorNotes({ runtime: facts.runtime, permissions: facts.permissions, setup: facts.setup, service, verdict });

  return {
    status: notes.length ? 'degraded' : 'ok',
    platform: platformState(),
    identity: identity(facts.runtime, facts.permissionsFacts),
    permissions: facts.permissions,
    permissions_requirements: permissionRequirements(facts.permissions),
    permissions_setup: facts.setup,
    runtime: facts.runtime,
    runtime_verdict: verdict,
    aos_service: service,
    ...readyEvaluationSnake(evaluation),
    notes,
  };
}

parseArgs(process.argv.slice(2));
printJSON(await buildDoctorResponse());

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(omitNulls(value), null, 2)}\n`);
}

function omitNulls(value) {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, omitNulls(item)]),
  );
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

function runService(args, mode = currentMode()) {
  return runAOS(['service', ...args, '--mode', mode, '--json']);
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

function parseJSONOutputLoose(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    const detail = (result.stderr || result.stdout).trim();
    exitError(`${label} did not return JSON${detail ? `: ${detail}` : ''}`, 'PERMISSIONS_PRIMITIVE_JSON_INVALID');
  }
}

function parseArgs(args) {
  const subcommand = args[0];
  if (!['check', 'preflight', 'setup', 'reset-runtime'].includes(subcommand)) {
    exitError(`Unknown permissions subcommand: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
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

function permissionsFromFacts() {
  const facts = parseJSONOutput(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  return {
    accessibility: Boolean(facts.permissions?.accessibility),
    screen_recording: Boolean(facts.permissions?.screen_recording),
    listen_access: Boolean(facts.permissions?.listen_access),
    post_access: Boolean(facts.permissions?.post_access),
  };
}

function setupFacts() {
  return setupState(parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
}

function daemonFacts() {
  const result = runAOS(['__daemon', 'health', '--json']);
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
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

function parseSetupArgs(args) {
  const usage = `${invocationName()} permissions setup [--json] [--once]`;
  const options = { json: false, once: false };
  for (const arg of args) {
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--once':
        options.once = true;
        break;
      default:
        exitError(`Unknown flag: ${arg}. Usage: ${usage}`, 'UNKNOWN_FLAG');
    }
  }
  return options;
}

function parseResetRuntimeArgs(args) {
  const usage = `${invocationName()} permissions reset-runtime [--mode repo|installed] [--allow-service-reset --emergency-ack-other-apps] [--dry-run] [--json]`;
  const options = {
    json: false,
    dryRun: false,
    allowServiceReset: false,
    emergencyAckOtherApps: false,
    mode: currentMode(),
  };
  for (let i = 0; i < args.length;) {
    switch (args[i]) {
      case '--json':
        options.json = true;
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        i += 1;
        break;
      case '--allow-service-reset':
        options.allowServiceReset = true;
        i += 1;
        break;
      case '--emergency-ack-other-apps':
        options.emergencyAckOtherApps = true;
        i += 1;
        break;
      case '--mode':
        if (i + 1 >= args.length || !['repo', 'installed'].includes(args[i + 1])) {
          exitError("--mode must be 'repo' or 'installed'", 'INVALID_ARG');
        }
        options.mode = args[i + 1];
        i += 2;
        break;
      default:
        exitError(`Unknown flag: ${args[i]}. Usage: ${usage}`, 'UNKNOWN_FLAG');
    }
  }

  if (options.allowServiceReset && !options.emergencyAckOtherApps) {
    exitError(
      '--allow-service-reset is emergency-only and requires --emergency-ack-other-apps. Do not use it unless Michael explicitly asks for break-glass TCC service reset.',
      'EMERGENCY_ACK_REQUIRED',
    );
  }
  if (options.emergencyAckOtherApps && !options.allowServiceReset) {
    exitError('--emergency-ack-other-apps requires --allow-service-reset.', 'INVALID_ARG');
  }
  return options;
}

function setupResponse({ status, completed, permissions, setup, missing, restartedServices, notes }) {
  return {
    status,
    completed,
    permissions,
    requirements: permissionRequirements(permissions),
    setup,
    missing_permissions: missing,
    marker_path: setup.marker_path,
    restarted_services: restartedServices,
    notes,
  };
}

function permissionRecoveryNotes(missing, mode) {
  const notes = [];
  if (missing.includes('accessibility')) {
    notes.push('Daemon or CLI Accessibility permission is stale or missing.');
  }
  if (missing.includes('screen_recording')) {
    notes.push('Screen Recording permission is still not granted.');
  }
  if (missing.includes('listen_access') || missing.includes('post_access')) {
    notes.push('Daemon-owned Input Monitoring permission is stale or missing.');
  }
  notes.push(`Run '${invocationName()} permissions reset-runtime --mode ${mode}' before requesting fresh prompts.`);
  notes.push(`Then run '${invocationName()} permissions setup --once' and '${invocationName()} ready --post-permission'.`);
  return notes;
}

function restartPermissionsDependentServices(mode) {
  const status = parseJSONOutputLoose(runService(['status'], mode), 'service status');
  if (status.loaded !== true) return [];
  const restart = parseJSONOutputLoose(runService(['restart'], mode), 'service restart');
  if (restart.status === 'ok' || restart.running === true) return [serviceLabel(mode)];
  return [];
}

function serviceLabel(mode) {
  return `com.agent-os.aos.${mode}`;
}

function promptMissingPermissions(initialPermissions) {
  const order = [
    ['accessibility', 'accessibility'],
    ['screen_recording', 'screen-recording'],
    ['listen_access', 'listen-event'],
    ['post_access', 'post-event'],
  ];
  const notes = [];
  for (const [permissionID, primitiveID] of order) {
    if (initialPermissions[permissionID]) continue;
    const result = runAOS(['__permissions', 'prompt', primitiveID, '--json']);
    const response = parseJSONOutputLoose(result, `__permissions prompt ${primitiveID}`);
    if (response.granted !== true) {
      notes.push(`${permissionID} permission setup was cancelled before completion.`);
      break;
    }
  }
  return notes;
}

function runSetup(args) {
  const options = parseSetupArgs(args);
  const mode = currentMode();
  const initialPermissions = permissionsFromFacts();
  const initialSetup = setupFacts();
  const initialDaemon = daemonViewFromHealth(daemonFacts()).comparable;
  const initialMissing = missingPermissionIDsFor(initialDaemon, initialPermissions);

  if (options.once && initialSetup.setup_completed && initialMissing.length === 0) {
    printSetupResult(setupResponse({
      status: 'ok',
      completed: true,
      permissions: initialPermissions,
      setup: initialSetup,
      missing: [],
      restartedServices: [],
      notes: ['Permissions are already granted; onboarding was skipped.'],
    }), options.json);
    return;
  }

  if (options.once && initialSetup.setup_completed && initialMissing.length > 0) {
    printSetupResult(setupResponse({
      status: 'degraded',
      completed: false,
      permissions: initialPermissions,
      setup: initialSetup,
      missing: initialMissing,
      restartedServices: [],
      notes: permissionRecoveryNotes(initialMissing, mode),
    }), options.json);
    process.exitCode = 1;
    return;
  }

  const allCLIGranted = initialPermissions.accessibility
    && initialPermissions.screen_recording
    && initialPermissions.listen_access
    && initialPermissions.post_access;

  if (options.once && allCLIGranted && initialMissing.length === 0) {
    const marker = parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'write', '--json']), '__permissions setup-marker write');
    const finalSetup = setupState(marker.marker ?? marker);
    const restartedServices = restartPermissionsDependentServices(mode);
    const notes = ['Permissions were already granted; onboarding marker was recorded without additional prompts.'];
    notes.push(restartedServices.length
      ? `Restarted services: ${restartedServices.join(', ')}.`
      : 'No managed services were running to restart.');
    printSetupResult(setupResponse({
      status: 'ok',
      completed: true,
      permissions: initialPermissions,
      setup: finalSetup,
      missing: [],
      restartedServices,
      notes,
    }), options.json);
    return;
  }

  if (options.once && allCLIGranted && initialMissing.length > 0) {
    printSetupResult(setupResponse({
      status: 'degraded',
      completed: false,
      permissions: initialPermissions,
      setup: initialSetup,
      missing: initialMissing,
      restartedServices: [],
      notes: permissionRecoveryNotes(initialMissing, mode),
    }), options.json);
    process.exitCode = 1;
    return;
  }

  const notes = promptMissingPermissions(initialPermissions);
  const finalPermissions = permissionsFromFacts();
  if (!finalPermissions.accessibility) notes.push('Accessibility permission is still not granted.');
  if (!finalPermissions.screen_recording) notes.push('Screen Recording permission is still not granted.');
  if (!finalPermissions.listen_access) notes.push('Input Monitoring listen access is still not granted.');
  if (!finalPermissions.post_access) notes.push('Input Monitoring post access is still not granted.');

  const completedByCLI = finalPermissions.accessibility
    && finalPermissions.screen_recording
    && finalPermissions.listen_access
    && finalPermissions.post_access
    && notes.length === 0;
  let finalSetup = setupFacts();
  let restartedServices = [];
  if (completedByCLI) {
    const marker = parseJSONOutput(runAOS(['__permissions', 'setup-marker', 'write', '--json']), '__permissions setup-marker write');
    finalSetup = setupState(marker.marker ?? marker);
    restartedServices = restartPermissionsDependentServices(mode);
    notes.push(restartedServices.length
      ? `Restarted services: ${restartedServices.join(', ')}.`
      : 'Permissions were granted, but no managed services were running to restart.');
  }

  const finalDaemon = daemonViewFromHealth(daemonFacts()).comparable;
  const missing = missingPermissionIDsFor(finalDaemon, finalPermissions);
  if (completedByCLI && missing.length > 0) notes.push(...permissionRecoveryNotes(missing, mode));
  const completed = completedByCLI && missing.length === 0;
  printSetupResult(setupResponse({
    status: completed ? 'ok' : 'degraded',
    completed,
    permissions: finalPermissions,
    setup: finalSetup,
    missing,
    restartedServices,
    notes,
  }), options.json);
  if (!completed) process.exitCode = 1;
}

function printSetupResult(response, json) {
  if (json) {
    printJSON(response);
    return;
  }
  process.stdout.write(`completed=${response.completed} accessibility=${response.permissions.accessibility} screen_recording=${response.permissions.screen_recording} listen_access=${response.permissions.listen_access} post_access=${response.permissions.post_access}\n`);
  const evaluation = evaluateReadyForTesting(null, response.permissions, response.setup);
  process.stdout.write(`ready_for_testing=${evaluation.ready_for_testing}\n`);
  if (response.restarted_services.length) {
    process.stdout.write(`restarted=${response.restarted_services.join(',')}\n`);
  }
  for (const note of response.notes) process.stdout.write(`${note}\n`);
}

function resetRuntimeStep(command, attempted, status, result = null, stderr = null) {
  return {
    command,
    attempted,
    exit_code: result?.exitCode ?? null,
    status,
    stdout: result ? trimmedOutput(result.stdout) : null,
    stderr: stderr ?? (result ? trimmedOutput(result.stderr) : null),
  };
}

function trimmedOutput(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function resetPostActions() {
  const prefix = invocationName();
  return [
    {
      type: 'command',
      label: 'request fresh macOS permission prompts after reset-runtime completes',
      command: `${prefix} permissions setup --once`,
    },
    {
      type: 'command',
      label: 'bounded readiness check after permissions have been granted',
      command: `${prefix} ready --post-permission`,
    },
  ];
}

function resetFallbackLines(mode, targetPath) {
  const prefix = invocationName();
  return [
    `Confirm the managed daemon is stopped: ${prefix} service status --mode ${mode}`,
    `Normal fallback only if running=false: remove/re-add ${targetPath} in Accessibility and/or Input Monitoring.`,
    'Service-wide TCC reset is break-glass only; do not run it unless Michael explicitly asks for emergency recovery.',
    `Return to the waiting session and say: finished; the session then runs ${prefix} ready --post-permission.`,
  ];
}

function serviceResetNames() {
  return ['Accessibility', 'ListenEvent', 'PostEvent'];
}

function serviceResetStep(service, dryRun) {
  const command = `tccutil reset ${service}`;
  if (dryRun) return resetRuntimeStep(command, false, 'planned');
  const result = run('/usr/bin/tccutil', ['reset', service]);
  return resetRuntimeStep(command, true, result.exitCode === 0 ? 'ok' : 'failed', result);
}

function printResetRuntimeResult(response, json) {
  if (json) {
    printJSON(response);
    return;
  }
  process.stdout.write(`status=${response.status} mode=${response.mode} dry_run=${response.dry_run}\n`);
  process.stdout.write(`target=${response.target_path}\n`);
  process.stdout.write(`tcc_identifier=${response.tcc_identifier}\n`);
  process.stdout.write(`service_stop=${response.service_stop.status}\n`);
  process.stdout.write(`tcc_reset=${response.tcc_reset.status}\n`);
  if (response.service_resets.length) {
    process.stdout.write(`service_resets=${response.service_resets.map((step) => step.status).join(',')}\n`);
  }
  for (const note of response.notes) process.stdout.write(`${note}\n`);
  if (response.next_actions.length) {
    process.stdout.write('Next:\n');
    for (const action of response.next_actions) {
      if (action.command) process.stdout.write(`  ${action.command}  # ${action.label}\n`);
      else process.stdout.write(`  ${action.label}\n`);
    }
  }
  if (response.fallback.length) {
    process.stdout.write('Fallback:\n');
    for (const line of response.fallback) process.stdout.write(`  ${line}\n`);
  }
}

function serviceStopReportedStopped(result) {
  const parsed = parseJSONOutputLoose(result, 'service stop');
  return parsed.running === false;
}

function runResetRuntime(args) {
  const options = parseResetRuntimeArgs(args);
  const target = parseJSONOutput(runAOS(['__permissions', 'reset-target', '--mode', options.mode, '--json']), '__permissions reset-target');
  const stopCommand = `${invocationName()} service stop --mode ${options.mode} --json`;
  const tccResetCommand = target.available
    ? (target.command ?? `tccutil reset All ${target.tcc_identifier}`)
    : `targeted tccutil reset unavailable for ${target.tcc_identifier}`;
  const plannedServiceResets = options.allowServiceReset
    ? serviceResetNames().map((service) => serviceResetStep(service, true))
    : [];

  if (options.dryRun) {
    printResetRuntimeResult({
      status: 'ok',
      mode: options.mode,
      dry_run: true,
      target_path: target.target_path,
      tcc_identifier: target.tcc_identifier,
      service_stop: resetRuntimeStep(stopCommand, false, 'planned'),
      tcc_reset: resetRuntimeStep(tccResetCommand, false, target.available ? 'planned' : 'unavailable', null, target.unavailable_reason ?? null),
      service_resets: plannedServiceResets,
      next_actions: resetPostActions(),
      fallback: [],
      notes: [
        'Dry run only; no service or TCC state was changed.',
        target.available
          ? 'The real command stops the managed daemon before calling tccutil.'
          : 'The real command stops the managed daemon, then reports the targeted reset as unavailable for the bare repo binary.',
        options.allowServiceReset
          ? 'Emergency dry run only: if targeted bundle reset fails, the command would reset Accessibility/ListenEvent/PostEvent decisions for all apps.'
          : 'Service-wide TCC reset is not part of normal recovery; it is an emergency-only capability that requires an explicit break-glass request.',
      ],
    }, options.json);
    return;
  }

  const stopResult = runService(['stop'], options.mode);
  const stopOK = stopResult.exitCode === 0 && serviceStopReportedStopped(stopResult);
  const stopStep = resetRuntimeStep(stopCommand, true, stopOK ? 'ok' : 'failed', stopResult);
  if (!stopOK) {
    printResetRuntimeResult({
      status: 'degraded',
      mode: options.mode,
      dry_run: false,
      target_path: target.target_path,
      tcc_identifier: target.tcc_identifier,
      service_stop: stopStep,
      tcc_reset: resetRuntimeStep(tccResetCommand, false, 'blocked'),
      service_resets: [],
      next_actions: [{
        type: 'command',
        label: 'inspect managed daemon state before changing macOS permissions',
        command: `${invocationName()} service status --mode ${options.mode}`,
      }],
      fallback: [],
      notes: [
        'The managed daemon did not report running=false, so TCC reset was not attempted.',
        'Do not remove or reset Accessibility/Input Monitoring while the daemon may still be running.',
      ],
    }, options.json);
    process.exitCode = 1;
    return;
  }

  if (!target.available) {
    const serviceResetSteps = options.allowServiceReset
      ? serviceResetNames().map((service) => serviceResetStep(service, false))
      : [];
    const serviceResetOK = serviceResetSteps.length > 0 && serviceResetSteps.every((step) => step.status === 'ok');
    printResetRuntimeResult({
      status: serviceResetOK ? 'ok' : 'degraded',
      mode: options.mode,
      dry_run: false,
      target_path: target.target_path,
      tcc_identifier: target.tcc_identifier,
      service_stop: stopStep,
      tcc_reset: resetRuntimeStep(tccResetCommand, false, 'unavailable', null, target.unavailable_reason ?? null),
      service_resets: serviceResetSteps,
      next_actions: resetPostActions(),
      fallback: serviceResetOK ? [] : resetFallbackLines(options.mode, target.target_path),
      notes: serviceResetOK
        ? [
            'Targeted reset is unavailable for this runtime identity, but emergency Accessibility/ListenEvent/PostEvent service resets completed after the managed daemon stopped.',
            'The next command should request fresh macOS prompts.',
          ]
        : [
            'The managed daemon is stopped.',
            target.unavailable_reason ?? 'Targeted tccutil reset is unavailable for this runtime identity.',
            'Normal fallback is stopped-daemon manual removal/re-add for this AOS runtime.',
            'Do not run service-wide TCC reset unless Michael explicitly asks for break-glass recovery.',
          ],
    }, options.json);
    if (!serviceResetOK) process.exitCode = 1;
    return;
  }

  const resetResult = runAOS(['__permissions', 'tcc-reset', '--mode', options.mode, '--json']);
  const resetPayload = parseJSONOutputLoose(resetResult, '__permissions tcc-reset');
  const resetStep = resetPayload.tcc_reset ?? resetRuntimeStep(tccResetCommand, true, resetResult.exitCode === 0 ? 'ok' : 'failed', resetResult);
  const resetOK = resetResult.exitCode === 0 && resetStep.status === 'ok';
  const serviceResetSteps = resetOK || !options.allowServiceReset
    ? []
    : serviceResetNames().map((service) => serviceResetStep(service, false));
  const serviceResetOK = serviceResetSteps.length > 0 && serviceResetSteps.every((step) => step.status === 'ok');
  const completed = resetOK || serviceResetOK;
  printResetRuntimeResult({
    status: completed ? 'ok' : 'degraded',
    mode: options.mode,
    dry_run: false,
    target_path: target.target_path,
    tcc_identifier: target.tcc_identifier,
    service_stop: stopStep,
    tcc_reset: resetStep,
    service_resets: serviceResetSteps,
    next_actions: resetPostActions(),
    fallback: completed ? [] : resetFallbackLines(options.mode, target.target_path),
    notes: resetOK
      ? [
          'Targeted TCC reset completed after the managed daemon stopped.',
          'The next command should request fresh macOS prompts instead of asking for manual row removal.',
        ]
      : serviceResetOK
      ? [
          'Targeted bundle reset failed, but emergency Accessibility/ListenEvent/PostEvent service resets completed after the managed daemon stopped.',
          'The next command should request fresh macOS prompts.',
        ]
      : [
          'The managed daemon is stopped, but tccutil reset failed.',
          'The repo ./aos binary is not a LaunchServices bundle, so targeted tccutil reset may be unavailable for it.',
          'Do not run service-wide TCC reset unless Michael explicitly asks for break-glass recovery.',
        ],
  }, options.json);
  if (!completed) process.exitCode = 1;
}

const { subcommand } = parseArgs(process.argv.slice(2));
if (subcommand === 'setup') {
  runSetup(process.argv.slice(3));
} else if (subcommand === 'reset-runtime') {
  runResetRuntime(process.argv.slice(3));
} else {
  const usage = `${invocationName()} permissions ${subcommand} [--json]`;
  for (const arg of process.argv.slice(3)) {
    if (arg !== '--json') exitError(`Unknown flag: ${arg}. Usage: ${usage}`, 'UNKNOWN_FLAG');
  }
  runCheck();
}

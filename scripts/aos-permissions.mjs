#!/usr/bin/env node

import {
  currentMode,
  exitError,
  invocationName,
  parseJSONOutput,
  printJSON,
  run,
  runAOS,
} from './lib/aos-cli.mjs';
import {
  brokerFacts,
  daemonViewFromHealth,
  setupState,
} from './lib/aos-facts.mjs';
import {
  disagreementFor,
  evaluateReadyForTesting,
  missingPermissionIDsFor,
  permissionCheckNotes,
  permissionRecoveryNotes,
  permissionRequirements,
  planPermissionSetup,
  readyEvaluationSnake,
  runSetupPromptPlan,
} from './lib/aos-readiness.mjs';

function parsePrimitive(result, label, errorCode = 'PERMISSIONS_PRIMITIVE_FAILED') {
  return parseJSONOutput(result, label, {
    failureCode: errorCode,
    jsonCode: 'PERMISSIONS_PRIMITIVE_JSON_INVALID',
  });
}

function parsePrimitiveLoose(result, label) {
  return parseJSONOutput(result, label, {
    jsonCode: 'PERMISSIONS_PRIMITIVE_JSON_INVALID',
    requireZeroExit: false,
  });
}

function runService(args, mode = currentMode()) {
  return runAOS(['service', ...args, '--mode', mode, '--json']);
}

function parseArgs(args) {
  const subcommand = args[0];
  if (!['check', 'preflight', 'setup', 'reset-runtime'].includes(subcommand)) {
    exitError(`Unknown permissions subcommand: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
  return { subcommand };
}

function currentFacts() {
  return brokerFacts({
    failureCode: 'PERMISSIONS_PRIMITIVE_FAILED',
    jsonCode: 'PERMISSIONS_PRIMITIVE_JSON_INVALID',
    daemonRequired: false,
    includeRuntime: false,
  });
}

function permissionsFromFacts() {
  const facts = parsePrimitive(runAOS(['__permissions', 'facts', '--json']), '__permissions facts');
  return {
    accessibility: Boolean(facts.permissions?.accessibility),
    screen_recording: Boolean(facts.permissions?.screen_recording),
    listen_access: Boolean(facts.permissions?.listen_access),
    post_access: Boolean(facts.permissions?.post_access),
  };
}

function setupFacts() {
  return setupState(parsePrimitive(runAOS(['__permissions', 'setup-marker', 'get', '--json']), '__permissions setup-marker get'));
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
  const evaluation = readyEvaluationSnake(evaluateReadyForTesting(daemon.comparable, cli, facts.setup));
  const notes = permissionCheckNotes(cli, facts.setup, daemon.comparable, mode);
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
  printJSON(response, { omit: true });
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

function restartPermissionsDependentServices(mode) {
  const status = parsePrimitiveLoose(runService(['status'], mode), 'service status');
  if (status.loaded !== true) return [];
  const restart = parsePrimitiveLoose(runService(['restart'], mode), 'service restart');
  if (restart.status === 'ok' || restart.running === true) return [serviceLabel(mode)];
  return [];
}

function serviceLabel(mode) {
  return `com.agent-os.aos.${mode}`;
}

function promptMissingPermissions(plan) {
  return runSetupPromptPlan({
    plan,
    prompt: ({ primitiveID }) => parsePrimitiveLoose(
      runAOS(['__permissions', 'prompt', primitiveID, '--json']),
      `__permissions prompt ${primitiveID}`,
    ),
  });
}

function printSetupResult(response, json) {
  if (json) {
    printJSON(response, { omit: true });
    return;
  }
  process.stdout.write(`completed=${response.completed} accessibility=${response.permissions.accessibility} screen_recording=${response.permissions.screen_recording} listen_access=${response.permissions.listen_access} post_access=${response.permissions.post_access}\n`);
  const evaluation = readyEvaluationSnake(evaluateReadyForTesting(null, response.permissions, response.setup));
  process.stdout.write(`ready_for_testing=${evaluation.ready_for_testing}\n`);
  if (response.restarted_services.length) {
    process.stdout.write(`restarted=${response.restarted_services.join(',')}\n`);
  }
  for (const note of response.notes) process.stdout.write(`${note}\n`);
}

function writeSetupMarkerAndRestart(mode, permissions, baseNote) {
  const marker = parsePrimitive(runAOS(['__permissions', 'setup-marker', 'write', '--json']), '__permissions setup-marker write');
  const finalSetup = setupState(marker.marker ?? marker);
  const restartedServices = restartPermissionsDependentServices(mode);
  const notes = [baseNote];
  notes.push(restartedServices.length
    ? `Restarted services: ${restartedServices.join(', ')}.`
    : 'No managed services were running to restart.');
  return { finalSetup, restartedServices, notes, permissions };
}

function runSetup(args) {
  const options = parseSetupArgs(args);
  const mode = currentMode();
  const initialPermissions = permissionsFromFacts();
  const initialSetup = setupFacts();
  const initialDaemon = daemonViewFromHealth(daemonFacts()).comparable;
  const initialMissing = missingPermissionIDsFor(initialDaemon, initialPermissions);
  const plan = planPermissionSetup({
    initialPermissions,
    initialSetup,
    initialMissing,
    once: options.once,
    mode,
    prefix: invocationName(),
  });

  if (plan.branch === 'already_complete') {
    printSetupResult(setupResponse({
      status: plan.status,
      completed: plan.completed,
      permissions: initialPermissions,
      setup: initialSetup,
      missing: [],
      restartedServices: [],
      notes: plan.notes,
    }), options.json);
    return;
  }

  if (plan.branch === 'completed_but_missing' || plan.branch === 'cli_granted_daemon_missing') {
    printSetupResult(setupResponse({
      status: plan.status,
      completed: false,
      permissions: initialPermissions,
      setup: initialSetup,
      missing: initialMissing,
      restartedServices: [],
      notes: plan.notes,
    }), options.json);
    process.exitCode = 1;
    return;
  }

  if (plan.branch === 'record_marker_without_prompts') {
    const recorded = writeSetupMarkerAndRestart(
      mode,
      initialPermissions,
      'Permissions were already granted; onboarding marker was recorded without additional prompts.',
    );
    printSetupResult(setupResponse({
      status: 'ok',
      completed: true,
      permissions: initialPermissions,
      setup: recorded.finalSetup,
      missing: [],
      restartedServices: recorded.restartedServices,
      notes: recorded.notes,
    }), options.json);
    return;
  }

  const notes = promptMissingPermissions(plan);
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
    const marker = parsePrimitive(runAOS(['__permissions', 'setup-marker', 'write', '--json']), '__permissions setup-marker write');
    finalSetup = setupState(marker.marker ?? marker);
    restartedServices = restartPermissionsDependentServices(mode);
    notes.push(restartedServices.length
      ? `Restarted services: ${restartedServices.join(', ')}.`
      : 'Permissions were granted, but no managed services were running to restart.');
  }

  const finalDaemon = daemonViewFromHealth(daemonFacts()).comparable;
  const missing = missingPermissionIDsFor(finalDaemon, finalPermissions);
  if (completedByCLI && missing.length > 0) notes.push(...permissionRecoveryNotes(missing, mode, invocationName()));
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
    printJSON(response, { omit: true });
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
  const parsed = parsePrimitiveLoose(result, 'service stop');
  return parsed.running === false;
}

function runResetRuntime(args) {
  const options = parseResetRuntimeArgs(args);
  const target = parsePrimitive(runAOS(['__permissions', 'reset-target', '--mode', options.mode, '--json']), '__permissions reset-target');
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
  const resetPayload = parsePrimitiveLoose(resetResult, '__permissions tcc-reset');
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

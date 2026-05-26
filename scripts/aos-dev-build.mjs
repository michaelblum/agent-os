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

function checkpointContract() {
  const prefix = './aos';
  const resetCommand = `${prefix} permissions reset-runtime --mode repo`;
  const setupCommand = `${prefix} permissions setup --once`;
  const readyCommand = `${prefix} ready --post-permission`;
  const pauseCommand = '/goal pause';
  const resumeCommand = '/goal resume';
  const returnSignal = 'finished';

  const repeatedBuildMessage = `dev_build_checkpoint_already_completed

${prefix} dev build already completed successfully for this checkpoint.
Do not run ${prefix} dev build again.

Run exactly:
${readyCommand}

If that reports ready=true, continue with the next planned step after the
completed build.
`;

  const postToolMessage = `goal_pause_required: repo-mode AOS permission repair

${prefix} dev build completed successfully. Treat the build step as complete for
this checkpoint. Do not run ${prefix} dev build again after the human return
signal unless a human explicitly asks for another rebuild.

Pause the active goal now by sending:
${pauseCommand}

The hook has already requested:
1. ${resetCommand}
2. ${setupCommand}

Human action:
1. Grant the requested macOS Accessibility/Input Monitoring permission for the repo-mode AOS runtime in System Settings.
2. If macOS does not prompt or the grant remains stale, physically remove and re-add the repo-mode aos runtime in Accessibility/Input Monitoring, then enable it.
3. Return to this waiting session, or the next turn for this same session, and say: ${returnSignal}

After the human says ${returnSignal}, run exactly:
${readyCommand}

If that reports ready=true, continue with the next planned step after the
completed build. Do not restart from the build step.

Do not run ready/repair/status/helper loops before pausing.
`;

  const stopAfterBuildMessage = `GDI stopped for repo-mode AOS permission repair.

Checkpoint: ${prefix} dev build already completed successfully. Do not run ${prefix} dev build again for this checkpoint after the human return signal.

The hook/helper has already requested:
1. ${resetCommand}
2. ${setupCommand}

Human action:
1. Grant the requested macOS Accessibility/Input Monitoring permission for the repo-mode AOS runtime in System Settings.
2. If macOS does not prompt or the grant remains stale, physically remove and re-add the repo-mode aos runtime in Accessibility/Input Monitoring, then enable it.
3. Return to the GDI session, or the next turn for that same session, and say: ${returnSignal}

After the human says ${returnSignal}, GDI runs exactly: ${readyCommand}

If ready=true, continue with the next planned step after the completed build. Keep using the same GDI session rather than starting a new goal.
`;

  const stopMessage = `GDI stopped for repo-mode AOS permission repair.

The hook/helper has already requested:
1. ${resetCommand}
2. ${setupCommand}

Human action:
1. Grant the requested macOS Accessibility/Input Monitoring permission for the repo-mode AOS runtime in System Settings.
2. If macOS does not prompt or the grant remains stale, physically remove and re-add the repo-mode aos runtime in Accessibility/Input Monitoring, then enable it.
3. Return to the GDI session, or the next turn for that same session, and say: ${returnSignal}

After the human says ${returnSignal}, GDI runs: ${readyCommand}

Keep using the same GDI session rather than starting a new goal for the same work.
`;

  const canvasBody = `AOS already requested repo-mode reset/setup. Complete the macOS permission grant for Accessibility, Input Monitoring, and Screen & System Audio Recording if prompted. If no prompt appears or the grant stays stale, physically remove and re-add the repo-mode aos runtime in System Settings, then return to the waiting session and say: ${returnSignal}.`;

  return {
    schema: 'aos.dev_build.post_build_checkpoint.v1',
    reason: 'repo_mode_aos_permission_repair',
    pause_command: pauseCommand,
    resume_command: resumeCommand,
    return_signal: returnSignal,
    commands: {
      reset_runtime: resetCommand,
      setup_once: setupCommand,
      post_permission_ready: readyCommand,
    },
    human_actions: [
      { kind: 'agent_run', command: resetCommand },
      { kind: 'agent_run', command: setupCommand },
      { kind: 'grant', permissions: ['Accessibility', 'Input Monitoring'] },
      { kind: 'manual_regrant_if_needed', target: 'repo-mode aos runtime' },
      { kind: 'return', message: returnSignal },
    ],
    repeated_build_system_message: repeatedBuildMessage,
    post_tool_system_message: postToolMessage,
    stop_system_message: stopMessage,
    stop_system_message_after_build: stopAfterBuildMessage,
    canvas: {
      title: 'AOS permission reset needed',
      body: canvasBody,
    },
  };
}

function checkpointCommand(args) {
  const asJSON = args.includes('--json');
  for (const arg of args) {
    if (arg !== '--json') error(`Unknown dev build-checkpoint argument: ${arg}`, 'UNKNOWN_FLAG');
  }
  const contract = checkpointContract();
  if (asJSON) printJSON(contract);
  else process.stdout.write(`${contract.post_tool_system_message}\n`);
}

function buildCommand(args) {
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
  if (asJSON) {
    printJSON({
      status: exitCode === 0 ? 'success' : 'error',
      command: ['bash', 'build.sh', ...buildArgs].join(' '),
      build_wrapper: 'build.sh',
      build_source: 'repo-root/build.sh',
      post_build_checkpoint: checkpointContract(),
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
else if (subcommand === 'build-checkpoint') checkpointCommand(rest);
else error(`Unknown dev build command: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');

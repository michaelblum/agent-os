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
this checkpoint. Do not run ${prefix} dev build again after resume unless a human
explicitly asks for another rebuild.

Pause the active goal now by sending:
${pauseCommand}

Human action:
1. Run: ${resetCommand}
2. Run: ${setupCommand}
3. Grant the requested macOS Accessibility/Input Monitoring permission if macOS prompts.
4. Return to this session and say: ready
5. Resume the paused goal with: ${resumeCommand}

After resume, run exactly:
${readyCommand}

If that reports ready=true, continue with the next planned step after the
completed build. Do not restart from the build step.

Do not run ready/repair/status/helper loops before pausing.
`;

  const stopAfterBuildMessage = `GDI stopped for repo-mode AOS permission repair.

Checkpoint: ${prefix} dev build already completed successfully. Do not run ${prefix} dev build again for this checkpoint after resume.

Human action:
1. Run: ${resetCommand}
2. Run: ${setupCommand}
3. Grant the requested macOS Accessibility/Input Monitoring permission if macOS prompts.
4. Return to the GDI session and say: ready

After that, GDI runs exactly: ${readyCommand}

If ready=true, continue with the next planned step after the completed build. If the active goal is paused or Codex indicates it needs to resume, use ${resumeCommand} rather than starting a new goal.
`;

  const stopMessage = `GDI stopped for repo-mode AOS permission repair.

Human action:
1. Run: ${resetCommand}
2. Run: ${setupCommand}
3. Grant the requested macOS Accessibility/Input Monitoring permission if macOS prompts.
4. Return to the GDI session and say: ready

After that, GDI runs: ${readyCommand}

If the active goal is paused or Codex indicates it needs to resume, use ${resumeCommand} rather than starting a new goal.
`;

  const canvasBody = `Run ${resetCommand}, then ${setupCommand}. Grant Accessibility, Input Monitoring, and Screen & System Audio Recording if macOS prompts. Manual Settings removal is fallback only if targeted reset reports unavailable or failed.`;

  return {
    schema: 'aos.dev_build.post_build_checkpoint.v1',
    reason: 'repo_mode_aos_permission_repair',
    pause_command: pauseCommand,
    resume_command: resumeCommand,
    commands: {
      reset_runtime: resetCommand,
      setup_once: setupCommand,
      post_permission_ready: readyCommand,
    },
    human_actions: [
      { kind: 'run', command: resetCommand },
      { kind: 'run', command: setupCommand },
      { kind: 'grant', permissions: ['Accessibility', 'Input Monitoring'] },
      { kind: 'return', message: 'ready' },
      { kind: 'resume', command: resumeCommand },
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

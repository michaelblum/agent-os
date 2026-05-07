#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileScript = path.join(repoRoot, 'scripts', 'create-codex-workflow-hook-profile.mjs');
const dockTemplateDir = path.join(repoRoot, '.docks', 'gdi-foreman');
const defaultCodexBin = 'codex';

function usage() {
  return `Usage: node scripts/run-workflow.mjs [--workflow-id <id>] [--codex-bin <path>] [--gdi-task-file <path>] [--keep|--clean]

Creates an ephemeral Codex workflow hook profile, seeds it from the repo-local
.docks/gdi-foreman template, launches the GDI role, waits for
handoff/ready-for-foreman.json plus GDI exit, launches the foreman role, waits
for handoff/done.json plus foreman exit, then exits cleanly.
Each role is run as a one-shot Codex execution using codex exec from the
generated role directory so role-local hooks are discovered.

Generated workflow state is kept by default for inspection. Use --clean to
remove .aos-test-tmp/workflows/<id>/ after completion or interruption.`;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    workflowId: null,
    codexBin: defaultCodexBin,
    gdiTaskFile: null,
    keep: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--workflow-id') {
      args.workflowId = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--codex-bin') {
      args.codexBin = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--gdi-task-file') {
      args.gdiTaskFile = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--keep') {
      args.keep = true;
    } else if (arg === '--clean') {
      args.keep = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function copyDirectoryContents(sourceDir, destinationDir) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  await fsp.mkdir(destinationDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, destinationPath);
    }
  }
}

function renderTemplateText(text, context) {
  return text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return context[key];
    }
    return match;
  });
}

async function renderRoleFile(filePath, context) {
  if (!fileExists(filePath)) return;
  const text = await fsp.readFile(filePath, 'utf8');
  await fsp.writeFile(filePath, renderTemplateText(text, context));
}

function roleContext(profile, workflowDir, readyPath, donePath, role) {
  return {
    workflowId: profile.workflow_id,
    repoRoot,
    workflowDir,
    role,
    roleDir: path.join(repoRoot, profile.roles[role].dir),
    readyPath,
    donePath,
  };
}

async function instantiateDockTemplate(profile, workflowDir, readyPath, donePath) {
  const dockSnapshotDir = path.join(workflowDir, 'dock-template');
  await copyDirectoryContents(dockTemplateDir, dockSnapshotDir);

  for (const role of ['gdi', 'foreman']) {
    const roleSourceDir = path.join(dockTemplateDir, role);
    const roleDir = path.join(repoRoot, profile.roles[role].dir);
    await copyDirectoryContents(roleSourceDir, roleDir);
    const context = roleContext(profile, workflowDir, readyPath, donePath, role);
    await renderRoleFile(path.join(roleDir, 'README.md'), context);
    await renderRoleFile(path.join(roleDir, 'prompt.md'), context);
  }

  await fsp.writeFile(path.join(workflowDir, 'dock-run.json'), `${JSON.stringify({
    type: 'aos.docked_workflow_run.v0',
    workflow_id: profile.workflow_id,
    dock_template: path.relative(repoRoot, dockTemplateDir),
    dock_snapshot: path.relative(repoRoot, dockSnapshotDir),
    roles: {
      gdi: profile.roles.gdi.dir,
      foreman: profile.roles.foreman.dir,
    },
  }, null, 2)}\n`);
}

function runProfileGenerator(args, options = {}) {
  const nodeBin = options.nodeBin ?? process.execPath;
  const commandArgs = [profileScript, '--gdi-handoff'];
  if (args.workflowId) {
    commandArgs.push('--id', args.workflowId);
  }

  const result = spawnSync(nodeBin, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create workflow profile: ${(result.stderr || result.stdout).trim()}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (caught) {
    throw new Error(`Workflow profile generator returned invalid JSON: ${caught.message}`);
  }
}

function resolveWorkflowDir(profile) {
  const workflowDir = path.resolve(repoRoot, profile.workflow_dir);
  const workflowsRoot = path.join(repoRoot, '.aos-test-tmp', 'workflows');
  const relative = path.relative(workflowsRoot, workflowDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Workflow directory outside .aos-test-tmp/workflows: ${workflowDir}`);
  }
  return workflowDir;
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function waitForFile(filePath, options = {}) {
  const signal = options.signal;
  if (fileExists(filePath)) {
    return Promise.resolve(filePath);
  }

  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);

  return new Promise((resolve, reject) => {
    let settled = false;
    let watcher = null;

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      if (watcher) watcher.close();
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    }

    function check() {
      if (fileExists(filePath)) {
        settle(resolve, filePath);
      }
    }

    function onAbort() {
      settle(reject, signal.reason instanceof Error ? signal.reason : new Error('watch aborted'));
    }

    try {
      watcher = fs.watch(dir, { persistent: true }, (_eventType, filename) => {
        if (!filename || filename.toString() === basename) {
          check();
        }
      });
    } catch (caught) {
      settle(reject, caught);
      return;
    }

    watcher.on('error', (error) => settle(reject, error));
    signal?.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

function spawnRole(role, profile, workflowDir, args, extra = {}) {
  const roleDir = path.join(repoRoot, profile.roles[role].dir);
  const childArgs = ['exec', ...(extra.prompt ? [extra.prompt] : [])];
  const child = spawn(args.codexBin, childArgs, {
    cwd: roleDir,
    env: {
      ...process.env,
      AOS_WORKFLOW_ID: profile.workflow_id,
      AOS_WORKFLOW_DIR: workflowDir,
      AOS_WORKFLOW_ROLE: role,
      AOS_WORKFLOW_REPO_ROOT: repoRoot,
      ...(extra.env ?? {}),
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });

  return child;
}

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The child may already be gone.
  }
}

function childExit(child, label, requiredFile) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited with ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code}`));
        return;
      }
      if (requiredFile && !fileExists(requiredFile)) {
        reject(new Error(`${label} exited before ${path.basename(requiredFile)}`));
        return;
      }
      resolve({ label, code, signal });
    });
  });
}

async function waitForSentinelAndChildExit(filePath, child, label, parentSignal) {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('workflow shutting down'));
  };
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const [, exit] = await Promise.all([
      waitForFile(filePath, { signal: controller.signal }),
      childExit(child, label, filePath),
    ]);
    return exit;
  } finally {
    parentSignal?.removeEventListener('abort', onAbort);
    if (!controller.signal.aborted) {
      controller.abort(new Error(`${label} sentinel and child wait settled`));
    }
  }
}

async function readRolePrompt(role, profile, args = {}) {
  const prompt = await fsp.readFile(path.join(repoRoot, profile.roles[role].dir, 'prompt.md'), 'utf8');
  if (role !== 'gdi' || !args.gdiTaskFile) {
    return prompt;
  }

  const taskPath = path.resolve(args.gdiTaskFile);
  const taskBody = await fsp.readFile(taskPath, 'utf8');
  return `${prompt.trimEnd()}\n\n## Concrete Task\n\n${taskBody.trimEnd()}\n`;
}

async function cleanupWorkflow(workflowDir, keep) {
  if (keep) return;
  await fsp.rm(workflowDir, { recursive: true, force: true });
}

export async function runWorkflow(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const profile = runProfileGenerator(args);
  const workflowDir = resolveWorkflowDir(profile);
  const handoffDir = path.join(workflowDir, 'handoff');
  const readyPath = path.join(handoffDir, 'ready-for-foreman.json');
  const donePath = path.join(handoffDir, 'done.json');
  await fsp.mkdir(handoffDir, { recursive: true });
  await instantiateDockTemplate(profile, workflowDir, readyPath, donePath);

  const controller = new AbortController();
  const children = new Set();
  let shuttingDown = false;

  async function shutdown(exitCode, reason = null) {
    if (shuttingDown) return exitCode;
    shuttingDown = true;
    controller.abort(reason instanceof Error ? reason : new Error(reason ?? 'workflow shutting down'));
    for (const child of children) terminateChild(child);
    await cleanupWorkflow(workflowDir, args.keep);
    return exitCode;
  }

  const onSignal = (signal) => {
    shutdown(signal === 'SIGINT' ? 130 : 143, signal)
      .then((exitCode) => {
        process.exitCode = exitCode;
      })
      .finally(() => process.exit());
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    console.error(`workflow ${profile.workflow_id}: launching GDI`);
    const gdi = spawnRole('gdi', profile, workflowDir, args, {
      prompt: await readRolePrompt('gdi', profile, args),
    });
    children.add(gdi);
    gdi.once('exit', () => children.delete(gdi));

    await waitForSentinelAndChildExit(readyPath, gdi, 'GDI', controller.signal);

    console.error(`workflow ${profile.workflow_id}: launching foreman`);
    const foreman = spawnRole('foreman', profile, workflowDir, args, {
      prompt: await readRolePrompt('foreman', profile, args),
      env: {
        AOS_GDI_HANDOFF_READY_PATH: readyPath,
        AOS_WORKFLOW_DONE_PATH: donePath,
      },
    });
    children.add(foreman);
    foreman.once('exit', () => children.delete(foreman));

    await waitForSentinelAndChildExit(donePath, foreman, 'Foreman', controller.signal);

    console.error(`workflow ${profile.workflow_id}: done`);
    for (const child of children) terminateChild(child);
    await cleanupWorkflow(workflowDir, args.keep);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    return 0;
  } catch (caught) {
    for (const child of children) terminateChild(child);
    await cleanupWorkflow(workflowDir, args.keep);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    console.error(caught.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflow()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((caught) => {
      console.error(caught.message);
      process.exitCode = 1;
    });
}

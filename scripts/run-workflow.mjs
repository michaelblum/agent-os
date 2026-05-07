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
  return `Usage:
  node scripts/run-workflow.mjs [--workflow-id <id>] [--codex-bin <path>] [--gdi-task-file <path>] [--tts|--no-tts] [--keep|--clean]
  node scripts/run-workflow.mjs --list [--json]
  node scripts/run-workflow.mjs --status --workflow-id <id> [--json]

Creates an ephemeral Codex workflow hook profile, seeds it from the repo-local
.docks/gdi-foreman template, launches the GDI role, waits for
handoff/ready-for-foreman.json plus GDI exit, launches the foreman role, waits
for handoff/done.json plus foreman exit, then exits cleanly.
Each role is run as a one-shot Codex execution using codex exec from the
generated role directory so role-local hooks are discovered.

Generated workflow state is kept by default for inspection. Use --clean to
remove .aos-test-tmp/workflows/<id>/ after completion or interruption. Role-local
TTS hooks are enabled by default; use --no-tts for a quiet run.

Use --list and --status to inspect docked workflow state without starting a new
run. These status commands are repo-local helper surfaces, not public aos
commands.`;
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
    tts: true,
    keep: true,
    list: false,
    status: false,
    json: false,
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
    } else if (arg === '--tts') {
      args.tts = true;
    } else if (arg === '--no-tts') {
      args.tts = false;
    } else if (arg === '--keep') {
      args.keep = true;
    } else if (arg === '--clean') {
      args.keep = false;
    } else if (arg === '--list') {
      args.list = true;
    } else if (arg === '--status') {
      args.status = true;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.list && args.status) {
    throw new Error('--list and --status are mutually exclusive.');
  }

  return args;
}

function workflowsRoot() {
  return path.join(repoRoot, '.aos-test-tmp', 'workflows');
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
    roleDir: resolveRoleDir(profile, workflowDir, role),
    readyPath,
    donePath,
  };
}

function assertInsideDirectory(child, parent, label) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} outside ${parent}: ${child}`);
  }
}

function resolveRoleDir(profile, workflowDir, role) {
  const roleConfig = profile.roles?.[role];
  if (!roleConfig?.dir) {
    throw new Error(`Missing role directory for ${role}`);
  }
  const roleDir = path.resolve(workflowDir, roleConfig.dir);
  assertInsideDirectory(roleDir, workflowDir, `${role} role directory`);
  return roleDir;
}

async function instantiateDockTemplate(profile, workflowDir, readyPath, donePath) {
  const dockSnapshotDir = path.join(workflowDir, 'dock-template');
  await copyDirectoryContents(dockTemplateDir, dockSnapshotDir);

  for (const role of ['gdi', 'foreman']) {
    const roleSourceDir = path.join(dockTemplateDir, role);
    const roleDir = resolveRoleDir(profile, workflowDir, role);
    await copyDirectoryContents(roleSourceDir, roleDir);
    const context = roleContext(profile, workflowDir, readyPath, donePath, role);
    await renderRoleFile(path.join(roleDir, 'README.md'), context);
    await renderRoleFile(path.join(roleDir, 'role.md'), context);
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
  if (args.tts) {
    commandArgs.push('--tts');
  }
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
  const root = workflowsRoot();
  const relative = path.relative(root, workflowDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Workflow directory outside .aos-test-tmp/workflows: ${workflowDir}`);
  }
  return workflowDir;
}

function resolveWorkflowDirForId(workflowId) {
  const safeId = String(workflowId ?? '').trim();
  if (!safeId) throw new Error('--workflow-id is required.');
  const workflowDir = path.resolve(workflowsRoot(), safeId);
  assertInsideDirectory(workflowDir, workflowsRoot(), 'workflow directory');
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

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readTextFile(filePath) {
  try {
    return (await fsp.readFile(filePath, 'utf8')).trim();
  } catch {
    return null;
  }
}

function parsePsOutput(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        stat: match[3],
        etime: match[4],
        command: match[5],
      };
    })
    .filter(Boolean);
}

function readProcessRows() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,stat=,etime=,command='], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return parsePsOutput(result.stdout);
}

function processRoleForWorkflow(processRow, workflowId, workflowDir) {
  const command = processRow.command;
  if (!command.includes(workflowId) && !command.includes(workflowDir)) return null;
  if (command.includes('run-workflow.mjs')) {
    if (/\s--(?:status|list)(?:\s|$)/.test(command)) return null;
    return 'supervisor';
  }
  if (command.includes(`${workflowDir}/gdi`) || command.includes('You are the GDI role')) return 'gdi';
  if (command.includes(`${workflowDir}/foreman`) || command.includes('You are the foreman role')) return 'foreman';
  return 'related';
}

function summarizeProcesses(processRows, workflowId, workflowDir) {
  const matches = [];
  for (const processRow of processRows) {
    const role = processRoleForWorkflow(processRow, workflowId, workflowDir);
    if (role) matches.push({ ...processRow, role });
  }
  return matches;
}

async function latestWorkflowEvent(workflowDir) {
  const eventsPath = path.join(workflowDir, 'events.jsonl');
  const text = await readTextFile(eventsPath);
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const latest = lines.at(-1);
  if (!latest) return null;
  try {
    return JSON.parse(latest);
  } catch {
    return { raw: latest };
  }
}

async function roleHasTtsHook(workflowDir, role) {
  const hooks = await readJsonFile(path.join(workflowDir, role, '.codex', 'hooks.json'));
  const stopHooks = Array.isArray(hooks?.hooks?.Stop) ? hooks.hooks.Stop : [];
  return stopHooks.some((matcher) => (
    Array.isArray(matcher?.hooks)
    && matcher.hooks.some((hook) => String(hook?.command ?? '').includes('workflow-tts.sh'))
  ));
}

function workflowState({ readyExists, doneExists, processes }) {
  const supervisor = processes.some((processRow) => processRow.role === 'supervisor');
  const gdi = processes.some((processRow) => processRow.role === 'gdi');
  const foreman = processes.some((processRow) => processRow.role === 'foreman');

  if (foreman) return 'foreman_running';
  if (doneExists && supervisor) return 'finishing';
  if (doneExists) return 'completed';
  if (gdi) return readyExists ? 'gdi_finishing' : 'gdi_running';
  if (readyExists && supervisor) return 'waiting_for_foreman';
  if (readyExists) return 'ready_for_foreman';
  if (supervisor) return 'starting_or_blocked';
  return 'idle';
}

function activeRoleForState(state) {
  if (state.startsWith('gdi_')) return 'gdi';
  if (state.startsWith('foreman_')) return 'foreman';
  if (state === 'waiting_for_foreman') return 'foreman_pending';
  return null;
}

function gitBranchSummary() {
  const result = spawnSync('git', ['status', '--short', '--branch'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).find(Boolean) ?? null;
}

async function workflowStatus(workflowId, options = {}) {
  const workflowDir = resolveWorkflowDirForId(workflowId);
  const readyPath = path.join(workflowDir, 'handoff', 'ready-for-foreman.json');
  const donePath = path.join(workflowDir, 'handoff', 'done.json');
  const processRows = options.processRows ?? readProcessRows();
  const processes = summarizeProcesses(processRows, workflowId, workflowDir);
  const readyExists = fileExists(readyPath);
  const doneExists = fileExists(donePath);
  const state = workflowState({ readyExists, doneExists, processes });
  const dockRun = await readJsonFile(path.join(workflowDir, 'dock-run.json'));

  return {
    type: 'aos.docked_workflow.status.v0',
    workflow_id: workflowId,
    workflow_dir: path.relative(repoRoot, workflowDir),
    state,
    active_role: activeRoleForState(state),
    branch: gitBranchSummary(),
    sentinels: {
      ready_for_foreman: {
        path: path.relative(repoRoot, readyPath),
        exists: readyExists,
      },
      done: {
        path: path.relative(repoRoot, donePath),
        exists: doneExists,
      },
    },
    latest_handoff_packet_path: await readTextFile(path.join(workflowDir, 'gdi', 'latest-handoff-path.txt')),
    latest_event: await latestWorkflowEvent(workflowDir),
    tts_enabled: {
      gdi: await roleHasTtsHook(workflowDir, 'gdi'),
      foreman: await roleHasTtsHook(workflowDir, 'foreman'),
    },
    processes: processes.map((processRow) => ({
      role: processRow.role,
      pid: processRow.pid,
      ppid: processRow.ppid,
      stat: processRow.stat,
      etime: processRow.etime,
      command: processRow.command,
    })),
    dock_run: dockRun ? {
      type: dockRun.type,
      roles: dockRun.roles,
    } : null,
  };
}

async function workflowIds() {
  const root = workflowsRoot();
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function formatWorkflowStatus(status) {
  const lines = [
    `workflow ${status.workflow_id}`,
    `state: ${status.state}`,
    `active_role: ${status.active_role ?? 'none'}`,
    `branch: ${status.branch ?? 'unknown'}`,
    `workflow_dir: ${status.workflow_dir}`,
    `ready_for_foreman: ${status.sentinels.ready_for_foreman.exists ? 'present' : 'missing'} (${status.sentinels.ready_for_foreman.path})`,
    `done: ${status.sentinels.done.exists ? 'present' : 'missing'} (${status.sentinels.done.path})`,
    `tts: gdi=${status.tts_enabled.gdi ? 'on' : 'off'} foreman=${status.tts_enabled.foreman ? 'on' : 'off'}`,
  ];
  if (status.latest_handoff_packet_path) {
    lines.push(`latest_handoff_packet: ${status.latest_handoff_packet_path}`);
  }
  if (status.latest_event?.created_at || status.latest_event?.type) {
    lines.push(`latest_event: ${status.latest_event.created_at ?? 'unknown-time'} ${status.latest_event.type ?? 'unknown-type'}`);
  }
  if (status.processes.length > 0) {
    lines.push('processes:');
    for (const processRow of status.processes) {
      lines.push(`  ${processRow.role}: pid=${processRow.pid} ppid=${processRow.ppid} stat=${processRow.stat} etime=${processRow.etime}`);
    }
  } else {
    lines.push('processes: none');
  }
  return `${lines.join('\n')}\n`;
}

function formatWorkflowList(statuses) {
  if (statuses.length === 0) return 'no docked workflows found\n';
  const lines = ['workflow_id\tstate\tactive_role\tready\tdone\tprocesses'];
  for (const status of statuses) {
    lines.push([
      status.workflow_id,
      status.state,
      status.active_role ?? '-',
      status.sentinels.ready_for_foreman.exists ? 'yes' : 'no',
      status.sentinels.done.exists ? 'yes' : 'no',
      status.processes.map((processRow) => `${processRow.role}:${processRow.pid}`).join(',') || '-',
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

async function inspectWorkflows(args) {
  if (args.status) {
    if (!args.workflowId) throw new Error('--status requires --workflow-id <id>.');
    const status = await workflowStatus(args.workflowId);
    if (args.json) {
      console.log(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      process.stdout.write(formatWorkflowStatus(status));
    }
    return 0;
  }

  const ids = await workflowIds();
  const statuses = await Promise.all(ids.map((id) => workflowStatus(id)));
  if (args.json) {
    console.log(`${JSON.stringify({
      type: 'aos.docked_workflow.list.v0',
      workflows: statuses,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(formatWorkflowList(statuses));
  }
  return 0;
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
  const roleDir = resolveRoleDir(profile, workflowDir, role);
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
  const workflowDir = resolveWorkflowDir(profile);
  const handoffDir = path.join(workflowDir, 'handoff');
  const context = roleContext(
    profile,
    workflowDir,
    path.join(handoffDir, 'ready-for-foreman.json'),
    path.join(handoffDir, 'done.json'),
    role,
  );
  const roleDir = resolveRoleDir(profile, workflowDir, role);
  const roleText = await fsp.readFile(path.join(roleDir, 'role.md'), 'utf8');
  const taskText = fileExists(path.join(roleDir, 'task.md'))
    ? await fsp.readFile(path.join(roleDir, 'task.md'), 'utf8')
    : '';
  const taskBody = role === 'gdi' && args.gdiTaskFile
    ? await fsp.readFile(path.resolve(args.gdiTaskFile), 'utf8')
    : 'No concrete task was supplied. Complete only the role contract for this run.';
  const renderedTask = renderTemplateText(taskText, {
    ...context,
    taskBody: taskBody.trimEnd(),
  }).trimEnd();
  return [roleText.trimEnd(), renderedTask].filter(Boolean).join('\n\n') + '\n';
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
  if (args.list || args.status) {
    return inspectWorkflows(args);
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

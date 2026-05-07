import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkflowProfile,
  parseArgs,
  sanitizeWorkflowId,
} from '../../scripts/create-codex-workflow-hook-profile.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function workflowPath(profile) {
  return path.join(repoRoot, profile.workflow_dir);
}

function repoStatusOutsideTemp() {
  const result = spawnSync('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.',
    ':(exclude).aos-test-tmp',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function stopCommands(payload) {
  return payload.hooks.Stop.flatMap((matcher) => matcher.hooks).map((hook) => hook.command);
}

function runHookCommand(command, input, env = {}) {
  return spawnSync(command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    input,
    encoding: 'utf8',
    shell: '/bin/bash',
  });
}

async function readEvents(workflowDir) {
  const text = await readFile(path.join(workflowDir, 'events.jsonl'), 'utf8');
  return text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

test('parses arguments and sanitizes run ids', () => {
  assert.deepEqual(parseArgs(['--id', 'Pilot 01', '--gdi-handoff', '--tts']), {
    id: 'Pilot 01',
    gdiHandoff: true,
    tts: true,
    help: false,
  });
  assert.equal(sanitizeWorkflowId('Pilot 01'), 'Pilot-01');
  assert.throws(() => sanitizeWorkflowId('../outside'), /Unsafe run id/);
});

test('CLI creates an ephemeral profile under .aos-test-tmp/workflows', async () => {
  const id = `test-cli-${process.pid}-${Date.now()}`;
  const statusBefore = repoStatusOutsideTemp();
  const result = spawnSync('node', [
    'scripts/create-codex-workflow-hook-profile.mjs',
    '--id',
    id,
    '--gdi-handoff',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const profile = JSON.parse(result.stdout);
  const dir = workflowPath(profile);

  try {
    assert.equal(profile.type, 'aos.codex_workflow_hook_profile.v0');
    assert.equal(profile.workflow_id, id);
    assert.equal(profile.workflow_dir, `.aos-test-tmp/workflows/${id}`);
    assert.equal(profile.gdi_handoff_enabled, true);
    assert.equal(profile.tts_enabled, false);
    assert.equal(profile.roles.gdi.dir, 'gdi');
    assert.equal(profile.roles.foreman.dir, 'foreman');
    assert.equal(profile.roles.gdi.hooks, 'gdi/.codex/hooks.json');
    assert.equal(profile.roles.foreman.hooks, 'foreman/.codex/hooks.json');
    assert.equal(profile.roles.gdi.session_id, `${id}:gdi`);
    assert.equal(profile.roles.foreman.session_id, `${id}:foreman`);
    assert.deepEqual(Object.keys(profile.roles).sort(), ['foreman', 'gdi']);
    await readFile(path.join(dir, 'README.md'), 'utf8');
    await readFile(path.join(dir, 'gdi', '.codex', 'hooks.json'), 'utf8');
    await readFile(path.join(dir, 'foreman', '.codex', 'hooks.json'), 'utf8');
    assert.equal(repoStatusOutsideTemp(), statusBefore);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creates isolated role hook profiles and the Stop marker writes under the workflow dir', async () => {
  const id = `test-marker-${process.pid}-${Date.now()}`;
  const repoHookConfigBefore = await readFile(path.join(repoRoot, '.codex', 'hooks.json'), 'utf8');
  const profile = createWorkflowProfile({ id });
  const dir = workflowPath(profile);

  try {
    assert.equal(profile.workflow_dir, `.aos-test-tmp/workflows/${id}`);
    assert.equal(profile.gdi_handoff_enabled, false);
    assert.equal(profile.tts_enabled, false);

    const gdiHooksPath = path.join(dir, profile.roles.gdi.hooks);
    const foremanHooksPath = path.join(dir, profile.roles.foreman.hooks);
    const gdiHooks = await readJson(gdiHooksPath);
    const foremanHooks = await readJson(foremanHooksPath);

    assert.match(gdiHooksPath, /\/gdi\/\.codex\/hooks\.json$/);
    assert.match(foremanHooksPath, /\/foreman\/\.codex\/hooks\.json$/);
    assert.notEqual(gdiHooksPath, foremanHooksPath);
    assert.equal(stopCommands(gdiHooks).length, 1);
    assert.equal(stopCommands(foremanHooks).length, 1);
    assert.match(stopCommands(gdiHooks)[0], /stop-marker\.sh/);
    assert.match(stopCommands(foremanHooks)[0], /stop-marker\.sh/);

    const result = runHookCommand(
      stopCommands(gdiHooks)[0],
      JSON.stringify({ session_id: 'marker-session' }),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '{"continue":true}');

    const events = await readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'codex.workflow_hook.stop_marker.v0');
    assert.equal(events[0].role, 'gdi');
    assert.equal(events[0].hook, 'Stop');
    assert.ok(events[0].input_bytes > 0);

    await assert.rejects(
      readFile(path.join(repoRoot, '.aos-test-tmp', 'workflows', 'events.jsonl'), 'utf8'),
      /ENOENT/,
    );
    await assert.rejects(readFile(path.join(repoRoot, 'events.jsonl'), 'utf8'), /ENOENT/);
    assert.equal(
      await readFile(path.join(repoRoot, '.codex', 'hooks.json'), 'utf8'),
      repoHookConfigBefore,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('role-local TTS hook is opt-in and speaks role completion messages when enabled', async () => {
  const disabledId = `test-tts-disabled-${process.pid}-${Date.now()}`;
  const disabledProfile = createWorkflowProfile({ id: disabledId });
  const disabledDir = workflowPath(disabledProfile);
  const enabledId = `test-tts-enabled-${process.pid}-${Date.now()}`;
  const enabledProfile = createWorkflowProfile({ id: enabledId, tts: true });
  const enabledDir = workflowPath(enabledProfile);

  try {
    assert.equal(disabledProfile.tts_enabled, false);
    const disabledGdiHooks = await readJson(path.join(disabledDir, disabledProfile.roles.gdi.hooks));
    assert.equal(stopCommands(disabledGdiHooks).some((command) => command.includes('workflow-tts.sh')), false);

    assert.equal(enabledProfile.tts_enabled, true);
    const gdiHooks = await readJson(path.join(enabledDir, enabledProfile.roles.gdi.hooks));
    const foremanHooks = await readJson(path.join(enabledDir, enabledProfile.roles.foreman.hooks));
    const gdiTtsCommand = stopCommands(gdiHooks).find((command) => command.includes('workflow-tts.sh'));
    const foremanTtsCommand = stopCommands(foremanHooks).find((command) => command.includes('workflow-tts.sh'));
    assert.ok(gdiTtsCommand);
    assert.ok(foremanTtsCommand);

    const recordPath = path.join(enabledDir, 'voice-calls.jsonl');
    const fakeAos = path.join(enabledDir, 'hooks', 'fake-aos.mjs');
    await writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';

const recordPath = process.env.AOS_FAKE_VOICE_RECORD;
if (!recordPath) throw new Error('missing AOS_FAKE_VOICE_RECORD');
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(recordPath, JSON.stringify({
  argv: process.argv.slice(2),
  stdin,
}) + '\\n');
process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');
`);
    await chmod(fakeAos, 0o755);

    const gdiResult = runHookCommand(
      gdiTtsCommand,
      JSON.stringify({ session_id: 'hook-session-should-be-ignored', harness: 'codex' }),
      {
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_VOICE_RECORD: recordPath,
      },
    );
    assert.equal(gdiResult.status, 0, gdiResult.stderr);
    assert.equal(gdiResult.stdout.trim(), '{"continue":true}');

    const foremanResult = runHookCommand(
      foremanTtsCommand,
      JSON.stringify({ session_id: 'hook-session-should-be-ignored', harness: 'codex' }),
      {
        AOS_WORKFLOW_AOS_BIN: fakeAos,
        AOS_FAKE_VOICE_RECORD: recordPath,
      },
    );
    assert.equal(foremanResult.status, 0, foremanResult.stderr);
    assert.equal(foremanResult.stdout.trim(), '{"continue":true}');

    const calls = (await readFile(recordPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].argv, [
      'voice',
      'bind',
      '--session-id',
      `${enabledId}:gdi`,
      '--quality-tier',
      'premium',
      '--language',
      'en',
      '--gender',
      'female',
    ]);
    assert.deepEqual(calls[1].argv, ['voice', 'final-response', '--harness', 'codex', '--session-id', `${enabledId}:gdi`]);
    assert.deepEqual(calls[2].argv, [
      'voice',
      'bind',
      '--session-id',
      `${enabledId}:foreman`,
      '--quality-tier',
      'premium',
      '--language',
      'en',
      '--gender',
      'male',
    ]);
    assert.deepEqual(calls[3].argv, ['voice', 'final-response', '--harness', 'codex', '--session-id', `${enabledId}:foreman`]);
    assert.equal(calls[0].stdin, '');
    assert.equal(JSON.parse(calls[1].stdin).last_assistant_message, 'GDI finished, foreman starting.');
    assert.equal(JSON.parse(calls[1].stdin).session_id, `${enabledId}:gdi`);
    assert.equal(calls[2].stdin, '');
    assert.equal(JSON.parse(calls[3].stdin).last_assistant_message, 'Foreman finished.');
    assert.equal(JSON.parse(calls[3].stdin).session_id, `${enabledId}:foreman`);

    const events = await readEvents(enabledDir);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'codex.workflow_hook.tts.v0');
    assert.equal(events[0].role, 'gdi');
    assert.equal(events[0].session_id, `${enabledId}:gdi`);
    assert.equal(events[0].success, true);
    assert.equal(events[1].type, 'codex.workflow_hook.tts.v0');
    assert.equal(events[1].role, 'foreman');
    assert.equal(events[1].session_id, `${enabledId}:foreman`);
    assert.equal(events[1].success, true);
  } finally {
    await rm(disabledDir, { recursive: true, force: true });
    await rm(enabledDir, { recursive: true, force: true });
  }
});

test('role-local TTS hook records failed AOS delivery attempts', async () => {
  const id = `test-tts-failure-${process.pid}-${Date.now()}`;
  const profile = createWorkflowProfile({ id, tts: true });
  const dir = workflowPath(profile);

  try {
    const hooks = await readJson(path.join(dir, profile.roles.gdi.hooks));
    const ttsCommand = stopCommands(hooks).find((command) => command.includes('workflow-tts.sh'));
    assert.ok(ttsCommand);

    const fakeAos = path.join(dir, 'hooks', 'fake-aos-fail.mjs');
    await writeFile(fakeAos, `#!/usr/bin/env node
if (process.argv[3] === 'final-response') {
  process.stderr.write('synthetic final response failure\\n');
  process.exit(17);
}
process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');
`);
    await chmod(fakeAos, 0o755);

    const result = runHookCommand(
      ttsCommand,
      JSON.stringify({ session_id: 'hook-session-should-be-ignored', harness: 'codex' }),
      {
        AOS_WORKFLOW_AOS_BIN: fakeAos,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '{"continue":true}');

    const events = await readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'codex.workflow_hook.tts.v0');
    assert.equal(events[0].session_id, `${id}:gdi`);
    assert.equal(events[0].success, false);
    assert.equal(events[0].code, 'tts_command_failed');
    assert.equal(events[0].bind.status, 0);
    assert.equal(events[0].final_response.status, 17);
    assert.match(events[0].final_response.stderr, /synthetic final response failure/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mock Codex launched from a role dir discovers and runs its CWD-local Stop hook', async () => {
  const id = `test-codex-discovery-${process.pid}-${Date.now()}`;
  const profile = createWorkflowProfile({ id });
  const dir = workflowPath(profile);
  const gdiDir = path.join(dir, profile.roles.gdi.dir);

  try {
    const mockCodex = path.join(dir, 'hooks', 'mock-codex.mjs');
    await writeFile(mockCodex, `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hooksPath = path.join(process.cwd(), '.codex', 'hooks.json');
const payload = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
const stopHooks = payload.hooks.Stop.flatMap((matcher) => matcher.hooks);
const results = [];
for (const hook of stopHooks) {
  const result = spawnSync(hook.command, {
    cwd: process.cwd(),
    env: process.env,
    input: JSON.stringify({ session_id: 'mock-codex-session' }),
    encoding: 'utf8',
    shell: '/bin/bash',
  });
  results.push({
    command: hook.command,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(JSON.stringify({ hooksPath, results }) + '\\n');
`);
    await chmod(mockCodex, 0o755);

    const result = spawnSync(mockCodex, [], {
      cwd: gdiDir,
      env: {
        ...process.env,
        AOS_WORKFLOW_REPO_ROOT: repoRoot,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const launched = JSON.parse(result.stdout);
    assert.equal(launched.hooksPath, path.join(gdiDir, '.codex', 'hooks.json'));
    assert.equal(launched.results.length, 1);
    assert.match(launched.results[0].command, /stop-marker\.sh/);
    assert.equal(launched.results[0].stdout, '{"continue":true}');

    const events = await readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'codex.workflow_hook.stop_marker.v0');
    assert.equal(events[0].role, 'gdi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generated Stop marker refuses to run outside .aos-test-tmp/workflows', async () => {
  const id = `test-guard-${process.pid}-${Date.now()}`;
  const profile = createWorkflowProfile({ id });
  const dir = workflowPath(profile);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'aos-workflow-hook-outside-'));

  try {
    await mkdir(path.join(outside, 'hooks'), { recursive: true });
    await copyFile(
      path.join(dir, 'hooks', 'stop-marker.sh'),
      path.join(outside, 'hooks', 'stop-marker.sh'),
    );
    await chmod(path.join(outside, 'hooks', 'stop-marker.sh'), 0o755);

    const result = spawnSync('bash', [path.join(outside, 'hooks', 'stop-marker.sh')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AOS_WORKFLOW_REPO_ROOT: repoRoot,
        AOS_WORKFLOW_ROLE: 'gdi',
      },
      input: 'outside write attempt',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside expected temp root/);
    await assert.rejects(readFile(path.join(outside, 'events.jsonl'), 'utf8'), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('optional GDI Stop hook writes a handoff packet path under the workflow dir', async () => {
  const id = `test-gdi-handoff-${process.pid}-${Date.now()}`;
  const profile = createWorkflowProfile({ id, gdiHandoff: true });
  const dir = workflowPath(profile);

  try {
    const fakePacketScript = path.join(dir, 'hooks', 'fake-gdi-packet.mjs');
    await writeFile(fakePacketScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

let outDir = null;
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--out-dir') outDir = process.argv[index + 1];
}
if (!outDir) throw new Error('missing --out-dir');
fs.readFileSync(0, 'utf8');
fs.mkdirSync(outDir, { recursive: true });
const packetPath = path.join(outDir, 'packet.json');
fs.writeFileSync(packetPath, JSON.stringify({ ok: true }) + '\\n');
process.stdout.write(JSON.stringify({ output_path: packetPath }) + '\\n');
`);
    await chmod(fakePacketScript, 0o755);

    const gdiHooksPath = path.join(dir, profile.roles.gdi.hooks);
    const gdiHooks = await readJson(gdiHooksPath);
    const commands = stopCommands(gdiHooks);
    assert.equal(commands.length, 2);
    assert.match(commands[0], /stop-marker\.sh/);
    assert.match(commands[1], /gdi-stop-handoff\.sh/);

    const handoffScriptText = await readFile(path.join(dir, 'hooks', 'gdi-stop-handoff.sh'), 'utf8');
    assert.match(handoffScriptText, /scripts\/aos-gdi-handoff-packet\.mjs/);
    assert.match(handoffScriptText, /--write --out-dir/);

    const result = runHookCommand(commands[1], 'Final GDI tail text', {
      AOS_GDI_HANDOFF_PACKET_SCRIPT: fakePacketScript,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '{"continue":true}');

    const latestPath = (await readFile(path.join(dir, 'gdi', 'latest-handoff-path.txt'), 'utf8')).trim();
    assert.equal(path.resolve(latestPath), path.join(dir, 'gdi', 'handoffs', 'packet.json'));
    assert.deepEqual(await readJson(latestPath), { ok: true });
    const sentinel = await readJson(path.join(dir, 'handoff', 'ready-for-foreman.json'));
    assert.equal(sentinel.type, 'codex.workflow_handoff.ready_for_foreman.v0');
    assert.match(sentinel.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sentinel.packet_path, latestPath);

    const events = await readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'codex.workflow_hook.gdi_handoff_packet.v0');
    assert.equal(events[0].role, 'gdi');
    assert.equal(events[0].packet_path, latestPath);
    assert.equal(events[0].clipboard_attempted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

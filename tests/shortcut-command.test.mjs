import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseShortcutRunArgs,
  runAppleShortcut,
} from '../scripts/lib/aos-shortcut-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function executableFixture(body) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-shortcut-command-'));
  const executable = path.join(root, 'fixture');
  await fs.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return { executable, root };
}

test('shortcut parser accepts one exact name and bounded timeout', () => {
  assert.deepEqual(parseShortcutRunArgs(['run', 'Prepare Focus Mode', '--timeout', '30s', '--json']), {
    name: 'Prepare Focus Mode',
    timeoutMs: 30_000,
  });
  assert.throws(() => parseShortcutRunArgs(['run']), { code: 'MISSING_ARG' });
  assert.throws(() => parseShortcutRunArgs(['run', 'one', 'two']), { code: 'UNKNOWN_ARG' });
  assert.throws(() => parseShortcutRunArgs(['run', 'name', '--timeout', '121s']), { code: 'INVALID_TIMEOUT' });
});

test('shortcut runner passes the name as one argv item and never returns output content', async () => {
  const fixture = await executableFixture('printf "%s" "$2"; printf "private error" >&2; exit 0');
  try {
    const result = await runAppleShortcut({
      name: 'Name With Shell Characters; $(false)',
      timeoutMs: 5_000,
      executable: fixture.executable,
    });
    assert.equal(result.status, 'ok');
    assert(result.output.stdout_bytes > 0);
    assert(result.output.stderr_bytes > 0);
    assert(!JSON.stringify(result).includes('private error'));
    assert(!JSON.stringify(result).includes('Shell Characters'));
  } finally {
    await fs.rm(fixture.root, { force: true, recursive: true });
  }
});

test('shortcut runner bounds output, time, and cancellation', async () => {
  const noisy = await executableFixture('dd if=/dev/zero bs=1024 count=80 2>/dev/null');
  const slow = await executableFixture('sleep 5');
  try {
    await assert.rejects(
      runAppleShortcut({ name: 'Noisy', timeoutMs: 5_000, executable: noisy.executable }),
      { code: 'SHORTCUT_OUTPUT_LIMIT' },
    );
    await assert.rejects(
      runAppleShortcut({ name: 'Slow', timeoutMs: 1_000, executable: slow.executable }),
      { code: 'SHORTCUT_TIMEOUT' },
    );
    const controller = new AbortController();
    const canceled = runAppleShortcut({
      name: 'Canceled',
      timeoutMs: 5_000,
      executable: slow.executable,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(canceled, { code: 'SHORTCUT_CANCELED' });
  } finally {
    await fs.rm(noisy.root, { force: true, recursive: true });
    await fs.rm(slow.root, { force: true, recursive: true });
  }
});

test('shortcut runner escalates a process group that ignores termination', async () => {
  const fixture = await executableFixture("trap '' TERM; while :; do sleep 1; done");
  try {
    const started = Date.now();
    await assert.rejects(
      runAppleShortcut({ name: 'Ignore Term', timeoutMs: 1_000, executable: fixture.executable }),
      { code: 'SHORTCUT_TIMEOUT' },
    );
    assert(Date.now() - started < 3_000, 'Shortcut process group exceeded escalation bound');
  } finally {
    await fs.rm(fixture.root, { force: true, recursive: true });
  }
});

test('shortcut CLI help is passive and errors never echo a Shortcut name', () => {
  const script = path.join(repoRoot, 'scripts/aos-shortcut.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: aos shortcut run/);

  const rejected = spawnSync(process.execPath, [script, 'Private Shortcut Name'], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /"code":"UNKNOWN_SUBCOMMAND"/);
  assert.equal(rejected.stderr.includes('Private Shortcut Name'), false);
});

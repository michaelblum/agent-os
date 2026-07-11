import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('public do session owns inherited streaming stdio end to end', () => {
  const sourceManifest = JSON.parse(readFileSync(
    path.join(repoRoot, 'manifests/commands/source/external/07-do-07-script-session.json'),
    'utf8',
  ));
  const session = sourceManifest.commands.find((command) => command.path.join(' ') === 'do session');
  assert.equal(session?.stdio, 'inherit');

  const root = mkdtempSync(path.join(tmpdir(), 'aos-do-session-streaming.'));
  try {
    const fakeAos = path.join(root, 'fake-aos');
    writeFileSync(fakeAos, `#!/usr/bin/env node
for await (const line of process.stdin) process.stdout.write(line);
`);
    chmodSync(fakeAos, 0o755);
    const input = '{"action":"status"}\n{"action":"end"}\n';
    const result = spawnSync(
      process.execPath,
      ['scripts/aos-do-native.mjs', 'session'],
      {
        cwd: repoRoot,
        env: { ...process.env, AOS_PATH: fakeAos },
        input,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, input);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

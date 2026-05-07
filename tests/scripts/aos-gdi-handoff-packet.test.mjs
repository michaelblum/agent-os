import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildPacket,
  outputPathFor,
  parseArgs,
  parseGoalTime,
  parseGuardrailClaims,
  parseVerificationCommands,
  writePacket,
} from '../../scripts/aos-gdi-handoff-packet.mjs';

const sampleTail = `Implementation complete.

Verification:
- \`node --test tests/scripts/aos-gdi-handoff-packet.test.mjs\` - passed
- \`git diff --check\`: passed
- ./aos ready => ready=true mode=repo daemon=reachable tap=active

Guardrails:
- No Codex TUI automation.
- No /goal, /model, or /clear commands.
- No new public \`aos\` command.
Time spent pursuing goal: 4 minutes 5 seconds`;

function fakeResult(stdout, status = 0, stderr = '') {
  return {
    ok: status === 0,
    exit_code: status,
    signal: null,
    stdout,
    stderr,
    error: null,
  };
}

function fakeRun(file, args) {
  if (file === 'git') {
    const key = args.join(' ');
    if (key === 'branch --show-current') return fakeResult('codex/gdi-handoff-packet\n');
    if (key === 'status --short --branch --untracked-files=all') {
      return fakeResult('## codex/gdi-handoff-packet\n M docs/recipes/aos-gdi-handoff-packet.md\n?? tests/scripts/aos-gdi-handoff-packet.test.mjs\n');
    }
    if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return fakeResult('', 1, 'no upstream');
    if (key === 'rev-parse --verify origin/main') return fakeResult('0fde412dd948890665296312d0f94b50e0523b08\n');
    if (key === 'log --format=%H%x00%h%x00%s --reverse origin/main...HEAD') {
      return fakeResult('abc123456789\0abc1234\0Add GDI handoff helper\n');
    }
    if (key === 'diff --name-only origin/main...HEAD') return fakeResult('scripts/aos-gdi-handoff-packet.mjs\n');
    if (key === 'diff --name-only') return fakeResult('docs/recipes/aos-gdi-handoff-packet.md\n');
    if (key === 'diff --cached --name-only') return fakeResult('');
  }

  if (path.basename(file) === 'aos') {
    const key = args.join(' ');
    if (key === 'ready') return fakeResult('ready=true mode=repo daemon=reachable tap=active\n');
    if (key === 'show list --json') {
      return fakeResult(JSON.stringify({
        status: 'success',
        canvases: [
          {
            id: 'workbench',
            title: 'Workbench',
          },
        ],
      }));
    }
  }

  return fakeResult('', 1, `unexpected command: ${file} ${args.join(' ')}`);
}

test('extracts verification commands, results, guardrails, and goal time from a GDI tail', () => {
  const commands = parseVerificationCommands(sampleTail);
  assert.deepEqual(commands.map((command) => [command.command, command.result]), [
    ['node --test tests/scripts/aos-gdi-handoff-packet.test.mjs', 'passed'],
    ['git diff --check', 'passed'],
    ['./aos ready', 'passed'],
  ]);

  const claims = parseGuardrailClaims(sampleTail).map((claim) => claim.claim);
  assert.deepEqual(claims, [
    'No Codex TUI automation.',
    'No /goal, /model, or /clear commands.',
    'No new public `aos` command.',
  ]);

  assert.deepEqual(parseGoalTime(sampleTail), {
    raw: '4 minutes 5 seconds',
    seconds: 245,
  });
  assert.deepEqual(parseGoalTime('Goal marked complete. Time used: 660 seconds.'), {
    raw: '660 seconds.',
    seconds: 660,
  });
});

test('builds a compact packet from tail text plus git and AOS state', () => {
  const packet = buildPacket({
    tailText: sampleTail,
    cwd: '/repo',
    now: new Date('2026-05-07T12:34:56.789Z'),
    aosBin: '/repo/aos',
    run: fakeRun,
  });

  assert.equal(packet.type, 'aos.gdi_handoff_packet.v0');
  assert.equal(packet.created_at, '2026-05-07T12:34:56.789Z');
  assert.equal(packet.branch.name, 'codex/gdi-handoff-packet');
  assert.equal(packet.branch.base, 'origin/main');
  assert.deepEqual(packet.commits, [
    {
      sha: 'abc123456789',
      short: 'abc1234',
      subject: 'Add GDI handoff helper',
    },
  ]);
  assert.deepEqual(packet.changed_paths, [
    'docs/recipes/aos-gdi-handoff-packet.md',
    'scripts/aos-gdi-handoff-packet.mjs',
    'tests/scripts/aos-gdi-handoff-packet.test.mjs',
  ]);
  assert.equal(packet.verification.summary.command_count, 3);
  assert.equal(packet.verification.summary.failed_count, 0);
  assert.equal(packet.aos_readiness.ready, true);
  assert.equal(packet.open_canvases.count, 1);
  assert.equal(packet.raw_tail_text, sampleTail);
});

test('writes packets to the configured handoff directory with a timestamped filename', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-gdi-packet-'));
  try {
    const now = new Date('2026-05-07T12:34:56.789Z');
    const packet = {
      type: 'aos.gdi_handoff_packet.v0',
      created_at: now.toISOString(),
    };
    const expectedPath = outputPathFor({
      cwd: tempRoot,
      now,
      outDir: 'handoffs',
    });
    const outputPath = writePacket(packet, {
      cwd: tempRoot,
      now,
      outDir: 'handoffs',
    });
    assert.equal(outputPath, expectedPath);
    assert.equal(
      path.basename(outputPath),
      '2026-05-07T12-34-56-789Z.json',
    );
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), packet);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('rejects conflicting voice notification modes', () => {
  assert.throws(
    () => parseArgs(['--say', '--notify']),
    /Use only one of --say or --notify/,
  );
});

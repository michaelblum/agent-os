import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { writeFileAtomic } from '../scripts/workbench-human-checkpoint-annotate.mjs';

test('checkpoint annotate atomic writer replaces files through a temporary sibling', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aos-checkpoint-annotate-'));
  try {
    const file = path.join(root, 'checkpoint.json');
    writeFileSync(file, '{"status":"old"}\n');

    writeFileAtomic(file, '{"status":"new"}\n');

    assert.equal(readFileSync(file, 'utf8'), '{"status":"new"}\n');
    assert.deepEqual(readdirSync(root).sort(), ['checkpoint.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint annotate atomic writer preserves original file when rename fails', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aos-checkpoint-annotate-'));
  const originalRename = fs.renameSync;
  try {
    const file = path.join(root, 'checkpoint.json');
    writeFileSync(file, '{"status":"old"}\n');
    fs.renameSync = () => {
      throw new Error('simulated rename failure');
    };

    assert.throws(() => writeFileAtomic(file, '{"status":"new"}\n'), /simulated rename failure/);

    assert.equal(readFileSync(file, 'utf8'), '{"status":"old"}\n');
    assert.deepEqual(readdirSync(root).sort(), ['checkpoint.json']);
  } finally {
    fs.renameSync = originalRename;
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint annotate script can be imported without running the CLI', () => {
  const result = spawnSync(process.execPath, ['-e', `
    import('./scripts/workbench-human-checkpoint-annotate.mjs')
      .then((module) => {
        if (typeof module.writeFileAtomic !== 'function') process.exit(2);
      })
      .catch(() => process.exit(1));
  `], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

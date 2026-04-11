// packages/host/test/tools/list-files.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listFilesTool } from '../../src/tools/list-files.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('list_files tool', () => {
  const tmpDir = path.join(os.tmpdir(), `host-test-list-${Date.now()}`);
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('has correct definition', () => {
    assert.equal(listFilesTool.definition.name, 'list_files');
    assert.equal(listFilesTool.definition.permissions?.default, 'allow');
  });

  it('lists directory contents', async () => {
    const result = await listFilesTool.executor({ path: tmpDir }, ctx);
    const { items: entries } = result.content as { items: Array<{ name: string; type: string }> };
    assert.equal(entries.length, 3);
    const names = entries.map(e => e.name).sort();
    assert.deepEqual(names, ['a.txt', 'b.ts', 'subdir']);
  });

  it('marks directories vs files', async () => {
    const result = await listFilesTool.executor({ path: tmpDir }, ctx);
    const { items: entries } = result.content as { items: Array<{ name: string; type: string }> };
    const subdir = entries.find(e => e.name === 'subdir');
    assert.equal(subdir?.type, 'directory');
    const file = entries.find(e => e.name === 'a.txt');
    assert.equal(file?.type, 'file');
  });

  it('returns error for missing directory', async () => {
    const result = await listFilesTool.executor({ path: '/nonexistent/dir' }, ctx);
    assert.equal(result.isError, true);
  });
});

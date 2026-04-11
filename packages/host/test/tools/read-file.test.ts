// packages/host/test/tools/read-file.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileTool } from '../../src/tools/read-file.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('read_file tool', () => {
  const tmpDir = path.join(os.tmpdir(), `host-test-${Date.now()}`);
  const ctx = {
    sessionId: 'test',
    signal: AbortSignal.timeout(5000),
    emit: () => {},
  };

  beforeEach(() => { fs.mkdirSync(tmpDir, { recursive: true }); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('has correct definition', () => {
    assert.equal(readFileTool.definition.name, 'read_file');
    assert.equal(readFileTool.definition.permissions?.default, 'allow');
  });

  it('reads a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await readFileTool.executor({ path: filePath }, ctx);
    assert.equal(result.content, 'hello world');
  });

  it('returns error for missing file', async () => {
    const result = await readFileTool.executor({ path: '/nonexistent/file.txt' }, ctx);
    assert.equal(result.isError, true);
    assert.ok((result.content as string).includes('ENOENT'));
  });
});

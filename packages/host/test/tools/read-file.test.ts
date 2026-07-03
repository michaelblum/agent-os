// packages/host/test/tools/read-file.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_READ_FILE_BYTES, readFileTool } from '../../src/tools/read-file.ts';
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
    assert.equal(readFileTool.definition.timeout, 30_000);
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

  it('rejects non-regular files', async () => {
    const result = await readFileTool.executor({ path: tmpDir }, ctx);
    assert.equal(result.isError, true);
    assert.match(result.content as string, /not a regular file/);
  });

  it('rejects files above the size cap before reading content', async () => {
    const filePath = path.join(tmpDir, 'large.txt');
    fs.writeFileSync(filePath, Buffer.alloc(MAX_READ_FILE_BYTES + 1));

    const result = await readFileTool.executor({ path: filePath }, ctx);

    assert.equal(result.isError, true);
    assert.match(result.content as string, /exceeds read_file limit/);
  });

  it('honors an already-aborted tool signal', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const controller = new AbortController();
    controller.abort();

    const result = await readFileTool.executor({ path: filePath }, {
      ...ctx,
      signal: controller.signal,
    });

    assert.equal(result.isError, true);
    assert.equal(result.content, 'Read aborted');
  });
});

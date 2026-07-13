import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/aos-wiki-put.mjs');
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-wiki-put-'));
  roots.push(root);
  const fakeAos = path.join(root, 'fake-aos.mjs');
  const reindexLog = path.join(root, 'reindex.ndjson');
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.AOS_FAKE_REINDEX_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.AOS_FAKE_REINDEX_FAIL === '1') {
  process.stderr.write('FAKE_REINDEX_PRIVATE_OUTPUT\\n');
  process.exit(9);
}
process.stdout.write('{"status":"ok"}\\n');
`, { mode: 0o700 });
  await fs.chmod(fakeAos, 0o700);
  return {
    fakeAos,
    reindexLog,
    root,
    wikiRoot: path.join(root, 'repo', 'wiki'),
  };
}

function runPut(fx, args, input = '', env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AOS_FAKE_REINDEX_LOG: fx.reindexLog,
      AOS_PATH: fx.fakeAos,
      AOS_RUNTIME_MODE: 'repo',
      AOS_STATE_ROOT: fx.root,
      ...env,
    },
    input,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10_000,
  });
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function reindexCalls(fx) {
  try {
    return (await fs.readFile(fx.reindexLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('creates and updates owner-only Markdown with conditional hashes', async () => {
  const fx = await fixture();
  const relativePath = 'consumer/concepts/voice-memory.md';
  const initial = '# Voice memory\n';
  const created = runPut(fx, [relativePath, '--stdin', '--if-match', 'none', '--json'], initial);
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(JSON.parse(created.stdout), {
    schema_version: 'aos.wiki.put-result.v1',
    status: 'ok',
    operation: 'created',
    path: relativePath,
    bytes: Buffer.byteLength(initial),
    previous_sha256: null,
    sha256: digest(initial),
    reindexed: true,
  });

  const target = path.join(fx.wikiRoot, relativePath);
  assert.equal(await fs.readFile(target, 'utf8'), initial);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await reindexCalls(fx), [['wiki', 'reindex', '--json']]);
  assert.deepEqual((await fs.readdir(path.dirname(target))).filter((name) => name.includes('.tmp-')), []);

  await fs.chmod(target, 0o644);
  const next = '# Voice memory\n\nReviewed fact.\n';
  const updated = runPut(fx, [relativePath, '--stdin', '--if-match', digest(initial), '--json'], next);
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(JSON.parse(updated.stdout), {
    schema_version: 'aos.wiki.put-result.v1',
    status: 'ok',
    operation: 'updated',
    path: relativePath,
    bytes: Buffer.byteLength(next),
    previous_sha256: digest(initial),
    sha256: digest(next),
    reindexed: true,
  });
  assert.equal(await fs.readFile(target, 'utf8'), next);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await reindexCalls(fx), [
    ['wiki', 'reindex', '--json'],
    ['wiki', 'reindex', '--json'],
  ]);
});

test('fails closed on create and stale-update conflicts without echoing content', async () => {
  const fx = await fixture();
  const relativePath = 'consumer/concepts/private.md';
  const existing = 'EXISTING_PRIVATE_WIKI_CONTENT';
  const attempted = 'ATTEMPTED_PRIVATE_WIKI_CONTENT';
  const target = path.join(fx.wikiRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, existing, { mode: 0o600 });

  for (const ifMatch of ['none', '0'.repeat(64)]) {
    const result = runPut(fx, [relativePath, '--stdin', '--if-match', ifMatch, '--json'], attempted);
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stderr);
    assert.deepEqual(failure, {
      code: 'WIKI_CONFLICT',
      error: 'Wiki page does not match the requested version',
      actual_sha256: digest(existing),
      exists: true,
      expected_sha256: ifMatch,
      path: relativePath,
    });
    assert.doesNotMatch(result.stderr, /EXISTING_PRIVATE|ATTEMPTED_PRIVATE/);
    assert.equal(await fs.readFile(target, 'utf8'), existing);
  }
  assert.deepEqual(await reindexCalls(fx), []);
});

test('does not create wiki directories for an update precondition on a missing path', async () => {
  const fx = await fixture();
  const result = runPut(
    fx,
    ['missing/nested/page.md', '--stdin', '--if-match', 'a'.repeat(64), '--json'],
    'content',
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    code: 'WIKI_CONFLICT',
    error: 'Wiki page does not match the requested version',
    actual_sha256: null,
    exists: false,
    expected_sha256: 'a'.repeat(64),
    path: 'missing/nested/page.md',
  });
  await assert.rejects(fs.stat(fx.wikiRoot), { code: 'ENOENT' });
  assert.deepEqual(await reindexCalls(fx), []);
});

test('rejects traversal, non-Markdown paths, invalid UTF-8, and oversized stdin before mutation', async () => {
  const fx = await fixture();
  const cases = [
    { args: ['../outside.md', '--stdin', '--if-match', 'none'], code: 'WIKI_INVALID_PATH', input: 'x' },
    { args: ['consumer/concepts/fact.txt', '--stdin', '--if-match', 'none'], code: 'WIKI_INVALID_PATH', input: 'x' },
    { args: ['consumer\\concepts\\fact.md', '--stdin', '--if-match', 'none'], code: 'WIKI_INVALID_PATH', input: 'x' },
    { args: ['consumer/concepts/invalid.md', '--stdin', '--if-match', 'none'], code: 'WIKI_INVALID_CONTENT', input: Buffer.from([0xc3, 0x28]) },
    { args: ['consumer/concepts/large.md', '--stdin', '--if-match', 'none'], code: 'WIKI_INPUT_TOO_LARGE', input: Buffer.alloc(1024 * 1024 + 1, 0x61) },
  ];
  for (const item of cases) {
    const result = runPut(fx, item.args, item.input);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, item.code, result.stderr);
  }
  assert.deepEqual(await reindexCalls(fx), []);
  await assert.rejects(fs.stat(path.join(fx.root, 'outside.md')), { code: 'ENOENT' });
});

test('rejects symlinked parents and targets without changing their destinations', async () => {
  const fx = await fixture();
  const outside = path.join(fx.root, 'outside');
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(fx.wikiRoot, { recursive: true });
  await fs.symlink(outside, path.join(fx.wikiRoot, 'linked'));

  const parentResult = runPut(fx, ['linked/page.md', '--stdin', '--if-match', 'none'], 'private');
  assert.equal(parentResult.status, 1);
  assert.equal(JSON.parse(parentResult.stderr).code, 'WIKI_SYMLINK');
  await assert.rejects(fs.stat(path.join(outside, 'page.md')), { code: 'ENOENT' });

  const destination = path.join(outside, 'destination.md');
  await fs.writeFile(destination, 'keep', { mode: 0o600 });
  const targetDir = path.join(fx.wikiRoot, 'safe');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.symlink(destination, path.join(targetDir, 'page.md'));
  const targetResult = runPut(fx, ['safe/page.md', '--stdin', '--if-match', digest('keep')], 'replace');
  assert.equal(targetResult.status, 1);
  assert.equal(JSON.parse(targetResult.stderr).code, 'WIKI_SYMLINK');
  assert.equal(await fs.readFile(destination, 'utf8'), 'keep');
  assert.deepEqual(await reindexCalls(fx), []);
});

test('serializes writers and removes a dead owner lock before proceeding', async () => {
  const fx = await fixture();
  const lockPath = path.join(fx.root, 'repo', '.wiki-put.lock');
  await fs.mkdir(lockPath, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  const busy = runPut(fx, ['safe/busy.md', '--stdin', '--if-match', 'none'], 'x');
  assert.equal(busy.status, 1);
  assert.equal(JSON.parse(busy.stderr).code, 'WIKI_BUSY');
  assert.deepEqual(await reindexCalls(fx), []);

  await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: 999_999_999 }), { mode: 0o600 });
  const recovered = runPut(fx, ['safe/recovered.md', '--stdin', '--if-match', 'none', '--json'], 'ok');
  assert.equal(recovered.status, 0, recovered.stderr);
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
});

test('reports a committed reindex failure without echoing content or child output', async () => {
  const fx = await fixture();
  const relativePath = 'consumer/concepts/reindex-failure.md';
  const content = 'PRIVATE_WIKI_REINDEX_CONTENT';
  const result = runPut(
    fx,
    [relativePath, '--stdin', '--if-match', 'none', '--json'],
    content,
    { AOS_FAKE_REINDEX_FAIL: '1' },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    code: 'WIKI_REINDEX_FAILED',
    error: 'Wiki page was committed but reindexing failed',
    committed: true,
    operation: 'created',
    path: relativePath,
    reindex_exit: 9,
    sha256: digest(content),
  });
  assert.doesNotMatch(result.stderr, /PRIVATE_WIKI_REINDEX_CONTENT|FAKE_REINDEX_PRIVATE_OUTPUT/);
  assert.equal(await fs.readFile(path.join(fx.wikiRoot, relativePath), 'utf8'), content);
});

test('help is read-only and does not require stdin or runtime state', async () => {
  const fx = await fixture();
  const result = runPut(fx, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /aos wiki put <path> --stdin --if-match <sha256\|none>/);
  assert.deepEqual(await reindexCalls(fx), []);
  await assert.rejects(fs.stat(path.join(fx.root, 'repo')), { code: 'ENOENT' });
});

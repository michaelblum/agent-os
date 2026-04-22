import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../src/logger.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'logger-')); }

test('JSON line has ts, level, msg', () => {
  const dir = makeTmp();
  try {
    const log = createLogger({ logPath: join(dir, 'out.log'), alsoStderr: false });
    log.info('hello', { k: 1 });
    log.close();
    const line = readFileSync(join(dir, 'out.log'), 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'hello');
    assert.deepEqual(parsed.meta, { k: 1 });
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('meta omitted when absent', () => {
  const dir = makeTmp();
  try {
    const log = createLogger({ logPath: join(dir, 'out.log'), alsoStderr: false });
    log.info('bare');
    log.close();
    const parsed = JSON.parse(readFileSync(join(dir, 'out.log'), 'utf8').trim());
    assert.equal('meta' in parsed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation on size threshold: .log.1 appears, .log is new', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 50, keep: 3, alsoStderr: false });
    for (let i = 0; i < 5; i++) log.info('padding to force rotation iteration ' + i);
    log.close();
    assert.ok(existsSync(path));
    assert.ok(existsSync(path + '.1'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation keeps at most `keep` rotated files', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 50, keep: 2, alsoStderr: false });
    for (let i = 0; i < 30; i++) log.info('padding padding padding padding iteration ' + i);
    log.close();
    assert.ok(existsSync(path + '.1'));
    assert.ok(existsSync(path + '.2'));
    assert.equal(existsSync(path + '.3'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no rotation below threshold', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 100 * 1024, keep: 3, alsoStderr: false });
    log.info('small');
    log.close();
    assert.equal(existsSync(path + '.1'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('levels: info, warn, error all emit', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'l.log');
    const log = createLogger({ logPath: path, alsoStderr: false });
    log.info('i'); log.warn('w'); log.error('e');
    log.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
    assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('close() flushes and releases handle', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'c.log');
    const log = createLogger({ logPath: path, alsoStderr: false });
    log.info('x');
    log.close();
    rmSync(path);
    assert.equal(existsSync(path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolvePlaywrightCliRuntime } from '../../scripts/lib/playwright-cli-runtime.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pw-runtime-'));
}

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function env(overrides = {}) {
  return {
    PATH: '',
    AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '1',
    ...overrides,
  };
}

test('resolver finds explicit env override', () => {
  const root = tempDir();
  const cli = path.join(root, 'explicit-playwright-cli');
  writeExecutable(cli, '#!/bin/bash\necho "0.1.15"\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI: cli }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.path, cli);
  assert.equal(result.source, 'env:AOS_PLAYWRIGHT_CLI');
  assert.equal(result.version, '0.1.15');
});

test('resolver finds fake local repo-owned runtime path', () => {
  const root = tempDir();
  const cli = path.join(root, 'node_modules', '.bin', 'playwright-cli');
  writeExecutable(cli, '#!/bin/bash\necho "0.1.15"\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '0' }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.path, cli);
  assert.equal(result.source, 'repo:node_modules/.bin/playwright-cli');
});

test('resolver falls back to PATH', () => {
  const root = tempDir();
  const bin = path.join(root, 'bin');
  const cli = path.join(bin, 'playwright-cli');
  writeExecutable(cli, '#!/bin/bash\necho "0.1.15"\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ PATH: bin }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.path, cli);
  assert.equal(result.source, 'PATH');
});

test('missing runtime returns structured PLAYWRIGHT_CLI_NOT_FOUND', () => {
  const result = resolvePlaywrightCliRuntime({ repoRoot: tempDir(), env: env() });
  assert.equal(result.status, 'missing');
  assert.equal(result.code, 'PLAYWRIGHT_CLI_NOT_FOUND');
  assert.match(result.remediation, /AOS_PLAYWRIGHT_CLI/);
});

test('bad explicit env override does not fall through to repo wrapper', () => {
  const root = tempDir();
  const wrapper = path.join(root, 'scripts', 'aos-playwright-cli');
  writeExecutable(wrapper, '#!/bin/bash\necho "0.1.15"\n');
  const result = resolvePlaywrightCliRuntime({
    repoRoot: root,
    env: env({ AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '0', AOS_PLAYWRIGHT_CLI: path.join(root, 'missing') }),
  });
  assert.equal(result.status, 'missing');
  assert.equal(result.code, 'PLAYWRIGHT_CLI_NOT_FOUND');
  assert.equal(result.skipped[0].source, 'env:AOS_PLAYWRIGHT_CLI');
});

test('too-old runtime returns structured PLAYWRIGHT_CLI_TOO_OLD', () => {
  const root = tempDir();
  const cli = path.join(root, 'cli');
  writeExecutable(cli, '#!/bin/bash\necho "0.1.1"\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI: cli }) });
  assert.equal(result.status, 'too_old');
  assert.equal(result.code, 'PLAYWRIGHT_CLI_TOO_OLD');
  assert.equal(result.version, '0.1.1');
});

test('probe failure returns structured PLAYWRIGHT_CLI_PROBE_FAILED', () => {
  const root = tempDir();
  const cli = path.join(root, 'cli');
  writeExecutable(cli, '#!/bin/bash\necho "broken probe" >&2\nexit 7\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI: cli }) });
  assert.equal(result.status, 'probe_failed');
  assert.equal(result.code, 'PLAYWRIGHT_CLI_PROBE_FAILED');
  assert.match(result.error, /broken probe/);
});

test('package.json version is preferred over binary --version', () => {
  const root = tempDir();
  const pkgDir = path.join(root, 'lib', 'node_modules', '@playwright', 'cli');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@playwright/cli","version":"0.1.1"}\n');
  writeExecutable(path.join(pkgDir, 'cli.js'), '#!/bin/bash\necho "1.59.0-alpha-1758846115000"\n');
  fs.symlinkSync('../lib/node_modules/@playwright/cli/cli.js', path.join(bin, 'playwright-cli'));
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ PATH: bin }) });
  assert.equal(result.status, 'too_old');
  assert.equal(result.version_source, 'package.json');
  assert.equal(result.version, '0.1.1');
});

test('browser proof code does not depend on command -v playwright-cli', () => {
  const proof = fs.readFileSync(path.join(repoRoot, 'tests', 'manual', 'cross-backend-saved-ref-regression-proof.sh'), 'utf8');
  assert.equal(proof.includes('command -v playwright-cli'), false);
});

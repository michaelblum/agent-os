import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MIN_PLAYWRIGHT_CLI_VERSION,
  resolvePlaywrightCliRuntime,
  resolveReviewedObservationRuntime,
} from '../../scripts/lib/playwright-cli-runtime.mjs';

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

test('Observation Ref runtime rejects a merely self-reported override version', () => {
  const root = tempDir();
  const cli = path.join(root, 'explicit-playwright-cli');
  writeExecutable(cli, '#!/bin/bash\necho "0.1.15"\n');
  const result = resolveReviewedObservationRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI: cli }) });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.code, 'TARGET_ACTION_UNSUPPORTED');
  assert.match(result.error, /package-backed/);
});

test('Observation Ref runtime identity covers package implementation files beyond the launcher', () => {
  const root = tempDir();
  const dir = path.join(root, 'node_modules', '@playwright', 'cli');
  const cli = path.join(dir, 'playwright-cli');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"@playwright/cli","version":"0.1.15"}\n');
  writeExecutable(cli, '#!/bin/bash\necho stable-launcher\n');
  fs.writeFileSync(path.join(dir, 'implementation.js'), 'export const implementation = "first";\n');
  const runtimeEnv = env({ AOS_PLAYWRIGHT_CLI: cli });
  const first = resolveReviewedObservationRuntime({ repoRoot: root, env: runtimeEnv });
  assert.equal(first.status, 'ok');
  assert.equal(first.observation_identity.version_source, 'package.json');
  assert.match(first.observation_identity.executable_sha256, /^[a-f0-9]{64}$/);
  assert.match(first.observation_identity.package_closure_sha256, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(dir, 'implementation.js'), 'export const implementation = "second";\n');
  const second = resolveReviewedObservationRuntime({ repoRoot: root, env: runtimeEnv });
  assert.equal(second.status, 'ok');
  assert.equal(first.observation_identity.executable_sha256, second.observation_identity.executable_sha256);
  assert.notEqual(first.observation_identity.package_closure_sha256, second.observation_identity.package_closure_sha256);
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

test('repo wrapper version comes from its exact package pin, not engine output', () => {
  const root = tempDir();
  const cli = path.join(root, 'scripts', 'aos-playwright-cli');
  writeExecutable(cli, '#!/bin/bash\n# npx @playwright/cli@0.1.15\necho "1.62.0-alpha-engine"\n');
  const result = resolvePlaywrightCliRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '0' }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.version, '0.1.15');
  assert.equal(result.version_source, 'repo-wrapper-pin');
  const reviewed = resolveReviewedObservationRuntime({ repoRoot: root, env: env({ AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '0' }) });
  assert.equal(reviewed.status, 'unsupported');
  assert.equal(reviewed.code, 'TARGET_ACTION_UNSUPPORTED');
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

test('Swift browser runtime resolver stays documented as the native bootstrap mirror', () => {
  const jsResolverPath = path.join(repoRoot, 'scripts', 'lib', 'playwright-cli-runtime.mjs');
  const swiftResolverPath = path.join(repoRoot, 'src', 'browser', 'playwright-version-check.swift');
  assert.equal(fs.existsSync(jsResolverPath), true);
  assert.equal(fs.existsSync(swiftResolverPath), true);

  const swiftResolver = fs.readFileSync(swiftResolverPath, 'utf8');
  const scriptsAgents = fs.readFileSync(path.join(repoRoot, 'scripts', 'AGENTS.md'), 'utf8');
  const apiDoc = fs.readFileSync(path.join(repoRoot, 'docs', 'api', 'aos.md'), 'utf8');

  const swiftMinimum = swiftResolver.match(/let kMinPlaywrightCLIVersion = "([^"]+)"/)?.[1];
  assert.equal(swiftMinimum, MIN_PLAYWRIGHT_CLI_VERSION);

  const expectedOrder = [
    'AOS_PLAYWRIGHT_CLI',
    'node_modules/.bin/playwright-cli',
    'scripts/aos-playwright-cli',
    'PATH',
  ];
  for (const [label, text] of Object.entries({ swiftResolver, apiDoc })) {
    let cursor = -1;
    for (const needle of expectedOrder) {
      const next = text.indexOf(needle, cursor + 1);
      assert.ok(next > cursor, `${label} must preserve browser runtime resolver order marker ${needle}`);
      cursor = next;
    }
  }
  for (const [label, text] of Object.entries({ scriptsAgents, apiDoc })) {
    assert.ok(text.includes('scripts/lib/playwright-cli-runtime.mjs'), `${label} must name JS resolver owner`);
    assert.ok(text.includes('src/browser/playwright-version-check.swift'), `${label} must name Swift resolver mirror`);
    assert.match(text, /native\/bootstrap mirror/, `${label} must document Swift resolver as native/bootstrap mirror`);
  }
});

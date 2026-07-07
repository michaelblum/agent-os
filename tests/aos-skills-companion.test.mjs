import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const aos = path.join(repoRoot, 'aos');
const nodePath = path.dirname(process.execPath);

function runAos(args, options = {}) {
  return spawnSync(aos, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      AOS_BYPASS_PERMISSIONS_SETUP: '1',
      AOS_PLAYWRIGHT_CLI_DISABLE_REPO: '1',
      AOS_PLAYWRIGHT_CLI: '',
      PATH: nodePath,
      ...(options.env ?? {}),
    },
  });
}

function parseStdout(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function parseBlockedStdout(result) {
  assert.notEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function parseStderr(result) {
  assert.notEqual(result.status, 0, result.stdout);
  return JSON.parse(result.stderr);
}

async function writeExecutable(file, body) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function fakePlaywrightCli(root, version) {
  const cli = path.join(root, 'bin', 'playwright-cli');
  await writeExecutable(cli, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    `  echo "${version}"`,
    '  exit 0',
    'fi',
    'if [ "$1" = "install" ] && [ "$2" = "--skills" ]; then',
    '  echo "fake install"',
    '  exit 0',
    'fi',
    'echo "unexpected fake playwright-cli invocation: $*" >&2',
    'exit 7',
    '',
  ].join('\n'));
  return cli;
}

async function writeFakePlaywrightSkill(target) {
  const skillRoot = path.join(target, 'playwright');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), [
    '---',
    'name: playwright',
    'description: Playwright CLI browser automation companion skill.',
    '---',
    '',
    '# Playwright CLI',
    '',
    'Use playwright-cli for browser automation escape hatches.',
    '',
  ].join('\n'));
}

test('playwright companion check reports missing runtime with structured code', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-missing-'));
  try {
    const payload = parseBlockedStdout(runAos([
      'skills',
      'companion',
      'check',
      '--name',
      'playwright-cli',
      '--target',
      'path',
      '--path',
      target,
      '--json',
    ]));
    assert.equal(payload.schema_version, 'aos.skills.companion.check.v0');
    assert.equal(payload.status, 'blocked');
    assert.equal(payload.runtime.code, 'PLAYWRIGHT_CLI_NOT_FOUND');
    assert.equal(payload.companion.vendored_by_aos, false);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('playwright companion check reports too-old runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-old-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-target-'));
  try {
    const cli = await fakePlaywrightCli(root, '0.1.1');
    const payload = parseBlockedStdout(runAos([
      'skills',
      'companion',
      'check',
      '--name',
      'playwright-cli',
      '--target',
      'path',
      '--path',
      target,
      '--json',
    ], {
      env: { AOS_PLAYWRIGHT_CLI: cli },
    }));
    assert.equal(payload.runtime.code, 'PLAYWRIGHT_CLI_TOO_OLD');
    assert.equal(payload.runtime.version, '0.1.1');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('playwright companion check detects a Playwright-owned skill in a temp target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-ok-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-installed-'));
  try {
    const cli = await fakePlaywrightCli(root, '0.1.15');
    await writeFakePlaywrightSkill(target);
    const payload = parseStdout(runAos([
      'skills',
      'companion',
      'check',
      '--name',
      'playwright-cli',
      '--target',
      'path',
      '--path',
      target,
      '--json',
    ], {
      env: { AOS_PLAYWRIGHT_CLI: cli },
    }));
    assert.equal(payload.status, 'success');
    assert.equal(payload.runtime.status, 'ok');
    assert.equal(payload.installation.state, 'installed');
    assert.equal(payload.installation.detected_skills[0].name, 'playwright');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('playwright companion install dry-run plans external invocation without target writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-dry-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-dry-target-'));
  try {
    const cli = await fakePlaywrightCli(root, '0.1.15');
    const payload = parseStdout(runAos([
      'skills',
      'companion',
      'install',
      '--name',
      'playwright-cli',
      '--target',
      'path',
      '--path',
      target,
      '--dry-run',
      '--json',
    ], {
      env: { AOS_PLAYWRIGHT_CLI: cli },
    }));
    assert.equal(payload.schema_version, 'aos.skills.companion.install.plan.v0');
    assert.equal(payload.status, 'dry_run');
    assert.deepEqual(payload.planned_invocation.argv, ['install', '--skills']);
    assert.equal(payload.planned_invocation.executable, cli);
    assert.deepEqual(payload.planned_aos_writes, []);
    assert.equal(existsSync(path.join(target, 'playwright')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('playwright companion rejects unsupported names and non-dry-run install', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-reject-'));
  try {
    const unsupported = parseStderr(runAos([
      'skills',
      'companion',
      'check',
      '--name',
      'other',
      '--target',
      'path',
      '--path',
      target,
      '--json',
    ]));
    assert.equal(unsupported.code, 'UNSUPPORTED_COMPANION');

    const nonDryRun = parseStderr(runAos([
      'skills',
      'companion',
      'install',
      '--name',
      'playwright-cli',
      '--target',
      'path',
      '--path',
      target,
      '--json',
    ]));
    assert.equal(nonDryRun.code, 'DRY_RUN_REQUIRED');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

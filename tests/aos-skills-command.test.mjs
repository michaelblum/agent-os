import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const aos = path.join(repoRoot, 'aos');

function runAos(args, options = {}) {
  return spawnSync(aos, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      AOS_BYPASS_PERMISSIONS_SETUP: '1',
      ...(options.env ?? {}),
    },
  });
}

function parseStdout(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function parseStderr(result) {
  assert.notEqual(result.status, 0, result.stdout);
  return JSON.parse(result.stderr);
}

function parseBlockedStdout(result) {
  assert.notEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('aos skills list reports installable root skills with digests', () => {
  const payload = parseStdout(runAos(['skills', 'list', '--json']));
  assert.equal(payload.schema_version, 'aos.skills.list.v0');
  assert.equal(payload.summary.total, 15);
  assert.equal(payload.summary.installable, 8);
  const orientation = payload.skills.find((skill) => skill.name === 'aos-core-orientation');
  assert.ok(orientation);
  assert.equal(orientation.installable, true);
  assert.deepEqual(orientation.target_support, ['agents', 'claude', 'codex', 'path']);
  assert.match(orientation.source_digest, /^[0-9a-f]{64}$/);
});

test('aos skills check inspects an explicit temp target without writes', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-check-'));
  try {
    const payload = parseStdout(runAos(['skills', 'check', '--target', 'path', '--path', target, '--json']));
    assert.equal(payload.schema_version, 'aos.skills.check.v0');
    assert.equal(payload.target.root, target);
    assert.equal(payload.target.exists, true);
    const orientation = payload.skills.find((skill) => skill.name === 'aos-core-orientation');
    assert.equal(orientation.state, 'missing');
    assert.equal(existsSync(path.join(target, 'aos-core-orientation')), false);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills install dry-run reports planned writes and does not mutate target', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-install-'));
  try {
    const payload = parseStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--dry-run',
      '--json',
    ]));
    assert.equal(payload.schema_version, 'aos.skills.install.plan.v0');
    assert.equal(payload.status, 'dry_run');
    assert.equal(payload.summary.selected, 8);
    assert.ok(payload.planned_writes.some((write) => (
      write.skill === 'aos-core-orientation'
      && write.kind === 'package_file'
      && write.destination === path.join(target, 'aos-core-orientation', 'SKILL.md')
      && /^[0-9a-f]{64}$/.test(write.source_digest)
    )));
    assert.ok(payload.planned_writes.some((write) => (
      write.skill === 'aos-core-orientation'
      && write.kind === 'manifest'
      && write.destination === path.join(target, 'aos-core-orientation', '.aos-skill-manifest.json')
    )));
    assert.equal(existsSync(path.join(target, 'aos-core-orientation')), false);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills install writes the default installable pack', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-pack-'));
  try {
    const installed = parseStdout(runAos(['skills', 'install', '--target', 'path', '--path', target, '--json']));
    assert.equal(installed.schema_version, 'aos.skills.install.v0');
    assert.equal(installed.status, 'installed');
    assert.equal(installed.summary.selected, 8);
    assert.equal(installed.summary.states_after.ok, 8);
    assert.ok(installed.selected_skills.includes('aos-browser'));
    assert.ok(installed.selected_skills.includes('aos-saved-workspace'));
    assert.equal(existsSync(path.join(target, 'aos-browser', 'SKILL.md')), true);
    assert.equal(existsSync(path.join(target, 'aos-saved-workspace', 'SKILL.md')), true);

    const checked = parseStdout(runAos(['skills', 'check', '--target', 'path', '--path', target, '--json']));
    assert.equal(checked.summary.ok, 8);
    assert.equal(checked.summary.unsupported_target, 7);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills install writes managed package and re-run is idempotent', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-write-'));
  try {
    const installed = parseStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(installed.schema_version, 'aos.skills.install.v0');
    assert.equal(installed.status, 'installed');
    assert.equal(installed.dry_run, false);
    assert.equal(installed.summary.written, 2);
    assert.equal(installed.summary.states_after.ok, 1);
    assert.equal(existsSync(path.join(target, 'aos-core-orientation', 'SKILL.md')), true);
    assert.equal(existsSync(path.join(target, 'aos-core-orientation', '.aos-skill-manifest.json')), true);

    const checked = parseStdout(runAos([
      'skills',
      'check',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(checked.skills[0].state, 'ok');

    const rerun = parseStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(rerun.schema_version, 'aos.skills.install.v0');
    assert.equal(rerun.summary.written, 0);
    assert.equal(rerun.summary.states_before.ok, 1);
    assert.equal(rerun.summary.states_after.ok, 1);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills install detects tampering and blocks unmanaged material', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-tamper-'));
  try {
    parseStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    await writeFile(path.join(target, 'aos-core-orientation', 'SKILL.md'), 'tampered\n');

    const stale = parseStdout(runAos([
      'skills',
      'check',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(stale.skills[0].state, 'stale');

    const repaired = parseStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(repaired.summary.written, 2);
    assert.equal(repaired.summary.states_after.ok, 1);

    await writeFile(path.join(target, 'aos-core-orientation', 'local-note.md'), 'user material\n');
    const unmanaged = parseStdout(runAos([
      'skills',
      'check',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(unmanaged.skills[0].state, 'unmanaged');

    const blocked = parseBlockedStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'aos-core-orientation',
      '--json',
    ]));
    assert.equal(blocked.schema_version, 'aos.skills.install.v0');
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blocked[0].code, 'UNMANAGED_INSTALLED_SKILL');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills install blocks unsupported skill selections', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-block-'));
  try {
    const unsupported = parseBlockedStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'browser-adapter',
      '--dry-run',
      '--json',
    ]));
    assert.equal(unsupported.schema_version, 'aos.skills.install.plan.v0');
    assert.equal(unsupported.status, 'blocked');
    assert.equal(unsupported.blocked[0].skill, 'browser-adapter');
    assert.equal(unsupported.blocked[0].code, 'UNSUPPORTED_SKILL');

    const unsupportedInstall = parseBlockedStdout(runAos([
      'skills',
      'install',
      '--target',
      'path',
      '--path',
      target,
      '--skill',
      'browser-adapter',
      '--json',
    ]));
    assert.equal(unsupportedInstall.schema_version, 'aos.skills.install.v0');
    assert.equal(unsupportedInstall.status, 'blocked');
    assert.equal(unsupportedInstall.blocked[0].code, 'UNSUPPORTED_SKILL');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('aos skills fails closed for target and path errors', async () => {
  const unsupported = parseStderr(runAos(['skills', 'check', '--target', 'bogus', '--json']));
  assert.equal(unsupported.code, 'UNSUPPORTED_TARGET');

  const relativePath = parseStderr(runAos(['skills', 'check', '--target', 'path', '--path', 'relative', '--json']));
  assert.equal(relativePath.code, 'INSTALL_ROOT_NOT_ABSOLUTE');

  const traversal = parseStderr(runAos(['skills', 'check', '--target', 'path', '--path', '/tmp/../tmp/aos-skills', '--json']));
  assert.equal(traversal.code, 'PATH_TRAVERSAL');

  const relativeNamedTarget = parseStderr(runAos(['skills', 'check', '--target', 'codex', '--json'], {
    env: { CODEX_HOME: 'relative-home' },
  }));
  assert.equal(relativeNamedTarget.code, 'INSTALL_ROOT_NOT_ABSOLUTE');

  const symlinkTarget = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-link-real-'));
  const symlinkPath = path.join(os.tmpdir(), `aos-skills-link-${process.pid}-${Date.now()}`);
  try {
    await symlink(symlinkTarget, symlinkPath, 'dir');
    const symlinkError = parseStderr(runAos(['skills', 'check', '--target', 'path', '--path', symlinkPath, '--json']));
    assert.equal(symlinkError.code, 'INSTALL_ROOT_SYMLINK');
  } finally {
    await rm(symlinkPath, { force: true });
    await rm(symlinkTarget, { recursive: true, force: true });
  }

  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-unmanaged-'));
  try {
    const skillDir = path.join(target, 'aos-core-orientation');
    await writeFile(skillDir, 'not a directory');
    const result = parseStdout(runAos(['skills', 'check', '--target', 'path', '--path', target, '--skill', 'aos-core-orientation', '--json']));
    assert.equal(result.skills[0].state, 'blocked');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

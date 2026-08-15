import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkSkillCompanion,
  planSkillCompanionInstall,
} from '../scripts/lib/aos-skills/companions.mjs';
import { AosSkillsError } from '../scripts/lib/aos-skills/shared.mjs';
import { loadSourceDescriptor } from '../scripts/lib/browser-companion/descriptor.mjs';
import {
  installManagedRuntime,
  managedRuntimeFixture,
  repoRoot,
} from './browser/managed-runtime-test-fixture.mjs';

async function fixture() {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-state-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-companion-target-'));
  return {
    stateRoot,
    target,
    env: { ...process.env, AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' },
    async cleanup() {
      await rm(stateRoot, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    },
  };
}

function options(state, current) {
  return {
    name: 'playwright-cli', target: 'path', path: state.target,
    repoRoot, env: state.env, current,
  };
}

async function writeFakePlaywrightSkill(target) {
  const skillRoot = path.join(target, 'playwright');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), [
    '---',
    'name: playwright',
    'owner: playwright-cli',
    'description: Playwright CLI browser automation companion skill.',
    '---',
    '',
    '# Playwright CLI',
    '',
    'Use playwright-cli for separately owned browser automation skills.',
    '',
  ].join('\n'));
}

test('companion check reports path-free missing and update-available managed runtime state', async () => {
  const state = await fixture();
  try {
    const source = loadSourceDescriptor({ repoRoot });
    const missing = await checkSkillCompanion(options(state, source));
    assert.equal(missing.schema_version, 'aos.skills.companion.check.v0');
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.runtime.state, 'missing');
    assert.equal(missing.runtime.managed, true);

    const old = managedRuntimeFixture('0.1.14');
    await installManagedRuntime(state.env, old);
    const update = await checkSkillCompanion(options(state, source));
    assert.equal(update.status, 'blocked');
    assert.equal(update.runtime.state, 'update_available');
    assert.equal(update.runtime.version, '0.1.14');
    assert.equal(Object.hasOwn(update.runtime, 'path'), false);
    assert.equal(Object.hasOwn(update.runtime, 'source'), false);
  } finally { await state.cleanup(); }
});

test('companion check detects a Playwright-owned skill against exact managed authority', async () => {
  const state = await fixture();
  try {
    const runtime = await installManagedRuntime(state.env);
    await writeFakePlaywrightSkill(state.target);
    const payload = await checkSkillCompanion(options(state, runtime.current));
    assert.equal(payload.status, 'success');
    assert.equal(payload.runtime.status, 'ok');
    assert.equal(payload.runtime.descriptor_sha256, runtime.current.digest);
    assert.equal(payload.installation.state, 'installed');
    assert.equal(payload.installation.detected_skills[0].name, 'playwright');
  } finally { await state.cleanup(); }
});

test('companion check treats AOS adapter Playwright text as candidate only', async () => {
  const state = await fixture();
  try {
    const runtime = await installManagedRuntime(state.env);
    const skillRoot = path.join(state.target, 'aos-browser-notes');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), [
      '---',
      'name: aos-browser-notes',
      'description: AOS notes about Playwright CLI browser automation.',
      '---',
      '',
      '# AOS browser notes',
      '',
      'Managed sessions and upstream skills are separate.',
      '',
    ].join('\n'));
    const payload = await checkSkillCompanion(options(state, runtime.current));
    assert.equal(payload.status, 'success');
    assert.equal(payload.installation.state, 'candidate_detected');
    assert.deepEqual(payload.installation.detected_skills, []);
    assert.equal(payload.installation.candidates[0].name, 'aos-browser-notes');
  } finally { await state.cleanup(); }
});

test('companion check does not install unknown text-only matches', async () => {
  const state = await fixture();
  try {
    const runtime = await installManagedRuntime(state.env);
    const skillRoot = path.join(state.target, 'playwright-notes');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), [
      '---',
      'name: playwright-notes',
      'description: Notes about playwright-cli browser automation.',
      '---',
      '',
      '# Notes',
      '',
      'This mentions playwright-cli but is not owned by Playwright.',
      '',
    ].join('\n'));
    const payload = await checkSkillCompanion(options(state, runtime.current));
    assert.equal(payload.installation.state, 'candidate_detected');
    assert.deepEqual(payload.installation.detected_skills, []);
    assert.equal(payload.installation.candidates[0].name, 'playwright-notes');
  } finally { await state.cleanup(); }
});

test('companion install dry-run is path-free and plans no AOS writes', async () => {
  const state = await fixture();
  try {
    const runtime = await installManagedRuntime(state.env);
    const payload = await planSkillCompanionInstall({
      ...options(state, runtime.current), dryRun: true,
    });
    assert.equal(payload.schema_version, 'aos.skills.companion.install.plan.v0');
    assert.equal(payload.status, 'dry_run');
    assert.deepEqual(payload.planned_invocation, {
      executable: 'playwright-cli',
      argv: ['install', '--skills'],
      note: 'Path-free external escape-hatch plan; AOS does not execute or resolve this skill installer.',
    });
    assert.deepEqual(payload.planned_aos_writes, []);
    assert.doesNotMatch(JSON.stringify(payload.planned_invocation), /(?:^|[\\/])(?:tmp|private|Users)[\\/]/u);
  } finally { await state.cleanup(); }
});

test('companion rejects unsupported names and non-dry-run install', async () => {
  const state = await fixture();
  try {
    await assert.rejects(
      checkSkillCompanion({ ...options(state), name: 'other' }),
      (error) => error instanceof AosSkillsError && error.code === 'UNSUPPORTED_COMPANION',
    );
    await assert.rejects(
      planSkillCompanionInstall(options(state)),
      (error) => error instanceof AosSkillsError && error.code === 'DRY_RUN_REQUIRED',
    );
  } finally { await state.cleanup(); }
});

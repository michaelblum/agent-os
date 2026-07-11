import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, repoUrl), 'utf8');
}

function escaped(pattern) {
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function compact(value) {
  return value.replace(/\s+/g, ' ');
}

test('AOS capability docs keep saved-ref observe-act loop separate from waits', async () => {
  const doc = await text('docs/api/aos-capabilities.md');
  const oneLine = compact(doc);

  for (const phrase of [
    'AOS\'s Playwright-like observe-act loop',
    './aos see capture main --save --mode som --workspace default --name before',
    './aos do click ref:before:r1 --workspace default --dry-run',
    './aos see refs --workspace default --diff before..after --expect change --json',
    'Fresh perception still comes from the canonical action loop',
    'Do not imply saved workspaces recapture automatically',
    'No current `aos see capture --wait-for-change`',
    '`show wait` and `content wait` are readiness waits, not generic assertions.',
    'Use saved refs, explicit command JSON postconditions, or Work Record verification',
  ]) {
    assert.match(oneLine, escaped(phrase));
  }
});

test('harness docs preserve canonical-root and wait posture', async () => {
  const doc = await text('docs/guides/test-harness-ladder-and-prep.md');
  const oneLine = compact(doc);

  for (const phrase of [
    'single-checkout dev workflow uses canonical',
    'canonical content-root keys',
    'Do not use linked git worktrees or branch-scoped keys',
    'Alternate-checkout isolated runtime proof',
    'Do not branch-scope the active shared experience',
    'Real pointer input versus renderer state mutation',
    'Use `show wait` and `content wait` only for readiness conditions',
    'Do not layer open-ended sleeps around these commands.',
    'Dogfood AOS for real input dwell, animation settling, and OS event delivery',
    'A fixed sleep is a temporary low-level harness escape hatch',
    'promotion to an AOS-observed predicate as the cleanup target',
  ]) {
    assert.match(oneLine, escaped(phrase));
  }
});

test('wait and surface housecleaning report classifies live proof before deletion', async () => {
  const report = await text('docs/dev/reports/aos-wait-surface-test-housecleaning-v0.md');
  const oneLine = compact(report);

  for (const phrase of [
    'Keep As Canonical Contract',
    'Keep As Surface Smoke',
    'Migrate Before Deleting',
    'Quarantine As Guarded Live',
    'Delete Candidates',
    'tests/show-wait-timeout-boundary.test.mjs',
    'packages/toolkit/components/wiki-subject-browser/launch.sh',
    'replace it with an AOS-observed predicate',
    'Fixed sleeps that model input dwell or OS delivery are temporary escape hatches.',
  ]) {
    assert.match(oneLine, escaped(phrase));
  }
});

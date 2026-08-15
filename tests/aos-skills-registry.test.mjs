import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  normalizeDescription,
  parseSkillPackage,
  validateSkillRegistry,
} from '../scripts/lib/aos-skills/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('root skill registry covers current direct skill packages', async () => {
  const result = await validateSkillRegistry({ repoRoot });
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.summary.skills, 20);

  const byName = new Map(result.skills.map((skill) => [skill.name, skill]));
  const installablePack = [
    'aos-browser',
    'aos-canvas-vision',
    'aos-command-surface-maintenance',
    'aos-core-orientation',
    'aos-desktop',
    'aos-desktop-world-authoring',
    'aos-focus-sessions',
    'aos-operator-annotations',
    'aos-recipes',
    'aos-runtime-readiness',
    'aos-saved-workspace',
    'aos-verification',
    'aos-work-records',
  ];
  for (const name of installablePack) {
    assert.equal(byName.get(name)?.status, 'installable', name);
    assert.equal(byName.get(name)?.installable, true, name);
    assert.deepEqual(byName.get(name)?.target_support, ['agents', 'claude', 'codex', 'path'], name);
  }
  for (const name of [
    'aos-maintainer-orientation',
    'aos-maintainer-routing',
    'aos-repo-binary-build',
  ]) {
    const skill = byName.get(name);
    assert.equal(skill?.status, 'retained_local', name);
    assert.equal(skill?.installable, false, name);
    assert.deepEqual(skill?.target_support, [], name);
    assert.equal(skill?.claims_durable_behavior, false, name);
  }
  assert.equal(byName.get('symphony-talent-design')?.status, 'private_ignored');
  assert.deepEqual(result.supported_targets, ['agents', 'claude', 'codex', 'path']);
});

test('installable browser and saved-workspace skills preserve split contracts', async () => {
  const browser = await readFile(path.join(repoRoot, 'skills', 'aos-browser', 'SKILL.md'), 'utf8');
  assert.match(browser, /Use AOS browser features only through the exact installed managed companion/);
  assert.match(browser, /Never resolve or invoke an ambient Playwright executable,[\s\S]*`npx`, a global[\s\S]*caller-provided runtime path/);
  assert.match(browser, /already-installed\s+system Chrome/);
  assert.match(browser, /`browser:\/\/attach --cdp <url>` attaches to one direct CDP endpoint/);
  assert.match(browser, /`browser:\/\/attach --extension=chrome` uses the reviewed extension handshake/);
  assert.match(browser, /closes only launched AOS-owned sessions and\s+detaches attached sessions/);
  assert.match(browser, /Browser ref actions are outside the managed session surface and return\s+`TARGET_ACTION_UNSUPPORTED`/);
  assert.match(browser, /Tab creation and selection are not\s+present yet/);
  assert.match(browser, /must not vendor/);

  const workspace = await readFile(path.join(repoRoot, 'skills', 'aos-saved-workspace', 'SKILL.md'), 'utf8');
  assert.match(workspace, /observe-act-recapture/);
  assert.match(workspace, /ref:<snapshot-id>:<ref>/);
  assert.match(workspace, /Coordinates are not handles and reject `state_id`/);

  const desktop = await readFile(path.join(repoRoot, 'skills', 'aos-desktop', 'SKILL.md'), 'utf8');
  assert.match(desktop, /Playwright CLI for desktop/);
  assert.match(desktop, /close\/minimize\/maximize\/restore/);

  const scene = await readFile(path.join(repoRoot, 'skills', 'aos-desktop-world-authoring', 'SKILL.md'), 'utf8');
  assert.match(scene, /aim-and-commit/i);
  assert.match(scene, /data-only cartridge/);
  assert.match(scene, /reviewed trusted extension/);
  assert.match(scene, /isolated standalone WebGL/);
  assert.match(scene, /scene cartridge scaffold/);
  assert.match(scene, /scene extension scaffold/);
  assert.match(scene, /createDesktopWorldSceneSession/);
  assert.match(scene, /one global DesktopWorld coordinate plane/);
  assert.match(scene, /session-lifecycle\.mjs/);
  assert.match(scene, /scene devtools open/);
  assert.match(scene, /scene devtools update/);
  assert.match(scene, /scene devtools transfer/);
  assert.match(scene, /scene replay/);
  assert.doesNotMatch(scene, /\{\.\.\.\}/);
  assert.doesNotMatch(scene, /<[a-z][a-z0-9_-]*>/i);
  assert.doesNotMatch(scene, /AOS_STATE_ROOT|net\.connect|\/sock\b/);
  assert.doesNotMatch(scene, /roadmap|future status-item|dependent visual slice/i);

  const verification = await readFile(path.join(repoRoot, 'skills', 'aos-verification', 'SKILL.md'), 'utf8');
  assert.match(verification, /act-recapture-verify/);
  assert.doesNotMatch(verification, /act-recapture-assert/);
  assert.match(verification, /see refs --diff/);
  assert.match(verification, /see compare/);
  assert.match(verification, /does not capture, crop, resize, poll, wait, or produce a diff image/);

  const annotations = await readFile(path.join(repoRoot, 'skills', 'aos-operator-annotations', 'SKILL.md'), 'utf8');
  assert.match(annotations, /aos status-item/);
  assert.match(annotations, /status-item driven annotation flows/);
  assert.match(annotations, /status-item update/);

  const routing = await readFile(path.join(repoRoot, 'skills', 'aos-maintainer-routing', 'SKILL.md'), 'utf8');
  assert.match(routing, /node scripts\/aos-dev-workflow\.mjs recommend --json --paths/);
  assert.doesNotMatch(routing, /\.\/aos dev/);

  const build = await readFile(path.join(repoRoot, 'skills', 'aos-repo-binary-build', 'SKILL.md'), 'utf8');
  assert.match(build, /node scripts\/aos-dev-build\.mjs build --no-restart --json/);
  assert.match(build, /bash build\.sh --force --no-restart/);
  assert.match(build, /binary_rebuilt: true/);

  const orientation = await readFile(path.join(repoRoot, 'skills', 'aos-maintainer-orientation', 'SKILL.md'), 'utf8');
  assert.match(orientation, /node scripts\/aos-dev-situation\.mjs --json/);
  assert.match(orientation, /Failed sources mean partial orientation/);
  assert.doesNotMatch(orientation, /\.\/aos dev/);

});

test('frontmatter parser handles folded descriptions, booleans, and arrays', () => {
  const raw = [
    '---',
    'name: sample',
    'description: >',
    '  first line',
    '  second line',
    'disable-model-invocation: true',
    'authority:',
    '  - docs/adr/0019-retire-project-agent-orchestration.md',
    '  - .codex/AGENTS.md',
    '---',
    '',
    '# Sample',
    '',
    'Body text.',
  ].join('\n');
  const parsed = parseSkillPackage(raw, 'sample/SKILL.md');
  assert.equal(parsed.frontmatter.name, 'sample');
  assert.equal(parsed.frontmatter.description, 'first line second line');
  assert.equal(parsed.frontmatter['disable-model-invocation'], true);
  assert.deepEqual(parsed.frontmatter.authority, [
    'docs/adr/0019-retire-project-agent-orchestration.md',
    '.codex/AGENTS.md',
  ]);
  assert.equal(parsed.body_line_count, 2);
});

test('registry descriptions normalize to frontmatter descriptions', async () => {
  const result = await validateSkillRegistry({ repoRoot });
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  for (const skill of result.skills) {
    assert.equal(normalizeDescription(skill.name).length > 0, true);
  }
});

test('CLI emits structured validation JSON', () => {
  const result = spawnSync('node', ['scripts/aos-skills-validate.mjs', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 'aos.skills.validation.v0');
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.skills, 20);
});

test('validator rejects retired registry and package states', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-retired-state-test-'));
  try {
    await mkdir(path.join(tmp, 'skills', 'legacy'), { recursive: true });
    await writeFile(path.join(tmp, 'skills', 'legacy', 'SKILL.md'), [
      '---',
      'name: legacy',
      'description: Legacy package.',
      'retired: true',
      '---',
      '',
      '# Legacy package',
      '',
    ].join('\n'));
    await writeFile(path.join(tmp, 'skills', 'registry.json'), JSON.stringify({
      schema_version: 'aos.root-skills.registry.v0',
      body_line_budget: 180,
      supported_targets: {},
      skills: [{
        name: 'legacy',
        path: 'skills/legacy',
        description: 'Legacy package.',
        status: 'retired',
        installable: false,
        invocation: 'retired',
        target_support: [],
        ownership: 'Test fixture.',
        references: [],
        claims_durable_behavior: false,
        backing: [],
      }],
    }, null, 2));

    const result = await validateSkillRegistry({ repoRoot: tmp });
    const codes = result.errors.map((error) => error.code);
    assert.equal(result.ok, false);
    assert.ok(codes.includes('UNKNOWN_STATUS'), JSON.stringify(result.errors, null, 2));
    assert.ok(codes.includes('UNKNOWN_INVOCATION'), JSON.stringify(result.errors, null, 2));
    assert.ok(codes.includes('RETIRED_FRONTMATTER_FORBIDDEN'), JSON.stringify(result.errors, null, 2));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('validator rejects unsafe targets, missing durable backing, and untracked body bloat', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-registry-test-'));
  try {
    await mkdir(path.join(tmp, 'skills', 'bad'), { recursive: true });
    await writeFile(path.join(tmp, 'skills', 'bad', 'SKILL.md'), [
      '---',
      'name: bad',
      'description: Bad skill.',
      '---',
      '',
      ...Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`),
    ].join('\n'));
    await writeFile(path.join(tmp, 'skills', 'registry.json'), JSON.stringify({
      schema_version: 'aos.root-skills.registry.v0',
      body_line_budget: 5,
      supported_targets: {
        codex: { skill_dir: '${CODEX_HOME:-~/.codex}/skills', status: 'supported' },
      },
      skills: [
        {
          name: 'bad',
          path: 'skills/bad',
          description: 'Bad skill.',
          status: 'installable',
          installable: true,
          invocation: 'enabled',
          target_support: ['bogus'],
          ownership: 'Test fixture.',
          references: [],
          claims_durable_behavior: true,
          backing: [],
        },
      ],
    }, null, 2));

    const result = await validateSkillRegistry({ repoRoot: tmp });
    assert.equal(result.ok, false);
    const codes = result.errors.map((error) => error.code);
    assert.ok(codes.includes('UNKNOWN_TARGET'), JSON.stringify(result.errors, null, 2));
    assert.ok(codes.includes('DURABLE_BACKING_REQUIRED'), JSON.stringify(result.errors, null, 2));
    assert.ok(codes.includes('BODY_BUDGET_EXCEEDED'), JSON.stringify(result.errors, null, 2));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

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
  assert.equal(result.summary.skills, 15);

  const byName = new Map(result.skills.map((skill) => [skill.name, skill]));
  const installablePack = [
    'aos-browser',
    'aos-command-surface-maintenance',
    'aos-core-orientation',
    'aos-operator-annotations',
    'aos-recipes',
    'aos-runtime-readiness',
    'aos-saved-workspace',
    'aos-work-records',
  ];
  for (const name of installablePack) {
    assert.equal(byName.get(name)?.status, 'installable', name);
    assert.equal(byName.get(name)?.installable, true, name);
    assert.deepEqual(byName.get(name)?.target_support, ['agents', 'claude', 'codex', 'path'], name);
  }
  assert.equal(byName.get('agent-sync')?.status, 'retired');
  assert.equal(byName.get('aos-agent-workspace')?.status, 'needs_split');
  assert.equal(byName.get('aos-agent-workspace')?.claims_durable_behavior, true);
  assert.equal(byName.get('browser-adapter')?.status, 'needs_split');
  assert.equal(byName.get('browser-adapter')?.claims_durable_behavior, true);
  assert.equal(byName.get('symphony-talent-design')?.status, 'private_ignored');
  assert.deepEqual(result.supported_targets, ['agents', 'claude', 'codex', 'path']);
});

test('installable browser and saved-workspace skills preserve split contracts', async () => {
  const browser = await readFile(path.join(repoRoot, 'skills', 'aos-browser', 'SKILL.md'), 'utf8');
  assert.match(browser, /AOS for browser work that benefits from saved refs/);
  assert.match(browser, /upstream Playwright CLI skills/);
  assert.match(browser, /must not vendor/);
  assert.match(browser, /tracing, video, tab management/);

  const workspace = await readFile(path.join(repoRoot, 'skills', 'aos-saved-workspace', 'SKILL.md'), 'utf8');
  assert.match(workspace, /observe-act-recapture/);
  assert.match(workspace, /ref:<snapshot-id>:<ref>/);
  assert.match(workspace, /Coordinate fallback is diagnostic/);
});

test('frontmatter parser handles folded descriptions, booleans, and arrays', () => {
  const raw = [
    '---',
    'name: sample',
    'description: >',
    '  first line',
    '  second line',
    'retired: true',
    'authority:',
    '  - docs/adr/0017-retire-codex-native-custom-agents.md',
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
  assert.equal(parsed.frontmatter.retired, true);
  assert.deepEqual(parsed.frontmatter.authority, [
    'docs/adr/0017-retire-codex-native-custom-agents.md',
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
  assert.equal(payload.summary.skills, 15);
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

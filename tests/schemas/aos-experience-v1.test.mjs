import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-experience-v1.schema.json');
const testExperiencesRoot = path.join(repoRoot, 'tests/fixtures/experiences');
const runtimeContextFixtureManifestPath = path.join(testExperiencesRoot, 'runtime-context-fixture/aos-experience.json');
const testEnv = { ...process.env, AOS_EXPERIENCES_DIR: testExperiencesRoot };

function scopedRootName(prefix) {
  const result = spawnSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8' });
  const branch = result.status === 0 ? result.stdout.trim() : '';
  if (!branch || branch === 'main') return prefix;
  const suffix = branch.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'worktree';
  return `${prefix}_${suffix}`;
}

function validate(instancePath) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

test('v1 runtime context fixture proves reusable annotation menu affordance', async () => {
  const result = validate(runtimeContextFixtureManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  const annotationItem = manifest.menu.find((item) => item.kind === 'operator_annotation');
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.id, 'runtime-context-fixture');
  assert.equal(Object.hasOwn(manifest, 'default_activation'), false);
  assert.equal(Object.hasOwn(manifest, 'status_item'), false);
  assert.deepEqual(manifest.vanilla_fallback, { tools: ['operator-annotation'] });
  assert.equal(annotationItem.id, 'annotate-visible-target');
  assert.equal(annotationItem.surface, 'runtime-context-surface');
  assert.equal(annotationItem.action_id, 'aos.runtime_context.annotation');
  assert(!JSON.stringify(manifest).includes('sigil'));

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  const payload = JSON.parse(dryRun.stdout);
  assert.equal(payload.status, 'dry_run');
  assert.equal(payload.experience.id, 'runtime-context-fixture');
  assert.equal(Object.hasOwn(payload, 'status_item'), false);
  assert.equal(Object.hasOwn(payload, 'default_activation'), false);
  assert.deepEqual(payload.vanilla_fallback, { tools: ['operator-annotation'] });
  assert.equal(payload.menu.find((item) => item.kind === 'operator_annotation')?.surface, 'runtime-context-surface');
});

test('legacy Sigil is absent from active experience discovery', () => {
  const result = spawnSync('node', ['scripts/aos-experience.mjs', 'status', 'sigil', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_RUNTIME_MODE: 'repo',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.status, 'failure');
  assert.equal(payload.code, 'EXPERIENCE_NOT_FOUND');
});

test('experience activation does not import operator annotation runtime contracts', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/aos-experience.mjs'), 'utf8');
  assert(!source.includes('../packages/toolkit/runtime/'));
});

test('experience activation accepts declared menu surfaces without status-item projection', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-two-surface-menu-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'runtime-context-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  manifest.surfaces = {
    'surface-a': {
      summary: 'Mounted toggle surface.',
    },
    'surface-b': {
      summary: 'Declared non-toggle surface.',
    },
  };
  manifest.menu = [
    {
      id: 'surface-a-entry',
      label: 'Surface A Entry',
      kind: 'future_tool',
      surface: 'surface-a',
      tool: 'surface-a-tool',
    },
    {
      id: 'surface-b-entry',
      label: 'Surface B Entry',
      kind: 'future_tool',
      surface: 'surface-b',
      tool: 'surface-b-tool',
    },
  ];
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  const payload = JSON.parse(dryRun.stdout);
  assert.equal(Object.hasOwn(payload, 'status_item'), false);
  assert.equal(Object.hasOwn(payload, 'default_activation'), false);
  assert.deepEqual(payload.menu.map((item) => item.id), ['surface-a-entry', 'surface-b-entry']);

  manifest.menu[1].surface = 'surface-c';
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const invalid = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0);
  const error = JSON.parse(invalid.stderr);
  assert.equal(error.code, 'INVALID_EXPERIENCE_MANIFEST');
  assert.match(error.error, /targets undeclared surface: surface-c/);
});

test('operator annotation experience menu items require a target surface', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-invalid-operator-menu-'));
  const invalidPath = path.join(tmp, 'aos-experience.json');
  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  delete manifest.menu[0].surface;
  await fs.writeFile(invalidPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const result = validate(invalidPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /'surface' is a required property/);
});

test('v1 experience schema excludes legacy status-item activation fields', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  assert.equal(Object.hasOwn(schema.properties, 'default_activation'), false);
  assert.equal(Object.hasOwn(schema.properties, 'status_item'), false);
  assert.equal(Object.hasOwn(schema.properties.vanilla_fallback.properties, 'status_item'), false);

  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  manifest.vanilla_fallback.status_item = true;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-v1-legacy-field-'));
  const invalidPath = path.join(tmp, 'aos-experience.json');
  await fs.writeFile(invalidPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const result = validate(invalidPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Additional properties are not allowed/);
});

test('experience command rejects retired status-item fields in v1 manifests', async () => {
  const source = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  const retiredFields = [
    ['default_activation', (manifest) => {
      manifest.default_activation = { kind: 'status_item', status_item_first: true, primary_entry: 'runtime-context-surface' };
    }],
    ['status_item', (manifest) => {
      manifest.status_item = { enabled: true };
    }],
    ['vanilla_fallback.status_item', (manifest) => {
      manifest.vanilla_fallback.status_item = true;
    }],
  ];

  for (const [field, mutate] of retiredFields) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-v1-runtime-rejection-'));
    const experiencesRoot = path.join(tmp, 'experiences');
    const fixtureDir = path.join(experiencesRoot, source.id);
    const manifest = JSON.parse(JSON.stringify(source));
    mutate(manifest);
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', source.id, '--dry-run', '--json'], {
      cwd: repoRoot,
      env: {
        ...testEnv,
        AOS_EXPERIENCES_DIR: experiencesRoot,
        AOS_RUNTIME_MODE: 'repo',
        AOS_BYPASS_PREFLIGHT: '1',
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${field} should be rejected`);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, 'INVALID_EXPERIENCE_MANIFEST');
    assert.match(payload.error, /retired status-item activation fields/);
  }
});

test('experience activation rejects operator menu targets outside declared mounted surfaces', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-invalid-target-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'runtime-context-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  manifest.menu[0].surface = 'missing-operator-surface';
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.notEqual(dryRun.status, 0);
  const payload = JSON.parse(dryRun.stderr);
  assert.equal(payload.code, 'INVALID_EXPERIENCE_MANIFEST');
  assert.match(payload.error, /targets undeclared surface: missing-operator-surface/);
});

test('experience deactivate clears active state without mutating runtime config', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-deactivate-'));
  const fakeAos = path.join(tmp, 'fake-aos.mjs');
  const logPath = path.join(tmp, 'aos-calls.jsonl');
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`, { mode: 0o755 });

  const env = {
    ...testEnv,
    AOS_PATH: fakeAos,
    AOS_STATE_ROOT: tmp,
    AOS_RUNTIME_MODE: 'repo',
    AOS_BYPASS_PREFLIGHT: '1',
    FAKE_AOS_LOG: logPath,
  };
  await fs.writeFile(path.join(tmp, 'experience-state.json'), JSON.stringify({ active_experience: 'retired-experience', exclusive: true }));
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: path.join(repoRoot, 'packages/toolkit'),
      },
    },
  }));

  const deactivate = spawnSync('node', ['scripts/aos-experience.mjs', 'deactivate', '--json'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(deactivate.status, 0, `${deactivate.stdout}${deactivate.stderr}`);
  const inactiveState = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'experience-state.json'), 'utf8'));
  assert.equal(inactiveState.active_experience, null);
  const payload = JSON.parse(deactivate.stdout);
  assert.equal(payload.active_experience, null);
  assert.equal(Object.hasOwn(payload, 'status_item'), false);

  const log = await fs.readFile(logPath, 'utf8').catch(() => '');
  const calls = log.trim() ? log.trim().split('\n').map((line) => JSON.parse(line)) : [];
  assert(!calls.some((args) => args[0] === 'config' && args[1] === 'set'), calls);
  assert(!calls.some((args) => args[0] === 'service'), calls);

  const finalConfig = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'config.json'), 'utf8'));
  assert.equal(finalConfig.content.roots.toolkit, path.join(repoRoot, 'packages/toolkit'));
});

test('experience activation does not rewrite equivalent relative canonical content roots', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-roots-idempotent-'));
  const binDir = path.join(tmp, 'bin');
  const fakeAos = path.join(tmp, 'fake-aos.mjs');
  const fakeGit = path.join(binDir, 'git');
  const logPath = path.join(tmp, 'aos-calls.jsonl');
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(fakeGit, `#!/usr/bin/env bash
if [[ "$*" == "-C ${repoRoot} branch --show-current" ]]; then
  echo main
  exit 0
fi
exec /usr/bin/git "$@"
`, { mode: 0o755 });
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(args) + '\\n');
if (args.join('\\0') === ['content', 'status', '--json'].join('\\0')) {
  console.log(JSON.stringify({
    roots: {
      toolkit: '${path.join(repoRoot, 'packages/toolkit')}'
    }
  }));
}
process.exit(0);
`, { mode: 0o755 });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: 'packages/toolkit',
      },
    },
  }));

  const activate = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_PATH: fakeAos,
      AOS_STATE_ROOT: tmp,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
      FAKE_AOS_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
    },
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const payload = JSON.parse(activate.stdout);
  assert.equal(payload.status, 'success');
  assert.equal(payload.content_roots.find((root) => root.id === 'toolkit')?.key, 'toolkit');
  assert.equal(payload.steps.find((step) => step.id === 'content-root:toolkit')?.status, 'unchanged');

  const config = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'config.json'), 'utf8'));
  assert.equal(config.content.roots.toolkit, 'packages/toolkit');
  const calls = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert(!calls.some((args) => args.join('\0') === ['config', 'set', 'content.roots.toolkit', path.join(repoRoot, 'packages/toolkit')].join('\0')), calls);
  assert(!calls.some((args) => args.join('\0') === ['service', 'restart', '--mode', 'repo'].join('\0')), calls);
});

test('experience activation restarts service when live content server still exposes stale branch roots', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-live-stale-roots-'));
  const fakeAos = path.join(tmp, 'fake-aos.mjs');
  const logPath = path.join(tmp, 'aos-calls.jsonl');
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'runtime-context-fixture');
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  manifest.content_roots[0].branch_scoped = true;
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const liveRoots = {
    toolkit: path.join(repoRoot, 'packages/toolkit'),
    toolkit_abandoned_worktree: path.join(tmp, 'missing-worktree', 'packages/toolkit'),
  };

  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(args) + '\\n');
if (args.join('\\0') === ['content', 'status', '--json'].join('\\0')) {
  console.log(${JSON.stringify(JSON.stringify({ roots: liveRoots }))});
}
process.exit(0);
`, { mode: 0o755 });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: path.join(repoRoot, 'packages/toolkit'),
      },
    },
  }));

  const activate = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_PATH: fakeAos,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_STATE_ROOT: tmp,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
      FAKE_AOS_LOG: logPath,
    },
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const payload = JSON.parse(activate.stdout);
  assert.equal(
    payload.steps.find((step) => step.id === 'service:restart')?.reason,
    'content-roots-live-stale',
  );

  const config = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'config.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.content.roots).sort(), ['toolkit']);
  const calls = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert(calls.some((args) => args.join('\0') === ['service', 'restart', '--mode', 'repo'].join('\0')), calls);
});

test('branch-scoped experience content roots require explicit opt-in isolated state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-branch-roots-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'runtime-context-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(runtimeContextFixtureManifestPath, 'utf8'));
  manifest.content_roots[0].branch_scoped = true;
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const canonical = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_STATE_ROOT: tmp,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(canonical.status, 0, `${canonical.stdout}${canonical.stderr}`);
  const canonicalPayload = JSON.parse(canonical.stdout);
  assert.equal(canonicalPayload.content_roots.find((root) => root.id === 'toolkit')?.key, 'toolkit');

  const branchScoped = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_STATE_ROOT: tmp,
      AOS_CONTENT_ROOT_SCOPE: 'branch',
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(branchScoped.status, 0, `${branchScoped.stdout}${branchScoped.stderr}`);
  const branchPayload = JSON.parse(branchScoped.stdout);
  assert.equal(branchPayload.content_roots.find((root) => root.id === 'toolkit')?.key, scopedRootName('toolkit'));

  const rejected = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'runtime-context-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...testEnv,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_STATE_ROOT: '',
      AOS_CONTENT_ROOT_SCOPE: 'branch',
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.notEqual(rejected.status, 0, `${rejected.stdout}${rejected.stderr}`);
  const failure = JSON.parse(rejected.stderr);
  assert.equal(failure.code, 'BRANCH_SCOPED_CONTENT_ROOTS_REQUIRE_STATE_ROOT');
});

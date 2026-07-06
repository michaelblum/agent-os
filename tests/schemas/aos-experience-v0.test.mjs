import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-experience-v0.schema.json');
const sigilManifestPath = path.join(repoRoot, 'experiences/sigil/aos-experience.json');
const operatorFixtureManifestPath = path.join(repoRoot, 'experiences/operator-fixture/aos-experience.json');

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

test('Sigil experience manifest validates against the experience schema', () => {
  const result = validate(sigilManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('operator fixture experience proves reusable annotation menu affordance', async () => {
  const result = validate(operatorFixtureManifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

  const manifest = JSON.parse(await fs.readFile(operatorFixtureManifestPath, 'utf8'));
  const annotationItem = manifest.menu.find((item) => item.kind === 'operator_annotation');
  assert.equal(manifest.id, 'operator-fixture');
  assert.equal(manifest.status_item.toggle_surface.id, 'operator-fixture-surface');
  assert.equal(annotationItem.id, 'annotate-visible-target');
  assert.equal(annotationItem.surface, 'operator-fixture-surface');
  assert.equal(annotationItem.action_id, 'aos.operator_fixture.annotation');
  assert(!JSON.stringify(manifest).includes('sigil'));

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  const payload = JSON.parse(dryRun.stdout);
  assert.equal(payload.status, 'dry_run');
  assert.equal(payload.experience.id, 'operator-fixture');
  assert.equal(payload.status_item.toggle_surface.id, 'operator-fixture-surface');
  assert.match(payload.status_item.toggle_surface.url, /^aos:\/\/toolkit\/runtime\/_smoke\/operator-annotation.html\?aos_mounted_surface_menu=/);
  const projectedURL = new URL(payload.status_item.toggle_surface.url);
  const projection = JSON.parse(Buffer.from(projectedURL.searchParams.get('aos_mounted_surface_menu'), 'base64url').toString('utf8'));
  assert.equal(projection.schema_version, 'aos.mounted-surface-menu-projection.v0');
  assert.equal(projection.experience_id, 'operator-fixture');
  assert.equal(projection.surface_id, 'operator-fixture-surface');
  assert(Array.isArray(projection.menu));
  assert.equal(projection.menu.length, 1);
  assert(projection.menu.every((item) => item.kind === 'operator_annotation'));
  assert(projection.menu.every((item) => item.surface === 'operator-fixture-surface'));
  assert.equal(payload.menu.find((item) => item.kind === 'operator_annotation')?.surface, 'operator-fixture-surface');
});

test('experience activation does not project annotation menu data for non-annotation status surfaces', () => {
  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'sigil', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  const payload = JSON.parse(dryRun.stdout);
  assert.equal(payload.experience.id, 'sigil');
  assert.equal(payload.status_item.toggle_surface.id, 'avatar-main');
  const projectedURL = new URL(payload.status_item.toggle_surface.url);
  assert.equal(projectedURL.searchParams.has('aos_mounted_surface_menu'), false);
  assert.equal(projectedURL.searchParams.has('aos_manifest_menu'), false);
});

test('experience activation does not import operator annotation runtime contracts', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/aos-experience.mjs'), 'utf8');
  assert(!source.includes('operator-annotation-menu-contract.js'));
  assert(!source.includes('../packages/toolkit/runtime/'));
  assert(!source.includes('OPERATOR_ANNOTATION_MENU_QUERY_PARAM'));
  assert(!source.includes('OPERATOR_ANNOTATION_MENU_PROJECTION_SCHEMA_VERSION'));
});

test('mounted-surface menu projection literals have one source owner', async () => {
  const roots = ['experiences', 'packages', 'scripts'];
  const sourceFiles = [];
  async function collect(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(fullPath);
      } else if (/\.(mjs|js)$/.test(entry.name)) {
        sourceFiles.push(fullPath);
      }
    }
  }
  for (const root of roots) await collect(path.join(repoRoot, root));

  const literalOwners = [];
  for (const file of sourceFiles) {
    const source = await fs.readFile(file, 'utf8');
    if (
      source.includes("'aos_mounted_surface_menu'")
      || source.includes("'aos_manifest_menu'")
      || source.includes("'aos.mounted-surface-menu-projection.v0'")
      || source.includes('function mountedSurfaceMenuProjectionEnvelope')
    ) {
      literalOwners.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(literalOwners, [
    'packages/toolkit/contracts/mounted-surface-menu-projection.js',
  ]);
});

test('operator annotation projection ignores unrelated non-annotation menu changes', async () => {
  const base = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(base.status, 0, `${base.stdout}${base.stderr}`);
  const basePayload = JSON.parse(base.stdout);
  const baseURL = basePayload.status_item.toggle_surface.url;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-unrelated-menu-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'operator-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(operatorFixtureManifestPath, 'utf8'));
  manifest.menu.push({
    id: 'unrelated-status-item-entry',
    label: 'Unrelated Entry',
    kind: 'future_tool',
    tool: 'irrelevant',
  });
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const changed = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(changed.status, 0, `${changed.stdout}${changed.stderr}`);
  const changedPayload = JSON.parse(changed.stdout);
  assert.equal(changedPayload.status_item.toggle_surface.url, baseURL);
});

test('experience activation projects mounted-surface menu entries for the target surface only', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-mounted-menu-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'operator-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(operatorFixtureManifestPath, 'utf8'));
  manifest.menu.push({
    id: 'same-surface-future-tool',
    label: 'Same Surface Future Tool',
    kind: 'future_tool',
    surface: 'operator-fixture-surface',
    tool: 'future',
  });
  manifest.menu.push({
    id: 'unmounted-future-tool',
    label: 'Unmounted Future Tool',
    kind: 'future_tool',
    tool: 'unmounted',
  });
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_EXPERIENCES_DIR: experiencesRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  const payload = JSON.parse(dryRun.stdout);
  const projectedURL = new URL(payload.status_item.toggle_surface.url);
  const projection = JSON.parse(Buffer.from(projectedURL.searchParams.get('aos_mounted_surface_menu'), 'base64url').toString('utf8'));
  assert.deepEqual(projection.menu.map((item) => item.id), [
    'annotate-visible-target',
    'same-surface-future-tool',
  ]);
  assert(projection.menu.every((item) => item.surface === 'operator-fixture-surface'));
});

test('operator annotation experience menu items require a target surface', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-invalid-operator-menu-'));
  const invalidPath = path.join(tmp, 'aos-experience.json');
  const manifest = JSON.parse(await fs.readFile(operatorFixtureManifestPath, 'utf8'));
  delete manifest.menu[0].surface;
  await fs.writeFile(invalidPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const result = validate(invalidPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /'surface' is a required property/);
});

test('experience activation rejects operator menu targets outside declared mounted surfaces', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-invalid-target-'));
  const experiencesRoot = path.join(tmp, 'experiences');
  const fixtureDir = path.join(experiencesRoot, 'operator-fixture');
  await fs.mkdir(fixtureDir, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(operatorFixtureManifestPath, 'utf8'));
  manifest.menu[0].surface = 'missing-operator-surface';
  await fs.writeFile(path.join(fixtureDir, 'aos-experience.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dryRun = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--dry-run', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
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

test('experience activation removes same-id stale toggle canvas even when previous target differed', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-stale-toggle-canvas-'));
  const fakeAos = path.join(tmp, 'fake-aos.mjs');
  const logPath = path.join(tmp, 'aos-calls.jsonl');
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(args) + '\\n');
if (args.join('\\0') === ['content', 'status', '--json'].join('\\0')) {
  console.log(JSON.stringify({ roots: { toolkit: '${path.join(repoRoot, 'packages/toolkit')}' } }));
}
if (args.join('\\0') === ['show', 'list', '--json'].join('\\0')) {
  console.log(JSON.stringify({
    canvases: [{
      id: 'operator-fixture-surface',
      url: 'http://127.0.0.1:58012/sigil/renderer/index.html?toolkit-root=toolkit',
      lifecycleState: 'active',
    }],
  }));
}
process.exit(0);
`, { mode: 0o755 });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: path.join(repoRoot, 'packages/toolkit'),
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'avatar-main',
      toggle_url: 'aos://sigil/renderer/index.html?toolkit-root=toolkit',
      toggle_track: 'union',
      icon: 'sigil',
    },
  }));

  const activate = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'operator-fixture', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAos,
      AOS_STATE_ROOT: tmp,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
      FAKE_AOS_LOG: logPath,
    },
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const payload = JSON.parse(activate.stdout);
  const staleStep = payload.steps.find((step) => step.id === 'status-item:stale-target:operator-fixture-surface');
  assert.equal(staleStep.status, 'success');
  assert.equal(staleStep.canvas_url, 'http://127.0.0.1:58012/sigil/renderer/index.html?toolkit-root=toolkit');
  assert.match(staleStep.current_url, /^aos:\/\/toolkit\/runtime\/_smoke\/operator-annotation.html\?aos_mounted_surface_menu=/);

  const calls = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert(calls.some((args) => args.join('\0') === ['show', 'remove', '--id', 'operator-fixture-surface'].join('\0')), calls);
});

test('Sigil experience is exclusive and status-item-first', async () => {
  const manifest = JSON.parse(await fs.readFile(sigilManifestPath, 'utf8'));
  assert.equal(manifest.id, 'sigil');
  assert.equal(manifest.exclusive, true);
  assert.equal(manifest.default_activation.kind, 'status_item');
  assert.equal(manifest.default_activation.status_item_first, true);
  assert.equal(manifest.default_activation.primary_entry, 'avatar');
  assert.equal(manifest.status_item.toggle_surface.id, 'avatar-main');
  assert.deepEqual(manifest.hooks, [
    {
      phase: 'before_activate',
      script: 'apps/sigil/sigilctl-seed.sh',
      argv: ['--mode', '${mode}'],
    },
  ]);
  assert.equal(manifest.branding.display_name, 'Sigil');
  assert.deepEqual(manifest.vanilla_fallback.tools, ['avatar-terminal', 'graph-wiki', 'inspectors']);
  assert.equal(manifest.surfaces['legacy-workbench'].legacy, true);
});

test('experience deactivate reports and writes honest disabled status-item config', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-deactivate-'));
  const fakeAos = path.join(tmp, 'fake-aos.mjs');
  const logPath = path.join(tmp, 'aos-calls.jsonl');
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`, { mode: 0o755 });

  const env = {
    ...process.env,
    AOS_PATH: fakeAos,
    AOS_STATE_ROOT: tmp,
    AOS_RUNTIME_MODE: 'repo',
    AOS_BYPASS_PREFLIGHT: '1',
    FAKE_AOS_LOG: logPath,
  };
  await fs.writeFile(path.join(tmp, 'experience-state.json'), JSON.stringify({ active_experience: 'legacy-sigil', exclusive: true }));
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: path.join(repoRoot, 'packages/toolkit'),
        toolkit_old_branch: path.join(repoRoot, 'packages/toolkit'),
        sigil_old_branch: path.join(repoRoot, 'apps/sigil'),
        custom_sigil_docs: path.join(repoRoot, 'docs'),
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'avatar-main',
      toggle_url: 'aos://sigil_old_branch/renderer/index.html?toolkit-root=toolkit_old_branch',
      toggle_at: [200, 200, 300, 300],
      toggle_track: 'union',
      icon: 'sigil',
    },
  }));
  const activate = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'sigil', '--json'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, `${activate.stdout}${activate.stderr}`);
  const activatePayload = JSON.parse(activate.stdout);
  const activeState = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'experience-state.json'), 'utf8'));
  assert.equal(activeState.active_experience, 'sigil');
  const activeConfig = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'config.json'), 'utf8'));
  assert.equal(activeConfig.content.roots.toolkit, path.join(repoRoot, 'packages/toolkit'));
  assert.equal(activeConfig.content.roots.custom_sigil_docs, path.join(repoRoot, 'docs'));
  assert.equal(activeConfig.content.roots.toolkit_old_branch, undefined);
  assert.equal(activeConfig.content.roots.sigil_old_branch, undefined);
  assert.deepEqual(activatePayload.steps.find((step) => step.id === 'content-root:reconcile')?.removed, [
    'sigil_old_branch',
    'toolkit_old_branch',
  ]);
  await assert.rejects(fs.stat(path.join(tmp, 'experience-state.json')));

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
  assert.equal(payload.status_item.enabled, false);
  assert.deepEqual(payload.status_item.menu, []);

  const calls = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const toolkitRoot = scopedRootName('toolkit');
  const sigilRoot = scopedRootName('sigil');
  assert(calls.some((args) => args.join('\0') === ['content', 'status', '--json'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['service', 'restart', '--mode', 'repo'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === [
    'content',
    'wait',
    '--root',
    toolkitRoot,
    '--root',
    sigilRoot,
    '--auto-start',
    '--allow-start',
    '--timeout',
    '15s',
  ].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['wiki', 'seed'].join('\0')), calls);
  assert(calls.some((args) => args[0] === 'wiki' && args[1] === 'seed' && args[2] === '--namespace' && args[3] === 'sigil'), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.enabled', 'false'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_id', 'status-item-canvas'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_url', ''].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_track', 'none'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['show', 'remove', '--id', 'avatar-main'].join('\0')), calls);
});

test('Sigil activation does not rewrite equivalent relative canonical content roots', async () => {
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
      toolkit: '${path.join(repoRoot, 'packages/toolkit')}',
      sigil: '${path.join(repoRoot, 'apps/sigil')}'
    }
  }));
}
process.exit(0);
`, { mode: 0o755 });
  await fs.writeFile(path.join(tmp, 'repo', 'config.json'), JSON.stringify({
    content: {
      roots: {
        toolkit: 'packages/toolkit',
        sigil: 'apps/sigil',
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'avatar-main',
      toggle_url: 'aos://sigil/renderer/index.html?toolkit-root=toolkit',
      toggle_at: [200, 200, 300, 300],
      toggle_track: 'union',
      icon: 'sigil',
    },
  }));

  const activate = spawnSync('node', ['scripts/aos-experience.mjs', 'activate', 'sigil', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
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
  assert.equal(payload.content_roots.find((root) => root.id === 'sigil')?.key, 'sigil');
  assert.equal(payload.steps.find((step) => step.id === 'content-root:toolkit')?.status, 'unchanged');
  assert.equal(payload.steps.find((step) => step.id === 'content-root:sigil')?.status, 'unchanged');

  const config = JSON.parse(await fs.readFile(path.join(tmp, 'repo', 'config.json'), 'utf8'));
  assert.equal(config.content.roots.toolkit, 'packages/toolkit');
  assert.equal(config.content.roots.sigil, 'apps/sigil');
  const calls = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert(!calls.some((args) => args.join('\0') === ['config', 'set', 'content.roots.toolkit', path.join(repoRoot, 'packages/toolkit')].join('\0')), calls);
  assert(!calls.some((args) => args.join('\0') === ['config', 'set', 'content.roots.sigil', path.join(repoRoot, 'apps/sigil')].join('\0')), calls);
  assert(!calls.some((args) => args.join('\0') === ['service', 'restart', '--mode', 'repo'].join('\0')), calls);
});

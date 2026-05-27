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

test('Sigil experience is exclusive and status-item-first', async () => {
  const manifest = JSON.parse(await fs.readFile(sigilManifestPath, 'utf8'));
  assert.equal(manifest.id, 'sigil');
  assert.equal(manifest.exclusive, true);
  assert.equal(manifest.default_activation.kind, 'status_item');
  assert.equal(manifest.default_activation.status_item_first, true);
  assert.equal(manifest.default_activation.avatar_entry, 'avatar');
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
    '--timeout',
    '15s',
  ].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['wiki', 'seed'].join('\0')), calls);
  assert(calls.some((args) => args[0] === 'wiki' && args[1] === 'seed' && args[2] === '--namespace' && args[3] === 'sigil'), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.enabled', 'false'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_id', 'avatar'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_url', ''].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['config', 'set', 'status_item.toggle_track', 'none'].join('\0')), calls);
  assert(calls.some((args) => args.join('\0') === ['show', 'remove', '--id', 'avatar-main'].join('\0')), calls);
});

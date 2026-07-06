import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const toolkitRoot = path.join(repoRoot, 'packages/toolkit');

function runNode(args, env = {}) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
      ...env,
    },
    encoding: 'utf8',
  });
}

function dryRunToggleURL(id, env = {}) {
  const result = runNode(['scripts/aos-experience.mjs', 'activate', id, '--dry-run', '--json'], env);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout).status_item.toggle_surface.url;
}

async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeFakeAos(tmp, responses) {
  const fake = path.join(tmp, 'fake-aos.mjs');
  const log = path.join(tmp, 'aos-calls.jsonl');
  await fs.writeFile(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AOS_LOG, JSON.stringify(args) + '\\n');
const key = args.join(' ');
const denied = [
  'config set',
  'service start',
  'service restart',
  'show remove',
  'experience activate',
];
if (denied.some((prefix) => key.startsWith(prefix))) {
  console.error(JSON.stringify({ code: 'MUTATION_NOT_ALLOWED', argv: args }));
  process.exit(23);
}
const responses = JSON.parse(process.env.FAKE_AOS_RESPONSES || '{}');
if (!Object.hasOwn(responses, key)) {
  console.error(JSON.stringify({ code: 'UNEXPECTED_FAKE_AOS_CALL', argv: args }));
  process.exit(2);
}
const response = responses[key];
if (response.stderr) process.stderr.write(response.stderr);
if (Object.hasOwn(response, 'value')) process.stdout.write(JSON.stringify(response.value));
else if (response.stdout) process.stdout.write(response.stdout);
process.exit(response.exit_code ?? 0);
`, { mode: 0o755 });
  return { fake, log };
}

function baseResponses(tmp, {
  contentRoots = { toolkit: toolkitRoot },
  canvases = [],
  service = {},
  permissions = {},
} = {}) {
  return {
    'service status --mode repo --json': {
      value: {
        status: 'ok',
        mode: 'repo',
        loaded: true,
        running: true,
        pid: 12345,
        label: 'com.agent-os.aos.repo',
        target_matches_expected: true,
        state_dir: path.join(tmp, 'repo'),
        notes: [],
        ...service,
      },
    },
    'permissions check --json': {
      value: {
        status: 'ok',
        permissions: {
          accessibility: true,
          screen_recording: true,
          listen_access: true,
          post_access: true,
          ...(permissions.permissions || {}),
        },
        daemon_view: {
          reachable: true,
          input_tap: {
            status: 'active',
            attempts: 1,
            listen_access: true,
            post_access: true,
          },
        },
        cli_view: {
          accessibility: true,
          screen_recording: true,
          listen_access: true,
          post_access: true,
          ...(permissions.permissions || {}),
        },
        requirements: [],
        setup: {
          marker_exists: true,
          setup_completed: true,
          bundle_matches_current: true,
        },
        missing_permissions: permissions.missing_permissions || [],
        ready_for_testing: permissions.ready_for_testing ?? true,
        ready_source: 'daemon',
        notes: permissions.notes || [],
      },
    },
    'content status --json': {
      value: { roots: contentRoots },
    },
    'show list --json': {
      value: { status: 'success', canvases },
    },
  };
}

async function runContext(tmp, id, responses) {
  const { fake, log } = await writeFakeAos(tmp, responses);
  const result = runNode(['scripts/aos-experience.mjs', 'status', id, '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return {
    payload: JSON.parse(result.stdout),
    calls: (await fs.readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test('experience status reports healthy operator fixture runtime context without mutation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-healthy-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: expectedURL,
      toggle_track: 'union',
      icon: 'aos',
    },
  });
  await fs.mkdir(path.join(tmp, 'repo', 'pending-annotations', 'records'), { recursive: true });

  const { payload, calls } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.schema_version, 'aos.experience-runtime-context.v0');
  assert.equal(payload.status, 'ok');
  assert.equal(payload.experience.id, 'operator-fixture');
  assert.equal(payload.active_experience.status, 'current');
  assert.equal(payload.content_roots.status, 'current');
  assert.equal(payload.status_item.target.status, 'current');
  assert.equal(payload.status_item.mounted_surface.status, 'current');
  assert.equal(payload.status_item.menu_projection.status, 'current');
  assert.equal(payload.pending_annotations.status, 'initialized');
  assert.equal(payload.runtime.readiness.ready, true);
  assert.equal(payload.capabilities.annotation.status, 'ready');
  assert.deepEqual(payload.recommended_next, []);

  const callText = calls.map((args) => args.join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
    'show list --json',
  ].sort());
});

test('experience status does not treat Sigil state as operator fixture success', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-cross-app-'));
  const sigilURL = dryRunToggleURL('sigil', { AOS_STATE_ROOT: tmp });
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'sigil',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'avatar-main',
      toggle_url: sigilURL,
      toggle_track: 'union',
      icon: 'sigil',
    },
  });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'avatar-main',
      url: sigilURL,
      lifecycleState: 'active',
    }],
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.active_experience.id, 'sigil');
  assert.equal(payload.active_experience.status, 'mismatch');
  assert.equal(payload.status_item.target.status, 'wrong_surface');
  assert.equal(payload.status_item.mounted_surface.status, 'missing');
  assert.equal(payload.capabilities.annotation.status, 'degraded');
  assert(payload.recommended_next.some((item) => (
    item.id === 'activate-requested-experience'
    && item.argv.join(' ') === './aos experience activate operator-fixture --json --allow-start'
  )), payload.recommended_next);
});

test('experience status reports stale target, missing content root, and uninitialized pending state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-drift-'));
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: path.join(tmp, 'stale-toolkit'),
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: 'aos://toolkit/runtime/_smoke/stale.html',
      toggle_track: 'union',
      icon: 'aos',
    },
  });

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    contentRoots: {},
    canvases: [{
      id: 'operator-fixture-surface',
      url: 'aos://toolkit/runtime/_smoke/stale.html',
      lifecycleState: 'active',
    }],
  }));

  assert.equal(payload.status, 'degraded');
  assert.equal(payload.content_roots.roots[0].configured_status, 'stale');
  assert.equal(payload.content_roots.roots[0].live_status, 'missing');
  assert.equal(payload.status_item.target.status, 'drift');
  assert.equal(payload.status_item.mounted_surface.status, 'stale');
  assert.equal(payload.pending_annotations.status, 'not_initialized');
  assert(payload.recommended_next.some((item) => item.id === 'activate-requested-experience'));
  assert(payload.recommended_next.some((item) => item.id === 'remove-stale-mounted-surface'));
  assert(payload.recommended_next.some((item) => (
    item.id === 'pending-annotation-create-display-only'
    && item.display_only === true
  )));
});

test('experience status blocks corrupt pending state and reports passive readiness blockers', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-corrupt-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: expectedURL,
      toggle_track: 'union',
      icon: 'aos',
    },
  });
  await fs.mkdir(path.join(tmp, 'repo'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'repo', 'pending-annotations'), 'not a directory\n', 'utf8');

  const { payload } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
    }],
    service: {
      running: false,
      pid: null,
    },
    permissions: {
      permissions: {
        screen_recording: false,
      },
      missing_permissions: ['screen_recording'],
      ready_for_testing: false,
      notes: ['Screen Recording permission is not granted.'],
    },
  }));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.pending_annotations.status, 'corrupt');
  assert.equal(payload.runtime.readiness.ready, false);
  assert(payload.runtime.readiness.blockers.some((item) => item.id === 'service_not_ready'), payload.runtime.readiness);
  assert(payload.runtime.readiness.blockers.some((item) => item.id === 'permission:screen_recording'), payload.runtime.readiness);
  assert.equal(payload.capabilities.perception.status, 'blocked');
  assert.equal(payload.capabilities.evidence_handoff.status, 'blocked');
  assert(payload.recommended_next.some((item) => item.id === 'check-runtime-readiness'));
  assert(payload.recommended_next.some((item) => item.id === 'permissions-setup'));
});

test('experience status reports symlinked pending index through store-owned status without mutation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-index-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-experience-context-index-outside-'));
  const expectedURL = dryRunToggleURL('operator-fixture', { AOS_STATE_ROOT: tmp });
  await writeJSON(path.join(tmp, 'repo', 'experience-state.json'), {
    active_experience: 'operator-fixture',
    exclusive: true,
  });
  await writeJSON(path.join(tmp, 'repo', 'config.json'), {
    content: {
      roots: {
        toolkit: toolkitRoot,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: 'operator-fixture-surface',
      toggle_url: expectedURL,
      toggle_track: 'union',
      icon: 'aos',
    },
  });
  const pendingRoot = path.join(tmp, 'repo', 'pending-annotations');
  await fs.mkdir(path.join(pendingRoot, 'records'), { recursive: true });
  const outsideIndex = path.join(outside, 'index.json');
  await writeJSON(outsideIndex, {
    schema_version: 'aos.pending-annotation.v0',
    runtime_mode: 'repo',
    state_root: tmp,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    annotations: [],
  });
  await fs.symlink(outsideIndex, path.join(pendingRoot, 'index.json'));

  const { payload, calls } = await runContext(tmp, 'operator-fixture', baseResponses(tmp, {
    canvases: [{
      id: 'operator-fixture-surface',
      url: expectedURL,
      lifecycleState: 'active',
      suspended: false,
    }],
  }));

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.pending_annotations.status, 'corrupt');
  assert.equal(payload.pending_annotations.index_status, 'symlink');
  assert.equal(payload.capabilities.evidence_handoff.status, 'blocked');
  assert(payload.diagnostics.some((item) => item.id === 'pending-annotation-state-corrupt'), payload.diagnostics);

  const callText = calls.map((args) => args.join(' '));
  assert.deepEqual(callText.sort(), [
    'content status --json',
    'permissions check --json',
    'service status --mode repo --json',
    'show list --json',
  ].sort());
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { setupState } from '../scripts/lib/aos-facts.mjs';
import { guardedLiveOperation } from '../scripts/lib/aos-live-operation.mjs';
import { nextReadyExecutionStep } from '../scripts/lib/aos-ready-execution.mjs';
import {
  disagreementFor,
  effectivePermissionView,
  evaluateReadyForTesting,
  inputMonitoringSubGuidance,
  missingPermissionIDsFor,
  permissionRequirements,
  planPermissionSetup,
  readyBlockers,
  readyDecision,
  readyEvaluationSnake,
  readyNextActions,
  runtimeVerdict,
  runSetupPromptPlan,
  statusReadinessProjection,
} from '../scripts/lib/aos-readiness.mjs';

function setup(overrides = {}) {
  return setupState({
    marker_exists: true,
    marker_path: '/tmp/aos/setup.json',
    bundle_path: '/repo/aos',
    current_bundle_path: '/repo/aos',
    bundle_matches_current: true,
    setup_completed: true,
    ...overrides,
  });
}

function runtime(overrides = {}) {
  return {
    mode: 'repo',
    daemon_running: true,
    socket_reachable: true,
    ownership_state: 'managed',
    input_tap_status: 'active',
    ...overrides,
  };
}

function permissions(overrides = {}) {
  return {
    accessibility: true,
    screen_recording: true,
    listen_access: true,
    post_access: true,
    microphone: true,
    ...overrides,
  };
}

function daemon(overrides = {}) {
  return {
    inputTap: {
      status: 'active',
      attempts: 1,
      listenAccess: true,
      postAccess: true,
      ...overrides.inputTap,
    },
    permissions: {
      accessibility: true,
      microphone: true,
      microphoneState: 'authorized',
      ...overrides.permissions,
    },
  };
}

function facts(overrides = {}) {
  return {
    runtime: runtime(overrides.runtime),
    daemon: overrides.daemon === null ? null : daemon(overrides.daemon ?? {}),
    permissions: permissions(overrides.permissions),
    setup: setup(overrides.setup),
    binary_identity: {
      path: '/repo/aos',
      exists: true,
      mtime: '2026-07-09T01:36:00Z',
      mtime_ms: 1783557360000,
      size_bytes: 123456,
      cdhash: 'abc123def456',
      ...overrides.binary_identity,
    },
    cleanReport: {
      status: 'clean',
      stale_daemons: [],
      canvases: [],
      notes: [],
      ...overrides.cleanReport,
    },
  };
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function nextActionsFor(current, blockers = readyBlockers(current, 'repo')) {
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const ready = Boolean(current.runtime.socket_reachable && evaluation.readyForTesting && blockers.length === 0);
  const decision = readyDecision(ready, blockers, current.daemon, current.permissions);
  return readyNextActions(decision, blockers, current.setup, 'repo', './aos');
}

test('daemon-active ready path uses daemon source with the full capability permission set granted', () => {
  const result = evaluateReadyForTesting(daemon(), permissions(), setup());
  assert.deepEqual(result, { readyForTesting: true, readySource: 'daemon' });
  assert.deepEqual(readyEvaluationSnake(result), { ready_for_testing: true, ready_source: 'daemon' });
});

test('daemon input tap inactive blocks readiness and yields runtime recovery actions', () => {
  const current = facts({ daemon: { inputTap: { status: 'inactive', attempts: 3 } } });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const blockers = readyBlockers(current, 'repo');

  assert.equal(evaluation.readyForTesting, false);
  assert.equal(evaluation.readySource, 'daemon');
  assert.equal(blockers.some((blocker) => blocker.id === 'input_tap_not_active'), true);
  assert.deepEqual(
    nextActionsFor(current, blockers).map((action) => action.command),
    ['./aos ready --repair', './aos service restart --mode repo', './aos ready'],
  );
});

test('permission recovery owns mixed input-tap and microphone blockers', () => {
  const current = facts({
    daemon: {
      inputTap: { status: 'inactive', attempts: 3 },
      permissions: { microphone: false, microphoneState: 'denied' },
    },
  });
  const blockers = readyBlockers(current, 'repo');
  const decision = readyDecision(false, blockers, current.daemon, current.permissions);

  assert.deepEqual(decision, {
    phase: 'human_required',
    diagnosis: 'microphone_denied',
    action_reason: 'microphone_permission',
    primary_blocker: {
      kind: 'permission',
      id: 'microphone',
      scope: 'daemon',
      reason: 'microphone_denied',
    },
  });
  assert.deepEqual(
    readyNextActions(decision, blockers, current.setup, 'repo', './aos').map((action) => action.command ?? action.settings_url),
    [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      './aos permissions check --json',
      './aos ready',
    ],
  );
});

test('daemon accessibility false overrides granted CLI accessibility as stale daemon grant', () => {
  const current = facts({ daemon: { permissions: { accessibility: false } } });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const blockers = readyBlockers(current, 'repo');

  assert.equal(evaluation.readyForTesting, false);
  assert.equal(evaluation.readySource, 'daemon');
  assert.equal(blockers.some((blocker) => blocker.kind === 'permission' && blocker.scope === 'daemon' && blocker.id === 'accessibility'), true);
  assert.deepEqual(missingPermissionIDsFor(current.daemon, current.permissions), ['accessibility']);
  assert.deepEqual(disagreementFor(current.daemon, current.permissions), {
    accessibility: { cli: true, daemon: false },
  });
});

test('passive-green live-fail daemon input monitoring names post-rebuild stale TCC and remedy', () => {
  const current = facts({
    daemon: {
      inputTap: {
        status: 'unavailable',
        attempts: 1,
        listenAccess: false,
      },
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'human_required');
  assert.equal(verdict.diagnosis, 'daemon_tcc_grant_stale_or_missing');
  assert.equal(verdict.tcc_staleness.id, 'post_rebuild_tcc_stale');
  assert.equal(verdict.tcc_staleness.reason.includes('stale registration for a previous aos binary'), true);
  assert.deepEqual(verdict.tcc_staleness.stale_fields, ['listen_access']);
  assert.deepEqual(verdict.tcc_staleness.cli_passive, {
    accessibility: true,
    screen_recording: true,
    listen_access: true,
    post_access: true,
    microphone: true,
  });
  assert.equal(verdict.tcc_staleness.daemon_live.listen_access, false);
  assert.equal(verdict.tcc_staleness.daemon_live.input_tap_status, 'unavailable');
  assert.equal(verdict.tcc_staleness.binary_identity.cdhash, 'abc123def456');
  assert.deepEqual(verdict.tcc_staleness.remedy.commands, [
    './aos ready --repair --post-permission',
  ]);
  assert.deepEqual(verdict.terminal_handoff, {
    type: 'manual_tcc_reset',
    reason: 'post_rebuild_tcc_stale',
    terminal: true,
    alert: 'three_chimes',
    instruction: 'End the current turn. Do not run reset-runtime, setup, ready, service restart, or other TCC-backed probes until the user says finished.',
    next_user_signal: 'finished',
    human_action: 'Remove/re-add or regrant the aos entry in macOS Privacy & Security, then return to the waiting session and say: finished.',
    target_path: '/repo/aos',
    resume_command: './aos ready --repair --post-permission',
  });
  assert.deepEqual(verdict.next_actions, [
    {
      type: 'manual_tcc_reset',
      label: 'play the stale-TCC handoff alert, end the turn, and wait for the user to say finished after manual TCC reset/regrant',
      reason: 'post_rebuild_tcc_stale',
      terminal: true,
      next_user_signal: 'finished',
    },
    {
      type: 'command',
      label: 'after the user says finished, run one guarded managed restart and bounded post-permission recheck',
      command: './aos ready --repair --post-permission',
      after_user_signal: 'finished',
    },
  ]);
  assert.equal(
    verdict.notes.some((note) => note.includes('passive checks pass, but live privileged access fails after a rebuild')),
    true,
  );
});

test('post-rebuild input-monitoring staleness outranks microphone recovery', () => {
  const current = facts({
    daemon: {
      inputTap: {
        status: 'unavailable',
        attempts: 1,
        listenAccess: false,
      },
      permissions: {
        microphone: false,
        microphoneState: 'not_determined',
      },
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'daemon_tcc_grant_stale_or_missing');
  assert.equal(verdict.tcc_staleness.id, 'post_rebuild_tcc_stale');
  assert.equal(verdict.terminal_handoff.reason, 'post_rebuild_tcc_stale');
  assert.deepEqual(verdict.next_actions.map((action) => action.command).filter(Boolean), [
    './aos ready --repair --post-permission',
  ]);
  assert.equal(
    verdict.next_actions.some((action) => action.command === './aos permissions setup --once'),
    false,
  );
});

test('stale daemon cleanup outranks stale-TCC terminal handoff in mixed readiness states', () => {
  const current = facts({
    daemon: {
      inputTap: {
        status: 'unavailable',
        attempts: 1,
        listenAccess: false,
      },
    },
    cleanReport: {
      status: 'dirty',
      stale_daemons: [{ pid: 1234 }],
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');
  const rawActions = nextActionsFor(current);

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'stale_daemons');
  assert.equal(verdict.tcc_staleness.id, 'post_rebuild_tcc_stale');
  assert.equal(verdict.terminal_handoff, undefined);
  assert.deepEqual(verdict.next_actions.map((action) => action.command), [
    './aos clean',
    './aos ready --repair',
    './aos ready',
  ]);
  assert.equal(verdict.next_actions.some((action) => action.type === 'manual_tcc_reset'), false);
  assert.deepEqual(rawActions.map((action) => action.command), ['./aos clean', './aos ready --repair', './aos ready']);
  assert.equal(rawActions.some((action) => action.type === 'manual_tcc_reset'), false);
  assert.equal(verdict.notes.some((note) => note.includes('Stale daemon cleanup required')), true);
});

test('linked-worktree runtime policy outranks stale-TCC terminal handoff', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
}, () => {
  const current = facts({
    daemon: {
      inputTap: {
        status: 'unavailable',
        attempts: 1,
        listenAccess: false,
      },
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');
  const rawActions = nextActionsFor(current);

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'agent_os_worktree_default_runtime');
  assert.equal(verdict.tcc_staleness.id, 'post_rebuild_tcc_stale');
  assert.equal(verdict.terminal_handoff, undefined);
  assert.deepEqual(verdict.next_actions.map((action) => action.type), ['manual', 'command']);
  assert.equal(verdict.next_actions.some((action) => action.type === 'manual_tcc_reset'), false);
  assert.deepEqual(rawActions.map((action) => action.type), ['manual', 'command']);
  assert.equal(rawActions.some((action) => action.type === 'manual_tcc_reset'), false);
}));

test('legacy daemon health without microphone state fails closed instead of trusting CLI microphone state', () => {
  const legacyDaemon = daemon({
    inputTap: { listenAccess: undefined, postAccess: undefined },
    permissions: { accessibility: undefined, microphone: undefined, microphoneState: undefined },
  });
  const cli = permissions({ accessibility: true, screen_recording: true });
  const result = evaluateReadyForTesting(legacyDaemon, cli, setup());

  assert.deepEqual(result, { readyForTesting: false, readySource: 'cli' });
  assert.deepEqual(missingPermissionIDsFor(legacyDaemon, cli), ['microphone']);
  assert.equal(disagreementFor(legacyDaemon, cli), undefined);
});

test('ready_for_testing requires each capability permission independently', () => {
  const cases = [
    ['accessibility', daemon({ permissions: { accessibility: false } }), permissions()],
    ['screen_recording', daemon(), permissions({ screen_recording: false })],
    ['listen_access', daemon({ inputTap: { listenAccess: false } }), permissions()],
    ['post_access', daemon({ inputTap: { postAccess: false } }), permissions()],
    ['microphone', daemon({ permissions: { microphone: false, microphoneState: 'denied' } }), permissions()],
  ];

  for (const [name, daemonView, cliView] of cases) {
    assert.deepEqual(
      evaluateReadyForTesting(daemonView, cliView, setup()),
      { readyForTesting: false, readySource: 'daemon' },
      name,
    );
  }
});

test('daemon readiness facts override or fall back to CLI facts per field', () => {
  const partialDaemon = daemon({
    inputTap: { listenAccess: false, postAccess: undefined },
    permissions: { accessibility: undefined },
  });
  assert.deepEqual(
    evaluateReadyForTesting(partialDaemon, permissions(), setup()),
    { readyForTesting: false, readySource: 'daemon' },
  );

  const daemonWithoutPost = daemon({ inputTap: { postAccess: undefined } });
  assert.deepEqual(
    evaluateReadyForTesting(daemonWithoutPost, permissions({ post_access: false }), setup()),
    { readyForTesting: false, readySource: 'daemon' },
  );
});

test('effective permission view is the shared daemon-first readiness projection', () => {
  const daemonView = daemon({
    inputTap: { listenAccess: false, postAccess: undefined },
    permissions: { accessibility: undefined },
  });
  const cliView = permissions({ post_access: false, microphone: false });

  assert.deepEqual(effectivePermissionView(daemonView, cliView), {
    accessibility: true,
    screen_recording: true,
    listen_access: false,
    post_access: false,
    microphone: true,
    microphone_state: 'authorized',
    source: 'daemon',
  });
  assert.deepEqual(missingPermissionIDsFor(daemonView, cliView), [
    'listen_access',
    'post_access',
  ]);
});

test('missing setup marker blocks readiness even when permissions are granted', () => {
  const current = facts({ setup: { marker_exists: false, setup_completed: false } });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const blockers = readyBlockers(current, 'repo');

  assert.equal(evaluation.readyForTesting, false);
  assert.equal(blockers.some((blocker) => blocker.id === 'permissions_onboarding'), true);
  assert.equal(nextActionsFor(current, blockers).some((action) => action.command === 'aos permissions setup --once'), true);
});

test('stale and unmanaged runtime blockers produce cleanup or repair next actions', () => {
  const stale = facts({ cleanReport: { status: 'dirty', stale_daemons: [{ pid: 1234 }] } });
  const staleBlockers = readyBlockers(stale, 'repo');
  assert.equal(staleBlockers.some((blocker) => blocker.id === 'stale_daemons'), true);
  assert.deepEqual(
    nextActionsFor(stale, staleBlockers).map((action) => action.command),
    ['./aos clean', './aos ready --repair', './aos ready'],
  );

  const unmanaged = facts({
    runtime: {
      ownership_state: 'unmanaged',
      owner_pid: 2222,
      owner_process: {
        pid: 2222,
        command_line_status: 'available',
        command_line: './aos serve --idle-timeout 5m',
      },
    },
  });
  const unmanagedBlockers = readyBlockers(unmanaged, 'repo');
  const unmanagedBlocker = unmanagedBlockers.find((blocker) => blocker.id === 'daemon_unmanaged');
  assert.ok(unmanagedBlocker);
  assert.match(unmanagedBlocker.message, /owner pid=2222/);
  assert.match(unmanagedBlocker.message, /command=\.\/aos serve --idle-timeout 5m/);
  assert.deepEqual(
    nextActionsFor(unmanaged, unmanagedBlockers).map((action) => action.command),
    ['./aos clean', './aos ready'],
  );
});

test('default-root foreground dev owner blocks readiness and routes to cleanup', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_ALLOW_FOREGROUND_DEV: undefined,
}, () => {
  const current = facts({
    runtime: {
      ownership_state: 'consistent',
      ownership_kind: 'foreground_dev',
      owner_pid: 3333,
      serving_pid: 3333,
      owner_launchd_managed: false,
      owner_process: {
        pid: 3333,
        command_line_status: 'available',
        command_line: './aos serve --idle-timeout 5m',
      },
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'runtime_blocked');
  assert.equal(verdict.diagnosis, 'daemon_foreground_dev_default');
  assert.equal(verdict.blockers.some((blocker) => blocker.id === 'daemon_foreground_dev_default'), true);
  assert.deepEqual(verdict.cleanup.foreground_dev_owners, []);
  assert.deepEqual(verdict.next_actions.map((action) => action.command), ['./aos clean', './aos ready']);
  assert.equal(verdict.notes.some((note) => note.includes('foreground dev daemon')), true);
}));

test('isolated state-root foreground dev owner remains allowed for isolated runtime proofs', () => withEnv({
  AOS_STATE_ROOT: '/tmp/aos-isolated-state-root',
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_ALLOW_FOREGROUND_DEV: undefined,
}, () => {
  const current = facts({
    runtime: {
      ownership_state: 'consistent',
      ownership_kind: 'foreground_dev',
      owner_pid: 4444,
      serving_pid: 4444,
      owner_launchd_managed: false,
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, true);
  assert.equal(verdict.phase, 'ready');
  assert.equal(verdict.diagnosis, 'ready');
  assert.equal(verdict.blockers.some((blocker) => blocker.id === 'daemon_foreground_dev_default'), false);
}));

test('state-root classified as normal enforces default foreground dev owner blocker', () => withEnv({
  AOS_STATE_ROOT: '/tmp/aos-normal-classified-state-root',
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: '1',
  AOS_ALLOW_FOREGROUND_DEV: undefined,
}, () => {
  const current = facts({
    runtime: {
      ownership_state: 'consistent',
      ownership_kind: 'foreground_dev',
      owner_pid: 5555,
      serving_pid: 5555,
      owner_launchd_managed: false,
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'daemon_foreground_dev_default');
}));

test('default state root does not permit foreground dev owner', () => withEnv({
  HOME: '/tmp/aos-policy-home',
  AOS_STATE_ROOT: '/tmp/aos-policy-home/.config/aos',
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_ALLOW_FOREGROUND_DEV: undefined,
}, () => {
  const current = facts({
    runtime: {
      ownership_state: 'consistent',
      ownership_kind: 'foreground_dev',
      owner_pid: 5556,
      serving_pid: 5556,
      owner_launchd_managed: false,
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'daemon_foreground_dev_default');
}));

test('allow-start does not bypass cleanup-required foreground dev ownership', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_ALLOW_FOREGROUND_DEV: undefined,
}, () => {
  const current = facts({
    runtime: {
      ownership_state: 'consistent',
      ownership_kind: 'foreground_dev',
      owner_pid: 6666,
      serving_pid: 6666,
      owner_launchd_managed: false,
    },
  });
  const guarded = guardedLiveOperation({
    operationId: 'test.foreground-owner',
    allowStart: true,
    mode: 'repo',
    prefix: './aos',
    facts: current,
  });

  assert.equal(guarded.ok, false);
  assert.equal(guarded.failure.blocker, 'daemon_foreground_dev_default');
  assert.equal(guarded.failure.code, 'LIVE_START_NOT_ALLOWED');
}));

test('allow-start still permits absent runtime startup path', () => {
  const current = facts({
    runtime: {
      daemon_running: false,
      socket_reachable: false,
      ownership_state: 'absent',
      ownership_kind: 'absent',
    },
    daemon: null,
  });
  const guarded = guardedLiveOperation({
    operationId: 'test.absent-runtime',
    allowStart: true,
    mode: 'repo',
    prefix: './aos',
    facts: current,
  });

  assert.equal(guarded.ok, true);
  assert.equal(guarded.preflight.ready, false);
  assert.equal(guarded.preflight.diagnosis, 'daemon_socket_unreachable');
});

test('linked git worktrees cannot use the default repo runtime', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
}, () => {
  const current = facts();
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'runtime_blocked');
  assert.equal(verdict.diagnosis, 'agent_os_worktree_default_runtime');
  assert.equal(verdict.blockers.some((blocker) => blocker.id === 'agent_os_worktree_default_runtime'), true);
  assert.deepEqual(verdict.next_actions.map((action) => action.type), ['manual', 'command']);
}));

test('explicit state root permits linked-worktree isolated runtime tests', () => withEnv({
  AOS_STATE_ROOT: '/tmp/aos-linked-worktree-isolated',
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
}, () => {
  const current = facts();
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, true);
  assert.equal(verdict.diagnosis, 'ready');
  assert.equal(verdict.blockers.some((blocker) => blocker.id === 'agent_os_worktree_default_runtime'), false);
}));

test('default state root does not count as linked-worktree isolation', () => withEnv({
  HOME: '/tmp/aos-policy-home',
  AOS_STATE_ROOT: '/tmp/aos-policy-home/.config/aos',
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
}, () => {
  const current = facts();
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'agent_os_worktree_default_runtime');
}));

test('legacy worktree override env does not bypass the default runtime ban', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
  AOS_ALLOW_AGENT_OS_WORKTREE: '1',
}, () => {
  const current = facts();
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'agent_os_worktree_default_runtime');
}));

test('allow-start does not bypass linked-worktree default runtime ban', () => withEnv({
  AOS_STATE_ROOT: undefined,
  AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL: undefined,
  AOS_TEST_FORCE_LINKED_WORKTREE: '1',
}, () => {
  const guarded = guardedLiveOperation({
    operationId: 'test.linked-worktree',
    allowStart: true,
    mode: 'repo',
    prefix: './aos',
    facts: facts(),
  });

  assert.equal(guarded.ok, false);
  assert.equal(guarded.failure.blocker, 'agent_os_worktree_default_runtime');
  assert.equal(guarded.failure.code, 'AGENT_OS_WORKTREE_DEFAULT_RUNTIME');
}));

test('shared runtime verdict carries readiness fields, ownership evidence, cleanup facts, and action plan', () => {
  const current = facts({
    runtime: {
      ownership_state: 'unmanaged',
      ownership_kind: 'unmanaged',
      owner_pid: 2222,
      serving_pid: 2222,
      owner_launchd_managed: false,
      owner_process: {
        pid: 2222,
        command_line_status: 'unavailable',
        command_line_unavailable_reason: 'ps did not return command line for PID 2222',
      },
    },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'runtime_blocked');
  assert.equal(verdict.diagnosis, 'daemon_unmanaged');
  assert.equal(verdict.ownership.owner_process.command_line_status, 'unavailable');
  assert.deepEqual(verdict.cleanup.stale_daemons, []);
  assert.deepEqual(verdict.next_actions.map((action) => action.command), ['./aos clean', './aos ready']);
  assert.equal(verdict.notes.some((note) => note.includes('Do not loop service start/restart or ready repair')), true);
});

test('permissionRequirements keeps public output shape stable', () => {
  assert.deepEqual(
    permissionRequirements(permissions({ screen_recording: false })).map((item) => ({
      id: item.id,
      granted: item.granted,
      required_for: item.required_for,
      setup_trigger: item.setup_trigger,
    })),
    [
      {
        id: 'accessibility',
        granted: true,
        required_for: ['global input tap', 'mouse/keyboard actions', 'AX element actions'],
        setup_trigger: 'AXIsProcessTrustedWithOptions prompt',
      },
      {
        id: 'screen_recording',
        granted: false,
        required_for: ['screen capture', 'perception', 'visual debugging'],
        setup_trigger: 'CGRequestScreenCaptureAccess prompt',
      },
      {
        id: 'listen_access',
        granted: true,
        required_for: ['global input tap', 'input event fan-out', 'hotkeys'],
        setup_trigger: 'CGRequestListenEventAccess prompt',
      },
      {
        id: 'post_access',
        granted: true,
        required_for: ['synthetic events', 'mouse/keyboard actions', 'AX element actions'],
        setup_trigger: 'CGRequestPostEventAccess prompt',
      },
      {
        id: 'microphone',
        granted: true,
        required_for: ['voice dictation', 'local STT capture'],
        setup_trigger: 'daemon AVCaptureDevice.requestAccess(for:.audio) prompt',
      },
    ],
  );
});

test('missing microphone blocks listen and makes ready_for_testing capability-consistent', () => {
  const current = facts({
    daemon: { permissions: { microphone: false, microphoneState: 'denied' } },
    permissions: { microphone: true },
  });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.deepEqual(evaluation, { readyForTesting: false, readySource: 'daemon' });
  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'human_required');
  assert.equal(verdict.ready_for_testing, false);
  assert.deepEqual(verdict.blocked_capabilities, ['listen']);
  assert.deepEqual(missingPermissionIDsFor(current.daemon, current.permissions), ['microphone']);
  assert.equal(
    verdict.blockers.some((blocker) => blocker.id === 'microphone'
      && blocker.scope === 'daemon'
      && blocker.authorization_state === 'denied'),
    true,
  );
  assert.equal(verdict.notes.some((note) => note.includes('Daemon Microphone authorization is denied')), true);
  assert.equal(verdict.tcc_staleness, undefined);
  assert.equal(verdict.next_actions.some((action) => action.command?.includes('reset-runtime')), false);
});

test('daemon microphone authorization states remain distinct in blockers and recovery actions', () => {
  for (const state of ['not_determined', 'restricted', 'denied', 'unknown']) {
    const current = facts({ daemon: { permissions: { microphone: false, microphoneState: state } } });
    const blockers = readyBlockers(current, 'repo');
    const microphone = blockers.find((blocker) => blocker.id === 'microphone');
    const decision = readyDecision(false, blockers, current.daemon, current.permissions);
    const actions = readyNextActions(decision, blockers, current.setup, 'repo', './aos');

    assert.equal(microphone.authorization_state, state);
    assert.equal(microphone.reason, `microphone_${state}`);
    assert.equal(decision.diagnosis, `microphone_${state}`);
    assert.equal(actions.some((action) => action.command?.includes('reset-runtime')), false);
    assert.equal(actions.some((action) => action.command === './aos permissions check --json'), true);
  }
});

test('inconsistent daemon microphone health fails closed with an actionable blocker', () => {
  const current = facts({
    daemon: { permissions: { microphone: false, microphoneState: 'authorized' } },
    permissions: { microphone: true },
  });
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'microphone_state_inconsistent');
  assert.equal(verdict.blockers.some((blocker) => (
    blocker.id === 'microphone' && blocker.reason === 'microphone_state_inconsistent'
  )), true);
  assert.equal(verdict.next_actions.some((action) => action.command === './aos permissions check --json'), true);
  assert.equal(verdict.next_actions.some((action) => action.command?.includes('reset-runtime')), false);
});

test('shared readiness projectors preserve status, doctor, and permissions field shapes', () => {
  const current = facts();
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.deepEqual(statusReadinessProjection(verdict), {
    ready: true,
    status: 'ok',
    phase: 'ready',
    diagnosis: 'ready',
    ready_for_testing: true,
    ready_source: 'daemon',
    blocked_capabilities: [],
  });
  assert.deepEqual(readyEvaluationSnake(evaluation), {
    ready_for_testing: true,
    ready_source: 'daemon',
  });
});

test('setup planner prompts missing permissions in deterministic order', () => {
  const plan = planPermissionSetup({
    initialPermissions: permissions({ accessibility: false, screen_recording: false, listen_access: false, post_access: true }),
    initialSetup: setup({ marker_exists: false, setup_completed: false }),
    initialMissing: ['accessibility', 'screen_recording', 'listen_access'],
    once: true,
    mode: 'repo',
    prefix: './aos',
  });

  assert.equal(plan.branch, 'prompt_missing');
  assert.deepEqual(plan.promptOrder.map((item) => item.primitiveID), ['accessibility', 'screen-recording', 'listen-event']);
  assert.equal(plan.writeMarker, false);
  assert.equal(plan.restartServices, false);
});

test('setup planner includes microphone after core desktop prompts', () => {
  const plan = planPermissionSetup({
    initialPermissions: permissions({ microphone: true }),
    initialSetup: setup({ marker_exists: false, setup_completed: false }),
    initialMissing: ['microphone'],
    once: true,
    mode: 'repo',
    prefix: './aos',
  });

  assert.equal(plan.branch, 'prompt_missing');
  assert.deepEqual(plan.promptOrder.map((item) => item.primitiveID), ['microphone']);
});

test('setup prompt loop stops on failed prompt and reports cancellation note', () => {
  const prompted = [];
  const plan = planPermissionSetup({
    initialPermissions: permissions({ accessibility: false, screen_recording: false }),
    initialSetup: setup({ marker_exists: false, setup_completed: false }),
    initialMissing: ['accessibility', 'screen_recording'],
    once: true,
    mode: 'repo',
    prefix: './aos',
  });
  const notes = runSetupPromptPlan({
    plan,
    prompt: (item) => {
      prompted.push(item.permissionID);
      return { granted: item.permissionID !== 'screen_recording' };
    },
  });

  assert.deepEqual(prompted, ['accessibility', 'screen_recording']);
  assert.deepEqual(notes, ['screen_recording permission setup was cancelled before completion.']);
});

test('setup planner writes marker and restarts services only after final effective view is complete', () => {
  const plan = planPermissionSetup({
    initialPermissions: permissions(),
    initialSetup: setup({ marker_exists: false, setup_completed: false }),
    initialMissing: [],
    once: true,
    mode: 'repo',
    prefix: './aos',
  });

  assert.equal(plan.branch, 'record_marker_without_prompts');
  assert.equal(plan.writeMarker, true);
  assert.equal(plan.restartServices, true);
  assert.equal(plan.completed, true);
});

test('setup planner preserves already-granted skip branch', () => {
  const plan = planPermissionSetup({
    initialPermissions: permissions(),
    initialSetup: setup(),
    initialMissing: [],
    once: true,
    mode: 'repo',
    prefix: './aos',
  });

  assert.deepEqual(plan, {
    branch: 'already_complete',
    status: 'ok',
    completed: true,
    promptOrder: [],
    writeMarker: false,
    restartServices: false,
    notes: ['Permissions are already granted; onboarding was skipped.'],
  });
});

test('input monitoring guidance accepts daemon camelCase and runtime snake_case tap facts', () => {
  assert.match(inputMonitoringSubGuidance({ listenAccess: false, postAccess: true }, '/repo/aos'), /listen=false, post=true/);
  assert.match(inputMonitoringSubGuidance({ listen_access: true, post_access: false }, '/repo/aos'), /listen=true, post=false/);
});

test('plain and post-permission readiness stop without mutation', () => {
  const response = {
    ready: false,
    mode: 'repo',
    diagnosis: 'input_tap_not_active',
    blockers: [{ id: 'input_tap_not_active', kind: 'runtime' }],
    action_trace: [],
  };
  const plain = nextReadyExecutionStep(response);
  const postPermission = nextReadyExecutionStep(response, { postPermission: true });

  for (const step of [plain, postPermission]) {
    assert.equal(step.type, 'stop');
    assert.equal(step.trace.result, 'diagnosed');
    assert.match(step.trace.detail, /read-only; no runtime mutation attempted/);
  }
});

test('repair execution planner owns cleanup, startup, restart, and permission handoff transitions', () => {
  const response = (id, actionTrace = [], kind = 'runtime') => ({
    ready: false,
    mode: 'repo',
    diagnosis: id,
    blockers: [{ id, kind }],
    action_trace: actionTrace,
  });

  assert.equal(nextReadyExecutionStep(response('input_tap_not_active'), { repair: true }).type, 'start');
  assert.equal(nextReadyExecutionStep(response('stale_daemons'), { repair: true }).type, 'clean');
  assert.equal(
    nextReadyExecutionStep(response('stale_daemons', [{ step: 'clean', result: 'ok' }]), { repair: true }).type,
    'stop',
  );
  assert.equal(
    nextReadyExecutionStep(response('input_tap_not_active', [{ step: 'service_start', result: 'ok' }]), { repair: true }).type,
    'restart',
  );
  assert.equal(
    nextReadyExecutionStep(response('daemon_unreachable', [{ step: 'clean', result: 'ok' }]), { repair: true }).type,
    'restart',
  );

  const microphoneStop = nextReadyExecutionStep(
    response('microphone', [{ step: 'service_start', result: 'ok' }], 'permission'),
    { repair: true, prefix: './aos', mode: 'repo' },
  );
  assert.deepEqual(microphoneStop, { type: 'stop' });

  const unmanaged = nextReadyExecutionStep(response('daemon_unmanaged'), { repair: true });
  assert.equal(unmanaged.type, 'stop');
  assert.equal(unmanaged.trace.result, 'runtime_policy_blocked');
});

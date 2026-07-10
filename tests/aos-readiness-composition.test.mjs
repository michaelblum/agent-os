import assert from 'node:assert/strict';
import test from 'node:test';

import { setupState } from '../scripts/lib/aos-facts.mjs';
import { guardedLiveOperation } from '../scripts/lib/aos-live-operation.mjs';
import {
  disagreementFor,
  evaluateReadyForTesting,
  hasRestartableReadyRuntimeBlocker,
  inputMonitoringSubGuidance,
  missingPermissionIDsFor,
  permissionRequirements,
  planPermissionSetup,
  readyAutoRepairReason,
  readyBlockers,
  readyEvaluationSnake,
  readyNextActions,
  runtimeVerdict,
  runSetupPromptPlan,
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

test('daemon-active ready path uses daemon source with setup complete and screen recording granted', () => {
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
    readyNextActions(blockers, current.setup, 'repo', './aos').map((action) => action.command),
    ['./aos ready --repair', './aos service restart --mode repo', './aos ready'],
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
    './aos ready --post-permission',
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
    resume_command: './aos ready --post-permission',
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
      label: 'after the user says finished, run the bounded post-permission readiness check',
      command: './aos ready --post-permission',
      after_user_signal: 'finished',
    },
  ]);
  assert.equal(
    verdict.notes.some((note) => note.includes('passive checks pass, but live privileged access fails after a rebuild')),
    true,
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

  assert.equal(verdict.ready, false);
  assert.equal(verdict.diagnosis, 'agent_os_worktree_default_runtime');
  assert.equal(verdict.tcc_staleness.id, 'post_rebuild_tcc_stale');
  assert.equal(verdict.terminal_handoff, undefined);
  assert.deepEqual(verdict.next_actions.map((action) => action.type), ['manual', 'command']);
  assert.equal(verdict.next_actions.some((action) => action.type === 'manual_tcc_reset'), false);
}));

test('legacy daemon health without access fields falls back to CLI permission view', () => {
  const legacyDaemon = daemon({
    inputTap: { listenAccess: undefined, postAccess: undefined },
    permissions: { accessibility: undefined },
  });
  const cli = permissions({ accessibility: true, screen_recording: true });
  const result = evaluateReadyForTesting(legacyDaemon, cli, setup());

  assert.deepEqual(result, { readyForTesting: true, readySource: 'cli' });
  assert.deepEqual(missingPermissionIDsFor(legacyDaemon, cli), []);
  assert.equal(disagreementFor(legacyDaemon, cli), undefined);
});

test('missing setup marker blocks readiness even when permissions are granted', () => {
  const current = facts({ setup: { marker_exists: false, setup_completed: false } });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const blockers = readyBlockers(current, 'repo');

  assert.equal(evaluation.readyForTesting, false);
  assert.equal(blockers.some((blocker) => blocker.id === 'permissions_onboarding'), true);
  assert.equal(readyNextActions(blockers, current.setup, 'repo', './aos').some((action) => action.command === 'aos permissions setup --once'), true);
});

test('stale and unmanaged runtime blockers produce cleanup or repair next actions', () => {
  const stale = facts({ cleanReport: { status: 'dirty', stale_daemons: [{ pid: 1234 }] } });
  const staleBlockers = readyBlockers(stale, 'repo');
  assert.equal(staleBlockers.some((blocker) => blocker.id === 'stale_daemons'), true);
  assert.deepEqual(
    readyNextActions(staleBlockers, stale.setup, 'repo', './aos').map((action) => action.command),
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
    readyNextActions(unmanagedBlockers, unmanaged.setup, 'repo', './aos').map((action) => action.command),
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
        setup_trigger: 'AVCaptureDevice.requestAccess(for:.audio) prompt',
      },
    ],
  );
});

test('missing microphone blocks listen without changing daemon readiness source', () => {
  const current = facts({ permissions: { microphone: false } });
  const evaluation = evaluateReadyForTesting(current.daemon, current.permissions, current.setup);
  const verdict = runtimeVerdict(current, 'repo', './aos');

  assert.deepEqual(evaluation, { readyForTesting: true, readySource: 'daemon' });
  assert.equal(verdict.ready, false);
  assert.equal(verdict.phase, 'human_required');
  assert.deepEqual(verdict.blocked_capabilities, ['listen']);
  assert.deepEqual(missingPermissionIDsFor(current.daemon, current.permissions), ['microphone']);
  assert.equal(
    verdict.blockers.some((blocker) => blocker.id === 'microphone' && blocker.scope === 'cli'),
    true,
  );
  assert.equal(verdict.notes.some((note) => note.includes('Microphone permission is not granted')), true);
});

test('one shared readiness verdict feeds camelCase and snake_case public surfaces', () => {
  const verdict = evaluateReadyForTesting(daemon(), permissions(), setup());
  const readySurface = { ready_source: verdict.readySource };
  const doctorSurface = { ready_for_testing: verdict.readyForTesting, ready_source: verdict.readySource };
  const permissionsSurface = readyEvaluationSnake(verdict);

  assert.deepEqual(readySurface, { ready_source: 'daemon' });
  assert.deepEqual(doctorSurface, { ready_for_testing: true, ready_source: 'daemon' });
  assert.deepEqual(permissionsSurface, { ready_for_testing: true, ready_source: 'daemon' });
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
    initialPermissions: permissions({ microphone: false }),
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

test('setup planner writes marker and restarts services only after final CLI view is complete', () => {
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

test('ready auto-repair reason stays null for ready, stale, and unmanaged states', () => {
  assert.equal(readyAutoRepairReason({ ready: true, blockers: [] }), null);
  assert.equal(readyAutoRepairReason({ ready: false, blockers: [{ id: 'stale_daemons', kind: 'runtime' }] }), null);
  assert.equal(readyAutoRepairReason({ ready: false, blockers: [{ id: 'daemon_unmanaged', kind: 'runtime' }] }), null);
  assert.equal(readyAutoRepairReason({
    ready: false,
    blockers: [
      { id: 'input_tap_not_active', kind: 'runtime' },
      { id: 'input_monitoring_listen', kind: 'permission', reason: 'post_rebuild_tcc_stale' },
    ],
  }), null);
});

test('ready auto-repair reason is deterministic for ownership and input-tap blockers', () => {
  assert.equal(
    readyAutoRepairReason({ ready: false, blockers: [{ id: 'daemon_ownership_mismatch', kind: 'runtime' }] }),
    'automatic after daemon ownership mismatch',
  );
  assert.equal(
    readyAutoRepairReason({ ready: false, blockers: [{ id: 'input_tap_not_active', kind: 'runtime' }] }),
    'automatic after input tap inactive',
  );
});

test('post-permission readiness enables bounded restart for repairable runtime blockers', () => {
  assert.equal(
    readyAutoRepairReason(
      { ready: false, blockers: [{ id: 'daemon_unreachable', kind: 'runtime' }] },
      { postPermission: true },
    ),
    'post-permission bounded daemon restart/recheck',
  );
});

test('ready restart predicate is explicit and excludes stale daemon cleanup', () => {
  assert.equal(
    hasRestartableReadyRuntimeBlocker({ ready: false, blockers: [{ id: 'input_tap_not_active', kind: 'runtime' }] }),
    true,
  );
  assert.equal(
    hasRestartableReadyRuntimeBlocker({ ready: false, blockers: [{ id: 'stale_daemons', kind: 'runtime' }] }),
    false,
  );
  assert.equal(
    hasRestartableReadyRuntimeBlocker({
      ready: false,
      blockers: [
        { id: 'stale_daemons', kind: 'runtime' },
        { id: 'input_tap_not_active', kind: 'runtime' },
      ],
    }),
    false,
  );
});

import fs from 'node:fs';
import path from 'node:path';
import {
  SAFE_ID,
  SCHEMA_VERSION,
  agentWorkspacesRoot,
  defaultWorkspaceMetadata,
  exitAgentWorkspaceError,
  printJSON,
  runtimeMode,
  stateRoot,
  validateLocalID,
  workspaceID,
  workspaceDir,
} from './core.mjs';
import {
  deleteSnapshot,
  deleteWorkspace,
  loadWorkspaceIndex,
  loadSnapshot,
  pruneSnapshots,
  requireWorkspace,
  workspaceLockState,
} from './store.mjs';
import { queryMatches, refSummary } from './refs.mjs';
import { compactNextRecommendations } from './recommendations.mjs';

const AGENT_WORKSPACE_FLAG_KINDS = new Map([
  ['--json', 'bool'],
  ['--dry-run', 'bool'],
  ['--i-understand-local-artifacts', 'bool'],
  ['--workspace', 'value'],
  ['--snapshot', 'value'],
  ['--diff', 'value'],
  ['--expect', 'value'],
  ['--expect-ref', 'value'],
  ['--query', 'value'],
  ['--older-than', 'value'],
]);

const AGENT_WORKSPACE_FLAGS = {
  workspaces: new Set(['--json']),
  snapshots: new Set(['--workspace', '--json']),
  refs: new Set(['--workspace', '--snapshot', '--diff', '--expect', '--expect-ref', '--query', '--json']),
  workspace: new Set(['--json']),
  workspacePrune: new Set(['--older-than', '--dry-run', '--i-understand-local-artifacts', '--json']),
  workspaceDelete: new Set(['--i-understand-local-artifacts', '--json']),
  snapshotDelete: new Set(['--workspace', '--i-understand-local-artifacts', '--json']),
};

function parseReadArgs(args, {
  requireID = false,
  allowID = requireID,
  workspaceMode = 'default',
  allowedFlags = AGENT_WORKSPACE_FLAGS.refs,
  env = process.env,
} = {}) {
  let id = null;
  let workspace = null;
  let snapshot = null;
  let diff = null;
  let expect = null;
  const expectRefs = [];
  let query = null;
  let json = false;
  let dryRun = false;
  let acknowledge = false;
  let olderThan = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const flagKind = AGENT_WORKSPACE_FLAG_KINDS.get(arg);
      if (!flagKind || !allowedFlags.has(arg)) {
        exitAgentWorkspaceError(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
      }
      if (flagKind === 'bool') {
        if (arg === '--json') json = true;
        if (arg === '--dry-run') dryRun = true;
        if (arg === '--i-understand-local-artifacts') acknowledge = true;
        continue;
      }
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError(`${arg} requires a value`, 'MISSING_ARG');
      }
      if (arg === '--workspace') workspace = args[i + 1];
      if (arg === '--snapshot') snapshot = args[i + 1];
      if (arg === '--diff') diff = args[i + 1];
      if (arg === '--expect') expect = args[i + 1];
      if (arg === '--expect-ref') expectRefs.push(args[i + 1]);
      if (arg === '--query') query = args[i + 1];
      if (arg === '--older-than') olderThan = args[i + 1];
      i += 1;
      continue;
    }
    if (!allowID) {
      exitAgentWorkspaceError(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
    }
    if (id) {
      exitAgentWorkspaceError(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
    }
    id = arg;
  }
  if (requireID && !id) exitAgentWorkspaceError('Missing id', 'MISSING_ARG');
  const resolvedWorkspace = workspaceMode === 'none'
    ? null
    : (workspaceMode === 'explicit'
      ? (workspace === null ? null : validateLocalID(workspace, 'workspace id'))
      : workspaceID(workspace, env));
  return {
    id,
    workspace: resolvedWorkspace,
    snapshot: snapshot ? validateLocalID(snapshot, 'snapshot id') : null,
    diff,
    expect,
    expectRefs,
    query,
    json,
    dryRun,
    acknowledge,
    olderThan,
  };
}

const REF_DIFF_EXPECTATION_STATES = new Set(['added', 'removed', 'changed', 'unchanged', 'present', 'missing']);

function parseDiffExpectation(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!['change', 'no-change'].includes(normalized)) {
    exitAgentWorkspaceError('--expect must be change or no-change', 'INVALID_ARG');
  }
  return normalized;
}

function parseRefDiffExpectation(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const separatorIndex = raw.lastIndexOf('=');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    exitAgentWorkspaceError('--expect-ref must use <ref>=added|removed|changed|unchanged|present|missing', 'INVALID_ARG');
  }
  const ref = validateLocalID(raw.slice(0, separatorIndex), 'ref id');
  const expectedState = raw.slice(separatorIndex + 1);
  if (!REF_DIFF_EXPECTATION_STATES.has(expectedState)) {
    exitAgentWorkspaceError('--expect-ref must use added, removed, changed, unchanged, present, or missing', 'INVALID_ARG');
  }
  return {
    ref,
    expected_state: expectedState,
  };
}

function parseSnapshotDiff(value) {
  const raw = String(value ?? '');
  const parts = raw.split('..');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    exitAgentWorkspaceError('--diff must use <from-snapshot>..<to-snapshot>', 'INVALID_ARG');
  }
  return {
    from: validateLocalID(parts[0], 'from snapshot id'),
    to: validateLocalID(parts[1], 'to snapshot id'),
  };
}

function stableRefFingerprint(ref) {
  const identityFacts = { ...(ref.identity_facts ?? {}) };
  delete identityFacts.state_id;
  return JSON.stringify({
    backend: ref.backend,
    resolution_class: ref.resolution_class,
    confidence: ref.confidence,
    supported_actions: ref.supported_actions,
    identity_facts: identityFacts,
    hint_facts: ref.hint_facts,
    current_address: ref.current_address,
    warnings: ref.warnings,
    known_limits: ref.known_limits,
    conformance: ref.conformance,
  });
}

function refsByID(refs) {
  return new Map(refs.map((ref) => [ref.ref, ref]));
}

function compactRefsDiff(fromRefs, toRefs) {
  const from = refsByID(fromRefs);
  const to = refsByID(toRefs);
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const [ref, toRecord] of to) {
    const fromRecord = from.get(ref);
    if (!fromRecord) {
      added.push(toRecord);
      continue;
    }
    if (stableRefFingerprint(fromRecord) === stableRefFingerprint(toRecord)) {
      unchanged.push(toRecord);
    } else {
      changed.push({ ref, before: fromRecord, after: toRecord });
    }
  }

  for (const [ref, fromRecord] of from) {
    if (!to.has(ref)) removed.push(fromRecord);
  }

  return {
    counts: {
      from_refs: fromRefs.length,
      to_refs: toRefs.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
    },
    added,
    removed,
    changed,
    unchanged,
  };
}

function refsDiffHasChange(comparison) {
  return (comparison.counts.added + comparison.counts.removed + comparison.counts.changed) > 0;
}

function refsDiffExpectation(expectation, comparison) {
  if (!expectation) return null;
  const actualChange = refsDiffHasChange(comparison);
  const expectedChange = expectation === 'change';
  return {
    mode: expectation,
    status: actualChange === expectedChange ? 'passed' : 'failed',
    expected_change: expectedChange,
    actual_change: actualChange,
  };
}

function refsDiffRefState(ref, comparison) {
  if (comparison.added.some((record) => record.ref === ref)) return 'added';
  if (comparison.removed.some((record) => record.ref === ref)) return 'removed';
  if (comparison.changed.some((record) => record.ref === ref)) return 'changed';
  if (comparison.unchanged.some((record) => record.ref === ref)) return 'unchanged';
  return 'missing';
}

function refsDiffRefExpectation(expectation, comparison) {
  if (!expectation) return null;
  const actualState = refsDiffRefState(expectation.ref, comparison);
  const expectedState = expectation.expected_state;
  const passed = expectedState === 'present'
    ? actualState !== 'missing' && actualState !== 'removed'
    : expectedState === 'missing'
      ? actualState === 'missing' || actualState === 'removed'
      : actualState === expectedState;
  return {
    ref: expectation.ref,
    mode: expectedState,
    status: passed ? 'passed' : 'failed',
    expected_state: expectedState,
    actual_state: actualState,
  };
}

function refsDiffRefExpectations(expectations, comparison) {
  return expectations.map((expectation) => refsDiffRefExpectation(expectation, comparison));
}

function diffExpectationFailed(expectation, refExpectations) {
  return expectation?.status === 'failed' || refExpectations.some((item) => item.status === 'failed');
}

function assertWorkspaceListState(value, file, label) {
  if (!value) return;
  if (typeof value !== 'object' || Array.isArray(value) || value.schema_version !== SCHEMA_VERSION) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

export function workspacesCommand(args, env = process.env) {
  parseReadArgs(args, { workspaceMode: 'none', allowedFlags: AGENT_WORKSPACE_FLAGS.workspaces, env });
  const root = agentWorkspacesRoot(env);
  const workspaces = [];
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!SAFE_ID.test(entry.name)) continue;
      const metadataPath = path.join(root, entry.name, 'workspace.json');
      const indexPath = path.join(root, entry.name, 'index.json');
      const loaded = fs.existsSync(metadataPath) ? loadWorkspaceIndex(entry.name, env) : { metadata: null, index: null };
      const metadata = loaded.metadata;
      const index = loaded.index;
      assertWorkspaceListState(metadata, metadataPath, 'workspace metadata');
      assertWorkspaceListState(index, indexPath, 'workspace index');
      workspaces.push({
        workspace_id: entry.name,
        current_snapshot_id: index?.current_snapshot_id ?? null,
        snapshot_count: index?.snapshots?.length ?? 0,
        updated_at: index?.updated_at ?? metadata?.updated_at ?? null,
        path: path.join(root, entry.name),
      });
    }
  }
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    workspaces: workspaces.sort((a, b) => String(a.workspace_id).localeCompare(String(b.workspace_id))),
  });
}

export function snapshotsCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, { allowedFlags: AGENT_WORKSPACE_FLAGS.snapshots, env });
  const { index } = requireWorkspace(parsed.workspace, env);
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    runtime_mode: runtimeMode(env),
    current_snapshot_id: index.current_snapshot_id ?? null,
    snapshots: index.snapshots ?? [],
  });
}

export function refsCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, { allowedFlags: AGENT_WORKSPACE_FLAGS.refs, env });
  if (parsed.diff && parsed.snapshot) {
    exitAgentWorkspaceError('--diff cannot be combined with --snapshot', 'INVALID_ARG');
  }
  const { index } = requireWorkspace(parsed.workspace, env);
  if (parsed.diff) {
    const diff = parseSnapshotDiff(parsed.diff);
    const expectationMode = parseDiffExpectation(parsed.expect);
    const refExpectationModes = parsed.expectRefs.map(parseRefDiffExpectation);
    const fromLoaded = loadSnapshot(parsed.workspace, diff.from, env);
    const toLoaded = loadSnapshot(parsed.workspace, diff.to, env);
    const fromRefs = (fromLoaded.refs.refs ?? []).filter((record) => queryMatches(record, parsed.query)).map(refSummary);
    const toRefs = (toLoaded.refs.refs ?? []).filter((record) => queryMatches(record, parsed.query)).map(refSummary);
    const comparison = compactRefsDiff(fromRefs, toRefs);
    const expectation = refsDiffExpectation(expectationMode, comparison);
    const refExpectations = refsDiffRefExpectations(refExpectationModes, comparison);
    const nextRecommendations = compactNextRecommendations(parsed.workspace, diff.to, toRefs, env);
    const payload = {
      status: 'success',
      schema_version: SCHEMA_VERSION,
      workspace_id: parsed.workspace,
      runtime_mode: runtimeMode(env),
      snapshot_id: diff.to,
      query: parsed.query,
      diff: {
        from_snapshot_id: diff.from,
        to_snapshot_id: diff.to,
        ...(expectation ? { expectation } : {}),
        ...(refExpectations.length === 1 ? { ref_expectation: refExpectations[0] } : {}),
        ...(refExpectations.length > 1 ? { ref_expectations: refExpectations } : {}),
        ...comparison,
      },
      refs: toRefs,
      recommended_next: nextRecommendations,
      recommended_next_commands: nextRecommendations.map((recommendation) => recommendation.command),
    };
    if (diffExpectationFailed(expectation, refExpectations)) {
      const failedRefExpectation = refExpectations.find((item) => item.status === 'failed');
      const expected = failedRefExpectation
        ? `${failedRefExpectation.ref}=${failedRefExpectation.mode}`
        : expectation.mode;
      exitAgentWorkspaceError(`refs diff expectation failed: expected ${expected}`, 'REF_DIFF_EXPECTATION_FAILED', {
        status: 'expectation_failed',
        schema_version: SCHEMA_VERSION,
        workspace_id: parsed.workspace,
        runtime_mode: runtimeMode(env),
        snapshot_id: diff.to,
        query: parsed.query,
        diff: payload.diff,
        refs: toRefs,
        recommended_next: nextRecommendations,
        recommended_next_commands: nextRecommendations.map((recommendation) => recommendation.command),
      });
    }
    printJSON(payload);
    return;
  }
  if (parsed.expect || parsed.expectRefs.length) {
    exitAgentWorkspaceError('--expect and --expect-ref require --diff', 'INVALID_ARG');
  }
  const snapshotIDs = parsed.snapshot
    ? [parsed.snapshot]
    : [index.current_snapshot_id].filter(Boolean);
  const refs = [];
  for (const snap of snapshotIDs) {
    const loaded = loadSnapshot(parsed.workspace, snap, env);
    refs.push(...(loaded.refs.refs ?? []).filter((record) => queryMatches(record, parsed.query)).map(refSummary));
  }
  const nextRecommendations = parsed.snapshot || index.current_snapshot_id
    ? compactNextRecommendations(parsed.workspace, parsed.snapshot ?? index.current_snapshot_id, refs, env)
    : [];
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    runtime_mode: runtimeMode(env),
    snapshot_id: parsed.snapshot ?? index.current_snapshot_id ?? null,
    query: parsed.query,
    refs,
    recommended_next: nextRecommendations,
    recommended_next_commands: nextRecommendations.map((recommendation) => recommendation.command),
  });
}

export function workspaceCommand(args, env = process.env) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'delete') return deleteWorkspaceCommand(rest, env);
  if (subcommand === 'prune') return pruneWorkspaceCommand(rest, env);
  const parsed = parseReadArgs(args, {
    requireID: true,
    workspaceMode: 'none',
    allowedFlags: AGENT_WORKSPACE_FLAGS.workspace,
    env,
  });
  const workspace = validateLocalID(parsed.id, 'workspace id');
  const { dir, metadata, index } = requireWorkspace(workspace, env);
  const currentSnapshot = (index.snapshots ?? []).find((snapshot) => snapshot.snapshot_id === index.current_snapshot_id) ?? null;
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    path: dir,
    metadata,
    index_health: {
      current_snapshot_id: index.current_snapshot_id ?? null,
      snapshot_count: index.snapshots?.length ?? 0,
      current_snapshot: currentSnapshot,
      warnings: [],
    },
    retention: metadata.retention ?? defaultWorkspaceMetadata(workspace, env).retention,
    lock_state: workspaceLockState(dir),
  });
}

function deleteWorkspaceCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, {
    requireID: true,
    workspaceMode: 'none',
    allowedFlags: AGENT_WORKSPACE_FLAGS.workspaceDelete,
    env,
  });
  const workspace = validateLocalID(parsed.id, 'workspace id');
  if (!parsed.acknowledge) {
    exitAgentWorkspaceError('workspace delete requires --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const { dir, bytes } = deleteWorkspace(workspace, env);
  printJSON({
    status: 'deleted',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    path: dir,
    bytes_reclaimed: bytes,
  });
}

function parseDurationMs(value) {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(String(value || ''));
  if (!match) exitAgentWorkspaceError('--older-than must be a duration such as 7d, 12h, 30m, or 60s', 'INVALID_ARG');
  const n = Number(match[1]);
  const unit = match[2] || 's';
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
}

function pruneWorkspaceCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, {
    requireID: true,
    workspaceMode: 'none',
    allowedFlags: AGENT_WORKSPACE_FLAGS.workspacePrune,
    env,
  });
  if (!parsed.olderThan) exitAgentWorkspaceError('workspace prune requires --older-than <duration>', 'MISSING_ARG');
  if (!parsed.dryRun && !parsed.acknowledge) {
    exitAgentWorkspaceError('workspace prune requires --dry-run or --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const workspace = validateLocalID(parsed.id, 'workspace id');
  const { index } = requireWorkspace(workspace, env);
  const threshold = Date.now() - parseDurationMs(parsed.olderThan);
  const candidates = (index.snapshots ?? []).filter((snapshot) => {
    const created = Date.parse(snapshot.created_at ?? '');
    return Number.isFinite(created) && created < threshold;
  });
  const { removed, bytes } = pruneSnapshots(workspace, candidates, { dryRun: parsed.dryRun }, env);
  printJSON({
    status: parsed.dryRun ? 'dry_run' : 'pruned',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    older_than: parsed.olderThan,
    removed,
    bytes_reclaimed: bytes,
  });
}

export function snapshotCommand(args, env = process.env) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'delete') {
    exitAgentWorkspaceError(`Unknown snapshot subcommand: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
  const parsed = parseReadArgs(rest, {
    requireID: true,
    allowedFlags: AGENT_WORKSPACE_FLAGS.snapshotDelete,
    env,
  });
  if (!parsed.acknowledge) {
    exitAgentWorkspaceError('snapshot delete requires --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const snapshot = validateLocalID(parsed.id, 'snapshot id');
  const { snapshotDir, bytes } = deleteSnapshot(parsed.workspace, snapshot, env);
  printJSON({
    status: 'deleted',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    snapshot_id: snapshot,
    path: snapshotDir,
    bytes_reclaimed: bytes,
  });
}

export function agentWorkspaceCLI(argv, env = process.env) {
  const [command, ...args] = argv;
  switch (command) {
    case 'workspaces':
      return workspacesCommand(args, env);
    case 'snapshots':
      return snapshotsCommand(args, env);
    case 'refs':
      return refsCommand(args, env);
    case 'workspace':
      return workspaceCommand(args, env);
    case 'snapshot':
      return snapshotCommand(args, env);
    default:
      exitAgentWorkspaceError(`Unknown agent workspace command: ${command ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
}

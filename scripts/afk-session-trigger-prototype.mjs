#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createLaunchAttempt } from './afk-launch-attempt-prototype.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'gemini']);
const NOT_OBSERVED = 'not_observed';
const NOT_ATTEMPTED = 'not_attempted';
const LOCAL_ARTIFACT_PATH = 'local_artifact_path';
const LIVE_TERMINAL_STATES = new Set([
  'accepted',
  'accepted_pre_launch',
  'terminal',
  'terminal_started',
  'running',
  'observed',
  'provider_acceptance_unobserved',
  'provider_acceptance_observed',
  'provider_session_observed',
  'completed',
]);
const RELAUNCH_REQUIRES_REPLACEMENT_STATES = new Set(['rejected', 'failed', 'expired', 'blocked']);

function usage() {
  return `Experimental AFK session-trigger dry-run prototype.

Usage:
  node scripts/afk-session-trigger-prototype.mjs --packet <packet.json> (--dry-run|--supervised-live-launch --i-am-present --json|--sleep-lease-live-launch --sleep-lease <lease.json> --json --out <receipt.json>|--warm-dock-tui-reuse --json) [--sleep-lease <lease.json>] [--provider <name>] [--dock <dock>] [--repo <path>] [--timestamp <iso>] [--out <path>] [--result-route <ref>] [--idempotence-salt <value>] [--existing-receipt <path>] [--replacement-for <id>] [--bridge-visibility-fixture <path>] [--cleanup-proof-fixture <path>] [--provider-session-id <id>] [--launch-observed-at <iso>] [--codex-home-fixture <path>|--codex-home <path>]

This local prototype validates one transfer packet and emits a scheduler/dispatch receipt. The guarded supervised-live path can consume deterministic bridge/provider fixtures and does not launch live providers, gateways, or result routes during tests.`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--supervised-live-launch') {
      options.supervisedLiveLaunch = true;
      continue;
    }
    if (arg === '--sleep-lease-live-launch') {
      options.sleepLeaseLiveLaunch = true;
      continue;
    }
    if (arg === '--warm-dock-tui-reuse') {
      options.warmDockTuiReuse = true;
      continue;
    }
    if (arg === '--i-am-present') {
      options.iAmPresent = true;
      continue;
    }
    if (arg === '--provider-launch-dry-run') {
      options.providerLaunchDryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    options[key] = value;
  }

  return options;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: `git ${args.join(' ')}`,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function resolveRepoRoot(startPath) {
  const cwd = resolve(startPath ?? process.cwd());
  if (!existsSync(cwd)) {
    throw Object.assign(new Error(`Repo path does not exist: ${cwd}`), { mismatchClass: 'repo_missing' });
  }
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw Object.assign(
      new Error(`Unable to resolve repo root from ${cwd}: ${result.stderr || 'git rev-parse failed'}`),
      { mismatchClass: 'repo_missing' },
    );
  }
  return resolve(result.stdout);
}

function stableHash(value, length = 16) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

async function readJsonFile(path, label) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON in ${label} ${path}: ${error.message}`), {
      mismatchClass: 'invalid_packet_json',
    });
  }
}

function repoPath(repoRoot, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(repoRoot, candidate);
}

function isWithinRepo(repoRoot, candidate) {
  const rel = relative(repoRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function relIfRepo(repoRoot, candidate) {
  return candidate && isWithinRepo(repoRoot, candidate) ? relative(repoRoot, candidate) || '.' : candidate;
}

function normalizePacketId(packet) {
  return packet.packet_id ?? packet.packetId ?? packet.packet_ref ?? packet.packetRef ?? packet.id ?? packet.ref;
}

function normalizeSourceArtifact(packet) {
  return packet.source_artifact ?? packet.sourceArtifact ?? packet.source_event?.artifact ?? packet.sourceEvent?.artifact;
}

function normalizeRequestedDock(packet) {
  return packet.requested_recipient ?? packet.requestedRecipient ?? packet.dock;
}

function normalizeProviderHint(packet) {
  return packet.provider_hint ?? packet.providerHint ?? packet.provider;
}

function normalizeRef(packet) {
  return packet.required_start_ref ?? packet.requiredStartRef ?? packet.start_ref ?? packet.startRef;
}

function normalizeWorktree(packet, repoRoot) {
  return repoPath(repoRoot, packet.worktree ?? packet.cwd ?? repoRoot);
}

function normalizeResultRoutes(packet, override) {
  const route = packet.result_route ?? packet.resultRoute ?? packet.result_routes ?? packet.resultRoutes;
  const configuredRoutes = Array.isArray(route) ? route : (route ? [route] : []);
  const routes = configuredRoutes.length > 0 ? configuredRoutes : (override ? [override] : []);
  return routes.map(normalizeResultRoute);
}

function normalizeResultRoute(route) {
  if (typeof route === 'string') {
    return { kind: LOCAL_ARTIFACT_PATH, ref: route };
  }
  if (!route || typeof route !== 'object') {
    return route;
  }

  const kind = route.kind;
  const ref = route.ref ?? route.path ?? route.artifact_path ?? route.artifactPath;
  if ((kind === 'stdout' || kind === undefined) && ref === undefined) {
    return kind === 'stdout' ? { ...route, kind: LOCAL_ARTIFACT_PATH, ref: 'stdout' } : route;
  }
  if ((kind === 'stdout' || kind === undefined) && ref === 'stdout') {
    return { ...route, kind: LOCAL_ARTIFACT_PATH, ref: 'stdout' };
  }
  return route;
}

function classifyLocalResultRoutes({ repoRoot, routes, stdoutDelivered = false, outPath = null, outWriteConfirmed = false }) {
  const attemptRefs = [];
  const deliveredRefs = [];
  const failures = [];
  const resolvedOutPath = outPath ? resolve(outPath) : null;

  for (const route of routes) {
    const kind = route?.kind ?? NOT_OBSERVED;
    const ref = route?.ref ?? route?.path ?? route?.artifact_path ?? route?.artifactPath ?? NOT_OBSERVED;
    const routeRef = typeof route === 'object' && route !== null ? { ...route, ref } : { kind, ref };
    attemptRefs.push(routeRef);

    if (kind !== LOCAL_ARTIFACT_PATH) {
      failures.push({
        route: routeRef,
        code: 'result_route_unsupported',
        reason: `Unsupported result route kind: ${kind}`,
      });
      continue;
    }
    if (ref === 'stdout') {
      if (stdoutDelivered) {
        deliveredRefs.push(routeRef);
      } else {
        failures.push({
          route: routeRef,
          code: 'result_route_stdout_not_emitted',
          reason: 'stdout route was configured but stdout emission was not confirmed',
        });
      }
      continue;
    }

    const resolvedRef = repoPath(repoRoot, ref);
    if (!resolvedRef) {
      failures.push({
        route: routeRef,
        code: 'result_route_ref_missing',
        reason: 'local_artifact_path route did not include ref/path',
      });
      continue;
    }
    if (outWriteConfirmed && resolvedOutPath && resolve(resolvedRef) === resolvedOutPath) {
      deliveredRefs.push({
        ...routeRef,
        ref,
        resolved_path: relIfRepo(repoRoot, resolvedRef),
      });
      continue;
    }
    failures.push({
      route: {
        ...routeRef,
        ref,
        resolved_path: relIfRepo(repoRoot, resolvedRef),
      },
      code: 'result_route_write_not_confirmed',
      reason: 'local artifact route was not delivered because no matching confirmed --out write occurred',
    });
  }

  let status = NOT_ATTEMPTED;
  if (attemptRefs.length > 0) {
    status = failures.length === 0 && deliveredRefs.length > 0
      ? 'completed'
      : (deliveredRefs.length > 0 ? 'attempted' : (failures.some((failure) => failure.code === 'result_route_unsupported') ? 'unsupported' : 'failed'));
  }

  return {
    status,
    refs: routes,
    attempt_refs: attemptRefs,
    delivered_refs: deliveredRefs,
    failure: failures.length > 0 ? failures : NOT_OBSERVED,
  };
}

function normalizeBranchPolicy(packet) {
  return packet.branch_policy
    ?? packet.branchPolicy
    ?? packet.external_publication_policy
    ?? packet.externalPublicationPolicy
    ?? NOT_OBSERVED;
}

function resolveRef(repoRoot, ref) {
  if (!ref) {
    return { status: 'missing_with_reason', ref: null, sha: null, reason: 'packet did not include required_start_ref' };
  }
  const result = runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return {
    status: result.exitCode === 0 ? 'resolved' : 'missing_with_reason',
    ref,
    sha: result.exitCode === 0 ? result.stdout : null,
    reason: result.exitCode === 0 ? null : result.stderr || 'git rev-parse failed',
    command: result.command,
  };
}

function currentWorktreeFacts(repoRoot) {
  const branch = runGit(repoRoot, ['branch', '--show-current']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const status = runGit(repoRoot, ['status', '--short']);
  return {
    branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : NOT_OBSERVED,
    head: head.exitCode === 0 && head.stdout ? head.stdout : NOT_OBSERVED,
    dirty_untracked_baseline: status.exitCode === 0 && status.stdout ? status.stdout.split('\n') : [],
  };
}

function localRouteSupported(route) {
  return route && typeof route === 'object' && route.kind === LOCAL_ARTIFACT_PATH
    && typeof (route.ref ?? route.path ?? route.artifact_path ?? route.artifactPath) === 'string';
}

function sleepLeaseLiveRouteDeliveryMismatch({ repoRoot, resultRoutes, outPath }) {
  const resolvedOutPath = outPath ? resolve(outPath) : null;
  const undeliverableRoutes = [];

  for (const route of resultRoutes) {
    const ref = route?.ref ?? route?.path ?? route?.artifact_path ?? route?.artifactPath ?? null;
    if (route?.kind !== LOCAL_ARTIFACT_PATH || typeof ref !== 'string') {
      undeliverableRoutes.push({ route, reason: 'unsupported_result_route' });
      continue;
    }
    if (ref === 'stdout') continue;

    const resolvedRef = repoPath(repoRoot, ref);
    if (!resolvedRef || !resolvedOutPath || resolve(resolvedRef) !== resolvedOutPath) {
      undeliverableRoutes.push({
        route: {
          ...route,
          ref,
          resolved_path: resolvedRef ? relIfRepo(repoRoot, resolvedRef) : NOT_OBSERVED,
        },
        reason: 'local_artifact_path_does_not_match_out',
        out: outPath ?? NOT_OBSERVED,
        resolved_out: resolvedOutPath ? relIfRepo(repoRoot, resolvedOutPath) : NOT_OBSERVED,
      });
    }
  }

  return undeliverableRoutes.length > 0
    ? mismatch('sleep_lease_live_result_route_undeliverable', 'Sleep lease live launch result routes must be stdout or match the confirmed --out path.', {
        undeliverable_routes: undeliverableRoutes,
      })
    : null;
}

async function resolveDockProfile(repoRoot, dockName) {
  const dockRoot = resolve(repoRoot, '.docks', dockName);
  const dockJson = resolve(dockRoot, 'dock.json');
  if (!existsSync(dockRoot)) {
    return {
      status: 'unknown_dock',
      mismatch_class: 'unknown_dock',
      dock: dockName,
      profile_path: relative(repoRoot, dockJson),
      launch_root: relative(repoRoot, dockRoot),
    };
  }
  if (!existsSync(dockJson)) {
    return {
      status: 'dock_profile_missing',
      mismatch_class: 'dock_profile_missing',
      dock: dockName,
      profile_path: relative(repoRoot, dockJson),
      launch_root: relative(repoRoot, dockRoot),
    };
  }
  const profile = await readJsonFile(dockJson, 'dock profile');
  return {
    status: 'resolved',
    dock: profile.name ?? dockName,
    role: profile.role ?? dockName,
    profile_path: relative(repoRoot, dockJson),
    launch_root: relative(repoRoot, dockRoot),
  };
}

function mismatch(mismatchClass, message, details = {}) {
  return { class: mismatchClass, message, ...details };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseAbsoluteTimestamp(value, field, mismatches) {
  if (typeof value !== 'string' || value.trim() === '') {
    mismatches.push(mismatch(`sleep_lease_${field}_missing`, `Sleep lease ${field} is required.`));
    return null;
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    mismatches.push(mismatch(`sleep_lease_${field}_relative_or_local`, `Sleep lease ${field} must be an absolute timestamp.`, { [field]: value }));
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    mismatches.push(mismatch(`sleep_lease_${field}_invalid`, `Sleep lease ${field} is not a valid timestamp.`, { [field]: value }));
    return null;
  }
  return parsed;
}

function validateStringField(lease, field, mismatches) {
  if (typeof lease[field] !== 'string' || lease[field].trim() === '') {
    mismatches.push(mismatch(`sleep_lease_${field}_missing`, `Sleep lease ${field} is required.`));
  }
}

function validateNonNegativeNumberField(lease, field, mismatches) {
  if (typeof lease[field] !== 'number' || !Number.isFinite(lease[field]) || lease[field] < 0) {
    mismatches.push(mismatch(`sleep_lease_${field}_invalid`, `Sleep lease ${field} must be a non-negative number.`));
  }
}

function validateStringArrayField(lease, field, mismatches, { rejectBroad = false } = {}) {
  if (!Array.isArray(lease[field]) || lease[field].length === 0) {
    mismatches.push(mismatch(`sleep_lease_${field}_invalid`, `Sleep lease ${field} must be a non-empty array.`));
    return [];
  }
  const values = lease[field].filter((item) => typeof item === 'string' && item.trim() !== '');
  if (values.length !== lease[field].length) {
    mismatches.push(mismatch(`sleep_lease_${field}_invalid`, `Sleep lease ${field} must contain only non-empty strings.`));
  }
  if (rejectBroad && values.some((item) => ['*', 'any', 'all', '**'].includes(item.toLowerCase()) || item.includes('*'))) {
    mismatches.push(mismatch(`sleep_lease_${field}_broad`, `Sleep lease ${field} must name explicit refs, not broad patterns.`, { [field]: lease[field] }));
  }
  return values;
}

function routeRefsCompatible(resultRoutes, leaseResultRoute) {
  if (typeof leaseResultRoute !== 'string' || leaseResultRoute.trim() === '') return false;
  const localRouteRef = (route) => {
    if (!route || typeof route !== 'object' || route.kind !== LOCAL_ARTIFACT_PATH) return null;
    return route.ref ?? route.path ?? route.artifact_path ?? route.artifactPath ?? null;
  };
  if (leaseResultRoute === 'stdout') {
    return resultRoutes.some((route) => localRouteRef(route) === 'stdout');
  }
  return resultRoutes.some((route) => {
    return localRouteRef(route) === leaseResultRoute;
  });
}

async function classifySleepLease({
  repoRoot,
  options,
  packet,
  packetId,
  sourceArtifact,
  selectedDock,
  selectedProvider,
  resultRoutes,
  action,
  createdAt,
}) {
  if (!options.sleepLease) {
    return {
      receipt: { status: 'not_applicable' },
      mismatches: [],
    };
  }

  const leasePath = repoPath(repoRoot, options.sleepLease);
  if (!existsSync(leasePath)) {
    return {
      receipt: {
        status: 'rejected',
        lease_ref: relIfRepo(repoRoot, leasePath),
        diagnostics: [mismatch('sleep_lease_missing', 'Sleep lease path does not exist.', { lease_ref: relIfRepo(repoRoot, leasePath) })],
      },
      mismatches: [mismatch('sleep_lease_missing', 'Sleep lease path does not exist.', { lease_ref: relIfRepo(repoRoot, leasePath) })],
    };
  }

  const lease = await readJsonFile(leasePath, 'sleep lease');
  const mismatches = [];
  if (!isPlainObject(lease)) {
    mismatches.push(mismatch('sleep_lease_invalid', 'Sleep lease must be a JSON object.'));
  }

  for (const field of ['lease_id', 'authorized_by', 'external_publication_policy', 'result_route']) {
    validateStringField(lease, field, mismatches);
  }
  const authorizedAt = parseAbsoluteTimestamp(lease.authorized_at, 'authorized_at', mismatches);
  const expiresAt = parseAbsoluteTimestamp(lease.expires_at, 'expires_at', mismatches);
  const comparisonAt = new Date(createdAt);
  if (expiresAt && !Number.isNaN(comparisonAt.getTime()) && expiresAt.getTime() <= comparisonAt.getTime()) {
    mismatches.push(mismatch('sleep_lease_expired', 'Sleep lease expired before the command timestamp.', {
      expires_at: lease.expires_at,
      command_timestamp: createdAt,
    }));
  }
  validateNonNegativeNumberField(lease, 'max_wall_clock_minutes', mismatches);
  validateNonNegativeNumberField(lease, 'max_provider_launches', mismatches);
  if (!isPlainObject(lease.provider_budget)) {
    mismatches.push(mismatch('sleep_lease_provider_budget_invalid', 'Sleep lease provider_budget is required.'));
  }
  const allowedDocks = validateStringArrayField(lease, 'allowed_docks', mismatches);
  const allowedProviders = validateStringArrayField(lease, 'allowed_providers', mismatches);
  const allowedWorkRefs = validateStringArrayField(lease, 'allowed_work_refs', mismatches, { rejectBroad: true });
  validateStringArrayField(lease, 'stop_conditions', mismatches);
  if (!isPlainObject(lease.allowed_branch_policy)) {
    mismatches.push(mismatch('sleep_lease_branch_policy_invalid', 'Sleep lease allowed_branch_policy is required.'));
  } else if (lease.allowed_branch_policy.allow_main_mutation !== false) {
    mismatches.push(mismatch('sleep_lease_main_mutation_forbidden', 'Sleep lease cannot allow main mutation.', {
      allow_main_mutation: lease.allowed_branch_policy.allow_main_mutation,
    }));
  }
  if (typeof lease.allow_branch_push !== 'boolean') {
    mismatches.push(mismatch('sleep_lease_allow_branch_push_invalid', 'Sleep lease allow_branch_push must be a boolean.'));
  }
  if (lease.external_publication_policy !== 'none') {
    mismatches.push(mismatch('sleep_lease_external_publication_forbidden', 'Sleep lease external_publication_policy must be none for V0.', {
      external_publication_policy: lease.external_publication_policy,
    }));
  }
  if (options.warmDockTuiReuse || action === 'warm-dock-tui-reuse') {
    mismatches.push(mismatch('sleep_lease_warm_reuse_forbidden', '--sleep-lease cannot be combined with --warm-dock-tui-reuse.'));
  }
  if (options.providerLaunchDryRun) {
    mismatches.push(mismatch('sleep_lease_provider_launch_dry_run_forbidden', '--sleep-lease cannot be combined with --provider-launch-dry-run.'));
  }
  if (action === 'supervised-live-launch') {
    if (!options.iAmPresent) {
      mismatches.push(mismatch('sleep_lease_human_presence_required', '--sleep-lease supervised live requires --i-am-present.'));
    }
    if (lease.max_provider_launches === 0) {
      mismatches.push(mismatch('sleep_lease_provider_launches_exhausted', 'Sleep lease supervised live requires max_provider_launches >= 1.', {
        max_provider_launches: lease.max_provider_launches,
      }));
    }
  }
  if (action === 'sleep-lease-live-launch') {
    if (options.iAmPresent) {
      mismatches.push(mismatch('sleep_lease_live_human_presence_forbidden', '--sleep-lease-live-launch must not be combined with --i-am-present.'));
    }
    if (!options.out) {
      mismatches.push(mismatch('sleep_lease_live_out_required', '--sleep-lease-live-launch requires --out.'));
    }
    if (lease.max_provider_launches < 1) {
      mismatches.push(mismatch('sleep_lease_provider_launches_exhausted', 'Sleep lease live launch requires max_provider_launches >= 1.', {
        max_provider_launches: lease.max_provider_launches,
      }));
    }
    if (lease.max_wall_clock_minutes <= 0) {
      mismatches.push(mismatch('sleep_lease_wall_clock_minutes_exhausted', 'Sleep lease live launch requires max_wall_clock_minutes > 0.', {
        max_wall_clock_minutes: lease.max_wall_clock_minutes,
      }));
    }
    if (lease.allow_branch_push !== false) {
      mismatches.push(mismatch('sleep_lease_branch_push_forbidden', 'Sleep lease live launch requires allow_branch_push=false for V0.', {
        allow_branch_push: lease.allow_branch_push,
      }));
    }
    if (selectedProvider !== 'codex') {
      mismatches.push(mismatch('sleep_lease_live_provider_mismatch', 'Sleep lease live launch is currently available only for provider codex.', {
        selected_provider: selectedProvider,
      }));
    }
    if (selectedDock !== 'gdi') {
      mismatches.push(mismatch('sleep_lease_live_dock_mismatch', 'Sleep lease live launch is currently available only for dock gdi.', {
        selected_dock: selectedDock,
      }));
    }
    if (!resultRoutes.every(localRouteSupported)) {
      mismatches.push(mismatch('sleep_lease_live_result_route_unsupported', 'Sleep lease live launch requires local stdout or local artifact result routes.', {
        packet_result_routes: resultRoutes,
      }));
    }
    const routeDeliveryMismatch = sleepLeaseLiveRouteDeliveryMismatch({ repoRoot, resultRoutes, outPath: options.out });
    if (routeDeliveryMismatch) {
      mismatches.push(routeDeliveryMismatch);
    }
  }
  if (!['dry-run', 'supervised-live-launch', 'sleep-lease-live-launch'].includes(action) || !options.json) {
    mismatches.push(mismatch('sleep_lease_requires_guarded_json_action', '--sleep-lease requires --dry-run --json, --supervised-live-launch --i-am-present --json, or --sleep-lease-live-launch --json --out.'));
  }
  if (!allowedDocks.includes(selectedDock)) {
    mismatches.push(mismatch('sleep_lease_dock_not_allowed', 'Selected dock is not allowed by the sleep lease.', {
      selected_dock: selectedDock,
      allowed_docks: allowedDocks,
    }));
  }
  if (!allowedProviders.includes(selectedProvider)) {
    mismatches.push(mismatch('sleep_lease_provider_not_allowed', 'Selected provider is not allowed by the sleep lease.', {
      selected_provider: selectedProvider,
      allowed_providers: allowedProviders,
    }));
  }
  if (!allowedWorkRefs.includes(sourceArtifact) && !allowedWorkRefs.includes(packetId)) {
    mismatches.push(mismatch('sleep_lease_work_ref_not_allowed', 'Packet work ref is not allowed by the sleep lease.', {
      packet_id: packetId,
      source_artifact: sourceArtifact,
      allowed_work_refs: allowedWorkRefs,
    }));
  }
  if (!routeRefsCompatible(resultRoutes, lease.result_route)) {
    mismatches.push(mismatch('sleep_lease_result_route_mismatch', 'Packet result route is not compatible with the sleep lease.', {
      lease_result_route: lease.result_route,
      packet_result_routes: resultRoutes,
    }));
  }

  const expired = mismatches.some((item) => item.class === 'sleep_lease_expired');
  const status = expired ? 'expired' : (mismatches.length > 0 ? 'rejected' : 'accepted');
  return {
    receipt: {
      status,
      lease_ref: relIfRepo(repoRoot, leasePath),
      lease_id: lease.lease_id ?? NOT_OBSERVED,
      authorized_by: lease.authorized_by ?? NOT_OBSERVED,
      authorized_at: lease.authorized_at ?? NOT_OBSERVED,
      expires_at: lease.expires_at ?? NOT_OBSERVED,
      max_wall_clock_minutes: lease.max_wall_clock_minutes ?? NOT_OBSERVED,
      max_provider_launches: lease.max_provider_launches ?? NOT_OBSERVED,
      provider_budget: lease.provider_budget ?? NOT_OBSERVED,
      provider_budget_enforcement: lease.provider_budget?.status === 'not_enforceable_yet' ? 'informational' : NOT_OBSERVED,
      allowed_docks: lease.allowed_docks ?? NOT_OBSERVED,
      allowed_providers: lease.allowed_providers ?? NOT_OBSERVED,
      allowed_work_refs: lease.allowed_work_refs ?? NOT_OBSERVED,
      allowed_branch_policy: lease.allowed_branch_policy ?? NOT_OBSERVED,
      allow_branch_push: lease.allow_branch_push ?? NOT_OBSERVED,
      external_publication_policy: lease.external_publication_policy ?? NOT_OBSERVED,
      result_route: lease.result_route ?? NOT_OBSERVED,
      stop_conditions: lease.stop_conditions ?? NOT_OBSERVED,
      diagnostics: mismatches.length > 0 ? mismatches : [],
    },
    mismatches,
  };
}

function selectedAction(options) {
  const selected = [options.dryRun, options.supervisedLiveLaunch, options.sleepLeaseLiveLaunch, options.warmDockTuiReuse].filter(Boolean).length;
  if (selected > 1) {
    return { action: 'invalid', mismatch: mismatch('conflicting_action_flags', 'Select only one of --dry-run, --supervised-live-launch, --sleep-lease-live-launch, or --warm-dock-tui-reuse.') };
  }
  if (options.supervisedLiveLaunch) return { action: 'supervised-live-launch', mismatch: null };
  if (options.sleepLeaseLiveLaunch) return { action: 'sleep-lease-live-launch', mismatch: null };
  if (options.warmDockTuiReuse) return { action: 'warm-dock-tui-reuse', mismatch: null };
  if (options.dryRun) return { action: 'dry-run', mismatch: null };
  return { action: 'missing', mismatch: mismatch('missing_action_flag', 'Expected --dry-run, --supervised-live-launch, --sleep-lease-live-launch, or --warm-dock-tui-reuse.') };
}

function resolveProvider(explicitProvider, packetProviderHint) {
  const selected = explicitProvider ?? packetProviderHint ?? null;
  if (!selected) {
    return {
      selected_provider: NOT_OBSERVED,
      selection_source: 'missing',
      mismatch: mismatch('provider_missing', 'No --provider or packet provider hint was supplied.'),
    };
  }
  const normalized = String(selected).toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    return {
      selected_provider: normalized,
      selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
      mismatch: mismatch('provider_unsupported', `Unsupported provider: ${normalized}`, { selected_provider: normalized }),
    };
  }
  return {
    selected_provider: normalized,
    selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
    mismatch: null,
  };
}

async function buildReceipt(options) {
  if (!options.packet) {
    throw Object.assign(new Error('Missing required --packet'), { mismatchClass: 'missing_packet' });
  }
  const actionSelection = selectedAction(options);

  const repoRoot = resolveRepoRoot(options.repo ?? process.cwd());
  const packetPath = repoPath(repoRoot, options.packet);
  if (!existsSync(packetPath)) {
    throw Object.assign(new Error(`Packet path does not exist: ${packetPath}`), { mismatchClass: 'missing_packet' });
  }

  const packet = await readJsonFile(packetPath, 'packet');
  const createdAt = options.timestamp ?? new Date().toISOString();
  const packetId = normalizePacketId(packet) ?? NOT_OBSERVED;
  const sourceArtifact = normalizeSourceArtifact(packet) ?? NOT_OBSERVED;
  const sourcePath = sourceArtifact === NOT_OBSERVED ? null : repoPath(repoRoot, sourceArtifact);
  const requiredStartRef = normalizeRef(packet);
  const refResolution = resolveRef(repoRoot, requiredStartRef);
  const selectedDock = options.dock ?? normalizeRequestedDock(packet) ?? NOT_OBSERVED;
  const dockProfile = selectedDock === NOT_OBSERVED
    ? { status: 'unknown_dock', mismatch_class: 'unknown_dock', profile_path: NOT_OBSERVED, launch_root: NOT_OBSERVED }
    : await resolveDockProfile(repoRoot, selectedDock);
  const provider = resolveProvider(options.provider, normalizeProviderHint(packet));
  const worktree = normalizeWorktree(packet, repoRoot);
  const resultRoutes = normalizeResultRoutes(packet, options.resultRoute);
  const worktreeFacts = currentWorktreeFacts(repoRoot);
  const mismatches = [];
  if (actionSelection.mismatch) {
    mismatches.push(actionSelection.mismatch);
  }
  if (actionSelection.action === 'supervised-live-launch' && !options.iAmPresent) {
    mismatches.push(mismatch('human_presence_required', '--i-am-present is required for supervised live launch.'));
  }
  if (actionSelection.action === 'supervised-live-launch' && !options.json) {
    mismatches.push(mismatch('json_required_for_supervised_live', '--json is required for supervised live launch receipts.'));
  }
  if (actionSelection.action === 'sleep-lease-live-launch') {
    if (!options.sleepLease) {
      mismatches.push(mismatch('sleep_lease_live_requires_sleep_lease', '--sleep-lease-live-launch requires --sleep-lease.'));
    }
    if (!options.json) {
      mismatches.push(mismatch('json_required_for_sleep_lease_live', '--json is required for sleep-lease live launch receipts.'));
    }
    if (!options.out) {
      mismatches.push(mismatch('out_required_for_sleep_lease_live', '--out is required for sleep-lease live launch receipts.'));
    }
    if (options.iAmPresent) {
      mismatches.push(mismatch('i_am_present_forbidden_for_sleep_lease_live', '--sleep-lease-live-launch does not accept --i-am-present.'));
    }
    if (options.providerLaunchDryRun) {
      mismatches.push(mismatch('provider_launch_dry_run_forbidden_for_sleep_lease_live', '--sleep-lease-live-launch does not accept --provider-launch-dry-run.'));
    }
  }

  if (sourceArtifact === NOT_OBSERVED || !sourcePath || !existsSync(sourcePath)) {
    mismatches.push(mismatch('missing_source_artifact', 'Packet source artifact was missing or not present in the current worktree.', {
      source_artifact: sourceArtifact,
    }));
  }
  if (refResolution.status !== 'resolved') {
    mismatches.push(mismatch('required_start_ref_unresolved', 'Required start ref did not resolve.', {
      required_start_ref: requiredStartRef ?? NOT_OBSERVED,
      reason: refResolution.reason,
    }));
  }
  if (!worktree || !existsSync(worktree) || resolve(worktree) !== repoRoot) {
    mismatches.push(mismatch('worktree_mismatch', 'Packet worktree/cwd does not match the selected repo root.', {
      worktree: worktree ?? NOT_OBSERVED,
      repo_root: repoRoot,
    }));
  }
  if (dockProfile.status !== 'resolved') {
    mismatches.push(mismatch(dockProfile.mismatch_class ?? 'dock_profile_missing', 'Dock launch root/profile could not be resolved.', {
      selected_dock: selectedDock,
      dock_profile_ref: dockProfile.profile_path,
    }));
  }
  if (provider.mismatch) {
    mismatches.push(provider.mismatch);
  }
  if (resultRoutes.length === 0) {
    mismatches.push(mismatch('result_route_missing', 'Packet did not include a result route and --result-route was not supplied.'));
  }
  if (actionSelection.action === 'supervised-live-launch' && provider.selected_provider !== 'codex') {
    mismatches.push(mismatch('provider_unsupported_for_supervised_live', 'Supervised live launch is currently available only for --provider codex.', {
      selected_provider: provider.selected_provider,
    }));
  }
  if (actionSelection.action === 'supervised-live-launch' && selectedDock !== 'gdi') {
    mismatches.push(mismatch('dock_mismatch_for_supervised_live', 'Supervised live launch is currently available only for --dock gdi.', {
      selected_dock: selectedDock,
    }));
  }
  if (actionSelection.action === 'sleep-lease-live-launch') {
    if (provider.selected_provider !== 'codex') {
      mismatches.push(mismatch('provider_mismatch_for_sleep_lease_live', 'Sleep-lease live launch is currently available only for --provider codex.', {
        selected_provider: provider.selected_provider,
      }));
    }
    if (selectedDock !== 'gdi') {
      mismatches.push(mismatch('dock_mismatch_for_sleep_lease_live', 'Sleep-lease live launch is currently available only for --dock gdi.', {
        selected_dock: selectedDock,
      }));
    }
    if (worktreeFacts.dirty_untracked_baseline.length > 0) {
      mismatches.push(mismatch('sleep_lease_live_worktree_dirty', 'Sleep-lease live launch requires a clean worktree for V0.', {
        dirty_untracked_baseline: worktreeFacts.dirty_untracked_baseline,
      }));
    }
    if (refResolution.sha && worktreeFacts.head !== NOT_OBSERVED && worktreeFacts.head !== refResolution.sha) {
      mismatches.push(mismatch('sleep_lease_live_start_ref_mismatch', 'Current HEAD must equal the resolved required_start_ref for sleep-lease live launch.', {
        current_head: worktreeFacts.head,
        required_start_ref: requiredStartRef ?? NOT_OBSERVED,
        required_start_sha: refResolution.sha,
      }));
    }
  }
  if (actionSelection.action === 'warm-dock-tui-reuse' && provider.selected_provider !== 'codex') {
    mismatches.push(mismatch('provider_unsupported_for_warm_dock_tui_reuse', 'Warm dock TUI reuse is currently available only for --provider codex.', {
      selected_provider: provider.selected_provider,
    }));
  }
  const sleepLease = await classifySleepLease({
    repoRoot,
    options,
    packet,
    packetId,
    sourceArtifact,
    selectedDock,
    selectedProvider: provider.selected_provider,
    resultRoutes,
    action: actionSelection.action,
    createdAt,
  });
  mismatches.push(...sleepLease.mismatches);

  const idempotenceMaterial = {
    packetId,
    packetRef: relIfRepo(repoRoot, packetPath),
    sourceArtifact,
    requiredStartRef,
    requiredStartSha: refResolution.sha,
    selectedDock,
    selectedProvider: provider.selected_provider,
    launchRoot: dockProfile.launch_root,
    resultRoutes,
    action: actionSelection.action,
    humanGate: actionSelection.action === 'supervised-live-launch' ? Boolean(options.iAmPresent) : false,
    sleepLease: options.sleepLease
      ? {
          leaseRef: sleepLease.receipt.lease_ref ?? NOT_OBSERVED,
          leaseId: sleepLease.receipt.lease_id ?? NOT_OBSERVED,
          action: actionSelection.action,
          selectedDock,
          selectedProvider: provider.selected_provider,
          requiredStartSha: refResolution.sha ?? NOT_OBSERVED,
          resultRoutes,
        }
      : null,
    salt: options.idempotenceSalt ?? null,
  };
  const idempotenceKey = stableHash(idempotenceMaterial, 32);
  const schedulerRunId = `scheduler-${stableHash({ idempotenceKey, kind: 'scheduler' })}`;
  const dispatchAttemptId = `dispatch-${stableHash({ schedulerRunId, idempotenceKey, kind: 'dispatch' })}`;
  const duplicate = options.existingReceipt ? await classifyExistingReceipt(repoRoot, options.existingReceipt, idempotenceKey, options) : null;
  const intakeMismatchCount = mismatches.length;
  const launchAllowed = (
    actionSelection.action === 'supervised-live-launch'
    || actionSelection.action === 'sleep-lease-live-launch'
    || actionSelection.action === 'warm-dock-tui-reuse'
  )
    && intakeMismatchCount === 0
    && !(duplicate?.duplicate && (duplicate.reused_state || duplicate.relaunch_requires_replacement));
  if (launchAllowed && actionSelection.action === 'sleep-lease-live-launch' && options.out) {
    await writeFile(resolve(options.out), `${JSON.stringify({
      record_type: 'aos.afk_session_trigger_sleep_lease_live',
      schema_status: 'not_a_schema',
      status: 'pre_launch_accepted',
      created_at: createdAt,
      scheduler: {
        scheduler_run_id: schedulerRunId,
        idempotence_key: idempotenceKey,
        lifecycle_state: 'accepted_pre_launch',
        selected_action: actionSelection.action,
        lease: {
          status: sleepLease.receipt.status,
          lease_ref: sleepLease.receipt.lease_ref ?? NOT_OBSERVED,
          lease_id: sleepLease.receipt.lease_id ?? NOT_OBSERVED,
        },
      },
      dispatch: {
        dispatch_attempt_id: dispatchAttemptId,
        selected_provider: provider.selected_provider,
        selected_dock: selectedDock,
        provider_launch_allowed: true,
        human_supervision: { required: false, i_am_present: false },
        launch_attempt_id: NOT_ATTEMPTED,
      },
      sleep_lease_live_start_gates: sleepLeaseLiveStartGates({
        worktreeFacts,
        refResolution,
        requiredStartRef,
        selectedDock,
        selectedProvider: provider.selected_provider,
        resultRoutes,
        sleepLease: sleepLease.receipt,
      }),
      terminal_substrate: { status: NOT_ATTEMPTED, reason: 'sleep-lease-live-pre-launch-receipt-written' },
      mismatches: [],
    }, null, 2)}\n`, 'utf8');
  }
  const launchAttempt = launchAllowed ? await createLaunchAttempt({
    packet: packetPath,
    provider: provider.selected_provider,
    dock: selectedDock,
    repo: repoRoot,
    timestamp: createdAt,
    launchMode: actionSelection.action === 'warm-dock-tui-reuse' ? 'warm_dock_tui_reuse' : 'supervised-provider',
    providerLaunchDryRun: options.providerLaunchDryRun,
    bridgeVisibilityFixture: options.bridgeVisibilityFixture,
    providerSessionId: options.providerSessionId,
    launchObservedAt: options.launchObservedAt,
    codexHomeFixture: options.codexHomeFixture,
    codexHome: options.codexHome,
  }) : null;
  const cleanup = await classifyCleanup(repoRoot, options, actionSelection.action, launchAttempt);
  if (duplicate?.mismatch) {
    mismatches.push(duplicate.mismatch);
  }
  if (launchAttempt) {
    mismatches.push(...launchAttemptMismatches(launchAttempt));
  }
  if (cleanup.mismatch) {
    mismatches.push(cleanup.mismatch);
  }
  const validationStatus = intakeMismatchCount === 0 ? 'valid' : 'invalid';
  const status = statusFor(actionSelection.action, mismatches, duplicate, launchAttempt, cleanup);

  return {
    record_type: actionSelection.action === 'supervised-live-launch'
      ? 'aos.afk_session_trigger_supervised_live'
      : (actionSelection.action === 'sleep-lease-live-launch'
          ? 'aos.afk_session_trigger_sleep_lease_live'
          : (actionSelection.action === 'warm-dock-tui-reuse'
          ? 'aos.afk_session_trigger_warm_dock_tui_reuse'
          : 'aos.afk_session_trigger_dry_run')),
    schema_status: 'not_a_schema',
    status,
    created_at: createdAt,
    packet: {
      packet_ref: relIfRepo(repoRoot, packetPath),
      packet_id: packetId,
      source_artifact: sourceArtifact,
      validation_status: validationStatus,
    },
    current_state: {
      repo_root: repoRoot,
      worktree: worktree ?? NOT_OBSERVED,
      branch: worktreeFacts.branch,
      head: worktreeFacts.head,
      required_start_ref: requiredStartRef ?? NOT_OBSERVED,
      required_start_sha: refResolution.sha ?? NOT_OBSERVED,
      source_artifact_status: sourcePath && existsSync(sourcePath) ? 'present' : 'missing',
      branch_or_publication_policy: normalizeBranchPolicy(packet),
    },
    scheduler: {
      scheduler_run_id: schedulerRunId,
      idempotence_key: idempotenceKey,
      lifecycle_state: schedulerState(actionSelection.action, mismatches, duplicate, launchAttempt, cleanup),
      selected_action: actionSelection.action,
      lease: options.sleepLease
        ? {
            status: sleepLease.receipt.status,
            lease_ref: sleepLease.receipt.lease_ref ?? NOT_OBSERVED,
            lease_id: sleepLease.receipt.lease_id ?? NOT_OBSERVED,
          }
        : 'not_enforced',
      duplicate_handling: duplicate ?? {
        duplicate: false,
        existing_receipt_ref: NOT_OBSERVED,
        relaunch_requires_replacement: false,
      },
    },
    dispatch: {
      dispatch_attempt_id: dispatchAttemptId,
      selected_provider: provider.selected_provider,
      selected_dock: selectedDock,
      dock_profile_ref: dockProfile.profile_path ?? NOT_OBSERVED,
      launch_root: dockProfile.launch_root ?? NOT_OBSERVED,
      action: actionSelection.action,
      provider_launch_allowed: launchAllowed,
      human_supervision: actionSelection.action === 'supervised-live-launch'
        ? { required: true, i_am_present: Boolean(options.iAmPresent) }
        : { required: false, i_am_present: false },
      launch_attempt_id: launchAttempt?.launch_attempt_id ?? NOT_ATTEMPTED,
    },
    sleep_lease_live_start_gates: actionSelection.action === 'sleep-lease-live-launch'
      ? sleepLeaseLiveStartGates({
          worktreeFacts,
          refResolution,
          requiredStartRef,
          selectedDock,
          selectedProvider: provider.selected_provider,
          resultRoutes,
          sleepLease: sleepLease.receipt,
        })
      : NOT_ATTEMPTED,
    terminal_substrate: terminalSubstrateSection(actionSelection.action, launchAttempt),
    provider_acceptance: providerAcceptanceSection(provider.selected_provider, launchAttempt),
    cleanup,
    warm_tui_reuse: launchAttempt?.warm_tui_reuse ?? NOT_ATTEMPTED,
    codex_adapter: codexAdapterSection(launchAttempt),
    catalog: launchAttempt ? launchAttempt.catalog : {
      status: NOT_ATTEMPTED,
      catalog_record_refs: NOT_ATTEMPTED,
    },
    telemetry: launchAttempt ? launchAttempt.telemetry : {
      status: NOT_ATTEMPTED,
      telemetry_event_refs: NOT_ATTEMPTED,
    },
    sleep_lease: sleepLease.receipt,
    result_route: classifyLocalResultRoutes({ repoRoot, routes: resultRoutes }),
    work_receipt: {
      status: NOT_ATTEMPTED,
    },
    evidence: {
      observed_refs: launchAttempt?.evidence?.observed_refs ?? [],
      transcript_body_copied: false,
    },
    mismatches,
  };
}

async function classifyExistingReceipt(repoRoot, receiptPath, idempotenceKey, options) {
  const resolved = repoPath(repoRoot, receiptPath);
  const receipt = await readJsonFile(resolved, 'existing receipt');
  const existingKey = receipt.scheduler?.idempotence_key ?? receipt.idempotence_key ?? NOT_OBSERVED;
  const existingState = receipt.scheduler?.lifecycle_state ?? receipt.lifecycle_state ?? receipt.status ?? NOT_OBSERVED;
  if (existingKey !== idempotenceKey) {
    return {
      duplicate: false,
      existing_receipt_ref: relIfRepo(repoRoot, resolved),
      existing_idempotence_key: existingKey,
      relaunch_requires_replacement: false,
    };
  }
  if (RELAUNCH_REQUIRES_REPLACEMENT_STATES.has(existingState) && !options.replacementFor && !options.supersedes) {
    return {
      duplicate: true,
      existing_receipt_ref: relIfRepo(repoRoot, resolved),
      existing_idempotence_key: existingKey,
      existing_state: existingState,
      relaunch_requires_replacement: true,
      mismatch: mismatch('replacement_required_for_prior_attempt', 'Prior terminal non-success attempt requires explicit replacement before relaunch.', {
        existing_state: existingState,
      }),
    };
  }
  return {
    duplicate: LIVE_TERMINAL_STATES.has(existingState),
    existing_receipt_ref: relIfRepo(repoRoot, resolved),
    existing_idempotence_key: existingKey,
    existing_state: existingState,
    relaunch_requires_replacement: false,
    reused_state: LIVE_TERMINAL_STATES.has(existingState),
  };
}

function terminalSubstrateSection(action, launchAttempt) {
  if (!launchAttempt) {
    return {
      status: NOT_ATTEMPTED,
      reason: ['supervised-live-launch', 'sleep-lease-live-launch'].includes(action) ? `${action}-pre-launch-not-started` : 'dry-run-only',
    };
  }
  return {
    ...launchAttempt.terminal_substrate,
    cleanup_status: launchAttempt.cleanup?.status ?? NOT_OBSERVED,
    launch_attempt_ref: launchAttempt.launch_attempt_id,
  };
}

function providerAcceptanceSection(selectedProvider, launchAttempt) {
  if (!launchAttempt) {
    return {
      status: NOT_ATTEMPTED,
      selected_provider: selectedProvider,
    };
  }
  return {
    selected_provider: selectedProvider,
    ...launchAttempt.provider_acceptance,
  };
}

function sleepLeaseLiveStartGates({
  worktreeFacts,
  refResolution,
  requiredStartRef,
  selectedDock,
  selectedProvider,
  resultRoutes,
  sleepLease,
}) {
  return {
    current_branch: worktreeFacts.branch,
    current_head: worktreeFacts.head,
    required_start_ref: requiredStartRef ?? NOT_OBSERVED,
    required_start_sha: refResolution.sha ?? NOT_OBSERVED,
    dirty_state: {
      status: worktreeFacts.dirty_untracked_baseline.length === 0 ? 'clean' : 'dirty',
      dirty_untracked_baseline: worktreeFacts.dirty_untracked_baseline,
    },
    branch_push_policy: {
      allow_branch_push: sleepLease.allow_branch_push ?? NOT_OBSERVED,
      allow_main_mutation: sleepLease.allowed_branch_policy?.allow_main_mutation ?? NOT_OBSERVED,
    },
    provider_launch_count_budget: sleepLease.max_provider_launches ?? NOT_OBSERVED,
    lease_expiry: sleepLease.expires_at ?? NOT_OBSERVED,
    max_wall_clock_minutes: sleepLease.max_wall_clock_minutes ?? NOT_OBSERVED,
    selected_work_ref: sleepLease.allowed_work_refs?.[0] ?? NOT_OBSERVED,
    selected_dock: selectedDock,
    selected_provider: selectedProvider,
    result_route: resultRoutes,
  };
}

function codexAdapterSection(launchAttempt) {
  if (!launchAttempt) {
    return {
      status: NOT_ATTEMPTED,
    };
  }
  return launchAttempt.codex_adapter;
}

function launchAttemptMismatches(launchAttempt) {
  if (!launchAttempt) return [];
  if (launchAttempt.lifecycle_state === 'provider_acceptance_unobserved') {
    return [mismatch('provider_acceptance_unobserved', 'Provider acceptance was not observed before the bounded launch-attempt timeout.', {
      launch_attempt_id: launchAttempt.launch_attempt_id,
    })];
  }
  if (launchAttempt.lifecycle_state === 'rejected' || launchAttempt.lifecycle_state === 'failed') {
    return [mismatch('launch_attempt_failed', 'Launch-attempt helper did not reach an observable provider state.', {
      launch_attempt_id: launchAttempt.launch_attempt_id,
      lifecycle_state: launchAttempt.lifecycle_state,
    })];
  }
  return [];
}

async function classifyCleanup(repoRoot, options, action, launchAttempt = null) {
  const base = {
    owner: 'afk-session-trigger-prototype',
    status: NOT_ATTEMPTED,
    proof: NOT_ATTEMPTED,
  };
  if (!['supervised-live-launch', 'sleep-lease-live-launch'].includes(action)) {
    if (action === 'warm-dock-tui-reuse' && launchAttempt?.cleanup) {
      return {
        ...launchAttempt.cleanup,
        launch_attempt_id: launchAttempt.launch_attempt_id,
        source_ref: 'inline:launch_attempt.cleanup',
      };
    }
    return {
      ...base,
      reason: 'dry-run-only',
    };
  }
  if (launchAttempt && !options.cleanupProofFixture) {
    const launchCleanup = launchAttempt.cleanup;
    if (launchCleanup?.status === 'verified' && cleanupProofCoversBridgeAndChild(launchCleanup.proof ?? [])) {
      return {
        owner: launchCleanup.owner ?? 'afk-launch-attempt-prototype',
        status: 'verified',
        proof: launchCleanup.proof ?? [],
        reason: null,
        launch_attempt_id: launchAttempt.launch_attempt_id,
        source_ref: 'inline:launch_attempt.cleanup',
        scope: launchCleanup.scope ?? NOT_OBSERVED,
      };
    }
    return {
      ...base,
      status: 'cleanup_unverified',
      proof: launchCleanup?.proof ?? base.proof,
      reason: launchCleanup?.reason && launchCleanup.reason !== NOT_OBSERVED
        ? launchCleanup.reason
        : 'cleanup proof must include helper-owned bridge and child/session teardown',
      launch_attempt_id: launchAttempt.launch_attempt_id,
      source_ref: launchCleanup ? 'inline:launch_attempt.cleanup' : NOT_OBSERVED,
      scope: launchCleanup?.scope ?? NOT_OBSERVED,
      mismatch: mismatch('cleanup_unverified', 'Terminal cleanup proof was missing or insufficient.', {
        cleanup_status: launchCleanup?.status ?? NOT_OBSERVED,
      }),
    };
  }
  if (!options.cleanupProofFixture) {
    return {
      ...base,
      reason: 'supervised-live-pre-launch-not-started',
    };
  }

  const resolved = repoPath(repoRoot, options.cleanupProofFixture);
  const fixture = await readJsonFile(resolved, 'cleanup proof fixture');
  const status = fixture.status ?? fixture.cleanup_status ?? fixture.cleanupStatus ?? NOT_OBSERVED;
  const proof = fixture.proof ?? fixture.cleanup_proof ?? fixture.cleanupProof ?? [];
  const verified = (status === 'verified' || status === 'complete' || status === 'completed')
    && cleanupProofCoversBridgeAndChild(proof);
  return {
    owner: fixture.owner ?? 'afk-session-trigger-prototype',
    status: verified ? 'verified' : 'cleanup_unverified',
    proof,
    fixture_ref: relIfRepo(repoRoot, resolved),
    reason: verified ? null : fixture.reason ?? 'cleanup proof fixture did not prove terminal cleanup',
    mismatch: verified
      ? null
      : mismatch('cleanup_unverified', 'Terminal cleanup proof was missing or insufficient.', {
        cleanup_status: status,
      }),
  };
}

function proofItemText(item) {
  return typeof item === 'string' ? item : `${item?.kind ?? ''} ${JSON.stringify(item ?? {})}`;
}

function cleanupProofCoversBridgeAndChild(proof) {
  if (!Array.isArray(proof)) return false;
  if (proof.some((item) => item && typeof item === 'object' && item.exit_observed === false)) return false;
  if (proof.some((item) => item && typeof item === 'object' && item.unreachable === false)) return false;
  const texts = proof.map(proofItemText);
  if (texts.some((text) => text.includes('provider_launch_dry_run_no_helper_process_started'))) return true;
  const bridgeExit = texts.some((text) => text.includes('owned_bridge_process_exit') || text.includes('bridge server process') || text.includes('bridge process'));
  const bridgeUnreachable = texts.some((text) => text.includes('owned_bridge_health_unreachable_after_teardown') || text.includes('bridge health endpoint unreachable'));
  const childExit = texts.some((text) => (
    text.includes('owned_process_driver_child_exit')
    || text.includes('owned_provider_command_child_exit')
    || text.includes('pty-proxy.py process')
    || text.includes('codex --no-alt-screen process')
  ));
  return bridgeExit && bridgeUnreachable && childExit;
}

function schedulerState(action, mismatches, duplicate, launchAttempt = null, cleanup = null) {
  if (mismatches.length > 0) return 'rejected';
  if (duplicate?.duplicate && duplicate.reused_state) return 'duplicate';
  if (action === 'warm-dock-tui-reuse' && launchAttempt?.lifecycle_state === 'provider_session_observed') return 'completed';
  if (launchAttempt?.lifecycle_state === 'provider_session_observed' && cleanup?.status === 'verified') return 'completed';
  return action === 'dry-run' ? 'accepted' : 'accepted_pre_launch';
}

function statusFor(action, mismatches, duplicate, launchAttempt = null, cleanup = null) {
  if (mismatches.some((item) => item.class === 'cleanup_unverified')) return 'cleanup_unverified';
  if (mismatches.some((item) => item.class === 'provider_acceptance_unobserved')) return 'provider_acceptance_unobserved';
  if (mismatches.some((item) => item.class === 'launch_attempt_failed')) return 'failed';
  if (mismatches.some((item) => item.class === 'replacement_required_for_prior_attempt')) return 'blocked';
  if (mismatches.length > 0) return 'rejected';
  if (duplicate?.duplicate && duplicate.reused_state) return 'duplicate';
  if (action === 'warm-dock-tui-reuse' && launchAttempt?.lifecycle_state === 'provider_session_observed') {
    return 'completed';
  }
  if (launchAttempt?.lifecycle_state === 'provider_session_observed' && cleanup?.status === 'verified') {
    return 'completed';
  }
  return action === 'dry-run' ? 'dry_run_ready' : 'supervised_live_launch_ready';
}

function toMarkdown(receipt) {
  return `# Experimental AFK Session Trigger Dry-Run Receipt

status: ${receipt.status}
created_at: ${receipt.created_at}

This receipt is experimental local dry-run output and is not a schema.

\`\`\`json
${JSON.stringify(receipt, null, 2)}
\`\`\`
`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const receipt = await buildReceipt(options);
    const outputAsJson = options.json || options.supervisedLiveLaunch || options.sleepLeaseLiveLaunch || options.sleepLease;
    if (options.out) {
      try {
        receipt.result_route = classifyLocalResultRoutes({
          repoRoot: receipt.current_state.repo_root,
          routes: receipt.result_route.refs,
          stdoutDelivered: true,
          outPath: options.out,
          outWriteConfirmed: true,
        });
        const output = outputAsJson ? `${JSON.stringify(receipt, null, 2)}\n` : toMarkdown(receipt);
        await writeFile(resolve(options.out), output, 'utf8');
      } catch (error) {
        receipt.status = 'failed';
        receipt.result_route = {
          ...classifyLocalResultRoutes({
            repoRoot: receipt.current_state.repo_root,
            routes: receipt.result_route.refs,
            stdoutDelivered: true,
            outPath: options.out,
            outWriteConfirmed: false,
          }),
          status: 'failed',
        };
        receipt.mismatches.push(mismatch('receipt_write_failed', `Unable to write receipt: ${error.message}`, {
          out: options.out,
        }));
        process.stdout.write(outputAsJson ? `${JSON.stringify(receipt, null, 2)}\n` : toMarkdown(receipt));
        process.exitCode = 1;
        return;
      }
    } else {
      receipt.result_route = classifyLocalResultRoutes({
        repoRoot: receipt.current_state.repo_root,
        routes: receipt.result_route.refs,
        stdoutDelivered: true,
      });
    }
    const output = outputAsJson ? `${JSON.stringify(receipt, null, 2)}\n` : toMarkdown(receipt);
    process.stdout.write(output);
    process.exitCode = ['dry_run_ready', 'supervised_live_launch_ready', 'duplicate', 'completed'].includes(receipt.status) ? 0 : 1;
  } catch (error) {
    const payload = {
      record_type: 'aos.afk_session_trigger_dry_run',
      schema_status: 'not_a_schema',
      status: 'blocked',
      error: error.message,
      mismatches: [mismatch(error.mismatchClass ?? 'failed', error.message)],
      script: basename(SCRIPT_PATH),
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${SCRIPT_PATH}`) {
  await main();
}

export {
  buildReceipt,
  parseArgs,
};

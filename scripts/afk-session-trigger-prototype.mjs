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
  node scripts/afk-session-trigger-prototype.mjs --packet <packet.json> (--dry-run|--supervised-live-launch --i-am-present --json) [--provider <name>] [--dock <dock>] [--repo <path>] [--timestamp <iso>] [--out <path>] [--result-route <ref>] [--idempotence-salt <value>] [--existing-receipt <path>] [--replacement-for <id>] [--bridge-visibility-fixture <path>] [--cleanup-proof-fixture <path>] [--provider-session-id <id>] [--launch-observed-at <iso>] [--codex-home-fixture <path>|--codex-home <path>]

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
  if (Array.isArray(route)) return route;
  if (route) return [route];
  return override ? [override] : [];
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

function selectedAction(options) {
  if (options.dryRun && options.supervisedLiveLaunch) {
    return { action: 'invalid', mismatch: mismatch('conflicting_action_flags', 'Do not combine --dry-run and --supervised-live-launch.') };
  }
  if (options.supervisedLiveLaunch) return { action: 'supervised-live-launch', mismatch: null };
  if (options.dryRun) return { action: 'dry-run', mismatch: null };
  return { action: 'missing', mismatch: mismatch('missing_action_flag', 'Expected --dry-run or --supervised-live-launch.') };
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
    salt: options.idempotenceSalt ?? null,
  };
  const idempotenceKey = stableHash(idempotenceMaterial, 32);
  const schedulerRunId = `scheduler-${stableHash({ idempotenceKey, kind: 'scheduler' })}`;
  const dispatchAttemptId = `dispatch-${stableHash({ schedulerRunId, idempotenceKey, kind: 'dispatch' })}`;
  const duplicate = options.existingReceipt ? await classifyExistingReceipt(repoRoot, options.existingReceipt, idempotenceKey, options) : null;
  const intakeMismatchCount = mismatches.length;
  const preLaunchAllowed = actionSelection.action === 'supervised-live-launch'
    && intakeMismatchCount === 0
    && !(duplicate?.duplicate && (duplicate.reused_state || duplicate.relaunch_requires_replacement));
  const launchAttempt = preLaunchAllowed ? await createLaunchAttempt({
    packet: packetPath,
    provider: provider.selected_provider,
    dock: selectedDock,
    repo: repoRoot,
    timestamp: createdAt,
    launchMode: 'supervised-provider',
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
      : 'aos.afk_session_trigger_dry_run',
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
      lease: 'not_enforced',
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
      provider_launch_allowed: preLaunchAllowed,
      human_supervision: actionSelection.action === 'supervised-live-launch'
        ? { required: true, i_am_present: Boolean(options.iAmPresent) }
        : { required: false, i_am_present: false },
      launch_attempt_id: launchAttempt?.launch_attempt_id ?? NOT_ATTEMPTED,
    },
    terminal_substrate: terminalSubstrateSection(actionSelection.action, launchAttempt),
    provider_acceptance: providerAcceptanceSection(provider.selected_provider, launchAttempt),
    cleanup,
    codex_adapter: codexAdapterSection(launchAttempt),
    catalog: launchAttempt ? launchAttempt.catalog : {
      status: NOT_ATTEMPTED,
      catalog_record_refs: NOT_ATTEMPTED,
    },
    telemetry: launchAttempt ? launchAttempt.telemetry : {
      status: NOT_ATTEMPTED,
      telemetry_event_refs: NOT_ATTEMPTED,
    },
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
      reason: action === 'supervised-live-launch' ? 'supervised-live-pre-launch-not-started' : 'dry-run-only',
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
  if (action !== 'supervised-live-launch') {
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
    const outputAsJson = options.json || options.supervisedLiveLaunch;
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

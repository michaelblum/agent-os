import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import { validateVersionDirectory, versionKey } from './store-package.mjs';
import {
  assertPrivateDirectory,
  inspectStore,
  lstatOptional,
  readPrivateRecord,
} from './store-paths.mjs';
import {
  cleanupRecoveryState,
  recoveryState,
  retireManagedPath,
} from './store-retirement.mjs';
import { inspectRemovalState } from './store-removal.mjs';
import { inspectStoreLockState } from './store-lock-state.mjs';
import { ManagedSessionError, validateSessionRecord } from './session-model.mjs';
import { listSessionCreateIntents } from './session-intent.mjs';
import { listEvidenceAcks } from './session-evidence-ack.mjs';
import { sessionWorkspace } from './session-store.mjs';
import { listGuardianOutcomes } from './worker-guardian-outcome.mjs';

const ACTIVE_SCHEMA = 'aos.browser.companion-active.v1';
const ACTIVE_KEYS = ['schema_version', 'version_key', 'version', 'descriptor_sha256', 'closure_sha256'];
const SAFE_LEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.json$/u;
const SAFE_VERSION = /^[0-9A-Za-z.-]+-[a-f0-9]{64}$/u;
const ROOT_ENTRIES = new Set([
  '.bootstrap', '.lock', '.lock-recovery', '.pending', '.retired', '.session-retired', '.staging',
  'active.json', 'leases', 'owner.json', 'versions', 'workspaces',
]);
const MAX_STABLE_VERSIONS = 16;
const MAX_TRANSITION_VERSIONS = MAX_STABLE_VERSIONS + 1;
const MAX_LEASES = 128;
const MAX_STAGES = 8;
const MAX_SESSION_RESIDUE = 128;

function exactKeys(value, keys, code, label) {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(code, `${label} shape differs`);
  }
}

function directoryEntries(directory, maximum, label) {
  assertPrivateDirectory(directory, label);
  const entries = fs.readdirSync(directory);
  if (entries.length > maximum) fail('COMPANION_STORE_CORRUPT', `${label} exceeds its entry limit`);
  return entries.sort();
}

function validateRootLayout(store) {
  for (const entry of fs.readdirSync(store.paths.root)) {
    if (!ROOT_ENTRIES.has(entry)) fail('COMPANION_STORE_CORRUPT', 'companion store contains an unexpected entry');
  }
}

export function readActive(store) {
  const active = readPrivateRecord(store.paths.active);
  if (!active) return null;
  exactKeys(active, ACTIVE_KEYS, 'COMPANION_STORE_CORRUPT', 'active pointer');
  if (
    active.schema_version !== ACTIVE_SCHEMA
    || !SAFE_VERSION.test(active.version_key ?? '')
    || !/^[a-f0-9]{64}$/u.test(active.descriptor_sha256 ?? '')
    || !/^[a-f0-9]{64}$/u.test(active.closure_sha256 ?? '')
    || versionKey(active.version, active.descriptor_sha256) !== active.version_key
  ) {
    fail('COMPANION_STORE_CORRUPT', 'active pointer identity differs');
  }
  return active;
}

function validateVersions(store) {
  const keys = directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions');
  const versions = new Map();
  for (const key of keys) {
    if (!SAFE_VERSION.test(key)) fail('COMPANION_STORE_CORRUPT', 'immutable version key is invalid');
    const root = path.join(store.paths.versions, key);
    const validated = validateVersionDirectory(root);
    if (versionKey(validated.version, validated.descriptor_sha256) !== key) {
      fail('COMPANION_STORE_CORRUPT', 'immutable version identity differs');
    }
    versions.set(key, validated);
  }
  return versions;
}

export function listManagedLeases(store) {
  const leases = [];
  for (const filename of directoryEntries(store.paths.leases, MAX_LEASES, 'leases')) {
    if (!SAFE_LEASE.test(filename)) fail('COMPANION_STORE_CORRUPT', 'managed lease filename is invalid');
    let lease;
    try {
      lease = validateSessionRecord(readPrivateRecord(path.join(store.paths.leases, filename)), filename);
    } catch (error) {
      if (error instanceof ManagedSessionError) fail('COMPANION_STORE_CORRUPT', error.message, { cause: error });
      throw error;
    }
    leases.push(lease);
  }
  return leases;
}

function validateSessionResources(store, leases, intents, evidenceAcks) {
  const workspaceNames = directoryEntries(store.paths.workspaces, MAX_LEASES, 'session workspaces');
  const byId = new Map(leases.map((lease) => [lease.session_id, lease]));
  for (const intent of intents) {
    const lease = byId.get(intent.record.session_id);
    if (lease && lease.generation !== intent.record.generation) {
      fail('COMPANION_STORE_CORRUPT', 'managed session creation intent conflicts with a lease');
    }
  }
  for (const ack of evidenceAcks) {
    const lease = byId.get(ack.session_id);
    if (!lease || lease.generation !== ack.generation) {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement lacks its lease');
    }
    if (lease.operation_nonce !== null
      && (lease.pending_operation !== 'evidence_capture' || lease.operation_nonce !== ack.operation_nonce)) {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement lease binding differs');
    }
    if (lease.operation_nonce === null
      && lease.state === 'active' && ack.phase !== 'acknowledged') {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence settled phase differs');
    }
    if (lease.operation_nonce === null && !['active', 'cleanup_required'].includes(lease.state)) {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement settled lease differs');
    }
  }
  const records = [...leases, ...intents.filter((intent) => !byId.has(intent.record.session_id)).map((intent) => intent.record)];
  const noAuthority = new Set(intents
    .filter((intent) => ['prepared', 'rollback_no_authority'].includes(intent.phase))
    .map((intent) => intent.record.workspace));
  const expectedLive = new Set(records
    .filter((lease) => lease.state !== 'closed' && !noAuthority.has(lease.workspace))
    .map((lease) => lease.workspace));
  const allowed = new Set(records.map((lease) => lease.workspace));
  if (workspaceNames.some((name) => !allowed.has(name)) || [...expectedLive].some((name) => !workspaceNames.includes(name))) {
    fail('COMPANION_STORE_CORRUPT', 'managed session workspace binding differs');
  }
  for (const lease of leases) {
    if (!noAuthority.has(lease.workspace)
      && (lease.state !== 'closed' || workspaceNames.includes(lease.workspace))) sessionWorkspace(store, lease);
  }
  const retired = directoryEntries(store.paths.sessionRetired, MAX_SESSION_RESIDUE, 'retired sessions');
  if (retired.some((name) => !/^(?:retired|prepared)-session-[A-Za-z0-9_-]+-[a-f0-9]{32}$/u.test(name))) {
    fail('COMPANION_STORE_CORRUPT', 'retired session layout differs');
  }
  const allowedRetired = new Set(leases.filter((lease) => lease.state === 'closed')
    .map((lease) => `retired-session-${lease.session_id}-${lease.generation}`));
  for (const intent of intents) {
    allowedRetired.add(`prepared-session-${intent.record.session_id}-${intent.record.generation}`);
  }
  if (retired.some((name) => !allowedRetired.has(name))) fail('COMPANION_STORE_CORRUPT', 'retired session lacks its durable record');
  return Object.freeze({
    recovery_pending: intents.length > 0 || evidenceAcks.length > 0
      || retired.length > 0 || leases.some((lease) => lease.state !== 'active'),
  });
}

export function inspectManagedState(env, currentDescriptorSha256, options = {}) {
  const store = inspectStore(env);
  const removal = inspectRemovalState(store);
  if (!store.exists) {
    return Object.freeze({
      state: removal || store.bootstrap ? 'partial' : 'missing',
      store: null,
      active: null,
      validated: null,
      removal: removal?.journal ?? null,
      removal_phase: removal?.phase ?? null,
    });
  }
  validateRootLayout(store);
  const missingRequired = [
    store.paths.versions, store.paths.leases, store.paths.workspaces, store.paths.sessionRetired,
    store.paths.staging, store.paths.pending, store.paths.retired,
  ]
    .filter((directory) => !lstatOptional(directory));
  if (missingRequired.length > 0) return Object.freeze({
    state: 'partial', store, active: null, validated: null, removal: removal?.journal ?? null,
    removal_phase: removal?.phase ?? null,
  });
  const lockState = inspectStoreLockState(store, options.heldLock);
  const stages = directoryEntries(store.paths.staging, MAX_STAGES, 'staging');
  const recovery = recoveryState(store);
  const guardianOutcomes = listGuardianOutcomes(store);
  const evidenceAcks = listEvidenceAcks(store);
  const versions = validateVersions(store);
  const leases = listManagedLeases(store);
  const intents = listSessionCreateIntents(store);
  const sessionState = validateSessionResources(store, leases, intents, evidenceAcks);
  for (const lease of leases) {
    const leasedVersion = versions.get(lease.version_key);
    if (
      !leasedVersion
      || leasedVersion.version !== lease.version
      || leasedVersion.descriptor_sha256 !== lease.descriptor_sha256
      || leasedVersion.closure_sha256 !== lease.closure_sha256
      || leasedVersion.descriptor.entrypoint !== lease.entrypoint
      || versionKey(lease.version, lease.descriptor_sha256) !== lease.version_key
    ) {
      fail('COMPANION_STORE_CORRUPT', 'managed lease does not match immutable package state');
    }
  }
  for (const intent of intents) {
    const leasedVersion = versions.get(intent.record.version_key);
    if (!leasedVersion || leasedVersion.version !== intent.record.version
      || leasedVersion.descriptor_sha256 !== intent.record.descriptor_sha256
      || leasedVersion.closure_sha256 !== intent.record.closure_sha256
      || leasedVersion.descriptor.entrypoint !== intent.record.entrypoint
      || versionKey(intent.record.version, intent.record.descriptor_sha256) !== intent.record.version_key) {
      fail('COMPANION_STORE_CORRUPT', 'managed session creation intent does not match immutable package state');
    }
  }
  const active = readActive(store);
  if (!active) {
    return Object.freeze({
      state: !removal && !lockState.recovery_pending && stages.length === 0 && versions.size === 0 && leases.length === 0 && !recovery.hasRecovery && !sessionState.recovery_pending
        ? 'missing'
        : 'partial',
      store,
      active: null,
      validated: null,
      removal: removal?.journal ?? null,
      removal_phase: removal?.phase ?? null,
      guardian_recovery_pending: lockState.guardian_recovery_pending || guardianOutcomes.length > 0,
    });
  }
  const validated = versions.get(active.version_key);
  if (!validated || validated.version !== active.version || validated.descriptor_sha256 !== active.descriptor_sha256 || validated.closure_sha256 !== active.closure_sha256) {
    fail('COMPANION_STORE_CORRUPT', 'active pointer does not match immutable package state');
  }
  const retained = new Set([active.version_key, ...leases.map((lease) => lease.version_key), ...intents.map((intent) => intent.record.version_key)]);
  if (retained.size > MAX_STABLE_VERSIONS) {
    fail('COMPANION_STORE_CORRUPT', 'stable immutable version capacity is exceeded');
  }
  const unretired = [...versions.keys()].some((key) => !retained.has(key));
  if (removal || lockState.recovery_pending || stages.length > 0 || recovery.hasRecovery || unretired || sessionState.recovery_pending) {
    return Object.freeze({
      state: 'partial', store, active, validated,
      removal: removal?.journal ?? null,
      removal_phase: removal?.phase ?? null,
      guardian_recovery_pending: lockState.guardian_recovery_pending || guardianOutcomes.length > 0,
    });
  }
  return Object.freeze({
    state: active.descriptor_sha256 === currentDescriptorSha256 ? 'current' : 'update_available',
    store,
    active,
    validated,
  });
}

export function preflightVersionActivation(store, newVersionKey) {
  const keys = directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions');
  if (keys.length > MAX_STABLE_VERSIONS && !keys.includes(newVersionKey)) {
    fail('COMPANION_STORE_CORRUPT', 'immutable version transition is already incomplete');
  }
  const stable = new Set([
    newVersionKey,
    ...listManagedLeases(store).map((lease) => lease.version_key),
  ]);
  if (stable.size > MAX_STABLE_VERSIONS) {
    fail('COMPANION_LEASES_ACTIVE', 'managed leases exceed stable version capacity');
  }
}

export function cleanupSupersededVersions(store, activeKey) {
  const retained = new Set([activeKey, ...listManagedLeases(store).map((lease) => lease.version_key)]);
  for (const key of directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions')) {
    if (!retained.has(key)) retireManagedPath(store, path.join(store.paths.versions, key), 'version');
  }
}

export function clearManagedPackageState(store) {
  if (listManagedLeases(store).length > 0 || listSessionCreateIntents(store).length > 0) {
    fail('COMPANION_LEASES_ACTIVE', 'managed leases block uninstall');
  }
  cleanupRecoveryState(store);
  const activeInfo = lstatOptional(store.paths.active);
  if (activeInfo) retireManagedPath(store, store.paths.active, 'active');
  for (const directory of [store.paths.versions, store.paths.staging]) {
    const kind = directory === store.paths.versions ? 'version' : 'stage';
    const maximum = directory === store.paths.versions ? MAX_TRANSITION_VERSIONS : MAX_STAGES;
    for (const entry of directoryEntries(directory, maximum, 'managed state')) {
      retireManagedPath(store, path.join(directory, entry), kind);
    }
  }
}

export function clearStagingState(store) {
  for (const entry of directoryEntries(store.paths.staging, MAX_STAGES, 'staging')) {
    retireManagedPath(store, path.join(store.paths.staging, entry), 'stage');
  }
}

export { cleanupRecoveryState };

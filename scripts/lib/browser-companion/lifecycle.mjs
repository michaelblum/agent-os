import { inspectTarball } from './archive.mjs';
import { assertSupportedNode, loadSourceDescriptor } from './descriptor.mjs';
import { acquisitionEnvironment, downloadTarball } from './download.mjs';
import { CompanionError, fail } from './errors.mjs';
import { withStoreLock } from './store-lock.mjs';
import { listSessionCreateIntents } from './session-intent.mjs';
import { ensureRemovalJournal } from './store-removal.mjs';
import { versionKey } from './store-package.mjs';
import {
  cleanupRecoveryState,
  cleanupSupersededVersions,
  clearManagedPackageState,
  clearStagingState,
  inspectManagedState,
  listManagedLeases,
  preflightVersionActivation,
} from './store-state.mjs';
import {
  activateStage,
  cleanupStage,
  createStage,
  finalizeStage,
  materializePackage,
  writeStageArchive,
} from './store-writer.mjs';

const STATUS_SCHEMA = 'aos.browser.companion.status.v1';
const MUTATION_SCHEMA = 'aos.browser.companion.mutation.v1';

function statusReceipt(view, current) {
  return Object.freeze({
    schema_version: STATUS_SCHEMA,
    operation: 'status',
    status: 'ok',
    state: view.state,
    managed_tool: current.descriptor.id,
    current_version: current.descriptor.version,
    installed_version: view.validated?.version ?? null,
    descriptor_sha256: current.digest,
    installed_descriptor_sha256: view.validated?.descriptor_sha256 ?? null,
    closure_sha256: view.validated?.closure_sha256 ?? null,
    checked_at: new Date().toISOString(),
  });
}

function mutationReceipt({
  operation,
  status,
  current,
  previousVersion,
  binding,
  beforeState,
  afterState,
  recoveryPending = false,
  startedAt,
  monotonicNow,
}) {
  const elapsed = Math.max(0, Math.trunc(monotonicNow() - startedAt));
  return Object.freeze({
    schema_version: MUTATION_SCHEMA,
    operation,
    status,
    previous_version: previousVersion,
    active_version: operation === 'uninstall' ? null : (binding?.version ?? null),
    descriptor_sha256: binding?.descriptor_sha256 ?? current.digest,
    closure_sha256: binding?.closure_sha256 ?? null,
    before_state: beforeState,
    after_state: afterState,
    session_cleanup_count: 0,
    recovery_pending: recoveryPending,
    duration_ms: Number.isSafeInteger(elapsed) ? elapsed : Number.MAX_SAFE_INTEGER,
    completed_at: new Date().toISOString(),
  });
}

function operationTiming(options) {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  return Object.freeze({ startedAt: monotonicNow(), monotonicNow });
}

function statusView(env, current) {
  try {
    return inspectManagedState(env, current.digest);
  } catch (error) {
    if (!(error instanceof CompanionError)) throw error;
    if (['COMPANION_STORE_BLOCKED', 'COMPANION_STORE_BUSY'].includes(error.code)) {
      return Object.freeze({ state: 'blocked', validated: null });
    }
    if (['COMPANION_STORE_CORRUPT', 'COMPANION_PACKAGE_INVALID'].includes(error.code)) {
      return Object.freeze({ state: 'corrupt', validated: null });
    }
    throw error;
  }
}

function removalBinding(journal) {
  if (!journal || journal.previous_version === null) return null;
  return Object.freeze({
    version: journal.previous_version,
    descriptor_sha256: journal.descriptor_sha256,
    closure_sha256: journal.closure_sha256,
  });
}

export function companionStatus(options = {}) {
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  return statusReceipt(statusView(options.env ?? process.env, current), current);
}

async function acquireCurrent(store, current, options) {
  assertSupportedNode(current.descriptor, options.nodeVersion);
  preflightVersionActivation(store, versionKey(current.descriptor.version, current.digest));
  const stage = createStage(store);
  const acquire = options.download ?? downloadTarball;
  const environment = acquisitionEnvironment(stage);
  let downloadedBytes = 0;
  let extractedFiles = 0;
  let extractedBytes = 0;
  let activated = null;
  let failure = null;
  let recoveryPending = false;
  try {
    for (const [index, pkg] of current.descriptor.packages.entries()) {
      const bytes = await acquire({
        url: pkg.tarball,
        packageName: pkg.name,
        maxBytes: current.descriptor.limits.max_tarball_bytes,
        timeoutMs: current.descriptor.limits.download_timeout_ms,
        environment,
      });
      if (!Buffer.isBuffer(bytes)) fail('COMPANION_DOWNLOAD_FAILED', 'downloader returned non-bytes');
      downloadedBytes += bytes.length;
      if (downloadedBytes > current.descriptor.limits.max_download_bytes) fail('COMPANION_DOWNLOAD_LIMIT', 'aggregate download exceeds limit');
      writeStageArchive(stage, index, bytes);
      const archive = inspectTarball(bytes, pkg, current.descriptor.limits);
      extractedFiles += archive.fileCount;
      extractedBytes += archive.totalBytes;
      if (extractedFiles > current.descriptor.limits.max_extracted_files || extractedBytes > current.descriptor.limits.max_extracted_bytes) {
        fail('COMPANION_ARCHIVE_LIMIT', 'aggregate extraction exceeds limit');
      }
      materializePackage(stage, pkg, archive.entries);
    }
    const validated = finalizeStage(stage, current.descriptor, current.digest);
    if (options.hooks?.beforeActivation) {
      try {
        await options.hooks.beforeActivation();
      } catch (error) {
        fail('COMPANION_ACTIVATION_FAILED', 'injected preactivation failure', { cause: error });
      }
    }
    activated = activateStage(store, stage, validated, { hooks: options.hooks });
    recoveryPending = activated.recovery_pending;
    try {
      if (options.hooks?.beforeSupersededCleanup) await options.hooks.beforeSupersededCleanup();
      cleanupSupersededVersions(store, activated.key);
    } catch (error) {
      recoveryPending = true;
    }
  } catch (error) {
    failure = error;
  }
  try {
    if (activated && options.hooks?.beforePostActivationCleanup) await options.hooks.beforePostActivationCleanup();
    cleanupStage(store, stage);
  } catch (error) {
    if (!activated) failure ??= error;
    else {
      recoveryPending = true;
    }
  }
  if (failure) throw failure;
  return Object.freeze({
    ...activated,
    recovery_pending: recoveryPending,
    after_state: recoveryPending ? 'partial' : 'current',
  });
}

export async function installCompanion(options = {}) {
  const timing = operationTiming(options);
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  return withStoreLock(env, async (store, heldLock, controls) => {
    let view = inspectManagedState(env, current.digest, { heldLock });
    if (controls.recoveredRemoval || view.removal_phase) {
      fail('COMPANION_STORE_BLOCKED', 'companion removal may only be resumed by uninstall');
    }
    const beforeState = view.state;
    if (view.state === 'partial' && view.active) {
      cleanupRecoveryState(store);
      clearStagingState(store);
      cleanupSupersededVersions(store, view.active.version_key);
      view = inspectManagedState(env, current.digest, { heldLock });
    }
    if (view.state === 'current') return mutationReceipt({
      operation: 'install', status: 'unchanged', current, previousVersion: view.validated.version,
      binding: view.validated, beforeState, afterState: 'current', ...timing,
    });
    if (view.state === 'update_available') fail('COMPANION_UPDATE_REQUIRED', 'installed companion requires update');
    if (view.state === 'partial') clearManagedPackageState(store);
    const active = await acquireCurrent(store, current, options);
    return mutationReceipt({
      operation: 'install', status: 'installed', current, previousVersion: null,
      binding: active, beforeState, afterState: active.after_state,
      recoveryPending: active.recovery_pending, ...timing,
    });
  }, { hooks: options.hooks });
}

export async function updateCompanion(options = {}) {
  const timing = operationTiming(options);
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  return withStoreLock(env, async (store, heldLock, controls) => {
    let view = inspectManagedState(env, current.digest, { heldLock });
    if (controls.recoveredRemoval || view.removal_phase) {
      fail('COMPANION_STORE_BLOCKED', 'companion removal may only be resumed by uninstall');
    }
    const beforeState = view.state;
    if (view.state === 'partial' && view.active) {
      cleanupRecoveryState(store);
      clearStagingState(store);
      cleanupSupersededVersions(store, view.active.version_key);
      view = inspectManagedState(env, current.digest, { heldLock });
    }
    if (view.state === 'missing' || (view.state === 'partial' && !view.active)) {
      const journal = ensureRemovalJournal(store, view, { hooks: options.hooks });
      const removal = controls.removeStore(journal);
      if (removal.recovery_pending) fail('COMPANION_STORE_CORRUPT', 'empty companion store removal is incomplete');
      fail('COMPANION_UPDATE_MISSING', 'no active companion exists');
    }
    if (view.state === 'current') return mutationReceipt({
      operation: 'update', status: 'unchanged', current, previousVersion: view.validated.version,
      binding: view.validated, beforeState, afterState: 'current', ...timing,
    });
    if (view.state !== 'update_available') fail('COMPANION_STORE_CORRUPT', 'companion cannot be updated from current state');
    const previous = view.validated.version;
    const active = await acquireCurrent(store, current, options);
    return mutationReceipt({
      operation: 'update', status: 'updated', current, previousVersion: previous,
      binding: active, beforeState, afterState: active.after_state,
      recoveryPending: active.recovery_pending, ...timing,
    });
  }, { hooks: options.hooks });
}

export async function uninstallCompanion(options = {}) {
  const timing = operationTiming(options);
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  return withStoreLock(env, async (store, heldLock, controls) => {
    const recovered = controls.recoveredRemoval;
    if (recovered && !store) {
      const binding = removalBinding(recovered.journal);
      return mutationReceipt({
        operation: 'uninstall', status: 'uninstalled', current,
        previousVersion: binding?.version ?? null,
        binding,
        beforeState: 'partial',
        afterState: recovered.recovery_pending ? 'partial' : 'missing',
        recoveryPending: recovered.recovery_pending,
        ...timing,
      });
    }
    const view = inspectManagedState(env, current.digest, { heldLock });
    const resuming = Boolean(recovered || view.removal_phase);
    if (listManagedLeases(store).length > 0 || listSessionCreateIntents(store).length > 0) {
      fail('COMPANION_LEASES_ACTIVE', 'managed leases block uninstall');
    }
    const journal = recovered?.journal ?? view.removal ?? ensureRemovalJournal(store, view, { hooks: options.hooks });
    const binding = removalBinding(journal);
    const previous = binding?.version ?? null;
    const removal = controls.removeStore(journal);
    const alreadyAbsent = !resuming && !removal.recovery_pending && journal.before_state === 'missing' && binding === null;
    return mutationReceipt({
      operation: 'uninstall', status: alreadyAbsent ? 'already_absent' : 'uninstalled', current,
      previousVersion: previous,
      binding,
      beforeState: resuming ? 'partial' : journal.before_state,
      afterState: removal.recovery_pending ? 'partial' : 'missing',
      recoveryPending: removal.recovery_pending,
      ...timing,
    });
  }, { hooks: options.hooks, allowStoreRemovalRecovery: true });
}

#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROGRESS_MAX_ORDINAL,
  PROGRESS_SCHEMA,
  isProgressStage,
  monotonicElapsedMilliseconds,
  writeProgressReceipt as publishProgressReceipt,
} from '../lib/exact-focus-channel-proof-contract.mjs';
import {
  SNAPSHOT_KEY_ENV,
  ProofError,
  boundsEqual,
  commandFailureFields,
  equalJSON,
  fail,
  parseJSON,
  stableFocusProjection,
  stablePublicChannelDigests,
} from '../lib/exact-focus-channel-native-proof-model.mjs';
import {
  armChannelCleanup,
  assertBuildAttestation,
  assertEnvironmentScope,
  assertPermissionPreconditions,
  assertRuntimeSource,
  assertSameDaemon,
  assertServiceBinding,
  assertStatusPreconditions,
  canonicalExistingPath,
  disarmChannelCleanup,
  focusEntry,
  isRegularFile,
  parseFixtureResultFile,
  processExists,
  removeChannelsQuiescent,
  removeFile,
  runAOSFailure,
  runAOSSuccess,
  sleep,
  startFixture,
  stopFixture,
  strictFocusEntries,
  verifyCapture,
  waitForFile,
  writeDaemonIdentity,
  writeJSONFile,
} from '../lib/exact-focus-channel-native-proof-runtime.mjs';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}


function parseArguments(args) {
  const options = {
    aos: valueAfter(args, '--aos'),
    helper: valueAfter(args, '--helper'),
    root: valueAfter(args, '--root'),
    tempRoot: valueAfter(args, '--temp-root'),
    channel: valueAfter(args, '--channel'),
    progress: valueAfter(args, '--progress'),
    runtimeRevision: valueAfter(args, '--runtime-source-revision'),
  };
  fail(Object.values(options).every((value) => typeof value === 'string' && value.length > 0), 'INVALID_ARGUMENTS');
  fail(path.dirname(options.progress) === options.tempRoot, 'INVALID_ARGUMENTS');
  return options;
}

function createProgressReporter(file) {
  const startedAt = process.hrtime.bigint();
  let ordinal = 0;
  let activeStage = null;
  let lastCompletedStage = null;
  const persist = () => {
    ordinal += 1;
    fail(ordinal <= PROGRESS_MAX_ORDINAL, 'PROGRESS_RECEIPT_WRITE_FAILED');
    try {
      publishProgressReceipt(file, {
        schema: PROGRESS_SCHEMA,
        ordinal,
        last_started_stage: activeStage,
        last_completed_stage: lastCompletedStage,
        elapsed_ms: monotonicElapsedMilliseconds(startedAt),
      });
    } catch {
      throw new ProofError('PROGRESS_RECEIPT_WRITE_FAILED');
    }
  };
  return Object.freeze({
    start(stage) {
      fail(isProgressStage(stage), 'PROGRESS_STAGE_INVALID');
      activeStage = stage;
      persist();
    },
    complete(stage) {
      fail(isProgressStage(stage) && activeStage === stage, 'PROGRESS_STAGE_INVALID');
      lastCompletedStage = stage;
      persist();
    },
  });
}

async function cleanupOnly(args) {
  assertEnvironmentScope();
  const options = {
    aos: valueAfter(args, '--aos'),
    root: valueAfter(args, '--root'),
  };
  const channel = valueAfter(args, '--channel');
  const negativeChannel = valueAfter(args, '--negative-channel');
  const identityPath = valueAfter(args, '--identity');
  const unrelatedDigestsPath = valueAfter(args, '--unrelated-digests');
  fail(Object.values(options).every((value) => typeof value === 'string' && value.length > 0), 'INVALID_ARGUMENTS');
  fail(typeof channel === 'string' && typeof negativeChannel === 'string', 'INVALID_ARGUMENTS');
  fail(isRegularFile(identityPath), 'DAEMON_IDENTITY_UNAVAILABLE');
  fail(isRegularFile(unrelatedDigestsPath), 'UNRELATED_CHANNEL_DIGESTS_UNAVAILABLE');
  const identity = parseJSON(fs.readFileSync(identityPath, 'utf8'), 'DAEMON_IDENTITY_INVALID');
  const unrelatedDigestsBefore = parseJSON(
    fs.readFileSync(unrelatedDigestsPath, 'utf8'),
    'UNRELATED_CHANNEL_DIGESTS_INVALID',
  );
  fail(
    Array.isArray(unrelatedDigestsBefore)
      && unrelatedDigestsBefore.every((digest) => /^[a-f0-9]{64}$/u.test(digest)),
    'UNRELATED_CHANNEL_DIGESTS_INVALID',
  );
  const removed = await removeChannelsQuiescent(options, identity, [channel, negativeChannel]);
  fail(removed, 'CHANNEL_CLEANUP_FAILED');
  const unrelatedDigestsAfter = stablePublicChannelDigests(
    strictFocusEntries(options, identity),
    [channel, negativeChannel],
    Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
  );
  fail(
    equalJSON(unrelatedDigestsAfter, unrelatedDigestsBefore),
    'UNRELATED_CHANNEL_STABLE_FIELDS_CHANGED',
  );
  assertPermissionPreconditions(
    runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
  );
  const postBinaryIdentity = assertRuntimeSource({
    ...options,
    runtimeRevision: identity.repo_revision,
  });
  fail(equalJSON(postBinaryIdentity, identity.binary_identity), 'RUNTIME_BINARY_CHANGED');
  const postFingerprint = assertBuildAttestation(
    runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
  );
  fail(postFingerprint === identity.build_source_fingerprint, 'BUILD_ATTESTATION_CHANGED');
  assertSameDaemon(options, identity);
  process.stdout.write(`${JSON.stringify({
    channels_absent: true,
    direct_capture_ready_preserved: true,
    runtime_provenance_preserved: true,
    shared_daemon_preserved: true,
    status: 'passed',
    unrelated_channel_stable_fields_preserved: true,
  })}\n`);
}

async function main() {
  assertEnvironmentScope();
  const options = parseArguments(process.argv.slice(2));
  const progress = createProgressReporter(options.progress);
  const negativeChannel = `${options.channel}-negative`;
  const files = {
    metadata: path.join(options.tempRoot, 'fixture.json'),
    fixturePID: path.join(options.tempRoot, 'fixture.pid'),
    closeRequest: path.join(options.tempRoot, 'close-target'),
    closeAck: path.join(options.tempRoot, 'target-closed.json'),
    stopRequest: path.join(options.tempRoot, 'stop-fixture'),
    cleanupReport: path.join(options.tempRoot, 'fixture-cleanup.json'),
    checkpointRequest: path.join(options.tempRoot, 'fixture-geometry-request.json'),
    checkpointReceipt: path.join(options.tempRoot, 'fixture-geometry-receipt.json'),
    cleanupArmed: path.join(options.tempRoot, 'channel-cleanup-armed'),
    daemonIdentity: path.join(options.tempRoot, 'daemon-identity.json'),
    unrelatedDigests: path.join(options.tempRoot, 'unrelated-channel-digests.json'),
    capture: path.join(options.tempRoot, 'exact-window.png'),
    preservedCapture: path.join(options.tempRoot, 'preserved-window.png'),
    failedCapture: path.join(options.tempRoot, 'missing-window.png'),
  };
  const channelIDs = [options.channel, negativeChannel];
  let fixture = null;
  let fixtureWindowsRemoved = false;
  let fixtureProcessReaped = false;
  let channelRemoved = false;
  let identity = null;
  let sharedDaemonPreserved = false;
  let unrelatedStableFieldsPreserved = false;
  let directCaptureReadyPreserved = false;
  let runtimeProvenancePreserved = false;
  let unrelatedDigestsBefore = null;
  let buildFingerprint = null;
  let binaryIdentity = null;

  try {
    progress.start('runtime_preflight');
    binaryIdentity = assertRuntimeSource(options);
    buildFingerprint = assertBuildAttestation(
      runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
    );
    const statusBefore = runAOSSuccess(options, ['status', '--json'], 'STATUS_PRECHECK_FAILED');
    const statusObservedAt = Date.now();
    const runtime = assertStatusPreconditions(statusBefore);
    const serviceBefore = runAOSSuccess(
      options,
      ['service', 'status', '--mode', 'repo', '--json'],
      'SERVICE_PRECHECK_FAILED',
    );
    assertServiceBinding(options, serviceBefore, runtime, binaryIdentity, statusObservedAt);
    assertPermissionPreconditions(
      runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_PRECHECK_FAILED'),
    );
    identity = {
      binary_path: canonicalExistingPath(options.aos),
      binary_identity: binaryIdentity,
      build_source_fingerprint: buildFingerprint,
      daemon_pid: runtime.daemon_pid,
      repo_revision: options.runtimeRevision,
      service_pid: runtime.service_pid,
    };
    writeDaemonIdentity(files.daemonIdentity, identity);
    progress.complete('runtime_preflight');

    progress.start('unrelated_channel_snapshot');
    const preexistingEntries = strictFocusEntries(options, identity);
    fail(channelIDs.every((id) => !preexistingEntries.some((entry) => entry?.id === id)), 'CHANNEL_ID_COLLISION');
    unrelatedDigestsBefore = stablePublicChannelDigests(
      preexistingEntries,
      channelIDs,
      Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
    );
    writeJSONFile(files.unrelatedDigests, unrelatedDigestsBefore);
    armChannelCleanup(files);
    progress.complete('unrelated_channel_snapshot');

    progress.start('fixture_startup');
    fixture = await startFixture(options, files);
    await waitForFile(files.metadata, 5_000);
    const metadata = parseFixtureResultFile(files.metadata);
    fail(metadata.pid === fixture.child.pid && metadata.ownership_token === fixture.ownershipToken, 'FIXTURE_IDENTITY_MISMATCH');
    fail(processExists(fixture.child.pid), 'FIXTURE_PROCESS_MISSING');
    fail(Number.isInteger(metadata.target_window_id) && metadata.target_window_id > 0, 'FIXTURE_WINDOW_ID_INVALID');
    fail(Number.isInteger(metadata.sibling_window_id) && metadata.sibling_window_id > 0, 'FIXTURE_WINDOW_ID_INVALID');
    fail(metadata.target_window_id !== metadata.sibling_window_id, 'FIXTURE_WINDOW_ID_INVALID');
    fail(metadata.same_process_windows === true, 'FIXTURE_PROCESS_MISMATCH');
    fail(metadata.layer_zero_windows === true, 'FIXTURE_LAYER_MISMATCH');
    fail(metadata.sibling_above_target === true, 'FIXTURE_ORDER_MISMATCH');
    fail(metadata.target_center_occluded === true, 'FIXTURE_OCCLUSION_MISSING');
    fail(Number(metadata.overlap_fraction) >= 0.35, 'FIXTURE_OVERLAP_INSUFFICIENT');
    progress.complete('fixture_startup');

    progress.start('sibling_subtree_rejection');
    runAOSFailure(options, [
      'focus', 'create',
      '--id', negativeChannel,
      '--window', String(metadata.target_window_id),
      '--pid', String(metadata.pid),
      '--depth', '15',
      '--subtree-identifier', metadata.sibling_identifier,
    ], 'WINDOW_NOT_FOUND', 'SIBLING_SUBTREE_NOT_REJECTED');
    fail(focusEntry(options, identity, negativeChannel) === null, 'NEGATIVE_CHANNEL_PUBLISHED');
    progress.complete('sibling_subtree_rejection');

    progress.start('target_channel_creation');
    runAOSSuccess(options, [
      'focus', 'create',
      '--id', options.channel,
      '--window', String(metadata.target_window_id),
      '--pid', String(metadata.pid),
      '--depth', '15',
      '--subtree-identifier', metadata.target_identifier,
    ], 'FOCUS_CREATE_FAILED');
    const createdEntry = focusEntry(options, identity, options.channel);
    fail(createdEntry?.kind === 'window', 'FOCUS_CHANNEL_KIND_MISMATCH');
    fail(createdEntry?.window_id === metadata.target_window_id, 'FOCUS_CHANNEL_WINDOW_MISMATCH');
    fail(createdEntry?.elements_count === 1, 'FOCUS_CHANNEL_SUBTREE_CARDINALITY');
    progress.complete('target_channel_creation');

    progress.start('initial_capture');
    const initial = await verifyCapture(
      options,
      metadata,
      files,
      fixture,
      files.capture,
      'INITIAL',
    );
    removeFile(files.capture);
    fail(!fs.existsSync(files.capture), 'CAPTURE_ARTIFACT_CLEANUP_FAILED');
    progress.complete('initial_capture');

    progress.start('rejected_refresh');
    const beforeRejectedRefresh = focusEntry(options, identity, options.channel);
    fail(beforeRejectedRefresh !== null, 'LAST_GOOD_CHANNEL_MISSING');
    const preservedProjection = stableFocusProjection(beforeRejectedRefresh);
    runAOSFailure(options, [
      'focus', 'update',
      '--id', options.channel,
      '--depth', '15',
      '--subtree-identifier', metadata.sibling_identifier,
    ], 'WINDOW_NOT_FOUND', 'SIBLING_REFRESH_NOT_REJECTED');
    const afterRejectedRefresh = focusEntry(options, identity, options.channel);
    fail(afterRejectedRefresh !== null, 'REJECTED_REFRESH_REMOVED_CHANNEL');
    fail(equalJSON(stableFocusProjection(afterRejectedRefresh), preservedProjection), 'REJECTED_REFRESH_CHANGED_PUBLICATION');
    progress.complete('rejected_refresh');

    progress.start('preserved_capture');
    const preserved = await verifyCapture(
      options,
      metadata,
      files,
      fixture,
      files.preservedCapture,
      'PRESERVED',
    );
    fail(
      preserved.analysis.decoded_rgba_sha256 === initial.analysis.decoded_rgba_sha256,
      'REJECTED_REFRESH_CHANGED_DECODED_PIXELS',
    );
    fail(equalJSON(preserved.axProjection, initial.axProjection), 'REJECTED_REFRESH_CHANGED_AX');
    fail(equalJSON(preserved.targetProjection, initial.targetProjection), 'REJECTED_REFRESH_CHANGED_TARGET_AX');
    removeFile(files.preservedCapture);
    fail(!fs.existsSync(files.preservedCapture), 'PRESERVED_CAPTURE_ARTIFACT_CLEANUP_FAILED');
    progress.complete('preserved_capture');

    progress.start('target_close');
    fs.writeFileSync(files.closeRequest, 'close\n', { mode: 0o600 });
    await waitForFile(files.closeAck, 3_000);
    const closeAck = parseJSON(fs.readFileSync(files.closeAck, 'utf8'), 'TARGET_CLOSE_INVALID');
    fail(closeAck.target_window_removed === true, 'TARGET_WINDOW_STILL_PRESENT');
    await sleep(1_250);
    progress.complete('target_close');

    progress.start('missing_target_refresh');
    runAOSFailure(options, [
      'focus', 'update', '--id', options.channel, '--depth', '15',
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_REFRESH_NOT_REJECTED');
    const afterMissingRefresh = focusEntry(options, identity, options.channel);
    fail(afterMissingRefresh !== null, 'MISSING_REFRESH_REMOVED_CHANNEL');
    fail(equalJSON(stableFocusProjection(afterMissingRefresh), preservedProjection), 'MISSING_REFRESH_CHANGED_PUBLICATION');
    progress.complete('missing_target_refresh');

    progress.start('missing_target_capture');
    removeFile(files.failedCapture);
    runAOSFailure(options, [
      'see', 'capture', '--channel', options.channel, '--out', files.failedCapture,
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_CAPTURE_NOT_REJECTED');
    fail(!fs.existsSync(files.failedCapture), 'FAILED_CAPTURE_ARTIFACT_PRESENT');
    progress.complete('missing_target_capture');

    progress.start('channel_cleanup');
    channelRemoved = await removeChannelsQuiescent(options, identity, channelIDs);
    fail(channelRemoved, 'CHANNEL_RESIDUE_PRESENT');
    disarmChannelCleanup(files);
    progress.complete('channel_cleanup');

    progress.start('fixture_cleanup');
    const fixtureCleanup = await stopFixture(files, fixture);
    fixtureWindowsRemoved = fixtureCleanup.fixtureWindowsRemoved;
    fixtureProcessReaped = fixtureCleanup.fixtureProcessReaped;
    fail(fixtureWindowsRemoved, 'FIXTURE_CLEANUP_FAILED');
    fail(fixtureProcessReaped, 'FIXTURE_PROCESS_NOT_REAPED');
    progress.complete('fixture_cleanup');

    progress.start('postflight_attestation');
    const unrelatedDigestsAfter = stablePublicChannelDigests(
      strictFocusEntries(options, identity),
      channelIDs,
      Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
    );
    unrelatedStableFieldsPreserved = equalJSON(
      unrelatedDigestsAfter,
      unrelatedDigestsBefore,
    );
    fail(unrelatedStableFieldsPreserved, 'UNRELATED_CHANNEL_STABLE_FIELDS_CHANGED');
    assertPermissionPreconditions(
      runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
    );
    directCaptureReadyPreserved = true;
    const postBinaryIdentity = assertRuntimeSource(options);
    fail(equalJSON(postBinaryIdentity, binaryIdentity), 'RUNTIME_BINARY_CHANGED');
    const postFingerprint = assertBuildAttestation(
      runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
    );
    fail(postFingerprint === buildFingerprint, 'BUILD_ATTESTATION_CHANGED');
    const statusAfter = runAOSSuccess(options, ['status', '--json'], 'STATUS_POSTCHECK_FAILED');
    const statusAfterObservedAt = Date.now();
    const runtimeAfter = assertStatusPreconditions(statusAfter);
    fail(runtimeAfter.daemon_pid === identity.daemon_pid, 'SHARED_DAEMON_CHANGED');
    fail(runtimeAfter.service_pid === identity.service_pid, 'SHARED_DAEMON_CHANGED');
    const serviceAfter = runAOSSuccess(
      options,
      ['service', 'status', '--mode', 'repo', '--json'],
      'SERVICE_POSTCHECK_FAILED',
    );
    assertServiceBinding(options, serviceAfter, runtimeAfter, postBinaryIdentity, statusAfterObservedAt);
    runtimeProvenancePreserved = true;
    sharedDaemonPreserved = true;
    progress.complete('postflight_attestation');

    const summary = {
      status: 'passed',
      command_error_code: null,
      command_admission_ambiguous: false,
      repo_revision: options.runtimeRevision,
      build_source_fingerprint: buildFingerprint,
      daemon_path_start_order_bound: true,
      same_process_windows: true,
      overlap_verified: true,
      overlap_fraction: Number(metadata.overlap_fraction.toFixed(4)),
      sibling_above_target: true,
      sibling_subtree_rejected: true,
      exact_window_pixels_verified: true,
      magenta_fraction: Number(initial.analysis.magenta_fraction.toFixed(4)),
      green_fraction: Number(initial.analysis.green_fraction.toFixed(4)),
      cyan_fraction: Number(initial.analysis.cyan_fraction.toFixed(4)),
      capture_width: initial.analysis.width,
      capture_height: initial.analysis.height,
      capture_byte_count: initial.captureStat.size,
      capture_sha256: initial.captureDigest,
      exact_ax_scope_verified: true,
      ax_element_count: initial.capture.elements.length,
      unique_window_id_count: new Set(initial.capture.elements.map((element) => element.window_id)).size,
      foreign_window_id_count: 0,
      sibling_refresh_rejected: true,
      rejected_refresh_preserved: true,
      rejected_refresh_recaptured: true,
      missing_target_refresh_rejected: true,
      missing_target_capture_rejected: true,
      failed_capture_artifact_absent: true,
      channel_removed: channelRemoved,
      fixture_windows_removed: fixtureWindowsRemoved,
      fixture_process_reaped: fixtureProcessReaped,
      unrelated_channel_stable_fields_preserved: unrelatedStableFieldsPreserved,
      direct_capture_ready_preserved: directCaptureReadyPreserved,
      runtime_provenance_preserved: runtimeProvenancePreserved,
      shared_daemon_preserved: sharedDaemonPreserved,
      microphone_requested: false,
      raw_capture_logged: false,
      pixels_persisted: false,
      cleanup_complete: channelRemoved
        && fixtureWindowsRemoved
        && fixtureProcessReaped
        && unrelatedStableFieldsPreserved
        && directCaptureReadyPreserved
        && runtimeProvenancePreserved
        && sharedDaemonPreserved,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    const admissionAmbiguous = error?.ambiguous === true;
    if (!admissionAmbiguous) {
      removeFile(files.capture);
      removeFile(files.preservedCapture);
      removeFile(files.failedCapture);
    }
    if (!admissionAmbiguous && identity !== null && isRegularFile(files.cleanupArmed)) {
      try {
        channelRemoved = await removeChannelsQuiescent(options, identity, channelIDs);
        if (channelRemoved) disarmChannelCleanup(files);
      } catch {
        channelRemoved = false;
      }
    }
    if (!admissionAmbiguous) {
      const fixtureCleanup = await stopFixture(files, fixture);
      fixtureWindowsRemoved = fixtureCleanup.fixtureWindowsRemoved;
      fixtureProcessReaped = fixtureCleanup.fixtureProcessReaped;
    }
    if (!admissionAmbiguous && identity !== null) {
      try {
        if (Array.isArray(unrelatedDigestsBefore)) {
          const unrelatedDigestsAfter = stablePublicChannelDigests(
            strictFocusEntries(options, identity),
            channelIDs,
            Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
          );
          unrelatedStableFieldsPreserved = equalJSON(
            unrelatedDigestsAfter,
            unrelatedDigestsBefore,
          );
        }
        assertPermissionPreconditions(
          runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
        );
        directCaptureReadyPreserved = true;
        const postBinaryIdentity = assertRuntimeSource(options);
        const postFingerprint = assertBuildAttestation(
          runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
        );
        runtimeProvenancePreserved = binaryIdentity !== null
          && equalJSON(postBinaryIdentity, binaryIdentity)
          && postFingerprint === buildFingerprint;
        assertSameDaemon(options, identity);
        sharedDaemonPreserved = true;
      } catch {
        sharedDaemonPreserved = false;
      }
    }
    const summary = {
      status: 'failed',
      ...commandFailureFields(error),
      channel_removed: channelRemoved,
      fixture_windows_removed: fixtureWindowsRemoved,
      fixture_process_reaped: fixtureProcessReaped,
      unrelated_channel_stable_fields_preserved: unrelatedStableFieldsPreserved,
      direct_capture_ready_preserved: directCaptureReadyPreserved,
      runtime_provenance_preserved: runtimeProvenancePreserved,
      shared_daemon_preserved: sharedDaemonPreserved,
      microphone_requested: false,
      raw_capture_logged: false,
      pixels_persisted: fs.existsSync(files.capture)
        || fs.existsSync(files.preservedCapture)
        || fs.existsSync(files.failedCapture),
      cleanup_complete: channelRemoved
        && fixtureWindowsRemoved
        && fixtureProcessReaped
        && unrelatedStableFieldsPreserved
        && directCaptureReadyPreserved
        && runtimeProvenancePreserved
        && sharedDaemonPreserved,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = 1;
  }
}

const [mode, ...modeArgs] = process.argv.slice(2);
if (['--command-telemetry-self-test', '--fixture-result-parser-self-test',
  '--channel-snapshot-self-test'].includes(mode)) {
  const { runNativeProofSelfTest } = await import(
    '../lib/exact-focus-channel-native-proof-self-test.mjs'
  );
  runNativeProofSelfTest(mode);
} else if (mode === '--cleanup-only') {
  try {
    await cleanupOnly(modeArgs);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof ProofError ? error.code : 'CHANNEL_CLEANUP_FAILED',
      status: 'failed',
    })}\n`);
    process.exitCode = 1;
  }
} else {
  await main();
}

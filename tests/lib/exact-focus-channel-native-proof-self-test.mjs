import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { AOS_COMMAND_ERROR_MAX_BYTES } from './exact-focus-channel-proof-contract.mjs';
import {
  FIXTURE_FAILURE_CODE_LIST,
  FIXTURE_METADATA_SCHEMA,
  FIXTURE_RESULT_MAX_BYTES,
  ProofError,
  commandFailureFields,
  equalJSON,
  fail,
  stablePublicChannelDigests,
} from './exact-focus-channel-native-proof-model.mjs';
import {
  CLOSE_ACK_MAX_BYTES,
  DAEMON_IDENTITY_MAX_BYTES,
  FIXTURE_CLEANUP_MAX_BYTES,
  UNRELATED_CHANNEL_DIGESTS_MAX_BYTES,
  parseCloseAckFile,
  parseDaemonIdentityFile,
  parseFixtureCleanupFile,
  parseFixtureResultFile,
  parseUnrelatedChannelDigestsFile,
  readBoundedRegularFile,
  writeDaemonIdentity,
  writeUnrelatedChannelDigests,
} from './exact-focus-channel-private-records.mjs';
import {
  parsePrivateRecordUntilDeadline,
  runAOSFailure,
  runAOSSuccess,
} from './exact-focus-channel-native-proof-runtime.mjs';

export function commandTelemetrySelfTest() {
  const rawSentinel = 'éRAW_AOS_COMMAND_SENTINEL_MUST_NOT_LEAK';
  const options = { aos: '/offline/fake-aos', root: '/offline/fake-root' };
  const mutation = ['focus', 'create'];
  const result = (code, error = rawSentinel, stream = 'stderr') => ({
    status: 1,
    signal: null,
    stdout: stream === 'stdout' ? JSON.stringify({ code, error }) : '',
    stderr: stream === 'stderr' ? JSON.stringify({ code, error }) : '',
  });
  const execute = (candidate) => () => candidate;
  const captureProofError = (operation) => {
    let observed = null;
    try {
      operation();
    } catch (error) {
      observed = error;
    }
    fail(observed instanceof ProofError, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    return observed;
  };
  const resultAtExactBytes = (code, byteCount) => {
    const payload = { code, error: rawSentinel, padding: '' };
    const baseByteCount = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    fail(baseByteCount <= byteCount, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    payload.padding = 'x'.repeat(byteCount - baseByteCount);
    const stderr = JSON.stringify(payload);
    fail(Buffer.byteLength(stderr, 'utf8') === byteCount, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    return { status: 1, signal: null, stdout: '', stderr };
  };
  const precommitCodes = [
    'CHANNEL_NOT_FOUND',
    'CHANNEL_STALE',
    'DUPLICATE_ID',
    'INVALID_DEPTH',
    'NATIVE_AX_ROOT_MISMATCH',
    'WINDOW_NOT_FOUND',
  ];
  const rejections = precommitCodes.map((typedCode) => captureProofError(() => (
    runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(result(typedCode)))
  )));
  const expectedFailure = runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    execute(result('WINDOW_NOT_FOUND', rawSentinel, 'stdout')),
  );
  let observedFailureCommandClass = null;
  const classedFailure = runAOSFailure(
    options,
    ['see', 'capture'],
    'WINDOW_NOT_FOUND',
    'MISSING_TARGET_CAPTURE_NOT_REJECTED',
    {
      commandClass: 'missing_target_capture',
      execute: (_file, _args, executionOptions) => {
        observedFailureCommandClass = executionOptions.commandClass;
        return result('WINDOW_NOT_FOUND', rawSentinel, 'stdout');
      },
    },
  );
  const stderrPriority = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    { execute: execute({
      status: 1,
      signal: null,
      stdout: JSON.stringify({ code: 'WINDOW_NOT_FOUND', error: rawSentinel }),
      stderr: JSON.stringify({ code: 'INTERNAL', error: rawSentinel }),
    }) },
  ));
  const mismatchedPrecommitCode = captureProofError(() => runAOSFailure(
    options,
    ['see', 'capture'],
    'WINDOW_NOT_FOUND',
    'MISSING_TARGET_CAPTURE_NOT_REJECTED',
    { execute: execute(result('CHANNEL_STALE', rawSentinel, 'stdout')) },
  ));
  const invalidFailureExecution = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    { execute: null },
  ));
  const typedAmbiguous = ['DAEMON_UNREACHABLE', 'DAEMON_UNAVAILABLE', 'INTERNAL'].map(
    (typedCode) => captureProofError(() => (
      runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(result(typedCode)))
    )),
  );
  const statusZeroTypedEnvelope = captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute({
      status: 0,
      signal: null,
      stdout: JSON.stringify({ code: 'WINDOW_NOT_FOUND', error: rawSentinel }),
      stderr: '',
    }),
  ));
  const statusZeroTypedStderr = [
    JSON.stringify({ data: { channels: [] } }),
    rawSentinel,
  ].map((stdout) => captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute({
      status: 0,
      signal: null,
      stdout,
      stderr: JSON.stringify({ code: 'WINDOW_NOT_FOUND', error: rawSentinel }),
    }),
  )));
  const exactLimit = captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute(resultAtExactBytes('INTERNAL', AOS_COMMAND_ERROR_MAX_BYTES)),
  ));
  const overLimit = captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute(resultAtExactBytes('INTERNAL', AOS_COMMAND_ERROR_MAX_BYTES + 1)),
  ));
  const untypedAmbiguous = [
    { status: null, signal: 'SIGKILL', stdout: '', stderr: rawSentinel },
    result('UNRECOGNIZED_UPPERCASE_CODE'),
    { status: 1, signal: null, stdout: '', stderr: '' },
    { status: 0, signal: null, stdout: rawSentinel, stderr: '' },
  ].map((candidate) => captureProofError(() => (
    runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(candidate))
  )));
  const executionAmbiguous = [
    'COMMAND_TIMEOUT',
    'COMMAND_LAUNCH_FAILED',
    'COMMAND_INTERRUPTED',
  ].map((executionCode) => captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    () => { throw new ProofError(executionCode, { ambiguous: true }); },
  )));
  const unexpectedSuccess = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    { execute: execute({ status: 0, signal: null, stdout: rawSentinel, stderr: '' }) },
  ));
  const readOnlyUntyped = captureProofError(() => runAOSSuccess(
    options,
    ['focus', 'list'],
    'FOCUS_LIST_FAILED',
    execute({ status: 1, signal: null, stdout: '', stderr: rawSentinel }),
  ));
  const observed = [
    ...rejections,
    stderrPriority,
    ...typedAmbiguous,
    statusZeroTypedEnvelope,
    ...statusZeroTypedStderr,
    exactLimit,
    overLimit,
    ...untypedAmbiguous,
    ...executionAmbiguous,
    unexpectedSuccess,
    readOnlyUntyped,
  ].map(commandFailureFields);

  fail(rejections.every((error, index) => (
    error.commandErrorCode === precommitCodes[index]
      && error.commandAdmissionAmbiguous === false
  )), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(expectedFailure === undefined, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(classedFailure === undefined
    && observedFailureCommandClass === 'missing_target_capture',
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(mismatchedPrecommitCode.commandErrorCode === 'CHANNEL_STALE'
    && mismatchedPrecommitCode.commandAdmissionAmbiguous === false,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(invalidFailureExecution.code === 'COMMAND_CLASS_INVALID'
    && invalidFailureExecution.commandAdmissionAmbiguous === false,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(stderrPriority.commandErrorCode === 'INTERNAL'
    && stderrPriority.commandAdmissionAmbiguous === true,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(typedAmbiguous.every((error) => (
    error.commandAdmissionAmbiguous === true && error.commandErrorCode !== null
  )), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(statusZeroTypedEnvelope.commandAdmissionAmbiguous === true
    && statusZeroTypedEnvelope.commandErrorCode === null,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(statusZeroTypedStderr.every((error) => (
    error.commandAdmissionAmbiguous === true && error.commandErrorCode === null
  )), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(exactLimit.commandErrorCode === 'INTERNAL'
    && exactLimit.commandAdmissionAmbiguous === true
    && overLimit.commandErrorCode === null
    && overLimit.commandAdmissionAmbiguous === true,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(untypedAmbiguous.every((error) => (
    error.commandAdmissionAmbiguous === true && error.commandErrorCode === null
  )), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(executionAmbiguous.every((error) => (
    error.ambiguous === true
      && error.commandAdmissionAmbiguous === true
      && error.commandErrorCode === null
  )), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(unexpectedSuccess.commandAdmissionAmbiguous === true
    && unexpectedSuccess.commandErrorCode === null,
  'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(readOnlyUntyped.commandAdmissionAmbiguous === false,
    'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(!JSON.stringify(observed).includes(rawSentinel), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');

  process.stdout.write(`${JSON.stringify({
    allowlisted_command_error_code: true,
    ambiguous_command_admission: true,
    dedicated_missing_target_timeout_class: true,
    exact_utf8_byte_boundaries: true,
    invalid_failure_execution_rejected: true,
    legacy_failure_executor_supported: true,
    mismatched_precommit_code_preserved: true,
    precommit_rejection_nonambiguous: true,
    raw_command_output_reflected: false,
    read_only_failure_nonadmitting: true,
    status: 'passed',
    stderr_priority: true,
    terminal_failure_projection: true,
    unknown_command_error_suppressed: true,
    unexpected_success_ambiguous: true,
    wrappers_exercised: true,
  })}\n`);
}

export function channelSnapshotSelfTest() {
  const native = {
    id: 'native-existing', kind: 'window', app: 'Fixture', elements_count: 2,
    updated_at: '2026-08-09T12:00:00Z', window_id: 41,
  };
  const browser = {
    id: 'browser-existing', kind: 'browser', session: 'browser-existing', mode: 'cdp',
    updated_at: '2026-08-09T12:00:00Z', attach: 'extension', headless: false,
    browser_window_id: 7, active_url: 'https://example.invalid/one',
  };
  const proof = { id: 'proof-owned', kind: 'window', elements_count: 1 };
  const key = Buffer.alloc(32, 0x42);
  const baseline = stablePublicChannelDigests([native, proof, browser], ['proof-owned'], key);
  fail(equalJSON(baseline, stablePublicChannelDigests([
    { ...browser },
    {
      window_id: 41, updated_at: native.updated_at, kind: 'window', id: native.id,
      elements_count: 2, app: 'Fixture',
    },
  ], [], key)), 'CHANNEL_SNAPSHOT_CANONICALIZATION_FAILED');
  fail(equalJSON(baseline, stablePublicChannelDigests([
    { ...native, elements_count: 3, updated_at: '2026-08-09T12:00:01Z' }, browser,
  ], [], key)), 'CHANNEL_SNAPSHOT_VOLATILE_REFRESH_REJECTED');
  const mutations = [
    [{ ...native, app: 'Other Fixture' }, browser],
    [{ ...native, window_id: 42 }, browser],
    [native, { ...browser, attach: 'cdp' }],
    [native, { ...browser, headless: true }],
    [native, { ...browser, active_url: 'https://example.invalid/two' }],
    [native, { ...browser, session: 'other-session' }],
    [native, { ...browser, updated_at: '2026-08-09T12:00:01Z' }],
  ];
  fail(mutations.every((entries) => !equalJSON(
    baseline, stablePublicChannelDigests(entries, [], key),
  )), 'CHANNEL_SNAPSHOT_MUTATION_UNDETECTED');
  process.stdout.write(`${JSON.stringify({
    keyed_stable_public_channel_snapshot: true, status: 'passed',
  })}\n`);
}

export function fixtureResultParserSelfTest() {
  const rawSentinel = 'RAW_FIXTURE_RESULT_SENTINEL_MUST_NOT_LEAK';
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fixture-result-parser-'));
  const resultFile = path.join(temporaryRoot, 'fixture-result.json');
  const metadata = {
    schema: FIXTURE_METADATA_SCHEMA,
    pid: 101,
    target_window_id: 201,
    sibling_window_id: 202,
    target_bounds: { x: 10, y: 20, width: 480, height: 320 },
    sibling_bounds: { x: 80, y: 55, width: 340, height: 250 },
    display_id: 1,
    scale_factor: 2,
    target_identifier: 'target',
    sibling_identifier: 'sibling',
    ownership_token: '0123456789abcdef0123456789abcdef',
    same_process_windows: true,
    layer_zero_windows: true,
    sibling_above_target: true,
    target_center_occluded: true,
    overlap_fraction: 0.5,
  };
  const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  const parseBytes = (bytes) => {
    fs.writeFileSync(resultFile, bytes, { mode: 0o600 });
    return parseFixtureResultFile(resultFile);
  };
  const caughtCode = (bytes) => {
    try {
      parseBytes(bytes);
      return null;
    } catch (error) {
      return error instanceof ProofError ? error.code : 'FIXTURE_PARSER_SELF_TEST_FAILED';
    }
  };
  let receipt;
  try {
    fail(parseBytes(encode({ status: 'ready', metadata })).schema === FIXTURE_METADATA_SCHEMA,
      'FIXTURE_PARSER_SELF_TEST_FAILED');
    fail(FIXTURE_FAILURE_CODE_LIST.every((errorCodeValue) => caughtCode(encode({
      status: 'failed', error_code: errorCodeValue,
    })) === errorCodeValue), 'FIXTURE_PARSER_SELF_TEST_FAILED');
    const fixtureAtBytes = (targetBytes) => {
      const value = { status: 'ready', metadata: { ...metadata } };
      const baseBytes = encode(value).length;
      value.metadata.target_identifier += 'x'.repeat(targetBytes - baseBytes);
      return encode(value);
    };
    const exactBoundary = fixtureAtBytes(FIXTURE_RESULT_MAX_BYTES);
    const overBoundary = fixtureAtBytes(FIXTURE_RESULT_MAX_BYTES + 1);
    fail(exactBoundary.length === FIXTURE_RESULT_MAX_BYTES
      && parseBytes(exactBoundary).target_identifier.endsWith('x')
      && overBoundary.length === FIXTURE_RESULT_MAX_BYTES + 1
      && caughtCode(overBoundary) === 'FIXTURE_METADATA_INVALID',
    'FIXTURE_PARSER_SELF_TEST_FAILED');
    const untrusted = [
      Buffer.from(`{${rawSentinel}`),
      encode({ status: 'failed', error_code: `UNKNOWN_${rawSentinel}` }),
      encode({ status: 'failed', error_code: 'FIXTURE_HELPER_FAILED', raw: rawSentinel }),
      encode({ status: 'failed', error_code: 'FIXTURE_TARGET_CONTROL_NOT_READY' }),
      encode({ status: 'failed', error_code: 'FIXTURE_SIBLING_CONTROL_NOT_READY' }),
    ];
    const observed = untrusted.map(caughtCode);
    fail(observed.every((code) => code === 'FIXTURE_METADATA_INVALID'),
      'FIXTURE_PARSER_SELF_TEST_FAILED');
    const symlinkTarget = path.join(temporaryRoot, 'symlink-target.json');
    const symlinkResult = path.join(temporaryRoot, 'symlink-result.json');
    fs.writeFileSync(symlinkTarget, encode({
      status: 'failed', error_code: 'FIXTURE_HELPER_FAILED',
    }), { mode: 0o600 });
    fs.symlinkSync(symlinkTarget, symlinkResult);
    let symlinkCode = null;
    try { parseFixtureResultFile(symlinkResult); } catch (error) {
      symlinkCode = error instanceof ProofError ? error.code : null;
    }
    fail(symlinkCode === 'FIXTURE_METADATA_INVALID', 'FIXTURE_PARSER_SELF_TEST_FAILED');
    fail(!JSON.stringify(observed).includes(rawSentinel), 'FIXTURE_PARSER_SELF_TEST_FAILED');
    receipt = {
      allowlisted_failure_codes: FIXTURE_FAILURE_CODE_LIST,
      exact_byte_boundaries: true,
      fixture_result_parser_self_test: true,
      malformed_unknown_fail_closed: true,
      raw_fixture_output_reflected: false,
      regular_file_enforced: true,
      retired_aggregate_codes_rejected: true,
      status: 'passed',
    };
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

export async function recoveryRecordSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-exact-recovery-record-'));
  const identity = (targetBytes = null) => {
    const value = {
      binary_identity: {
        dev: 1, ino: 2, mode: 0o100755, mtime_ms: 3, sha256: 'a'.repeat(64), size: 4,
      },
      binary_path: '/', build_source_fingerprint: 'b'.repeat(64), daemon_pid: 101,
      repo_revision: 'c'.repeat(40), service_pid: 102,
    };
    if (targetBytes !== null) {
      const baseBytes = Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8');
      fail(targetBytes >= baseBytes, 'RECOVERY_RECORD_SELF_TEST_FAILED');
      value.binary_path += 'x'.repeat(targetBytes - baseBytes);
    }
    return value;
  };
  const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  const paddedBytes = (value, targetBytes) => {
    const json = JSON.stringify(value);
    const paddingLength = targetBytes - Buffer.byteLength(json, 'utf8') - 1;
    fail(paddingLength >= 0 && ['[', '{'].includes(json[0]), 'RECOVERY_RECORD_SELF_TEST_FAILED');
    return Buffer.from(`${json[0]}${' '.repeat(paddingLength)}${json.slice(1)}\n`, 'utf8');
  };
  const writeRaw = (file, value, mode = 0o600) => {
    fs.writeFileSync(file, value, { mode });
    fs.chmodSync(file, mode);
  };
  const failureCode = (operation) => {
    try { operation(); return null; } catch (error) {
      return error instanceof ProofError ? error.code : 'RECOVERY_RECORD_SELF_TEST_FAILED';
    }
  };
  const directoryEntries = () => fs.readdirSync(root).sort();
  let receipt;
  try {
    const valid = path.join(root, 'valid.json');
    writeRaw(valid, bytes(identity()));
    fail(parseDaemonIdentityFile(valid).daemon_pid === 101, 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const exact = path.join(root, 'exact.json');
    const exactIdentity = identity(DAEMON_IDENTITY_MAX_BYTES);
    writeRaw(exact, bytes(exactIdentity));
    fail(bytes(exactIdentity).length === DAEMON_IDENTITY_MAX_BYTES
      && parseDaemonIdentityFile(exact).binary_path === exactIdentity.binary_path,
    'RECOVERY_RECORD_SELF_TEST_FAILED');
    const oversized = path.join(root, 'oversized.json');
    writeRaw(oversized, bytes(identity(DAEMON_IDENTITY_MAX_BYTES + 1)));
    fail(failureCode(() => parseDaemonIdentityFile(oversized)) === 'DAEMON_IDENTITY_INVALID',
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    fail([null, 7, {}, []].every((binaryPath) => {
      writeRaw(valid, bytes({ ...identity(), binary_path: binaryPath }));
      return failureCode(() => parseDaemonIdentityFile(valid)) === 'DAEMON_IDENTITY_INVALID';
    }), 'RECOVERY_RECORD_SELF_TEST_FAILED');
    fail([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1].every((maximumBytes) => (
      failureCode(() => readBoundedRegularFile(
        path.join(root, 'absent'), maximumBytes, 'MAXIMUM_INVALID', 'FILE_OPENED',
      )) === 'MAXIMUM_INVALID'
    )), 'RECOVERY_RECORD_SELF_TEST_FAILED');

    const malformed = [
      ['empty.json', Buffer.alloc(0), 0o600],
      ['wrong-mode.json', bytes(identity()), 0o644],
      ['invalid-utf8.json', Buffer.from([0xc3, 0x28, 0x0a]), 0o600],
      ['missing-newline.json', Buffer.from(JSON.stringify(identity())), 0o600],
      ['multiple-lines.json', Buffer.from(`${JSON.stringify(identity())}\n{}\n`), 0o600],
    ];
    for (const [name, contents, mode] of malformed) {
      const file = path.join(root, name);
      writeRaw(file, contents, mode);
      fail(failureCode(() => parseDaemonIdentityFile(file)) === 'DAEMON_IDENTITY_INVALID',
        'RECOVERY_RECORD_SELF_TEST_FAILED');
    }
    const symlinkTarget = path.join(root, 'symlink-target.json');
    const symlink = path.join(root, 'symlink.json');
    writeRaw(symlinkTarget, bytes(identity()));
    fs.symlinkSync(symlinkTarget, symlink);
    const symlinkBefore = fs.lstatSync(symlink, { bigint: true });
    const symlinkTargetBefore = fs.lstatSync(symlinkTarget, { bigint: true });
    const symlinkTargetBytes = fs.readFileSync(symlinkTarget);
    const symlinkValue = fs.readlinkSync(symlink);
    const symlinkEntries = directoryEntries();
    fail(failureCode(() => parseDaemonIdentityFile(symlink)) === 'DAEMON_IDENTITY_UNAVAILABLE'
      && failureCode(() => writeDaemonIdentity(symlink, identity())) === 'DAEMON_IDENTITY_WRITE_FAILED',
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const symlinkAfter = fs.lstatSync(symlink, { bigint: true });
    const symlinkTargetAfter = fs.lstatSync(symlinkTarget, { bigint: true });
    fail(symlinkBefore.isSymbolicLink() && symlinkAfter.isSymbolicLink()
      && symlinkBefore.dev === symlinkAfter.dev && symlinkBefore.ino === symlinkAfter.ino
      && symlinkTargetBefore.isFile() && symlinkTargetAfter.isFile()
      && symlinkTargetBefore.dev === symlinkTargetAfter.dev
      && symlinkTargetBefore.ino === symlinkTargetAfter.ino
      && fs.readlinkSync(symlink) === symlinkValue
      && fs.readFileSync(symlinkTarget).equals(symlinkTargetBytes)
      && equalJSON(directoryEntries(), symlinkEntries), 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const fifo = path.join(root, 'record.fifo');
    execFileSync('/usr/bin/mkfifo', [fifo], { timeout: 1_000 });
    fail(failureCode(() => parseDaemonIdentityFile(fifo)) === 'DAEMON_IDENTITY_INVALID',
      'RECOVERY_RECORD_SELF_TEST_FAILED');

    const grown = path.join(root, 'grown.json');
    writeRaw(grown, bytes(identity()));
    fail(failureCode(() => parseDaemonIdentityFile(grown, () => {
      fs.appendFileSync(grown, 'x');
    })) === 'DAEMON_IDENTITY_INVALID', 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const swapped = path.join(root, 'swapped.json');
    const held = path.join(root, 'held.json');
    const original = identity();
    writeRaw(swapped, bytes(original));
    const observed = parseDaemonIdentityFile(swapped, () => {
      fs.renameSync(swapped, held);
      writeRaw(swapped, bytes({ ...original, daemon_pid: 999 }));
    });
    fail(observed.daemon_pid === original.daemon_pid, 'RECOVERY_RECORD_SELF_TEST_FAILED');

    const writer = path.join(root, 'writer.json');
    const writerEntries = directoryEntries();
    writeDaemonIdentity(writer, exactIdentity);
    fail(parseDaemonIdentityFile(writer).binary_path === exactIdentity.binary_path
      && equalJSON(directoryEntries(), [...writerEntries, 'writer.json'].sort()),
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const writerOversized = path.join(root, 'writer-oversized.json');
    const oversizedEntries = directoryEntries();
    fail(failureCode(() => writeDaemonIdentity(
      writerOversized, identity(DAEMON_IDENTITY_MAX_BYTES + 1),
    )) === 'DAEMON_IDENTITY_WRITE_FAILED' && !fs.existsSync(writerOversized),
    'RECOVERY_RECORD_SELF_TEST_FAILED');
    fail(equalJSON(directoryEntries(), oversizedEntries), 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const existing = path.join(root, 'existing.json');
    const preserved = Buffer.from('preserved\n');
    writeRaw(existing, preserved);
    const existingEntries = directoryEntries();
    fail(failureCode(() => writeDaemonIdentity(existing, identity())) === 'DAEMON_IDENTITY_WRITE_FAILED'
      && fs.readFileSync(existing).equals(preserved)
      && equalJSON(directoryEntries(), existingEntries), 'RECOVERY_RECORD_SELF_TEST_FAILED');

    const digests = path.join(root, 'digests.json');
    const digest = 'd'.repeat(64);
    const digestVector = Array(32).fill(digest);
    const digestBoundary = path.join(root, 'digests-boundary.json');
    writeRaw(digestBoundary, paddedBytes(digestVector, UNRELATED_CHANNEL_DIGESTS_MAX_BYTES));
    fail(equalJSON(parseUnrelatedChannelDigestsFile(digestBoundary), digestVector),
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    writeRaw(digestBoundary, paddedBytes(digestVector, UNRELATED_CHANNEL_DIGESTS_MAX_BYTES + 1));
    fail(failureCode(() => parseUnrelatedChannelDigestsFile(digestBoundary))
      === 'UNRELATED_CHANNEL_DIGESTS_INVALID', 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const maximumDigestVector = [];
    while (bytes([...maximumDigestVector, digest]).length <= UNRELATED_CHANNEL_DIGESTS_MAX_BYTES) {
      maximumDigestVector.push(digest);
    }
    const digestEntries = directoryEntries();
    writeUnrelatedChannelDigests(digests, maximumDigestVector);
    fail(maximumDigestVector.length > 31
      && equalJSON(parseUnrelatedChannelDigestsFile(digests), maximumDigestVector)
      && equalJSON(directoryEntries(), [...digestEntries, 'digests.json'].sort()),
    'RECOVERY_RECORD_SELF_TEST_FAILED');
    const digestsOversized = path.join(root, 'digests-oversized.json');
    const digestsOversizedEntries = directoryEntries();
    fail(failureCode(() => writeUnrelatedChannelDigests(
      digestsOversized, [...maximumDigestVector, digest],
    )) === 'UNRELATED_CHANNEL_DIGESTS_WRITE_FAILED' && !fs.existsSync(digestsOversized),
    'RECOVERY_RECORD_SELF_TEST_FAILED');
    fail(equalJSON(directoryEntries(), digestsOversizedEntries),
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const ack = path.join(root, 'ack.json');
    const ackValue = { status: 'ok', target_window_removed: true };
    writeRaw(ack, paddedBytes(ackValue, CLOSE_ACK_MAX_BYTES));
    fail(parseCloseAckFile(ack).target_window_removed, 'RECOVERY_RECORD_SELF_TEST_FAILED');
    writeRaw(ack, paddedBytes(ackValue, CLOSE_ACK_MAX_BYTES + 1));
    fail(failureCode(() => parseCloseAckFile(ack)) === 'TARGET_CLOSE_INVALID',
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const malformedAcks = [
      { status: 'unknown', target_window_removed: true },
      { status: 'ok', target_window_removed: false },
      { status: 'failed', target_window_removed: true },
      { status: 'failed', target_window_removed: 'false' },
    ];
    fail(malformedAcks.every((value) => {
      writeRaw(ack, bytes(value));
      return failureCode(() => parseCloseAckFile(ack)) === 'TARGET_CLOSE_INVALID';
    }), 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const delayedAck = path.join(root, 'delayed-ack.json');
    writeRaw(delayedAck, bytes(ackValue), 0o000);
    fail(failureCode(() => parseCloseAckFile(delayedAck)) === 'TARGET_CLOSE_INVALID',
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    let retryPauses = 0;
    const retriedAck = await parsePrivateRecordUntilDeadline(
      delayedAck, parseCloseAckFile, 100, async () => {
        retryPauses += 1;
        fs.chmodSync(delayedAck, 0o600);
      },
    );
    fail(retryPauses === 1 && retriedAck.target_window_removed,
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const cleanup = path.join(root, 'cleanup.json');
    const cleanupValue = {
      fixture_windows_removed: true, sibling_window_removed: true, target_window_removed: true,
    };
    writeRaw(cleanup, paddedBytes(cleanupValue, FIXTURE_CLEANUP_MAX_BYTES));
    fail(parseFixtureCleanupFile(cleanup).fixture_windows_removed,
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    writeRaw(cleanup, paddedBytes(cleanupValue, FIXTURE_CLEANUP_MAX_BYTES + 1));
    fail(failureCode(() => parseFixtureCleanupFile(cleanup)) === 'FIXTURE_CLEANUP_INVALID',
      'RECOVERY_RECORD_SELF_TEST_FAILED');
    const swappedWriter = path.join(root, 'swapped-writer.json');
    const ownedResidue = path.join(root, 'owned-residue.json');
    const swappedIdentity = identity();
    let replacementIdentity = null;
    const swappedEntries = directoryEntries();
    fail(failureCode(() => writeDaemonIdentity(swappedWriter, swappedIdentity, () => {
      fs.renameSync(swappedWriter, ownedResidue);
      writeRaw(swappedWriter, preserved);
      replacementIdentity = fs.lstatSync(swappedWriter, { bigint: true });
    })) === 'DAEMON_IDENTITY_WRITE_FAILED', 'RECOVERY_RECORD_SELF_TEST_FAILED');
    const replacementAfter = fs.lstatSync(swappedWriter, { bigint: true });
    const residue = fs.lstatSync(ownedResidue, { bigint: true });
    fail(replacementIdentity.isFile() && replacementAfter.isFile()
      && replacementIdentity.dev === replacementAfter.dev
      && replacementIdentity.ino === replacementAfter.ino
      && fs.readFileSync(swappedWriter).equals(preserved)
      && residue.isFile() && (residue.mode & 0o777n) === 0n
      && residue.size === BigInt(bytes(swappedIdentity).length)
      && equalJSON(directoryEntries(), [...swappedEntries,
        'owned-residue.json', 'swapped-writer.json'].sort()),
    'RECOVERY_RECORD_SELF_TEST_FAILED');
    receipt = {
      close_ack_shape_validation: true,
      exact_json_line_enforced: true,
      exact_utf8_roundtrip: true,
      fifo_read_bounded: true,
      held_descriptor_path_swap_safe: true,
      mode_gated_parser_retry: true,
      mode_gated_writer_path_swap_safe: true,
      no_temporary_writer_names: true,
      purpose_specific_byte_boundaries: true,
      reader_maximum_validated_before_open: true,
      positional_full_read_and_growth_rejection: true,
      recovery_record_parsers_exercised: true,
      safe_writer_max_and_no_overwrite: true,
      status: 'passed',
    };
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

export async function runNativeProofSelfTest(mode) {
  if (mode === '--command-telemetry-self-test') return commandTelemetrySelfTest();
  if (mode === '--fixture-result-parser-self-test') return fixtureResultParserSelfTest();
  if (mode === '--recovery-record-self-test') return recoveryRecordSelfTest();
  if (mode === '--channel-snapshot-self-test') {
    try {
      return channelSnapshotSelfTest();
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        code: error instanceof ProofError ? error.code : 'CHANNEL_SNAPSHOT_SELF_TEST_FAILED',
        status: 'failed',
      })}\n`);
      process.exitCode = 1;
      return undefined;
    }
  }
  throw new ProofError('SELF_TEST_MODE_INVALID');
}

if (process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode] = process.argv.slice(2);
  try {
    await runNativeProofSelfTest(mode);
  } catch {
    process.exitCode = 125;
  }
}

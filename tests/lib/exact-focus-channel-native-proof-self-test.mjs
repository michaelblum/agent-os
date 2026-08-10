import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  parseFixtureResultFile,
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
  const stderrPriority = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    execute({
      status: 1,
      signal: null,
      stdout: JSON.stringify({ code: 'WINDOW_NOT_FOUND', error: rawSentinel }),
      stderr: JSON.stringify({ code: 'INTERNAL', error: rawSentinel }),
    }),
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
    execute({ status: 0, signal: null, stdout: rawSentinel, stderr: '' }),
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
    exact_utf8_byte_boundaries: true,
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
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8');
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
    const boundaryEnvelope = JSON.stringify({
      status: 'failed', error_code: 'FIXTURE_HELPER_FAILED',
    });
    const exactBoundary = Buffer.from(boundaryEnvelope.padEnd(FIXTURE_RESULT_MAX_BYTES, ' '));
    const overBoundary = Buffer.from(boundaryEnvelope.padEnd(FIXTURE_RESULT_MAX_BYTES + 1, ' '));
    fail(exactBoundary.length === FIXTURE_RESULT_MAX_BYTES
      && caughtCode(exactBoundary) === 'FIXTURE_HELPER_FAILED'
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

export function runNativeProofSelfTest(mode) {
  if (mode === '--command-telemetry-self-test') return commandTelemetrySelfTest();
  if (mode === '--fixture-result-parser-self-test') return fixtureResultParserSelfTest();
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
    runNativeProofSelfTest(mode);
  } catch {
    process.exitCode = 125;
  }
}

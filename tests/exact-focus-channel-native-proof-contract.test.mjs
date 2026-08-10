import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.swift');
const driverPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.mjs');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');
const expectedFixtureFailureCodes = Object.freeze([
  'FIXTURE_ARGUMENTS_INVALID',
  'FIXTURE_HELPER_FAILED',
  'FIXTURE_WINDOW_LIST_UNAVAILABLE',
  'FIXTURE_WINDOW_OWNERSHIP_MISMATCH',
  'FIXTURE_WINDOW_LAYER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_NOT_READY',
  'FIXTURE_SIBLING_CONTROL_NOT_READY',
  'FIXTURE_WINDOW_ORDER_MISMATCH',
  'FIXTURE_WINDOW_GEOMETRY_INVALID',
  'FIXTURE_DISPLAY_UNAVAILABLE',
]);
const expectedFixtureReadinessCodes = expectedFixtureFailureCodes.slice(2);

function shellIntegerConstant(source, name) {
  const match = source.match(new RegExp(`typeset -r ${name}=([0-9]+)`, 'u'));
  assert.ok(match, `missing integer shell constant ${name}`);
  return Number(match[1]);
}

test('exact focus-channel native helper typechecks without opening windows or capturing pixels', () => {
  execFileSync('zsh', [runnerPath, '--typecheck'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 45_000,
  });
});

test('exact focus-channel pixel classifier has an offline deterministic self-test', () => {
  const result = spawnSync('zsh', [runnerPath, '--analyzer-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    classifier_self_test: true,
    status: 'passed',
  });
});

test('exact focus-channel fixture readiness classifier is pure, ordered, and allowlisted', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fixture-readiness-self-test-'));
  const binary = path.join(temporaryRoot, 'fixture-readiness-self-test');
  try {
    execFileSync('swiftc', [
      '-parse-as-library',
      '-module-cache-path', path.join(temporaryRoot, 'module-cache'),
      '-framework', 'AppKit',
      '-framework', 'ImageIO',
      helperPath,
      '-o', binary,
    ], {
      cwd: root,
      stdio: 'pipe',
      timeout: 45_000,
    });
    const result = spawnSync(binary, ['--readiness-classifier-self-test'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 2_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      allowlisted_fixture_failure_codes: expectedFixtureFailureCodes,
      allowlisted_readiness_codes: expectedFixtureReadinessCodes,
      readiness_classifier_self_test: true,
      status: 'passed',
    });
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('exact focus-channel fixture is synthetic, same-process, overlapping, and AX-distinct', () => {
  const helper = fs.readFileSync(helperPath, 'utf8');
  const fixtureMain = helper.slice(helper.indexOf('if args.first == "--fixture"'));
  const localReadiness = helper.slice(
    helper.indexOf('private func currentMetadata()'),
    helper.indexOf('private func waitForWindowRemoval'),
  );
  const delegateIndex = fixtureMain.indexOf('app.delegate = controller');
  const lifetimeIndex = fixtureMain.indexOf('withExtendedLifetime(controller)');
  const runIndex = fixtureMain.indexOf('app.run()');

  assert.match(helper, /SplitTargetView/u);
  assert.match(helper, /SolidSiblingView/u);
  assert.match(helper, /aos-exact-target-control/u);
  assert.match(helper, /aos-exact-sibling-control/u);
  assert.match(helper, /targetButton\.setAccessibilityChildren\(\[\]\)/u);
  assert.match(helper, /FixtureController: NSObject, NSApplicationDelegate/u);
  assert.match(helper, /private let targetControl: NSButton/u);
  assert.match(helper, /private let siblingControl: NSButton/u);
  assert.match(
    helper,
    /func applicationDidFinishLaunching\(_ notification: Notification\) \{\s+start\(\)\s+\}/u,
  );
  assert.notEqual(delegateIndex, -1);
  assert.ok(lifetimeIndex > delegateIndex);
  assert.ok(runIndex > lifetimeIndex);
  assert.match(fixtureMain, /withExtendedLifetime\(controller\) \{\s+app\.run\(\)\s+\}/u);
  assert.doesNotMatch(fixtureMain, /controller\.start\(\)/u);
  assert.match(helper, /let controlledFixtureMetadataPath = args\.first == "--fixture"/u);
  assert.match(fixtureMain, /writeFixtureFailureEnvelope\(\s+\.argumentsInvalid,/u);
  assert.match(fixtureMain, /writeFixtureFailureEnvelope\(\s+\.displayUnavailable,/u);
  assert.match(fixtureMain, /writeFixtureFailureEnvelope\(\s+\.helperFailed,/u);
  assert.match(localReadiness, /controlIsLocallyAccessibilityReady\(\s+targetControl/u);
  assert.match(localReadiness, /controlIsLocallyAccessibilityReady\(\s+siblingControl/u);
  assert.match(localReadiness, /control\.window === window/u);
  assert.doesNotMatch(localReadiness, /accessibilityWindow/u);
  assert.match(localReadiness, /control\.accessibilityIdentifier\(\) == identifier/u);
  assert.match(localReadiness, /control\.isAccessibilityElement\(\)/u);
  assert.match(localReadiness, /control\.accessibilityRole\(\) == \.button/u);
  assert.match(localReadiness, /frame\.width > 0/u);
  assert.match(localReadiness, /frame\.height > 0/u);
  assert.doesNotMatch(helper, /setAccessibilityElement/u);
  assert.match(helper, /firstFixtureReadinessFailure/u);
  assert.match(helper, /FixtureFailureEnvelope\(status: "failed", error_code: failure\)/u);
  assert.match(helper, /try\? data\.write\(to: URL\(fileURLWithPath: metadataPath\), options: \.atomic\)/u);
  assert.doesNotMatch(localReadiness, /sleep|asyncAfter/u);
  assert.match(helper, /ownership_token/u);
  assert.match(localReadiness, /targetEntry\.flatMap \{ windowPID\(\$0\) \} == Int\(getpid\(\)\)/u);
  assert.match(localReadiness, /siblingEntry\.flatMap \{ windowPID\(\$0\) \} == Int\(getpid\(\)\)/u);
  assert.match(localReadiness, /targetEntry\.flatMap \{ windowLayer\(\$0\) \} == 0/u);
  assert.match(localReadiness, /siblingEntry\.flatMap \{ windowLayer\(\$0\) \} == 0/u);
  assert.match(localReadiness, /order: siblingIndex\.map \{ sibling in targetIndex\.map \{ sibling < \$0 \} \?\? false \} \?\? false/u);
  assert.match(helper, /overlapFraction >= 0\.35/u);
  assert.match(localReadiness, /siblingBounds!\.contains\(CGPoint\(x: targetBounds!\.midX, y: targetBounds!\.midY\)\)/u);
  assert.match(helper, /CGDisplayMirrorsDisplay/u);
  assert.match(helper, /CGDisplayBounds\(\$0\)\.contains\(bounds\)/u);
  assert.doesNotMatch(helper, /ScreenCaptureKit|SCScreenshotManager|SCStream/u);
  assert.doesNotMatch(helper, /CGWindowListCreateImage|CGDisplayCreateImage/u);
});

test('exact focus-channel live driver uses passive public preflights and bounded public evidence routes', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const combined = `${driver}\n${runner}`;
  const progressValidator = driver.slice(
    driver.indexOf('function validatedProgressReceipt'),
    driver.indexOf('async function sanitizeProgressReceipt'),
  );
  const cleanupBody = runner.slice(
    runner.indexOf('cleanup() {'),
    runner.indexOf('trap cleanup EXIT'),
  );
  const driverMainCatchStart = driver.indexOf('  } catch (error) {\n    const admissionAmbiguous');
  const driverMainCatch = driver.slice(
    driverMainCatchStart,
    driver.indexOf('\n  }\n}\n\nconst [mode', driverMainCatchStart),
  );
  const fixtureStartupStart = driver.indexOf("    progress.start('fixture_startup');");
  const driverFixtureStartup = driver.slice(
    fixtureStartupStart,
    driver.indexOf("    progress.complete('fixture_startup');", fixtureStartupStart),
  );
  const liveRun = runner.slice(
    runner.indexOf('  --run)'),
    runner.indexOf('  --runner-preflight-self-test)'),
  );
  const supervisorBody = driver.slice(
    driver.indexOf('async function superviseCommand'),
    driver.indexOf('async function ownedGroupWrapper'),
  );
  const processTreeSelfTest = runner.slice(
    runner.indexOf('--process-tree-self-test)'),
    runner.indexOf('--progress-timeout-self-test)'),
  );
  const progressTimeoutSelfTest = runner.slice(
    runner.indexOf('--progress-timeout-self-test)'),
    runner.indexOf('--run-program-timeout-self-test)'),
  );

  assert.match(driver, /'focus', 'create'/u);
  assert.match(driver, /'--subtree-identifier', metadata\.sibling_identifier/u);
  assert.match(driver, /'--subtree-identifier', metadata\.target_identifier/u);
  assert.match(driver, /'see', 'capture'/u);
  assert.match(driver, /'--channel', options\.channel/u);
  assert.match(driver, /'--xray'/u);
  assert.match(driver, /'--perception'/u);
  assert.match(driver, /'--out', outputFile/u);
  assert.match(driver, /verifyCapture\(options, metadata, files\.capture, 'INITIAL'\)/u);
  assert.match(driver, /'focus', 'update'/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_PUBLICATION/u);
  assert.match(driver, /verifyCapture\(options, metadata, files\.preservedCapture, 'PRESERVED'\)/u);
  assert.match(driver, /createdEntry\?\.elements_count === 1/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_DECODED_PIXELS/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_AX/u);
  assert.match(driver, /MISSING_TARGET_CAPTURE_NOT_REJECTED/u);
  assert.match(driver, /SHARED_DAEMON_CHANGED/u);
  assert.match(driver, /'runtime', 'build-attestation', '--json'/u);
  assert.match(driver, /'service', 'status', '--mode', 'repo', '--json'/u);
  assert.match(driver, /daemon_path_start_order_bound: true/u);
  assert.doesNotMatch(driver, /daemon_binary_bound/u);
  assert.match(driver, /'permissions', 'check', '--json'/u);
  assert.match(driver, /--untracked-files=all/u);
  assert.match(driver, /AOS_DISABLE_DAEMON_AUTOSTART/u);
  assert.match(driver, /AOS_ALLOW_DAEMON_AUTOSTART/u);
  assert.match(driver, /stablePublicChannelDigests/u);
  assert.match(driver, /createHmac\('sha256', key\)/u);
  assert.match(runner, /unrelated-channel-digests\.json/u);
  assert.match(runner, /randomBytes\(32\)\.toString\("hex"\)/u);
  assert.match(driver, /CLEAN_ABSENCE_SETTLE_MS/u);
  assert.match(driver, /fixtureProcessReaped/u);
  assert.match(driver, /raw_capture_logged: false/u);
  assert.match(driver, /pixels_persisted: false/u);
  assert.match(driver, /const PROGRESS_SCHEMA = 'aos\.exact-focus-channel-native-progress\.v1'/u);
  assert.match(driver, /const PROGRESS_MAX_BYTES = 2_048/u);
  assert.match(driver, /const AOS_COMMAND_ERROR_MAX_BYTES = 2_048/u);
  assert.match(driver, /const FIXTURE_RESULT_MAX_BYTES = 2_048/u);
  assert.match(driver, /const FIXTURE_FAILURE_CODES = new Set/u);
  assert.match(driver, /fs\.openSync\(file, fs\.constants\.O_RDONLY \| noFollow\)/u);
  assert.match(driver, /fs\.fstatSync\(descriptor\)/u);
  assert.match(driver, /hasExactKeys\(envelope, \['error_code', 'status'\]\)/u);
  assert.match(driver, /hasExactKeys\(envelope, \['metadata', 'status'\]\)/u);
  assert.match(driverFixtureStartup, /const metadata = parseFixtureResultFile\(files\.metadata\)/u);
  assert.doesNotMatch(driverFixtureStartup, /readFileSync\(files\.metadata/u);
  assert.match(driver, /const AOS_COMMAND_ERROR_CODES = new Set/u);
  assert.match(driver, /'DAEMON_UNREACHABLE'/u);
  assert.match(driver, /const AOS_PRECOMMIT_REJECTION_CODES = new Set/u);
  assert.match(driver, /commandAdmissionAmbiguous/u);
  assert.match(driver, /commandErrorCode/u);
  assert.match(driver, /command_error_code:/u);
  assert.match(driver, /command_admission_ambiguous:/u);
  assert.match(driver, /allowlistedAOSCommandError\(result\)/u);
  assert.match(driver, /aosCommandMayAdmitMutation/u);
  assert.match(driver, /unexpectedSuccess: true/u);
  assert.match(driver, /function commandFailureFields\(error\)/u);
  assert.match(driver, /execute = runProgram/u);
  assert.match(
    driverMainCatch,
    /const summary = \{\s+status: 'failed',\s+\.\.\.commandFailureFields\(error\),/u,
  );
  assert.match(driver, /const PROGRESS_MAX_ELAPSED_MS = 1_800_000/u);
  assert.match(driver, /const PROGRESS_MAX_ORDINAL = PROGRESS_STAGES\.length \* 2/u);
  assert.match(driver, /fs\.openSync\(tempFile, 'wx', 0o600\)/u);
  assert.match(driver, /fs\.renameSync\(tempFile, file\)/u);
  assert.match(driver, /const noFollow = fs\.constants\.O_NOFOLLOW/u);
  assert.match(driver, /if \(!Number\.isInteger\(noFollow\) \|\| noFollow === 0\) return null/u);
  assert.match(driver, /fs\.openSync\(file, fs\.constants\.O_RDONLY \| noFollow\)/u);
  assert.doesNotMatch(progressValidator, /lstatSync/u);
  assert.match(driver, /capture: 30_000/u);
  assert.match(driver, /aos: 10_000/u);
  assert.match(driver, /local: 10_000/u);
  assert.match(driver, /new ProofError\('COMMAND_TIMEOUT', \{ ambiguous: true \}\)/u);
  assert.match(driver, /print -r -- "\$AOS_RUN_PROGRAM_TIMEOUT_SENTINEL"/u);
  assert.match(driver, /fs\.fsyncSync\(descriptor\)/u);
  assert.ok(supervisorBody.indexOf('const signalHandlers') < supervisorBody.indexOf('child = spawn'));
  assert.ok(supervisorBody.indexOf('const parentMonitor') < supervisorBody.indexOf('child = spawn'));
  assert.ok(supervisorBody.indexOf('const deadline') < supervisorBody.indexOf('child = spawn'));
  assert.match(supervisorBody, /process\.on\(signal, handler\)/u);
  assert.doesNotMatch(supervisorBody, /process\.once\(signal, handler\)/u);
  assert.ok(
    supervisorBody.lastIndexOf('process.off(signal, handler)')
      > supervisorBody.indexOf('await retireProcessGroup(child.pid)'),
  );
  assert.ok(
    supervisorBody.lastIndexOf('process.off(signal, handler)')
      > supervisorBody.indexOf('fs.unlinkSync(groupPIDFile)'),
  );
  assert.ok(
    supervisorBody.indexOf('writeDurableAtomicFile(\n          groupPIDFile,')
      < supervisorBody.indexOf('writeDurableAtomicFile(readyFile'),
  );

  assert.match(runner, /AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK/u);
  assert.match(runner, /typeset -r LIVE_MAX_NON_CAPTURE_AOS_COMMANDS=149/u);
  assert.match(runner, /typeset -r LIVE_MAX_CAPTURE_COMMANDS=3/u);
  assert.match(runner, /typeset -r LIVE_MAX_LOCAL_COMMANDS=8/u);
  assert.match(runner, /LIVE_MAX_NON_CAPTURE_AOS_COMMANDS \* AOS_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /LIVE_MAX_CAPTURE_COMMANDS \* CAPTURE_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /LIVE_MAX_LOCAL_COMMANDS \* LOCAL_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /typeset -r CLEANUP_MAX_AOS_COMMANDS=60/u);
  assert.match(runner, /typeset -r CLEANUP_MAX_LOCAL_COMMANDS=2/u);
  assert.match(runner, /CLEANUP_MAX_AOS_COMMANDS \* AOS_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /CLEANUP_MAX_LOCAL_COMMANDS \* LOCAL_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /typeset -r PROGRESS_SANITIZER_TIMEOUT_MS=2000/u);
  assert.match(runner, /typeset -r SUPERVISOR_STOP_TERM_GRACE_HUNDREDTHS=1000/u);
  assert.match(runner, /typeset -r SUPERVISOR_STOP_POLL_HUNDREDTHS=5/u);
  assert.match(
    runner,
    /attempt \* SUPERVISOR_STOP_POLL_HUNDREDTHS < SUPERVISOR_STOP_TERM_GRACE_HUNDREDTHS/u,
  );
  assert.match(runner, /print -r -- sent-twice/u);
  assert.match(runner, /print -r -- descendant-live-after-two-terms-final-reap/u);
  assert.match(runner, /--supervisor-final-reap-signal-self-test/u);
  assert.match(runner, /typeset -r PROGRESS_RECEIPT_MAX_ELAPSED_MS=1800000/u);
  assert.match(runner, /candidate\.progress_elapsed_ms <= maxProgressElapsedMs/u);
  assert.match(runner, /"\$PROGRESS_RECEIPT_MAX_ELAPSED_MS"/u);
  assert.match(runner, /run_driver_with_deadline "\$LIVE_PROOF_TIMEOUT_MS"/u);
  assert.match(processTreeSelfTest, /run_driver_with_deadline 1000/u);
  assert.match(processTreeSelfTest, /Allow group and grandchild initialization under load/u);
  assert.match(progressTimeoutSelfTest, /run_driver_with_deadline 2000/u);
  assert.match(progressTimeoutSelfTest, /Give progress and grandchild initialization two seconds under load/u);
  assert.match(runner, /progress-sanitizer\.stdout/u);
  assert.match(runner, /progress-sanitizer\.stderr/u);
  assert.match(runner, /run_supervised_to_files \\\s+"\$PROGRESS_SANITIZER_TIMEOUT_MS"/u);
  assert.match(runner, /--ready-file "\$SUPERVISOR_READY_FILE"/u);
  assert.match(runner, /"\$ready_pid" != "\$supervised_pid"/u);
  assert.match(runner, /trap '' INT TERM/u);
  assert.match(runner, /--supervise-command/u);
  assert.match(runner, /stop_owned_group/u);
  assert.match(runner, /stop_owned_fixture/u);
  assert.match(runner, /channel-cleanup-armed/u);
  assert.match(runner, /COMMAND_ADMISSION_AMBIGUOUS=1/u);
  assert.match(runner, /summary_admission_is_nonambiguous/u);
  assert.match(liveRun, /adopt_driver_summary "\$SUMMARY" "\$STATUS"/u);
  const liveRunCleanupOrder = [
    'LIVE_CLEANUP_ARMED=1',
    'COMMAND_ADMISSION_AMBIGUOUS=1',
    'run_driver_with_deadline',
    'adopt_driver_summary',
    'trap - EXIT',
    "trap '' INT TERM",
    '\n    cleanup\n',
  ].map((needle) => liveRun.indexOf(needle));
  assert.ok(liveRunCleanupOrder.every((index) => index >= 0));
  assert.deepEqual(liveRunCleanupOrder, [...liveRunCleanupOrder].sort((a, b) => a - b));
  assert.match(runner, /if \(\( COMMAND_ADMISSION_AMBIGUOUS == 1 \)\); then/u);
  assert.match(runner, /elif \[\[ ! -x "\$ROOT\/aos" \]\]; then\s+cleanup_failed=1/u);
  assert.ok(
    cleanupBody.indexOf('COMMAND_ADMISSION_AMBIGUOUS == 1')
      < cleanupBody.indexOf('run_channel_cleanup'),
  );
  assert.ok(cleanupBody.indexOf('capture_sanitized_progress') >= 0);
  assert.ok(cleanupBody.indexOf('merge_sanitized_progress') > cleanupBody.indexOf('capture_sanitized_progress'));
  assert.ok(cleanupBody.indexOf('rm -f \\') > cleanupBody.indexOf('merge_sanitized_progress'));
  assert.match(runner, /rm -rf "\$TMP_ROOT"/u);

  assert.doesNotMatch(combined, /--base64|--save/u);
  assert.doesNotMatch(combined, /unrelated-channels\.json/u);
  assert.doesNotMatch(combined, /\.config\/agent-os\/channels/u);
  assert.doesNotMatch(combined, /net\.createConnection|sendEnvelopeRequest|daemon-request/u);
  assert.doesNotMatch(combined, /(?:spawn|spawnSync|runProgram)\([^\n]*aos-focus-graph/u);
  assert.doesNotMatch(combined, /service(?:',|\s+)\s*['"]?(?:stop|restart)|ready --repair/u);
  assert.doesNotMatch(combined, /permissions(?:',|\s+)\s*['"]?(?:setup|prime)/u);
  assert.doesNotMatch(combined, /(?:bash|zsh).*build\.sh|tccutil/u);
});

test('exact focus-channel outer budgets dominate exact cleanup and late-failure branches', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const strictFocusCalls = shellIntegerConstant(runner, 'STRICT_FOCUS_ENTRIES_AOS_COMMANDS');
  const ownedChannelMaximum = shellIntegerConstant(runner, 'OWNED_CHANNEL_IDS_MAX');
  const cleanupAttempts = shellIntegerConstant(runner, 'CHANNEL_CLEANUP_MAX_ATTEMPTS');
  const cleanupScansPerAttempt = shellIntegerConstant(
    runner,
    'CHANNEL_CLEANUP_STRICT_SCANS_PER_ATTEMPT',
  );
  const postCleanupCalls = shellIntegerConstant(runner, 'POST_CLEANUP_ATTESTATION_AOS_COMMANDS');
  const livePrefixCalls = shellIntegerConstant(runner, 'LIVE_PRE_CLEANUP_AOS_COMMANDS');
  const liveAOSCeiling = shellIntegerConstant(runner, 'LIVE_MAX_NON_CAPTURE_AOS_COMMANDS');
  const liveCaptureCeiling = shellIntegerConstant(runner, 'LIVE_MAX_CAPTURE_COMMANDS');
  const liveLocalCeiling = shellIntegerConstant(runner, 'LIVE_MAX_LOCAL_COMMANDS');
  const cleanupAOSCeiling = shellIntegerConstant(runner, 'CLEANUP_MAX_AOS_COMMANDS');
  const cleanupLocalCeiling = shellIntegerConstant(runner, 'CLEANUP_MAX_LOCAL_COMMANDS');
  const progressElapsedCeiling = shellIntegerConstant(runner, 'PROGRESS_RECEIPT_MAX_ELAPSED_MS');

  const removalCalls = (presentOwnedChannels) => (
    cleanupAttempts * (cleanupScansPerAttempt * strictFocusCalls + presentOwnedChannels)
  );
  const r1 = removalCalls(1);
  const r2 = removalCalls(ownedChannelMaximum);
  const exactCleanupCalls = r2 + postCleanupCalls;
  const exactLateFailureCatchCalls = livePrefixCalls + r1 + r1 + postCleanupCalls;
  const liveDeadlineMilliseconds = liveAOSCeiling * 10_000
    + liveCaptureCeiling * 30_000
    + liveLocalCeiling * 10_000
    + 60_000;
  const cleanupDeadlineMilliseconds = cleanupAOSCeiling * 10_000
    + cleanupLocalCeiling * 10_000
    + 30_000;

  assert.equal(strictFocusCalls, 5);
  assert.equal(r1, 48);
  assert.equal(r2, 51);
  assert.equal(exactCleanupCalls, 60);
  assert.equal(cleanupAOSCeiling, 60);
  assert.ok(cleanupAOSCeiling >= exactCleanupCalls);
  assert.equal(exactLateFailureCatchCalls, 143);
  assert.equal(liveAOSCeiling, 149);
  assert.ok(liveAOSCeiling >= exactLateFailureCatchCalls);
  assert.equal(liveLocalCeiling, 8);
  assert.equal(liveDeadlineMilliseconds, 1_720_000);
  assert.equal(cleanupDeadlineMilliseconds, 650_000);
  assert.equal(progressElapsedCeiling, 1_800_000);
  assert.ok(progressElapsedCeiling > liveDeadlineMilliseconds);
  assert.match(runner, /R\(N\) = 3 \* \(15 \+ N\) = 45 \+ 3N/u);
  assert.match(
    runner,
    /EXACT_CLEANUP_MAX_AOS_COMMANDS=\$\(\(\s+CHANNEL_CLEANUP_R2_AOS_COMMANDS \+ POST_CLEANUP_ATTESTATION_AOS_COMMANDS/u,
  );
  assert.match(
    runner,
    /EXACT_LIVE_FAILURE_CATCH_MAX_AOS_COMMANDS=\$\(\(\s+LIVE_PRE_CLEANUP_AOS_COMMANDS\s+\+ CHANNEL_CLEANUP_R1_AOS_COMMANDS\s+\+ CHANNEL_CLEANUP_R1_AOS_COMMANDS\s+\+ POST_CLEANUP_ATTESTATION_AOS_COMMANDS/u,
  );
});

test('exact focus-channel progress sanitizer fails closed without reflecting untrusted bytes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-exact-progress-contract-'));
  const rawSentinel = 'RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK';
  const expectedUnknown = {
    progress_receipt_valid: false,
    progress_ordinal: null,
    last_started_stage: 'unknown',
    last_completed_stage: 'unknown',
    progress_elapsed_ms: null,
  };
  const validReceipt = {
    schema: 'aos.exact-focus-channel-native-progress.v1',
    ordinal: 5,
    last_started_stage: 'fixture_startup',
    last_completed_stage: 'unrelated_channel_snapshot',
    elapsed_ms: 17,
  };
  const sanitize = (candidate) => spawnSync(
    'node',
    [driverPath, '--sanitize-progress-receipt', '--path', candidate],
    { cwd: root, encoding: 'utf8', timeout: 2_000 },
  );
  try {
    const corrupt = path.join(tempRoot, 'corrupt.json');
    const missing = path.join(tempRoot, 'missing.json');
    const valid = path.join(tempRoot, 'valid.json');
    const wrongMode = path.join(tempRoot, 'wrong-mode.json');
    const impossibleStage = path.join(tempRoot, 'impossible-stage.json');
    const impossibleOrdinal = path.join(tempRoot, 'impossible-ordinal.json');
    const impossibleCompletion = path.join(tempRoot, 'impossible-completion.json');
    const oversized = path.join(tempRoot, 'oversized.json');
    const symlinkTarget = path.join(tempRoot, 'symlink-target.json');
    const symlink = path.join(tempRoot, 'progress-link.json');
    fs.writeFileSync(corrupt, `{${rawSentinel}`, { mode: 0o600 });
    fs.writeFileSync(oversized, `${rawSentinel}${'x'.repeat(2_048)}`, { mode: 0o600 });
    fs.writeFileSync(valid, JSON.stringify(validReceipt), { mode: 0o600 });
    fs.writeFileSync(wrongMode, JSON.stringify(validReceipt), { mode: 0o600 });
    fs.chmodSync(wrongMode, 0o644);
    fs.writeFileSync(
      impossibleStage,
      JSON.stringify({ ...validReceipt, last_started_stage: 'initial_capture' }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      impossibleOrdinal,
      JSON.stringify({ ...validReceipt, ordinal: 29 }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      impossibleCompletion,
      JSON.stringify({ ...validReceipt, last_completed_stage: 'runtime_preflight' }),
      { mode: 0o600 },
    );
    fs.writeFileSync(symlinkTarget, JSON.stringify(validReceipt), { mode: 0o600 });
    fs.symlinkSync(symlinkTarget, symlink);

    const validResult = sanitize(valid);
    assert.equal(validResult.status, 0, validResult.stderr);
    assert.deepEqual(JSON.parse(validResult.stdout.trim()), {
      progress_receipt_valid: true,
      progress_ordinal: 5,
      last_started_stage: 'fixture_startup',
      last_completed_stage: 'unrelated_channel_snapshot',
      progress_elapsed_ms: 17,
    });

    for (const candidate of [
      missing,
      corrupt,
      oversized,
      symlink,
      wrongMode,
      impossibleStage,
      impossibleOrdinal,
      impossibleCompletion,
    ]) {
      const result = sanitize(candidate);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), expectedUnknown);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(rawSentinel, 'u'));
    }
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('exact focus-channel runner preflight accepts a canonical revision and rejects drift', () => {
  const result = spawnSync('zsh', [runnerPath, '--runner-preflight-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    revision_preflight: true,
    status: 'passed',
  });
});

test('exact focus-channel unrelated-channel snapshot tolerates refresh metadata and detects stable-field mutation', () => {
  const result = spawnSync('node', [driverPath, '--channel-snapshot-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    keyed_stable_public_channel_snapshot: true,
    status: 'passed',
  });

  const key = spawnSync('zsh', [runnerPath, '--snapshot-key-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(key.status, 0, key.stderr);
  assert.deepEqual(JSON.parse(key.stdout.trim()), {
    ephemeral_snapshot_key: true,
    status: 'passed',
  });
});

test('exact focus-channel command telemetry is allowlisted, admission-aware, and non-reflective', () => {
  const rawSentinel = 'RAW_AOS_COMMAND_SENTINEL_MUST_NOT_LEAK';
  const result = spawnSync('node', [driverPath, '--command-telemetry-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
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
  });
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(rawSentinel, 'u'));
});

test('exact focus-channel fixture result parser is bounded, allowlisted, and non-reflective', () => {
  const rawSentinel = 'RAW_FIXTURE_RESULT_SENTINEL_MUST_NOT_LEAK';
  const result = spawnSync('node', [driverPath, '--fixture-result-parser-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    allowlisted_failure_codes: expectedFixtureFailureCodes,
    exact_byte_boundaries: true,
    fixture_result_parser_self_test: true,
    malformed_unknown_fail_closed: true,
    raw_fixture_output_reflected: false,
    regular_file_enforced: true,
    status: 'passed',
  });
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(rawSentinel, 'u'));
});

test('exact focus-channel watchdog reaps its owned process group and descendants', () => {
  const timeout = spawnSync('zsh', [runnerPath, '--timeout-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(timeout.status, 0, timeout.stderr);
  assert.deepEqual(JSON.parse(timeout.stdout.trim()), {
    owned_process_group_reaped: true,
    status: 'passed',
  });

  const tree = spawnSync('zsh', [runnerPath, '--process-tree-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 12_000,
  });
  assert.equal(tree.status, 0, tree.stderr);
  assert.deepEqual(JSON.parse(tree.stdout.trim()), {
    owned_descendant_reaped: true,
    status: 'passed',
  });

  const cleanup = spawnSync('zsh', [runnerPath, '--cleanup-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.deepEqual(JSON.parse(cleanup.stdout.trim()), {
    owned_child_reaped: true,
    status: 'passed',
  });

  const fixtureOwnership = spawnSync('zsh', [runnerPath, '--fixture-ownership-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 4_000,
  });
  assert.equal(fixtureOwnership.status, 0, fixtureOwnership.stderr);
  assert.deepEqual(JSON.parse(fixtureOwnership.stdout.trim()), {
    long_argv_fixture_reaped: true,
    status: 'passed',
  });

  const pidfileReuse = spawnSync('zsh', [runnerPath, '--pidfile-reuse-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(pidfileReuse.status, 0, pidfileReuse.stderr);
  assert.deepEqual(JSON.parse(pidfileReuse.stdout.trim()), {
    live_unrelated_group_preserved: true,
    unresolved_group_record_preserved: true,
    status: 'passed',
  });

  const postflightCleanupFailure = spawnSync(
    'zsh',
    [runnerPath, '--postflight-cleanup-failure-self-test'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 2_000,
    },
  );
  assert.equal(postflightCleanupFailure.status, 0, postflightCleanupFailure.stderr);
  assert.deepEqual(JSON.parse(postflightCleanupFailure.stdout.trim()), {
    cleanup_failure_forced_failure: true,
    status: 'passed',
  });

  const ambiguousAdmissionCleanup = spawnSync(
    'zsh',
    [runnerPath, '--ambiguous-admission-cleanup-self-test'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 8_000,
    },
  );
  assert.equal(ambiguousAdmissionCleanup.status, 0, ambiguousAdmissionCleanup.stderr);
  assert.deepEqual(JSON.parse(ambiguousAdmissionCleanup.stdout.trim()), {
    ambiguous_admission_cleanup_safe: true,
    status: 'passed',
  });

  const missingAOSCleanup = spawnSync(
    'zsh',
    [runnerPath, '--missing-aos-cleanup-self-test'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 2_000,
    },
  );
  assert.equal(missingAOSCleanup.status, 0, missingAOSCleanup.stderr);
  assert.deepEqual(JSON.parse(missingAOSCleanup.stdout.trim()), {
    missing_aos_cleanup_retained_root: true,
    status: 'passed',
  });

  const progressMerge = spawnSync(
    'zsh',
    [runnerPath, '--progress-merge-coherence-self-test'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 3_000,
    },
  );
  assert.equal(progressMerge.status, 0, progressMerge.stderr);
  assert.deepEqual(JSON.parse(progressMerge.stdout.trim()), {
    shell_progress_transition_coherence: true,
    status: 'passed',
  });
});

test('exact focus-channel timeout retains one sanitized stage receipt after reaping descendants', () => {
  const result = spawnSync('zsh', [runnerPath, '--progress-timeout-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 12_000,
  });
  assert.equal(result.status, 124, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.error_code, 'PROOF_TIMEOUT');
  assert.equal(receipt.cleanup_complete, true);
  assert.equal(receipt.recovery_root_retained, false);
  assert.equal(receipt.pixels_persisted, false);
  assert.equal(receipt.raw_capture_logged, false);
  assert.equal(receipt.progress_receipt_valid, true);
  assert.equal(receipt.last_started_stage, 'initial_capture');
  assert.equal(receipt.last_completed_stage, 'target_channel_creation');
  assert.ok(Number.isSafeInteger(receipt.progress_elapsed_ms));
  assert.ok(receipt.progress_elapsed_ms >= 0 && receipt.progress_elapsed_ms <= 1_800_000);
});

test('exact focus-channel runProgram timeout stays ambiguous until the outer owner reaps descendants', () => {
  const rawSentinel = 'RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK';
  const result = spawnSync('zsh', [runnerPath, '--run-program-timeout-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 12_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.run_program_timeout_ambiguous, true);
  assert.equal(receipt.timeout_descendant_reaped, true);
  assert.equal(receipt.captured_output_reflected, false);
  assert.equal(receipt.cleanup_complete, true);
  assert.equal(receipt.recovery_root_retained, false);
  assert.equal(receipt.progress_receipt_valid, false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(rawSentinel, 'u'));
});

test('exact focus-channel cleanup bounds its sanitizer and ignores signals through its final receipt', () => {
  const sanitizerTimeout = spawnSync(
    'zsh',
    [runnerPath, '--progress-sanitizer-timeout-self-test'],
    { cwd: root, encoding: 'utf8', timeout: 12_000 },
  );
  assert.equal(sanitizerTimeout.status, 0, sanitizerTimeout.stderr);
  assert.equal(sanitizerTimeout.stdout.trim().split('\n').length, 1);
  const timeoutReceipt = JSON.parse(sanitizerTimeout.stdout.trim());
  assert.equal(timeoutReceipt.status, 'passed');
  assert.equal(timeoutReceipt.sanitizer_timeout_bounded, true);
  assert.equal(timeoutReceipt.cleanup_complete, true);
  assert.equal(timeoutReceipt.recovery_root_retained, false);
  assert.equal(timeoutReceipt.progress_receipt_valid, false);
  assert.equal(timeoutReceipt.last_started_stage, 'unknown');
  assert.equal(timeoutReceipt.last_completed_stage, 'unknown');

  const delayedHandshake = spawnSync(
    'zsh',
    [runnerPath, '--supervisor-handshake-delay-self-test'],
    { cwd: root, encoding: 'utf8', timeout: 18_000 },
  );
  assert.equal(delayedHandshake.status, 0, delayedHandshake.stderr);
  assert.equal(delayedHandshake.stdout.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(delayedHandshake.stdout.trim()), {
    supervisor_start_handshake_fail_closed: true,
    status: 'passed',
  });

  const preRecordSignal = spawnSync(
    'zsh',
    [runnerPath, '--supervisor-pre-record-signal-self-test'],
    { cwd: root, encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(preRecordSignal.status, 0, preRecordSignal.stderr);
  assert.equal(preRecordSignal.stdout.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(preRecordSignal.stdout.trim()), {
    pre_record_signal_fail_closed: true,
    status: 'passed',
  });

  const finalReapSignal = spawnSync(
    'zsh',
    [runnerPath, '--supervisor-final-reap-signal-self-test'],
    { cwd: root, encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(finalReapSignal.status, 0, finalReapSignal.stderr);
  assert.equal(finalReapSignal.stderr, '');
  assert.equal(finalReapSignal.stdout.trim().split('\n').length, 1);
  const finalReapReceipt = JSON.parse(finalReapSignal.stdout.trim());
  assert.equal(finalReapReceipt.status, 'passed');
  assert.equal(finalReapReceipt.final_reap_signal_idempotent, true);
  assert.equal(finalReapReceipt.cleanup_complete, true);
  assert.equal(finalReapReceipt.recovery_root_retained, false);

  const cleanupSignal = spawnSync('zsh', [runnerPath, '--cleanup-signal-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 6_000,
  });
  assert.equal(cleanupSignal.status, 0, cleanupSignal.stderr);
  assert.equal(cleanupSignal.stderr, '');
  assert.equal(cleanupSignal.stdout.trim().split('\n').length, 1);
  const signalReceipt = JSON.parse(cleanupSignal.stdout.trim());
  assert.equal(signalReceipt.status, 'passed');
  assert.equal(signalReceipt.cleanup_signal_deferred, true);
  assert.equal(signalReceipt.cleanup_complete, true);
  assert.equal(signalReceipt.recovery_root_retained, false);
  assert.equal(signalReceipt.progress_receipt_valid, true);
  assert.equal(signalReceipt.last_started_stage, 'runtime_preflight');
  assert.equal(signalReceipt.last_completed_stage, null);
});

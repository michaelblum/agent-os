import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.swift');
const checkpointSwiftPath = path.join(root, 'tests/lib/exact-focus-channel-geometry-checkpoint.swift');
const checkpointNodePath = path.join(root, 'tests/lib/exact-focus-channel-geometry-checkpoint.mjs');
const proofContractPath = path.join(root, 'tests/lib/exact-focus-channel-proof-contract.mjs');
const commandRunnerPath = path.join(root, 'tests/lib/exact-focus-channel-command-runner.mjs');
const proofModelPath = path.join(root, 'tests/lib/exact-focus-channel-native-proof-model.mjs');
const proofRuntimePath = path.join(root, 'tests/lib/exact-focus-channel-native-proof-runtime.mjs');
const proofSelfTestPath = path.join(root, 'tests/lib/exact-focus-channel-native-proof-self-test.mjs');
const driverPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.mjs');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');
const expectedFixtureFailureCodes = Object.freeze([
  'FIXTURE_ARGUMENTS_INVALID',
  'FIXTURE_HELPER_FAILED',
  'FIXTURE_WINDOW_LIST_UNAVAILABLE',
  'FIXTURE_WINDOW_OWNERSHIP_MISMATCH',
  'FIXTURE_WINDOW_LAYER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_WINDOW_MISMATCH',
  'FIXTURE_TARGET_CONTROL_IDENTIFIER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_NOT_ACCESSIBILITY_ELEMENT',
  'FIXTURE_TARGET_CONTROL_ROLE_MISMATCH',
  'FIXTURE_TARGET_CONTROL_FRAME_INVALID',
  'FIXTURE_SIBLING_CONTROL_WINDOW_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_IDENTIFIER_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_NOT_ACCESSIBILITY_ELEMENT',
  'FIXTURE_SIBLING_CONTROL_ROLE_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_FRAME_INVALID',
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

function childDiagnostics(result) {
  return JSON.stringify({ signal: result.signal, status: result.status,
    stderr: result.stderr, stdout: result.stdout });
}
function compileHelperBinary(temporaryRoot, binary) {
  execFileSync('swiftc', [
    '-parse-as-library',
    '-module-cache-path', path.join(temporaryRoot, 'module-cache'),
    '-framework', 'AppKit',
    '-framework', 'ImageIO',
    checkpointSwiftPath,
    helperPath,
    '-o', binary,
  ], {
    cwd: root,
    stdio: 'pipe',
    timeout: 45_000,
  });
}
test('exact focus-channel native helper typechecks without opening windows or capturing pixels', () => {
  execFileSync('zsh', [runnerPath, '--typecheck'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 45_000,
  });
});

test('native proof model, runtime, self-test, and command runner are import-safe focused boundaries', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const model = fs.readFileSync(proofModelPath, 'utf8');
  const runtime = fs.readFileSync(proofRuntimePath, 'utf8');
  const selfTest = fs.readFileSync(proofSelfTestPath, 'utf8');
  assert.ok(driver.split('\n').length - 1 <= 700);
  assert.ok(model.split('\n').length - 1 <= 700);
  assert.ok(runtime.split('\n').length - 1 <= 700);
  assert.ok(selfTest.split('\n').length - 1 <= 700);
  assert.match(runtime, /from '\.\/exact-focus-channel-native-proof-model\.mjs'/u);
  assert.match(runtime, /from '\.\/exact-focus-channel-command-runner\.mjs'/u);
  assert.doesNotMatch(model, /exact-focus-channel-native-proof-runtime|manual\/exact-focus/u);
  assert.doesNotMatch(model, /node:fs|node:os|node:path|process\.stdout|mkdtempSync|openSync/u);
  assert.match(selfTest, /from '\.\/exact-focus-channel-native-proof-runtime\.mjs'/u);
  assert.match(selfTest, /export function commandTelemetrySelfTest\(\)/u);
  assert.match(selfTest, /export function fixtureResultParserSelfTest\(\)/u);
  assert.match(selfTest, /export function channelSnapshotSelfTest\(\)/u);
  assert.match(driver, /await import\(\s+'\.\.\/lib\/exact-focus-channel-native-proof-self-test\.mjs'/u);
  assert.doesNotMatch(
    runtime,
    /from ['"][^'"]*manual\/exact-focus-channel-native-proof\.mjs['"]/u,
  );
  assert.doesNotMatch(driver, /function (?:runAOSSuccess|verifyCapture|parseFixtureResultFile)/u);
  for (const modulePath of [commandRunnerPath, proofModelPath, proofRuntimePath, proofSelfTestPath]) {
    const imported = spawnSync('node', ['--input-type=module', '-e',
      `await import(${JSON.stringify(`file://${modulePath}`)})`], {
      cwd: root, encoding: 'utf8', timeout: 2_000,
    });
    assert.equal(imported.status, 0, childDiagnostics(imported));
    assert.equal(imported.stdout, '');
    assert.equal(imported.stderr, '');
  }
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
    compileHelperBinary(temporaryRoot, binary);
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
  const checkpointHelper = fs.readFileSync(checkpointSwiftPath, 'utf8');
  const fixtureMain = helper.slice(helper.indexOf('if args.first == "--fixture"'));
  const localReadiness = helper.slice(
    helper.indexOf('private func currentMetadata()'),
    helper.indexOf('private func waitForWindowRemoval'),
  );
  const checkpointTick = helper.slice(
    helper.indexOf('private func tick()'),
    helper.indexOf('private func currentMetadata()'),
  );
  const delegateIndex = fixtureMain.indexOf('app.delegate = controller');
  const lifetimeIndex = fixtureMain.indexOf('withExtendedLifetime(controller)');
  const runIndex = fixtureMain.indexOf('app.run()');

  assert.match(helper, /SplitTargetView/u);
  assert.match(helper, /SolidSiblingView/u);
  assert.match(helper, /aos-exact-target-control/u);
  assert.match(helper, /aos-exact-sibling-control/u);
  assert.match(
    helper,
    /let targetButton = NSButton[^\n]+\n\s+targetButton\.setAccessibilityElement\(true\)\n\s+targetButton\.setAccessibilityRole\(\.button\)/u,
  );
  assert.match(
    helper,
    /let siblingButton = NSButton[^\n]+\n\s+siblingButton\.setAccessibilityElement\(true\)\n\s+siblingButton\.setAccessibilityRole\(\.button\)/u,
  );
  assert.equal(helper.match(/\.setAccessibilityElement\(true\)/gu)?.length, 2);
  assert.equal(helper.match(/\.setAccessibilityRole\(\.button\)/gu)?.length, 2);
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
  assert.match(localReadiness, /controlReadinessChecks\(\s+targetControl/u);
  assert.match(localReadiness, /controlReadinessChecks\(\s+siblingControl/u);
  assert.match(localReadiness, /control\.window === window/u);
  assert.doesNotMatch(localReadiness, /accessibilityWindow/u);
  assert.match(localReadiness, /control\.accessibilityIdentifier\(\) == identifier/u);
  assert.match(localReadiness, /control\.isAccessibilityElement\(\)/u);
  assert.match(localReadiness, /control\.accessibilityRole\(\) == \.button/u);
  assert.match(localReadiness, /frame\.width > 0/u);
  assert.match(localReadiness, /frame\.height > 0/u);
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
  assert.doesNotMatch(`${helper}\n${checkpointHelper}`, /ScreenCaptureKit|SCScreenshotManager|SCStream/u);
  assert.doesNotMatch(`${helper}\n${checkpointHelper}`, /CGWindowListCreateImage|CGDisplayCreateImage/u);
  assert.match(helper, /FixtureGeometryCheckpointService\(key: checkpointKey\)/u);
  assert.match(checkpointTick, /fixtureGeometryCheckpointServiceAllowed/u);
  assert.match(checkpointTick, /checkpointService\.serviceIfRequested/u);
  assert.ok(checkpointTick.indexOf('stopRequested') < checkpointTick.indexOf('checkpointService.serviceIfRequested'));
  assert.ok(checkpointTick.indexOf('closeRequested') < checkpointTick.indexOf('checkpointService.serviceIfRequested'));
  assert.match(checkpointHelper, /private func publishFixtureGeometryReceipt/u);
  assert.match(checkpointHelper, /getenv\(fixtureGeometryCheckpointKeyEnvironment\)/u);
  assert.ok(
    checkpointHelper.indexOf('unsetenv(fixtureGeometryCheckpointKeyEnvironment)')
      > checkpointHelper.indexOf('getenv(fixtureGeometryCheckpointKeyEnvironment)'),
  );
  assert.doesNotMatch(fixtureMain, /ProcessInfo\.processInfo\.environment\[\s*fixtureGeometryCheckpointKeyEnvironment/u);
});

test('exact focus-channel live driver uses passive public preflights and bounded public evidence routes', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const checkpointHelper = fs.readFileSync(checkpointNodePath, 'utf8');
  const proofContract = fs.readFileSync(proofContractPath, 'utf8');
  const proofModel = fs.readFileSync(proofModelPath, 'utf8');
  const proofRuntime = fs.readFileSync(proofRuntimePath, 'utf8');
  const proofSelfTest = fs.readFileSync(proofSelfTestPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const combined = `${driver}\n${proofModel}\n${proofRuntime}\n${runner}`;
  const progressValidator = proofContract.slice(
    proofContract.indexOf('export function validatedProgressReceipt'),
    proofContract.indexOf('export function sanitizedProgressFromFile'),
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
  const cleanupSignalMode = runner.slice(
    runner.indexOf('  --cleanup-signal-self-test)'),
    runner.indexOf('  --cleanup-self-test)'),
  );
  const checkpointRequestRoute = proofRuntime.slice(
    proofRuntime.indexOf('async function requestFixtureGeometryCheckpoint'),
    proofRuntime.indexOf('export function canonicalExistingPath'),
  );
  const fixtureStart = proofRuntime.slice(
    proofRuntime.indexOf('export async function startFixture'),
    proofRuntime.indexOf('export async function stopFixture'),
  );
  const captureCheckpoint = proofRuntime.slice(
    proofRuntime.indexOf('async function captureCheckpointBracket'),
    proofRuntime.indexOf('export function writeDaemonIdentity'),
  );
  const runAOSSuccessRoute = proofRuntime.slice(
    proofRuntime.indexOf('export function runAOSSuccess'),
    proofRuntime.indexOf('export function runAOSFailure'),
  );
  const successSummaryStart = driver.indexOf("    const summary = {\n      status: 'passed'");
  const failureSummaryStart = driver.indexOf("    const summary = {\n      status: 'failed'");
  assert.ok(successSummaryStart >= 0 && failureSummaryStart > successSummaryStart);
  const terminalSummaries = `${driver.slice(
    successSummaryStart,
    driver.indexOf('    process.stdout.write', successSummaryStart),
  )}\n${driver.slice(
    failureSummaryStart,
    driver.indexOf('    process.stdout.write', failureSummaryStart),
  )}`;

  assert.match(driver, /'focus', 'create'/u);
  assert.match(driver, /'--subtree-identifier', metadata\.sibling_identifier/u);
  assert.match(driver, /'--subtree-identifier', metadata\.target_identifier/u);
  assert.match(proofRuntime, /'see', 'capture'/u);
  assert.match(proofRuntime, /'--channel', options\.channel/u);
  assert.match(proofRuntime, /'--xray'/u);
  assert.match(proofRuntime, /'--perception'/u);
  assert.match(proofRuntime, /'--out', outputFile/u);
  assert.match(driver, /const initial = await verifyCapture\(\s+options,\s+metadata,\s+files,\s+fixture,\s+files\.capture,\s+'INITIAL'/u);
  assert.match(proofModel, /fail\(target\.role === 'AXButton', `\$\{codePrefix\}_TARGET_AX_ROLE`\);/u);
  assert.match(proofModel, /fail\(query\?\.role === 'AXButton', `\$\{codePrefix\}_TARGET_HANDLE_ROLE`\);/u);
  assert.match(driver, /'focus', 'update'/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_PUBLICATION/u);
  assert.match(driver, /const preserved = await verifyCapture\(\s+options,\s+metadata,\s+files,\s+fixture,\s+files\.preservedCapture,\s+'PRESERVED'/u);
  assert.match(driver, /createdEntry\?\.elements_count === 1/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_DECODED_PIXELS/u);
  assert.match(driver, /REJECTED_REFRESH_CHANGED_AX/u);
  assert.match(driver, /MISSING_TARGET_CAPTURE_NOT_REJECTED/u);
  assert.match(proofRuntime, /SHARED_DAEMON_CHANGED/u);
  assert.match(combined, /'runtime', 'build-attestation', '--json'/u);
  assert.match(proofRuntime, /'service', 'status', '--mode', 'repo', '--json'/u);
  assert.match(driver, /daemon_path_start_order_bound: true/u);
  assert.doesNotMatch(driver, /daemon_binary_bound/u);
  assert.match(combined, /'permissions', 'check', '--json'/u);
  assert.match(proofRuntime, /--untracked-files=all/u);
  assert.match(proofRuntime, /AOS_DISABLE_DAEMON_AUTOSTART/u);
  assert.match(proofRuntime, /AOS_ALLOW_DAEMON_AUTOSTART/u);
  assert.match(driver, /stablePublicChannelDigests/u);
  assert.match(proofModel, /createHmac\('sha256', key\)/u);
  assert.match(runner, /unrelated-channel-digests\.json/u);
  assert.match(runner, /randomBytes\(32\)\.toString\("hex"\)/u);
  assert.match(proofRuntime, /CLEAN_ABSENCE_SETTLE_MS/u);
  assert.match(driver, /fixtureProcessReaped/u);
  assert.match(driver, /raw_capture_logged: false/u);
  assert.match(driver, /pixels_persisted: false/u);
  assert.match(proofContract, /export const PROGRESS_SCHEMA = 'aos\.exact-focus-channel-native-progress\.v1'/u);
  assert.match(proofContract, /export const PROGRESS_MAX_BYTES = 2_048/u);
  assert.match(proofContract, /export const AOS_COMMAND_ERROR_MAX_BYTES = 2_048/u);
  assert.match(proofModel, /export const FIXTURE_RESULT_MAX_BYTES = 2_048/u);
  assert.match(proofModel, /const FIXTURE_FAILURE_CODES = new Set/u);
  assert.match(proofRuntime, /fs\.openSync\(file, fs\.constants\.O_RDONLY \| noFollow\)/u);
  assert.match(proofRuntime, /fs\.fstatSync\(descriptor\)/u);
  assert.match(proofModel, /hasExactKeys\(envelope, \['error_code', 'status'\]\)/u);
  assert.match(proofModel, /hasExactKeys\(envelope, \['metadata', 'status'\]\)/u);
  assert.match(driverFixtureStartup, /const metadata = parseFixtureResultFile\(files\.metadata\)/u);
  assert.doesNotMatch(driverFixtureStartup, /readFileSync\(files\.metadata/u);
  assert.match(proofContract, /const AOS_COMMAND_ERROR_CODES = new Set/u);
  assert.match(proofContract, /'DAEMON_UNREACHABLE'/u);
  assert.match(proofContract, /const AOS_PRECOMMIT_REJECTION_CODES = new Set/u);
  assert.match(proofRuntime, /const FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS = 2_000/u);
  assert.match(proofRuntime, /from '\.\/exact-focus-channel-geometry-checkpoint\.mjs'/u);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-proof-contract\.mjs'/u);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-native-proof-model\.mjs'/u);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-native-proof-runtime\.mjs'/u);
  assert.doesNotMatch(driver, /exact-focus-channel-supervision\.mjs/u);
  for (const runtimePath of [
    'tests/exact-focus-channel-geometry-checkpoint.test.mjs',
    'tests/exact-focus-channel-proof-protocol-contract.test.mjs',
    'tests/exact-focus-channel-supervision-contract.test.mjs',
    'tests/lib/exact-focus-channel-command-runner.mjs',
    'tests/lib/exact-focus-channel-geometry-checkpoint-harness.swift',
    'tests/lib/exact-focus-channel-geometry-checkpoint.mjs',
    'tests/lib/exact-focus-channel-geometry-checkpoint.swift',
    'tests/lib/exact-focus-channel-native-proof-model.mjs',
    'tests/lib/exact-focus-channel-native-proof-runtime.mjs',
    'tests/lib/exact-focus-channel-native-proof-self-test.mjs',
    'tests/lib/exact-focus-channel-proof-contract.mjs',
    'tests/lib/exact-focus-channel-supervision-protocol.mjs',
    'tests/lib/exact-focus-channel-supervision-self-test.mjs',
    'tests/lib/exact-focus-channel-supervision.mjs',
    'tests/lib/exact-focus-channel-supervision-scenarios.zsh',
    'tests/lib/exact-focus-channel-supervision.zsh',
  ]) assert.match(proofRuntime, new RegExp(runtimePath.replaceAll('.', '\\.'), 'u'));
  assert.match(runner, /CHECKPOINT_SOURCE="\$ROOT\/tests\/lib\/exact-focus-channel-geometry-checkpoint\.swift"/u);
  assert.match(runner, /SUPERVISION_NODE_SOURCE="\$ROOT\/tests\/lib\/exact-focus-channel-supervision\.mjs"/u);
  assert.match(runner, /SUPERVISION_SCENARIO_SOURCE="\$ROOT\/tests\/lib\/exact-focus-channel-supervision-scenarios\.zsh"/u);
  assert.match(runner, /SUPERVISION_SHELL_SOURCE="\$ROOT\/tests\/lib\/exact-focus-channel-supervision\.zsh"/u);
  assert.match(runner, /\. "\$SUPERVISION_SHELL_SOURCE"/u);
  assert.match(checkpointRequestRoute, /fixture\.checkpointRequester\.begin\(phase\)/u);
  assert.match(checkpointRequestRoute, /await waitForFile\(files\.checkpointReceipt, FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS\)/u);
  assert.match(checkpointRequestRoute, /fixture\.checkpointRequester\.read\(transaction\)/u);
  assert.match(checkpointRequestRoute, /finally \{\s+fixture\?\.checkpointRequester\?\.cleanup\(\);/u);
  assert.match(checkpointHelper, /class GeometryCheckpointRequester/u);
  assert.match(fixtureStart, /'--checkpoint-request', files\.checkpointRequest[\s\S]+'--checkpoint-receipt', files\.checkpointReceipt/u);
  const fixtureArgv = fixtureStart.slice(
    fixtureStart.indexOf('child = spawn'),
    fixtureStart.indexOf('], {'),
  );
  assert.doesNotMatch(fixtureArgv, /GEOMETRY_CHECKPOINT_KEY_ENV/u);
  assert.match(fixtureStart, /\[GEOMETRY_CHECKPOINT_KEY_ENV\]: checkpointKey\.toString\('hex'\)/u);
  assert.match(fixtureStart, /child\.kill\('SIGTERM'\)[\s\S]+waitForChildExit\(child, 1_000\)[\s\S]+child\.kill\('SIGKILL'\)/u);
  assert.match(proofRuntime.slice(
    proofRuntime.indexOf('export function proofEnvironment'),
    proofRuntime.indexOf('export function assertEnvironmentScope'),
  ), /delete environment\[GEOMETRY_CHECKPOINT_KEY_ENV\]/u);
  assert.match(captureCheckpoint, /const pre = await requestFixtureGeometryCheckpoint[\s\S]+const capture = await captureOperation\(\)[\s\S]+const post = await requestFixtureGeometryCheckpoint/u);
  assert.match(captureCheckpoint, /`\$\{phasePrefix\}_pre`[\s\S]+`\$\{phasePrefix\}_post`/u);
  assert.match(captureCheckpoint, /verifyCaptureGeometryCheckpoint\(\{/u);
  assert.match(captureCheckpoint, /decodedHeight: analysis\.height[\s\S]+decodedWidth: analysis\.width/u);
  assert.doesNotMatch(captureCheckpoint, /metadata\.target_bounds/u);
  // Threat scope: startup metadata bounds remain accepted controlled synthetic-fixture
  // evidence; checkpoint files add only nonce, phase, status, typed code, and HMACs.
  assert.doesNotMatch(terminalSummaries, /nonce|_hmac|checkpoint|target_bounds|sibling_bounds/u);
  assert.match(proofModel, /commandAdmissionAmbiguous/u);
  assert.match(proofModel, /commandErrorCode/u);
  assert.match(driver, /command_error_code:/u);
  assert.match(driver, /command_admission_ambiguous:/u);
  assert.match(proofRuntime, /allowlistedAOSCommandError\(result\)/u);
  assert.match(proofModel, /aosCommandMayAdmitMutation/u);
  assert.match(runAOSSuccessRoute,
    /allowlistedAOSCommandError\(result\) !== null[\s\S]+unexpectedSuccess: true[\s\S]+parseJSON\(result\.stdout[\s\S]+extractAOSCommandErrorCode\(payload\) !== null/u);
  assert.match(proofSelfTest,
    /statusZeroTypedEnvelope[\s\S]+status: 0[\s\S]+code: 'WINDOW_NOT_FOUND'[\s\S]+commandErrorCode === null/u);
  assert.match(proofSelfTest,
    /statusZeroTypedStderr[\s\S]+data: \{ channels: \[\] \}[\s\S]+stdout[\s\S]+stderr: JSON\.stringify\(\{ code: 'WINDOW_NOT_FOUND'[\s\S]+statusZeroTypedStderr\.every/u);
  assert.match(proofModel, /export function commandFailureFields\(error\)/u);
  assert.match(proofRuntime, /execute = runProgram/u);
  assert.match(
    driverMainCatch,
    /const summary = \{\s+status: 'failed',\s+\.\.\.commandFailureFields\(error\),/u,
  );
  assert.match(proofContract, /export const PROGRESS_MAX_ELAPSED_MS = 1_800_000/u);
  assert.match(proofContract, /export const PROGRESS_MAX_ORDINAL = PROGRESS_STAGES\.length \* 2/u);
  assert.match(proofContract, /fs\.openSync\(tempFile, 'wx', 0o600\)/u);
  assert.match(proofContract, /fs\.renameSync\(tempFile, file\)/u);
  assert.match(proofContract, /const noFollow = fs\.constants\.O_NOFOLLOW/u);
  assert.match(proofContract, /if \(!Number\.isInteger\(noFollow\) \|\| noFollow === 0\) return null/u);
  assert.match(proofRuntime, /const noFollow = fs\.constants\.O_NOFOLLOW;\s+fail\(Number\.isInteger\(noFollow\) && noFollow !== 0, errorCode\);/u);
  assert.match(proofSelfTest, /mkdtempSync[\s\S]+parseFixtureResultFile[\s\S]+rmSync/u);
  assert.match(proofContract, /fs\.openSync\(file, fs\.constants\.O_RDONLY \| noFollow\)/u);
  assert.doesNotMatch(progressValidator, /lstatSync/u);
  assert.match(proofRuntime, /capture: 30_000/u);
  assert.match(proofRuntime, /aos: 10_000/u);
  assert.match(proofRuntime, /local: 10_000/u);
  assert.match(runner, /AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK/u);
  assert.match(runner, /typeset -r LIVE_MAX_NON_CAPTURE_AOS_COMMANDS=149/u);
  assert.match(runner, /typeset -r LIVE_MAX_CAPTURE_COMMANDS=3/u);
  assert.match(runner, /typeset -r LIVE_MAX_LOCAL_COMMANDS=8/u);
  assert.match(runner, /LIVE_MAX_NON_CAPTURE_AOS_COMMANDS \* AOS_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /LIVE_MAX_CAPTURE_COMMANDS \* CAPTURE_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /LIVE_MAX_LOCAL_COMMANDS \* LOCAL_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAITS=4/u);
  assert.match(runner, /typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS=2000/u);
  assert.match(runner, /typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_TOTAL_MS=9000/u);
  assert.match(runner, /\+ LIVE_FIXTURE_GEOMETRY_CHECKPOINT_TOTAL_MS/u);
  assert.match(runner, /typeset -r CLEANUP_MAX_AOS_COMMANDS=60/u);
  assert.match(runner, /typeset -r CLEANUP_MAX_LOCAL_COMMANDS=2/u);
  assert.match(runner, /CLEANUP_MAX_AOS_COMMANDS \* AOS_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /CLEANUP_MAX_LOCAL_COMMANDS \* LOCAL_COMMAND_TIMEOUT_MS/u);
  assert.match(runner, /typeset -r PROGRESS_SANITIZER_TIMEOUT_MS=2000/u);
  assert.match(runner, /progress-sanitizer\.stdout/u);
  assert.match(runner, /progress-sanitizer\.stderr/u);
  assert.match(runner, /trap '' INT TERM/u);
  assert.match(runner, /stop_owned_fixture/u);
  assert.match(runner, /channel-cleanup-armed/u);
  assert.match(runner, /COMMAND_ADMISSION_AMBIGUOUS=1/u);
  assert.match(runner, /summary_admission_is_nonambiguous/u);
  assert.match(liveRun, /adopt_driver_summary "\$SUMMARY" "\$STATUS"/u);
  const liveRunCleanupOrder = [
    'LIVE_CLEANUP_ARMED=1',
    'COMMAND_ADMISSION_AMBIGUOUS=1',
    'exact_focus_supervision_run_driver',
    'adopt_driver_summary',
    'trap - EXIT',
    "trap '' INT TERM",
    '\n    cleanup\n',
  ].map((needle) => liveRun.indexOf(needle));
  assert.ok(liveRunCleanupOrder.every((index) => index >= 0));
  assert.deepEqual(liveRunCleanupOrder, [...liveRunCleanupOrder].sort((a, b) => a - b));
  const cleanupSignalOrder = [
    "trap '' INT TERM",
    'cleanup-signal-sender',
    '\n    cleanup\n',
  ].map((needle) => cleanupSignalMode.indexOf(needle));
  assert.ok(cleanupSignalOrder.every((index) => index >= 0));
  assert.deepEqual(cleanupSignalOrder, [...cleanupSignalOrder].sort((a, b) => a - b));
  assert.match(cleanupSignalMode, /progress-sanitizer\.stdout/u);
  assert.match(cleanupSignalMode, /-f "\$2" && ! -L "\$2"[\s\S]+"\$mode" == 600/u);
  assert.doesNotMatch(cleanupSignalMode, /self-test-delay-ms|\/bin\/sleep/u);
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
  const fixtureCheckpointWaits = shellIntegerConstant(
    runner,
    'LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAITS',
  );
  const fixtureCheckpointWaitMilliseconds = shellIntegerConstant(
    runner,
    'LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS',
  );
  const fixtureCheckpointTotalMilliseconds = shellIntegerConstant(
    runner,
    'LIVE_FIXTURE_GEOMETRY_CHECKPOINT_TOTAL_MS',
  );
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
    + 60_000
    + fixtureCheckpointTotalMilliseconds;
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
  assert.equal(fixtureCheckpointWaits, 4);
  assert.equal(fixtureCheckpointWaitMilliseconds, 2_000);
  assert.equal(fixtureCheckpointTotalMilliseconds, 9_000);
  assert.equal(
    fixtureCheckpointTotalMilliseconds,
    fixtureCheckpointWaits * fixtureCheckpointWaitMilliseconds + 1_000,
  );
  assert.equal(liveDeadlineMilliseconds, 1_729_000);
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
    [proofContractPath, '--sanitize-progress-receipt', '--path', candidate],
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
    retired_aggregate_codes_rejected: true,
    status: 'passed',
  });
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(rawSentinel, 'u'));
});

test('exact focus-channel cleanup preserves fixture and recovery ownership', () => {
  for (const [mode, timeout, expected] of [
    ['--cleanup-self-test', 2_000, { owned_child_reaped: true, status: 'passed' }],
    ['--fixture-ownership-self-test', 4_000,
      { long_argv_fixture_reaped: true, status: 'passed' }],
    ['--pidfile-reuse-self-test', 5_000, {
      live_unrelated_group_preserved: true, status: 'passed',
      unresolved_group_record_preserved: true,
    }],
    ['--postflight-cleanup-failure-self-test', 2_000,
      { cleanup_failure_forced_failure: true, status: 'passed' }],
    ['--ambiguous-admission-cleanup-self-test', 8_000,
      { ambiguous_admission_cleanup_safe: true, status: 'passed' }],
    ['--missing-aos-cleanup-self-test', 2_000,
      { missing_aos_cleanup_retained_root: true, status: 'passed' }],
    ['--progress-merge-coherence-self-test', 3_000,
      { shell_progress_transition_coherence: true, status: 'passed' }],
  ]) {
    const result = spawnSync('zsh', [runnerPath, mode], { cwd: root, encoding: 'utf8', timeout });
    assert.equal(result.status, 0, childDiagnostics(result));
    assert.deepEqual(JSON.parse(result.stdout.trim()), expected, childDiagnostics(result));
  }
});

test('exact focus-channel cleanup defers signals through its final receipt', () => {
  const cleanupSignal = spawnSync('zsh', [runnerPath, '--cleanup-signal-self-test'], {
    cwd: root, encoding: 'utf8', timeout: 6_000,
  });
  assert.equal(cleanupSignal.status, 0, childDiagnostics(cleanupSignal));
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

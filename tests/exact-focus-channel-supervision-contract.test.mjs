import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const driverPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.mjs');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');
const nodeHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision.mjs');
const selfTestHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-self-test.mjs');
const commandRunnerPath = path.join(root, 'tests/lib/exact-focus-channel-command-runner.mjs');
const shellHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision.zsh');
const scenarioHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-scenarios.zsh');
const proofContractPath = path.join(root, 'tests/lib/exact-focus-channel-proof-contract.mjs');
const protocolPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-protocol.mjs');
const proofProtocolContractPath = path.join(
  root, 'tests/exact-focus-channel-proof-protocol-contract.test.mjs',
);
const supervisionContractPath = fileURLToPath(import.meta.url);
// 5,000 startup + 50 armed timeout + 4,000 TERM + 3,000 KILL + 5,200 shell
// group fallback = 17,250ms; 30,000 includes EXIT sanitizer and scheduler margin.
const BASIC_TIMEOUT_OUTER_MS = 30_000;

function diagnostics(result) {
  return JSON.stringify({ signal: result.signal, status: result.status,
    stderr: result.stderr, stdout: result.stdout });
}

function run(mode, timeout = 30_000) {
  return spawnSync('zsh', [runnerPath, mode], { cwd: root, encoding: 'utf8', timeout });
}

function expectScenario(mode, expected, timeout = 30_000) {
  const result = run(mode, timeout);
  assert.equal(result.status, 0, diagnostics(result));
  assert.deepEqual(JSON.parse(result.stdout.trim()), expected, diagnostics(result));
}

const STANDARD_FINALIZER_FIELDS = Object.freeze({
  last_completed_stage: 'unknown',
  last_started_stage: 'unknown',
  pixels_persisted: false,
  progress_elapsed_ms: null,
  progress_ordinal: null,
  progress_receipt_valid: false,
  recovery_root_retained: false,
});

function expectedWithStandardFinalizer(fields) {
  for (const key of Object.keys(STANDARD_FINALIZER_FIELDS)) {
    assert.equal(Object.hasOwn(fields, key), false, `duplicate standard finalizer field: ${key}`);
  }
  return Object.freeze({ ...fields, ...STANDARD_FINALIZER_FIELDS });
}

test('supervision implementation is import-safe, focused, and singly owned', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const nodeHelper = fs.readFileSync(nodeHelperPath, 'utf8');
  const selfTestHelper = fs.readFileSync(selfTestHelperPath, 'utf8');
  const commandRunner = fs.readFileSync(commandRunnerPath, 'utf8');
  const shellHelper = fs.readFileSync(shellHelperPath, 'utf8');
  const scenarioHelper = fs.readFileSync(scenarioHelperPath, 'utf8');
  const proofContract = fs.readFileSync(proofContractPath, 'utf8');
  const protocol = fs.readFileSync(protocolPath, 'utf8');
  const proofProtocolContract = fs.readFileSync(proofProtocolContractPath, 'utf8');
  const supervisionContract = fs.readFileSync(supervisionContractPath, 'utf8');
  const nodeProtocolImport = nodeHelper.slice(
    nodeHelper.indexOf('import {'),
    nodeHelper.indexOf("} from './exact-focus-channel-supervision-protocol.mjs'") + 64,
  );
  const selfTestProtocolImport = selfTestHelper.slice(
    selfTestHelper.indexOf('import {', selfTestHelper.indexOf('exact-focus-channel-proof-contract')),
    selfTestHelper.indexOf("} from './exact-focus-channel-supervision-protocol.mjs'") + 64,
  );
  const stopGroup = shellHelper.slice(
    shellHelper.indexOf('exact_focus_supervision_stop_group()'),
    shellHelper.indexOf('exact_focus_supervision_settle_late_group_record()'),
  );
  const receiptMismatch = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_scenario_receipt_mismatch()'),
    scenarioHelper.indexOf('exact_focus_supervision_timeout_status_failure()'),
  );
  const timeoutScenarios = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_scenario_timeout()'),
    scenarioHelper.indexOf('exact_focus_supervision_scenario_payload_exit()'),
  );
  const injectedStages = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_scenario_injected_failure()'),
    scenarioHelper.indexOf('exact_focus_supervision_scenario_process_tree()'),
  );
  const progressTimeoutScenario = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_scenario_progress_timeout()'),
    scenarioHelper.indexOf('exact_focus_supervision_scenario_run_program_timeout()'),
  );
  const handshakeScenario = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_scenario_handshake_delay()'),
    scenarioHelper.indexOf('exact_focus_supervision_scenario_wrapper_identity_publication_failure()'),
  );
  const handlerTable = scenarioHelper.slice(
    scenarioHelper.indexOf('typeset -ga EFCS_SCENARIO_HANDLER_TABLE=('),
    scenarioHelper.indexOf('exact_focus_supervision_scenario_handler()'),
  );
  const scenarioDispatcher = scenarioHelper.slice(
    scenarioHelper.indexOf('exact_focus_supervision_run_scenario()'),
  );
  const supervisor = nodeHelper.slice(
    nodeHelper.indexOf('async function superviseCommand'),
    nodeHelper.indexOf('async function ownedGroupWrapper'),
  );
  const wrapper = nodeHelper.slice(
    nodeHelper.indexOf('async function ownedGroupWrapper'),
    nodeHelper.indexOf('async function runCLI'),
  );
  const progressHang = selfTestHelper.slice(
    selfTestHelper.indexOf('async function progressHangSelfTest(args)'),
    selfTestHelper.indexOf('async function runProgramTimeoutChild(args)'),
  );
  const basicTimeout = selfTestHelper.slice(
    selfTestHelper.indexOf('async function basicTimeoutSelfTest(args)'),
    selfTestHelper.indexOf('async function exitWithTermIgnoringDescendant(args)'),
  );

  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-native-proof-runtime\.mjs'/u);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-native-proof-model\.mjs'/u);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-proof-contract\.mjs'/u);
  assert.doesNotMatch(driver, /--supervise-command|--run-program-timeout-self-test|--sanitize-progress-receipt/u);
  assert.doesNotMatch(driver, /function superviseCommand|function runProgramTimeoutChild|function processGroupExists/u);
  assert.doesNotMatch(nodeHelper, /exact-focus-channel-native-proof\.mjs/u);
  assert.doesNotMatch(nodeHelper, /basicTimeoutSelfTest|progressHangSelfTest|createRunProgram/u);
  assert.match(nodeHelper, /from '\.\/exact-focus-channel-supervision-protocol\.mjs'/u);
  assert.doesNotMatch(nodeHelper, /^function (?:normalizedProcessStatus|readReadiness|runProgramReceiptStatus|wrapperOutcomeFromProcessResult)\(/mu);
  assert.match(nodeHelper, /const HELPER_PATH = fileURLToPath\(import\.meta\.url\)/u);
  assert.match(commandRunner, /export function createRunProgram\(/u);
  assert.match(supervisor, /spawn\(process\.execPath, wrapperArgs/u);
  assert.match(nodeHelper, /pathToFileURL\(path\.resolve\(process\.argv\[1\]\)\)\.href === import\.meta\.url/u);
  assert.match(selfTestHelper, /async function runProgramTimeoutChildProcess/u);
  assert.match(selfTestHelper, /function runProgramTimeoutSelfTest/u);
  assert.match(selfTestHelper, /const SELF_TEST_PATH = fileURLToPath\(import\.meta\.url\)/u);
  assert.match(selfTestHelper, /runProgramForSelfTest\(process\.execPath, \[SELF_TEST_PATH,/u); assert.doesNotMatch(selfTestHelper, /\bHELPER_PATH\b/u);
  assert.match(protocol, /export function runProgramReceiptStatus/u);
  assert.match(protocol, /export function processExists\(pid\)/u);
  assert.match(protocol, /export function supervisorProjectionIsValid\(projection\)/u);
  assert.match(proofContract, /import \{ supervisorProjectionIsValid \} from '\.\/exact-focus-channel-supervision-protocol\.mjs'/u);
  assert.doesNotMatch(protocol, /exact-focus-channel-proof-contract/u);
  assert.match(nodeProtocolImport, /\bprocessExists,/u);
  assert.match(selfTestProtocolImport, /\bprocessExists,/u);
  assert.doesNotMatch(nodeHelper, /^function processExists\(/mu);
  assert.doesNotMatch(selfTestHelper, /^function processExists\(/mu);
  assert.match(wrapper, /writeDurableExclusiveFile\(\s+groupPIDFile/u);
  assert.match(wrapper, /await waitForAdmissionAck\(/u);
  assert.match(nodeHelper, /admissionCommitReceived\(\) && ownedGroupRecordIsValid/u);
  assert.ok(wrapper.indexOf('writeDurableExclusiveFile(') < wrapper.indexOf('await waitForAdmissionAck('));
  assert.ok(wrapper.indexOf('await waitForAdmissionAck(') < wrapper.indexOf('spawn(executable'));
  assert.ok(progressHang.indexOf('writeProgressReceipt(') < progressHang.indexOf("spawn('/bin/zsh'"));
  assert.ok(progressHang.indexOf("spawn('/bin/zsh'") < progressHang.indexOf("writeDurableAtomicFile(pidFile"));
  assert.ok(progressHang.indexOf('writeDurableAtomicFile(pidFile') < progressHang.indexOf('writeDurableAtomicFile(readinessFile'));
  assert.doesNotMatch(basicTimeout, /\bspawn\(/u);
  assert.ok(basicTimeout.indexOf('writeDurableAtomicFile(readinessFile')
    < basicTimeout.indexOf('await sleep(30_000)'));
  assert.match(basicTimeout, /const useDefaultSIGTERM = args\.includes\('--self-test-default-sigterm'\)[\s\S]+if \(!useDefaultSIGTERM\) process\.on\('SIGTERM'/u);
  assert.match(basicTimeout, /--self-test-exit-after-readiness-ms[\s\S]+await sleep\(exitDelayMilliseconds\);[\s\S]+return 0;/u);
  assert.match(nodeHelper, /const TERM_GRACE_MS = 4_000;[\s\S]+const KILL_GRACE_MS = 3_000;/u);
  assert.match(supervisor, /stage = 'payload_readiness_wait';[\s\S]+stage = 'wrapper_result_wait';/u);
  assert.match(supervisor, /stage = 'final_group_reap';[\s\S]+stage = 'group_record_remove';/u);
  assert.match(nodeHelper, /'unexpected_supervisor_exception', 'cli_boundary', 125, 'supervisor_exception'/u);
  assert.match(supervisor, /await waitForOwnedGroupRecord\(/u);
  assert.match(supervisor, /stdio: \['inherit', 'inherit', 'inherit', 'ipc'\]/u);
  assert.match(supervisor, /if \(reason === null && !childSettled && processExists\(child\.pid\)\)[\s\S]+writeDurableExclusiveFile\(\s+admissionAckFile/u);
  assert.ok(supervisor.indexOf("'admission-ack'") < supervisor.indexOf('writeDurableAtomicFile(readyFile'));
  assert.ok(supervisor.indexOf("'admission-ack'") < supervisor.indexOf('sendAdmissionCommit(child)'));
  assert.ok(supervisor.indexOf('sendAdmissionCommit(child)') < supervisor.indexOf('writeDurableAtomicFile(readyFile'));
  assert.ok(supervisor.indexOf('let groupGone =') < supervisor.indexOf('fs.unlinkSync(groupPIDFile)'));
  assert.doesNotMatch(supervisor, /fs\.unlinkSync\(admissionAckFile\)/u);
  assert.match(protocol, /fs\.linkSync\(tempFile, file\)[\s\S]+fs\.fsyncSync\(directoryDescriptor\)/u);
  assert.doesNotMatch(`${nodeHelper}\n${protocol}\n${shellHelper}`, /pre-record|PRE_RECORD/u);

  for (const importPath of [
    commandRunnerPath, nodeHelperPath, proofContractPath, protocolPath, selfTestHelperPath,
  ]) {
    const importResult = spawnSync('node', ['--input-type=module', '-e',
      `await import(${JSON.stringify(`file://${importPath}`)})`],
    { cwd: root, encoding: 'utf8', timeout: 2_000 });
    assert.equal(importResult.status, 0, diagnostics(importResult));
    assert.equal(importResult.stdout, '');
    assert.equal(importResult.stderr, '');
  }

  assert.match(runner, /exact_focus_supervision_init \\\n+  "\$SUPERVISION_NODE_SOURCE" "\$SUPERVISION_SELF_TEST_SOURCE" \\\n+  "\$SUPERVISION_PROTOCOL_SOURCE" "\$PROOF_CONTRACT_SOURCE"/u);
  assert.match(runner, /^umask 077$/mu);
  assert.match(runner, /exact_focus_supervision_run_scenario "\$MODE"/u);
  assert.match(runner, /typeset -r PROGRESS_SANITIZER_TIMEOUT_MS=2000/u);
  assert.doesNotMatch(runner, /^run_supervised_to_files\(\)|^active_group_pid\(\)/mu);
  assert.doesNotMatch(shellHelper, /\$ROOT|\$DRIVER|\$TMP_ROOT|\$GROUP_PID_FILE/u);
  assert.doesNotMatch(shellHelper, /trap |rm -rf/u);
  const readonlyStatusAssignment = /(?:^|[;\s])(?:local|typeset)[^\n]*(?:^|[;\s])status(?:=|[;\s]|$)|(?:^|[;\s])status=/mu;
  for (const source of [shellHelper, scenarioHelper]) {
    assert.doesNotMatch(source, readonlyStatusAssignment);
  }
  assert.doesNotMatch(shellHelper, /run_scenario|EFCS_SCENARIO_/u);
  assert.match(scenarioHelper, /exact_focus_supervision_run_scenario\(\)/u);
  assert.match(runner, /^  \*\)\s+\. "\$SUPERVISION_SCENARIO_SOURCE"\s+if ! exact_focus_supervision_scenario_supports "\$MODE"[\s\S]+exact_focus_supervision_scenario_init[\s\S]+exact_focus_supervision_run_scenario "\$MODE"/mu);
  assert.ok(runner.indexOf('--missing-aos-cleanup-self-test)') < runner.lastIndexOf('  *)'));
  const scenarioRoutes = [...handlerTable.matchAll(
    /^\s+(--[a-z0-9-]+-self-test)\s+(exact_focus_supervision_scenario_[a-z0-9_]+)\s+([a-z0-9_]+)$/gmu,
  )].map((match) => ({ handler: match[2], mode: match[1], variant: match[3] }));
  const scenarioRouteRows = handlerTable.split('\n').filter((line) => /^\s+--/u.test(line));
  const scenarioModes = scenarioRoutes.map((route) => route.mode);
  assert.equal(scenarioRouteRows.length, 21);
  assert.equal(scenarioRoutes.length, 21);
  assert.equal(new Set(scenarioModes).size, 21);
  assert.ok(scenarioRoutes.every((route) => scenarioHelper.includes(`${route.handler}() {`)));
  assert.equal(scenarioModes.filter((mode) => runner.includes(mode)).length, 0);
  assert.doesNotMatch(scenarioHelper, /case "\$mode"/u);
  assert.ok(scenarioDispatcher.split('\n').length - 1 <= 20);
  assert.match(shellHelper, /local sender_status=0[\s\S]+wait "\$EFCS_SIGNAL_SENDER_PID" \|\| sender_status="\$\?"/u);
  assert.match(shellHelper, /\/usr\/bin\/env node "\$EFCS_SUPERVISION_HELPER" "\$\{arguments\[@\]\}" -- "\$@"/u);
  assert.match(shellHelper, /--create-private-output-files \\\n+    "\$stdout_file" "\$stderr_file"/u);
  assert.match(shellHelper, /! -e "\$stdout_file" && ! -L "\$stdout_file"/u);
  assert.match(shellHelper, /"\$output_mode" == 600 && "\$output_size" == 0/u);

  assert.match(scenarioHelper, /--validate-process-tree-retired|--validate-run-program-receipt/u);
  assert.doesNotMatch(shellHelper, /--validate-process-tree-retired|--validate-run-program-receipt/u);
  assert.match(shellHelper, /--validate-wrapper-identity[\s\S]+"\$ownership_file" "\$pgid" "\$token"/u);
  assert.match(shellHelper, /exact_focus_supervision_command_has_ownership_token\(\)/u);
  assert.equal((runner.match(/exact_focus_supervision_command_has_ownership_token/g) ?? []).length, 2);
  assert.doesNotMatch(`${runner}\n${shellHelper}`, /\*"?--ownership-token \$token"?\*/u);
  assert.match(shellHelper, /elif \[\[ -f "\$EFCS_ADMISSION_ACK_FILE" && ! -L "\$EFCS_ADMISSION_ACK_FILE" \]\]; then[\s\S]+ownership_file="\$EFCS_ADMISSION_ACK_FILE"/u);
  assert.match(stopGroup, /if \(\( EFCS_WRAPPER_IDENTITY_REQUIRED == 1 \)\); then\s+\[\[ -f "\$EFCS_WRAPPER_IDENTITY_FILE" && ! -L "\$EFCS_WRAPPER_IDENTITY_FILE" \]\][\s\S]+ownership_file="\$EFCS_WRAPPER_IDENTITY_FILE"/u);
  assert.ok(stopGroup.indexOf('EFCS_WRAPPER_IDENTITY_REQUIRED == 1')
    < stopGroup.indexOf('-f "$EFCS_GROUP_PID_FILE"'));
  assert.ok(stopGroup.indexOf('-f "$EFCS_GROUP_PID_FILE"')
    < stopGroup.indexOf('-f "$EFCS_ADMISSION_ACK_FILE"'));
  assert.match(stopGroup, /elif \[\[ ! -e "\$EFCS_GROUP_PID_FILE" && ! -e "\$EFCS_ADMISSION_ACK_FILE" \\\n+    && ! -e "\$EFCS_WRAPPER_IDENTITY_FILE" \]\]; then\s+return 0/u);
  assert.match(shellHelper, /exact_focus_supervision_settle_late_group_record \|\| return 125/u);
  assert.match(shellHelper, /--admission-ack-file \$EFCS_ADMISSION_ACK_FILE/u);
  assert.match(shellHelper, /rm -f "\$EFCS_ADMISSION_ACK_FILE" "\$EFCS_GROUP_PID_FILE"/u);
  assert.match(shellHelper, /attempt < 80[\s\S]+exact_focus_supervision_pause 5[\s\S]+attempt < 60[\s\S]+exact_focus_supervision_pause 2/u);
  assert.match(handshakeScenario, /EFCS_READY_DELAY_MS=8000[\s\S]+\/bin\/true[\s\S]+SUPERVISOR_HANDSHAKE_STATE_INVALID/u);
  assert.match(timeoutScenarios, /local -a payload_arguments=\(--basic-timeout-self-test --readiness "\$readiness"\)/u);
  assert.match(timeoutScenarios, /if \[\[ "\$variant" == remove \]\]; then\s+EFCS_GROUP_RECORD_REMOVE_FAILURE=1\s+payload_arguments\+=\(--self-test-default-sigterm\)\s+fi/u);
  assert.equal((timeoutScenarios.match(/--self-test-default-sigterm/g) ?? []).length, 1);
  assert.match(timeoutScenarios, /EFCS_TIMEOUT_STARTUP_MS=5000[\s\S]+exact_focus_supervision_run_driver 50[\s\S]+"\$\{payload_arguments\[@\]\}"/u);
  assert.match(progressTimeoutScenario, /EFCS_TIMEOUT_STARTUP_MS=10000[\s\S]+AOS_PROCESS_TREE_READINESS_NONCE="\$nonce"[\s\S]+exact_focus_supervision_run_driver 5000/u);
  assert.match(injectedStages, /EFCS_THROW_AFTER_READINESS=1[\s\S]+payload_arguments\+=\(--self-test-default-sigterm\)/u);
  assert.match(injectedStages, /EFCS_GROUP_RECORD_REMOVE_FAILURE=1[\s\S]+supervision_timeout=2000[\s\S]+expected_reason=none[\s\S]+payload_arguments\+=\(--self-test-exit-after-readiness-ms 100\)/u);
  assert.match(receiptMismatch, /supervisor_detail[\s\S]+supervisor_reason[\s\S]+supervisor_stage[\s\S]+supervisor_status/u);
  assert.match(wrapper, /wrapperOutcomeFromProcessResult\(result\)[\s\S]+publishWrapperOutcome\(outcome\.detail, outcome\.status\)/u);
  assert.match(supervisor, /--self-test-first-tier-reap-failure[\s\S]+emitSupervisorFailureDetail\('group_reap_failed', stage, 125, 'timeout'\)/u);
  assert.match(shellHelper, /exact_focus_supervision_stop_group \|\| \{[\s\S]+exact_focus_supervision_reconcile_outer_reap "\$child_status"/u);
  assert.match(runner, /1,729,000ms supervisor deadline/u);
  assert.ok(driver.split('\n').length - 1 <= 700);
  assert.ok(runner.split('\n').length - 1 <= 850);
  assert.ok(nodeHelper.split('\n').length - 1 <= 680);
  assert.ok(selfTestHelper.split('\n').length - 1 <= 700);
  assert.ok(commandRunner.split('\n').length - 1 <= 700);
  assert.ok(proofContract.split('\n').length - 1 < 700);
  assert.ok(protocol.split('\n').length - 1 < 700);
  assert.ok(shellHelper.split('\n').length - 1 < 700);
  assert.ok(scenarioHelper.split('\n').length - 1 <= 650);
  assert.ok(proofProtocolContract.split('\n').length - 1 < 700);
  assert.ok(supervisionContract.split('\n').length - 1 < 700);
});

test('sourced-shell wrapper identity observation handles disappearance and live mismatch', () => {
  const empty = path.join(process.env.TMPDIR ?? '/tmp', `aos-clear-state-${process.pid}-${Date.now()}`);
  const identity = `${empty}.identity`; const leader = '424242'; const token = 'a'.repeat(32);
  fs.writeFileSync(identity, `${leader} ${token}\n`, { mode: 0o600 });
  const result = spawnSync('zsh', ['-c', `
    . "$1"
    exact_focus_supervision_init \
      "$1" "$1" "$3" "$1" "$2" "$2/group" "$2/out" "$2/err"
    exact_focus_supervision_admission_state_is_clear || exit 11
    exact_focus_supervision_quiesce || exit 12
    EFCS_WRAPPER_IDENTITY_REQUIRED=1
    exact_focus_supervision_admission_state_is_clear && exit 13
    exact_focus_supervision_quiesce && exit 14
    EFCS_WRAPPER_IDENTITY_REQUIRED=0
    expected_pid="$5"
    exact_focus_supervision_pause() { :; }
    exact_focus_supervision_process_group_id() { print -r -- "$expected_pid"; }
    exact_focus_supervision_process_command() { return 1; }
    exact_focus_supervision_process_exists() { return 1; }
    exact_focus_supervision_group_exists() { return 1; }
    gone=0
    exact_focus_supervision_owned_group_pid_from_file "$4" >/dev/null || gone=$?
    exact_focus_supervision_process_command() { print -r -- unrelated; }
    exact_focus_supervision_process_exists() { return 0; }
    exact_focus_supervision_group_exists() { return 0; }
    live=0
    exact_focus_supervision_owned_group_pid_from_file "$4" >/dev/null || live=$?
    [[ -f "$4" ]] || exit 15
    print -r -- "$gone $live retained"
  `, 'identity-race', shellHelperPath, empty, protocolPath, identity, leader, token], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  fs.rmSync(identity, { force: true });
  assert.equal(result.status, 0, diagnostics(result));
  assert.equal(result.stdout, '1 2 retained\n');
  assert.equal(result.stderr, '');
});

test('sourced-shell ownership token matching requires a trailing whitespace boundary', () => {
  const token = 'a'.repeat(32);
  const result = spawnSync('zsh', ['-c', `
    . "$1"
    exact_focus_supervision_command_has_ownership_token \
      "node --ownership-token $2" "$2" || exit 11
    exact_focus_supervision_command_has_ownership_token \
      "node --ownership-token $2 -- payload" "$2" || exit 12
    exact_focus_supervision_command_has_ownership_token \
      "node --ownership-token $2f -- payload" "$2" && exit 13
    print -r -- boundary-enforced
  `, 'token-boundary', shellHelperPath, token], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  assert.equal(result.status, 0, diagnostics(result));
  assert.equal(result.stdout, 'boundary-enforced\n');
  assert.equal(result.stderr, '');
});

test('abnormal process outcomes and outer-reap reconciliation fail closed', () => {
  const outcome = spawnSync('node', [selfTestHelperPath, '--process-outcome-self-test'], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  assert.equal(outcome.status, 0, diagnostics(outcome));
  assert.deepEqual(JSON.parse(outcome.stdout.trim()), {
    abnormal_null_status: 125, payload_exit_status: 1, status: 'passed',
  });
  assert.equal(outcome.stderr, '');

  const temporaryRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR ?? '/tmp', 'aos-outer-reap-projection-',
  ));
  try {
    const result = spawnSync('zsh', ['-c', `
      . "$1"
      exact_focus_supervision_init "$2" "$2" "$2" "$2" \
        "$3" "$3/group" "$3/stdout" "$3/stderr"
      EFCS_LAST_SUPERVISOR_DETAIL=group_reap_failed
      EFCS_LAST_SUPERVISOR_REASON=timeout
      EFCS_LAST_SUPERVISOR_STAGE=final_group_reap
      EFCS_LAST_SUPERVISOR_STATUS=125
      exact_focus_supervision_reconcile_outer_reap 125
      never_observed="$REPLY:$EFCS_OUTER_REAP_RECOVERED"
      print -r -- owned > "$EFCS_GROUP_PID_FILE"
      EFCS_LAST_GROUP_REAP_PROVEN=1
      exact_focus_supervision_reconcile_outer_reap 125
      ownership_retained="$REPLY:$EFCS_OUTER_REAP_RECOVERED"
      rm -f "$EFCS_GROUP_PID_FILE"
      EFCS_LAST_SUPERVISOR_REASON=parent_lost
      exact_focus_supervision_reconcile_outer_reap 125
      wrong_reason="$REPLY:$EFCS_OUTER_REAP_RECOVERED"
      EFCS_LAST_SUPERVISOR_REASON=timeout
      exact_focus_supervision_reconcile_outer_reap 125
      recovered="$REPLY:$EFCS_OUTER_REAP_RECOVERED"
      print -r -- "$never_observed $ownership_retained $wrong_reason $recovered"
    `, 'outer-reap', shellHelperPath, nodeHelperPath, temporaryRoot], {
      cwd: root, encoding: 'utf8', timeout: 2_000,
    });
    assert.equal(result.status, 0, diagnostics(result));
    assert.equal(result.stdout.trim(), '125:0 125:0 125:0 124:1');
    assert.equal(result.stderr, '');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('supervisor deadlines reap exact groups and initialized descendants', () => {
  expectScenario('--timeout-self-test', { owned_process_group_reaped: true, status: 'passed' },
    BASIC_TIMEOUT_OUTER_MS);

  for (const [mode, expected, limit] of [
    ['--process-tree-self-test', { owned_descendant_reaped: true, status: 'passed' }, 12_000],
    ['--process-tree-withheld-readiness-self-test', {
      initialization_error_code: 'PROCESS_TREE_INITIALIZATION_FAILED', owned_group_reaped: true,
      status: 'passed', withheld_readiness_cleanup: true,
    }, 20_000],
  ]) {
    expectScenario(mode, expected, limit);
  }
});

test('payload exit status and outer timeout reap remain distinct end to end', () => {
  for (const [mode, expected] of [
    ['--supervisor-payload-exit1-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true,
      payload_exit_status_preserved: true,
      status: 'passed',
      supervisor_detail: 'payload_nonzero_exit',
      supervisor_reason: 'payload_exit',
      supervisor_stage: 'wrapper_result_wait',
      supervisor_status: 1,
    })],
    ['--supervisor-outer-reap-recovery-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true,
      outer_reap_recovered: true,
      status: 'passed',
      supervisor_detail: 'group_reap_failed',
      supervisor_reason: 'timeout',
      supervisor_stage: 'final_group_reap',
      supervisor_status: 125,
    })],
  ]) {
    expectScenario(mode, expected);
  }
});

test('secondary group-record removal preserves the original supervisor failure', () => {
  for (const [mode, expected] of [
    ['--supervisor-payload-exit1-remove-failure-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, payload_exit_status_preserved: true, status: 'passed',
      supervisor_cleanup_detail: 'group_record_remove_failed',
      supervisor_cleanup_stage: 'group_record_remove', supervisor_detail: 'payload_nonzero_exit',
      supervisor_reason: 'payload_exit', supervisor_stage: 'wrapper_result_wait', supervisor_status: 1,
    })],
    ['--supervisor-timeout-remove-failure-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, primary_timeout_preserved: true, status: 'passed',
      supervisor_cleanup_detail: 'group_record_remove_failed',
      supervisor_cleanup_stage: 'group_record_remove', supervisor_detail: 'supervisor_timeout',
      supervisor_reason: 'timeout', supervisor_stage: 'wrapper_result_wait', supervisor_status: 124,
    })],
  ]) {
    expectScenario(mode, expected);
  }
});

test('durable wrapper identity failures retain recovery state without admitting payload', () => {
  for (const [mode, expected] of [
    ['--supervisor-wrapper-identity-publication-failure-self-test', {
      payload_admitted: false, recovery_root_retained: true, status: 'passed', wrapper_identity_publication_fail_closed: true,
    }],
    ['--supervisor-wrapper-identity-invalid-self-test', { invalid_wrapper_identity_failed_closed: true,
      recovery_root_retained: true, status: 'passed' }],
  ]) {
    expectScenario(mode, expected);
  }
});

test('injected supervisor stages remain typed through real shell cleanup', () => {
  for (const [mode, detail, reason, stage] of [
    ['--supervisor-post-ready-exception-self-test',
      'unexpected_supervisor_exception', 'supervisor_exception', 'payload_readiness_wait'],
    ['--supervisor-group-record-remove-failure-self-test',
      'group_record_remove_failed', 'none', 'group_record_remove'],
  ]) {
    expectScenario(mode, expectedWithStandardFinalizer({
      cleanup_complete: true,
      handshake_failed: false,
      injected_supervisor_failure_reaped: true,
      status: 'passed',
      supervisor_detail: detail,
      supervisor_reason: reason,
      supervisor_stage: stage,
      supervisor_status: 125,
    }));
  }
});

test('progress and runProgram timeouts remain typed after outer group reaping', () => {
  const progress = run('--progress-timeout-self-test', 30_000);
  const progressDiagnostics = diagnostics(progress);
  assert.equal(progress.status, 124, progressDiagnostics);
  const receipt = JSON.parse(progress.stdout.trim());
  assert.equal(receipt.status, 'failed', progressDiagnostics);
  assert.equal(receipt.error_code, 'PROOF_TIMEOUT', progressDiagnostics);
  assert.equal(receipt.cleanup_complete, true, progressDiagnostics);
  assert.equal(receipt.recovery_root_retained, false, progressDiagnostics);
  assert.equal(receipt.progress_receipt_valid, true, progressDiagnostics);
  assert.equal(receipt.last_started_stage, 'initial_capture', progressDiagnostics);
  assert.equal(receipt.last_completed_stage, 'target_channel_creation', progressDiagnostics);
  assert.ok(Number.isSafeInteger(receipt.progress_elapsed_ms), progressDiagnostics);

  const readiness = spawnSync('node', [selfTestHelperPath, '--run-program-timeout-readiness-self-test'], {
    cwd: root, encoding: 'utf8', timeout: 3_000,
  });
  assert.equal(readiness.status, 0, diagnostics(readiness));
  assert.deepEqual(JSON.parse(readiness.stdout.trim()), {
    malformed_readiness_error_code: 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED',
    missing_readiness_error_code: 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED',
    raw_readiness_reflected: false,
    status: 'passed',
  });
  assert.doesNotMatch(`${readiness.stdout}\n${readiness.stderr}`,
    /RAW_RUN_PROGRAM_READINESS_SENTINEL_MUST_NOT_LEAK/u);
  const timeout = run('--run-program-timeout-self-test', 30_000);
  assert.equal(timeout.status, 0, diagnostics(timeout));
  assert.deepEqual(JSON.parse(timeout.stdout.trim()), expectedWithStandardFinalizer({
    captured_output_reflected: false,
    cleanup_complete: true,
    run_program_timeout_ambiguous: true,
    status: 'passed',
    timeout_descendant_reaped: true,
  }), diagnostics(timeout));
  assert.doesNotMatch(`${timeout.stdout}\n${timeout.stderr}`, /RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK/u);
});

test('cleanup progress sanitization stays bounded under supervised timeout', () => {
  expectScenario('--progress-sanitizer-timeout-self-test', expectedWithStandardFinalizer({
    cleanup_complete: true,
    sanitizer_timeout_bounded: true,
    status: 'passed',
  }), 12_000);
});

test('fast-exit handshake cleanup uses the durable admission acknowledgment', () => {
  expectScenario('--supervisor-handshake-delay-self-test', {
    supervisor_start_handshake_fail_closed: true, status: 'passed',
  }, 18_000);
});

test('wrapper-owned records gate payload admission and remain recoverable', () => {
  for (const [mode, expected] of [
    ['--supervisor-admission-success-self-test', expectedWithStandardFinalizer({
      admission_ack_bound: true,
      cleanup_complete: true,
      payload_admitted_after_ack: true,
      status: 'passed',
    })],
    ['--supervisor-record-publication-failure-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, payload_admitted: false,
      record_publication_failure_bounded: true, status: 'passed',
    })],
    ['--supervisor-wrapper-crash-before-admission-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, payload_admitted: false,
      record_recovered_after_wrapper_crash: true, status: 'passed',
    })],
    ['--supervisor-parent-loss-before-record-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, delayed_wrapper_reaped: true, parent_loss_before_record_fail_closed: true,
      payload_admitted: false, status: 'passed',
    })],
    ['--supervisor-parent-loss-before-admission-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, durable_record_recovered: true,
      parent_loss_before_admission_fail_closed: true,
      payload_admitted: false, status: 'passed',
    })],
    ['--supervisor-signal-before-admission-self-test', expectedWithStandardFinalizer({
      cleanup_complete: true, payload_admitted: false,
      signal_before_admission_fail_closed: true, status: 'passed',
    })],
  ]) {
    expectScenario(mode, expected, 20_000);
  }
});

test('final reap handlers survive repeated TERM until descendants are gone', () => {
  expectScenario('--supervisor-final-reap-signal-self-test', expectedWithStandardFinalizer({
    cleanup_complete: true,
    final_reap_signal_idempotent: true,
    status: 'passed',
  }), 18_000);
});

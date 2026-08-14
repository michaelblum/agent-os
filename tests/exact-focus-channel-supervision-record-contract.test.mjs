import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonicalLifecyclePathIdentity,
  parseSupervisorFailureReceiptText,
  serializeSupervisorFailureReceipt,
  supervisorProcessIdentityIsValid,
} from './lib/exact-focus-channel-supervision-protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-protocol.mjs');
const supervisorPath = path.join(root, 'tests/lib/exact-focus-channel-supervision.mjs');
const shellPath = path.join(root, 'tests/lib/exact-focus-channel-supervision.zsh');
const scenarioPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-scenarios.zsh');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');
const diagnostics = (result) => JSON.stringify({
  signal: result.signal, status: result.status, stderr: result.stderr, stdout: result.stdout,
});
const recordContractPath = fileURLToPath(import.meta.url);

test('record and identity lifecycle stays singly owned by exact helpers', () => {
  const protocol = fs.readFileSync(protocolPath, 'utf8');
  const supervisor = fs.readFileSync(supervisorPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const scenario = fs.readFileSync(scenarioPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const recordContract = fs.readFileSync(recordContractPath, 'utf8');
  const stopGroup = shell.slice(shell.indexOf('exact_focus_supervision_stop_group()'),
    shell.indexOf('exact_focus_supervision_settle_late_group_record()'));
  const supervisorProjection = shell.slice(shell.indexOf(
    'exact_focus_supervision_supervisor_projection_is_valid()'),
  shell.indexOf('exact_focus_supervision_signal_supervisor_if_current()'));
  const stopSupervisor = shell.slice(shell.indexOf(
    'exact_focus_supervision_supervisor_identity_is_valid()'),
  shell.indexOf('exact_focus_supervision_finish_sender()'));
  assert.match(protocol, /parseSupervisorFailureReceiptText[\s\S]+slice\(0, -1\)\.includes\('\\n'\)[\s\S]+serializeSupervisorFailureReceipt[\s\S]+=== text/u);
  const publisher = protocol.slice(protocol.indexOf('function exactSupervisorFailureDestination'),
    protocol.indexOf('function stableHeldMetadata'));
  const quiesce = shell.slice(shell.indexOf('exact_focus_supervision_quiesce()'));
  assert.ok(recordContract.split('\n').length - 1 <= 500);
  assert.match(publisher, /O_WRONLY \| fs\.constants\.O_CREAT \| fs\.constants\.O_EXCL[\s\S]+noFollow[\s\S]+openSync\(file, flags, 0o000\)/u);
  assert.match(publisher, /fsyncSync\(descriptor\)[\s\S]+fsyncSupervisorFailureParent/u);
  assert.match(publisher, /exactSupervisorFailureDestination[\s\S]+fchmodSync\(descriptor, 0o600\)/u);
  assert.doesNotMatch(publisher, /unlinkSync|linkSync/u);
  assert.match(supervisor, /--failure-receipt-file[\s\S]+failureAttempted[\s\S]+publishSupervisorFailure/u);
  assert.match(supervisor, /function publishSupervisorFailure[\s\S]+writeSupervisorFailureReceipt/u);
  assert.match(supervisor, /new Set\(lifecyclePaths\)\.size === 5/u);
  assert.match(protocol, /generate-supervisor-token[\s\S]+crypto\.randomBytes\(16\)\.toString\('hex'\)/u);
  assert.match(supervisor, /lifecyclePaths[\s\S]+canonicalLifecyclePathIdentity[\s\S]+new Set\(pathIdentities\)\.size === 5[\s\S]+SUPERVISOR_PATHS_INVALID/u);
  assert.match(shell, /generate-supervisor-token[\s\S]+--supervisor-token "\$EFCS_SUPERVISOR_TOKEN"/u);
  assert.doesNotMatch(supervisor, /process\.stderr\.write/u);
  assert.match(shell, /capture_failure_detail\(\)[\s\S]+read-supervisor-failure-detail[\s\S]+rm -f -- "\$receipt_file"/u);
  assert.match(shell, /resolve_failure_receipt\(\)[\s\S]+EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE/u);
  assert.match(shell, /--failure-receipt-file "\$EFCS_FAILURE_RECEIPT_FILE"/u);
  assert.match(supervisorProjection, /process_parent_id[\s\S]+process_command[\s\S]+validate-supervisor-process-identity/u);
  assert.match(stopSupervisor, /supervisor_identity_is_valid[\s\S]+send_process_signal TERM[\s\S]+supervisor_identity_is_valid[\s\S]+send_process_signal KILL/u);
  assert.doesNotMatch(stopSupervisor, /\bkill -0\b|\bkill -TERM\b|\bkill -KILL\b/u);
  assert.equal((stopGroup.match(/owned_group_pid_from_file/gu) ?? []).length, 3);
  assert.ok(stopGroup.indexOf('owner_projection)') < stopGroup.indexOf('send_group_signal TERM'));
  assert.ok(stopGroup.lastIndexOf('owned_group_pid_from_file')
    < stopGroup.indexOf('send_group_signal KILL'));
  assert.equal((stopGroup.match(/remove_identical_owner_records "\$projection"/gu) ?? []).length, 2);
  assert.equal((quiesce.match(/exact_focus_supervision_stop_group/gu) ?? []).length, 2);
  assert.match(quiesce, /stop_group \|\| true[\s\S]+stop_supervisor[\s\S]+stop_group \|\| failed=1/u);
  assert.equal((shell.match(/exact_focus_supervision_signal_supervisor_if_current (?:TERM|KILL)/gu) ?? []).length, 4);
  assert.doesNotMatch(shell, /\/bin\/kill -(?:TERM|KILL) "\$(?:2|3)"/u);
  assert.match(runner, /EFCS_FIXTURE_IDENTITY_FLIPPED[\s\S]+stop_owned_fixture \|\| ! kill -0[\s\S]+FIXTURE_KILL_FILE[\s\S]+send_process_signal\(\) \{ \/bin\/kill/u);
  assert.match(runner, /STALE_TOKEN" > "\$EFCS_ADMISSION_ACK_FILE"[\s\S]+stop_group[\s\S]+SELFTEST_TERM_FILE[\s\S]+SELFTEST_UNRELATED_GROUP_TOKEN" >\| "\$EFCS_ADMISSION_ACK_FILE"[\s\S]+stop_group/u);
  assert.match(scenario, /--self-test-stderr-sentinel[\s\S]+PAYLOAD_STDERR_SENTINEL[\s\S]+PAYLOAD_STDERR_RECEIPT_ISOLATION_FAILED/u);
});

test('supervisor process identity validates only its pre-payload option prefix', () => {
  const owner = 42;
  const token = '0123456789abcdef0123456789abcdef';
  const [helper, group, guardian, ready, failure] = [
    '/tmp/supervisor.mjs', '/tmp/group', '/tmp/guardian', '/tmp/ready', '/tmp/failure',
  ];
  const prefix = [helper, '--supervise-command', '--owner-pid', owner, '--supervisor-token', token,
    '--group-pid-file', group, '--guardian-identity-file', guardian, '--ready-file', ready,
    '--failure-receipt-file', failure, '--timeout-ms', owner].join(' ');
  const valid = `${prefix} -- /bin/echo ${helper} --supervise-command --supervisor-token ${token} --owner-pid ${owner} ${group} ${failure}`;
  assert.equal(supervisorProcessIdentityIsValid(
    valid, helper, owner, token, group, guardian, ready, failure,
  ), true);
  for (const invalid of [
    `${prefix} --owner-pid ${owner} -- /bin/true`,
    valid.replace(`--owner-pid ${owner}`, '--owner-pid 43'),
    valid.replace('--group-pid-file', '--supervise-command --group-pid-file'),
    valid.replace(`--supervisor-token ${token}`, '--supervisor-token fedcba9876543210fedcba9876543210'),
    valid.replace(`--supervisor-token ${token} `, ''),
    `${prefix} --supervisor-token ${token} -- /bin/true`,
  ]) {
    assert.equal(supervisorProcessIdentityIsValid(
      invalid, helper, owner, token, group, guardian, ready, failure,
    ), false);
  }
  const generated = spawnSync('node', [protocolPath, '--generate-supervisor-token'],
    { cwd: root, encoding: 'utf8', timeout: 2_000 });
  assert.equal(generated.status, 0, diagnostics(generated));
  assert.match(generated.stdout, /^[0-9a-f]{32}$/u);
  assert.equal(generated.stderr, '');
  const extra = spawnSync('node', [protocolPath, '--generate-supervisor-token', 'extra'],
    { cwd: root, encoding: 'utf8', timeout: 2_000 });
  assert.deepEqual([extra.status, extra.stdout, extra.stderr], [1, '', '']);
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-token-admission-'));
  try {
    const marker = path.join(temporaryRoot, 'payload');
    const failureReceipt = path.join(temporaryRoot, 'failure');
    const duplicate = spawnSync(process.execPath, [supervisorPath, '--supervise-command',
      '--owner-pid', String(process.pid), '--supervisor-token', token, '--supervisor-token', token,
      '--group-pid-file', path.join(temporaryRoot, 'group'),
      '--guardian-identity-file', path.join(temporaryRoot, 'guardian'),
      '--ready-file', path.join(temporaryRoot, 'ready'), '--failure-receipt-file', failureReceipt,
      '--timeout-ms', '10', '--', process.execPath, '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'payload')`],
    { cwd: root, encoding: 'utf8', timeout: 2_000 });
    assert.deepEqual([duplicate.status, duplicate.stdout, duplicate.stderr], [125, '', '']);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(parseSupervisorFailureReceiptText(fs.readFileSync(failureReceipt, 'utf8'))?.status, 125);
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('supervisor failure receipt accepts only its canonical single line', () => {
  const canonical = serializeSupervisorFailureReceipt(
    'parent_lost', 'payload_outcome_wait', 125, 'parent_lost');
  assert.equal(parseSupervisorFailureReceiptText(canonical)?.detail, 'parent_lost');
  for (const framing of [canonical.trim(), `prefix\n${canonical}`, canonical + canonical,
    canonical.replace('{"detail":"parent_lost","reason":"parent_lost"',
      '{"reason":"parent_lost","detail":"parent_lost"')]) {
    assert.equal(parseSupervisorFailureReceiptText(framing), null);
  }
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-record-cli-'));
  const file = path.join(temporaryRoot, 'failure');
  try {
    fs.writeFileSync(file, canonical, { mode: 0o600 });
    const valid = spawnSync('node', [protocolPath, '--read-supervisor-failure-detail', file],
      { encoding: 'utf8', timeout: 2_000 });
    assert.deepEqual([valid.status, valid.stderr], [0, '']);
    for (const framing of [canonical.trim(), `prefix\n${canonical}`, canonical + canonical]) {
      fs.writeFileSync(file, framing, { mode: 0o600 });
      const invalid = spawnSync('node', [protocolPath, '--read-supervisor-failure-detail', file],
        { encoding: 'utf8', timeout: 2_000 });
      assert.deepEqual([invalid.status, invalid.stdout, invalid.stderr], [1, '', '']);
    }
    fs.unlinkSync(file); fs.symlinkSync(path.join(temporaryRoot, 'missing'), file);
    const broken = spawnSync('node', [protocolPath, '--read-supervisor-failure-detail', file],
      { encoding: 'utf8', timeout: 2_000 });
    assert.deepEqual([broken.status, broken.stdout, broken.stderr], [1, '', '']);
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('direct supervisor identity flip permits TERM but never KILL to a replacement', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-pid-seam-'));
  const result = spawnSync('zsh', ['-c', `
    . "$1"
    exact_focus_supervision_init "$2" "$2" "$2" "$2" "$3" "$3/group" "$3/out" "$3/err"
    helper="$2" seam_root="$3" token=0123456789abcdef0123456789abcdef
    EFCS_READY_FILE="$3/ready" EFCS_GUARDIAN_IDENTITY_FILE="$3/guardian"
    EFCS_FAILURE_RECEIPT_FILE="$3/failure" EFCS_SUPERVISOR_TOKEN="$token"
    flipped=0 signal_log=""
    exact_focus_supervision_process_exists() { return 0; }
    exact_focus_supervision_process_parent_id() { print -r -- "$$"; }
    exact_focus_supervision_pause() { :; }
    exact_focus_supervision_process_command() {
      emitted_token="$token"
      (( flipped == 0 )) || emitted_token=fedcba9876543210fedcba9876543210
      command=(node "$helper" --supervise-command --owner-pid $$ --supervisor-token "$emitted_token"
        --group-pid-file "$seam_root/group" --guardian-identity-file "$seam_root/guardian"
        --ready-file "$seam_root/ready" --failure-receipt-file "$seam_root/failure"
        --timeout-ms 1 -- /bin/true)
      print -r -- "\${command[*]}"
    }
    exact_focus_supervision_send_process_signal() { signal_log="$signal_log $1"; [[ "$1" != TERM ]] || flipped=1; }
    exact_focus_supervision_stop_supervisor 424242 && exit 11
    [[ "$signal_log" == " TERM" ]] || { print -u2 -- "signal-log:$signal_log"; exit 12; }
    EFCS_PID="" EFCS_READY_FILE="" EFCS_GUARDIAN_IDENTITY_FILE=""
    EFCS_FAILURE_RECEIPT_FILE="$3/missing-failure" EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE=1
    exact_focus_supervision_resolve_failure_receipt 125 && exit 13
    exact_focus_supervision_admission_state_is_clear && exit 14
    exact_focus_supervision_quiesce && exit 15
    [[ "$EFCS_FAILURE_RECEIPT_FILE" == "$3/missing-failure" ]] || exit 16
    EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE=0
    EFCS_FAILURE_RECEIPT_FILE="$3/broken-failure"; /bin/ln -s "$3/missing" "$EFCS_FAILURE_RECEIPT_FILE"
    exact_focus_supervision_quiesce && exit 17
    [[ -L "$EFCS_FAILURE_RECEIPT_FILE" ]] || exit 18
    [[ "$EFCS_SUPERVISOR_TOKEN" == "$token" ]] || exit 19
    print -r -- term-only-and-record-state-retained
  `, 'record-identity-seam', shellPath, protocolPath, temporaryRoot], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  try {
    assert.equal(result.status, 0, diagnostics(result));
    assert.equal(result.stdout, 'term-only-and-record-state-retained\n');
    assert.equal(result.stderr, '');
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('inline supervisor signal helper requires its exact per-run token', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-inline-pid-'));
  const result = spawnSync('zsh', ['-c', `
    . "$1"
    signal_log="" mode=wrong helper="$2" seam_root="$3"
    token=0123456789abcdef0123456789abcdef
    exact_focus_supervision_process_parent_id() { print -r -- 77; }
    exact_focus_supervision_process_command() {
      token_option="--supervisor-token fedcba9876543210fedcba9876543210"
      [[ "$mode" != absent ]] || token_option=""
      [[ "$mode" != current ]] || token_option="--supervisor-token $token"
      print -r -- "$helper --supervise-command --owner-pid 77 $token_option \
        --group-pid-file $seam_root/group --guardian-identity-file $seam_root/guardian \
        --ready-file $seam_root/ready --failure-receipt-file $seam_root/failure \
        --timeout-ms 77 -- /bin/true"
    }
    exact_focus_supervision_send_process_signal() { signal_log="$signal_log $1"; }
    exact_focus_supervision_signal_supervisor_if_current TERM 4242 77 "$helper" "$2" \
      "$token" "$seam_root/group" "$seam_root/guardian" "$seam_root/ready" "$seam_root/failure" && exit 11
    [[ -z "$signal_log" ]] || exit 12
    mode=absent
    exact_focus_supervision_signal_supervisor_if_current TERM 4242 77 "$helper" "$2" \
      "$token" "$seam_root/group" "$seam_root/guardian" "$seam_root/ready" "$seam_root/failure" && exit 13
    [[ -z "$signal_log" ]] || exit 14
    mode=current
    exact_focus_supervision_signal_supervisor_if_current KILL 4242 77 "$helper" "$2" \
      "$token" "$seam_root/group" "$seam_root/guardian" "$seam_root/ready" "$seam_root/failure" || exit 15
    [[ "$signal_log" == " KILL" ]] || exit 16
    print -r -- token-bound-signal
  `, 'inline-identity-seam', shellPath, protocolPath, temporaryRoot], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  try {
    assert.deepEqual([result.status, result.stdout, result.stderr],
      [0, 'token-bound-signal\n', ''], diagnostics(result));
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('quiesce treats only its pre-supervisor group probe as advisory', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-quiesce-'));
  const result = spawnSync('zsh', ['-c', `
    . "$1"
    exact_focus_supervision_init "$2" "$2" "$2" "$2" "$3" "$3/group" "$3/out" "$3/err"
    EFCS_PID=4242 EFCS_GUARDIAN_IDENTITY_REQUIRED=1
    EFCS_GUARDIAN_IDENTITY_FILE="$3/guardian" EFCS_FAILURE_RECEIPT_FILE="$3/failure"
    EFCS_SUPERVISOR_TOKEN=0123456789abcdef0123456789abcdef
    group_calls=0 stopped=0
    exact_focus_supervision_stop_group() {
      (( group_calls += 1 ))
      (( group_calls == 1 )) && return 1
      (( stopped == 1 )) || return 1
      EFCS_GUARDIAN_IDENTITY_REQUIRED=0
    }
    exact_focus_supervision_stop_supervisor() { stopped=1; EFCS_LAST_STOPPED_SUPERVISOR_STATUS=0; }
    exact_focus_supervision_process_exists() { return 1; }
    exact_focus_supervision_path_is_absent() { return 0; }
    exact_focus_supervision_quiesce || exit 11
    (( group_calls == 2 && stopped == 1 )) && [[ -z "$EFCS_SUPERVISOR_TOKEN" ]] || exit 12
    EFCS_PID=4242 EFCS_GUARDIAN_IDENTITY_REQUIRED=1 EFCS_FAILURE_RECEIPT_FILE="$3/failure-2"
    EFCS_SUPERVISOR_TOKEN=0123456789abcdef0123456789abcdef
    group_calls=0 stopped=0
    exact_focus_supervision_stop_group() { (( group_calls += 1 )); return 1; }
    exact_focus_supervision_quiesce && exit 13
    (( group_calls == 2 && stopped == 1 )) \
      && [[ "$EFCS_SUPERVISOR_TOKEN" == 0123456789abcdef0123456789abcdef ]] || exit 14
    print -r -- early-startup-settled
  `, 'quiesce-startup-seam', shellPath, protocolPath, temporaryRoot], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  try {
    assert.deepEqual([result.status, result.stdout, result.stderr],
      [0, 'early-startup-settled\n', ''], diagnostics(result));
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('failure receipt seam residues stay mode-zero and become shell-finalizer failures', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-failure-publish-'));
  try {
    const canonical = serializeSupervisorFailureReceipt(
      'unexpected_supervisor_exception', 'cli_boundary', 125, 'supervisor_exception');
    for (const phase of ['pre-write', 'post-write', 'post-dir-sync']) {
      const failure = path.join(temporaryRoot, `failure-${phase}`);
      const result = spawnSync('node', [supervisorPath, '--supervise-command',
        '--owner-pid', String(process.pid), '--supervisor-token', '0123456789abcdef0123456789abcdef',
        '--group-pid-file', path.join(temporaryRoot, `group-${phase}`),
        '--guardian-identity-file', path.join(temporaryRoot, `guardian-${phase}`),
        '--ready-file', path.join(temporaryRoot, `ready-${phase}`), '--failure-receipt-file', failure,
        '--timeout-ms', '0', '--self-test-failure-receipt-publication-failure', phase,
        '--', '/bin/false'], { cwd: root, encoding: 'utf8', timeout: 2_000 });
      assert.deepEqual([result.status, result.stdout, result.stderr], [125, '', '']);
      const metadata = fs.lstatSync(failure);
      assert.equal(metadata.isFile() && metadata.nlink === 1 && (metadata.mode & 0o777) === 0, true);
      assert.equal(metadata.size, phase === 'pre-write' ? 0 : Buffer.byteLength(canonical));
      if (phase !== 'pre-write') {
        fs.chmodSync(failure, 0o600); assert.equal(fs.readFileSync(failure, 'utf8'), canonical);
        fs.chmodSync(failure, 0o000);
      }
      const shell = spawnSync('zsh', ['-c', `
        . "$1"
        exact_focus_supervision_init "$2" "$2" "$2" "$2" "$3" "$3/group" "$3/out" "$3/err"
        EFCS_FAILURE_RECEIPT_FILE="$4" EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE="$5"
        exact_focus_supervision_resolve_failure_receipt 125 && exit 11
        [[ "$EFCS_LAST_SUPERVISOR_DETAIL" == shell_finalizer_failure \
          && -f "$4" && ! -L "$4" && "$(/usr/bin/stat -f '%Lp' "$4")" == 0 ]] || exit 12
      `, 'failure-shell-finalizer', shellPath, protocolPath, temporaryRoot, failure, phase], {
        cwd: root, encoding: 'utf8', timeout: 2_000,
      });
      assert.deepEqual([shell.status, shell.stdout, shell.stderr], [0, '', ''], diagnostics(shell));
    }
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('canonical lifecycle identity rejects every alias pair before admission or writes', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'aos-ack-alias-'));
  try {
    const token = '0123456789abcdef0123456789abcdef';
    const run = (paths, marker) => {
      const args = [supervisorPath, '--supervise-command', '--owner-pid', String(process.pid),
        '--supervisor-token', token];
      if (paths.group !== null) args.push('--group-pid-file', paths.group);
      args.push('--guardian-identity-file', paths.guardian, '--ready-file', paths.ready,
        '--failure-receipt-file', paths.failure, '--timeout-ms', '10', '--', process.execPath,
        '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'payload')`);
      return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 2_000 });
    };
    const rejectAlias = (name, paths, sentinel) => {
      const marker = path.join(path.dirname(sentinel), `${name}-payload`);
      fs.writeFileSync(sentinel, name, { mode: 0o600 });
      const result = run(paths, marker);
      assert.deepEqual([result.status, result.stdout, result.stderr], [125, '', ''], name);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), name);
      assert.equal(fs.existsSync(marker), false);
      const sentinelIdentity = canonicalLifecyclePathIdentity(sentinel);
      const records = [paths.group, paths.group === null ? null : `${paths.group}.admission-ack`,
        paths.guardian, paths.ready, paths.failure];
      for (const record of records) {
        if (record !== null && canonicalLifecyclePathIdentity(record) !== sentinelIdentity) {
          assert.equal(fs.existsSync(record), false, `${name}:${record}`);
        }
      }
    };
    const pairs = [['group', 'guardian'], ['group', 'ready'], ['group', 'failure'],
      ['admission', 'guardian'], ['admission', 'ready'], ['admission', 'failure'],
      ['guardian', 'ready'], ['guardian', 'failure'], ['ready', 'failure']];
    for (const [left, right] of pairs) {
      const name = `${left}-${right}`;
      const caseRoot = path.join(temporaryRoot, name); fs.mkdirSync(caseRoot);
      const paths = { group: path.join(caseRoot, 'group'), guardian: path.join(caseRoot, 'guardian'),
        ready: path.join(caseRoot, 'ready'), failure: path.join(caseRoot, 'failure') };
      const target = left === 'admission' ? `${paths.group}.admission-ack` : path.join(caseRoot, 'shared');
      if (left !== 'admission') paths[left] = target;
      paths[right] = left === 'group' && right === 'ready' ? `${target}/./` : `${caseRoot}/./${path.basename(target)}`;
      assert.equal(new Set([paths.group, `${paths.group}.admission-ack`, paths.guardian,
        paths.ready, paths.failure]).size, 5, name);
      rejectAlias(name, paths, target);
    }
    const duplicateRoot = path.join(temporaryRoot, 'duplicate-slash'); fs.mkdirSync(duplicateRoot);
    rejectAlias('duplicate-slash', { group: path.join(duplicateRoot, 'group'),
      guardian: path.join(duplicateRoot, 'shared'), ready: path.join(duplicateRoot, 'ready'),
      failure: `${duplicateRoot}//shared` }, path.join(duplicateRoot, 'shared'));
    const dotDotRoot = path.join(temporaryRoot, 'dot-dot'); fs.mkdirSync(dotDotRoot);
    rejectAlias('dot-dot', { group: path.join(dotDotRoot, 'group'), guardian: path.join(dotDotRoot, 'guardian'),
      ready: path.join(dotDotRoot, 'shared'), failure: `${dotDotRoot}/unused/../shared` },
    path.join(dotDotRoot, 'shared'));
    const symlinkRoot = path.join(temporaryRoot, 'parent-symlink'); fs.mkdirSync(symlinkRoot);
    const realParent = path.join(symlinkRoot, 'real'); fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, path.join(symlinkRoot, 'alias'));
    rejectAlias('parent-symlink', { group: path.join(realParent, 'shared'),
      guardian: path.join(realParent, 'guardian'), ready: path.join(symlinkRoot, 'alias', 'shared'),
      failure: path.join(realParent, 'failure') }, path.join(realParent, 'shared'));
    const invalidRoot = path.join(temporaryRoot, 'invalid'); fs.mkdirSync(invalidRoot);
    const invalidPaths = { group: path.join(invalidRoot, 'missing-parent', 'group'),
      guardian: path.join(invalidRoot, 'guardian'), ready: path.join(invalidRoot, 'ready'),
      failure: path.join(invalidRoot, 'failure') };
    assert.equal(canonicalLifecyclePathIdentity(null), null);
    assert.equal(canonicalLifecyclePathIdentity(invalidPaths.group), null);
    for (const paths of [invalidPaths, { ...invalidPaths, group: null }]) {
      const marker = path.join(invalidRoot, paths.group === null ? 'null-payload' : 'missing-payload');
      const result = run(paths, marker);
      assert.deepEqual([result.status, result.stdout, result.stderr], [125, '', '']);
      assert.equal(fs.existsSync(marker), false);
      assert.equal(fs.existsSync(paths.failure), false);
    }
  } finally { fs.rmSync(temporaryRoot, { force: true, recursive: true }); }
});

test('live sibling disagreement and direct fixture identity reuse fail closed', () => {
  for (const mode of ['--pidfile-reuse-self-test', '--fixture-ownership-self-test']) {
    const result = spawnSync('zsh', [runnerPath, mode], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, diagnostics(result));
    assert.equal(JSON.parse(result.stdout).status, 'passed', diagnostics(result));
  }
});

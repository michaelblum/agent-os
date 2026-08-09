import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.swift');
const driverPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.mjs');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');

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

test('exact focus-channel fixture is synthetic, same-process, overlapping, and AX-distinct', () => {
  const helper = fs.readFileSync(helperPath, 'utf8');

  assert.match(helper, /SplitTargetView/u);
  assert.match(helper, /SolidSiblingView/u);
  assert.match(helper, /aos-exact-target-control/u);
  assert.match(helper, /aos-exact-sibling-control/u);
  assert.match(helper, /targetControl\.setAccessibilityChildren\(\[\]\)/u);
  assert.match(helper, /ownership_token/u);
  assert.match(helper, /windowPID\(entries\[targetIndex\]\) == Int\(getpid\(\)\)/u);
  assert.match(helper, /windowPID\(entries\[siblingIndex\]\) == Int\(getpid\(\)\)/u);
  assert.match(helper, /windowLayer\(entries\[targetIndex\]\) == 0/u);
  assert.match(helper, /windowLayer\(entries\[siblingIndex\]\) == 0/u);
  assert.match(helper, /siblingIndex < targetIndex/u);
  assert.match(helper, /overlapFraction >= 0\.35/u);
  assert.match(helper, /siblingBounds\.contains\(CGPoint\(x: targetBounds\.midX, y: targetBounds\.midY\)\)/u);
  assert.match(helper, /CGDisplayMirrorsDisplay/u);
  assert.match(helper, /CGDisplayBounds\(\$0\)\.contains\(bounds\)/u);
  assert.doesNotMatch(helper, /ScreenCaptureKit|SCScreenshotManager|SCStream/u);
  assert.doesNotMatch(helper, /CGWindowListCreateImage|CGDisplayCreateImage/u);
});

test('exact focus-channel live driver uses passive public preflights and bounded public evidence routes', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const combined = `${driver}\n${runner}`;

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

  assert.match(runner, /AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK/u);
  assert.match(runner, /run_driver_with_deadline 45000/u);
  assert.match(runner, /--supervise-command/u);
  assert.match(runner, /stop_owned_group/u);
  assert.match(runner, /stop_owned_fixture/u);
  assert.match(runner, /channel-cleanup-armed/u);
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
});

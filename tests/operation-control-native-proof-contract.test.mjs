import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  OperationNativeProofError,
  assertBarrierUnchanged,
  assertContentFreeSummary,
  assertPreflight,
  assertTapUnavailable,
  commandErrorCode,
  envelopeData,
  makeSummary,
  parseSingleJSON,
  selfTestSummary,
} from './lib/operation-control-native-proof-contract.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(import.meta.dirname, '..')
const shellPath = path.join(repoRoot, 'tests/manual/operation-control-native-proof.sh')
const driverPath = path.join(repoRoot, 'tests/manual/operation-control-native-proof.mjs')
const contractPath = path.join(repoRoot, 'tests/lib/operation-control-native-proof-contract.mjs')

function successEnvelope(data) {
  return { v: 1, status: 'success', ref: 'proof-ref', data }
}

function validPreflight() {
  return {
    aosPath: path.join(repoRoot, 'aos'),
    build: {
      status: 'current',
      current: true,
      source_fingerprint: 'a'.repeat(64),
      recorded_fingerprint: 'a'.repeat(64),
    },
    status: {
      status: 'degraded',
      runtime: {
        mode: 'repo',
        socket_reachable: true,
        daemon_pid: 101,
        serving_pid: 101,
        owner_pid: 101,
        ownership_state: 'consistent',
        ownership_kind: 'launchd_managed',
        owner_launchd_managed: true,
        service_pid: 101,
      },
    },
    service: {
      status: 'ok',
      mode: 'repo',
      loaded: true,
      running: true,
      pid: 101,
      target_matches_expected: true,
      actual_binary_path: path.join(repoRoot, 'aos'),
      expected_binary_path: path.join(repoRoot, 'aos'),
    },
    permissions: {
      permissions: { microphone: true },
      daemon_view: {
        reachable: true,
        microphone: true,
        microphone_state: 'authorized',
      },
    },
    barrier: successEnvelope({
      schema_version: 'aos.host-stop-barrier.status-receipt.v1',
      daemon_generation: 9,
      barrier_generation: 3,
      barrier_state: 'open',
      admission_open: true,
      stop_operation_id: null,
      stop_operation_generation: null,
      adapter_registry_revision: 4,
      registered_operation_set_count: 1,
      registered_operation_set_digest: 'c'.repeat(64),
      selected_operation_count: 0,
      selected_operation_digest: 'd'.repeat(64),
      barrier_snapshot_digest: null,
      reconciliation_state: 'complete',
      residual_count: 0,
      residual_digest: 'b'.repeat(64),
    }),
  }
}

test('manual operation-control proof self-test is offline and content-free', async () => {
  const result = await execFileAsync('/bin/zsh', [shellPath, '--self-test'], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024,
  })
  assert.equal(result.stderr, '')
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.status, 'passed')
  assert.equal(summary.execution_mode, 'offline_self_test')
  assert.equal(summary.schema_version, 'aos.operation-control-native-proof.v1')
  assert.deepEqual(summary.offline_checks, {
    live_evidence_unset: true,
    runtime_command_count: 0,
    summary_contract_validated: true,
  })
  assert.deepEqual(summary.preflight, makeSummary(summary.runtime_revision).preflight)
  assert.deepEqual(summary.ownership, makeSummary(summary.runtime_revision).ownership)
  assert.deepEqual(summary.singleton, makeSummary(summary.runtime_revision).singleton)
  assert.deepEqual(summary.tap, makeSummary(summary.runtime_revision).tap)
  assert.deepEqual(summary.ordinary_control, makeSummary(summary.runtime_revision).ordinary_control)
  assert.equal(summary.excluded_claims.host_stop_reopen_tested, false)
  assert.equal(summary.final.barrier_unchanged, false)
  assert.equal(summary.final.cleanup_complete, false)
  assert.equal(summary.final.recovery_root_retained, false)
  assertContentFreeSummary(summary)
})

test('preflight binds one current managed repo daemon, microphone authority, and clean open barrier', () => {
  const result = assertPreflight(validPreflight())
  assert.deepEqual(result.daemonIdentity, {
    daemonPID: 101,
    servicePID: 101,
    daemonGeneration: 9,
  })
  assert.equal(result.buildFingerprint, 'a'.repeat(64))
  assert.equal(result.barrier.barrier_generation, 3)

  const mutations = [
    ['RUNTIME_BINARY_STALE', (value) => { value.build.current = false }],
    ['DAEMON_OWNERSHIP_MISMATCH', (value) => { value.status.runtime.ownership_state = 'unmanaged' }],
    ['MICROPHONE_PERMISSION_REQUIRED', (value) => { value.permissions.permissions.microphone = false }],
    ['BARRIER_STATUS_INVALID', (value) => { value.barrier.data.daemon_generation = 0 }],
    ['BARRIER_STATUS_INVALID', (value) => { value.barrier.data.barrier_generation = 0 }],
    ['BARRIER_NOT_OPEN', (value) => { value.barrier.data.barrier_state = 'closed' }],
    ['BARRIER_RESIDUAL_PRESENT', (value) => { value.barrier.data.residual_count = 1 }],
  ]
  for (const [code, mutate] of mutations) {
    const value = structuredClone(validPreflight())
    mutate(value)
    assert.throws(() => assertPreflight(value), (error) => (
      error instanceof OperationNativeProofError && error.code === code
    ))
  }


  const finalBarrier = structuredClone(result.barrier)
  assert.equal(assertBarrierUnchanged(result.barrier, finalBarrier), finalBarrier)
  finalBarrier.adapter_registry_revision += 1
  assert.throws(() => assertBarrierUnchanged(result.barrier, finalBarrier), /BARRIER_CHANGED/u)
})

test('live preflight runs passive commands serially in exact order', async () => {
  const { livePreflight } = await import(pathToFileURL(driverPath).href)
  const expectedCommands = [
    ['runtime', 'build-attestation', '--json'],
    ['status', '--json'],
    ['service', 'status', '--mode', 'repo', '--json'],
    ['permissions', 'check', '--json'],
    ['operation', 'barrier-status', '--json'],
  ]
  const preflight = validPreflight()
  const responses = [
    preflight.build,
    preflight.status,
    preflight.service,
    preflight.permissions,
    preflight.barrier,
  ]
  const commands = []
  let inFlight = 0
  let maxInFlight = 0
  const runner = {
    async runAOS(args) {
      const response = responses[commands.length]
      commands.push(args)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return { code: 0, signal: null, stdout: `${JSON.stringify(response)}\n`, stderr: '' }
    },
  }

  await livePreflight({ aos: preflight.aosPath }, runner)

  assert.deepEqual(commands, expectedCommands)
  assert.equal(maxInFlight, 1)
})

test('summary and operation envelopes reject sensitive or ambiguous material', () => {
  const summary = selfTestSummary()
  assertContentFreeSummary(summary)

  const sensitiveKey = structuredClone(summary)
  sensitiveKey.final.output_path = '/private/tmp/proof.wav'
  assert.throws(() => assertContentFreeSummary(sensitiveKey), /SUMMARY_SENSITIVE_KEY/u)

  const sensitiveValue = structuredClone(summary)
  sensitiveValue.failure_code = '/private/tmp/proof.wav'
  assert.throws(() => assertContentFreeSummary(sensitiveValue), /SUMMARY_SENSITIVE_VALUE/u)

  const widenedClaim = structuredClone(summary)
  widenedClaim.excluded_claims.status_canvas_tested = true
  assert.throws(() => assertContentFreeSummary(widenedClaim), /SUMMARY_EXCLUDED_CLAIM_INVALID/u)

  assert.deepEqual(envelopeData(successEnvelope({ ok: true })), { ok: true })
  assert.throws(() => envelopeData({ v: 1, status: 'error' }), /OPERATION_ENVELOPE_INVALID/u)
  assert.deepEqual(parseSingleJSON('{\n  "ok": true\n}\n'), { ok: true })
  assert.throws(() => parseSingleJSON('{"first":true}\n{"second":true}\n'), /INVALID_JSON_RESULT/u)
  assert.equal(commandErrorCode({ stdout: '', stderr: '{"code":"OPERATION_RESOURCE_BUSY"}\n' }), 'OPERATION_RESOURCE_BUSY')
  assert.equal(commandErrorCode({
    stdout: '',
    stderr: '{\n  "code" : "OPERATION_BARRIER_CLOSED",\n  "error" : "closed"\n}\n',
  }), 'OPERATION_BARRIER_CLOSED')
  assert.equal(commandErrorCode({ stdout: 'timeout', stderr: '' }), null)

  const failed = makeSummary('0'.repeat(40))
  assert.equal(failed.status, 'failed')
  assert.equal(failed.final.recovery_root_retained, true)
})

test('tap proof requires exact typed unavailability and no created tap record', () => {
  const before = { taps: [] }
  const after = { taps: [] }
  const unavailable = {
    code: 1,
    stdout: '{"v":1,"status":"error","error":"OPERATION_TAP_UNAVAILABLE","code":"OPERATION_TAP_UNAVAILABLE"}\n',
    stderr: '',
  }
  assert.equal(assertTapUnavailable(unavailable, before, after), 'OPERATION_TAP_UNAVAILABLE')
  assert.throws(
    () => assertTapUnavailable({ ...unavailable, code: 0 }, before, after),
    /TAP_UNAVAILABLE_COMMAND_SUCCEEDED/u,
  )
  assert.throws(
    () => assertTapUnavailable({ ...unavailable, stdout: '{"code":"OPERATION_RECORD_INVALID"}\n' }, before, after),
    /TAP_UNAVAILABLE_CODE_INVALID/u,
  )
  assert.throws(
    () => assertTapUnavailable(unavailable, before, { taps: [{ id: 'tap-1', generation: 1 }] }),
    /TAP_RECORD_CREATED/u,
  )
})

test('driver import is inert and a direct worker without supervision fails before live admission', async () => {
  await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(pathToFileURL(driverPath).href)})`,
  ], { cwd: repoRoot, encoding: 'utf8' })

  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-native-proof.'))
  const summaryPath = path.join(root, 'summary.json')
  const environment = { ...process.env }
  for (const key of [
    'AOS_OPERATION_CONTROL_NATIVE_PROOF_OK',
    'AOS_OPERATION_CONTROL_SAFE_CHECKPOINT',
    'AOS_OPERATION_CONTROL_PROOF_LOCK_DIR',
  ]) delete environment[key]
  try {
    await assert.rejects(execFileAsync(process.execPath, [
      driverPath,
      '--worker',
      '--mode', 'run',
      '--aos', path.join(root, 'unavailable-aos'),
      '--root', repoRoot,
      '--temp-root', root,
      '--runtime-revision', '0'.repeat(40),
      '--summary', summaryPath,
    ], { cwd: repoRoot, env: environment, encoding: 'utf8' }))
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
    assert.equal(summary.status, 'failed')
    assert.equal(summary.failure_code, 'SUPERVISION_CAPABILITY_INVALID')
    assert.equal(summary.final.recovery_root_retained, true)
    assertContentFreeSummary(summary)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fully forged live environment and lock cannot let a direct worker invoke fake AOS', async () => {
  const fakeRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-fake-repo.'))
  const proofRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-native-proof.'))
  const summaryPath = path.join(proofRoot, 'summary.json')
  const fakeAOS = path.join(fakeRoot, 'aos')
  const marker = path.join(fakeRoot, 'aos-was-invoked')
  const tracked = path.join(fakeRoot, 'tracked.txt')
  const lockDir = `/private/tmp/aos-operation-control-native-proof.${process.getuid()}.lock`
  let lockCreated = false
  try {
    await writeFile(tracked, 'tracked\n')
    await execFileAsync('/usr/bin/git', ['init', '--quiet'], { cwd: fakeRoot })
    await execFileAsync('/usr/bin/git', ['add', 'tracked.txt'], { cwd: fakeRoot })
    await execFileAsync('/usr/bin/git', [
      '-c', 'user.name=Operation Proof Test',
      '-c', 'user.email=operation-proof@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ], { cwd: fakeRoot })
    const { stdout: revisionOutput } = await execFileAsync('/usr/bin/git', ['rev-parse', 'HEAD'], {
      cwd: fakeRoot,
      encoding: 'utf8',
    })
    await writeFile(fakeAOS, [
      '#!/usr/bin/env node',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called')`,
      '',
    ].join('\n'), { mode: 0o700 })
    await mkdir(lockDir, { mode: 0o700 })
    lockCreated = true

    const environment = {
      ...process.env,
      AOS_OPERATION_CONTROL_NATIVE_PROOF_OK: '1',
      AOS_OPERATION_CONTROL_SAFE_CHECKPOINT: 'parked-and-verified',
      AOS_OPERATION_CONTROL_PROOF_LOCK_DIR: lockDir,
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      AOS_ALLOW_DAEMON_AUTOSTART: '0',
    }
    for (const key of [
      'AOS_STATE_ROOT', 'AOS_RUNTIME_MODE', 'AOS_PATH', 'AOS_SOCKET_PATH',
      'AOS_BYPASS_PERMISSIONS_SETUP', 'AOS_TEST_ASSUME_PERMISSIONS_GRANTED',
    ]) delete environment[key]

    await assert.rejects(execFileAsync(process.execPath, [
      driverPath,
      '--worker',
      '--mode', 'run',
      '--aos', fakeAOS,
      '--root', fakeRoot,
      '--temp-root', proofRoot,
      '--runtime-revision', revisionOutput.trim(),
      '--summary', summaryPath,
    ], { cwd: fakeRoot, env: environment, encoding: 'utf8' }))
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
    assert.equal(summary.failure_code, 'SUPERVISION_CAPABILITY_INVALID')
    await assert.rejects(access(marker))
  } finally {
    if (lockCreated) await rmdir(lockDir)
    await Promise.all([
      rm(fakeRoot, { recursive: true, force: true }),
      rm(proofRoot, { recursive: true, force: true }),
    ])
  }
})

test('direct entry cannot overwrite or publish outside its exact private proof root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-native-proof.'))
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-native-proof-outside.'))
  const summaryPath = path.join(root, 'summary.json')
  const outsideSummary = path.join(outsideRoot, 'summary.json')
  const sentinel = 'existing-summary-must-survive\n'
  await writeFile(summaryPath, sentinel, { mode: 0o600 })
  const baseArgs = [
    driverPath,
    '--worker',
    '--mode', 'run',
    '--aos', path.join(root, 'unavailable-aos'),
    '--root', repoRoot,
    '--temp-root', root,
    '--runtime-revision', '0'.repeat(40),
  ]
  try {
    await assert.rejects(execFileAsync(process.execPath, [...baseArgs, '--summary', summaryPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    }))
    assert.equal(await readFile(summaryPath, 'utf8'), sentinel)
    await rm(summaryPath, { force: true })

    await assert.rejects(execFileAsync(process.execPath, [...baseArgs, '--summary', outsideSummary], {
      cwd: repoRoot,
      encoding: 'utf8',
    }))
    await assert.rejects(access(outsideSummary))
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ])
  }
})

test('offline wrapper interruption is monotonic before, during, and through success publication', async () => {
  for (const phase of ['prelaunch', 'inflight', 'postdriver', 'prepublish']) {
    const tempParent = await mkdtemp(path.join(os.tmpdir(), `aos-operation-control-${phase}.`))
    let rejection
    try {
      try {
        await execFileAsync('/bin/zsh', [shellPath, '--self-test'], {
          cwd: repoRoot,
          env: {
            ...process.env,
            TMPDIR: tempParent,
            AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_SIGNAL_PHASE: phase,
          },
          encoding: 'utf8',
          maxBuffer: 256 * 1024,
        })
      } catch (error) {
        rejection = error
      }
      assert.ok(rejection, `${phase} interruption unexpectedly passed`)
      assert.notEqual(rejection.code, 0, phase)
      const stdout = String(rejection.stdout ?? '').trim()
      if (stdout) assert.notEqual(JSON.parse(stdout).status, 'passed', phase)

      const roots = await readdir(tempParent)
      if (phase === 'postdriver') assert.equal(roots.length, 1)
      if (phase === 'prepublish') assert.equal(roots.length, 0)
      assert.ok(roots.length <= 1, phase)
      if (roots.length === 1) {
        const retainedRoot = path.join(tempParent, roots[0])
        const rootStat = await lstat(retainedRoot)
        assert.equal(rootStat.mode & 0o777, 0o700)
        assert.deepEqual(await readdir(retainedRoot), ['summary.json'])
        const summaryPath = path.join(retainedRoot, 'summary.json')
        const summaryStat = await lstat(summaryPath)
        assert.equal(summaryStat.mode & 0o777, 0o600)
        assert.equal(JSON.parse(await readFile(summaryPath, 'utf8')).status, 'failed')
      }
    } finally {
      await rm(tempParent, { recursive: true, force: true })
    }
  }
})

test('failed wrapper retention refuses a raced summary instead of truncating it', async () => {
  const tempParent = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-retention-race.'))
  try {
    let rejection
    try {
      await execFileAsync('/bin/zsh', [shellPath, '--self-test'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          TMPDIR: tempParent,
          AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_SIGNAL_PHASE: 'postdriver',
          AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_RETENTION_RACE: '1',
        },
        encoding: 'utf8',
        maxBuffer: 256 * 1024,
      })
    } catch (error) {
      rejection = error
    }
    assert.ok(rejection)
    assert.match(String(rejection.stderr), /could not retain a content-free recovery summary/u)
    assert.deepEqual(await readdir(tempParent), [])
    const stdout = String(rejection.stdout ?? '').trim()
    if (stdout) assert.equal(JSON.parse(stdout).status, 'failed')
  } finally {
    await rm(tempParent, { recursive: true, force: true })
  }
})

test('live entrypoint retains explicit gates, bounded commands, exact effects, and exclusions', async () => {
  const [shell, driver, contract] = await Promise.all([
    readFile(shellPath, 'utf8'),
    readFile(driverPath, 'utf8'),
    readFile(contractPath, 'utf8'),
  ])
  for (const marker of [
    'AOS_OPERATION_CONTROL_NATIVE_PROOF_OK',
    'AOS_OPERATION_CONTROL_SAFE_CHECKPOINT',
    'parked-and-verified',
    'AOS_DISABLE_DAEMON_AUTOSTART=1',
    'AOS_ALLOW_DAEMON_AUTOSTART=0',
    'retain_content_free_summary',
    'LOCK_DIR',
    'forward_signal',
    'run_driver',
  ]) assert.ok(shell.includes(marker), marker)
  assert.match(shell, /git -C "\$ROOT" diff --quiet/u)
  assert.match(shell, /git -C "\$ROOT" diff --cached --quiet/u)
  assert.match(shell, /LOCK_DIR="\/private\/tmp\/aos-operation-control-native-proof\.\$\{UID\}\.lock"/u)
  assert.match(shell, /run_driver "\$DRIVER" \\\n\s+--supervise/u)
  assert.match(shell, /fs\.openSync\(summaryPath, "wx", 0o600\)/u)
  assert.doesNotMatch(shell, /print -r -- "\$SUMMARY" > "\$SUMMARY_PATH"/u)
  assert.match(shell, /\[\[ -n "\$INTERRUPTION_SIGNAL" \]\] \|\| INTERRUPTION_SIGNAL=/u)
  assert.doesNotMatch(shell, /LOCK_DIR=.*TMPDIR/u)
  assert.doesNotMatch(shell, /build\.sh|service start|service restart|ready --repair/u)

  for (const marker of [
    "'operation', 'list'",
    "operationArgs(first.identity, 'inspect')",
    "operationArgs(first.identity, 'status')",
    "'operation', 'kill-owner'",
    "'operation', 'tap'",
    "'operation', 'barrier-status'",
    "'OPERATION_OWNER_MISMATCH'",
    "'OPERATION_RESOURCE_BUSY'",
  ]) assert.ok(driver.includes(marker), marker)
  assert.match(contract, /artifact_success_tested: false/u)
  assert.match(contract, /status_canvas_tested: false/u)
  assert.match(contract, /prior_generation_recovery_tested: false/u)
  assert.match(contract, /tap_source_delivery_tested: false/u)
  assert.match(driver, /settleOwnedOperations/u)
  assert.match(driver, /validateProofFilesystem/u)
  assert.match(driver, /PROOF_INTERRUPTED_/u)
  assert.match(driver, /allowDuringInterruption/u)
  assert.match(driver, /Cleanup starts only after live work has stopped/u)
  assert.match(driver, /validateLiveAdmission/u)
  assert.match(driver, /validateSupervisorCapability/u)
  assert.match(driver, /supervisor_generation/u)
  assert.match(driver, /packet\.supervisor_pid === process\.ppid/u)
  assert.match(driver, /observeProcessGeneration\(process\.ppid\)/u)
  assert.match(driver, /terminationMode: 'term_then_kill'/u)
  assert.match(driver, /assertBarrierUnchanged\(preflight\.barrier, finalPreflight\.barrier\)/u)
  assert.match(driver, /assertTapUnavailable\(tap, firstInspect, afterTap\)/u)
  assert.doesNotMatch(driver, /--channel|--sample-every|--max-queue-items|terminalTap/u)
  assert.doesNotMatch(driver, /timeoutMilliseconds: null/u)
  assert.doesNotMatch(driver, /'operation', 'stop-all'|'operation', 'reopen'/u)
  assert.doesNotMatch(driver, /settleOwnedOperations[\s\S]*operationArgs\(identity, 'kill'\)/u)
  assert.doesNotMatch(shell, /AOS_OPERATION_CONTROL_DEDICATED_HOST_OK/u)
  assert.doesNotMatch(driver, /process\.kill\(-/u)
  assert.match(contract, /peer_loss_tested: false/u)
  assert.doesNotMatch(driver, /artifact (?:reveal|remove|release|retain)/u)
  assert.doesNotMatch(driver, /service', '(?:start|stop|restart)'/u)
})

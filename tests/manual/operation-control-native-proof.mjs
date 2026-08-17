import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, open, readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  OperationNativeProofError,
  activeMicrophoneOperations,
  assertBarrierUnchanged,
  assertContentFreeSummary,
  assertOperationSnapshot,
  assertPreflight,
  assertTerminalOperation,
  assertZeroTapCounters,
  commandErrorCode,
  envelopeData,
  makeSummary,
  operationIdentity,
  parseJSONLines,
  parseSingleJSON,
  requireProof,
  selfTestSummary,
} from '../lib/operation-control-native-proof-contract.mjs'

const maxOutputBytes = 128 * 1024
const readTimeoutMilliseconds = 12_000
const effectTimeoutMilliseconds = 12_000
const captureStartTimeoutMilliseconds = 15_000
const captureSettleTimeoutMilliseconds = 12_000
const pollIntervalMilliseconds = 100
const processObservationTimeoutMilliseconds = 2_000
const supervisorCapabilityTimeoutMilliseconds = 2_000
const supervisorTerminationGraceMilliseconds = 30_000
const supervisedProofTimeoutMilliseconds = 240_000
const supervisionPacketMaxBytes = 2_048
const supervisionSchemaVersion = 'aos.operation-control-native-proof.supervision.v1'
const activeProcesses = new Map()
let interruptionError = null
let rejectInterruption
const interruption = new Promise((_, reject) => { rejectInterruption = reject })
interruption.catch(() => {})

function requestInterruption(signal) {
  if (interruptionError !== null) return
  interruptionError = new OperationNativeProofError(`PROOF_INTERRUPTED_${signal}`)
  for (const [child, metadata] of activeProcesses) {
    if (metadata.interruptOnSignal
      && child.exitCode === null && child.signalCode === null) beginChildTermination(child, metadata)
  }
  rejectInterruption(interruptionError)
}

function beginChildTermination(child, metadata, signal = null) {
  if (child.exitCode !== null || child.signalCode !== null || metadata.terminationStarted) return
  metadata.terminationStarted = true
  const requestedSignal = signal ?? (metadata.terminationMode === 'term_then_kill' ? 'SIGTERM' : 'SIGKILL')
  child.kill(requestedSignal)
  if (requestedSignal === 'SIGTERM') {
    metadata.terminationTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, metadata.terminationGraceMilliseconds)
  }
}

function clearChildTermination(metadata) {
  if (metadata?.terminationTimer) clearTimeout(metadata.terminationTimer)
  if (metadata) metadata.terminationTimer = null
}

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => requestInterruption(signal))
}

function throwIfInterrupted() {
  if (interruptionError !== null) throw interruptionError
}

const optionKeys = Object.freeze(['aos', 'mode', 'root', 'runtime-revision', 'summary', 'temp-root'])

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new OperationNativeProofError('INVALID_ARG')
    }
    result[key.slice(2)] = value
  }
  requireProof(optionKeys.every((key) => typeof result[key] === 'string'), 'INVALID_ARG')
  requireProof(Object.keys(result).every((key) => optionKeys.includes(key)), 'INVALID_ARG')
  requireProof(['run', 'self-test'].includes(result.mode), 'INVALID_ARG')
  return result
}

function serializeArgs(options) {
  return optionKeys.flatMap((key) => [`--${key}`, options[key]])
}

function safeChildEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra }
  environment.AOS_DISABLE_DAEMON_AUTOSTART = '1'
  environment.AOS_ALLOW_DAEMON_AUTOSTART = '0'
  delete environment.AOS_EXTERNAL_DISPATCH_BINDING_TOKEN
  delete environment.AOS_EXTERNAL_DISPATCH_PARENT_PID
  return environment
}

async function validateLiveAdmission(options) {
  requireProof(process.env.AOS_OPERATION_CONTROL_NATIVE_PROOF_OK === '1', 'LIVE_PROOF_NOT_AUTHORIZED')
  requireProof(
    process.env.AOS_OPERATION_CONTROL_SAFE_CHECKPOINT === 'parked-and-verified',
    'SAFE_CHECKPOINT_NOT_CONFIRMED',
  )
  requireProof(process.env.AOS_DISABLE_DAEMON_AUTOSTART === '1', 'DAEMON_AUTOSTART_NOT_DISABLED')
  requireProof(process.env.AOS_ALLOW_DAEMON_AUTOSTART === '0', 'DAEMON_AUTOSTART_NOT_DISABLED')
  for (const key of [
    'AOS_STATE_ROOT', 'AOS_RUNTIME_MODE', 'AOS_PATH', 'AOS_SOCKET_PATH',
    'AOS_BYPASS_PERMISSIONS_SETUP', 'AOS_TEST_ASSUME_PERMISSIONS_GRANTED',
  ]) requireProof(process.env[key] === undefined, 'AMBIENT_RUNTIME_OVERRIDE')

  const root = path.resolve(options.root)
  const expectedAOS = path.join(root, 'aos')
  requireProof(path.resolve(options.aos) === expectedAOS, 'PROOF_BINARY_INVALID')
  const binary = await lstat(expectedAOS)
  requireProof(binary.isFile() && !binary.isSymbolicLink() && (binary.mode & 0o111) !== 0, 'PROOF_BINARY_INVALID')

  const expectedLock = `/private/tmp/aos-operation-control-native-proof.${process.getuid()}.lock`
  requireProof(process.env.AOS_OPERATION_CONTROL_PROOF_LOCK_DIR === expectedLock, 'PROOF_LOCK_INVALID')
  const lock = await lstat(expectedLock)
  requireProof(
    lock.isDirectory() && !lock.isSymbolicLink()
      && (lock.mode & 0o777) === 0o700 && lock.uid === process.getuid(),
    'PROOF_LOCK_INVALID',
  )

  const head = await runProgram('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root })
  requireProof(head.code === 0 && head.stdout.trim() === options.runtimeRevision, 'SOURCE_REVISION_CHANGED')
  const unstaged = await runProgram('/usr/bin/git', ['diff', '--quiet'], { cwd: root })
  const staged = await runProgram('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: root })
  requireProof(unstaged.code === 0 && staged.code === 0, 'TRACKED_TREE_NOT_CLEAN')
}

async function validateProofFilesystem(options) {
  requireProof(path.isAbsolute(options.tempRoot) && path.isAbsolute(options.summary), 'PROOF_ROOT_INVALID')
  const tempRoot = path.resolve(options.tempRoot)
  const summaryPath = path.resolve(options.summary)
  requireProof(
    path.basename(tempRoot).startsWith('aos-operation-control-native-proof.'),
    'PROOF_ROOT_INVALID',
  )
  requireProof(summaryPath === path.join(tempRoot, 'summary.json'), 'PROOF_SUMMARY_INVALID')

  const root = await lstat(tempRoot).catch(() => null)
  requireProof(
    root?.isDirectory() === true && root.isSymbolicLink() === false
      && root.uid === process.getuid() && (root.mode & 0o777) === 0o700,
    'PROOF_ROOT_INVALID',
  )
  requireProof(
    await realpath(tempRoot) === await realpath(path.dirname(summaryPath)),
    'PROOF_SUMMARY_INVALID',
  )
  requireProof((await readdir(tempRoot)).length === 0, 'PROOF_ROOT_NOT_EMPTY')
  const existing = await lstat(summaryPath).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  requireProof(existing === null, 'PROOF_SUMMARY_INVALID')
}

async function publishSummary(summaryPath, summary) {
  const handle = await open(summaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(summary)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function wait(milliseconds, { allowDuringInterruption = false } = {}) {
  return new Promise((resolve, reject) => setTimeout(() => {
    if (!allowDuringInterruption && interruptionError !== null) reject(interruptionError)
    else resolve()
  }, milliseconds))
}

function boundedAppend(current, chunk, child) {
  const next = current + chunk.toString('utf8')
  if (Buffer.byteLength(next) > maxOutputBytes) {
    throw new OperationNativeProofError('COMMAND_OUTPUT_LIMIT')
  }
  return next
}

function runProgram(executable, args, {
  allowDuringInterruption = false,
  capabilityPacket = null,
  cwd = process.cwd(),
  environment = safeChildEnvironment(),
  interruptOnSignal = true,
  terminationGraceMilliseconds = 2_000,
  terminationMode = 'kill',
  timeoutMilliseconds = readTimeoutMilliseconds,
} = {}) {
  if (!allowDuringInterruption) throwIfInterrupted()
  if (capabilityPacket !== null) {
    requireProof(
      typeof capabilityPacket === 'string'
        && Buffer.byteLength(capabilityPacket) <= supervisionPacketMaxBytes,
      'SUPERVISION_CAPABILITY_INVALID',
    )
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: capabilityPacket === null
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', 'pipe', 'pipe', 'pipe'],
      shell: false,
    })
    const metadata = {
      interruptOnSignal,
      terminationGraceMilliseconds,
      terminationMode,
      terminationStarted: false,
      terminationTimer: null,
    }
    activeProcesses.set(child, metadata)
    let stdout = ''
    let stderr = ''
    let settled = false
    let pendingError = null
    const terminateThenReject = (error) => {
      if (settled) return
      pendingError ??= error
      beginChildTermination(child, metadata)
    }
    const timer = timeoutMilliseconds === null ? null : setTimeout(() => {
      terminateThenReject(new OperationNativeProofError('COMMAND_TIMEOUT'))
    }, timeoutMilliseconds)
    child.stdout.on('data', (chunk) => {
      if (settled) return
      try {
        stdout = boundedAppend(stdout, chunk, child)
      } catch (error) {
        terminateThenReject(error)
      }
    })
    child.stderr.on('data', (chunk) => {
      if (settled) return
      try {
        stderr = boundedAppend(stderr, chunk, child)
      } catch (error) {
        terminateThenReject(error)
      }
    })
    if (capabilityPacket !== null) {
      const capabilityPipe = child.stdio[3]
      capabilityPipe.once('error', () => {
        terminateThenReject(new OperationNativeProofError('SUPERVISION_CAPABILITY_FAILED'))
      })
      capabilityPipe.end(capabilityPacket)
    }
    child.once('error', (error) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      clearChildTermination(metadata)
      activeProcesses.delete(child)
      reject(new OperationNativeProofError('COMMAND_SPAWN_FAILED', error.message))
    })
    child.once('close', (code, signal) => {
      activeProcesses.delete(child)
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      clearChildTermination(metadata)
      if (pendingError !== null) reject(pendingError)
      else if (!allowDuringInterruption && interruptionError !== null) reject(interruptionError)
      else resolve({ code, signal, stdout, stderr, timedOut: false })
    })
  })
}

async function observeProcessGeneration(pid) {
  requireProof(Number.isSafeInteger(pid) && pid > 0, 'SUPERVISION_PROCESS_INVALID')
  const result = await runProgram('/bin/ps', [
    '-p', String(pid), '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=',
  ], { timeoutMilliseconds: processObservationTimeoutMilliseconds })
  requireProof(result.code === 0 && result.signal === null, 'SUPERVISION_PROCESS_INVALID')
  const rows = result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  requireProof(rows.length === 1, 'SUPERVISION_PROCESS_INVALID')
  const normalized = rows[0].replace(/\s+/gu, ' ')
  const columns = normalized.split(' ')
  requireProof(Number(columns[0]) === pid && columns.length >= 7, 'SUPERVISION_PROCESS_INVALID')
  return createHash('sha256')
    .update(`aos-operation-proof-process-generation-v1\0${normalized}`)
    .digest('hex')
}

function readSupervisorCapability() {
  return new Promise((resolve, reject) => {
    let settled = false
    let bytes = 0
    let text = ''
    const stream = createReadStream(null, { fd: 3, autoClose: true })
    const finish = (error, value = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      stream.destroy()
      finish(new OperationNativeProofError('SUPERVISION_CAPABILITY_TIMEOUT'))
    }, supervisorCapabilityTimeoutMilliseconds)
    stream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > supervisionPacketMaxBytes) {
        stream.destroy()
        finish(new OperationNativeProofError('SUPERVISION_CAPABILITY_INVALID'))
        return
      }
      text += chunk.toString('utf8')
    })
    stream.once('error', () => finish(new OperationNativeProofError('SUPERVISION_CAPABILITY_INVALID')))
    stream.once('end', () => finish(null, text))
  })
}

async function validateSupervisorCapability() {
  const text = await readSupervisorCapability()
  requireProof(Buffer.byteLength(text) <= supervisionPacketMaxBytes, 'SUPERVISION_CAPABILITY_INVALID')
  const packet = parseSingleJSON(text, 'SUPERVISION_CAPABILITY_INVALID')
  requireProof(
    packet && typeof packet === 'object' && !Array.isArray(packet)
      && JSON.stringify(Object.keys(packet).sort()) === JSON.stringify([
        'nonce',
        'supervisor_generation',
        'supervisor_pid',
        'v',
      ]),
    'SUPERVISION_CAPABILITY_INVALID',
  )
  requireProof(packet.v === supervisionSchemaVersion, 'SUPERVISION_CAPABILITY_INVALID')
  requireProof(typeof packet.nonce === 'string' && /^[a-f0-9]{64}$/u.test(packet.nonce), 'SUPERVISION_CAPABILITY_INVALID')
  requireProof(
    Number.isSafeInteger(packet.supervisor_pid)
      && packet.supervisor_pid > 0
      && packet.supervisor_pid === process.ppid,
    'SUPERVISION_PARENT_MISMATCH',
  )
  requireProof(
    typeof packet.supervisor_generation === 'string'
      && /^[a-f0-9]{64}$/u.test(packet.supervisor_generation),
    'SUPERVISION_PROCESS_INVALID',
  )
  const observedGeneration = await observeProcessGeneration(process.ppid)
  requireProof(observedGeneration === packet.supervisor_generation, 'SUPERVISION_PROCESS_MISMATCH')
  return packet.nonce
}

async function runSupervisor(options) {
  const supervisorGeneration = await observeProcessGeneration(process.pid)
  const packet = `${JSON.stringify({
    v: supervisionSchemaVersion,
    nonce: randomBytes(32).toString('hex'),
    supervisor_pid: process.pid,
    supervisor_generation: supervisorGeneration,
  })}\n`
  const result = await runProgram(
    process.execPath,
    [path.resolve(process.argv[1]), '--worker', ...serializeArgs(options)],
    {
      capabilityPacket: packet,
      cwd: options.root,
      terminationGraceMilliseconds: supervisorTerminationGraceMilliseconds,
      terminationMode: 'term_then_kill',
      timeoutMilliseconds: supervisedProofTimeoutMilliseconds,
    },
  )
  requireProof(result.code === 0 && result.signal === null, 'SUPERVISED_WORKER_FAILED')
}

const otherOwnerSource = String.raw`
const { spawn } = require('node:child_process')
const [executable, ...args] = process.argv.slice(1)
const child = spawn(executable, args, {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
})
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
let forwardedSignal = null
let killTimer = null
const signalExitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    forwardedSignal ??= signal
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    killTimer ??= setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 1000)
  })
}
child.once('error', () => process.exit(125))
child.once('close', (code, signal) => {
  if (killTimer !== null) clearTimeout(killTimer)
  if (forwardedSignal !== null) process.exit(signalExitCode[forwardedSignal])
  else if (signal) process.exit(1)
  else process.exit(code ?? 1)
})
`

function makeRunner(options, { allowDuringInterruption = false } = {}) {
  const runAOS = (args, runOptions = {}) => runProgram(options.aos, args, {
    allowDuringInterruption,
    cwd: options.root,
    environment: safeChildEnvironment(runOptions.environment),
    interruptOnSignal: runOptions.interruptOnSignal,
    timeoutMilliseconds: runOptions.timeoutMilliseconds,
  })
  const runOtherOwnerReadOnly = (args, runOptions = {}) => {
    requireProof(
      args[0] === 'operation' && ['inspect', 'status', 'list', 'recent', 'barrier-status'].includes(args[1]),
      'OTHER_OWNER_EFFECT_FORBIDDEN',
    )
    return runProgram(
    process.execPath,
    ['-e', otherOwnerSource, options.aos, ...args],
    {
      allowDuringInterruption,
      cwd: options.root,
      environment: safeChildEnvironment(runOptions.environment),
      interruptOnSignal: runOptions.interruptOnSignal,
      terminationGraceMilliseconds: 2_000,
      terminationMode: 'term_then_kill',
      timeoutMilliseconds: runOptions.timeoutMilliseconds,
    },
  )
  }
  return { runAOS, runOtherOwnerReadOnly }
}

async function successfulJSON(result, code) {
  requireProof(result.code === 0 && result.signal === null, code)
  return parseSingleJSON(result.stdout, code)
}

async function successfulOperation(result, code) {
  return envelopeData(await successfulJSON(result, code), code)
}

async function expectCommandError(result, expectedCode, code) {
  requireProof(result.code !== 0 && result.signal === null, code)
  requireProof(commandErrorCode(result) === expectedCode, code)
  return expectedCode
}

function assertSingleControlResult(receipt, identity, operation, code) {
  requireProof(receipt?.schema_version === 'aos.operation.control-result.v1', code)
  requireProof(receipt.operation === operation, code)
  requireProof(['accepted', 'cleanup_required'].includes(receipt.outcome), code)
  requireProof(receipt.selected_operation_count === 1 && receipt.results?.length === 1, code)
  requireProof(
    receipt.results[0].operation_id === identity.id
      && receipt.results[0].operation_generation === identity.generation,
    code,
  )
  return receipt
}

async function pollReadOnly(
  body,
  predicate,
  code,
  timeoutMilliseconds = readTimeoutMilliseconds,
  { allowDuringInterruption = false } = {},
) {
  const deadline = Date.now() + timeoutMilliseconds
  let last
  while (Date.now() < deadline) {
    if (!allowDuringInterruption) throwIfInterrupted()
    last = await body()
    if (predicate(last)) return last
    await wait(pollIntervalMilliseconds, { allowDuringInterruption })
  }
  throw new OperationNativeProofError(code)
}

function operationArgs(identity, action) {
  return ['operation', action, identity.id, '--generation', String(identity.generation), '--json']
}

async function ownerList(runner) {
  const result = await runner.runAOS(['operation', 'list', '--json'])
  requireProof(result.code === 0, 'OPERATION_LIST_FAILED')
  return parseSingleJSON(result.stdout, 'OPERATION_LIST_INVALID')
}

async function inspectOperation(runner, identity) {
  const data = await successfulOperation(
    await runner.runAOS(operationArgs(identity, 'inspect')),
    'OPERATION_INSPECT_FAILED',
  )
  return assertOperationSnapshot(data.snapshot, identity)
}

async function waitForOperationState(runner, identity, state) {
  return pollReadOnly(
    () => inspectOperation(runner, identity),
    (snapshot) => snapshot.state === state,
    `OPERATION_${state.toUpperCase()}_TIMEOUT`,
    captureSettleTimeoutMilliseconds,
  )
}

function startCapture(options, label) {
  throwIfInterrupted()
  const output = path.join(options.tempRoot, `${label}.wav`)
  const child = spawn(options.aos, [
    'listen', '--source', 'microphone', '--output', output,
    '--follow', '--max-duration', '30s',
  ], {
    cwd: options.root,
    env: safeChildEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  activeProcesses.set(child, { interruptOnSignal: true })
  const events = []
  let stdoutBuffer = ''
  let stderr = ''
  let outputBytes = 0
  let streamFailure = null
  let startedResolve
  let startedReject
  let completedResolve
  const started = new Promise((resolve, reject) => {
    startedResolve = resolve
    startedReject = reject
  })
  const completed = new Promise((resolve) => { completedResolve = resolve })
  const consumeLine = (line) => {
    if (!line.trim()) return
    try {
      const value = JSON.parse(line)
      const event = typeof value?.event === 'string' ? value.event : null
      if (event) events.push({ event, reason: value?.data?.reason ?? null, code: value?.data?.code ?? null })
      if (event === 'capture_started') startedResolve()
    } catch {
      startedReject(new OperationNativeProofError('CAPTURE_EVENT_INVALID'))
      child.kill('SIGKILL')
    }
  }
  child.stdout.on('data', (chunk) => {
    outputBytes += chunk.length
    if (outputBytes > maxOutputBytes) {
      startedReject(new OperationNativeProofError('CAPTURE_OUTPUT_LIMIT'))
      child.kill('SIGKILL')
      return
    }
    stdoutBuffer += chunk.toString('utf8')
    while (stdoutBuffer.includes('\n')) {
      const index = stdoutBuffer.indexOf('\n')
      const line = stdoutBuffer.slice(0, index)
      stdoutBuffer = stdoutBuffer.slice(index + 1)
      consumeLine(line)
    }
  })
  child.stderr.on('data', (chunk) => {
    if (streamFailure !== null) return
    try {
      stderr = boundedAppend(stderr, chunk, child)
    } catch (error) {
      streamFailure = error
      startedReject(error)
      child.kill('SIGKILL')
    }
  })
  child.once('error', () => {
    startedReject(new OperationNativeProofError('CAPTURE_SPAWN_FAILED'))
  })
  child.once('close', (code, signal) => {
    activeProcesses.delete(child)
    if (stdoutBuffer.trim()) consumeLine(stdoutBuffer)
    startedReject(new OperationNativeProofError('CAPTURE_ENDED_BEFORE_START'))
    completedResolve({ code, signal, events, stderr, streamFailure })
  })
  return { child, completed, events, output, started }
}

async function awaitCaptureStarted(capture) {
  let timer
  try {
    await Promise.race([
      capture.started,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new OperationNativeProofError('CAPTURE_START_TIMEOUT')),
          captureStartTimeoutMilliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function awaitCaptureCompletion(capture) {
  let timer
  try {
    return await Promise.race([
      capture.completed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new OperationNativeProofError('CAPTURE_SETTLE_TIMEOUT')),
          captureSettleTimeoutMilliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function activeCaptureIdentity(runner) {
  const operations = await pollReadOnly(
    async () => activeMicrophoneOperations(await ownerList(runner)),
    (values) => values.length === 1 && values[0].state === 'active',
    'ACTIVE_MICROPHONE_OPERATION_NOT_FOUND',
    captureStartTimeoutMilliseconds,
  )
  return operationIdentity(operations[0])
}

async function startOwnedCapture(options, runner, label, cleanup) {
  const capture = startCapture(options, label)
  cleanup.captures.add(capture)
  cleanup.outputs.add(capture.output)
  await awaitCaptureStarted(capture)
  const identity = await activeCaptureIdentity(runner)
  cleanup.operationIdentities.set(`${identity.id}:${identity.generation}`, identity)
  return { capture, identity }
}

async function assertCaptureEnded(capture, expectedSignals = [null]) {
  const result = await awaitCaptureCompletion(capture)
  if (result.streamFailure) throw result.streamFailure
  requireProof(expectedSignals.includes(result.signal), 'CAPTURE_EXIT_INVALID')
  if (result.signal === null) requireProof(result.code === 0, 'CAPTURE_EXIT_INVALID')
  return result
}

async function removeOwnedOutputs(cleanup) {
  let complete = true
  for (const output of cleanup.outputs) {
    try {
      await rm(output, { force: true })
      await access(output)
      complete = false
    } catch (error) {
      if (error?.code !== 'ENOENT') complete = false
    }
  }
  return complete
}

async function stopOwnedChildren(cleanup) {
  let complete = true
  for (const capture of cleanup.captures) {
    if (capture.child.exitCode === null && capture.child.signalCode === null) {
      capture.child.kill('SIGINT')
      try {
        await awaitCaptureCompletion(capture)
      } catch {
        capture.child.kill('SIGKILL')
        try { await awaitCaptureCompletion(capture) } catch { complete = false }
      }
    }
    if (capture.child.exitCode === null && capture.child.signalCode === null) complete = false
  }
  return complete
}

function zeroResidualTerminal(snapshot) {
  return snapshot?.state === 'terminal'
    && snapshot.cleanup?.result === 'zero_residuals'
    && snapshot.cleanup?.residual?.classification === 'none'
    && snapshot.cleanup?.residual?.count === 0
}

async function settleOwnedOperations(options, cleanup) {
  const runner = makeRunner(options, { allowDuringInterruption: true })
  for (const identity of cleanup.operationIdentities.values()) {
    try {
      const current = await inspectOperation(runner, identity)
      if (current.state !== 'terminal') {
        // Capture children are stopped before this phase. Effect ambiguity is
        // resolved only through passive inspection; cleanup never retries or
        // substitutes an AOS control operation.
        await pollReadOnly(
          () => inspectOperation(runner, identity),
          zeroResidualTerminal,
          'CLEANUP_OPERATION_NOT_TERMINAL',
          captureSettleTimeoutMilliseconds,
          { allowDuringInterruption: true },
        )
      }
      const terminal = await pollReadOnly(
        () => inspectOperation(runner, identity),
        zeroResidualTerminal,
        'CLEANUP_OPERATION_NOT_TERMINAL',
        captureSettleTimeoutMilliseconds,
        { allowDuringInterruption: true },
      )
      if (!zeroResidualTerminal(terminal)) return false
    } catch {
      return false
    }
  }
  try {
    return activeMicrophoneOperations(await ownerList(runner)).length === 0
  } catch {
    return false
  }
}

async function livePreflight(options, runner) {
  const [buildResult, statusResult, serviceResult, permissionsResult] = await Promise.all([
    runner.runAOS(['runtime', 'build-attestation', '--json']),
    runner.runAOS(['status', '--json']),
    runner.runAOS(['service', 'status', '--mode', 'repo', '--json']),
    runner.runAOS(['permissions', 'check', '--json']),
  ])
  const build = await successfulJSON(buildResult, 'BUILD_ATTESTATION_FAILED')
  const status = await successfulJSON(statusResult, 'STATUS_PREFLIGHT_FAILED')
  const service = await successfulJSON(serviceResult, 'SERVICE_PREFLIGHT_FAILED')
  const permissions = await successfulJSON(permissionsResult, 'PERMISSION_PREFLIGHT_FAILED')
  const barrierResult = await runner.runAOS(['operation', 'barrier-status', '--json'])
  const barrier = await successfulJSON(barrierResult, 'BARRIER_PREFLIGHT_FAILED')
  return assertPreflight({ build, status, service, permissions, barrier, aosPath: options.aos })
}

async function runLive(options, summary, cleanup) {
  await validateLiveAdmission(options)
  cleanup.liveAdmissionPassed = true
  const runner = makeRunner(options)
  const preflight = await livePreflight(options, runner)
  Object.assign(summary.preflight, {
    managed_repo_daemon: true,
    microphone_authorized: true,
    barrier_open: true,
    build_current: true,
  })

  requireProof(activeMicrophoneOperations(await ownerList(runner)).length === 0, 'OWNER_ALREADY_HAS_ACTIVE_OPERATION')

  const first = await startOwnedCapture(options, runner, 'cancel-case', cleanup)
  const firstInspect = await inspectOperation(runner, first.identity)
  assertOperationSnapshot(firstInspect, first.identity, 'active')
  const firstStatus = await successfulOperation(
    await runner.runAOS(operationArgs(first.identity, 'status')),
    'OPERATION_STATUS_FAILED',
  )
  assertOperationSnapshot(firstStatus.snapshot, first.identity, 'active')
  summary.ownership.same_root_visible = true

  const crossRoot = await runner.runOtherOwnerReadOnly(operationArgs(first.identity, 'inspect'))
  summary.ownership.cross_root_error_code = await expectCommandError(
    crossRoot, 'OPERATION_OWNER_MISMATCH', 'CROSS_ROOT_INSPECT_NOT_REJECTED',
  )

  const narrowed = await successfulOperation(
    await runner.runAOS(['operation', 'kill-owner', '--task-id', 'forged-proof-task', '--json'], {
      timeoutMilliseconds: effectTimeoutMilliseconds,
    }),
    'ASSERTED_FILTER_CONTROL_FAILED',
  )
  requireProof(narrowed.outcome === 'empty_selection' && narrowed.selected_operation_count === 0, 'ASSERTED_FILTER_WIDENED_AUTHORITY')
  summary.ownership.asserted_filter_empty = true
  summary.ownership.asserted_filter_target_remained_active = (
    (await inspectOperation(runner, first.identity)).state === 'active'
  )
  requireProof(summary.ownership.asserted_filter_target_remained_active, 'ASSERTED_FILTER_MUTATED_TARGET')

  const busyOutput = path.join(options.tempRoot, 'busy-case.wav')
  cleanup.outputs.add(busyOutput)
  const busy = await runner.runAOS([
    'listen', '--source', 'microphone', '--output', busyOutput,
    '--follow', '--max-duration', '30s',
  ], { timeoutMilliseconds: effectTimeoutMilliseconds })
  summary.singleton.error_code = await expectCommandError(
    busy, 'OPERATION_RESOURCE_BUSY', 'SINGLETON_CONFLICT_NOT_TYPED',
  )
  summary.singleton.incumbent_remained_active = (
    (await inspectOperation(runner, first.identity)).state === 'active'
  )
  requireProof(summary.singleton.incumbent_remained_active, 'SINGLETON_PREEMPTED_INCUMBENT')

  const tap = await runner.runAOS([
    'operation', 'tap', first.identity.id, '--generation', String(first.identity.generation),
    '--channel', 'metadata', '--rate', '5', '--sample-every', '1',
    '--max-queue-items', '4', '--max-items', '5', '--max-bytes', '4096',
    '--timeout', '1000', '--duration-ms', '1500', '--follow', '--json',
  ], { timeoutMilliseconds: effectTimeoutMilliseconds })
  requireProof(tap.code === 0, 'TAP_COMMAND_FAILED')
  const tapLines = parseJSONLines(tap.stdout, 'TAP_OUTPUT_INVALID')
  const terminalTap = tapLines.find((value) => value?.service === 'operation' && value?.event === 'terminal')?.data
  requireProof(terminalTap?.state === 'expired', 'TAP_TERMINAL_MISSING')
  requireProof(terminalTap.terminal_bound_reason === 'idle_timeout', 'TAP_REASON_INVALID')
  assertZeroTapCounters(terminalTap.counters)
  summary.tap.terminal_reason = terminalTap.terminal_bound_reason
  summary.tap.lifecycle_only = true
  summary.tap.zero_counters = true
  await wait(150)
  const afterTap = await inspectOperation(runner, first.identity)
  summary.tap.cleanup_zero_residuals = afterTap.cleanup?.residual?.count === 0
  requireProof(summary.tap.cleanup_zero_residuals, 'TAP_RESIDUAL_PRESENT')

  const cancel = assertSingleControlResult(await successfulOperation(
    await runner.runAOS(operationArgs(first.identity, 'cancel'), { timeoutMilliseconds: effectTimeoutMilliseconds }),
    'CANCEL_FAILED',
  ), first.identity, 'cancel', 'CANCEL_RECEIPT_INVALID')
  await assertCaptureEnded(first.capture)
  const cancelled = assertTerminalOperation(await waitForOperationState(runner, first.identity, 'terminal'), {
    outcome: 'cancelled', trigger: 'caller_cancel', blame: 'caller',
  })
  summary.ordinary_control.cancel_outcome = cancelled.terminal.outcome

  const second = await startOwnedCapture(options, runner, 'kill-case', cleanup)
  const kill = assertSingleControlResult(await successfulOperation(
    await runner.runAOS(operationArgs(second.identity, 'kill'), { timeoutMilliseconds: effectTimeoutMilliseconds }),
    'KILL_FAILED',
  ), second.identity, 'kill', 'KILL_RECEIPT_INVALID')
  await assertCaptureEnded(second.capture)
  const killed = assertTerminalOperation(await waitForOperationState(runner, second.identity, 'terminal'), {
    outcome: 'killed', trigger: 'kill_one', blame: 'aos_control_plane',
  })
  summary.ordinary_control.kill_outcome = killed.terminal.outcome
  summary.ordinary_control.zero_residuals = true

  const finalOwned = activeMicrophoneOperations(await ownerList(runner))
  summary.final.owned_outputs_removed = await removeOwnedOutputs(cleanup)
  const finalPreflight = await livePreflight(options, runner)
  requireProof(finalPreflight.daemonIdentity.daemonPID === preflight.daemonIdentity.daemonPID, 'DAEMON_CHANGED')
  requireProof(finalPreflight.daemonIdentity.servicePID === preflight.daemonIdentity.servicePID, 'DAEMON_CHANGED')
  requireProof(finalPreflight.daemonIdentity.daemonGeneration === preflight.daemonIdentity.daemonGeneration, 'DAEMON_CHANGED')
  requireProof(finalPreflight.buildFingerprint === preflight.buildFingerprint, 'BUILD_CHANGED')
  assertBarrierUnchanged(preflight.barrier, finalPreflight.barrier)
  summary.final.barrier_open = finalPreflight.barrier.barrier_state === 'open'
    && finalPreflight.barrier.admission_open === true
  summary.final.barrier_unchanged = true
  summary.final.owned_nonterminal_operation_count = finalOwned.length
  summary.final.daemon_stable = true
  summary.final.build_stable = true
  summary.final.cleanup_complete = summary.final.barrier_open
    && summary.final.barrier_unchanged
    && summary.final.owned_nonterminal_operation_count === 0
    && summary.final.owned_outputs_removed
  requireProof(summary.final.cleanup_complete, 'FINAL_CLEANUP_INCOMPLETE')
}

async function runWorker(options) {
  const summary = makeSummary(options['runtime-revision'])
  const cleanup = {
    captures: new Set(),
    operationIdentities: new Map(),
    outputs: new Set(),
    liveAdmissionPassed: false,
  }
  let proofFilesystemValidated = false
  let exitCode = 1
  let work = null
  try {
    await validateProofFilesystem({
      summary: options.summary,
      tempRoot: options['temp-root'],
    })
    proofFilesystemValidated = true
    await validateSupervisorCapability()
    summary.execution_mode = options.mode === 'self-test' ? 'offline_self_test' : 'native_live'
    if (options.mode === 'self-test') {
      work = Promise.resolve().then(() => {
        Object.assign(summary, selfTestSummary(options['runtime-revision']))
      })
    } else {
      work = runLive({
        aos: options.aos,
        root: options.root,
        runtimeRevision: options['runtime-revision'],
        summary: options.summary,
        tempRoot: options['temp-root'],
      }, summary, cleanup)
    }
    work.catch(() => {})
    await Promise.race([work, interruption])
    summary.status = 'passed'
    summary.failure_code = null
    summary.final.recovery_root_retained = false
    exitCode = 0
  } catch (error) {
    if (interruptionError !== null && work !== null) {
      try { await work } catch { /* Cleanup starts only after live work has stopped. */ }
    }
    summary.status = 'failed'
    summary.failure_code = interruptionError?.code ?? (error instanceof OperationNativeProofError
      ? error.code
      : 'UNEXPECTED_PROOF_FAILURE'
    )
  } finally {
    const childrenStopped = await stopOwnedChildren(cleanup)
    const cleanupOptions = { aos: options.aos, root: options.root }
    const operationsSettled = summary.status === 'passed' || !cleanup.liveAdmissionPassed
      ? true
      : await settleOwnedOperations(cleanupOptions, cleanup)
    const outputsRemoved = await removeOwnedOutputs(cleanup)
    if (!childrenStopped || !operationsSettled || !outputsRemoved) {
      summary.status = 'failed'
      summary.failure_code ??= 'FINAL_CLEANUP_INCOMPLETE'
      summary.final.cleanup_complete = false
      summary.final.recovery_root_retained = true
      exitCode = 1
    }
    if (summary.status !== 'passed') {
      summary.final.recovery_root_retained = true
      exitCode = 1
    }
    if (!proofFilesystemValidated) {
      process.exitCode = 1
      return
    }
    let publishedSummary = summary
    try {
      assertContentFreeSummary(summary)
    } catch {
      publishedSummary = makeSummary(options['runtime-revision'])
      publishedSummary.failure_code = 'SUMMARY_PUBLICATION_FAILED'
      assertContentFreeSummary(publishedSummary)
      exitCode = 1
    }
    try {
      await publishSummary(options.summary, publishedSummary)
    } catch {
      exitCode = 1
    }
  }
  process.exitCode = exitCode
}

async function entryMain() {
  const role = process.argv[2]
  requireProof(['--supervise', '--worker'].includes(role), 'INVALID_ENTRY_ROLE')
  const options = parseArgs(process.argv.slice(3))
  if (role === '--supervise') await runSupervisor(options)
  else await runWorker(options)
}

const directEntryURL = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (directEntryURL === import.meta.url) {
  try {
    await entryMain()
  } catch {
    process.exitCode = 1
  }
}

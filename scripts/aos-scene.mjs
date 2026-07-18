#!/usr/bin/env node

import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { connectWithAutoStart, stopManagedDaemon } from './lib/aos-daemon-client.mjs'
import { loadSceneCartridge } from './lib/aos-scene-cartridge.mjs'

const MAX_INPUT_LINE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_LINE_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 32 * 1024
const ALLOWED_OPERATIONS = new Set(['mount', 'transact', 'signal', 'play', 'suspend', 'resume', 'inspect', 'remove', 'close'])

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function valueAfter(args, token) {
  const index = args.indexOf(token)
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) fail('MISSING_ARG', `${token} requires a value`)
  return args[index + 1]
}

function parseFollowArgs(args) {
  const allowed = new Set(['--stage', '--owner', '--resource', '--follow'])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!allowed.has(arg)) fail('UNKNOWN_FLAG', `Unknown flag: ${arg}`)
    if (arg !== '--follow') index += 1
  }
  if (!args.includes('--follow')) fail('MISSING_ARG', 'scene transport requires --follow')
  const stage = valueAfter(args, '--stage')
  const owner = valueAfter(args, '--owner')
  const resource = valueAfter(args, '--resource')
  if (stage !== 'desktop-world/main') fail('INVALID_STAGE', 'scene stage must be desktop-world/main')
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(owner)) fail('INVALID_OWNER', 'scene owner is invalid')
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(resource)) fail('INVALID_RESOURCE', 'scene resource is invalid')
  return { stage, owner, resource }
}

function parseCartridgeArgs(args) {
  if (args[0] !== 'cartridge' || args[1] !== 'validate') {
    fail('UNKNOWN_SUBCOMMAND', 'scene cartridge requires the validate subcommand')
  }
  const tail = args.slice(2)
  const json = tail.includes('--json')
  const positional = tail.filter((arg) => arg !== '--json')
  if (positional.some((arg) => arg.startsWith('--'))) fail('UNKNOWN_FLAG', 'Unknown scene cartridge flag')
  if (positional.length !== 1) fail('MISSING_ARG', 'scene cartridge validate requires one directory path')
  return { directory: positional[0], json }
}

function safeError(error) {
  return JSON.stringify({ code: error?.code ?? 'SCENE_TRANSPORT_FAILED', error: error?.message ?? 'scene transport failed' })
}

async function runCartridgeValidate(args) {
  const options = parseCartridgeArgs(args)
  const loaded = await loadSceneCartridge(options.directory)
  if (options.json) {
    process.stdout.write(`${JSON.stringify(loaded.summary)}\n`)
  } else {
    process.stdout.write(`valid=true id=${loaded.summary.id} revision=${loaded.summary.revision} digest=${loaded.summary.digest}\n`)
  }
}

async function runSceneFollow(args) {
  const identity = parseFollowArgs(args)
  const ref = randomUUID()
  const startupAbort = new AbortController()
  let shutdownRequested = false
  let cleanupActive = null
  const requestShutdown = () => {
    shutdownRequested = true
    if (cleanupActive) void cleanupActive(143)
    else startupAbort.abort()
  }
  process.once('SIGINT', requestShutdown)
  process.once('SIGTERM', requestShutdown)
  const expectedParent = Number(process.env.AOS_EXTERNAL_DISPATCH_PARENT_PID)
  const parentMonitor = Number.isInteger(expectedParent) && expectedParent > 1
    ? setInterval(() => {
      try {
        if (process.ppid !== expectedParent) throw new Error('parent changed')
        process.kill(expectedParent, 0)
      } catch { requestShutdown() }
    }, 250)
    : null
  parentMonitor?.unref()
  const connection = await connectWithAutoStart({ managed: true, signal: startupAbort.signal })
  if (shutdownRequested) {
    await stopManagedDaemon(connection?.daemon)
    return
  }
  const socket = connection?.socket
  if (!socket) fail('DAEMON_UNREACHABLE', 'Cannot connect to daemon')
  let outputBuffer = ''
  let stderrBytes = 0
  let closed = false
  let closeAcknowledged
  const closeAcknowledgement = new Promise((resolve) => { closeAcknowledged = resolve })
  const cleanup = async (code = 0) => {
    if (closed) return
    closed = true
    if (parentMonitor) clearInterval(parentMonitor)
    socket.end()
    await stopManagedDaemon(connection.daemon)
    process.exitCode = code
  }
  cleanupActive = cleanup
  const writeError = (error) => {
    const line = `${safeError(error)}\n`
    if (stderrBytes + Buffer.byteLength(line) <= MAX_STDERR_BYTES) process.stderr.write(line)
    stderrBytes += Buffer.byteLength(line)
  }
  socket.on('data', (chunk) => {
    outputBuffer += chunk.toString('utf8')
    for (;;) {
      const newline = outputBuffer.indexOf('\n')
      if (newline < 0) break
      const line = outputBuffer.slice(0, newline)
      outputBuffer = outputBuffer.slice(newline + 1)
      if (Buffer.byteLength(line) > MAX_OUTPUT_LINE_BYTES) {
        writeError(Object.assign(new Error('scene event exceeded the line limit'), { code: 'SCENE_EVENT_TOO_LARGE' }))
        void cleanup(1)
        return
      }
      process.stdout.write(`${line}\n`)
      try {
        const payload = JSON.parse(line)
        if (payload.operation === 'close') closeAcknowledged()
      } catch {}
    }
  })
  socket.once('error', () => void cleanup(1))
  socket.once('close', () => { if (!closed) void cleanup(1) })

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    if (Buffer.byteLength(line) > MAX_INPUT_LINE_BYTES) fail('SCENE_OPERATION_TOO_LARGE', 'scene operation exceeded the line limit')
    let operation
    try { operation = JSON.parse(line) } catch { fail('INVALID_SCENE_OPERATION', 'scene operation must be JSON') }
    if (!operation || typeof operation !== 'object' || !ALLOWED_OPERATIONS.has(operation.op)) {
      fail('INVALID_SCENE_OPERATION', 'scene operation is not supported')
    }
    socket.write(`${JSON.stringify({
      v: 1,
      service: 'scene',
      action: 'follow',
      data: { ...identity, operation },
      ref,
    })}\n`)
    if (operation.op === 'close') {
      await Promise.race([
        closeAcknowledgement,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
      break
    }
  }
  if (!closed) await cleanup(0)
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'cartridge') return runCartridgeValidate(args)
  return runSceneFollow(args)
}

main().catch((error) => {
  process.stderr.write(`${safeError(error)}\n`)
  process.exitCode = 1
})

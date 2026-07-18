#!/usr/bin/env node

import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { connectWithAutoStart, stopManagedDaemon } from './lib/aos-daemon-client.mjs'
import { loadSceneCartridge } from './lib/aos-scene-cartridge.mjs'
import { connectSceneDaemon, installSceneProcessLifecycle } from './lib/aos-scene-daemon.mjs'
import {
  createDesktopWorldSceneClient,
  replayDesktopWorldSceneEvents,
  selectDesktopWorldResourceSnapshot,
} from '../packages/toolkit/scene/desktop-world-client.js'

const MAX_INPUT_LINE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_LINE_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 32 * 1024
const MAX_REPLAY_BYTES = 16 * 1024 * 1024
const ALLOWED_OPERATIONS = new Set(['mount', 'transact', 'signal', 'play', 'suspend', 'resume', 'inspect', 'remove', 'close', 'subscribe', 'unsubscribe'])
const ALLOWED_SCENE_EVENTS = new Set(['gesture'])

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
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u.test(resource) || resource.length > 128) {
    fail('INVALID_RESOURCE', 'scene resource is invalid')
  }
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

function validateResource(value) {
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u.test(value ?? '') || value.length > 128) {
    fail('INVALID_SCENE_RESOURCE', 'scene resource is invalid')
  }
  return value
}

function parseToolArgs(args) {
  const command = args[0]
  const tail = args.slice(1)
  const json = tail.includes('--json')
  if (tail.filter((value) => value === '--json').length > 1) fail('DUPLICATE_FLAG', '--json may be supplied once')
  const withoutJson = tail.filter((value) => value !== '--json')
  if (['list', 'inspect', 'monitor', 'perf', 'replay', 'devtools'].includes(command) && !json) {
    fail('MISSING_ARG', `scene ${command} requires --json`)
  }
  if (command === 'list') {
    if (withoutJson.length > 0) fail('UNKNOWN_FLAG', 'scene list accepts only --json')
    return { command, json }
  }
  if (['inspect', 'perf', 'monitor'].includes(command)) {
    const allowed = command === 'monitor' ? new Set(['--resource', '--follow']) : new Set(['--resource'])
    for (let index = 0; index < withoutJson.length; index += 1) {
      const token = withoutJson[index]
      if (!allowed.has(token)) fail('UNKNOWN_FLAG', `Unknown ${command} flag: ${token}`)
      if (token !== '--follow') index += 1
    }
    const resourceFlags = withoutJson.filter((value) => value === '--resource').length
    if (resourceFlags === 0) fail('MISSING_ARG', `${command} requires --resource`)
    if (resourceFlags > 1) fail('DUPLICATE_FLAG', '--resource may be supplied once')
    if (command === 'monitor' && !withoutJson.includes('--follow')) fail('MISSING_ARG', 'scene monitor requires --follow')
    return { command, json, resource: validateResource(valueAfter(withoutJson, '--resource')) }
  }
  if (command === 'replay') {
    for (let index = 0; index < withoutJson.length; index += 2) {
      if (withoutJson[index] !== '--events') fail('UNKNOWN_FLAG', `Unknown replay flag: ${withoutJson[index]}`)
    }
    const eventFlags = withoutJson.filter((value) => value === '--events').length
    if (eventFlags === 0) fail('MISSING_ARG', 'replay requires --events')
    if (eventFlags > 1) fail('DUPLICATE_FLAG', '--events may be supplied once')
    return { command, json, events: valueAfter(withoutJson, '--events') }
  }
  if (command === 'devtools') {
    const action = withoutJson[0]
    const rest = withoutJson.slice(1)
    if (!['open', 'status', 'close'].includes(action)) fail('UNKNOWN_SUBCOMMAND', 'scene devtools requires open, status, or close')
    const allowed = action === 'open' ? new Set(['--resource']) : action === 'status' ? new Set(['--session']) : new Set(['--session'])
    for (let index = 0; index < rest.length; index += 2) {
      if (!allowed.has(rest[index])) fail('UNKNOWN_FLAG', `Unknown scene devtools flag: ${rest[index]}`)
    }
    if (rest.filter((value) => value === '--resource').length > 1 || rest.filter((value) => value === '--session').length > 1) {
      fail('DUPLICATE_FLAG', 'scene devtools flags may be supplied once')
    }
    const resource = action === 'open' && rest.includes('--resource') ? validateResource(valueAfter(rest, '--resource')) : null
    const session = rest.includes('--session') ? valueAfter(rest, '--session') : null
    if (session != null && !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(session)) fail('INVALID_DEVTOOLS_SESSION', 'DesktopWorld DevTools session identifier is invalid')
    if (action === 'close' && session == null) fail('MISSING_ARG', 'scene devtools close requires --session')
    return { command, action, json, resource, session }
  }
  return null
}

function safeError(error) {
  return JSON.stringify({ code: error?.code ?? 'SCENE_TRANSPORT_FAILED', error: error?.message ?? 'scene transport failed' })
}

function validateFollowOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !ALLOWED_OPERATIONS.has(operation.op)) {
    fail('INVALID_SCENE_OPERATION', 'scene operation is not supported')
  }
  if (operation.op !== 'subscribe' && operation.op !== 'unsubscribe') return operation
  const keys = Object.keys(operation)
  if (keys.some((key) => key !== 'op' && key !== 'events')) {
    fail('INVALID_SCENE_SUBSCRIPTION', 'scene subscription contains unknown fields')
  }
  const events = operation.events ?? []
  if (!Array.isArray(events) || events.length > 8 || events.some((event) => !ALLOWED_SCENE_EVENTS.has(event))) {
    fail('INVALID_SCENE_SUBSCRIPTION', 'scene subscription contains unsupported events')
  }
  if (operation.op === 'subscribe' && events.length === 0) {
    fail('INVALID_SCENE_SUBSCRIPTION', 'scene subscribe requires at least one event')
  }
  return { op: operation.op, events: [...new Set(events)] }
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

function writeToolResult(value, json, label = 'status') {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`)
  else process.stdout.write(`${label}=ok\n`)
}

async function withSceneClient(callback, onEvent = () => {}) {
  const abort = new AbortController()
  const removeLifecycle = installSceneProcessLifecycle(abort)
  let transport = null
  try {
    transport = await connectSceneDaemon({ signal: abort.signal, onEvent })
    const client = createDesktopWorldSceneClient({
      request: (request) => transport.request(request),
      subscribe: (request) => transport.request(request),
    })
    return await callback(client, transport, abort)
  } finally {
    removeLifecycle()
    await transport?.close()
  }
}

async function readReplayEvents(file) {
  let details
  try { details = await stat(file) }
  catch { fail('SCENE_REPLAY_UNAVAILABLE', 'Scene replay fixture is unavailable') }
  if (!details.isFile() || details.size > MAX_REPLAY_BYTES) fail('SCENE_REPLAY_LIMIT_EXCEEDED', 'Scene replay fixture exceeds the input budget')
  const input = await readFile(file, 'utf8')
  const events = []
  for (const line of input.split(/\r?\n/u)) {
    if (!line.trim()) continue
    if (Buffer.byteLength(line) > MAX_OUTPUT_LINE_BYTES) fail('SCENE_REPLAY_LINE_TOO_LARGE', 'Scene replay event exceeds the line budget')
    try { events.push(JSON.parse(line)) }
    catch { fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay fixture contains malformed JSON') }
  }
  return events
}

async function runToolCommand(options) {
  if (options.command === 'replay') {
    writeToolResult(replayDesktopWorldSceneEvents(await readReplayEvents(options.events)), options.json, 'replay')
    return
  }
  if (options.command === 'monitor') {
    let resource = options.resource
    await withSceneClient(async (client, transport, abort) => {
      await client.monitor(resource, { follow: true })
      const error = await transport.closed
      if (error && !abort.signal.aborted) throw error
    }, (payload, socket) => {
      if (payload.service !== 'scene' || payload.event !== 'monitor' || payload.data?.resource !== resource) return
      const snapshot = selectDesktopWorldResourceSnapshot(payload.data.snapshot, resource)
      if (!process.stdout.write(`${JSON.stringify({ ...payload, data: { resource, snapshot } })}\n`)) {
        socket.pause()
        process.stdout.once('drain', () => socket.resume())
      }
    })
    return
  }
  await withSceneClient(async (client) => {
    let result
    if (options.command === 'list') result = await client.list()
    else if (options.command === 'inspect') result = await client.inspect(options.resource)
    else if (options.command === 'perf') result = await client.perf(options.resource)
    else if (options.command === 'devtools' && options.action === 'open') result = await client.devtools.open({ resource: options.resource })
    else if (options.command === 'devtools' && options.action === 'status') result = await client.devtools.status(options.session)
    else if (options.command === 'devtools' && options.action === 'close') result = await client.devtools.close(options.session)
    else fail('UNKNOWN_SUBCOMMAND', 'Unknown scene command')
    writeToolResult(result, options.json, options.action ?? options.command)
  })
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
    if (closed) {
      if (code !== 0) process.exitCode = code
      return
    }
    closed = true
    process.exitCode = code
    if (parentMonitor) clearInterval(parentMonitor)
    socket.end()
    await stopManagedDaemon(connection.daemon)
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
      let payload
      try {
        payload = JSON.parse(line)
      } catch {
        writeError(Object.assign(new Error('daemon returned malformed scene JSON'), { code: 'INVALID_SCENE_EVENT' }))
        void cleanup(1)
        return
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        writeError(Object.assign(new Error('daemon returned an invalid scene envelope'), { code: 'INVALID_SCENE_EVENT' }))
        void cleanup(1)
        return
      }
      const output = `${JSON.stringify(payload)}\n`
      if (!process.stdout.write(output)) {
        socket.pause()
        process.stdout.once('drain', () => socket.resume())
      }
      if (payload.operation === 'close') closeAcknowledged()
    }
    if (Buffer.byteLength(outputBuffer) > MAX_OUTPUT_LINE_BYTES) {
      writeError(Object.assign(new Error('scene event exceeded the line limit'), { code: 'SCENE_EVENT_TOO_LARGE' }))
      void cleanup(1)
    }
  })
  socket.once('error', () => void cleanup(1))
  socket.once('close', () => { if (!closed) void cleanup(1) })

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    if (Buffer.byteLength(line) > MAX_INPUT_LINE_BYTES) fail('SCENE_OPERATION_TOO_LARGE', 'scene operation exceeded the line limit')
    let operation
    try { operation = JSON.parse(line) } catch { fail('INVALID_SCENE_OPERATION', 'scene operation must be JSON') }
    operation = validateFollowOperation(operation)
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
  const tool = parseToolArgs(args)
  if (tool) return runToolCommand(tool)
  return runSceneFollow(args)
}

main().catch((error) => {
  process.stderr.write(`${safeError(error)}\n`)
  process.exitCode = 1
})

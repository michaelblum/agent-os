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
import { validateSceneExtensionReference } from '../packages/toolkit/scene/scene-extension.js'

const MAX_INPUT_LINE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_LINE_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 32 * 1024
const MAX_REPLAY_BYTES = 16 * 1024 * 1024
const ALLOWED_OPERATIONS = new Set(['mount', 'transact', 'signal', 'play', 'suspend', 'resume', 'inspect', 'remove', 'close', 'subscribe', 'unsubscribe'])
const ALLOWED_SCENE_EVENTS = new Set(['gesture'])
const DEVTOOLS_TABS = new Set(['world', 'resources', 'interactions', 'performance', 'events'])
const DEVTOOLS_HOST_KINDS = new Set(['compatibility', 'external', 'panel'])

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

function parseExtensionArgs(args) {
  if (args[0] !== 'extension') fail('UNKNOWN_SUBCOMMAND', 'scene extension command is invalid')
  const action = args[1]
  if (!['validate', 'install', 'list'].includes(action)) {
    fail('UNKNOWN_SUBCOMMAND', 'scene extension requires validate, install, or list')
  }
  const tail = args.slice(2)
  if (tail.filter((arg) => arg === '--json').length > 1) fail('DUPLICATE_FLAG', '--json may be supplied once')
  if (!tail.includes('--json')) fail('MISSING_ARG', `scene extension ${action} requires --json`)
  const positional = []
  let expectedDigest = null
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index]
    if (token === '--json') continue
    if (token === '--expected-digest') {
      if (action !== 'install') fail('UNKNOWN_FLAG', 'Unknown scene extension flag')
      if (expectedDigest !== null) fail('DUPLICATE_FLAG', '--expected-digest may be supplied once')
      const value = tail[index + 1]
      if (!value || value.startsWith('--')) fail('MISSING_ARG', '--expected-digest requires a value')
      if (!/^[a-f0-9]{64}$/u.test(value)) fail('INVALID_DIGEST', '--expected-digest must be a lowercase SHA-256 digest')
      expectedDigest = value
      index += 1
      continue
    }
    if (token.startsWith('--')) fail('UNKNOWN_FLAG', 'Unknown scene extension flag')
    positional.push(token)
  }
  if (action === 'list') {
    if (positional.length > 0) fail('UNKNOWN_ARG', 'scene extension list accepts no directory')
    return { action, json: true }
  }
  if (positional.length !== 1) fail('MISSING_ARG', `scene extension ${action} requires one directory path`)
  if (action === 'install' && expectedDigest === null) fail('MISSING_ARG', 'scene extension install requires --expected-digest')
  return { action, directory: positional[0], expectedDigest, json: true }
}

function validateResource(value) {
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u.test(value ?? '') || value.length > 128) {
    fail('INVALID_SCENE_RESOURCE', 'scene resource is invalid')
  }
  return value
}

function validateDevToolsIdentifier(value, label) {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(value ?? '') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    fail(`INVALID_DEVTOOLS_${label.toUpperCase()}`, `DesktopWorld DevTools ${label} identifier is invalid`)
  }
  return value
}

function parseRevision(value) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value ?? '')) fail('INVALID_DEVTOOLS_REVISION', 'DesktopWorld DevTools revision must be a non-negative integer')
  const revision = Number(value)
  if (!Number.isSafeInteger(revision)) fail('INVALID_DEVTOOLS_REVISION', 'DesktopWorld DevTools revision exceeds the supported range')
  return revision
}

function parseToggle(value, token) {
  if (value === 'on') return true
  if (value === 'off') return false
  fail('INVALID_DEVTOOLS_TOGGLE', `${token} requires on or off`)
}

function parseEventKinds(value) {
  const values = value === '' ? [] : value.split(',')
  if (values.length > 16 || values.some((entry) => !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(entry))) {
    fail('INVALID_DEVTOOLS_FILTER', '--event-kinds must contain at most 16 comma-separated event identifiers')
  }
  return [...new Set(values)]
}

function parseDevToolsArgs(action, args) {
  if (!['open', 'status', 'update', 'transfer', 'close'].includes(action)) {
    fail('UNKNOWN_SUBCOMMAND', 'scene devtools requires open, status, update, transfer, or close')
  }
  const allowed = {
    open: new Set(['--resource']),
    status: new Set(['--session']),
    update: new Set(['--session', '--expected-revision', '--resource', '--clear-resource', '--tab', '--query', '--event-kinds', '--errors-only', '--recording']),
    transfer: new Set(['--session', '--expected-revision', '--host-kind', '--host-id']),
    close: new Set(['--session']),
  }[action]
  const valueLess = new Set(['--clear-resource'])
  const values = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!allowed.has(token)) fail('UNKNOWN_FLAG', `Unknown scene devtools flag: ${token}`)
    if (values.has(token)) fail('DUPLICATE_FLAG', `${token} may be supplied once`)
    if (valueLess.has(token)) {
      values.set(token, true)
      continue
    }
    if (args[index + 1] == null || args[index + 1].startsWith('--')) fail('MISSING_ARG', `${token} requires a value`)
    values.set(token, args[index + 1])
    index += 1
  }

  const session = values.has('--session') ? validateDevToolsIdentifier(values.get('--session'), 'session') : null
  if (['update', 'transfer', 'close'].includes(action) && session == null) fail('MISSING_ARG', `scene devtools ${action} requires --session`)
  const expectedRevision = values.has('--expected-revision') ? parseRevision(values.get('--expected-revision')) : null
  if (['update', 'transfer'].includes(action) && expectedRevision == null) fail('MISSING_ARG', `scene devtools ${action} requires --expected-revision`)

  const resource = values.has('--resource') ? validateResource(values.get('--resource')) : null
  if (values.has('--clear-resource') && values.has('--resource')) fail('CONFLICTING_FLAGS', '--resource and --clear-resource cannot be combined')

  if (action === 'update') {
    const changes = {}
    if (values.has('--resource')) changes.selected_resource = resource
    if (values.has('--clear-resource')) changes.selected_resource = null
    if (values.has('--tab')) {
      const tab = values.get('--tab')
      if (!DEVTOOLS_TABS.has(tab)) fail('INVALID_DEVTOOLS_TAB', 'DesktopWorld DevTools tab is invalid')
      changes.active_tab = tab
    }
    const filters = {}
    if (values.has('--query')) {
      const query = values.get('--query')
      if (Buffer.byteLength(query) > 128) fail('INVALID_DEVTOOLS_FILTER', '--query exceeds the 128-byte limit')
      filters.query = query
    }
    if (values.has('--event-kinds')) filters.event_kinds = parseEventKinds(values.get('--event-kinds'))
    if (values.has('--errors-only')) filters.errors_only = parseToggle(values.get('--errors-only'), '--errors-only')
    if (Object.keys(filters).length > 0) changes.filters = filters
    if (values.has('--recording')) changes.recording = parseToggle(values.get('--recording'), '--recording')
    if (Object.keys(changes).length === 0) fail('MISSING_ARG', 'scene devtools update requires at least one update flag')
    return { action, session, expectedRevision, changes }
  }

  if (action === 'transfer') {
    if (!values.has('--host-kind') || !values.has('--host-id')) fail('MISSING_ARG', 'scene devtools transfer requires --host-kind and --host-id')
    const kind = values.get('--host-kind')
    if (!DEVTOOLS_HOST_KINDS.has(kind)) fail('INVALID_DEVTOOLS_HOST_KIND', 'DesktopWorld DevTools host kind is invalid')
    return { action, session, expectedRevision, host: { kind, id: validateDevToolsIdentifier(values.get('--host-id'), 'host') } }
  }

  return { action, session, resource }
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
    return { command, json, ...parseDevToolsArgs(action, withoutJson.slice(1)) }
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
  if (Object.hasOwn(operation, 'extension')) {
    if (operation.op !== 'mount') fail('SCENE_EXTENSION_REFERENCE_INVALID', 'scene extensions may be supplied only by mount')
    const validation = validateSceneExtensionReference(operation.extension)
    if (!validation.ok) fail('SCENE_EXTENSION_REFERENCE_INVALID', 'scene extension reference is invalid')
    return {
      ...operation,
      extension: {
        ownerId: operation.extension.ownerId,
        id: operation.extension.id,
        digest: operation.extension.digest,
        sceneAbi: operation.extension.sceneAbi,
        threeRevision: operation.extension.threeRevision,
      },
    }
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

async function runExtensionCommand(args) {
  const options = parseExtensionArgs(args)
  const {
    installSceneExtension,
    listSceneExtensions,
    validateSceneExtensionDirectory,
  } = await import('./lib/aos-scene-extension.mjs')
  let result
  if (options.action === 'validate') result = await validateSceneExtensionDirectory(options.directory)
  else if (options.action === 'install') {
    result = await installSceneExtension(options.directory, { expectedDigest: options.expectedDigest })
  }
  else result = await listSceneExtensions()
  process.stdout.write(`${JSON.stringify(result)}\n`)
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
    else if (options.command === 'devtools' && options.action === 'update') result = await client.devtools.update(options.session, options.expectedRevision, options.changes)
    else if (options.command === 'devtools' && options.action === 'transfer') result = await client.devtools.transfer(options.session, options.expectedRevision, options.host)
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
  try {
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
  } finally {
    if (!closed) await cleanup(0)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'cartridge') return runCartridgeValidate(args)
  if (args[0] === 'extension') return runExtensionCommand(args)
  const tool = parseToolArgs(args)
  if (tool) return runToolCommand(tool)
  return runSceneFollow(args)
}

main().catch((error) => {
  process.stderr.write(`${safeError(error)}\n`)
  process.exitCode = 1
})

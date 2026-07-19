#!/usr/bin/env node

import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

import { connectWithAutoStart, stopManagedDaemon } from './lib/aos-daemon-client.mjs'
import {
  normalizeStatusItemDescriptor,
  normalizeStatusItemEvent,
  normalizeStatusItemUpdateRequest,
} from '../packages/toolkit/status-item/index.js'

const MAX_LINE_BYTES = 256 * 1024
const MAX_PENDING_LEASE_EVENTS = 32
const DEFAULT_TIMEOUT_MS = 5_000

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function safeError(error) {
  return { status: 'failure', code: error?.code ?? 'STATUS_ITEM_FAILED', error: error?.message ?? 'status item command failed' }
}

function valueAfter(args, token) {
  const index = args.indexOf(token)
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) fail('MISSING_ARG', `${token} requires a value`)
  return args[index + 1]
}

function assertOnlyArgs(args, valueFlags, boolFlags = new Set()) {
  const seen = new Set()
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (seen.has(arg)) fail('DUPLICATE_ARG', `duplicate argument: ${arg}`)
    if (boolFlags.has(arg)) {
      seen.add(arg)
      continue
    }
    if (valueFlags.has(arg)) {
      seen.add(arg)
      index += 1
      if (index >= args.length || args[index].startsWith('--')) fail('MISSING_ARG', `${arg} requires a value`)
      continue
    }
    fail(arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG', arg.startsWith('--') ? `unknown flag: ${arg}` : 'unexpected positional argument')
  }
}

function parseIdentity(args, { actionRequired = false, revisionRequired = false } = {}) {
  const owner = valueAfter(args, '--owner')
  const item = valueAfter(args, '--item')
  const identity = { owner, item_id: item }
  if (actionRequired) identity.action_id = valueAfter(args, '--action')
  if (args.includes('--generation')) identity.generation = Number(valueAfter(args, '--generation'))
  if (args.includes('--descriptor-revision')) identity.descriptor_revision = Number(valueAfter(args, '--descriptor-revision'))
  if (revisionRequired && (
    !Number.isSafeInteger(identity.generation)
    || identity.generation < 1
    || !Number.isSafeInteger(identity.descriptor_revision)
    || identity.descriptor_revision < 0
  )) {
    fail('MISSING_ARG', '--generation and --descriptor-revision are required')
  }
  return identity
}

function parseArgs(argv) {
  const [command, ...tail] = argv
  const json = tail.includes('--json')
  if (!json) fail('MISSING_ARG', 'aos status-item commands require --json')
  const args = tail.filter((arg) => arg !== '--json')
  if (command === 'validate') {
    assertOnlyArgs(args, new Set(['--descriptor']))
    return { command, descriptorPath: valueAfter(args, '--descriptor') }
  }
  if (command === 'register') {
    assertOnlyArgs(args, new Set(['--descriptor']), new Set(['--follow']))
    if (!args.includes('--follow')) fail('MISSING_ARG', 'aos status-item register requires --follow because the lease is connection-scoped')
    return { command, descriptorPath: valueAfter(args, '--descriptor'), follow: true }
  }
  if (command === 'update') {
    assertOnlyArgs(args, new Set(['--descriptor', '--owner', '--item', '--generation', '--current-revision']))
    const identity = parseIdentity(args, { revisionRequired: false })
    const generation = Number(valueAfter(args, '--generation'))
    const currentRevision = Number(valueAfter(args, '--current-revision'))
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(currentRevision) || currentRevision < 0) {
      fail('MISSING_ARG', '--generation and --current-revision must be non-negative safe integers, with generation at least 1')
    }
    return {
      command,
      descriptorPath: valueAfter(args, '--descriptor'),
      owner: identity.owner,
      item_id: identity.item_id,
      generation,
      current_revision: currentRevision,
    }
  }
  if (command === 'inspect') {
    assertOnlyArgs(args, new Set(['--owner', '--item', '--generation', '--descriptor-revision']))
    return { command, ...parseIdentity(args, { revisionRequired: true }) }
  }
  if (command === 'invoke') {
    assertOnlyArgs(args, new Set(['--owner', '--item', '--action', '--generation', '--descriptor-revision']), new Set(['--dry-run']))
    return { command, dryRun: args.includes('--dry-run'), ...parseIdentity(args, { actionRequired: true, revisionRequired: true }) }
  }
  fail('UNKNOWN_SUBCOMMAND', 'Usage: aos status-item <validate|register|update|inspect|invoke> --json')
}

async function readDescriptor(file) {
  const stats = await fs.lstat(file).catch(() => null)
  if (!stats?.isFile() || stats.isSymbolicLink()) fail('STATUS_ITEM_DESCRIPTOR_PATH_INVALID', 'status item descriptor must be a regular file')
  if (stats.size <= 0 || stats.size > MAX_LINE_BYTES) fail('STATUS_ITEM_DESCRIPTOR_TOO_LARGE', 'status item descriptor exceeds the byte limit')
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    fail('INVALID_STATUS_ITEM_DESCRIPTOR', 'status item descriptor is not valid JSON')
  }
  return normalizeStatusItemDescriptor(parsed)
}

class LineReader {
  #buffer = Buffer.alloc(0)
  #onLine

  constructor(onLine) {
    this.#onLine = onLine
  }

  push(chunk) {
    let value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    while (value.length > 0) {
      const newline = value.indexOf(0x0a)
      if (newline < 0) {
        if (this.#buffer.length + value.length > MAX_LINE_BYTES) fail('STATUS_ITEM_DAEMON_LINE_TOO_LARGE', 'status item daemon response exceeded the line limit')
        this.#buffer = this.#buffer.length === 0 ? Buffer.from(value) : Buffer.concat([this.#buffer, value], this.#buffer.length + value.length)
        return
      }
      const part = value.subarray(0, newline)
      if (this.#buffer.length + part.length > MAX_LINE_BYTES) fail('STATUS_ITEM_DAEMON_LINE_TOO_LARGE', 'status item daemon response exceeded the line limit')
      const line = this.#buffer.length === 0 ? part : Buffer.concat([this.#buffer, part], this.#buffer.length + part.length)
      this.#buffer = Buffer.alloc(0)
      value = value.subarray(newline + 1)
      if (line.length > 0) this.#onLine(JSON.parse(line.toString('utf8')))
    }
  }
}

async function withDaemon(callback, onEvent = () => {}, { allowStart = true, signal = null } = {}) {
  const connection = await connectWithAutoStart({ managed: true, allowStart, signal })
  if (!connection?.socket) {
    if (signal?.aborted) return
    fail('DAEMON_UNREACHABLE', 'Cannot connect to the AOS daemon')
  }
  const pending = new Map()
  const socket = connection.socket
  let closed = false
  let terminalError = null
  let closeResolve
  const closeResult = new Promise((resolve) => { closeResolve = resolve })
  const makeError = (code, message) => {
    const error = new Error(message)
    error.code = code
    return error
  }
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const canceledError = () => makeError('STATUS_ITEM_CANCELED', 'status item command was canceled')
  const onAbort = () => {
    rejectPending(canceledError())
    socket.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const reader = new LineReader((payload) => {
    if (payload.event) {
      if (!payload.data) throw makeError('STATUS_ITEM_DAEMON_PROTOCOL_ERROR', 'status item daemon event is malformed')
      onEvent({ ...payload, data: normalizeStatusItemEvent(payload.data) })
      return
    }
    const pendingRequest = typeof payload.ref === 'string' ? pending.get(payload.ref) : null
    if (!pendingRequest) throw makeError('STATUS_ITEM_DAEMON_PROTOCOL_ERROR', 'status item daemon response is uncorrelated')
    pending.delete(payload.ref)
    clearTimeout(pendingRequest.timer)
    if (payload.status === 'error' || payload.code) pendingRequest.reject(makeError(payload.code ?? 'STATUS_ITEM_DAEMON_ERROR', payload.error ?? 'status item daemon error'))
    else pendingRequest.resolve(payload.data ?? payload)
  })
  socket.on('data', (chunk) => {
    try {
      reader.push(chunk)
    } catch (error) {
      terminalError = error?.code ? error : makeError('STATUS_ITEM_DAEMON_PROTOCOL_ERROR', 'status item daemon response is malformed')
      rejectPending(terminalError)
      socket.destroy()
    }
  })
  socket.once('error', () => {
    if (!signal?.aborted) terminalError ??= makeError('STATUS_ITEM_DAEMON_IO_FAILED', 'status item daemon I/O failed')
    if (terminalError) rejectPending(terminalError)
  })
  socket.once('close', () => {
    closed = true
    if (!signal?.aborted) {
      terminalError ??= makeError('STATUS_ITEM_DAEMON_CLOSED', 'status item daemon connection closed')
      rejectPending(terminalError)
    }
    closeResolve(terminalError)
  })
  async function request(action, data = {}) {
    if (closed) fail('STATUS_ITEM_DAEMON_CLOSED', 'status item daemon connection closed')
    const ref = randomUUID()
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(ref)
        reject(makeError('STATUS_ITEM_DAEMON_TIMEOUT', 'status item daemon request timed out'))
      }, DEFAULT_TIMEOUT_MS)
      pending.set(ref, { resolve, reject, timer })
    })
    socket.write(`${JSON.stringify({ v: 1, service: 'status_item', action, data, ref })}\n`)
    return response
  }
  try {
    return await callback({
      request,
      socket,
      waitForClose: async () => {
        const error = await closeResult
        if (error) throw error
      },
    })
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!closed) socket.end()
    await stopManagedDaemon(connection.daemon)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'validate') {
    const descriptor = await readDescriptor(args.descriptorPath)
    emit({ status: 'ok', descriptor })
    return
  }
  if (args.command === 'register') {
    const descriptor = await readDescriptor(args.descriptorPath)
    const startupAbort = new AbortController()
    const pendingEvents = []
    let registrationEmitted = false
    const emitLeaseEvent = (value) => {
      if (registrationEmitted) {
        emit(value)
        return
      }
      if (pendingEvents.length >= MAX_PENDING_LEASE_EVENTS) {
        fail('STATUS_ITEM_EVENT_BUFFER_EXCEEDED', 'too many status item events arrived before registration')
      }
      pendingEvents.push(value)
    }
    const requestShutdown = () => startupAbort.abort()
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
    try {
      await withDaemon(async ({ request, waitForClose }) => {
        const registered = await request('register', { descriptor })
        emit({ status: 'ok', registered })
        registrationEmitted = true
        pendingEvents.splice(0).forEach(emit)
        await waitForClose()
      }, emitLeaseEvent, { signal: startupAbort.signal })
    } finally {
      if (parentMonitor) clearInterval(parentMonitor)
      process.off('SIGINT', requestShutdown)
      process.off('SIGTERM', requestShutdown)
    }
    return
  }
  if (args.command === 'update') {
    const descriptor = await readDescriptor(args.descriptorPath)
    const request = normalizeStatusItemUpdateRequest({
      owner: args.owner,
      item_id: args.item_id,
      generation: args.generation,
      current_revision: args.current_revision,
      descriptor,
    })
    await withDaemon(async ({ request: send }) => emit(await send('update', request)), undefined, { allowStart: false })
    return
  }
  if (args.command === 'inspect') {
    await withDaemon(async ({ request }) => emit(await request('inspect', {
      owner: args.owner,
      item_id: args.item_id,
      generation: args.generation,
      descriptor_revision: args.descriptor_revision,
    })), undefined, { allowStart: false })
    return
  }
  if (args.command === 'invoke') {
    await withDaemon(async ({ request }) => {
      const action = args.dryRun ? 'invoke_dry_run' : 'invoke'
      emit(await request(action, {
        owner: args.owner,
        item_id: args.item_id,
        action_id: args.action_id,
        generation: args.generation,
        descriptor_revision: args.descriptor_revision,
      }))
    }, undefined, { allowStart: false })
    return
  }
}

try {
  await main()
} catch (error) {
  if (error?.code === 'STATUS_ITEM_CANCELED') process.exit(0)
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`)
  process.exit(1)
}

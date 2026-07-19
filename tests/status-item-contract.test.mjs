import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  STATUS_ITEM_ANCHOR_SCHEMA_VERSION,
  STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION,
  STATUS_ITEM_EVENT_SCHEMA_VERSION,
  normalizeStatusItemAnchor,
  normalizeStatusItemDescriptor,
  normalizeStatusItemEvent,
  normalizeStatusItemUpdateRequest,
} from '../packages/toolkit/status-item/index.js'
import { createStatusItemOutputWriter } from '../scripts/lib/status-item-output-writer.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const descriptorSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-descriptor-v1.schema.json')
const eventSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-event-v1.schema.json')
const anchorSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-anchor-v1.schema.json')

const descriptor = {
  schema_version: STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION,
  owner: 'io.example.app',
  item_id: 'companion',
  revision: 3,
  label: 'Example Companion',
  help_text: 'Example app status item',
  primary_action_id: 'summon',
  menu: [
    { kind: 'item', id: 'park', action_id: 'park', label: 'Park', enabled: true },
    { kind: 'separator' },
    { kind: 'item', id: 'quit', action_id: 'quit', label: 'Quit', enabled: false },
  ],
}

const updatedDescriptor = {
  ...descriptor,
  revision: 4,
  help_text: 'Updated example app status item',
  menu: [
    { kind: 'item', id: 'park', action_id: 'park', label: 'Park here', enabled: true },
    { kind: 'separator' },
    { kind: 'item', id: 'quit', action_id: 'quit', label: 'Quit', enabled: false },
  ],
}

const bounds = {
  x: 1,
  y: 2,
  width: 24,
  height: 24,
  origin_x: 13,
  origin_y: 14,
  display_id: 1,
}

const anchor = {
  schema_version: STATUS_ITEM_ANCHOR_SCHEMA_VERSION,
  anchor_id: 'native-status-item/io.example.app/companion',
  host: 'native_status_item',
  coordinate_space: 'global_display_top_left',
  visible: true,
  bounds,
  display: {
    id: 1,
    frame: { x: 0, y: 0, width: 1920, height: 1080, origin_x: 960, origin_y: 540 },
    visible_frame: { x: 0, y: 24, width: 1920, height: 1056, origin_x: 960, origin_y: 552 },
  },
  topology: { display_count: 1, display_ids: [1], truncated: false },
}

const event = {
  schema_version: STATUS_ITEM_EVENT_SCHEMA_VERSION,
  type: 'menu_selection',
  owner: 'io.example.app',
  item_id: 'companion',
  generation: 7,
  descriptor_revision: 3,
  sequence: 2,
  timestamp: '2026-07-19T20:00:00Z',
  source: 'status_item',
  action_id: 'park',
  menu_item_id: 'park',
  origin_x: 10,
  origin_y: 20,
  modifiers: [],
  bounds,
  anchor,
}

function validateWithSchema(schemaPath, value) {
  const result = execFileSync('python3', ['-', schemaPath, JSON.stringify(value)], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input: `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(json.loads(sys.argv[2])), key=lambda e: list(e.path))
if errors:
    raise SystemExit(errors[0].message)
`,
  })
  assert.equal(result, '')
}

function runCLI(args, env) {
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/aos-status-item.mjs', ...args], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

function waitForOutput(child, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`timed out waiting for output: ${output}`)), timeoutMs)
    const onData = (chunk) => {
      output += chunk
      if (!predicate(output)) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolve(output)
    }
    child.stdout.on('data', onData)
  })
}

function within(promise, timeoutMs, message, onTimeout = () => {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function listenFake(stateRoot, onRequest) {
  const sock = path.join(stateRoot, 'repo', 'sock')
  fs.mkdirSync(path.dirname(sock), { recursive: true })
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line) onRequest(socket, JSON.parse(line))
      }
    })
  })
  await new Promise((resolve) => server.listen(sock, resolve))
  return server
}

test('status item descriptor, anchor, and observed event match public schemas', () => {
  validateWithSchema(descriptorSchemaPath, descriptor)
  validateWithSchema(anchorSchemaPath, anchor)
  validateWithSchema(eventSchemaPath, event)
  const eventSchema = JSON.parse(fs.readFileSync(eventSchemaPath, 'utf8'))
  const anchorSchema = JSON.parse(fs.readFileSync(anchorSchemaPath, 'utf8'))
  assert.deepEqual(eventSchema.$defs.anchor, anchorSchema.$defs.anchor)
  assert.deepEqual(eventSchema.$defs.rect, anchorSchema.$defs.rect)
  assert.deepEqual(eventSchema.$defs.status_item_bounds, anchorSchema.$defs.status_item_bounds)
})

test('descriptor schema and runtime agree on canonical Unicode character bounds', () => {
  const unicodeLabel = 'é'.repeat(128)
  const valid = { ...descriptor, label: unicodeLabel }
  validateWithSchema(descriptorSchemaPath, valid)
  assert.equal(normalizeStatusItemDescriptor(valid).label, unicodeLabel)

  for (const invalid of [
    { ...descriptor, label: 'é'.repeat(129) },
    { ...descriptor, label: ' Example Companion' },
    { ...descriptor, label: 'Example Companion ' },
    { ...descriptor, label: '\tExample Companion' },
    { ...descriptor, label: 'Example Companion\n' },
    { ...descriptor, label: 'Example Companion\r\n' },
    { ...descriptor, label: '   ' },
    { ...descriptor, help_text: ' Help' },
    { ...descriptor, help_text: 'Help\n' },
    { ...descriptor, menu: [{ kind: 'item', id: 'park', action_id: 'park', label: ' Park' }] },
  ]) {
    assert.throws(() => validateWithSchema(descriptorSchemaPath, invalid))
    assert.throws(() => normalizeStatusItemDescriptor(invalid))
  }
})

test('bounded source writer pauses once, queues current-chunk events, and resumes on drain', () => {
  const listeners = new Map()
  let writable = false
  const writes = []
  const output = {
    write(line) {
      writes.push(line)
      return writable
    },
    once(event, listener) { listeners.set(event, listener) },
  }
  const source = {
    destroyed: false,
    pauses: 0,
    resumes: 0,
    pause() { this.pauses += 1 },
    resume() { this.resumes += 1 },
  }
  const writer = createStatusItemOutputWriter({ output, maxQueuedBytes: 256, maxQueuedMessages: 2 })
  writer.attachSource(source)
  assert.equal(writer.write('one\n'), false)
  assert.equal(writer.write('two\n'), false)
  assert.equal(source.pauses, 1)
  assert.deepEqual(writer.snapshot(), { blocked: true, queued_bytes: 4, queued_messages: 1 })

  writable = true
  listeners.get('drain')()
  assert.deepEqual(writes, ['one\n', 'two\n'])
  assert.equal(source.resumes, 1)
  assert.deepEqual(writer.snapshot(), { blocked: false, queued_bytes: 0, queued_messages: 0 })
})

test('bounded source writer fails closed when a paused source exceeds its queue', () => {
  const output = { write: () => false, once: () => {} }
  const source = { destroyed: false, pause() {}, resume() {} }
  const writer = createStatusItemOutputWriter({ output, maxQueuedBytes: 8, maxQueuedMessages: 1 })
  writer.attachSource(source)
  writer.write('one\n')
  writer.write('two\n')
  assert.throws(
    () => writer.write('three\n'),
    (error) => error?.code === 'STATUS_ITEM_OUTPUT_BUFFER_EXCEEDED',
  )
})

test('toolkit normalizes the product-neutral descriptor and AOS-derived anchor event', () => {
  const normalized = normalizeStatusItemDescriptor(descriptor)
  assert.equal(normalized.owner, 'io.example.app')
  assert.equal(normalized.menu.length, 3)
  assert.deepEqual(normalizeStatusItemAnchor(anchor), anchor)

  const normalizedEvent = normalizeStatusItemEvent(event)
  assert.equal(normalizedEvent.type, 'menu_selection')
  assert.equal(normalizedEvent.action_id, 'park')
  assert.equal(normalizedEvent.timestamp, event.timestamp)
  assert.equal(normalizedEvent.anchor.anchor_id, anchor.anchor_id)
  assert.equal(normalizedEvent.bounds.display_id, 1)
})

test('toolkit normalizes compare-and-swap updates and rejects stale or mismatched descriptors', () => {
  const request = {
    owner: descriptor.owner,
    item_id: descriptor.item_id,
    generation: 7,
    current_revision: descriptor.revision,
    descriptor: updatedDescriptor,
  }
  assert.deepEqual(normalizeStatusItemUpdateRequest(request), request)
  assert.throws(
    () => normalizeStatusItemUpdateRequest({ ...request, descriptor: { ...updatedDescriptor, owner: 'io.example.other' } }),
    /must match/,
  )
  assert.throws(
    () => normalizeStatusItemUpdateRequest({ ...request, current_revision: updatedDescriptor.revision }),
    /advance/,
  )
  const types = fs.readFileSync(path.join(repoRoot, 'packages/toolkit/status-item/index.d.ts'), 'utf8')
  assert.match(types, /interface StatusItemUpdateRequest/)
  assert.match(types, /interface StatusItemUpdateResult/)
  assert.match(types, /normalizeStatusItemUpdateRequest/)
})

test('descriptor validation rejects visual paths, inert anchors, code, duplicate identities, and primary collisions', () => {
  for (const unsupported of [
    { icon: { kind: 'consumer_visual' } },
    { anchor: { anchor_id: 'consumer-supplied' } },
  ]) {
    assert.throws(() => normalizeStatusItemDescriptor({ ...descriptor, ...unsupported }), /unsupported/)
  }
  assert.throws(
    () => normalizeStatusItemDescriptor({
      ...descriptor,
      menu: [{ kind: 'item', id: 'x', action_id: 'x', label: 'X', script: 'run()' }],
    }),
    /unsupported/,
  )
  assert.throws(
    () => normalizeStatusItemDescriptor({
      ...descriptor,
      menu: [
        { kind: 'item', id: 'dup', action_id: 'park', label: 'Park' },
        { kind: 'item', id: 'dup', action_id: 'other', label: 'Other' },
      ],
    }),
    /duplicate/,
  )
  assert.throws(
    () => normalizeStatusItemDescriptor({
      ...descriptor,
      menu: [{ kind: 'item', id: 'summon', action_id: 'summon', label: 'Summon' }],
    }),
    /primary/,
  )
  assert.throws(() => normalizeStatusItemDescriptor({ ...descriptor, help_text: null }), /string/)
  assert.throws(() => normalizeStatusItemDescriptor({ ...descriptor, menu: null }), /array/)
  assert.throws(
    () => normalizeStatusItemDescriptor({
      ...descriptor,
      menu: [{ kind: 'item', id: 'park', action_id: 'park', label: 'Park', enabled: null }],
    }),
    /boolean/,
  )
})

test('event normalization rejects unsafe integers, incomplete actions, and contradictory anchor facts', () => {
  assert.throws(() => normalizeStatusItemEvent({ ...event, generation: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/)
  assert.throws(() => normalizeStatusItemEvent({ ...event, timestamp: undefined }), /string/)
  const incomplete = { ...event }
  delete incomplete.action_id
  assert.throws(() => normalizeStatusItemEvent(incomplete), /incomplete/)
  assert.throws(
    () => normalizeStatusItemEvent({ ...event, bounds: { ...bounds, display_id: 2 } }),
    /disagree/,
  )
  assert.throws(
    () => normalizeStatusItemEvent({ ...event, owner: 'io.example.other' }),
    /anchor identity/,
  )
  const ready = {
    ...event,
    type: 'ready',
    action_id: undefined,
    menu_item_id: undefined,
    origin_x: undefined,
    origin_y: undefined,
    modifiers: undefined,
  }
  for (const key of ['action_id', 'menu_item_id', 'origin_x', 'origin_y', 'modifiers']) delete ready[key]
  assert.throws(() => normalizeStatusItemEvent({ ...ready, action_id: null }), /string/)
})

test('aos status-item validate is bounded, offline, and machine-readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-item-contract-'))
  const file = path.join(dir, 'descriptor.json')
  fs.writeFileSync(file, `${JSON.stringify(descriptor)}\n`, 'utf8')
  const result = execFileSync('node', ['scripts/aos-status-item.mjs', 'validate', '--descriptor', file, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const payload = JSON.parse(result)
  assert.equal(payload.status, 'ok')
  assert.deepEqual(payload.descriptor, descriptor)
})

test('CLI rejects invalid exact lease identity before connecting', async () => {
  const result = await runCLI([
    'inspect', '--owner', descriptor.owner, '--item', descriptor.item_id,
    '--generation', '-1', '--descriptor-revision', '3', '--json',
  ], { ...process.env, AOS_DISABLE_DAEMON_AUTOSTART: '1' })
  assert.equal(result.code, 1)
  assert.equal(JSON.parse(result.stderr).code, 'MISSING_ARG')
})

test('documented register-follow, update, inspect, dry-run, and invoke use truthful multi-connection ownership', async () => {
  const stateRoot = fs.mkdtempSync('/private/tmp/aos-status-item-fake-')
  const requests = []
  let leaseSocket = null
  let updateSocket = null
  let activeRevision = descriptor.revision
  const server = await listenFake(stateRoot, (socket, request) => {
    requests.push({ action: request.action, ref: request.ref, socket })
    if (request.action === 'register') {
      leaseSocket = socket
      socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data: { owner: descriptor.owner, item_id: descriptor.item_id, generation: 7, descriptor_revision: 3, anchor } })}\n`)
      socket.write(`${JSON.stringify({ event: 'ready', data: { ...event, type: 'ready', sequence: 1, action_id: undefined, menu_item_id: undefined, origin_x: undefined, origin_y: undefined, modifiers: undefined } })}\n`)
    } else if (request.action === 'update') {
      updateSocket = socket
      assert.notEqual(socket, leaseSocket)
      assert.deepEqual(request.data, {
        owner: descriptor.owner,
        item_id: descriptor.item_id,
        generation: 7,
        current_revision: 3,
        descriptor: updatedDescriptor,
      })
      activeRevision = updatedDescriptor.revision
      socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data: { owner: descriptor.owner, item_id: descriptor.item_id, generation: 7, previous_descriptor_revision: 3, descriptor_revision: activeRevision, updated: true, anchor } })}\n`)
      socket.end()
      leaseSocket.write(`${JSON.stringify({ event: 'menu_selection', data: { ...event, descriptor_revision: activeRevision, sequence: 2 } })}\n`)
    } else if (request.action === 'inspect') {
      socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data: { state: { owner: descriptor.owner, item_id: descriptor.item_id, generation: 7, descriptor_revision: activeRevision, anchor } } })}\n`)
      socket.end()
    } else if (request.action === 'invoke_dry_run') {
      socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'dry_run', data: { owner: descriptor.owner, item_id: descriptor.item_id, action_id: 'summon', generation: 7, descriptor_revision: activeRevision, anchor } })}\n`)
      socket.end()
    } else if (request.action === 'invoke') {
      socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data: { owner: descriptor.owner, item_id: descriptor.item_id, action_id: 'summon', generation: 7, descriptor_revision: activeRevision, anchor } })}\n`)
      socket.end()
    }
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-item-cli-'))
  const file = path.join(dir, 'descriptor.json')
  const updatedFile = path.join(dir, 'descriptor-v4.json')
  fs.writeFileSync(file, `${JSON.stringify(descriptor)}\n`, 'utf8')
  fs.writeFileSync(updatedFile, `${JSON.stringify(updatedDescriptor)}\n`, 'utf8')
  const env = { ...process.env, AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo', AOS_DISABLE_DAEMON_AUTOSTART: '1' }
  const register = spawn('node', ['scripts/aos-status-item.mjs', 'register', '--descriptor', file, '--json', '--follow'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let registerError = ''
  register.stderr.on('data', (chunk) => { registerError += chunk })
  try {
    const output = await waitForOutput(register, (value) => value.includes('"registered"') && value.includes('"ready"'))
    const registrationLines = output.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(registrationLines[0].registered.generation, 7)
    assert.equal(registrationLines[0].registered.status, 'ok')
    assert.equal(registrationLines[0].registered.descriptor_revision, 3)
    assert.equal(registrationLines[1].event, 'ready')
    assert.equal(registrationLines[1].data.sequence, 1)

    const updatedLeaseEvent = waitForOutput(register, (value) => value.includes('"descriptor_revision":4'))
    const update = await runCLI([
      'update', '--descriptor', updatedFile,
      '--owner', descriptor.owner, '--item', descriptor.item_id,
      '--generation', '7', '--current-revision', '3', '--json',
    ], env)
    assert.equal(update.code, 0, update.stderr)
    assert.equal(JSON.parse(update.stdout).status, 'ok')
    assert.equal(JSON.parse(update.stdout).descriptor_revision, 4)
    const eventOutput = JSON.parse((await updatedLeaseEvent).trim())
    assert.equal(eventOutput.event, 'menu_selection')
    assert.equal(eventOutput.data.descriptor_revision, 4)

    const exact = ['--owner', descriptor.owner, '--item', descriptor.item_id, '--generation', '7', '--descriptor-revision', '4', '--json']
    const inspect = await runCLI(['inspect', ...exact], env)
    assert.equal(inspect.code, 0, inspect.stderr)
    assert.equal(JSON.parse(inspect.stdout).status, 'ok')
    const dryRun = await runCLI(['invoke', '--owner', descriptor.owner, '--item', descriptor.item_id, '--action', 'summon', '--generation', '7', '--descriptor-revision', '4', '--dry-run', '--json'], env)
    assert.equal(dryRun.code, 0, dryRun.stderr)
    assert.equal(JSON.parse(dryRun.stdout).status, 'dry_run')
    const invoke = await runCLI(['invoke', '--owner', descriptor.owner, '--item', descriptor.item_id, '--action', 'summon', '--generation', '7', '--descriptor-revision', '4', '--json'], env)
    assert.equal(invoke.code, 0, invoke.stderr)
    assert.equal(JSON.parse(invoke.stdout).status, 'ok')
    assert.deepEqual(requests.map((request) => request.action), ['register', 'update', 'inspect', 'invoke_dry_run', 'invoke'])
    assert.ok(leaseSocket && !leaseSocket.destroyed)
    assert.ok(updateSocket && updateSocket.destroyed)
  } finally {
    register.kill('SIGTERM')
    await new Promise((resolve) => register.once('close', resolve))
    assert.equal(registerError, '')
    assert.ok(leaseSocket?.destroyed)
    await new Promise((resolve) => server.close(resolve))
  }
})

test('register bounds events that arrive before the registration result', async () => {
  const stateRoot = fs.mkdtempSync('/private/tmp/aos-status-item-event-flood-')
  const server = await listenFake(stateRoot, (socket, request) => {
    for (let sequence = 1; sequence <= 33; sequence += 1) {
      socket.write(`${JSON.stringify({
        event: 'ready',
        data: { ...event, type: 'ready', sequence, action_id: undefined, menu_item_id: undefined, origin_x: undefined, origin_y: undefined, modifiers: undefined },
      })}\n`)
    }
    socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data: { generation: 7, descriptor_revision: 3 } })}\n`)
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-item-event-flood-cli-'))
  const file = path.join(dir, 'descriptor.json')
  fs.writeFileSync(file, `${JSON.stringify(descriptor)}\n`, 'utf8')
  const result = await runCLI(['register', '--descriptor', file, '--json', '--follow'], {
    ...process.env,
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_DISABLE_DAEMON_AUTOSTART: '1',
  })
  assert.equal(result.code, 1)
  assert.equal(JSON.parse(result.stderr).code, 'STATUS_ITEM_EVENT_BUFFER_EXCEEDED')
  await new Promise((resolve) => server.close(resolve))
})

test('register follow exits on signal while stdout is backpressured', async (t) => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-item-backpressure-signal-'))
  let server = null
  let child = null
  let childClosed = null
  t.after(async () => {
    let cleanupError = null
    try {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (childClosed) await within(childClosed, 1_500, 'status item test child did not terminate during cleanup')
    } catch (error) {
      cleanupError = error
    }
    try {
      if (server?.listening) {
        await within(
          new Promise((resolve) => server.close(resolve)),
          1_500,
          'status item fake server did not close during cleanup',
        )
      }
    } catch (error) {
      cleanupError ??= error
    }
    fs.rmSync(stateRoot, { recursive: true, force: true })
    if (cleanupError) throw cleanupError
  })
  const descriptorPath = path.join(stateRoot, 'descriptor.json')
  fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`, 'utf8')
  let registrationResolved
  const registrationSent = new Promise((resolve) => { registrationResolved = resolve })
  server = await listenFake(stateRoot, (socket, request) => {
    socket.write(`${JSON.stringify({
      v: 1,
      ref: request.ref,
      status: 'success',
      data: { generation: 7, descriptor_revision: 3, padding: 'x'.repeat(200_000) },
    })}\n`)
    registrationResolved()
  })
  child = spawn('node', [
    'scripts/aos-status-item.mjs',
    'register', '--descriptor', descriptorPath, '--json', '--follow',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  childClosed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  await within(registrationSent, 1_500, 'status item register request did not reach the fake daemon')
  await new Promise((resolve) => setTimeout(resolve, 100))
  child.kill('SIGTERM')
  const result = await within(
    childClosed,
    1_500,
    'register follow did not exit after SIGTERM under stdout backpressure',
    () => child.kill('SIGKILL'),
  )
  assert.deepEqual(result, { code: 0, signal: null }, stderr)
})

test('CLI settles daemon error, malformed response, legacy success, and disconnect failures', async () => {
  for (const scenario of ['error', 'malformed', 'legacy_success', 'disconnect']) {
    const stateRoot = fs.mkdtempSync(`/private/tmp/aos-status-item-${scenario}-`)
    const server = await listenFake(stateRoot, (socket, request) => {
      if (scenario === 'error') {
        socket.end(`${JSON.stringify({ v: 1, ref: request.ref, status: 'error', code: 'STATUS_ITEM_TEST_ERROR', error: 'test daemon error' })}\n`)
      } else if (scenario === 'malformed') {
        socket.end('{not-json}\n')
      } else if (scenario === 'legacy_success') {
        socket.end(`${JSON.stringify({ ref: request.ref, data: { status: 'ok' } })}\n`)
      } else {
        socket.end()
      }
    })
    const env = { ...process.env, AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo', AOS_DISABLE_DAEMON_AUTOSTART: '1' }
    const result = await runCLI(['inspect', '--owner', descriptor.owner, '--item', descriptor.item_id, '--generation', '7', '--descriptor-revision', '3', '--json'], env)
    assert.equal(result.code, 1, `${scenario}: ${result.stderr}`)
    const failure = JSON.parse(result.stderr)
    assert.match(failure.code, scenario === 'error' ? /STATUS_ITEM_TEST_ERROR/ : /STATUS_ITEM_DAEMON_(PROTOCOL_ERROR|CLOSED)/)
    await new Promise((resolve) => server.close(resolve))
  }
})

test('source manifest exposes only the truthful lease command forms', () => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/commands/source/aos/40-status-item.json'), 'utf8'))
  const forms = source.commands.flatMap((command) => command.forms ?? [])
  assert.deepEqual(forms.map((form) => form.id), [
    'status-item-validate',
    'status-item-register',
    'status-item-update',
    'status-item-inspect',
    'status-item-invoke',
  ])
  const register = forms.find((form) => form.id === 'status-item-register')
  assert.equal(register.args.find((arg) => arg.id === 'follow')?.required, true)
  const update = forms.find((form) => form.id === 'status-item-update')
  assert.equal(update.args.find((arg) => arg.id === 'current-revision')?.required, true)
  assert.equal(update.execution.auto_starts_daemon, false)
  const inspect = forms.find((form) => form.id === 'status-item-inspect')
  assert.equal(inspect.args.find((arg) => arg.id === 'generation')?.required, true)
  assert.equal(inspect.args.find((arg) => arg.id === 'descriptor-revision')?.required, true)
  const invoke = forms.find((form) => form.id === 'status-item-invoke')
  assert.equal(invoke.execution.auto_starts_daemon, false)
  const generated = fs.readFileSync(path.join(repoRoot, 'manifests/commands/aos-commands.json'), 'utf8')
  assert(!generated.includes('status-item-cleanup'))
  assert(!generated.includes('status-item-subscribe'))
})

test('native ownership is focused and excludes superseded visual and lifecycle routes', () => {
  const manager = fs.readFileSync(path.join(repoRoot, 'src/display/status-item.swift'), 'utf8')
  const hosted = fs.readFileSync(path.join(repoRoot, 'src/display/status-item-hosted.swift'), 'utf8')
  const controller = fs.readFileSync(path.join(repoRoot, 'src/display/status-item-host-controller.swift'), 'utf8')
  const daemon = fs.readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  const combined = `${manager}\n${hosted}\n${controller}`
  assert(!combined.includes('CryptoKit'))
  assert(!combined.includes('descriptor.icon'))
  assert.match(manager, /didChangeScreenParametersNotification/)
  assert.match(manager, /didMoveNotification/)
  assert.match(controller, /runOnMainSync/)
  assert.match(controller, /STATUS_ITEM_REVISION_NOT_ADVANCED/)
  assert.match(controller, /owner: current\.owner/)
  assert.match(controller, /let scalars = string\.unicodeScalars/)
  assert.match(controller, /let count = scalars\.count/)
  assert.match(controller, /aosStatusItemBoundaryWhitespace\.contains/)
  assert.doesNotMatch(controller, /trimmed\.utf8\.count/)
  const update = controller.slice(controller.indexOf('private func update'), controller.indexOf('private func registrationResponse'))
  assert.match(update, /guard let anchor = manager\.installHostedDescriptor/)
  assert.match(update, /if !restored \{[\s\S]*lease = nil/)
  assert.match(update, /"anchor": anchor/)
  assert(!daemon.includes('status-item-cleanup'))
  assert(!daemon.includes('status-item-subscribe'))
})

test('daemon admits status-item requests only after host installation and orders result before ready', () => {
  const daemon = fs.readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  const serve = fs.readFileSync(path.join(repoRoot, 'src/commands/serve.swift'), 'utf8')
  assert.match(daemon, /private lazy var statusItemHostController = AOSStatusItemHostController/)
  assert(!daemon.includes('STATUS_ITEM_HOST_UNAVAILABLE'))
  assert(!serve.includes('statusItemHostController ='))

  const start = daemon.indexOf('func start()')
  const initialize = daemon.indexOf('initializeNativeHosts()', start)
  const listen = daemon.indexOf('listen(serverFD', start)
  const accept = daemon.indexOf('acceptLoop()', start)
  assert.ok(start >= 0 && initialize > start && initialize < listen && listen < accept)

  const dispatch = daemon.indexOf('statusItemHostController.handleCommand')
  const response = daemon.indexOf('sendResponseJSON(to: outbound, result.response', dispatch)
  const afterResponse = daemon.indexOf('result.afterResponse?()', dispatch)
  assert.ok(dispatch >= 0 && response > dispatch && afterResponse > response)

  const controller = fs.readFileSync(path.join(repoRoot, 'src/display/status-item-host-controller.swift'), 'utf8')
  const handler = controller.indexOf('func handleCommand')
  const mainTransaction = controller.indexOf('runOnMainSync', handler)
  const delivery = controller.indexOf('deliver(result)', handler)
  assert.ok(handler >= 0 && mainTransaction > handler && delivery > mainTransaction)
})

test('status item ownership files stay under the focused-size ratchet', () => {
  const counts = Object.fromEntries([
    'src/display/status-item.swift',
    'src/display/status-item-hosted.swift',
    'src/display/status-item-host-controller.swift',
  ].map((file) => [file, fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n').length]))
  assert.ok(counts['src/display/status-item.swift'] < 400, JSON.stringify(counts))
  assert.ok(counts['src/display/status-item-hosted.swift'] < 300, JSON.stringify(counts))
  assert.ok(counts['src/display/status-item-host-controller.swift'] < 500, JSON.stringify(counts))
})

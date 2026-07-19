import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repo = path.resolve(import.meta.dirname, '..')

function stage() {
  return {
    contract: 'aos.desktop-world.devtools.stage.v1', sequence: 7, status: 'available',
    world: {
      displays: [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }],
      nodes: [{ id: 'body', resourceId: 'companion/main', position: [100, 200, 0] }],
      hitRegions: [], affordances: [], gestures: [], routes: [],
    },
    resources: [{ id: 'companion/main', owner: 'example', sceneId: 'companion', revision: 2, allocations: { geometries: 1 } }],
    interactions: [], performance: { enabled: true, sampleCount: 2, currentFps: 60 }, events: [],
  }
}

function snapshot() {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v1', schemaVersion: 1,
    session: {
      id: 'devtools-test', revision: 1, activeTab: 'world', selectedResource: 'companion/main',
      filters: { query: '', eventKinds: [], errorsOnly: false }, recording: false, host: null,
    },
    stage: stage(),
  }
}

async function run(args, env, { stopAfter = null } = {}) {
  const child = spawn(process.execPath, ['scripts/aos-scene.mjs', ...args], {
    cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    if (stopAfter && stdout.includes(stopAfter)) child.kill('SIGINT')
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { ...result, stdout, stderr }
}

test('scene agent tooling uses headless snapshots and a bounded monitor stream', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-tools-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const received = []
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const request = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        received.push(request)
        const reply = (data) => socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success', data })}\n`)
        if (request.action === 'devtools_open') reply({ status: 'ok', session: snapshot() })
        else if (request.action === 'devtools_status') reply(request.data.session ? { status: 'ok', session: snapshot() } : { status: 'ok', sessions: [snapshot()] })
        else if (request.action === 'devtools_update' || request.action === 'devtools_transfer') reply({ status: 'ok', session: snapshot() })
        else if (request.action === 'devtools_close') reply({ status: 'ok', session: request.data.session, closed: true })
        else if (request.action === 'devtools_monitor') {
          socket.write(`${JSON.stringify({
            v: 1, service: 'scene', event: 'monitor', ref: request.ref, ts: 1,
            data: { resource: request.data.resource, snapshot: stage() },
          })}\n`)
          reply({ status: 'ok', resource: request.data.resource, following: true })
        }
      }
    })
  })
  await new Promise((resolve, reject) => server.listen(path.join(state, 'sock'), resolve).once('error', reject))
  const env = { AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' }
  try {
    for (const [args, assertion] of [
      [['list', '--json'], (value) => assert.equal(value.resources[0].id, 'companion/main')],
      [['inspect', '--resource', 'companion/main', '--json'], (value) => assert.equal(value.resources.length, 1)],
      [['perf', '--resource', 'companion/main', '--json'], (value) => assert.equal(value.performance.currentFps, 60)],
      [['devtools', 'open', '--resource', 'companion/main', '--json'], (value) => assert.equal(value.session.session.id, 'devtools-test')],
      [['devtools', 'status', '--json'], (value) => assert.equal(value.sessions.length, 1)],
      [['devtools', 'update', '--session', 'devtools-test', '--expected-revision', '1', '--tab', 'performance', '--query', 'companion', '--event-kinds', 'gesture,error', '--errors-only', 'on', '--recording', 'on', '--json'], (value) => assert.equal(value.session.session.id, 'devtools-test')],
      [['devtools', 'transfer', '--session', 'devtools-test', '--expected-revision', '1', '--host-kind', 'external', '--host-id', 'sigil/companion-studio', '--json'], (value) => assert.equal(value.session.session.id, 'devtools-test')],
      [['devtools', 'close', '--session', 'devtools-test', '--json'], (value) => assert.equal(value.closed, true)],
    ]) {
      const result = await run(args, env)
      assert.equal(result.code, 0, result.stderr)
      assertion(JSON.parse(result.stdout))
    }
    const monitor = await run(['monitor', '--resource', 'companion/main', '--follow', '--json'], env, { stopAfter: '"event":"monitor"' })
    assert.equal(monitor.code, 0, monitor.stderr)
    assert.equal(JSON.parse(monitor.stdout).data.snapshot.resources[0].id, 'companion/main')
    assert.ok(received.filter((entry) => entry.action === 'devtools_open' && entry.data.headless === true).length >= 3)
    assert.deepEqual(received.find((entry) => entry.action === 'devtools_update')?.data, {
      session: 'devtools-test', expected_revision: 1, active_tab: 'performance',
      filters: { query: 'companion', event_kinds: ['gesture', 'error'], errors_only: true }, recording: true,
    })
    assert.deepEqual(received.find((entry) => entry.action === 'devtools_transfer')?.data, {
      session: 'devtools-test', expected_revision: 1, host: { kind: 'external', id: 'sigil/companion-studio' },
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('scene monitor preserves unsolicited events that arrive before the correlated response', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-event-first-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const server = net.createServer((socket) => socket.once('data', (chunk) => {
    const request = JSON.parse(chunk.toString('utf8').trim())
    socket.write(`${JSON.stringify({
      v: 1, service: 'scene', event: 'monitor', ref: request.ref, ts: 1,
      data: { resource: request.data.resource, snapshot: stage() },
    })}\n`)
    socket.write(`${JSON.stringify({
      v: 1, ref: request.ref, status: 'success',
      data: { status: 'ok', resource: request.data.resource, following: true },
    })}\n`)
  }))
  await new Promise((resolve, reject) => server.listen(path.join(state, 'sock'), resolve).once('error', reject))
  try {
    const result = await run(['monitor', '--resource', 'companion/main', '--follow', '--json'], {
      AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo',
    }, { stopAfter: '"event":"monitor"' })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).event, 'monitor')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('scene replay is deterministic and never opens the daemon socket', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-replay-'))
  const fixture = path.join(root, 'events.ndjson')
  const event = (phase, sequence) => ({
    contract: 'aos.scene.event.v1', schemaVersion: 1, type: 'gesture', sequence,
    stageId: 'desktop-world/main', ownerId: 'example', resourceId: 'companion/main',
    affordanceId: 'body-aim', interactionId: 'aim-commit',
    gesture: { id: 'drag-1', kind: 'drag', phase, pointerSessionId: 'pointer-1', cancellationReason: null },
    coordinates: {
      origin: { x: 10, y: 20 }, previous: { x: 10, y: 20 }, current: { x: 30, y: 40 },
      desktopWorld: { x: 30, y: 40 }, native: { x: 30, y: 860 },
      delta: { x: 20, y: 20 }, totalDelta: { x: 20, y: 20 },
    },
    topology: null, response: { kind: 'signal_graph', signals: [] }, at: sequence,
  })
  await writeFile(fixture, [event('start', 1), event('update', 2), event('end', 3)].map(JSON.stringify).join('\n'))
  const result = await run(['replay', '--events', fixture, '--json'], { AOS_STATE_ROOT: path.join(root, 'no-daemon') })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).completedGestures, 1)
  await rm(root, { recursive: true, force: true })
})

test('scene tooling rejects missing machine mode and duplicate identity flags before IPC', async () => {
  for (const [args, code] of [
    [['list'], 'MISSING_ARG'],
    [['inspect', '--resource', 'one', '--resource', 'two', '--json'], 'DUPLICATE_FLAG'],
    [['devtools', 'close', '--json'], 'MISSING_ARG'],
    [['devtools', 'update', '--session', 'one', '--expected-revision', '1', '--json'], 'MISSING_ARG'],
    [['devtools', 'update', '--session', 'one', '--expected-revision', '1', '--recording', 'yes', '--json'], 'INVALID_DEVTOOLS_TOGGLE'],
    [['devtools', 'update', '--session', 'one', '--expected-revision', '1', '--query', 'x'.repeat(129), '--json'], 'INVALID_DEVTOOLS_FILTER'],
    [['devtools', 'transfer', '--session', 'one', '--expected-revision', '1', '--host-kind', 'browser', '--host-id', 'host', '--json'], 'INVALID_DEVTOOLS_HOST_KIND'],
    [['devtools', 'transfer', '--session', 'one', '--expected-revision', '1', '--host-kind', 'external', '--host-id', 'host/', '--json'], 'INVALID_DEVTOOLS_HOST'],
  ]) {
    const result = await run(args, { AOS_STATE_ROOT: path.join(os.tmpdir(), 'must-not-connect') })
    assert.equal(result.code, 1)
    assert.match(result.stderr, new RegExp(code, 'u'))
  }
})

test('scene tooling bounds daemon output before JSON parsing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-tools-oversized-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const server = net.createServer((socket) => socket.once('data', () => socket.write('x'.repeat(768 * 1024 + 1))))
  await new Promise((resolve, reject) => server.listen(path.join(state, 'sock'), resolve).once('error', reject))
  try {
    const result = await run(['list', '--json'], { AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' })
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /SCENE_DAEMON_LINE_TOO_LARGE/u)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('scene tooling rejects a correlated success response without canonical data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-tools-invalid-envelope-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const server = net.createServer((socket) => socket.once('data', (chunk) => {
    const request = JSON.parse(chunk.toString('utf8').trim())
    socket.write(`${JSON.stringify({ v: 1, ref: request.ref, status: 'success' })}\n`)
  }))
  await new Promise((resolve, reject) => server.listen(path.join(state, 'sock'), resolve).once('error', reject))
  try {
    const result = await run(['list', '--json'], { AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' })
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /INVALID_SCENE_DAEMON_RESPONSE/u)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

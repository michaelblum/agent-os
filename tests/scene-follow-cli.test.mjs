import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

async function collect(child) {
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { exit, stdout: () => stdout, stderr: () => stderr }
}

async function waitForFile(file, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { return await readFile(file, 'utf8') } catch (error) {
      if (error?.code !== 'ENOENT' || Date.now() >= deadline) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function waitForPIDExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { process.kill(pid, 0) } catch (error) {
      if (error?.code === 'ESRCH') return
      throw error
    }
    if (Date.now() >= deadline) throw new Error(`process ${pid} did not exit`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function stopChild(child, timeoutMs = 1_500) {
  if (!child || child.exitCode != null || child.signalCode != null) return
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGKILL')
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`process ${child.pid} did not stop`)), timeoutMs)),
  ])
}

function processCommandContains(pid, expected) {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(expected)
  } catch {
    return false
  }
}

test('scene follow forwards bounded operations and preserves owner identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-follow-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const socketPath = path.join(state, 'sock')
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
        socket.write(`${JSON.stringify({ v: 1, status: 'ok', operation: request.data.operation.op, ref: request.ref })}\n`)
      }
    })
  })
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject))
  const child = spawn(process.execPath, [
    'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'example.consumer',
    '--resource', 'companion/main', '--follow',
  ], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const output = await collect(child)
  child.stdin.end('{"op":"subscribe","events":["gesture"]}\n{"op":"inspect"}\n{"op":"unsubscribe","events":["gesture"]}\n{"op":"close"}\n')
  const result = await output.exit
  assert.equal(result.code, 0, output.stderr())
  assert.deepEqual(received.map(({ data }) => [data.owner, data.resource, data.operation.op]), [
    ['example.consumer', 'companion/main', 'subscribe'],
    ['example.consumer', 'companion/main', 'inspect'],
    ['example.consumer', 'companion/main', 'unsubscribe'],
    ['example.consumer', 'companion/main', 'close'],
  ])
  assert.match(output.stdout(), /"operation":"close"/u)
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

test('scene follow closes its input loop and socket on termination or owner loss', async () => {
  for (const scenario of ['signal', 'parent_loss']) {
    const root = await mkdtemp(path.join(os.tmpdir(), `aos-scene-follow-${scenario}-`))
    const state = path.join(root, 'repo')
    await mkdir(state, { recursive: true })
    const socketPath = path.join(state, 'sock')
    let acceptedSocket
    let child
    let acceptConnection
    const connected = new Promise((resolve) => { acceptConnection = resolve })
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      acceptedSocket = socket
      acceptConnection()
    })
    try {
      await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject))
      child = spawn(process.execPath, [
        'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'example.consumer',
        '--resource', 'companion/main', '--follow',
      ], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          AOS_STATE_ROOT: root,
          AOS_RUNTIME_MODE: 'repo',
          ...(scenario === 'parent_loss' ? { AOS_EXTERNAL_DISPATCH_PARENT_PID: '2147483647' } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const output = await collect(child)
      await Promise.race([
        connected,
        output.exit.then(({ code, signal }) => {
          throw new Error(`scene follow exited before ${scenario} connection: code=${code} signal=${signal}`)
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`scene follow did not connect for ${scenario}`)), 2_000)),
      ])
      const shutdownStartedAt = Date.now()
      if (scenario === 'signal') child.kill('SIGTERM')
      const result = await Promise.race([
        output.exit,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`scene follow did not terminate after ${scenario}`)), 2_000)),
      ])
      assert.equal(result.code, 143, `${scenario}: ${output.stderr()}`)
      assert.equal(result.signal, null, scenario)
      assert.ok(Date.now() - shutdownStartedAt >= 400, `${scenario}: half-open socket was not bounded before destruction`)
    } finally {
      await stopChild(child)
      acceptedSocket?.destroy()
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('scene follow preserves shutdown intent during managed daemon startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-follow-startup-shutdown-'))
  const fakeAOS = path.join(root, 'fake-aos.mjs')
  const startedPath = path.join(root, 'daemon-started')
  let child
  let daemonPID
  try {
    await writeFile(fakeAOS, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.AOS_FAKE_STARTED, String(process.pid))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
setInterval(() => {}, 1_000)
`)
    await chmod(fakeAOS, 0o755)
    child = spawn(process.execPath, [
      'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'example.consumer',
      '--resource', 'companion/main', '--follow',
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        AOS_STATE_ROOT: root,
        AOS_RUNTIME_MODE: 'repo',
        AOS_PATH: fakeAOS,
        AOS_ALLOW_DAEMON_AUTOSTART: '1',
        AOS_FAKE_STARTED: startedPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output = await collect(child)
    daemonPID = Number(await waitForFile(startedPath))
    assert.ok(Number.isInteger(daemonPID) && daemonPID > 1)
    child.kill('SIGTERM')
    const result = await Promise.race([
      output.exit,
      new Promise((_, reject) => setTimeout(() => reject(new Error('scene follow did not terminate during startup')), 3_000)),
    ])
    assert.equal(result.code, 143, output.stderr())
    assert.equal(result.signal, null)
    await waitForPIDExit(daemonPID)
    daemonPID = null
  } finally {
    await stopChild(child)
    if (Number.isInteger(daemonPID) && processCommandContains(daemonPID, fakeAOS)) {
      try { process.kill(daemonPID, 'SIGKILL') } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
      await waitForPIDExit(daemonPID)
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('scene follow preserves only an exact mount-scoped extension reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-follow-extension-'))
  const state = path.join(root, 'repo')
  await mkdir(state, { recursive: true })
  const socketPath = path.join(state, 'sock')
  const received = []
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(buffer.slice(0, newline))
      received.push(request.data.operation)
      socket.write(`${JSON.stringify({ v: 1, status: 'ok', operation: 'mount', ref: request.ref })}\n`)
    })
  })
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject))
  const child = spawn(process.execPath, [
    'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'io.ch-osctrl.sigil',
    '--resource', 'companion/main', '--follow',
  ], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const output = await collect(child)
  const extension = {
    ownerId: 'io.ch-osctrl.sigil',
    id: 'companion-renderer',
    digest: 'a'.repeat(64),
    sceneAbi: 'aos.scene.projection.v1',
    threeRevision: '183',
  }
  child.stdin.end(`${JSON.stringify({ op: 'mount', document: {}, extension })}\n`)
  const result = await output.exit
  assert.equal(result.code, 0, output.stderr())
  assert.deepEqual(received, [{ op: 'mount', document: {}, extension }])

  for (const operation of [
    { op: 'transact', extension },
    { op: 'mount', extension: { ...extension, sourcePath: '/private/extension.mjs' } },
  ]) {
    const rejected = spawn(process.execPath, [
      'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'io.ch-osctrl.sigil',
      '--resource', 'companion/main', '--follow',
    ], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' }, stdio: ['pipe', 'pipe', 'pipe'] })
    const rejection = await collect(rejected)
    rejected.stdin.end(`${JSON.stringify(operation)}\n`)
    const exit = await rejection.exit
    assert.equal(exit.code, 1)
    assert.match(rejection.stderr(), /SCENE_EXTENSION_REFERENCE_INVALID/u)
  }
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

test('scene follow rejects invalid stage before opening a socket', async () => {
  const child = spawn(process.execPath, ['scripts/aos-scene.mjs', '--stage', 'other', '--owner', 'example.consumer', '--resource', 'main', '--follow'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] })
  const output = await collect(child)
  const result = await output.exit
  assert.equal(result.code, 1)
  assert.match(output.stderr(), /INVALID_STAGE/u)
})

test('scene follow rejects noncanonical resource paths before opening a socket', async () => {
  const child = spawn(process.execPath, ['scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'example.consumer', '--resource', 'companion//main', '--follow'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] })
  const output = await collect(child)
  const result = await output.exit
  assert.equal(result.code, 1)
  assert.match(output.stderr(), /INVALID_RESOURCE/u)
})

test('scene follow rejects malformed, unterminated, and terminated oversized daemon output', async () => {
  for (const [label, reply, expected] of [
    ['malformed', '{not-json}\n', 'INVALID_SCENE_EVENT'],
    ['over-u', 'x'.repeat(64 * 1024 + 1), 'SCENE_EVENT_TOO_LARGE'],
    ['over-t', `${JSON.stringify({ payload: 'x'.repeat(64 * 1024) })}\n`, 'SCENE_EVENT_TOO_LARGE'],
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `aos-scene-follow-${label}-`))
    const state = path.join(root, 'repo')
    await mkdir(state, { recursive: true })
    const socketPath = path.join(state, 'sock')
    const server = net.createServer((socket) => socket.once('data', () => socket.write(reply)))
    await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject))
    const child = spawn(process.execPath, [
      'scripts/aos-scene.mjs', '--stage', 'desktop-world/main', '--owner', 'example.consumer',
      '--resource', 'companion/main', '--follow',
    ], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' }, stdio: ['pipe', 'pipe', 'pipe'] })
    const output = await collect(child)
    child.stdin.end('{"op":"inspect"}\n{"op":"close"}\n')
    const result = await output.exit
    assert.equal(result.code, 1, label)
    assert.equal(output.stdout(), '', label)
    assert.match(output.stderr(), new RegExp(expected, 'u'), label)
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('scene-follow keeps the full-display stage hidden until its manifest is ready', async () => {
  const source = await readFile(new URL('../src/daemon/desktop-world-scene-transport-controller.swift', import.meta.url), 'utf8')
  const start = source.indexOf('func ensureStage() -> DesktopWorldSceneBarrierTopology?')
  const end = source.indexOf('\n    func follow(', start)
  assert.notEqual(start, -1, 'ensureStage is missing')
  assert.notEqual(end, -1, 'follow boundary is missing')
  const body = source.slice(start, end)
  const create = body.indexOf('CanvasRequest(action: "create"')
  const hidden = body.indexOf('request.suspended = true')
  const configure = body.indexOf('scene.configureInitial(descriptor)')
  const ready = body.indexOf('scene.isReady(descriptor)')
  const resume = body.indexOf('action: "resume"', ready)

  assert.ok(create >= 0, 'scene stage create request is missing')
  assert.ok(hidden > create, 'scene stage must be born hidden')
  assert.ok(configure > hidden, 'scene stage readiness must bind the exact hidden topology')
  assert.ok(ready > configure, 'scene stage must require every configured segment')
  assert.ok(resume > ready, 'scene stage must resume only after exact-generation readiness')
  assert.match(body, /request\.surface = "desktop-world"/u)
  assert.doesNotMatch(body, /request\.track = "union"/u)
  assert.match(body, /return resumed \? topology : nil/u)
})

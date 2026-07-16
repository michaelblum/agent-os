import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
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
  child.stdin.end('{"op":"inspect"}\n{"op":"close"}\n')
  const result = await output.exit
  assert.equal(result.code, 0, output.stderr())
  assert.deepEqual(received.map(({ data }) => [data.owner, data.resource, data.operation.op]), [
    ['example.consumer', 'companion/main', 'inspect'],
    ['example.consumer', 'companion/main', 'close'],
  ])
  assert.match(output.stdout(), /"operation":"close"/u)
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

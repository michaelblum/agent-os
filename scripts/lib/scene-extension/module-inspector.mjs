import { spawn } from 'node:child_process'

import { failSceneExtension, SceneExtensionStoreError } from './errors.mjs'

const BODY_COMPILE_TIMEOUT_MS = 5_000
const COMPILER_CLOSE_TIMEOUT_MS = 500
const COMPILER_KILL_TIMEOUT_MS = 1_000

const COMPILER_SOURCE = String.raw`
const { SourceTextModule } = require('node:vm')

let pending = Buffer.alloc(0)
let expected = null

function respond(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}

function compile(source) {
  try {
    // Construction parses the exact ES-module source. It never links or evaluates it.
    new SourceTextModule(source, {
      identifier: 'aos-scene-extension:///validation/module.js',
    })
    respond({ ok: true })
  } catch {
    respond({ ok: false })
  }
}

process.stdin.on('data', (chunk) => {
  pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
  for (;;) {
    if (expected === null) {
      if (pending.length < 4) return
      expected = pending.readUInt32BE(0)
      pending = pending.subarray(4)
      if (expected === 0xffffffff) process.exit(0)
    }
    if (pending.length < expected) return
    const source = pending.subarray(0, expected).toString('utf8')
    pending = pending.subarray(expected)
    expected = null
    compile(source)
  }
})
`

function fail(code, message) {
  failSceneExtension(code, message)
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('SCENE_EXTENSION_BODY_ENCODING', 'Scene extension factory body must be valid UTF-8.')
  }
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function serializeSceneExtensionWrapperModule(manifest, bodySource) {
  return Buffer.from(`function createProjection(context) {\n${bodySource}\n}\nconst manifest = ${sortedJson(manifest)};\nObject.freeze(manifest.implementationIds);\nObject.freeze(manifest.budgets);\nObject.freeze(manifest);\nexport default Object.freeze({ manifest, createProjection });\n`)
}

class FactoryBodyCompiler {
  constructor() {
    this.buffer = ''
    this.pending = []
    this.closed = false
    this.child = spawn(process.execPath, [
      '--max-old-space-size=64',
      '--no-warnings',
      '--experimental-vm-modules',
      '-e',
      COMPILER_SOURCE,
    ], { stdio: ['pipe', 'pipe', 'ignore'] })
    this.termination = new Promise((resolve) => this.child.once('close', resolve))
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.child.once('error', () => this.#abort('SCENE_EXTENSION_BODY_COMPILATION'))
    this.child.once('exit', () => this.#failPending('SCENE_EXTENSION_BODY_COMPILATION'))
  }

  #error(code) {
    return new SceneExtensionStoreError(code, 'Scene extension factory-body compilation failed.')
  }

  #failPending(code) {
    this.closed = true
    for (const request of this.pending.splice(0)) {
      clearTimeout(request.timer)
      request.reject(this.#error(code))
    }
  }

  #abort(code) {
    if (this.closed) return
    this.#failPending(code)
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL')
  }

  async #waitForTermination(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.termination.then(() => finish(true))
    })
  }

  #onData(chunk) {
    if (this.closed) return
    this.buffer += chunk
    if (this.buffer.length > 16 * 1024) {
      this.#abort('SCENE_EXTENSION_BODY_COMPILATION')
      return
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const request = this.pending.shift()
      if (!request) {
        this.#abort('SCENE_EXTENSION_BODY_COMPILATION')
        return
      }
      clearTimeout(request.timer)
      try {
        request.resolve(JSON.parse(line))
      } catch {
        request.reject(this.#error('SCENE_EXTENSION_BODY_COMPILATION'))
      }
    }
  }

  compile(bytes, timeoutMs = BODY_COMPILE_TIMEOUT_MS) {
    if (this.closed || !this.child.stdin.writable) {
      return Promise.reject(this.#error('SCENE_EXTENSION_BODY_COMPILATION'))
    }
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, timer: null }
      request.timer = setTimeout(() => this.#abort('SCENE_EXTENSION_BODY_COMPILE_TIMEOUT'), timeoutMs)
      this.pending.push(request)
      const header = Buffer.allocUnsafe(4)
      header.writeUInt32BE(bytes.length)
      this.child.stdin.write(Buffer.concat([header, bytes]), (error) => {
        if (error) this.#abort('SCENE_EXTENSION_BODY_COMPILATION')
      })
    })
  }

  async close() {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      if (!this.closed && this.child.stdin.writable) {
        const shutdown = Buffer.allocUnsafe(4)
        shutdown.writeUInt32BE(0xffffffff)
        this.child.stdin.end(shutdown)
      } else {
        this.child.kill('SIGKILL')
      }
    }
    const graceful = await this.#waitForTermination(COMPILER_CLOSE_TIMEOUT_MS)
    if (!graceful && this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL')
    if (!graceful && !await this.#waitForTermination(COMPILER_KILL_TIMEOUT_MS)) {
      this.#failPending('SCENE_EXTENSION_BODY_COMPILATION')
      throw this.#error('SCENE_EXTENSION_BODY_COMPILATION')
    }
    this.closed = true
  }
}

export async function validateSceneExtensionFactoryBody(bytes, manifest, compiler, aggregate = null) {
  const source = decodeUtf8(bytes)
  if (source.includes('\0')) {
    fail('SCENE_EXTENSION_BODY_ENCODING', 'Scene extension factory body cannot contain NUL bytes.')
  }
  const timeoutMs = aggregate
    ? Math.max(1, Math.min(BODY_COMPILE_TIMEOUT_MS, aggregate.deadline - Date.now()))
    : BODY_COMPILE_TIMEOUT_MS
  if (timeoutMs <= 1 && aggregate && Date.now() >= aggregate.deadline) {
    fail('SCENE_EXTENSION_LIST_BUDGET', 'Scene extension listing reached its validation budget.')
  }
  const wrapper = serializeSceneExtensionWrapperModule(manifest, source)
  const result = await compiler.compile(wrapper, timeoutMs)
  if (!result?.ok) fail('SCENE_EXTENSION_BODY_SYNTAX', 'Scene extension factory body syntax is invalid.')
}

export async function withSceneExtensionFactoryBodyCompiler(callback) {
  const compiler = new FactoryBodyCompiler()
  try {
    return await callback(compiler)
  } finally {
    await compiler.close()
  }
}

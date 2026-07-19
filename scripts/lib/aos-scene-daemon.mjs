import { randomUUID } from 'node:crypto'

import { connectWithAutoStart, stopManagedDaemon } from './aos-daemon-client.mjs'

const MAX_LINE_BYTES = 768 * 1024
const MAX_PENDING_REQUESTS = 8
const DEFAULT_TIMEOUT_MS = 5_000

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function responseData(payload) {
  if (payload.v !== 1 || payload.status !== 'success'
      || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw fail('INVALID_SCENE_DAEMON_RESPONSE', 'DesktopWorld daemon returned an invalid success response.')
  }
  return payload.data
}

class BoundedLineReader {
  #buffer = Buffer.alloc(0)
  #onLine

  constructor(onLine) {
    this.#onLine = onLine
  }

  push(value) {
    let chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    while (chunk.length > 0) {
      const newline = chunk.indexOf(0x0a)
      if (newline < 0) {
        if (this.#buffer.length + chunk.length > MAX_LINE_BYTES) throw fail('SCENE_DAEMON_LINE_TOO_LARGE', 'DesktopWorld daemon response exceeded the line limit.')
        this.#buffer = this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, chunk], this.#buffer.length + chunk.length)
        return
      }
      const part = chunk.subarray(0, newline)
      if (this.#buffer.length + part.length > MAX_LINE_BYTES) throw fail('SCENE_DAEMON_LINE_TOO_LARGE', 'DesktopWorld daemon response exceeded the line limit.')
      const line = this.#buffer.length === 0 ? part : Buffer.concat([this.#buffer, part], this.#buffer.length + part.length)
      this.#buffer = Buffer.alloc(0)
      chunk = chunk.subarray(newline + 1)
      if (line.length > 0) this.#onLine(line.toString('utf8'))
    }
  }

  finish() {
    if (this.#buffer.length > 0) throw fail('SCENE_DAEMON_TRUNCATED', 'DesktopWorld daemon response ended mid-line.')
  }
}

export async function connectSceneDaemon({ signal = null, onEvent = () => {} } = {}) {
  const connection = await connectWithAutoStart({ managed: true, signal })
  const socket = connection?.socket
  if (!socket) throw fail('DAEMON_UNREACHABLE', 'Cannot connect to the AOS daemon.')
  const pending = new Map()
  let terminalError = null
  let closed = false
  let closePromise = null
  let resolveClosed
  const closedPromise = new Promise((resolve) => { resolveClosed = resolve })
  const onAbort = () => socket.end()

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const settleClosed = (error = null) => {
    if (closed) return
    closed = true
    terminalError = error
    signal?.removeEventListener('abort', onAbort)
    rejectPending(error ?? fail('SCENE_DAEMON_CLOSED', 'DesktopWorld daemon connection closed.'))
    resolveClosed(error)
  }
  const reader = new BoundedLineReader((line) => {
    let payload
    try { payload = JSON.parse(line) }
    catch { throw fail('INVALID_SCENE_DAEMON_RESPONSE', 'DesktopWorld daemon returned malformed JSON.') }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('INVALID_SCENE_DAEMON_RESPONSE', 'DesktopWorld daemon returned an invalid response.')
    if (typeof payload.event === 'string') {
      onEvent(payload, socket)
      return
    }
    const request = typeof payload.ref === 'string' ? pending.get(payload.ref) : null
    if (request) {
      pending.delete(payload.ref)
      clearTimeout(request.timer)
      if (typeof payload.code === 'string' && typeof payload.error === 'string') request.reject(fail(payload.code, payload.error))
      else {
        try { request.resolve(responseData(payload)) }
        catch (error) { request.reject(error) }
      }
      return
    }
    if (typeof payload.ref === 'string') return
    throw fail('INVALID_SCENE_DAEMON_RESPONSE', 'DesktopWorld daemon returned an uncorrelated response.')
  })

  socket.on('data', (chunk) => {
    try { reader.push(chunk) }
    catch (error) {
      settleClosed(error)
      socket.destroy()
    }
  })
  socket.once('error', () => settleClosed(fail('SCENE_DAEMON_IO_FAILED', 'DesktopWorld daemon I/O failed.')))
  socket.once('close', () => {
    if (!terminalError) {
      try { reader.finish() }
      catch (error) { terminalError = error }
    }
    settleClosed(terminalError)
  })
  signal?.addEventListener('abort', onAbort, { once: true })

  async function request({ service = 'scene', action, data = {} }, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (closed || socket.destroyed) throw terminalError ?? fail('SCENE_DAEMON_CLOSED', 'DesktopWorld daemon connection is closed.')
    if (pending.size >= MAX_PENDING_REQUESTS) throw fail('SCENE_REQUEST_BUDGET_EXCEEDED', 'DesktopWorld request budget exceeded.')
    const ref = randomUUID()
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(ref)
        reject(fail('SCENE_DAEMON_TIMEOUT', 'DesktopWorld daemon request timed out.'))
      }, timeoutMs)
      pending.set(ref, { resolve, reject, timer })
    })
    socket.write(`${JSON.stringify({ v: 1, service, action, data, ref })}\n`)
    return response
  }

  return Object.freeze({
    request,
    closed: closedPromise,
    close() {
      closePromise ??= (async () => {
        signal?.removeEventListener('abort', onAbort)
        if (!closed) {
          if (!socket.destroyed) {
            socket.end()
            let timer = null
            await Promise.race([
              closedPromise,
              new Promise((resolve) => {
                timer = setTimeout(resolve, 500)
                timer.unref?.()
              }),
            ])
            if (timer) clearTimeout(timer)
            if (!closed) socket.destroy()
          }
          await closedPromise
        }
        await stopManagedDaemon(connection.daemon)
      })()
      return closePromise
    },
  })
}

export function installSceneProcessLifecycle(abortController) {
  let requested = false
  const requestShutdown = () => {
    if (requested) return
    requested = true
    abortController.abort()
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
  return () => {
    if (parentMonitor) clearInterval(parentMonitor)
    process.off('SIGINT', requestShutdown)
    process.off('SIGTERM', requestShutdown)
  }
}

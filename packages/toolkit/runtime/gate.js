import { emit, wireBridge } from './bridge.js'

const pending = new Map()
let routerInstalled = false

function nextRequestId() {
  return 'gate-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

function installResponseRouter() {
  if (routerInstalled) {
    wireBridge()
    return
  }
  routerInstalled = true
  wireBridge((msg) => {
    if (msg?.type !== 'canvas.response') return
    const rid = msg.request_id
    const entry = pending.get(rid)
    if (!entry) return
    pending.delete(rid)
    clearTimeout(entry.timer)
    if (msg.status === 'ok') entry.resolve(msg.gate_submit ?? msg)
    else entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`))
  })
}

export function submitGateContinuation({
  continuationId,
  response,
  submittedBy,
  storeResponse = false,
  timeoutMs = 5000,
} = {}) {
  if (!continuationId) throw new Error('submitGateContinuation requires continuationId')
  installResponseRouter()
  const request_id = nextRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      reject(new Error(`TIMEOUT: gate.submit (${timeoutMs}ms)`))
    }, timeoutMs)
    pending.set(request_id, { timer, resolve, reject })
    emit('gate.submit', {
      request_id,
      continuation_id: continuationId,
      response,
      submitted_by: submittedBy,
      store_response: storeResponse === true,
    })
  })
}

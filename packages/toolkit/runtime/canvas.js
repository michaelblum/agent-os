// canvas.js — JS-side ergonomics over the canvas mutation API.
//
// spawnChild and removeSelf use request_id round-trips for ack; mutateSelf
// is fire-and-forget (matches daemon semantics from the 2026-04-11 spec).

import { emit, wireBridge } from './bridge.js'

const pending = new Map()  // request_id → { resolve, reject, timer }
let routerInstalled = false

function installResponseRouter() {
  if (routerInstalled) return
  routerInstalled = true
  wireBridge((msg) => {
    if (msg?.type !== 'canvas.response') return
    const rid = msg.request_id
    const entry = pending.get(rid)
    if (!entry) return
    pending.delete(rid)
    clearTimeout(entry.timer)
    if (msg.status === 'ok') entry.resolve({ id: msg.id })
    else entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`))
  })
}

function nextRequestId() {
  return 'r-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

function rpc(type, payload, timeoutMs = 5000) {
  installResponseRouter()
  const request_id = nextRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      reject(new Error(`TIMEOUT: ${type} (${timeoutMs}ms)`))
    }, timeoutMs)
    pending.set(request_id, { resolve, reject, timer })
    emit(type, { ...payload, request_id })
  })
}

export function spawnChild(opts) {
  // opts: { id, url, at: [x,y,w,h], interactive?: bool }
  return rpc('canvas.create', opts)
}

export function mutateSelf(opts) {
  // opts: { frame?: [x,y,w,h], interactive?: bool }
  // fire-and-forget; daemon defaults id to caller (this canvas) when omitted
  emit('canvas.update', opts)
}

export function removeSelf(opts = {}) {
  // opts: { orphan_children?: bool }
  return rpc('canvas.remove', opts)
}

export function setInteractive(interactive) {
  mutateSelf({ interactive: !!interactive })
}

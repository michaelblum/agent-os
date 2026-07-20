// input-region.js — canvas-side helpers for daemon-owned input regions and key leases.

import { emit, wireBridge } from './bridge.js'

const pending = new Map()
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
    if (msg.status === 'ok') entry.resolve(msg)
    else entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`))
  })
}

function nextRequestId() {
  return 'ir-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

function request(type, payload = {}, { timeoutMs = 5000 } = {}) {
  installResponseRouter()
  const request_id = nextRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      reject(new Error(`TIMEOUT: ${type} (${timeoutMs}ms)`))
    }, timeoutMs)
    pending.set(request_id, { timer, resolve, reject })
    emit(type, { ...payload, request_id })
  })
}

export function registerInputRegion(region) {
  return request('input_region.register', region)
}

export function updateInputRegion(region) {
  return request('input_region.update', region)
}

export function removeInputRegion(id) {
  return request('input_region.remove', { id })
}

export function registerInputKeyLease(lease) {
  return request('input_key_lease.register', lease)
}

export function inputRegionContainsRect(rect = {}) {
  return (point = {}) => {
    const x = Number(point.x)
    const y = Number(point.y)
    const rx = Number(rect.x)
    const ry = Number(rect.y)
    const w = Number(rect.w ?? rect.width)
    const h = Number(rect.h ?? rect.height)
    return Number.isFinite(x) && Number.isFinite(y)
      && Number.isFinite(rx) && Number.isFinite(ry)
      && Number.isFinite(w) && Number.isFinite(h)
      && x >= rx && y >= ry && x < rx + w && y < ry + h
  }
}

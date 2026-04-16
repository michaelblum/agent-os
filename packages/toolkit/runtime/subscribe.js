// subscribe.js — subscribe / unsubscribe to daemon event streams.
//
// Wraps the daemon's {type:'subscribe', payload:{events:[...]}} convention.
// Per-event handlers are attached via wireBridge — this just manages the
// daemon-side subscription set.

import { emit } from './bridge.js'

export function subscribe(events, options = {}) {
  const list = Array.isArray(events) ? events : [events]
  const payload = { events: list }
  if (options.snapshot !== undefined) payload.snapshot = !!options.snapshot
  emit('subscribe', payload)
}

export function unsubscribe(events) {
  const list = Array.isArray(events) ? events : [events]
  emit('unsubscribe', { events: list })
}

// subscribe.js — subscribe / unsubscribe to daemon event streams.
//
// Wraps the daemon's {type:'subscribe', payload:{events:[...]}} convention.
// Per-event handlers are attached via wireBridge — this just manages the
// daemon-side subscription set.

import { emit } from './bridge.js'

export function subscribe(events) {
  const list = Array.isArray(events) ? events : [events]
  emit('subscribe', { events: list })
}

export function unsubscribe(events) {
  const list = Array.isArray(events) ? events : [events]
  emit('unsubscribe', { events: list })
}

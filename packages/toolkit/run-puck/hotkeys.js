import { normalizeCanvasInputMessage } from '../runtime/input-events.js'

export const DEFAULT_HOTKEY_BINDINGS = Object.freeze({
  Space: { running: 'pause', paused: 'resume', stepping: 'step', blocked: 'resume', default: 'pause' },
  S: 'step',
  R: 'resume',
  T: { takeover: 'release', default: 'take_over' },
  Esc: 'pause',
  'Cmd+.': 'pause',
  'Shift+Esc': 'abort',
})

export function resolveHotkeyBindings(config = {}) {
  return {
    ...DEFAULT_HOTKEY_BINDINGS,
    ...(config.hotkeys ?? config),
  }
}

export function hotkeyStringFromEvent(rawEvent) {
  const event = normalizeCanvasInputMessage(rawEvent) ?? rawEvent
  if (!event || (event.type !== 'key_down' && event.event_kind !== 'key')) return null
  if (event.type === 'key_up') return null

  const logical = event.logical ?? event.key?.logical ?? event.key ?? ''
  const key = normalizeLogicalKey(logical)
  if (!key) return null

  const modifiers = event.modifiers ?? {}
  const parts = []
  if (modifiers.cmd) parts.push('Cmd')
  if (modifiers.ctrl) parts.push('Ctrl')
  if (modifiers.opt) parts.push('Opt')
  if (modifiers.shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function commandForHotkey(rawEvent, runState, config = {}) {
  const hotkey = hotkeyStringFromEvent(rawEvent)
  if (!hotkey) return null

  const bindings = resolveHotkeyBindings(config)
  const binding = bindings[hotkey]
  if (!binding) return null
  if (typeof binding === 'string') return binding
  if (binding && typeof binding === 'object') {
    return binding[runState] ?? binding.default ?? null
  }
  return null
}

export function runControlEventForHotkey(rawEvent, runState, options = {}) {
  const command = commandForHotkey(rawEvent, runState, options.bindings)
  if (!command) return null
  const now = options.clock?.() ?? new Date().toISOString()
  const eventId = options.idGenerator?.() ?? `run-control-hotkey-${Date.now()}`
  const event = {
    type: 'run.control',
    event_id: eventId,
    session_id: options.session_id ?? 'unknown',
    command,
    source: 'hotkey',
    at: now,
  }
  if (command === 'step') event.budget = 1
  return event
}

function normalizeLogicalKey(logical) {
  if (logical === ' ' || logical === 'Spacebar' || logical === 'Space') return 'Space'
  if (logical === 'Escape') return 'Esc'
  if (logical === '.') return '.'
  if (typeof logical !== 'string' || logical.length === 0) return null
  if (logical.length === 1) return logical.toUpperCase()
  return logical
}

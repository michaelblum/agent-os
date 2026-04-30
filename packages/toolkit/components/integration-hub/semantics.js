import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js'

const SURFACE = 'integration-hub'

function controlId(value, fallback = 'target') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '-')
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

export function integrationHubAosRef(id) {
  return `${SURFACE}:${controlId(id, 'unknown')}`
}

export function applyIntegrationHubSemanticTarget(element, target = {}, options = {}) {
  if (!element) return null
  const preservedText = options.preserveText ? element.textContent : null
  const normalized = applySemanticTargetAttributes(element, {
    id: target.id,
    role: target.role || 'AXButton',
    name: target.name,
    action: target.action,
    aosRef: target.aosRef || integrationHubAosRef(target.id),
    surface: SURFACE,
    enabled: target.enabled,
    current: target.current,
    selected: target.selected,
    value: target.value,
  }, {
    idPrefix: options.idPrefix === undefined ? SURFACE : options.idPrefix,
    visibleLabel: options.visibleLabel,
  })
  if (options.preserveText) element.textContent = preservedText
  return normalized
}

export function applyIntegrationHubSemantics(rootEl, state = {}) {
  if (!rootEl?.querySelector) return

  const input = rootEl.querySelector('#integration-hub-command')
  applyIntegrationHubSemanticTarget(input, {
    id: 'command-input',
    role: 'AXTextField',
    name: 'Integration command',
    action: 'edit_command',
    value: input?.value ?? state.simulateText,
  }, {
    idPrefix: null,
  })

  applyIntegrationHubSemanticTarget(rootEl.querySelector('.integration-hub-action'), {
    id: 'command-send',
    name: state.sending ? 'Sending command' : 'Send command',
    action: 'send_command',
  }, {
    preserveText: true,
  })

  applyIntegrationHubSemanticTarget(rootEl.querySelector('.integration-hub-refresh'), {
    id: 'refresh',
    name: 'Refresh',
    action: 'refresh_snapshot',
  }, {
    visibleLabel: true,
  })

  const panel = rootEl.querySelector('.integration-hub-grid')
  panel?.setAttribute?.('id', 'integration-hub-surface-panel')
  panel?.setAttribute?.('role', 'tabpanel')

  rootEl.querySelectorAll?.('.integration-hub-surface-tab').forEach((button) => {
    const surfaceId = controlId(button.dataset?.surface, 'surface')
    const label = text(button.textContent, surfaceId)
    const selected = surfaceId === state.activeSurface || button.classList?.contains?.('active') || false
    applyIntegrationHubSemanticTarget(button, {
      id: `surface-tab-${surfaceId}`,
      role: 'AXTab',
      name: label,
      action: 'select_surface',
      selected,
    }, {
      preserveText: true,
    })
    button.setAttribute?.('aria-controls', 'integration-hub-surface-panel')
  })
}

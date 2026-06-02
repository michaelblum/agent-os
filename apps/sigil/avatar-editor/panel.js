import {
  currentSigilRoot,
  currentToolkitRoot,
  toolkitSpecifier,
  toolkitUrl,
} from '../renderer/live-modules/content-roots.js'
import { createSigilAvatarCompactControlSurface } from './compact-surface.js'

const { mountPanel, Single } = await import(toolkitSpecifier('panel/index.js', {
  local: '../../../packages/toolkit/panel/index.js',
}))

function installStylesheet(href) {
  if (!href || document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

installStylesheet(toolkitUrl('panel/defaults.css'))

const params = new URLSearchParams(location.search || '')
const OWNER_CANVAS_ID = params.get('owner') || params.get('owner_canvas_id') || 'avatar-main'
const PANEL_ID = window.__aosCanvasId || params.get('id') || 'sigil-avatar-controls-avatar-main'

let surface = null
let hostElement = null
let activeTab = null
let lastViewModel = null

function post(type, payload) {
  window.webkit?.messageHandlers?.headsup?.postMessage({ type, payload })
}

function sendToOwner(message) {
  post('canvas.send', {
    target: OWNER_CANVAS_ID,
    message,
  })
}

function compactControls() {
  return surface?.getControlRecords?.() || []
}

function sendSnapshot(reason = 'snapshot') {
  sendToOwner({
    type: 'sigil.avatar_panel.snapshot',
    payload: {
      reason,
      panel_id: PANEL_ID,
      active_tab: surface?.getActiveTab?.() || activeTab,
      controls: compactControls(),
    },
  })
}

function renderSurface(payload = {}) {
  const viewModel = payload.view_model || payload.viewModel
  if (!viewModel || typeof viewModel !== 'object') return
  lastViewModel = viewModel
  activeTab = payload.active_tab || payload.activeTab || activeTab || undefined
  surface?.destroy?.()
  hostElement.replaceChildren()
  surface = createSigilAvatarCompactControlSurface(hostElement, viewModel, {
    document,
    defaultTab: activeTab,
    onControlChange(change = {}) {
      sendToOwner({
        type: 'sigil.avatar_panel.control_change',
        payload: {
          tab: change.tab,
          section: change.section,
          values: change.values || {},
          controls: change.section?.controls || [],
          avatar_id: change.avatar_id,
        },
      })
      queueMicrotask(() => sendSnapshot('control-change'))
    },
    onProjectionChange(change = {}) {
      sendToOwner({
        type: 'sigil.avatar_panel.projection_change',
        payload: {
          values: change.values || {},
          controls: change.controls || [],
          avatar_id: change.avatar_id,
        },
      })
      queueMicrotask(() => sendSnapshot('projection-change'))
    },
    onProjectionAction(action = {}) {
      sendToOwner({
        type: 'sigil.avatar_panel.projection_action',
        payload: action,
      })
    },
    onTabChange(tab = {}) {
      activeTab = tab.value || activeTab
      sendToOwner({
        type: 'sigil.avatar_panel.tab_change',
        payload: {
          value: activeTab,
          panel_id: PANEL_ID,
        },
      })
      queueMicrotask(() => sendSnapshot('tab-change'))
    },
  })
  activeTab = surface.getActiveTab?.() || activeTab
  sendSnapshot(payload.reason || 'update')
}

const content = {
  manifest: {
    name: 'sigil-avatar-controls-panel',
    title: 'Avatar',
    accepts: ['sigil.avatar_panel.update', 'lifecycle'],
    emits: ['canvas.send'],
    metadata: {
      sigil_root: currentSigilRoot(),
      toolkit_root: currentToolkitRoot(),
    },
  },
  render() {
    hostElement = document.createElement('section')
    hostElement.className = 'sigil-avatar-panel-host'
    const placeholder = document.createElement('div')
    placeholder.className = 'sigil-avatar-panel-placeholder'
    placeholder.textContent = 'Loading avatar controls'
    hostElement.appendChild(placeholder)
    return hostElement
  },
  onMessage(message = {}) {
    if (message.type === 'sigil.avatar_panel.update') {
      renderSurface(message.payload || message)
    }
    if (message.type === 'lifecycle' && message.action === 'resume' && lastViewModel) {
      renderSurface({ view_model: lastViewModel, active_tab: activeTab, reason: 'resume' })
    }
  },
}

mountPanel({
  title: 'Avatar',
  layout: Single(content),
  draggable: true,
  close: true,
  minimize: false,
  maximize: false,
  resizable: false,
  onClose() {
    sendToOwner({
      type: 'sigil.avatar_panel.close',
      payload: { panel_id: PANEL_ID },
    })
    post('canvas.remove', {})
  },
})

queueMicrotask(() => {
  sendToOwner({
    type: 'sigil.avatar_panel.ready',
    payload: {
      panel_id: PANEL_ID,
      owner_canvas_id: OWNER_CANVAS_ID,
    },
  })
})


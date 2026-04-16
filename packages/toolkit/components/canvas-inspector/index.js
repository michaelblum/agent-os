// canvas-inspector — Content factory for the toolkit's canvas debug panel.
//
// Renders the live list of canvases the daemon knows about plus a spatial
// minimap of displays + canvas overlays. Reacts to canvas_lifecycle events
// to stay current. Subscribes via the host's manifest.requires entry.

import { esc, emit } from '../../runtime/bridge.js'

const SELF_ID = 'canvas-inspector'

function normalizeDisplay(display = {}) {
  const bounds = display.bounds || {}
  const width = display.width ?? bounds.w ?? bounds.width ?? 0
  const height = display.height ?? bounds.h ?? bounds.height ?? 0
  return {
    ...display,
    id: display.id ?? display.ordinal ?? display.display_id ?? display.cgID,
    width,
    height,
    is_main: Boolean(display.is_main),
    bounds: {
      x: bounds.x ?? 0,
      y: bounds.y ?? 0,
      w: bounds.w ?? bounds.width ?? width,
      h: bounds.h ?? bounds.height ?? height,
    },
  }
}

export function normalizeDisplays(list) {
  return (list || []).map((display) => normalizeDisplay(display))
}

export function computeMinimapLayout(displays, list, mapW, { selfId = SELF_ID, border = 1, inset = 2 } = {}) {
  if (!displays || displays.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.w)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.h)
  }

  const totalW = maxX - minX
  const totalH = maxY - minY
  const contentW = Math.max(1, mapW - border * 2)
  const innerW = Math.max(1, contentW - inset * 2)
  const scale = innerW / totalW
  const contentH = Math.round(totalH * scale) + inset * 2
  const mapH = contentH + border * 2

  return {
    mapW,
    mapH,
    displays: displays.map((d) => ({
      display: d,
      x: inset + Math.round((d.bounds.x - minX) * scale),
      y: inset + Math.round((d.bounds.y - minY) * scale),
      w: Math.round(d.bounds.w * scale),
      h: Math.round(d.bounds.h * scale),
    })),
    canvases: (list || []).flatMap((c) => {
      if (!c.at || c.at.length < 4) return []
      const [cx, cy, cw, ch] = c.at
      return [{
        canvas: c,
        x: inset + Math.round((cx - minX) * scale),
        y: inset + Math.round((cy - minY) * scale),
        w: Math.max(2, Math.round(cw * scale)),
        h: Math.max(2, Math.round(ch * scale)),
        isSelf: c.id === selfId,
      }]
    }),
  }
}

export default function CanvasInspector() {
  let contentEl = null
  let displays = []
  let canvases = []
  let eventCount = 0
  let resizeObserver = null
  let lastMinimapWidth = 0

  function syncDebugState() {
    window.__canvasInspectorState = { displays, canvases, eventCount }
  }

  function rerender() {
    if (!contentEl) return
    contentEl.innerHTML = renderMinimap(canvases)
      + `<div class="canvas-list-region">${renderList(canvases)}</div>`
      + renderStatusBar()
    bindListEvents()
    syncDebugState()
  }

  function getMinimapWidth() {
    return Math.max(120, (contentEl?.clientWidth || 296) - 16)
  }

  function renderMinimap(list) {
    if (displays.length === 0) return ''

    const layout = computeMinimapLayout(displays, list, getMinimapWidth())
    if (!layout) return ''

    let html = `<div class="minimap" style="width:${layout.mapW}px;height:${layout.mapH}px">`
    for (const { display: d, x, y, w, h } of layout.displays) {
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`
      html += `<span class="minimap-display-label">${d.is_main ? '\u2605 ' : ''}${d.width}\u00d7${d.height}</span>`
      html += `</div>`
    }
    for (const { canvas: c, x, y, w, h, isSelf } of layout.canvases) {
      const cls = isSelf ? 'minimap-canvas self' : 'minimap-canvas'
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" title="${esc(c.id)}"></div>`
    }
    html += `</div>`
    return html
  }

  function renderList(list) {
    if (list.length === 0) {
      return '<div class="empty-state">No canvases active</div>'
    }
    let html = '<div class="canvas-list">'
    for (const c of list) {
      const cls = c.id === SELF_ID ? 'canvas-item self' : 'canvas-item'
      const [x, y, w, h] = c.at || [0, 0, 0, 0]
      const dims = `${Math.round(w)}\u00d7${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`
      html += `<div class="${cls}" data-id="${esc(c.id)}">`
      html += `<span class="canvas-id">${esc(c.id)}</span>`
      html += `<span class="canvas-dims">${dims}</span>`
      html += `<span class="canvas-flags">`
      if (c.interactive) html += `<span class="flag interactive">int</span>`
      if (c.scope === 'connection') html += `<span class="flag scoped">conn</span>`
      if (c.ttl != null) html += `<span class="flag">ttl:${Math.round(c.ttl)}s</span>`
      // Tint disabled in v1 — see issue #62 (daemon canvas.eval support).
      html += `<button class="btn disabled" disabled title="tint requires daemon canvas.eval (issue #62)">tint</button>`
      html += `<button class="btn remove-btn" data-id="${esc(c.id)}">\u2715</button>`
      html += `</span>`
      html += `</div>`
    }
    html += '</div>'
    return html
  }

  function renderStatusBar() {
    return `<div class="status-bar"><span class="event-count">${eventCount} events</span><span>live</span></div>`
  }

  function bindListEvents() {
    for (const btn of contentEl.querySelectorAll('.remove-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id
        // canvas.remove with explicit id — daemon allows cross-canvas remove
        // for CLI-origin canvases (rule 3 in the 2026-04-11 mutation API spec).
        emit('canvas.remove', { id })
      })
    }
  }

  function applyLifecycle(data) {
    const { canvas_id, action, at } = data
    if (action === 'created' || action === 'updated') {
      const existing = canvases.find(c => c.id === canvas_id)
      if (existing) {
        if (at) existing.at = at
      } else {
        canvases.push({ id: canvas_id, at: at || [0, 0, 0, 0], interactive: false })
      }
    } else if (action === 'removed') {
      canvases = canvases.filter(c => c.id !== canvas_id)
    }
  }

  return {
    manifest: {
      name: 'canvas-inspector',
      title: 'Canvas Inspector',
      accepts: ['bootstrap', 'canvas_lifecycle', 'display_geometry'],
      emits: [],
      channelPrefix: 'canvas-inspector',
      requires: ['canvas_lifecycle', 'display_geometry'],
      defaultSize: { w: 320, h: 480 },
    },

    render(host) {
      host.contentEl.style.overflow = 'hidden'
      contentEl = document.createElement('div')
      contentEl.className = 'canvas-inspector-body'
      contentEl.innerHTML = '<div class="empty-state">Waiting for canvases\u2026</div>'
      resizeObserver = new ResizeObserver(() => {
        const nextWidth = getMinimapWidth()
        if (nextWidth !== lastMinimapWidth) {
          lastMinimapWidth = nextWidth
          rerender()
        }
      })
      resizeObserver.observe(contentEl)
      window.__canvasInspectorMounted = true
      syncDebugState()
      return contentEl
    },

    onMessage(msg, _host) {
      if (msg.type === 'bootstrap') {
        const p = msg.payload || msg
        if (p.displays) displays = normalizeDisplays(p.displays)
        if (p.canvases) canvases = p.canvases
        rerender()
        return
      }
      if (msg.type === 'display_geometry') {
        const p = msg.payload || msg
        if (p.displays) displays = normalizeDisplays(p.displays)
        rerender()
        return
      }
      // canvas_lifecycle from the daemon arrives un-prefixed (the daemon
      // dispatches it directly via headsup.receive without a content prefix).
      // Router will broadcast it to onMessage with its original type.
      if (msg.type === 'canvas_lifecycle') {
        eventCount++
        applyLifecycle(msg.payload || msg.data || msg)
        rerender()
      }
    },
  }
}

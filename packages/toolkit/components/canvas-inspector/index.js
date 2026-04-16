// canvas-inspector — Content factory for the toolkit's canvas debug panel.
//
// Renders the live list of canvases the daemon knows about plus a spatial
// minimap of displays + canvas overlays. Reacts to canvas_lifecycle events
// to stay current. Subscribes via the host's manifest.requires entry.

import { esc, emit } from '../../runtime/bridge.js'

const SELF_ID = 'canvas-inspector'

export default function CanvasInspector() {
  let contentEl = null
  let displays = []
  let canvases = []
  let eventCount = 0

  function rerender() {
    if (!contentEl) return
    contentEl.innerHTML = renderMinimap(canvases) + renderList(canvases)
    bindListEvents()
  }

  function renderMinimap(list) {
    if (displays.length === 0) return ''

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const d of displays) {
      minX = Math.min(minX, d.bounds.x)
      minY = Math.min(minY, d.bounds.y)
      maxX = Math.max(maxX, d.bounds.x + d.bounds.w)
      maxY = Math.max(maxY, d.bounds.y + d.bounds.h)
    }
    const totalW = maxX - minX
    const totalH = maxY - minY
    const mapW = 280
    const scale = mapW / totalW
    const mapH = Math.round(totalH * scale)

    let html = `<div class="minimap" style="width:${mapW}px;height:${mapH}px">`
    for (const d of displays) {
      const x = Math.round((d.bounds.x - minX) * scale)
      const y = Math.round((d.bounds.y - minY) * scale)
      const w = Math.round(d.bounds.w * scale)
      const h = Math.round(d.bounds.h * scale)
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`
      html += `<span class="minimap-display-label">${d.is_main ? '\u2605 ' : ''}${d.width}\u00d7${d.height}</span>`
      html += `</div>`
    }
    for (const c of list) {
      if (!c.at || c.at.length < 4) continue
      const [cx, cy, cw, ch] = c.at
      const x = Math.round((cx - minX) * scale)
      const y = Math.round((cy - minY) * scale)
      const w = Math.max(2, Math.round(cw * scale))
      const h = Math.max(2, Math.round(ch * scale))
      const cls = c.id === SELF_ID ? 'minimap-canvas self' : 'minimap-canvas'
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" title="${esc(c.id)}"></div>`
    }
    html += `</div>`
    return html
  }

  function renderList(list) {
    if (list.length === 0) {
      return '<div class="empty-state">No canvases active</div>'
        + `<div class="status-bar"><span class="event-count">${eventCount} events</span><span>live</span></div>`
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
    html += `<div class="status-bar"><span class="event-count">${eventCount} events</span><span>live</span></div>`
    return html
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
      accepts: ['bootstrap', 'canvas_lifecycle'],
      emits: [],
      channelPrefix: 'canvas-inspector',
      requires: ['canvas_lifecycle'],
      defaultSize: { w: 320, h: 480 },
    },

    render(_host) {
      contentEl = document.createElement('div')
      contentEl.className = 'canvas-inspector-body'
      contentEl.innerHTML = '<div class="empty-state">Waiting for canvases\u2026</div>'
      return contentEl
    },

    onMessage(msg, _host) {
      if (msg.type === 'bootstrap') {
        const p = msg.payload || msg
        if (p.displays) displays = p.displays
        if (p.canvases) canvases = p.canvases
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

// canvas-inspector — Content factory for the toolkit's canvas debug panel.
//
// Renders the live list of canvases the daemon knows about plus a spatial
// minimap of displays + canvas overlays. Reacts to canvas_lifecycle events
// to stay current. Subscribes via the host's manifest.requires entry.
//
// Consumer-published object marks ride on canvas_object.marks — see
// packages/toolkit/components/canvas-inspector/marks/ and
// docs/superpowers/plans/2026-04-18-canvas-inspector-pivot.md.

import { esc, emit } from '../../runtime/bridge.js'
import { evalCanvas } from '../../runtime/canvas.js'
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js'
import { normalizeMarks } from './marks/normalize.js'
import { createMarksState, applySnapshot, evictCanvas } from './marks/reconcile.js'
import { createScheduler } from './marks/scheduler.js'
import { renderMinimapMark } from './marks/render.js'
import { computeInspectorTree } from './tree.js'

const SELF_ID = 'canvas-inspector'
const TINT_COLORS = [
  'rgba(80, 190, 255, 0.28)',
  'rgba(80, 255, 120, 0.26)',
  'rgba(255, 200, 60, 0.24)',
  'rgba(200, 80, 255, 0.24)',
  'rgba(255, 140, 60, 0.24)',
]
const TINT_OVERLAY_ID = '__aos_canvas_inspector_tint__'
const TREE_INDENT_PX = 12

function buildTintEvalScript(color) {
  const colorLiteral = color == null ? 'null' : JSON.stringify(color)
  return `(() => {
    const existing = document.getElementById(${JSON.stringify(TINT_OVERLAY_ID)})
    if (existing) existing.remove()
    const color = ${colorLiteral}
    if (!color) return true
    const overlay = document.createElement('div')
    overlay.id = ${JSON.stringify(TINT_OVERLAY_ID)}
    overlay.setAttribute('aria-hidden', 'true')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'background:' + color,
      'box-shadow:inset 0 0 0 4px ' + color,
      'outline:2px solid rgba(255,255,255,0.9)'
    ].join(';')
    ;(document.body || document.documentElement).appendChild(overlay)
    return true
  })()`
}

function normalizeDisplay(display = {}) {
  const bounds = display.bounds || {}
  const visible = display.visible_bounds || bounds
  const width = display.width ?? bounds.w ?? bounds.width ?? visible.w ?? visible.width ?? 0
  const height = display.height ?? bounds.h ?? bounds.height ?? visible.h ?? visible.height ?? 0
  return {
    ...display,
    id: display.id ?? display.ordinal ?? display.display_id ?? display.cgID,
    width,
    height,
    is_main: Boolean(display.is_main),
    bounds: {
      x: bounds.x ?? visible.x ?? 0,
      y: bounds.y ?? visible.y ?? 0,
      w: bounds.w ?? bounds.width ?? width,
      h: bounds.h ?? bounds.height ?? height,
    },
    visibleBounds: {
      x: visible.x ?? bounds.x ?? 0,
      y: visible.y ?? bounds.y ?? 0,
      w: visible.w ?? visible.width ?? width,
      h: visible.h ?? visible.height ?? height,
    },
  }
}

export function normalizeDisplays(list) {
  return (list || []).map((display) => normalizeDisplay(display))
}

export function computeMinimapLayout(displays, list, mapW, { selfId = SELF_ID, border = 1, inset = 2 } = {}) {
  if (!displays || displays.length === 0) return null
  const normalizedDisplays = normalizeDisplays(displays)
  const resolvedCanvases = resolveCanvasFrames(list)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of normalizedDisplays) {
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
    inset,
    minX,
    minY,
    scale,
    displays: normalizedDisplays.map((d) => ({
      display: d,
      x: inset + Math.round((d.bounds.x - minX) * scale),
      y: inset + Math.round((d.bounds.y - minY) * scale),
      w: Math.round(d.bounds.w * scale),
      h: Math.round(d.bounds.h * scale),
      visibleX: inset + Math.round((d.visibleBounds.x - minX) * scale),
      visibleY: inset + Math.round((d.visibleBounds.y - minY) * scale),
      visibleW: Math.max(1, Math.round(d.visibleBounds.w * scale)),
      visibleH: Math.max(1, Math.round(d.visibleBounds.h * scale)),
    })),
    canvases: resolvedCanvases.flatMap((c) => {
      const at = c.atResolved ?? c.at
      if (!at || at.length < 4) return []
      const [cx, cy, cw, ch] = at
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

export function projectPointToMinimap(layout, point) {
  if (!layout || !point) return null
  const x = Number(point.x)
  const y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    x: layout.inset + Math.round((x - layout.minX) * layout.scale),
    y: layout.inset + Math.round((y - layout.minY) * layout.scale),
  }
}

function resolveCanvasFrame(canvas, canvasById, resolving = new Set()) {
  const at = Array.isArray(canvas?.at) && canvas.at.length >= 4 ? canvas.at : null
  if (!at) return null
  if (!canvas?.parent) return at
  if (resolving.has(canvas.id)) return at
  const parent = canvasById.get(canvas.parent)
  if (!parent) return at
  resolving.add(canvas.id)
  const parentAt = resolveCanvasFrame(parent, canvasById, resolving)
  resolving.delete(canvas.id)
  if (!parentAt) return at
  return [
    at[0] - parentAt[0],
    at[1] - parentAt[1],
    at[2],
    at[3],
  ]
}

export function resolveCanvasFrames(list) {
  const canvases = list || []
  const canvasById = new Map(canvases.map((canvas) => [canvas.id, canvas]))
  return canvases.map((canvas) => ({
    ...canvas,
    atResolved: resolveCanvasFrame(canvas, canvasById),
  }))
}

export default function CanvasInspector() {
  let contentEl = null
  let displays = []
  let canvases = []
  let cursor = { x: 0, y: 0, valid: false }
  let tintedIds = new Set()
  let tintMap = new Map()
  let tintIndex = 0
  let eventCount = 0
  let resizeObserver = null
  let lastMinimapWidth = 0
  let lastTintError = null

  const marksState = createMarksState()
  const marksScheduler = createScheduler({
    state: marksState,
    onChange: () => rerender(),
  })

  function syncDebugState() {
    window.__canvasInspectorState = {
      displays,
      canvases,
      eventCount,
      tintedIds: [...tintedIds],
      tintMap: Object.fromEntries(tintMap),
      cursor,
      lastTintError,
      marksByCanvas: Object.fromEntries(
        [...marksState.marksByCanvas].map(([k, v]) => [k, v.marks]),
      ),
    }
  }

  async function applyTint(id, color) {
    await evalCanvas(id, buildTintEvalScript(color))
  }

  function rerender() {
    if (!contentEl) return
    contentEl.innerHTML = renderMinimap(canvases)
      + `<div class="canvas-list-region">${renderTree()}</div>`
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
    for (const { x, y, w, h, visibleX, visibleY, visibleW, visibleH } of layout.displays) {
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`
      html += `<div class="minimap-display-visible" style="left:${visibleX - x}px;top:${visibleY - y}px;width:${visibleW}px;height:${visibleH}px"></div>`
      html += `</div>`
    }
    for (const { canvas: c, x, y, w, h, isSelf } of layout.canvases) {
      const tint = tintMap.get(c.id)
      const cls = isSelf ? 'minimap-canvas self' : (tint ? 'minimap-canvas tinted' : 'minimap-canvas')
      const tintStyle = tint ? `background:${esc(tint)};border-color:${esc(tint)};` : ''
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${tintStyle}" title="${esc(c.id)}"></div>`
    }
    // Object marks: projected CG position, primitive composition at logical w/h.
    for (const [, entry] of marksState.marksByCanvas) {
      for (const m of entry.marks) {
        const projected = projectPointToMinimap(layout, { x: m.x, y: m.y })
        if (!projected) continue
        html += renderMinimapMark(m, projected)
      }
    }
    if (cursor?.valid) {
      const projectedCursor = projectPointToMinimap(layout, cursor)
      if (projectedCursor) {
        html += `<div class="minimap-cursor" style="left:${projectedCursor.x}px;top:${projectedCursor.y}px" title="cursor"></div>`
      }
    }
    html += `</div>`
    return html
  }

  function renderTree() {
    if (canvases.length === 0 && marksState.marksByCanvas.size === 0 && displays.length === 0) {
      return '<div class="empty-state">Waiting for canvases\u2026</div>'
    }
    const resolvedCanvases = resolveCanvasFrames(canvases)
    const tree = computeInspectorTree({
      displays: normalizeDisplays(displays),
      canvases: resolvedCanvases,
      marksByCanvas: marksState.marksByCanvas,
    })
    if (!tree || tree.type === 'empty') {
      return '<div class="empty-state">No canvases active</div>'
    }
    return `<div class="canvas-list">${renderTreeNode(tree, 0)}</div>`
  }

  function renderTreeNode(node, depth) {
    if (!node) return ''
    if (node.type === 'union' || node.type === 'display') {
      return renderLocationRow(node.label, depth)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'canvas') {
      return renderCanvasRow(node.canvas, depth)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'mark') {
      return renderMarkTreeRow(node.mark, depth)
    }
    return ''
  }

  function indentStyle(depth) {
    return `padding-left:${8 + depth * TREE_INDENT_PX}px`
  }

  function renderLocationRow(label, depth) {
    return `<div class="tree-row location" style="${indentStyle(depth)}">`
      + `<span class="location-label">${esc(label)}</span>`
      + `</div>`
  }

  function renderCanvasRow(c, depth) {
    const [x, y, w, h] = c.atResolved || c.at || [0, 0, 0, 0]
    const dims = `${Math.round(w)}\u00d7${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`
    const cls = c.id === SELF_ID ? 'tree-row canvas self' : 'tree-row canvas'
    let html = `<div class="${cls}" data-id="${esc(c.id)}" style="${indentStyle(depth)}">`
    html += `<span class="canvas-id">${esc(c.id)}</span>`
    html += `<span class="canvas-dims">${dims}</span>`
    html += `<span class="canvas-flags">`
    if (c.interactive) html += `<span class="flag interactive">int</span>`
    if (c.scope === 'connection') html += `<span class="flag scoped">conn</span>`
    if (c.ttl != null) html += `<span class="flag">ttl:${Math.round(c.ttl)}s</span>`
    const tintClass = tintedIds.has(c.id) ? 'btn tint-btn active' : 'btn tint-btn'
    html += `<button class="${tintClass}" data-id="${esc(c.id)}">tint</button>`
    html += `<button class="btn remove-btn" data-id="${esc(c.id)}">\u2715</button>`
    html += `</span></div>`
    return html
  }

  function renderMarkTreeRow(mark, depth) {
    return `<div class="tree-row mark" data-mark-id="${esc(mark.id)}" style="${indentStyle(depth)}">`
      + `<span class="mark-name" style="color:${esc(mark.color)}">${esc(mark.name)}</span>`
      + `</div>`
  }

  function renderStatusBar() {
    const detail = lastTintError ? `tint error: ${esc(lastTintError.id)}` : 'live'
    return `<div class="status-bar"><span class="event-count">${eventCount} events</span><span>${detail}</span></div>`
  }

  function bindListEvents() {
    for (const btn of contentEl.querySelectorAll('.tint-btn')) {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id
        const wasTinted = tintedIds.has(id)
        const priorColor = tintMap.get(id) || null
        let color = null
        if (wasTinted) {
          tintedIds.delete(id)
          tintMap.delete(id)
        } else {
          color = TINT_COLORS[tintIndex % TINT_COLORS.length]
          tintIndex++
          tintedIds.add(id)
          tintMap.set(id, color)
        }
        lastTintError = null
        rerender()
        try {
          await applyTint(id, color)
        } catch (error) {
          if (wasTinted) {
            tintedIds.add(id)
            if (priorColor) tintMap.set(id, priorColor)
          } else {
            tintIndex = Math.max(0, tintIndex - 1)
            tintedIds.delete(id)
            tintMap.delete(id)
          }
          lastTintError = { id, error: String(error), at: Date.now() }
          rerender()
          console.error('[canvas-inspector] tint failed', id, error)
        }
      })
    }
    for (const btn of contentEl.querySelectorAll('.remove-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id
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
      tintedIds.delete(canvas_id)
      tintMap.delete(canvas_id)
      evictCanvas(marksState, canvas_id)
    }
  }

  return {
    manifest: {
      name: 'canvas-inspector',
      title: 'Canvas Inspector',
      accepts: ['bootstrap', 'canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      emits: [],
      channelPrefix: 'canvas-inspector',
      requires: ['canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      defaultSize: { w: 320, h: 480 },
    },

    render(host) {
      host.contentEl.style.overflow = 'hidden'
      contentEl = document.createElement('div')
      contentEl.className = 'canvas-inspector-body'
      contentEl.innerHTML = '<div class="empty-state">Waiting for canvases\u2026</div>'
      window.__canvasInspectorDebug = {
        tintCanvas(id, color = TINT_COLORS[0]) {
          return applyTint(id, color)
        },
      }
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
        if (p.cursor && typeof p.cursor.x === 'number' && typeof p.cursor.y === 'number') {
          cursor = { x: p.cursor.x, y: p.cursor.y, valid: true }
        }
        rerender()
        return
      }
      if (msg.type === 'display_geometry') {
        const p = msg.payload || msg
        if (p.displays) displays = normalizeDisplays(p.displays)
        rerender()
        return
      }
      const input = normalizeCanvasInputMessage(msg)
      if (input) {
        if (typeof input.x === 'number' && typeof input.y === 'number') {
          cursor = { x: input.x, y: input.y, valid: true }
          rerender()
        }
        return
      }
      if (msg.type === 'canvas_lifecycle') {
        eventCount++
        applyLifecycle(msg.payload || msg.data || msg)
        rerender()
        return
      }
      if (msg.type === 'canvas_object.marks') {
        const p = msg.payload || msg
        const canvasId = p.canvas_id
        if (!canvasId || typeof canvasId !== 'string') return
        eventCount++
        const normalized = normalizeMarks(canvasId, p.objects || [])
        applySnapshot(marksState, canvasId, normalized, Date.now())
        if (marksState.marksByCanvas.size > 0) marksScheduler.start()
        rerender()
      }
    },
  }
}

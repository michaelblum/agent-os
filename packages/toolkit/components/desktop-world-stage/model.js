// model.js — pure state model for the shared DesktopWorld visual stage.
//
// The stage is intentionally passive: consumers register/update/remove
// non-interactive visual layers, and the surface renders them click-through.

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function cssNumber(value) {
  return `${Math.round(finiteNumber(value, 0))}px`
}

function cssColor(value, fallback) {
  const raw = text(value, fallback)
  return /^[#(),.%\w\s-]+$/.test(raw) ? raw : fallback
}

function frameFromLayer(layer = {}) {
  const frame = layer.frame || layer.rect || layer.bounds
  if (Array.isArray(frame)) {
    return [
      finiteNumber(frame[0], 0),
      finiteNumber(frame[1], 0),
      Math.max(1, finiteNumber(frame[2], 1)),
      Math.max(1, finiteNumber(frame[3], 1)),
    ]
  }
  if (frame && typeof frame === 'object') {
    return [
      finiteNumber(frame.x ?? frame.left, 0),
      finiteNumber(frame.y ?? frame.top, 0),
      Math.max(1, finiteNumber(frame.w ?? frame.width, 1)),
      Math.max(1, finiteNumber(frame.h ?? frame.height, 1)),
    ]
  }
  return [0, 0, 1, 1]
}

function normalizeStyle(style = {}) {
  return {
    color: cssColor(style.color, 'rgba(122, 241, 255, 0.95)'),
    fill: cssColor(style.fill, 'rgba(122, 241, 255, 0.08)'),
    opacity: Math.max(0, Math.min(1, finiteNumber(style.opacity, 1))),
    strokeWidth: Math.max(1, finiteNumber(style.strokeWidth ?? style.stroke_width, 2)),
  }
}

export function normalizeStageLayer(input = {}) {
  const id = text(input.id)
  if (!id) return null
  return {
    id,
    kind: text(input.kind, 'outline'),
    label: text(input.label || input.title),
    frame: frameFromLayer(input),
    visible: input.visible !== false,
    zIndex: Math.round(finiteNumber(input.zIndex ?? input.z_index, 0)),
    style: normalizeStyle(input.style),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  }
}

export function createDesktopWorldStageState({ layers = [] } = {}) {
  const state = {
    layers: new Map(),
    version: 0,
  }
  for (const layer of layers) {
    const normalized = normalizeStageLayer(layer)
    if (normalized) state.layers.set(normalized.id, normalized)
  }
  return state
}

export function stageLayerList(state) {
  return [...(state?.layers?.values?.() || [])]
    .filter((layer) => layer.visible)
    .sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
      return a.id.localeCompare(b.id)
    })
}

export function applyDesktopWorldStageMessage(state, message = {}) {
  const type = message.type || message.event
  const payload = message.payload || message.data || message
  if (!state?.layers || !type) return false

  if (type === 'desktop_world_stage.layer.upsert') {
    const layer = normalizeStageLayer(payload)
    if (!layer) return false
    state.layers.set(layer.id, layer)
    state.version += 1
    return true
  }

  if (type === 'desktop_world_stage.layer.remove') {
    const id = text(payload.id)
    if (!id || !state.layers.delete(id)) return false
    state.version += 1
    return true
  }

  if (type === 'desktop_world_stage.layers.replace') {
    state.layers.clear()
    for (const layer of payload.layers || []) {
      const normalized = normalizeStageLayer(layer)
      if (normalized) state.layers.set(normalized.id, normalized)
    }
    state.version += 1
    return true
  }

  if (type === 'desktop_world_stage.clear') {
    if (state.layers.size === 0) return false
    state.layers.clear()
    state.version += 1
    return true
  }

  return false
}

export function renderDesktopWorldStageLayers(state) {
  return stageLayerList(state).map((layer) => {
    const [x, y, w, h] = layer.frame
    const style = [
      `left:${cssNumber(x)}`,
      `top:${cssNumber(y)}`,
      `width:${cssNumber(w)}`,
      `height:${cssNumber(h)}`,
      `z-index:${layer.zIndex}`,
      `--stage-color:${esc(layer.style.color)}`,
      `--stage-fill:${esc(layer.style.fill)}`,
      `--stage-opacity:${layer.style.opacity}`,
      `--stage-stroke-width:${layer.style.strokeWidth}px`,
    ].join(';')
    const label = layer.label
      ? `<span class="desktop-world-stage-label">${esc(layer.label)}</span>`
      : ''
    return (
      `<div class="desktop-world-stage-layer desktop-world-stage-${esc(layer.kind)}" `
      + `data-layer-id="${esc(layer.id)}" style="${style}">`
      + label
      + '</div>'
    )
  }).join('')
}

export function desktopWorldStageSnapshot(state) {
  return {
    version: state?.version || 0,
    layers: stageLayerList(state).map((layer) => ({ ...layer, frame: [...layer.frame] })),
  }
}

// Shared helpers for the wiki-kb toolkit component.

const NODE_COLORS = Object.freeze({
  entity: '#8ab4ff',
  concept: '#6a9966',
  plugin: '#ddaa66',
})

const SAFE_PROTOCOLS = new Set(['aos:', 'http:', 'https:', 'mailto:'])

function normalizeId(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text || null
  }
  return null
}

function normalizeText(value) {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = new Set()
  const normalized = []
  for (const tag of tags) {
    const text = normalizeText(tag)
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
  }
  return normalized
}

function extractNodeRaw(node) {
  const candidates = [node?.raw, node?.markdown, node?.content, node?.body, node?.source]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return ''
}

function normalizeNodesInput(nodes = []) {
  const normalizedNodes = []
  const rawById = {}
  const nodeMap = new Map()

  for (const candidate of nodes) {
    const id = normalizeId(candidate?.id ?? candidate?.name ?? candidate?.title)
    if (!id || nodeMap.has(id)) continue

    const node = {
      id,
      name: normalizeText(candidate?.name ?? candidate?.title ?? id) || id,
      type: normalizeText(candidate?.type) || 'concept',
      description: normalizeText(candidate?.description ?? candidate?.summary),
      tags: normalizeTags(candidate?.tags),
    }

    normalizedNodes.push(node)
    nodeMap.set(id, node)

    const raw = extractNodeRaw(candidate)
    if (raw) rawById[id] = raw
  }

  return { nodes: normalizedNodes, rawById, nodeMap }
}

function resolveEndpoint(value) {
  if (value && typeof value === 'object') {
    return normalizeId(value.id ?? value.name ?? value.title)
  }
  return normalizeId(value)
}

export function linkKey(link) {
  const pair = [link.source, link.target].sort()
  return `${pair[0]}\u0000${pair[1]}`
}

function normalizeLinksInput(links = [], validNodes = null) {
  const normalizedLinks = []
  const seen = new Set()

  for (const candidate of links) {
    const source = resolveEndpoint(candidate?.source ?? candidate?.from)
    const target = resolveEndpoint(candidate?.target ?? candidate?.to)
    if (!source || !target || source === target) continue
    if (validNodes && (!validNodes.has(source) || !validNodes.has(target))) continue

    const link = { source, target }
    const key = linkKey(link)
    if (seen.has(key)) continue
    seen.add(key)
    normalizedLinks.push(link)
  }

  return normalizedLinks
}

export function normalizeGraphPayload(payload = {}) {
  const { nodes, rawById, nodeMap } = normalizeNodesInput(payload.nodes)
  const links = normalizeLinksInput(payload.links, nodeMap)
  const raw = {}

  if (payload.raw && typeof payload.raw === 'object' && !Array.isArray(payload.raw)) {
    for (const [candidateId, value] of Object.entries(payload.raw)) {
      const id = normalizeId(candidateId)
      if (!id || !nodeMap.has(id) || value == null) continue
      raw[id] = String(value)
    }
  }

  for (const node of nodes) {
    if (!(node.id in raw) && rawById[node.id]) {
      raw[node.id] = rawById[node.id]
    }
  }

  return { nodes, links, raw }
}

export function applyGraphUpdate(state, payload = {}) {
  if (payload.replace === true) return normalizeGraphPayload(payload)

  const nodeMap = new Map(state.nodes.map((node) => [node.id, node]))
  let raw = { ...state.raw }

  if (payload.clearRaw === true) raw = {}

  if (Array.isArray(payload.nodes)) {
    const { nodes, rawById } = normalizeNodesInput(payload.nodes)
    for (const node of nodes) nodeMap.set(node.id, node)
    for (const [id, value] of Object.entries(rawById)) raw[id] = value
  }

  if (payload.raw && typeof payload.raw === 'object' && !Array.isArray(payload.raw)) {
    for (const [candidateId, value] of Object.entries(payload.raw)) {
      const id = normalizeId(candidateId)
      if (!id || !nodeMap.has(id)) continue
      if (value == null) delete raw[id]
      else raw[id] = String(value)
    }
  }

  const removedNodeIds = new Set()
  for (const candidateId of Array.isArray(payload.removeNodes) ? payload.removeNodes : []) {
    const id = normalizeId(candidateId)
    if (!id) continue
    removedNodeIds.add(id)
    nodeMap.delete(id)
    delete raw[id]
  }

  for (const candidateId of Array.isArray(payload.removeRaw) ? payload.removeRaw : []) {
    const id = normalizeId(candidateId)
    if (id) delete raw[id]
  }

  const nextNodes = [...nodeMap.values()]
  const nextNodeIds = new Set(nextNodes.map((node) => node.id))

  let linkMap = new Map()
  if (payload.replaceLinks !== true) {
    for (const link of state.links) {
      if (!nextNodeIds.has(link.source) || !nextNodeIds.has(link.target)) continue
      if (removedNodeIds.has(link.source) || removedNodeIds.has(link.target)) continue
      linkMap.set(linkKey(link), link)
    }
  }

  if (Array.isArray(payload.links)) {
    const links = normalizeLinksInput(payload.links, nextNodeIds)
    for (const link of links) linkMap.set(linkKey(link), link)
  }

  if (Array.isArray(payload.removeLinks)) {
    for (const link of normalizeLinksInput(payload.removeLinks)) {
      linkMap.delete(linkKey(link))
    }
  }

  const nextRaw = {}
  for (const node of nextNodes) {
    if (Object.prototype.hasOwnProperty.call(raw, node.id)) {
      nextRaw[node.id] = raw[node.id]
    }
  }

  return {
    nodes: nextNodes,
    links: [...linkMap.values()],
    raw: nextRaw,
  }
}

export function buildAdjacency(nodes, links) {
  const adjacency = Object.create(null)
  for (const node of nodes) adjacency[node.id] = []
  for (const link of links) {
    if (adjacency[link.source]) adjacency[link.source].push(link.target)
    if (adjacency[link.target]) adjacency[link.target].push(link.source)
  }
  return adjacency
}

export function pickPrimaryNodeId(nodes, adjacency) {
  let bestNode = null
  let bestDegree = -1

  for (const node of nodes) {
    const degree = (adjacency[node.id] || []).length
    if (degree > bestDegree) {
      bestNode = node
      bestDegree = degree
    }
  }

  return bestNode?.id || null
}

export function nodeColor(type) {
  return NODE_COLORS[type] || '#666680'
}

export function nodeRadius(node, { root = false } = {}) {
  if (root) return 10
  const tagCount = Array.isArray(node?.tags) ? node.tags.length : 0
  return 5 + Math.min(tagCount, 4) * 1.2
}

export function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escAttribute(value) {
  return escHtml(value)
}

export function safeExternalHref(rawHref) {
  const href = String(rawHref ?? '').trim()
  if (!href) return ''
  if (href.startsWith('#') || href.startsWith('/')) return href

  try {
    const parsed = new URL(href, 'https://example.invalid')
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      return SAFE_PROTOCOLS.has(parsed.protocol) ? href : ''
    }
  } catch {
    return ''
  }

  return ''
}

function replaceMarkdownLinks(content, token) {
  let output = ''

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '[') {
      output += content[index]
      continue
    }

    const labelEnd = content.indexOf(']', index + 1)
    if (labelEnd < 0 || content[labelEnd + 1] !== '(') {
      output += content[index]
      continue
    }

    let depth = 0
    let hrefEnd = -1
    for (let cursor = labelEnd + 2; cursor < content.length; cursor += 1) {
      const char = content[cursor]
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) {
          hrefEnd = cursor
          break
        }
        depth -= 1
      }
    }

    if (hrefEnd < 0) {
      output += content[index]
      continue
    }

    const label = content.slice(index + 1, labelEnd)
    const href = content.slice(labelEnd + 2, hrefEnd)
    const safeHref = safeExternalHref(href)
    if (!safeHref) output += token(escHtml(label))
    else {
      output += token(
        `<a href="${escAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`
      )
    }
    index = hrefEnd
  }

  return output
}

function renderInline(text) {
  const tokens = []
  const token = (html) => {
    const marker = `@@TOKEN_${tokens.length}@@`
    tokens.push(html)
    return marker
  }

  let content = String(text ?? '')
  content = content.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escHtml(code)}</code>`))
  content = replaceMarkdownLinks(content, token)

  let html = escHtml(content)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  return html.replace(/@@TOKEN_(\d+)@@/g, (_, index) => tokens[Number(index)] || '')
}

export function renderMarkdown(source) {
  if (!source) return ''

  const lines = String(source).split('\n')
  let html = ''
  let listTag = null

  function closeList() {
    if (listTag) {
      html += `</${listTag}>`
      listTag = null
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (index === 0 && line.trim() === '---') {
      index += 1
      while (index < lines.length && lines[index].trim() !== '---') index += 1
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/)
    if (heading) {
      closeList()
      const depth = heading[1].length
      html += `<h${depth}>${renderInline(heading[2])}</h${depth}>`
      continue
    }

    if (/^---+$/.test(line.trim())) {
      closeList()
      html += '<hr>'
      continue
    }

    const unordered = line.match(/^[-*]\s+(.+)/)
    if (unordered) {
      if (listTag !== 'ul') {
        closeList()
        html += '<ul>'
        listTag = 'ul'
      }
      html += `<li>${renderInline(unordered[1])}</li>`
      continue
    }

    const ordered = line.match(/^\d+\.\s+(.+)/)
    if (ordered) {
      if (listTag !== 'ol') {
        closeList()
        html += '<ol>'
        listTag = 'ol'
      }
      html += `<li>${renderInline(ordered[1])}</li>`
      continue
    }

    if (line.trim() === '') {
      closeList()
      continue
    }

    closeList()
    html += `<p>${renderInline(line)}</p>`
  }

  closeList()
  return html
}

export function resizeCanvasToContainer(canvas, container) {
  const width = Math.max(1, container?.clientWidth || 1)
  const height = Math.max(1, container?.clientHeight || 1)
  const ratio = Math.max(1, Number(globalThis.devicePixelRatio) || 1)
  const targetWidth = Math.round(width * ratio)
  const targetHeight = Math.round(height * ratio)

  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight

  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { width, height, ctx }
}

export function createViewport({ minZoom = 0.2, maxZoom = 4 } = {}) {
  const state = { panX: 0, panY: 0, zoom: 1 }

  return {
    state,

    apply(ctx) {
      ctx.translate(state.panX, state.panY)
      ctx.scale(state.zoom, state.zoom)
    },

    clientToWorld(canvas, clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (clientX - rect.left - state.panX) / state.zoom,
        y: (clientY - rect.top - state.panY) / state.zoom,
      }
    },

    zoomAt(canvas, clientX, clientY, scaleFactor) {
      const rect = canvas.getBoundingClientRect()
      const offsetX = clientX - rect.left
      const offsetY = clientY - rect.top
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, state.zoom * scaleFactor))
      state.panX = offsetX - (offsetX - state.panX) * (nextZoom / state.zoom)
      state.panY = offsetY - (offsetY - state.panY) * (nextZoom / state.zoom)
      state.zoom = nextZoom
    },

    centerOn(width, height, x, y) {
      state.panX = width / 2 - x * state.zoom
      state.panY = height / 2 - y * state.zoom
    },

    reset() {
      state.panX = 0
      state.panY = 0
      state.zoom = 1
    },
  }
}

export function drawEmptyState(ctx, width, height, message, detail = '') {
  ctx.save()
  ctx.fillStyle = 'rgba(18, 18, 28, 0.95)'
  ctx.fillRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#999'
  ctx.font = '500 12px "SF Mono","Menlo",monospace'
  ctx.fillText(message, width / 2, height / 2 - 6)
  if (detail) {
    ctx.fillStyle = '#666'
    ctx.font = '400 10px "SF Mono","Menlo",monospace'
    ctx.fillText(detail, width / 2, height / 2 + 12)
  }
  ctx.restore()
}

// Radial mind map view for wiki-kb.

import {
  buildAdjacency,
  createViewport,
  drawEmptyState,
  nodeColor,
  nodeRadius,
  pickPrimaryNodeId,
  resizeCanvasToContainer,
} from './shared.js'

const COLORS = {
  edge: 'rgba(100, 100, 160, 0.28)',
  edgeHighlight: 'rgba(138, 180, 255, 0.65)',
  nodeFill: 'rgba(18, 18, 28, 0.9)',
  label: '#999',
  labelHighlight: '#e0e0e0',
}

function radialLayout(rootId, nodeMap, adjacency, width, height) {
  const centerX = width / 2
  const centerY = height / 2
  const ringGap = 90
  const placed = new Map()
  const visited = new Set([rootId])
  const rings = [[rootId]]
  let frontier = [rootId]

  while (frontier.length > 0 && rings.length < 7) {
    const next = []
    for (const id of frontier) {
      for (const neighborId of adjacency[id] || []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        next.push(neighborId)
      }
    }
    if (next.length === 0) break
    rings.push(next)
    frontier = next
  }

  placed.set(rootId, { node: nodeMap[rootId], x: centerX, y: centerY, ring: 0 })

  for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
    const ids = rings[ringIndex]
    const radius = ringIndex * ringGap
    const parentGroups = Object.create(null)

    for (const id of ids) {
      const parentId = (adjacency[id] || []).find((candidateId) => placed.get(candidateId)?.ring === ringIndex - 1) || rootId
      if (!parentGroups[parentId]) parentGroups[parentId] = []
      parentGroups[parentId].push(id)
    }

    for (const [parentId, children] of Object.entries(parentGroups)) {
      const parent = placed.get(parentId)
      const baseAngle = parentId === rootId ? 0 : Math.atan2(parent.y - centerY, parent.x - centerX)
      const spread = Math.min(Math.PI * 1.6, (Math.PI * 2) / Math.max(1, Object.keys(parentGroups).length))
      const step = children.length > 1 ? spread / (children.length - 1) : 0

      children.forEach((id, childIndex) => {
        const angle = baseAngle - spread / 2 + childIndex * step
        placed.set(id, {
          node: nodeMap[id],
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          ring: ringIndex,
        })
      })
    }
  }

  return placed
}

export default function MindmapView({ onSelectNode }) {
  let rootEl = null
  let canvas = null
  let ctx = null
  let resizeObserver = null
  let size = { width: 1, height: 1 }
  let nodes = []
  let links = []
  let nodeMap = Object.create(null)
  let adjacency = Object.create(null)
  let layout = new Map()
  let rootId = null
  let selectedNodeId = null
  let hoveredNodeId = null
  let pointerDown = null
  const viewport = createViewport()

  function rebuildLayout() {
    if (!rootId || !nodeMap[rootId]) {
      layout = new Map()
      draw()
      return
    }
    layout = radialLayout(rootId, nodeMap, adjacency, size.width, size.height)
    draw()
  }

  function nodeAt(x, y) {
    for (const [id, entry] of layout.entries()) {
      const radius = nodeRadius(entry.node, { root: id === rootId })
      const dx = entry.x - x
      const dy = entry.y - y
      if (dx * dx + dy * dy <= (radius + 5) * (radius + 5)) return entry.node
    }
    return null
  }

  function draw() {
    if (!ctx) return
    ctx.clearRect(0, 0, size.width, size.height)

    if (layout.size === 0) {
      drawEmptyState(ctx, size.width, size.height, 'Waiting for graph data', 'Send wiki-kb/graph to populate this view.')
      return
    }

    ctx.save()
    viewport.apply(ctx)

    for (const link of links) {
      const source = layout.get(link.source)
      const target = layout.get(link.target)
      if (!source || !target) continue
      const highlighted = selectedNodeId && (link.source === selectedNodeId || link.target === selectedNodeId)
      ctx.strokeStyle = highlighted ? COLORS.edgeHighlight : COLORS.edge
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.stroke()
    }

    for (const [id, entry] of layout.entries()) {
      const isRoot = id === rootId
      const isSelected = id === selectedNodeId
      const color = nodeColor(entry.node.type)
      const radius = nodeRadius(entry.node, { root: isRoot })

      if (isRoot || isSelected) {
        ctx.shadowColor = color
        ctx.shadowBlur = isRoot ? 18 : 10
      }

      ctx.beginPath()
      ctx.arc(entry.x, entry.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.nodeFill
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = isRoot ? 2.5 : (isSelected ? 2 : 1)
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(entry.x, entry.y, radius * (isRoot ? 0.45 : 0.38), 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = isRoot || isSelected ? 1 : 0.55
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      const fontSize = isRoot ? 10 : 9
      ctx.font = `${isRoot || isSelected ? 600 : 400} ${fontSize}px "SF Mono","Menlo",monospace`
      ctx.fillStyle = isRoot || isSelected ? COLORS.labelHighlight : COLORS.label
      ctx.textAlign = 'center'
      ctx.fillText(entry.node.name, entry.x, entry.y + radius + 11)

      if (isRoot) {
        ctx.font = '400 8px "SF Mono","Menlo",monospace'
        ctx.fillStyle = COLORS.label
        ctx.fillText(`${(adjacency[id] || []).length} links`, entry.x, entry.y + radius + 21)
      }
    }

    if (hoveredNodeId && hoveredNodeId !== rootId) {
      const hovered = layout.get(hoveredNodeId)
      if (hovered) {
        ctx.font = '400 8px "SF Mono","Menlo",monospace'
        ctx.fillStyle = 'rgba(138, 180, 255, 0.72)'
        ctx.textAlign = 'center'
        ctx.fillText('click to re-root', hovered.x, hovered.y - nodeRadius(hovered.node) - 6)
      }
    }

    ctx.restore()
  }

  function resize() {
    if (!rootEl || !canvas) return
    const resized = resizeCanvasToContainer(canvas, rootEl)
    size = { width: resized.width, height: resized.height }
    ctx = resized.ctx
    rebuildLayout()
  }

  function worldPoint(clientX, clientY) {
    return viewport.clientToWorld(canvas, clientX, clientY)
  }

  function updateBreadcrumb() {
    const rootNode = nodeMap[rootId]
    const label = rootNode ? `root: ${rootNode.name}` : 'root: none'
    const breadcrumb = rootEl.querySelector('.wiki-kb-breadcrumb')
    if (breadcrumb) breadcrumb.textContent = label
  }

  function onPointerDown(event) {
    const point = worldPoint(event.clientX, event.clientY)
    const hit = nodeAt(point.x, point.y)
    pointerDown = { clientX: event.clientX, clientY: event.clientY, moved: false }
    if (!hit) {
      pointerDown.panX = event.clientX - viewport.state.panX
      pointerDown.panY = event.clientY - viewport.state.panY
    }
  }

  function onPointerMove(event) {
    if (pointerDown) {
      if (Math.abs(event.clientX - pointerDown.clientX) > 3 || Math.abs(event.clientY - pointerDown.clientY) > 3) {
        pointerDown.moved = true
      }
      if (pointerDown.panX != null) {
        viewport.state.panX = event.clientX - pointerDown.panX
        viewport.state.panY = event.clientY - pointerDown.panY
        draw()
        return
      }
    }

    const point = worldPoint(event.clientX, event.clientY)
    const hit = nodeAt(point.x, point.y)
    const nextHoveredId = hit?.id || null
    if (nextHoveredId !== hoveredNodeId) {
      hoveredNodeId = nextHoveredId
      canvas.style.cursor = hoveredNodeId ? 'pointer' : 'default'
      draw()
    }
  }

  function onPointerEnd(event) {
    if (!pointerDown) return
    const shouldSelect = !pointerDown.moved
    pointerDown = null
    if (!shouldSelect) return

    const point = worldPoint(event.clientX, event.clientY)
    const hit = nodeAt(point.x, point.y)
    if (!hit) {
      selectedNodeId = null
      onSelectNode(null)
      draw()
      return
    }

    if (hit.id !== rootId) {
      rootId = hit.id
      updateBreadcrumb()
      rebuildLayout()
    }
    selectedNodeId = hit.id
    onSelectNode(hit)
    draw()
  }

  function onWheel(event) {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.85 : 1.18
    viewport.zoomAt(canvas, event.clientX, event.clientY, factor)
    draw()
  }

  return {
    mount() {
      rootEl = document.createElement('div')
      rootEl.className = 'wiki-kb-mindmap-view'
      rootEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'
      rootEl.innerHTML = `
        <canvas style="display:block;width:100%;height:100%"></canvas>
        <div class="wiki-kb-breadcrumb"></div>
        <div class="wiki-kb-hint">click a node to re-root · scroll to zoom · drag to pan</div>
      `

      canvas = rootEl.querySelector('canvas')
      ctx = canvas.getContext('2d')

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerEnd)
      canvas.addEventListener('pointercancel', onPointerEnd)
      canvas.addEventListener('wheel', onWheel, { passive: false })

      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(rootEl)
      resize()
      return rootEl
    },

    load(nextGraphData) {
      nodes = Array.isArray(nextGraphData?.nodes) ? nextGraphData.nodes : []
      links = Array.isArray(nextGraphData?.links) ? nextGraphData.links : []
      nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]))
      adjacency = buildAdjacency(nodes, links)

      if (!rootId || !nodeMap[rootId]) {
        rootId = pickPrimaryNodeId(nodes, adjacency)
        viewport.reset()
      }
      if (!nodeMap[selectedNodeId]) selectedNodeId = rootId
      updateBreadcrumb()
      rebuildLayout()
    },

    focusNode(node) {
      if (!node || !nodeMap[node.id]) return
      rootId = node.id
      selectedNodeId = node.id
      hoveredNodeId = null
      viewport.reset()
      updateBreadcrumb()
      rebuildLayout()
    },

    clearSelection() {
      selectedNodeId = null
      draw()
    },

    onActivate() {
      resize()
    },

    onDeactivate() {},
  }
}

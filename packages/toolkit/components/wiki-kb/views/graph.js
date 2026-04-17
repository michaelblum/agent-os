// Force-directed graph view for wiki-kb.

import {
  createViewport,
  drawEmptyState,
  nodeColor,
  nodeRadius,
  resizeCanvasToContainer,
} from './shared.js'

const COLORS = {
  edge: 'rgba(100, 100, 160, 0.35)',
  edgeHighlight: 'rgba(138, 180, 255, 0.72)',
  nodeFill: 'rgba(18, 18, 28, 0.88)',
  label: '#999',
  labelHighlight: '#e0e0e0',
}

class ForceGraph {
  constructor() {
    this.nodes = []
    this.edges = []
    this.width = 600
    this.height = 400
    this.alpha = 1
    this.alphaDecay = 0.0228
    this.alphaMin = 0.001
    this.velocityDecay = 0.4
    this.onTick = null
    this.raf = null
  }

  setSize(width, height) {
    this.width = width
    this.height = height
  }

  load(nodes, links) {
    const previousNodes = new Map(this.nodes.map((node) => [node.id, node]))
    const centerX = this.width / 2
    const centerY = this.height / 2
    const nextNodes = []
    const nodeMap = new Map()

    for (const node of nodes) {
      const previous = previousNodes.get(node.id)
      const next = previous
        ? {
            ...node,
            x: previous.x,
            y: previous.y,
            vx: previous.vx,
            vy: previous.vy,
            fixed: false,
            r: nodeRadius(node),
          }
        : {
            ...node,
            x: centerX + (Math.random() - 0.5) * this.width * 0.6,
            y: centerY + (Math.random() - 0.5) * this.height * 0.6,
            vx: 0,
            vy: 0,
            fixed: false,
            r: nodeRadius(node),
          }
      nextNodes.push(next)
      nodeMap.set(next.id, next)
    }

    this.nodes = nextNodes
    this.edges = links
      .map((link) => ({ source: nodeMap.get(link.source), target: nodeMap.get(link.target) }))
      .filter((link) => link.source && link.target)
    this.alpha = this.nodes.length > 0 ? 1 : 0
  }

  tick() {
    if (this.alpha < this.alphaMin) return

    const centerX = this.width / 2
    const centerY = this.height / 2

    for (let index = 0; index < this.nodes.length; index += 1) {
      const nodeA = this.nodes[index]
      for (let otherIndex = index + 1; otherIndex < this.nodes.length; otherIndex += 1) {
        const nodeB = this.nodes[otherIndex]
        let dx = nodeB.x - nodeA.x
        let dy = nodeB.y - nodeA.y
        const distanceSquared = dx * dx + dy * dy || 1
        const distance = Math.sqrt(distanceSquared)
        const force = 900 / distanceSquared
        dx /= distance
        dy /= distance
        nodeA.vx -= dx * force
        nodeA.vy -= dy * force
        nodeB.vx += dx * force
        nodeB.vy += dy * force
      }
    }

    for (const edge of this.edges) {
      const dx = edge.target.x - edge.source.x
      const dy = edge.target.y - edge.source.y
      const distance = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (distance - 80) * 0.04
      const unitX = dx / distance
      const unitY = dy / distance

      if (!edge.source.fixed) {
        edge.source.vx += unitX * force
        edge.source.vy += unitY * force
      }
      if (!edge.target.fixed) {
        edge.target.vx -= unitX * force
        edge.target.vy -= unitY * force
      }
    }

    for (const node of this.nodes) {
      if (node.fixed) continue
      node.vx += (centerX - node.x) * 0.03 * this.alpha
      node.vy += (centerY - node.y) * 0.03 * this.alpha
      node.vx *= 1 - this.velocityDecay
      node.vy *= 1 - this.velocityDecay
      node.x += node.vx * this.alpha
      node.y += node.vy * this.alpha
    }

    this.alpha *= 1 - this.alphaDecay
    this.onTick?.()
  }

  start() {
    if (this.raf) return
    const step = () => {
      this.tick()
      if (this.alpha >= this.alphaMin) this.raf = requestAnimationFrame(step)
      else this.raf = null
    }
    this.raf = requestAnimationFrame(step)
  }

  stop() {
    if (!this.raf) return
    cancelAnimationFrame(this.raf)
    this.raf = null
  }

  reheat(alpha = 0.3) {
    this.alpha = Math.max(this.alpha, alpha)
    this.start()
  }

  nodeAt(x, y) {
    for (const node of this.nodes) {
      const dx = node.x - x
      const dy = node.y - y
      if (dx * dx + dy * dy <= (node.r + 4) * (node.r + 4)) return node
    }
    return null
  }
}

export default function GraphView({ onSelectNode }) {
  let rootEl = null
  let canvas = null
  let ctx = null
  let resizeObserver = null
  let allNodes = []
  let allLinks = []
  let selectedNodeId = null
  let searchInput = null
  let pointerDown = null
  let dragNode = null
  let activeFilters = new Set(['entity', 'concept', 'plugin'])
  let searchQuery = ''
  let size = { width: 1, height: 1 }
  const simulation = new ForceGraph()
  const viewport = createViewport()

  function selectedNode() {
    if (!selectedNodeId) return null
    return simulation.nodes.find((node) => node.id === selectedNodeId) || null
  }

  function visibleNodes() {
    const query = searchQuery.toLowerCase()
    return allNodes.filter((node) => {
      if (!activeFilters.has(node.type)) return false
      if (!query) return true
      return (
        node.name.toLowerCase().includes(query) ||
        node.description.toLowerCase().includes(query) ||
        node.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    })
  }

  function applyFilter() {
    const nodes = visibleNodes()
    const visibleIds = new Set(nodes.map((node) => node.id))
    const links = allLinks.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
    simulation.load(nodes, links)
    simulation.reheat(nodes.length > 0 ? 1 : 0)
    draw()
  }

  function worldPoint(clientX, clientY) {
    return viewport.clientToWorld(canvas, clientX, clientY)
  }

  function draw() {
    if (!ctx) return

    ctx.clearRect(0, 0, size.width, size.height)
    if (simulation.nodes.length === 0) {
      drawEmptyState(ctx, size.width, size.height, 'Waiting for graph data', 'Send wiki-kb/graph to populate this view.')
      return
    }

    const selected = selectedNode()
    ctx.save()
    viewport.apply(ctx)

    for (const edge of simulation.edges) {
      const highlighted = selected && (edge.source.id === selected.id || edge.target.id === selected.id)
      ctx.strokeStyle = highlighted ? COLORS.edgeHighlight : COLORS.edge
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(edge.source.x, edge.source.y)
      ctx.lineTo(edge.target.x, edge.target.y)
      ctx.stroke()
    }

    const highlightQuery = searchQuery.toLowerCase()
    for (const node of simulation.nodes) {
      const isSelected = selected?.id === node.id
      const isHighlighted = highlightQuery && node.name.toLowerCase().includes(highlightQuery)
      const color = nodeColor(node.type)

      if (isSelected) {
        ctx.shadowColor = color
        ctx.shadowBlur = 12
      }

      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.nodeFill
      ctx.fill()
      ctx.strokeStyle = isSelected ? color : (isHighlighted ? '#ffffff' : color)
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r * 0.38, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = isSelected ? 1 : 0.55
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      ctx.font = `${isSelected ? 600 : 400} 9px "SF Mono","Menlo",monospace`
      ctx.fillStyle = isSelected ? COLORS.labelHighlight : COLORS.label
      ctx.textAlign = 'center'
      ctx.fillText(node.name, node.x, node.y + node.r + 10)
    }

    ctx.restore()
  }

  function resize() {
    if (!rootEl || !canvas) return
    const resized = resizeCanvasToContainer(canvas, rootEl)
    size = { width: resized.width, height: resized.height }
    ctx = resized.ctx
    simulation.setSize(size.width, size.height)
    draw()
  }

  function updateFilterButton(button, isActive) {
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  }

  function ensureNodeVisible(node) {
    if (!activeFilters.has(node.type)) {
      activeFilters.add(node.type)
      const button = rootEl.querySelector(`.wiki-kb-filter[data-type="${node.type}"]`)
      if (button) updateFilterButton(button, true)
    }
    if (searchQuery) {
      searchQuery = ''
      if (searchInput) searchInput.value = ''
    }
    applyFilter()
  }

  function onPointerDown(event) {
    const point = worldPoint(event.clientX, event.clientY)
    const hit = simulation.nodeAt(point.x, point.y)
    pointerDown = { clientX: event.clientX, clientY: event.clientY, moved: false }
    if (hit) {
      dragNode = hit
      dragNode.fixed = true
      canvas.setPointerCapture?.(event.pointerId)
      return
    }
    pointerDown.panX = event.clientX - viewport.state.panX
    pointerDown.panY = event.clientY - viewport.state.panY
  }

  function onPointerMove(event) {
    if (!pointerDown) return
    if (Math.abs(event.clientX - pointerDown.clientX) > 3 || Math.abs(event.clientY - pointerDown.clientY) > 3) {
      pointerDown.moved = true
    }

    if (dragNode) {
      const point = worldPoint(event.clientX, event.clientY)
      dragNode.x = point.x
      dragNode.y = point.y
      dragNode.vx = 0
      dragNode.vy = 0
      simulation.reheat(0.15)
      return
    }

    viewport.state.panX = event.clientX - pointerDown.panX
    viewport.state.panY = event.clientY - pointerDown.panY
    draw()
  }

  function onPointerEnd(event) {
    if (dragNode) {
      dragNode.fixed = false
      dragNode = null
    }

    if (!pointerDown) return
    const shouldSelect = !pointerDown.moved
    pointerDown = null

    if (!shouldSelect) return

    const point = worldPoint(event.clientX, event.clientY)
    const hit = simulation.nodeAt(point.x, point.y)
    selectedNodeId = hit?.id || null
    onSelectNode(hit || null)
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
      rootEl.className = 'wiki-kb-graph-view'
      rootEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'
      rootEl.innerHTML = `
        <canvas style="display:block;width:100%;height:100%"></canvas>
        <div class="wiki-kb-toolbar">
          <input class="wiki-kb-search" type="text" placeholder="Search..." autocomplete="off" spellcheck="false">
          <div class="wiki-kb-filter-row">
            <button type="button" class="wiki-kb-filter active" data-type="entity" aria-pressed="true">Entity</button>
            <button type="button" class="wiki-kb-filter active" data-type="concept" aria-pressed="true">Concept</button>
            <button type="button" class="wiki-kb-filter active" data-type="plugin" aria-pressed="true">Plugin</button>
          </div>
        </div>
        <div class="wiki-kb-legend">
          <div class="wiki-kb-legend-item"><span class="wiki-kb-legend-dot" style="background:#8ab4ff"></span>entity</div>
          <div class="wiki-kb-legend-item"><span class="wiki-kb-legend-dot" style="background:#6a9966"></span>concept</div>
          <div class="wiki-kb-legend-item"><span class="wiki-kb-legend-dot" style="background:#ddaa66"></span>plugin</div>
        </div>
        <div class="wiki-kb-hint">drag nodes · scroll to zoom · click to inspect</div>
      `

      canvas = rootEl.querySelector('canvas')
      ctx = canvas.getContext('2d')
      searchInput = rootEl.querySelector('.wiki-kb-search')

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerEnd)
      canvas.addEventListener('pointercancel', onPointerEnd)
      canvas.addEventListener('wheel', onWheel, { passive: false })

      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim()
        applyFilter()
      })

      for (const button of rootEl.querySelectorAll('.wiki-kb-filter')) {
        button.addEventListener('click', () => {
          const type = button.dataset.type
          const isActive = activeFilters.has(type)
          if (isActive) activeFilters.delete(type)
          else activeFilters.add(type)
          updateFilterButton(button, !isActive)
          applyFilter()
        })
      }

      simulation.onTick = draw
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(rootEl)
      resize()
      return rootEl
    },

    load(nodes, links) {
      allNodes = nodes
      allLinks = links
      if (!findCurrentNode()) selectedNodeId = null
      applyFilter()
    },

    focusNode(node) {
      if (!node) return
      ensureNodeVisible(node)
      const graphNode = simulation.nodes.find((entry) => entry.id === node.id)
      if (!graphNode) return
      selectedNodeId = graphNode.id
      viewport.centerOn(size.width, size.height, graphNode.x, graphNode.y)
      draw()
    },

    clearSelection() {
      selectedNodeId = null
      draw()
    },

    onActivate() {
      resize()
      simulation.reheat(0.1)
    },

    onDeactivate() {
      simulation.stop()
    },
  }

  function findCurrentNode() {
    return allNodes.find((node) => node.id === selectedNodeId) || null
  }
}

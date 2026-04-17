// Force-directed graph view for wiki-kb.

import {
  createViewport,
  deriveGraphViewData,
  drawEmptyState,
  nodeColor,
  nodeRadius,
  normalizeGraphViewConfig,
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

  bounds() {
    if (this.nodes.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of this.nodes) {
      minX = Math.min(minX, node.x - node.r)
      minY = Math.min(minY, node.y - node.r)
      maxX = Math.max(maxX, node.x + node.r)
      maxY = Math.max(maxY, node.y + node.r)
    }

    return { minX, minY, maxX, maxY }
  }
}

export default function GraphView({ onSelectNode }) {
  let rootEl = null
  let canvas = null
  let ctx = null
  let resizeObserver = null
  let pointerDown = null
  let dragNode = null
  let isActive = false
  let size = { width: 1, height: 1 }
  let graphData = {
    nodes: [],
    links: [],
    raw: {},
    config: { graphView: normalizeGraphViewConfig({}) },
  }
  let graphViewConfig = normalizeGraphViewConfig({})
  let filteredGraph = deriveGraphViewData(graphData, {})
  let controlsOpen = true
  let selectedNodeId = null
  let searchQuery = ''
  let mode = 'global'
  let depth = 2
  let showIsolated = true
  let frozen = false
  let tagMatchMode = 'any'
  let activeTypes = new Set()
  let activeTags = new Set()
  let configSignature = ''
  const dom = {}
  const simulation = new ForceGraph()
  const viewport = createViewport()

  function selectedNode() {
    if (!selectedNodeId) return null
    return simulation.nodes.find((node) => node.id === selectedNodeId) || null
  }

  function worldPoint(clientX, clientY) {
    return viewport.clientToWorld(canvas, clientX, clientY)
  }

  function setControlsOpen(nextOpen) {
    if (!graphViewConfig.controls.enabled) {
      controlsOpen = false
    } else {
      controlsOpen = Boolean(nextOpen)
    }

    dom.controlsShellEl?.classList.toggle('collapsed', !controlsOpen)
    dom.controlsPanelEl?.toggleAttribute('hidden', !controlsOpen)
    if (dom.controlsToggleEl) {
      dom.controlsToggleEl.setAttribute('aria-pressed', controlsOpen ? 'true' : 'false')
      dom.controlsToggleEl.textContent = controlsOpen ? 'Hide Controls' : 'Show Controls'
    }
  }

  function syncConfig(nextConfig) {
    const normalized = normalizeGraphViewConfig(nextConfig)
    const nextSignature = JSON.stringify(normalized)
    const configChanged = nextSignature !== configSignature
    const availableTypes = filteredGraph.availableTypes
    const availableTags = filteredGraph.availableTags.map((entry) => entry.value)

    graphViewConfig = normalized
    configSignature = nextSignature

    if (configChanged) {
      searchQuery = graphViewConfig.defaults.searchQuery
      mode = graphViewConfig.defaults.mode
      depth = graphViewConfig.defaults.depth
      showIsolated = graphViewConfig.defaults.showIsolated
      frozen = graphViewConfig.defaults.frozen
      tagMatchMode = graphViewConfig.defaults.tagMatchMode
      controlsOpen = graphViewConfig.controls.enabled ? !graphViewConfig.controls.collapsed : false
      activeTypes = new Set(
        graphViewConfig.defaults.activeTypes.length > 0
          ? graphViewConfig.defaults.activeTypes.filter((type) => availableTypes.includes(type))
          : availableTypes
      )
      activeTags = new Set(
        graphViewConfig.defaults.activeTags.filter((tag) => availableTags.includes(tag))
      )
    } else {
      activeTypes = new Set([...activeTypes].filter((type) => availableTypes.includes(type)))
      if (activeTypes.size === 0 && availableTypes.length > 0) {
        activeTypes = new Set(availableTypes)
      }
      activeTags = new Set([...activeTags].filter((tag) => availableTags.includes(tag)))
      depth = Math.min(graphViewConfig.limits.maxDepth, Math.max(graphViewConfig.limits.minDepth, depth))
    }

    if (!graphViewConfig.features.search) searchQuery = ''
    if (!graphViewConfig.features.scope) mode = 'global'
    if (!graphViewConfig.features.depth) depth = graphViewConfig.defaults.depth
    if (!graphViewConfig.features.isolated) showIsolated = true
    if (!graphViewConfig.features.freeze) frozen = false
    if (!graphViewConfig.features.types) activeTypes = new Set(availableTypes)
    if (!graphViewConfig.features.tags) activeTags.clear()
    if (!graphViewConfig.controls.enabled) controlsOpen = false
  }

  function renderLegend() {
    if (!dom.legendEl) return
    dom.legendEl.innerHTML = ''
    const shouldShowLegend = graphViewConfig.features.legend && filteredGraph.availableTypes.length > 0
    dom.legendEl.toggleAttribute('hidden', !shouldShowLegend)
    if (!shouldShowLegend) return

    const fragment = document.createDocumentFragment()
    for (const type of filteredGraph.availableTypes) {
      const item = document.createElement('div')
      item.className = 'wiki-kb-legend-item'
      item.innerHTML = `<span class="wiki-kb-legend-dot" style="background:${nodeColor(type)}"></span>${type}`
      fragment.appendChild(item)
    }
    dom.legendEl.appendChild(fragment)
  }

  function renderTypeFilters() {
    if (!dom.typeFiltersEl) return
    dom.typeFiltersEl.innerHTML = ''
    dom.typeSectionEl.toggleAttribute('hidden', !graphViewConfig.features.types)
    if (!graphViewConfig.features.types) return

    const fragment = document.createDocumentFragment()
    for (const type of filteredGraph.availableTypes) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'wiki-kb-filter'
      button.dataset.kind = 'type'
      button.dataset.value = type
      button.dataset.type = type
      button.textContent = type
      const isActive = activeTypes.has(type)
      button.classList.toggle('active', isActive)
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
      fragment.appendChild(button)
    }
    dom.typeFiltersEl.appendChild(fragment)
  }

  function renderTagFilters() {
    if (!dom.tagFiltersEl) return
    dom.tagFiltersEl.innerHTML = ''
    dom.tagSectionEl.toggleAttribute('hidden', !graphViewConfig.features.tags)
    if (!graphViewConfig.features.tags) return

    const fragment = document.createDocumentFragment()
    for (const entry of filteredGraph.availableTags) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'wiki-kb-tag-filter'
      button.dataset.kind = 'tag'
      button.dataset.value = entry.value
      button.textContent = `${entry.value} (${entry.count})`
      const isActive = activeTags.has(entry.value)
      button.classList.toggle('active', isActive)
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
      fragment.appendChild(button)
    }
    dom.tagFiltersEl.appendChild(fragment)
    dom.tagEmptyEl.toggleAttribute('hidden', filteredGraph.availableTags.length > 0)
  }

  function renderControls() {
    if (!rootEl) return

    dom.controlsShellEl.toggleAttribute('hidden', !graphViewConfig.controls.enabled)

    if (dom.searchInput) {
      dom.searchInput.value = searchQuery
      dom.searchSectionEl.toggleAttribute('hidden', !graphViewConfig.features.search)
    }

    if (dom.scopeSectionEl) {
      const showScope = graphViewConfig.features.scope
      dom.scopeSectionEl.toggleAttribute('hidden', !showScope)
      dom.depthRowEl.toggleAttribute('hidden', !(showScope && graphViewConfig.features.depth && mode === 'local'))
      dom.anchorCaptionEl.toggleAttribute('hidden', !(showScope && mode === 'local' && filteredGraph.anchorName))
      dom.anchorCaptionEl.textContent = filteredGraph.anchorName
        ? `anchor: ${filteredGraph.anchorName}`
        : 'anchor: none'
      if (dom.scopeGlobalButton) {
        const isGlobal = mode === 'global'
        dom.scopeGlobalButton.classList.toggle('active', isGlobal)
        dom.scopeGlobalButton.setAttribute('aria-pressed', isGlobal ? 'true' : 'false')
      }
      if (dom.scopeLocalButton) {
        const isLocal = mode === 'local'
        dom.scopeLocalButton.classList.toggle('active', isLocal)
        dom.scopeLocalButton.setAttribute('aria-pressed', isLocal ? 'true' : 'false')
      }
    }

    if (dom.depthRange) {
      dom.depthRange.min = String(graphViewConfig.limits.minDepth)
      dom.depthRange.max = String(graphViewConfig.limits.maxDepth)
      dom.depthRange.value = String(depth)
      dom.depthValueEl.textContent = String(depth)
    }

    dom.summaryEl.textContent = `${filteredGraph.stats.visibleNodes}/${filteredGraph.stats.totalNodes} nodes · ${filteredGraph.stats.visibleLinks}/${filteredGraph.stats.totalLinks} links`
    dom.isolatedToggleRowEl.toggleAttribute('hidden', !graphViewConfig.features.isolated)
    dom.showIsolatedInput.checked = showIsolated
    dom.freezeToggleRowEl.toggleAttribute('hidden', !graphViewConfig.features.freeze)
    dom.freezeInput.checked = frozen
    dom.fitButton.toggleAttribute('hidden', !graphViewConfig.features.fit)
    dom.resetViewButton.toggleAttribute('hidden', !graphViewConfig.features.reset)
    dom.resetFiltersButton.toggleAttribute('hidden', !graphViewConfig.features.reset)

    setControlsOpen(controlsOpen)
    renderTypeFilters()
    renderTagFilters()
    renderLegend()
  }

  function syncSimulation(alpha = 0.3) {
    if (frozen || !isActive || simulation.nodes.length === 0) {
      simulation.stop()
      draw()
      return
    }
    simulation.reheat(alpha)
  }

  function applyDerivedState({ fit = false, alpha = 0.3 } = {}) {
    filteredGraph = deriveGraphViewData(graphData, {
      searchQuery,
      mode,
      depth,
      showIsolated,
      tagMatchMode,
      activeTypes: [...activeTypes],
      activeTags: [...activeTags],
      anchorId: selectedNodeId,
      stickyNodeIds: selectedNodeId ? [selectedNodeId] : [],
    })
    simulation.load(filteredGraph.nodes, filteredGraph.links)
    renderControls()

    if (fit && simulation.nodes.length > 0) {
      viewport.fitBounds(size.width, size.height, simulation.bounds())
    }
    syncSimulation(alpha)
  }

  function resetControlsToDefaults({ fit = false } = {}) {
    const availableTypes = filteredGraph.availableTypes
    const availableTags = filteredGraph.availableTags.map((entry) => entry.value)
    searchQuery = graphViewConfig.features.search ? graphViewConfig.defaults.searchQuery : ''
    mode = graphViewConfig.features.scope ? graphViewConfig.defaults.mode : 'global'
    depth = graphViewConfig.features.depth ? graphViewConfig.defaults.depth : graphViewConfig.limits.minDepth
    showIsolated = graphViewConfig.features.isolated ? graphViewConfig.defaults.showIsolated : true
    frozen = graphViewConfig.features.freeze ? graphViewConfig.defaults.frozen : false
    tagMatchMode = graphViewConfig.defaults.tagMatchMode
    activeTypes = new Set(
      graphViewConfig.features.types && graphViewConfig.defaults.activeTypes.length > 0
        ? graphViewConfig.defaults.activeTypes.filter((type) => availableTypes.includes(type))
        : availableTypes
    )
    activeTags = new Set(
      graphViewConfig.features.tags
        ? graphViewConfig.defaults.activeTags.filter((tag) => availableTags.includes(tag))
        : []
    )
    applyDerivedState({ fit, alpha: frozen ? 0 : 0.6 })
  }

  function fitGraph() {
    const bounds = simulation.bounds()
    if (!bounds) return
    viewport.fitBounds(size.width, size.height, bounds, { padding: 36 })
    draw()
  }

  function resetViewport() {
    viewport.reset()
    draw()
  }

  function draw() {
    if (!ctx) return

    ctx.clearRect(0, 0, size.width, size.height)
    if (simulation.nodes.length === 0) {
      const detail = graphData.nodes.length === 0
        ? 'Send wiki-kb/graph to populate this view.'
        : 'Current controls hide every node.'
      drawEmptyState(ctx, size.width, size.height, 'No visible graph nodes', detail)
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

  function ensureNodeVisible(node) {
    if (!node) return
    activeTypes.add(node.type)
    if (searchQuery) searchQuery = ''
    if (activeTags.size > 0 && ![...activeTags].every((tag) => node.tags.includes(tag))) {
      activeTags.clear()
    }
    applyDerivedState({ alpha: frozen ? 0 : 0.5 })
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
      if (frozen || !isActive) draw()
      else simulation.reheat(0.12)
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

    if (mode === 'local') {
      applyDerivedState({ fit: true, alpha: frozen ? 0 : 0.6 })
      return
    }

    draw()
  }

  function onWheel(event) {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.85 : 1.18
    viewport.zoomAt(canvas, event.clientX, event.clientY, factor)
    draw()
  }

  function onRootClick(event) {
    const target = event.target.closest('button')
    if (!target) return

    if (target.classList.contains('wiki-kb-controls-toggle')) {
      setControlsOpen(!controlsOpen)
      return
    }

    if (target.classList.contains('wiki-kb-scope-button')) {
      mode = target.dataset.mode === 'local' ? 'local' : 'global'
      applyDerivedState({ fit: mode === 'local', alpha: frozen ? 0 : 0.6 })
      return
    }

    if (target.dataset.kind === 'type') {
      const type = target.dataset.value
      if (activeTypes.has(type)) activeTypes.delete(type)
      else activeTypes.add(type)
      if (activeTypes.size === 0) {
        activeTypes = new Set(filteredGraph.availableTypes)
      }
      applyDerivedState({ alpha: frozen ? 0 : 0.6 })
      return
    }

    if (target.dataset.kind === 'tag') {
      const tag = target.dataset.value
      if (activeTags.has(tag)) activeTags.delete(tag)
      else activeTags.add(tag)
      applyDerivedState({ alpha: frozen ? 0 : 0.6 })
      return
    }

    switch (target.dataset.action) {
      case 'types-all':
        activeTypes = new Set(filteredGraph.availableTypes)
        applyDerivedState({ alpha: frozen ? 0 : 0.6 })
        break
      case 'tags-clear':
        activeTags.clear()
        applyDerivedState({ alpha: frozen ? 0 : 0.6 })
        break
      case 'fit':
        fitGraph()
        break
      case 'reset-view':
        resetViewport()
        break
      case 'reset-filters':
        resetControlsToDefaults({ fit: true })
        break
      default:
        break
    }
  }

  function onRootInput(event) {
    const target = event.target
    if (target === dom.searchInput) {
      searchQuery = target.value.trim()
      applyDerivedState({ alpha: frozen ? 0 : 0.45 })
      return
    }

    if (target === dom.depthRange) {
      depth = Number.parseInt(target.value, 10) || graphViewConfig.defaults.depth
      applyDerivedState({ fit: true, alpha: frozen ? 0 : 0.45 })
    }
  }

  function onRootChange(event) {
    const target = event.target
    if (target === dom.showIsolatedInput) {
      showIsolated = target.checked
      applyDerivedState({ alpha: frozen ? 0 : 0.5 })
      return
    }

    if (target === dom.freezeInput) {
      frozen = target.checked
      if (frozen) {
        simulation.stop()
        draw()
      } else {
        syncSimulation(0.25)
      }
    }
  }

  return {
    mount() {
      rootEl = document.createElement('div')
      rootEl.className = 'wiki-kb-graph-view'
      rootEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;'
      rootEl.innerHTML = `
        <canvas style="display:block;width:100%;height:100%"></canvas>
        <div class="wiki-kb-controls-shell">
          <button type="button" class="wiki-kb-controls-toggle" aria-pressed="true">Hide Controls</button>
          <div class="wiki-kb-controls-panel">
            <div class="wiki-kb-controls-header">
              <span class="wiki-kb-controls-title">Graph Controls</span>
              <span class="wiki-kb-controls-summary"></span>
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-search">
              <label class="wiki-kb-controls-label" for="wiki-kb-search-input">Search</label>
              <input id="wiki-kb-search-input" class="wiki-kb-search" type="text" placeholder="Search nodes, tags, or descriptions" autocomplete="off" spellcheck="false">
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-scope">
              <div class="wiki-kb-controls-label-row">
                <span class="wiki-kb-controls-label">Scope</span>
                <div class="wiki-kb-segmented">
                  <button type="button" class="wiki-kb-scope-button active" data-mode="global" aria-pressed="true">Global</button>
                  <button type="button" class="wiki-kb-scope-button" data-mode="local" aria-pressed="false">Local</button>
                </div>
              </div>
              <div class="wiki-kb-controls-range-row">
                <div class="wiki-kb-controls-label-row">
                  <span class="wiki-kb-controls-label">Depth</span>
                  <span class="wiki-kb-controls-value">2</span>
                </div>
                <input class="wiki-kb-depth-range" type="range" min="1" max="4" value="2">
              </div>
              <div class="wiki-kb-controls-caption" hidden></div>
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-types">
              <div class="wiki-kb-controls-label-row">
                <span class="wiki-kb-controls-label">Types</span>
                <button type="button" class="wiki-kb-mini-action" data-action="types-all">All</button>
              </div>
              <div class="wiki-kb-filter-row wiki-kb-type-filters"></div>
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-tags">
              <div class="wiki-kb-controls-label-row">
                <span class="wiki-kb-controls-label">Tags</span>
                <button type="button" class="wiki-kb-mini-action" data-action="tags-clear">Clear</button>
              </div>
              <div class="wiki-kb-tag-filters"></div>
              <div class="wiki-kb-controls-empty">No tags in the current graph.</div>
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-toggles">
              <label class="wiki-kb-check-row wiki-kb-check-row-isolated">
                <input class="wiki-kb-show-isolated" type="checkbox" checked>
                <span>Show isolated nodes</span>
              </label>
              <label class="wiki-kb-check-row wiki-kb-check-row-freeze">
                <input class="wiki-kb-freeze-layout" type="checkbox">
                <span>Freeze layout</span>
              </label>
            </div>
            <div class="wiki-kb-controls-section wiki-kb-controls-section-actions">
              <button type="button" class="wiki-kb-action-button" data-action="fit">Fit Graph</button>
              <button type="button" class="wiki-kb-action-button" data-action="reset-view">Reset View</button>
              <button type="button" class="wiki-kb-action-button" data-action="reset-filters">Reset Filters</button>
            </div>
          </div>
        </div>
        <div class="wiki-kb-legend"></div>
        <div class="wiki-kb-hint">drag nodes · scroll to zoom · click to inspect</div>
      `

      canvas = rootEl.querySelector('canvas')
      ctx = canvas.getContext('2d')
      dom.controlsShellEl = rootEl.querySelector('.wiki-kb-controls-shell')
      dom.controlsToggleEl = rootEl.querySelector('.wiki-kb-controls-toggle')
      dom.controlsPanelEl = rootEl.querySelector('.wiki-kb-controls-panel')
      dom.summaryEl = rootEl.querySelector('.wiki-kb-controls-summary')
      dom.searchInput = rootEl.querySelector('.wiki-kb-search')
      dom.searchSectionEl = rootEl.querySelector('.wiki-kb-controls-section-search')
      dom.scopeSectionEl = rootEl.querySelector('.wiki-kb-controls-section-scope')
      dom.scopeGlobalButton = rootEl.querySelector('.wiki-kb-scope-button[data-mode="global"]')
      dom.scopeLocalButton = rootEl.querySelector('.wiki-kb-scope-button[data-mode="local"]')
      dom.depthRowEl = rootEl.querySelector('.wiki-kb-controls-range-row')
      dom.depthRange = rootEl.querySelector('.wiki-kb-depth-range')
      dom.depthValueEl = rootEl.querySelector('.wiki-kb-controls-value')
      dom.anchorCaptionEl = rootEl.querySelector('.wiki-kb-controls-caption')
      dom.typeSectionEl = rootEl.querySelector('.wiki-kb-controls-section-types')
      dom.typeFiltersEl = rootEl.querySelector('.wiki-kb-type-filters')
      dom.tagSectionEl = rootEl.querySelector('.wiki-kb-controls-section-tags')
      dom.tagFiltersEl = rootEl.querySelector('.wiki-kb-tag-filters')
      dom.tagEmptyEl = rootEl.querySelector('.wiki-kb-controls-empty')
      dom.isolatedToggleRowEl = rootEl.querySelector('.wiki-kb-check-row-isolated')
      dom.showIsolatedInput = rootEl.querySelector('.wiki-kb-show-isolated')
      dom.freezeToggleRowEl = rootEl.querySelector('.wiki-kb-check-row-freeze')
      dom.freezeInput = rootEl.querySelector('.wiki-kb-freeze-layout')
      dom.fitButton = rootEl.querySelector('[data-action="fit"]')
      dom.resetViewButton = rootEl.querySelector('[data-action="reset-view"]')
      dom.resetFiltersButton = rootEl.querySelector('[data-action="reset-filters"]')
      dom.legendEl = rootEl.querySelector('.wiki-kb-legend')

      rootEl.addEventListener('click', onRootClick)
      rootEl.addEventListener('input', onRootInput)
      rootEl.addEventListener('change', onRootChange)
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerEnd)
      canvas.addEventListener('pointercancel', onPointerEnd)
      canvas.addEventListener('wheel', onWheel, { passive: false })

      simulation.onTick = draw
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(rootEl)
      resize()
      renderControls()
      return rootEl
    },

    load(nextGraphData) {
      graphData = nextGraphData
      if (!graphData.nodes.some((node) => node.id === selectedNodeId)) selectedNodeId = null
      filteredGraph = deriveGraphViewData(graphData, {
        searchQuery,
        mode,
        depth,
        showIsolated,
        tagMatchMode,
        activeTypes: [...activeTypes],
        activeTags: [...activeTags],
        anchorId: selectedNodeId,
        stickyNodeIds: selectedNodeId ? [selectedNodeId] : [],
      })
      syncConfig(graphData.config?.graphView)
      applyDerivedState({ alpha: frozen ? 0 : 0.7 })
    },

    focusNode(node) {
      if (!node) return
      selectedNodeId = node.id
      ensureNodeVisible(node)
      const graphNode = simulation.nodes.find((entry) => entry.id === node.id)
      if (!graphNode) return
      viewport.centerOn(size.width, size.height, graphNode.x, graphNode.y)
      draw()
    },

    clearSelection() {
      selectedNodeId = null
      if (mode === 'local') {
        applyDerivedState({ fit: true, alpha: frozen ? 0 : 0.4 })
      } else {
        draw()
      }
    },

    onActivate() {
      isActive = true
      resize()
      syncSimulation(0.1)
    },

    onDeactivate() {
      isActive = false
      simulation.stop()
    },
  }
}

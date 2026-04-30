// wiki-kb - Toolkit content for exploring wiki graph data.
//
// The component accepts graph snapshots plus incremental updates and renders
// two synchronized views: a force graph and a radial mind map.

import GraphView from './views/graph.js'
import MindmapView from './views/mindmap.js'
import {
  applyGraphUpdate,
  nodeColor,
  normalizeGraphPayload,
  renderMarkdown,
} from './views/shared.js'
import {
  applyWikiKBSemanticTarget,
  wikiKBAosRef,
} from './semantics.js'

const VIEW_DEFS = [
  { id: 'graph', label: 'Graph', factory: GraphView },
  { id: 'mindmap', label: 'Mind Map', factory: MindmapView },
]

function canonicalMessageType(type) {
  if (type === 'graph' || type === 'wiki/graph' || type === 'wiki-kb/graph') return 'graph'
  if (type === 'graph/update' || type === 'wiki/graph/update' || type === 'wiki-kb/graph/update') {
    return 'graph/update'
  }
  return null
}

function findNode(nodes, id) {
  if (!id) return null
  return nodes.find((node) => node.id === id) || null
}

function buildRelatedNodes(state, nodeId) {
  const related = new Map()
  for (const link of state.links) {
    if (link.source === nodeId) {
      const node = findNode(state.nodes, link.target)
      if (node) related.set(node.id, node)
    } else if (link.target === nodeId) {
      const node = findNode(state.nodes, link.source)
      if (node) related.set(node.id, node)
    }
  }
  return [...related.values()]
}

export default function WikiKB() {
  let host = null
  let rootEl = null
  let contentEl = null
  let activeViewId = 'graph'
  let sidebarMode = 'markdown'
  let selectedNodeId = null
  let graphState = normalizeGraphPayload({})
  const viewInstances = new Map()
  const dom = {}

  function currentNode() {
    return findNode(graphState.nodes, selectedNodeId)
  }

  function updateStatus() {
    if (dom.statusEl) {
      dom.statusEl.textContent = `${graphState.nodes.length} nodes · ${graphState.links.length} links`
    }
    if (host) {
      const title = graphState.nodes.length > 0
        ? `Wiki KB - ${graphState.nodes.length}`
        : 'Wiki KB'
      host.setTitle(title)
    }
  }

  function syncSidebarToggle() {
    for (const button of rootEl.querySelectorAll('.wiki-kb-toggle-button')) {
      const isActive = button.dataset.mode === sidebarMode
      button.classList.toggle('active', isActive)
      applyWikiKBSemanticTarget(button, {
        id: `sidebar-mode-${button.dataset.mode}`,
        name: button.textContent,
        action: 'set_sidebar_mode',
        aosRef: wikiKBAosRef('sidebar-mode', button.dataset.mode),
        pressed: isActive,
      })
    }
  }

  function closeSidebar() {
    selectedNodeId = null
    dom.sidebarEl.classList.remove('open')
    dom.relatedListEl.replaceChildren()
    host?.emit?.('selection', null)
  }

  function renderSidebarBody(node) {
    dom.sidebarBodyEl.innerHTML = ''
    const raw = graphState.raw[node.id] || ''

    if (sidebarMode === 'raw') {
      const pre = document.createElement('pre')
      pre.className = 'wiki-kb-sidebar-raw'
      pre.textContent = raw || '(no source available)'
      dom.sidebarBodyEl.appendChild(pre)
      return
    }

    const body = document.createElement('div')
    body.className = 'wiki-kb-sidebar-markdown'
    if (raw) {
      body.innerHTML = renderMarkdown(raw)
    } else if (node.description) {
      const paragraph = document.createElement('p')
      paragraph.textContent = node.description
      body.appendChild(paragraph)
    } else {
      const paragraph = document.createElement('p')
      paragraph.className = 'wiki-kb-sidebar-empty'
      paragraph.textContent = 'No content loaded.'
      body.appendChild(paragraph)
    }
    dom.sidebarBodyEl.appendChild(body)
  }

  function renderRelated(node) {
    dom.relatedListEl.replaceChildren()
    const related = buildRelatedNodes(graphState, node.id)
    dom.relatedSectionEl.hidden = related.length === 0
    if (related.length === 0) return

    const fragment = document.createDocumentFragment()
    for (const relatedNode of related) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'wiki-kb-related-link'
      button.dataset.nodeId = relatedNode.id
      applyWikiKBSemanticTarget(button, {
        id: `related-${relatedNode.id}`,
        name: `Related: ${relatedNode.name}`,
        action: 'select_related_node',
        aosRef: wikiKBAosRef('related', relatedNode.id),
      })

      const dot = document.createElement('span')
      dot.className = 'wiki-kb-related-dot'
      dot.style.background = nodeColor(relatedNode.type)
      button.appendChild(dot)

      const label = document.createElement('span')
      label.textContent = relatedNode.name
      button.appendChild(label)

      fragment.appendChild(button)
    }
    dom.relatedListEl.appendChild(fragment)
  }

  function renderSidebar(node) {
    dom.sidebarEl.classList.add('open')
    dom.sidebarTypeEl.textContent = node.type || 'unknown'
    dom.sidebarTypeEl.dataset.type = node.type || ''
    dom.sidebarNameEl.textContent = node.name
    dom.sidebarDescriptionEl.textContent = node.description || 'No description available.'

    dom.sidebarTagsEl.replaceChildren()
    dom.sidebarTagsEl.hidden = node.tags.length === 0
    if (node.tags.length > 0) {
      const fragment = document.createDocumentFragment()
      for (const tag of node.tags) {
        const chip = document.createElement('span')
        chip.className = 'wiki-kb-tag'
        chip.textContent = tag
        fragment.appendChild(chip)
      }
      dom.sidebarTagsEl.appendChild(fragment)
    }

    syncSidebarToggle()
    renderSidebarBody(node)
    renderRelated(node)
  }

  function focusActiveViewOnSelection() {
    const node = currentNode()
    const view = viewInstances.get(activeViewId)
    if (!view || !node) return
    view.instance.focusNode?.(node)
  }

  function emitSelection(node) {
    host?.emit?.('selection', node ? {
      id: node.id,
      path: node.path || node.id,
      name: node.name,
      type: node.type || 'unknown',
      tags: [...node.tags],
      plugin: node.plugin || null,
    } : null)
  }

  function setSelection(node, options = {}) {
    const { emitSelectionEvent = true } = options
    selectedNodeId = node?.id || null
    const selectedNode = currentNode()
    if (!selectedNode) {
      closeSidebar()
      return
    }
    renderSidebar(selectedNode)
    focusActiveViewOnSelection()
    if (emitSelectionEvent) emitSelection(selectedNode)
  }

  function clearSelection(options = {}) {
    const { emitSelectionEvent = true } = options
    selectedNodeId = null
    dom.sidebarEl.classList.remove('open')
    dom.relatedListEl.replaceChildren()
    const activeView = viewInstances.get(activeViewId)
    activeView?.instance.clearSelection?.()
    if (emitSelectionEvent) emitSelection(null)
  }

  function resolveRevealTarget(payload) {
    const directId = payload?.id || payload?.path
    if (directId) return findNode(graphState.nodes, directId)

    const byName = typeof payload?.name === 'string'
      ? graphState.nodes.find((node) => node.name === payload.name)
      : null
    return byName || null
  }

  function feedViews() {
    for (const { instance } of viewInstances.values()) {
      instance.load(graphState)
    }
  }

  function ensureView(id) {
    const existing = viewInstances.get(id)
    if (existing) return existing

    const definition = VIEW_DEFS.find((entry) => entry.id === id)
    if (!definition) throw new Error(`Unknown wiki-kb view '${id}'`)

    const instance = definition.factory({
      onSelectNode(node) {
        setSelection(node)
      },
    })
    const viewEl = instance.mount()
    viewEl.classList.add('wiki-kb-view')
    viewEl.id = `wiki-kb-panel-${id}`
    viewEl.setAttribute('role', 'tabpanel')
    viewEl.setAttribute('aria-labelledby', `wiki-kb-tab-${id}`)
    viewEl.hidden = true
    contentEl.appendChild(viewEl)

    const created = { instance, viewEl }
    viewInstances.set(id, created)
    instance.load(graphState)
    return created
  }

  function activateView(id) {
    activeViewId = id
    for (const [viewId, entry] of viewInstances.entries()) {
      const isActive = viewId === id
      entry.viewEl.hidden = !isActive
      if (isActive) entry.instance.onActivate?.()
      else entry.instance.onDeactivate?.()
    }
    for (const button of rootEl.querySelectorAll('.wiki-kb-view-tab')) {
      const isActive = button.dataset.view === id
      button.classList.toggle('active', isActive)
      const view = VIEW_DEFS.find((entry) => entry.id === button.dataset.view)
      applyWikiKBSemanticTarget(button, {
        id: `view-tab-${button.dataset.view}`,
        role: 'AXTab',
        name: view?.label || button.textContent,
        action: 'set_view',
        aosRef: wikiKBAosRef('tab', button.dataset.view),
        selected: isActive,
      })
    }
    focusActiveViewOnSelection()
  }

  function switchView(id) {
    ensureView(id)
    activateView(id)
  }

  function syncSelectionAfterData() {
    const node = currentNode()
    if (!node) {
      closeSidebar()
      for (const { instance } of viewInstances.values()) {
        instance.clearSelection?.()
      }
      return
    }
    renderSidebar(node)
    focusActiveViewOnSelection()
  }

  function applySnapshot(payload) {
    graphState = normalizeGraphPayload(payload)
    updateStatus()
    feedViews()
    syncSelectionAfterData()
  }

  function applyUpdate(payload) {
    graphState = applyGraphUpdate(graphState, payload)
    updateStatus()
    feedViews()
    syncSelectionAfterData()
  }

  function onRootClick(event) {
    const tabButton = event.target.closest('.wiki-kb-view-tab')
    if (tabButton) {
      switchView(tabButton.dataset.view)
      return
    }

    const toggleButton = event.target.closest('.wiki-kb-toggle-button')
    if (toggleButton) {
      sidebarMode = toggleButton.dataset.mode || 'markdown'
      syncSidebarToggle()
      const node = currentNode()
      if (node) renderSidebarBody(node)
      return
    }

    if (event.target.closest('.wiki-kb-sidebar-close')) {
      clearSelection()
      return
    }

    const relatedButton = event.target.closest('.wiki-kb-related-link')
    if (relatedButton) {
      const node = findNode(graphState.nodes, relatedButton.dataset.nodeId)
      if (node) setSelection(node)
    }
  }

  function buildDOM() {
    rootEl.innerHTML = `
      <div class="wiki-kb-shell">
        <div class="wiki-kb-tab-strip" role="tablist" aria-label="Wiki KB Views">
          ${VIEW_DEFS.map((view, index) => `
            <button
              type="button"
              id="wiki-kb-tab-${view.id}"
              class="wiki-kb-view-tab${index === 0 ? ' active' : ''}"
              data-view="${view.id}"
              role="tab"
              aria-selected="${index === 0 ? 'true' : 'false'}"
              aria-controls="wiki-kb-panel-${view.id}"
            >${view.label}</button>
          `).join('')}
          <div class="wiki-kb-tab-spacer"></div>
          <span class="wiki-kb-status" role="status" aria-live="polite"></span>
        </div>
        <div class="wiki-kb-body">
          <div class="wiki-kb-content"></div>
          <aside class="wiki-kb-sidebar" aria-label="Selected node details">
            <div class="wiki-kb-sidebar-header">
              <span class="wiki-kb-sidebar-type" data-type="">unknown</span>
              <span class="wiki-kb-sidebar-name">No selection</span>
              <button type="button" class="wiki-kb-sidebar-close" aria-label="Close details">x</button>
            </div>
            <div class="wiki-kb-sidebar-toggle">
              <div class="wiki-kb-toggle-group">
                <button type="button" class="wiki-kb-toggle-button active" data-mode="markdown" aria-pressed="true">Markdown</button>
                <button type="button" class="wiki-kb-toggle-button" data-mode="raw" aria-pressed="false">Raw</button>
              </div>
            </div>
            <div class="wiki-kb-sidebar-description"></div>
            <div class="wiki-kb-sidebar-tags"></div>
            <div class="wiki-kb-sidebar-body"></div>
            <section class="wiki-kb-sidebar-related" hidden>
              <div class="wiki-kb-sidebar-related-label">Related</div>
              <div class="wiki-kb-related-list"></div>
            </section>
          </aside>
        </div>
      </div>
    `

    contentEl = rootEl.querySelector('.wiki-kb-content')
    dom.statusEl = rootEl.querySelector('.wiki-kb-status')
    dom.sidebarEl = rootEl.querySelector('.wiki-kb-sidebar')
    dom.sidebarTypeEl = rootEl.querySelector('.wiki-kb-sidebar-type')
    dom.sidebarNameEl = rootEl.querySelector('.wiki-kb-sidebar-name')
    dom.sidebarDescriptionEl = rootEl.querySelector('.wiki-kb-sidebar-description')
    dom.sidebarTagsEl = rootEl.querySelector('.wiki-kb-sidebar-tags')
    dom.sidebarBodyEl = rootEl.querySelector('.wiki-kb-sidebar-body')
    dom.relatedSectionEl = rootEl.querySelector('.wiki-kb-sidebar-related')
    dom.relatedListEl = rootEl.querySelector('.wiki-kb-related-list')

    applyWikiKBSemanticTarget(rootEl.querySelector('.wiki-kb-sidebar-close'), {
      id: 'sidebar-close',
      name: 'Close details',
      action: 'close_details',
      aosRef: wikiKBAosRef('sidebar', 'close'),
    })
    syncSidebarToggle()

    rootEl.addEventListener('click', onRootClick)
    updateStatus()
    switchView(activeViewId)
  }

  return {
    manifest: {
      name: 'wiki-kb',
      title: 'Wiki KB',
      accepts: ['graph', 'graph/update', 'reveal', 'clear-selection', 'set-view'],
      emits: ['selection'],
      channelPrefix: 'wiki-kb',
      defaultSize: { w: 860, h: 580 },
    },

    render(host_) {
      host = host_
      rootEl = document.createElement('div')
      rootEl.className = 'wiki-kb-root'
      buildDOM()
      return rootEl
    },

    onMessage(msg) {
      const type = canonicalMessageType(msg?.type)
      if (!type) {
        if (msg?.type === 'reveal') {
          const payload = msg?.payload || {}
          if (payload.view) switchView(payload.view)
          const node = resolveRevealTarget(payload)
          if (node) setSelection(node)
          return
        }
        if (msg?.type === 'clear-selection') {
          clearSelection()
          return
        }
        if (msg?.type === 'set-view') {
          const view = msg?.payload?.view || msg?.payload?.id || msg?.payload
          if (typeof view === 'string' && VIEW_DEFS.some((entry) => entry.id === view)) {
            switchView(view)
          }
          return
        }
        return
      }

      const payload = msg?.payload || {}
      if (type === 'graph') applySnapshot(payload)
      else applyUpdate(payload)
    },
  }
}

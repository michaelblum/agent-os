// wiki-kb - Toolkit content for exploring wiki graph data.
//
// The component accepts graph snapshots plus incremental updates and renders
// two synchronized graph layout modes: force-directed and radial.

import GraphView from './views/graph.js'
import RadialGraphView from './views/radial-graph.js'
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
import {
  createWikiSubjectSelectionPayload,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../workbench/wiki-subject-opening.js'
import { createButton } from '../../controls/button.js'
import { createButtonGroup } from '../../controls/button-group.js'
import { createSelect } from '../../controls/select.js'

const LAYOUT_MODE_DEFS = [
  { id: 'graph', label: 'Graph', factory: GraphView },
  { id: 'radial-graph', label: 'Radial Graph', factory: RadialGraphView },
]

function resolveLayoutModeDefs(layoutModeIds) {
  if (!Array.isArray(layoutModeIds) || layoutModeIds.length === 0) return LAYOUT_MODE_DEFS
  const allowed = new Set(layoutModeIds.map((id) => String(id)))
  const defs = LAYOUT_MODE_DEFS.filter((entry) => allowed.has(entry.id))
  return defs.length > 0 ? defs : LAYOUT_MODE_DEFS
}

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

function addClassNames(el, className = '') {
  for (const name of String(className || '').split(/\s+/).filter(Boolean)) {
    el.classList.add(name)
  }
}

export default function WikiKB(options = {}) {
  const chromeMode = options.chrome === 'embedded' ? 'embedded' : 'default'
  const layoutModeDefs = resolveLayoutModeDefs(options.layoutModes)
  let host = null
  let rootEl = null
  let contentEl = null
  let activeLayoutModeId = layoutModeDefs[0]?.id || 'graph'
  let sidebarMode = 'markdown'
  let selectedNodeId = null
  let graphState = normalizeGraphPayload({})
  let layoutModeControl = null
  const layoutInstances = new Map()
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
    host?.emit?.(WIKI_SUBJECT_SELECTION_TYPE, null)
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
      const control = createButton({ label: '' })
      const button = control.el
      addClassNames(button, 'wiki-kb-related-link')
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

  function focusActiveLayoutOnSelection() {
    const node = currentNode()
    const layout = layoutInstances.get(activeLayoutModeId)
    if (!layout || !node) return
    layout.instance.focusNode?.(node)
  }

  function emitSelection(node) {
    const payload = node ? createWikiSubjectSelectionPayload(node) : null
    host?.emit?.('selection', node ? {
      id: node.id,
      path: node.path || node.id,
      name: node.name,
      type: node.type || 'unknown',
      tags: [...node.tags],
      plugin: node.plugin || null,
      entry_handle: payload?.entry_handle || null,
      subject: payload?.subject || null,
    } : null)
    host?.emit?.(WIKI_SUBJECT_SELECTION_TYPE, payload)
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
    focusActiveLayoutOnSelection()
    if (emitSelectionEvent) emitSelection(selectedNode)
  }

  function clearSelection(options = {}) {
    const { emitSelectionEvent = true } = options
    selectedNodeId = null
    dom.sidebarEl.classList.remove('open')
    dom.relatedListEl.replaceChildren()
    const activeLayout = layoutInstances.get(activeLayoutModeId)
    activeLayout?.instance.clearSelection?.()
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

  function feedLayouts() {
    for (const { instance } of layoutInstances.values()) {
      instance.load(graphState)
    }
  }

  function ensureLayoutMode(id) {
    const existing = layoutInstances.get(id)
    if (existing) return existing

    const definition = layoutModeDefs.find((entry) => entry.id === id)
    if (!definition) throw new Error(`Unknown wiki-kb layout mode '${id}'`)

    const instance = definition.factory({
      onSelectNode(node) {
        setSelection(node)
      },
    })
    const layoutEl = instance.mount()
    layoutEl.classList.add('wiki-kb-layout')
    layoutEl.id = `wiki-kb-layout-${id}`
    layoutEl.setAttribute('role', 'region')
    layoutEl.setAttribute('aria-label', `${definition.label} layout`)
    layoutEl.dataset.value = id
    layoutEl.hidden = true
    contentEl.appendChild(layoutEl)

    const created = { instance, layoutEl }
    layoutInstances.set(id, created)
    instance.load(graphState)
    return created
  }

  function activateLayoutMode(id) {
    activeLayoutModeId = id
    for (const [layoutModeId, entry] of layoutInstances.entries()) {
      const isActive = layoutModeId === id
      entry.layoutEl.hidden = !isActive
      if (isActive) entry.instance.onActivate?.()
      else entry.instance.onDeactivate?.()
    }
    layoutModeControl?.setValue(id, { emit: false })
    for (const button of rootEl.querySelectorAll('.wiki-kb-layout-mode-button')) {
      const isActive = button.dataset.layoutMode === id
      button.classList.toggle('active', isActive)
      button.setAttribute('aria-pressed', String(isActive))
      const layoutMode = layoutModeDefs.find((entry) => entry.id === button.dataset.layoutMode)
      applyWikiKBSemanticTarget(button, {
        id: `layout-mode-${button.dataset.layoutMode}`,
        name: `${layoutMode?.label || button.textContent} layout`,
        action: 'set_layout_mode',
        aosRef: wikiKBAosRef('layout-mode', button.dataset.layoutMode),
        pressed: isActive,
      })
    }
    if (dom.layoutModeSelectControl) {
      dom.layoutModeSelectControl.setValue(id, { emit: false })
      const layoutMode = layoutModeDefs.find((entry) => entry.id === id)
      applyWikiKBSemanticTarget(dom.layoutModeSelectEl, {
        id: 'layout-mode-select',
        role: 'AXPopUpButton',
        name: 'Wiki graph layout mode',
        action: 'set_layout_mode',
        value: layoutMode?.label || id,
      })
    }
    focusActiveLayoutOnSelection()
  }

  function switchLayoutMode(id) {
    ensureLayoutMode(id)
    activateLayoutMode(id)
  }

  function syncSelectionAfterData() {
    const node = currentNode()
    if (!node) {
      closeSidebar()
      for (const { instance } of layoutInstances.values()) {
        instance.clearSelection?.()
      }
      return
    }
    renderSidebar(node)
    focusActiveLayoutOnSelection()
  }

  function applySnapshot(payload) {
    graphState = normalizeGraphPayload(payload)
    updateStatus()
    feedLayouts()
    syncSelectionAfterData()
  }

  function applyUpdate(payload) {
    graphState = applyGraphUpdate(graphState, payload)
    updateStatus()
    feedLayouts()
    syncSelectionAfterData()
  }

  function onRootClick(event) {
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
        ${chromeMode === 'embedded' ? `
          ${layoutModeDefs.length > 1 ? `
            <div class="wiki-kb-compact-chrome" aria-label="Wiki graph layout controls">
              <label class="wiki-kb-layout-mode-menu" title="Select graph layout">
                <span>Layout</span>
                <span data-role="wiki-kb-layout-mode-select"></span>
              </label>
              <span class="wiki-kb-status" role="status" aria-live="polite"></span>
            </div>
          ` : `<span class="wiki-kb-status wiki-kb-floating-status" role="status" aria-live="polite"></span>`}
        ` : `
          <div class="wiki-kb-layout-mode-bar" aria-label="Wiki graph layout controls">
            <span data-role="wiki-kb-layout-mode-control"></span>
            <div class="wiki-kb-layout-mode-spacer"></div>
            <span class="wiki-kb-status" role="status" aria-live="polite"></span>
          </div>
        `}
        <div class="wiki-kb-body">
          <div class="wiki-kb-content"></div>
          <aside class="wiki-kb-sidebar" aria-label="Selected node details">
            <div class="wiki-kb-sidebar-header">
              <span class="wiki-kb-sidebar-type" data-type="">unknown</span>
              <span class="wiki-kb-sidebar-name">No selection</span>
              <span data-role="wiki-kb-sidebar-close"></span>
            </div>
            <div class="wiki-kb-sidebar-toggle">
              <span data-role="wiki-kb-sidebar-toggle"></span>
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
    const layoutModeSelectSlot = rootEl.querySelector('[data-role="wiki-kb-layout-mode-select"]')
    if (layoutModeSelectSlot) {
      const layoutModeSelect = createSelect({
        value: activeLayoutModeId,
        options: layoutModeDefs.map((layoutMode) => ({ value: layoutMode.id, label: layoutMode.label })),
        onChange(nextLayoutModeId) {
          if (typeof nextLayoutModeId === 'string' && nextLayoutModeId !== activeLayoutModeId) {
            switchLayoutMode(nextLayoutModeId)
          }
        },
      })
      dom.layoutModeSelectControl = layoutModeSelect
      dom.layoutModeSelectEl = layoutModeSelect.el
      const layoutModeSelectTrigger = layoutModeSelect.el.querySelector('[data-aos-select-trigger]')
      addClassNames(dom.layoutModeSelectEl, 'wiki-kb-layout-mode-select')
      dom.layoutModeSelectEl.setAttribute('aria-label', 'Wiki graph layout mode')
      addClassNames(layoutModeSelectTrigger, 'wiki-kb-layout-mode-select')
      layoutModeSelectTrigger?.setAttribute('aria-label', 'Wiki graph layout mode')
      layoutModeSelectSlot.replaceWith(layoutModeSelect.el)
    } else {
      dom.layoutModeSelectControl = null
      dom.layoutModeSelectEl = null
    }
    const layoutModeControlSlot = rootEl.querySelector('[data-role="wiki-kb-layout-mode-control"]')
    if (layoutModeControlSlot) {
      layoutModeControl = createButtonGroup({
        value: activeLayoutModeId,
        options: layoutModeDefs.map((layoutMode) => ({ value: layoutMode.id, label: layoutMode.label })),
        onChange(nextLayoutModeId) {
          if (typeof nextLayoutModeId === 'string' && nextLayoutModeId !== activeLayoutModeId) {
            switchLayoutMode(nextLayoutModeId)
          }
        },
      })
      addClassNames(layoutModeControl.el, 'wiki-kb-layout-mode-control')
      layoutModeControl.el.setAttribute('aria-label', 'Graph layout mode')
      for (const button of layoutModeControl.el.querySelectorAll('button')) {
        addClassNames(button, 'wiki-kb-layout-mode-button')
        button.dataset.layoutMode = button.dataset.value
      }
      layoutModeControlSlot.replaceWith(layoutModeControl.el)
    } else {
      layoutModeControl = null
    }
    dom.sidebarEl = rootEl.querySelector('.wiki-kb-sidebar')
    dom.sidebarTypeEl = rootEl.querySelector('.wiki-kb-sidebar-type')
    dom.sidebarNameEl = rootEl.querySelector('.wiki-kb-sidebar-name')
    dom.sidebarDescriptionEl = rootEl.querySelector('.wiki-kb-sidebar-description')
    dom.sidebarTagsEl = rootEl.querySelector('.wiki-kb-sidebar-tags')
    dom.sidebarBodyEl = rootEl.querySelector('.wiki-kb-sidebar-body')
    dom.relatedSectionEl = rootEl.querySelector('.wiki-kb-sidebar-related')
    dom.relatedListEl = rootEl.querySelector('.wiki-kb-related-list')

    const sidebarCloseSlot = rootEl.querySelector('[data-role="wiki-kb-sidebar-close"]')
    const closeControl = createButton({ label: 'x' })
    addClassNames(closeControl.el, 'wiki-kb-sidebar-close')
    closeControl.el.setAttribute('aria-label', 'Close details')
    sidebarCloseSlot?.replaceWith(closeControl.el)
    const sidebarToggleSlot = rootEl.querySelector('[data-role="wiki-kb-sidebar-toggle"]')
    const sidebarToggle = createButtonGroup({
      value: 'markdown',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'raw', label: 'Raw' },
      ],
    })
    addClassNames(sidebarToggle.el, 'wiki-kb-toggle-group')
    for (const button of sidebarToggle.el.querySelectorAll('button')) {
      addClassNames(button, 'wiki-kb-toggle-button')
      button.dataset.mode = button.dataset.value
    }
    sidebarToggleSlot?.replaceWith(sidebarToggle.el)

    applyWikiKBSemanticTarget(rootEl.querySelector('.wiki-kb-sidebar-close'), {
      id: 'sidebar-close',
      name: 'Close details',
      action: 'close_details',
      aosRef: wikiKBAosRef('sidebar', 'close'),
    })
    syncSidebarToggle()

    rootEl.addEventListener('click', onRootClick)
    updateStatus()
    switchLayoutMode(activeLayoutModeId)
  }

  return {
    manifest: {
      name: 'wiki-kb',
      title: 'Wiki KB',
      accepts: ['graph', 'graph/update', 'reveal', 'clear-selection', 'set-layout-mode', 'fit-layout'],
      emits: ['selection', WIKI_SUBJECT_SELECTION_TYPE],
      channelPrefix: 'wiki-kb',
      defaultSize: { w: 860, h: 580 },
    },

    render(host_) {
      host = host_
      rootEl = document.createElement('div')
      rootEl.className = 'wiki-kb-root'
      rootEl.dataset.chrome = chromeMode
      buildDOM()
      return rootEl
    },

    onMessage(msg) {
      const type = canonicalMessageType(msg?.type)
      if (!type) {
        if (msg?.type === 'reveal') {
          const payload = msg?.payload || {}
          if (payload.layoutMode) switchLayoutMode(payload.layoutMode)
          const node = resolveRevealTarget(payload)
          if (node) setSelection(node)
          return
        }
        if (msg?.type === 'clear-selection') {
          clearSelection()
          return
        }
        if (msg?.type === 'set-layout-mode') {
          const layoutMode = msg?.payload?.layoutMode || msg?.payload?.id || msg?.payload
          if (typeof layoutMode === 'string' && layoutModeDefs.some((entry) => entry.id === layoutMode)) {
            switchLayoutMode(layoutMode)
          }
          return
        }
        if (msg?.type === 'fit-layout') {
          const activeLayout = layoutInstances.get(activeLayoutModeId)
          activeLayout?.instance.fit?.()
          return
        }
        return
      }

      const payload = msg?.payload || {}
      if (type === 'graph') applySnapshot(payload)
      else applyUpdate(payload)
    },

    teardown() {
      layoutModeControl?.destroy()
      layoutModeControl = null
    },
  }
}

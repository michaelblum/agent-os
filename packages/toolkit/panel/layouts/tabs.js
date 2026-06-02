// tabs.js — multiple contents, one visible at a time, tab strip in header.
//
// Tabs(factories) returns a layout instance. mountPanel detects layout.kind
// and calls layout.mount(chrome) to set up the tab strip + content slots.

import { wireBridge, emit } from '../../runtime/bridge.js'
import { subscribe } from '../../runtime/subscribe.js'
import { evalCanvas, spawnChild } from '../../runtime/canvas.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js'
import { createAosZagTabs } from '../../adapters/zag/tabs.js'
import { createRouter } from '../router.js'

const TABS_SURFACE = 'panel-tabs'

function text(value, fallback = '') {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s || fallback
}

function refPart(value, fallback = 'target') {
  return text(value, fallback).replace(/[^a-zA-Z0-9_-]/g, '-')
}

function tabValue(content = {}, index = 0) {
  return refPart(content.manifest?.name || content.manifest?.title, `tab-${index + 1}`)
}

export function panelTabAosRef(panelName, tabID) {
  return [TABS_SURFACE, refPart(panelName, 'tabs-panel'), refPart(tabID, 'tab')].join(':')
}

export function panelTabSemanticTarget(content = {}, index = 0, options = {}) {
  const label = text(content.manifest?.title || content.manifest?.name, `tab ${index + 1}`)
  const tabID = text(content.manifest?.name, `tab-${index + 1}`)
  return {
    id: `tab-${tabID}`,
    role: 'AXTab',
    name: label,
    action: 'tabs/activate',
    surface: TABS_SURFACE,
    ref: panelTabAosRef(options.panelName, tabID),
    selected: !!options.selected,
  }
}

function applyPanelTabSemanticTarget(element, content, index, options = {}) {
  return applySemanticTargetAttributes(
    element,
    panelTabSemanticTarget(content, index, options),
    {
      idPrefix: null,
      visibleLabel: true,
    },
  )
}

export function Tabs(factories, options = {}) {
  if (!Array.isArray(factories) || factories.length === 0) {
    throw new Error('Tabs: requires a non-empty array of content factories')
  }
  const onActivate = typeof options.onActivate === 'function' ? options.onActivate : null

  let activateByPayloadRef = null

  return {
    kind: 'tabs',
    factories,
    activate(payload = {}) {
      return activateByPayloadRef ? activateByPayloadRef(payload) : false
    },
    mount(chrome) {
      // Instantiate all contents up front (they live for the panel's lifetime).
      const contents = factories.map(f => typeof f === 'function' ? f() : f)
      const hostByContent = new Map()
      const elByContent = new Map()
      // Retained for future programmatic activation API (tear-off, keyboard nav).
      let activeIdx = -1
      const panelName = chrome.titleEl.textContent || 'tabs-panel'
      const tabsId = `${refPart(panelName, 'tabs-panel')}-tabs`
      const values = contents.map((content, index) => tabValue(content, index))

      chrome.contentEl.innerHTML = ''
      chrome.contentEl.dataset.layout = 'tabs'

      const tabRoot = document.createElement('div')
      tabRoot.className = 'aos-tab-shell'
      tabRoot.setAttribute('data-aos-tabs-root', '')
      chrome.contentEl.appendChild(tabRoot)

      const tabStrip = document.createElement('div')
      tabStrip.className = 'aos-tabs'
      tabStrip.setAttribute('data-aos-tabs-list', '')
      tabRoot.appendChild(tabStrip)

      const tabPanels = document.createElement('div')
      tabPanels.className = 'aos-tab-panels'
      tabRoot.appendChild(tabPanels)

      const tabButtons = contents.map((c, i) => {
        const label = c.manifest?.title || c.manifest?.name || `tab ${i + 1}`
        const btn = document.createElement('button')
        btn.className = 'aos-tab'
        btn.textContent = label
        btn.dataset.value = values[i]
        btn.setAttribute('data-aos-tabs-trigger', '')
        applyPanelTabSemanticTarget(btn, c, i, { panelName, selected: false })
        tabStrip.appendChild(btn)
        return btn
      })

      // Build content slots (one wrapper per content, hidden when not active).
      contents.forEach((c, i) => {
        const slot = document.createElement('div')
        slot.className = 'aos-tab-content'
        slot.setAttribute('role', 'tabpanel')
        slot.dataset.value = values[i]
        slot.setAttribute('data-aos-tabs-content', '')
        const tabButtonID = `${tabsId}-trigger-${values[i]}`
        const slotID = `${tabsId}-content-${values[i]}`
        slot.setAttribute('id', slotID)
        slot.setAttribute('aria-labelledby', tabButtonID)
        tabButtons[i].setAttribute('aria-controls', slotID)
        tabPanels.appendChild(slot)
        elByContent.set(c, slot)

        const host = makeHost(slot, c)
        hostByContent.set(c, host)

        const rendered = c.render(host)
        if (rendered instanceof Node) slot.appendChild(rendered)
        else if (typeof rendered === 'string') slot.innerHTML = rendered

        // Auto-subscribe to streams in manifest.requires
        const requires = c.manifest?.requires || []
        if (requires.length > 0) subscribe(requires, { snapshot: true })
      })

      const zagTabs = createAosZagTabs({
        id: tabsId,
        defaultValue: values[0],
        onValueChange({ value }) {
          const idx = values.indexOf(value)
          if (idx >= 0) activate(idx, { fromZag: true })
        },
      })
      zagTabs.bindRoot(tabRoot)
      zagTabs.bindList(tabStrip)
      tabButtons.forEach((button, index) => {
        zagTabs.bindTrigger(button, { value: values[index] }, index)
      })
      contents.forEach((content, index) => {
        zagTabs.bindContent(elByContent.get(content), { value: values[index] }, index)
      })

      function activateByPayload(payload = {}) {
        if (Number.isInteger(payload.index) && payload.index >= 0 && payload.index < contents.length) {
          activate(payload.index)
          return true
        }
        if (typeof payload.index === 'number' && payload.index >= 0 && payload.index < contents.length) {
          activate(Math.trunc(payload.index))
          return true
        }
        if (typeof payload.name === 'string') {
          const idx = contents.findIndex((content) => content.manifest?.name === payload.name)
          if (idx >= 0) {
            activate(idx)
            return true
          }
        }
        if (typeof payload.title === 'string') {
          const idx = contents.findIndex((content) => (content.manifest?.title || content.manifest?.name) === payload.title)
          if (idx >= 0) {
            activate(idx)
            return true
          }
        }
        return false
      }

      activateByPayloadRef = activateByPayload

      // Manifest at the panel level: union of constituent manifests.
      declareManifest({
        name: chrome.titleEl.textContent || 'tabs-panel',
        accepts: [
          'tabs/activate',
          ...contents.flatMap(c => (c.manifest?.accepts || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        ],
        emits: [
          'tabs/activated',
          ...contents.flatMap(c => (c.manifest?.emits || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        ],
        contents: contents.map(c => ({ name: c.manifest?.name, prefix: c.manifest?.channelPrefix })),
      })

      // Router: dispatch by manifest prefix
      const router = createRouter({ contents, hostByContent })
      wireBridge((msg) => {
        if (msg?.type === 'tabs/activate') {
          activateByPayload(msg.payload || {})
          return
        }
        router(msg)
      })

      function activate(idx, options = {}) {
        if (idx === activeIdx) return
        activeIdx = idx
        if (!options.fromZag) zagTabs.setValue(values[idx], { silent: true })
        contents.forEach((c, i) => {
          const isActive = i === idx
          const slot = elByContent.get(c)
          slot.hidden = !isActive
          slot.dataset.active = String(isActive)
          applyPanelTabSemanticTarget(tabButtons[i], c, i, { panelName, selected: isActive })
          tabButtons[i].classList.toggle('active', isActive)
          tabButtons[i].dataset.active = String(isActive)
        })
        const content = contents[idx]
        const activationInfo = {
          index: idx,
          title: content.manifest?.title || content.manifest?.name || `tab ${idx + 1}`,
          name: content.manifest?.name || null,
        }
        emit('tabs/activated', activationInfo)
        if (onActivate) {
          try {
            onActivate({
              index: activationInfo.index,
              title: activationInfo.title,
              manifest: content.manifest || null,
            }, hostByContent.get(content))
          } catch (error) {
            console.error('[panel/tabs] onActivate failed', error)
          }
        }
      }

      activate(0)
      emitReady()
    },
  }
}

function makeHost(slotEl, content) {
  return {
    contentEl: slotEl,
    // In Tabs mode, individual contents should not change the panel title.
    // No-op to prevent throws from contents that call host.setTitle().
    setTitle() {},
    emit(type, payload) {
      const prefix = content.manifest?.channelPrefix
      const fullType = prefix ? `${prefix}/${type}` : type
      emit(fullType, payload)
    },
    subscribe(events, options) { subscribe(events, options) },
    spawnChild(opts) { return spawnChild(opts) },
    evalCanvas(id, js, options) { return evalCanvas(id, js, options) },
  }
}

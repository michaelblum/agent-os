// tabs.js — multiple contents, one visible at a time, tab strip in header.
//
// Tabs(factories) returns a layout instance. mountPanel detects layout.kind
// and calls layout.mount(chrome) to set up the tab strip + content slots.

import { wireBridge, emit } from '../../runtime/bridge.js'
import { subscribe } from '../../runtime/subscribe.js'
import { evalCanvas, spawnChild } from '../../runtime/canvas.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { createRouter } from '../router.js'

export function Tabs(factories, options = {}) {
  if (!Array.isArray(factories) || factories.length === 0) {
    throw new Error('Tabs: requires a non-empty array of content factories')
  }
  const onActivate = typeof options.onActivate === 'function' ? options.onActivate : null

  return {
    kind: 'tabs',
    factories,
    mount(chrome) {
      // Instantiate all contents up front (they live for the panel's lifetime).
      const contents = factories.map(f => typeof f === 'function' ? f() : f)
      const hostByContent = new Map()
      const elByContent = new Map()
      // Retained for future programmatic activation API (tear-off, keyboard nav).
      let activeIdx = -1

      // Build tab strip in the header's controls slot.
      const tabStrip = document.createElement('div')
      tabStrip.className = 'aos-tabs'
      tabStrip.setAttribute('role', 'tablist')
      chrome.controlsEl.appendChild(tabStrip)

      const tabButtons = contents.map((c, i) => {
        const label = c.manifest?.title || c.manifest?.name || `tab ${i + 1}`
        const btn = document.createElement('button')
        btn.className = 'aos-tab'
        btn.type = 'button'
        btn.textContent = label
        btn.setAttribute('role', 'tab')
        btn.addEventListener('click', () => activate(i))
        tabStrip.appendChild(btn)
        return btn
      })

      // Build content slots (one wrapper per content, hidden when not active).
      contents.forEach((c, i) => {
        const slot = document.createElement('div')
        slot.className = 'aos-tab-content'
        slot.setAttribute('role', 'tabpanel')
        chrome.contentEl.appendChild(slot)
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

      // Manifest at the panel level: union of constituent manifests.
      declareManifest({
        name: chrome.titleEl.textContent || 'tabs-panel',
        accepts: contents.flatMap(c => (c.manifest?.accepts || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        emits: contents.flatMap(c => (c.manifest?.emits || []).map(t => `${c.manifest?.channelPrefix}/${t}`)),
        contents: contents.map(c => ({ name: c.manifest?.name, prefix: c.manifest?.channelPrefix })),
      })

      // Router: dispatch by manifest prefix
      const router = createRouter({ contents, hostByContent })
      wireBridge(router)

      function activate(idx) {
        if (idx === activeIdx) return
        activeIdx = idx
        contents.forEach((c, i) => {
          const isActive = i === idx
          const slot = elByContent.get(c)
          slot.hidden = !isActive
          slot.dataset.active = String(isActive)
          tabButtons[i].classList.toggle('active', isActive)
          tabButtons[i].setAttribute('aria-selected', String(isActive))
          tabButtons[i].dataset.active = String(isActive)
        })
        if (onActivate) {
          const content = contents[idx]
          try {
            onActivate({
              index: idx,
              title: content.manifest?.title || content.manifest?.name || `tab ${idx + 1}`,
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

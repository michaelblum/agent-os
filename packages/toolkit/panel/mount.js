// mount.js — entry point that orchestrates chrome + content + bridge wiring.
//
// Consumers call mountPanel({ title, layout: Single(Content) }) once at boot.

import { mountChrome } from './chrome.js'
import { wireBridge, emit } from '../runtime/bridge.js'
import { subscribe } from '../runtime/subscribe.js'
import { spawnChild } from '../runtime/canvas.js'
import { declareManifest, emitReady } from '../runtime/manifest.js'
import { createRouter } from './router.js'

export function mountPanel({ title = 'AOS', layout, draggable = true, container = document.body } = {}) {
  if (!layout) throw new Error('mountPanel: layout is required')

  const chrome = mountChrome(container, { title, draggable })

  if (layout.kind === 'single') {
    const content = layout.instantiate()
    mountSingle(chrome, content)
  } else if (layout.kind === 'tabs') {
    layout.mount(chrome)
  } else {
    throw new Error(`mountPanel: unknown layout kind '${layout.kind}'`)
  }

  return chrome
}

function mountSingle(chrome, content) {
  const host = makeHost(chrome.contentEl, content)
  if (content.manifest) declareManifest(content.manifest)

  const router = createRouter({
    contents: [content],
    hostByContent: new Map([[content, host]]),
  })
  wireBridge(router)

  // Auto-subscribe to streams declared in manifest.requires
  const requires = content.manifest?.requires || []
  if (requires.length > 0) subscribe(requires)

  // Render
  const rendered = content.render(host)
  chrome.contentEl.innerHTML = ''
  if (rendered instanceof Node) chrome.contentEl.appendChild(rendered)
  else if (typeof rendered === 'string') chrome.contentEl.innerHTML = rendered

  emitReady()
}

function makeHost(contentEl, content) {
  return {
    contentEl,
    emit(type, payload) {
      const prefix = content.manifest?.channelPrefix
      const fullType = prefix ? `${prefix}/${type}` : type
      emit(fullType, payload)
    },
    subscribe(events) { subscribe(events) },
    spawnChild(opts) { return spawnChild(opts) },
  }
}

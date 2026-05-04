// mount.js — entry point that orchestrates chrome + content + bridge wiring.
//
// Consumers call mountPanel({ title, layout: Single(Content) }) once at boot.

import { mountChrome } from './chrome.js'
import { wireBridge, emit } from '../runtime/bridge.js'
import { subscribe } from '../runtime/subscribe.js'
import { evalCanvas, spawnChild } from '../runtime/canvas.js'
import { declareManifest, emitLifecycleComplete, emitReady } from '../runtime/manifest.js'
import { createRouter } from './router.js'

export function mountPanel({
  title = 'AOS',
  layout,
  draggable = true,
  close = true,
  minimize = true,
  onClose,
  onMinimize,
  container = document.body,
} = {}) {
  if (!layout) throw new Error('mountPanel: layout is required')

  const chrome = mountChrome(container, { title, draggable, close, minimize, onClose, onMinimize })

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
  const host = makeHost(chrome, content)
  if (content.manifest) declareManifest(content.manifest)

  const router = createRouter({
    contents: [content],
    hostByContent: new Map([[content, host]]),
  })
  wireBridge(router)
  wireBridge((msg) => {
    if (msg?.type === 'lifecycle' && (msg.action === 'resume' || msg.action === 'suspend')) {
      emitLifecycleComplete(msg.action)
    }
  })

  // Render
  const rendered = content.render(host)
  chrome.contentEl.innerHTML = ''
  if (rendered instanceof Node) chrome.contentEl.appendChild(rendered)
  else if (typeof rendered === 'string') chrome.contentEl.innerHTML = rendered

  // Auto-subscribe to streams declared in manifest.requires. Render first so
  // snapshot replays cannot land before the content has state + DOM ready.
  const requires = content.manifest?.requires || []
  if (requires.length > 0) subscribe(requires, { snapshot: true })

  emitReady()
}

function makeHost(chrome, content) {
  return {
    contentEl: chrome.contentEl,
    setTitle(text) { chrome.setTitle(text) },
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

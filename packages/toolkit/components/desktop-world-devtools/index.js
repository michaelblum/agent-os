import { emit, wireBridge } from '../../runtime/bridge.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { mountChrome } from '../../panel/chrome.js'
import { createDesktopWorldDevToolsView } from '../../scene/desktop-world-devtools-view.js'

const root = document.getElementById('desktop-world-devtools-root')
let view = null
const chrome = mountChrome(root, {
  title: 'DesktopWorld Inspector',
  maximize: true,
  resizable: true,
  onClose: () => {
    if (view?.request('close') !== true) {
      emit('desktop_world_devtools.host.command', { action: 'close' })
    }
  },
})
const viewRoot = document.createElement('div')
viewRoot.className = 'desktop-world-devtools-view'
chrome.contentEl.appendChild(viewRoot)

view = createDesktopWorldDevToolsView({
  root: viewRoot,
  onCommand: (command) => emit('desktop_world_devtools.host.command', command),
})

declareManifest({
  name: 'desktop-world-devtools',
  accepts: [
    'desktop_world_devtools.snapshot',
    'desktop_world_devtools.host.activate',
    'desktop_world_devtools.host.suspend',
    'desktop_world_devtools.host.close',
  ],
  emits: ['ready', 'desktop_world_devtools.host.ready', 'desktop_world_devtools.host.command'],
  surface: 'panel',
})

wireBridge((message) => {
  if (message?.type === 'desktop_world_devtools.snapshot') {
    view.update(message.payload)
    return
  }
  if (message?.type === 'desktop_world_devtools.host.activate') {
    view.setActive(true)
    emit('desktop_world_devtools.host.ready')
    return
  }
  if (message?.type === 'desktop_world_devtools.host.suspend') {
    view.setActive(false)
    return
  }
  if (message?.type === 'desktop_world_devtools.host.close') view.dispose()
})

window.addEventListener('pagehide', () => view.dispose(), { once: true })
emitReady()
emit('desktop_world_devtools.host.ready')

import { wireBridge } from '../../runtime/bridge.js'
import { DesktopWorldSurface2D } from '../../runtime/desktop-world-surface-2d.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import {
  applyDesktopWorldStageMessage,
  createDesktopWorldStageState,
  desktopWorldStageSnapshot,
  renderDesktopWorldStageLayers,
} from './model.js'

const root = document.getElementById('desktop-world-stage-root')
const canvasId = window.__aosSurfaceCanvasId || window.__aosCanvasId || 'aos-desktop-world-stage'
const surface = new DesktopWorldSurface2D({ canvasId })
const state = createDesktopWorldStageState()

function render() {
  if (!root) return
  surface.applyWorldTransform(root)
  root.innerHTML = renderDesktopWorldStageLayers(state)
  window.__desktopWorldStageState = desktopWorldStageSnapshot(state)
}

declareManifest({
  name: 'desktop-world-stage',
  accepts: [
    'desktop_world_stage.layer.upsert',
    'desktop_world_stage.layer.remove',
    'desktop_world_stage.layers.replace',
    'desktop_world_stage.clear',
  ],
  emits: ['ready'],
  surface: 'desktop-world',
})

wireBridge((message) => {
  if (applyDesktopWorldStageMessage(state, message)) render()
})

surface.start({
  onInit: render,
  onTopologyChange: render,
}).then(render)

render()
emitReady()

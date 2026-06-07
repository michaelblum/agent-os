import { emit, wireBridge } from '../../runtime/bridge.js'
import { DesktopWorldSurface2D } from '../../runtime/desktop-world-surface-2d.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { createVisualObjectDescriptor } from '../../workbench/visual-object-contract.js'
import { applyVisualObjectControllerUpdate } from '../../workbench/visual-object-controller.js'
import {
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../workbench/visual-object-resource-lifecycle.js'
import {
  applyDesktopWorldStageMessage,
  createDesktopWorldStageState,
  desktopWorldStageRegistry,
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
  emit('canvas_object.registry', desktopWorldStageRegistry(state, { canvasId }))
}

function installVisualObjectLiveProof() {
  window.__desktopWorldStageVisualObjectProof = {
    run({
      layerId = 'visual-object-live-proof',
      editValues = [144, 188, 232, 276],
    } = {}) {
      if (!root) return { ok: false, error: 'missing-root' }
      const initialLayer = {
        id: layerId,
        kind: 'outline',
        label: 'Lifecycle proof',
        frame: [96, 96, 120, 72],
        style: { color: 'rgba(122, 241, 255, 0.95)', fill: 'rgba(122, 241, 255, 0.08)' },
        metadata: { visual_object_live_proof: true },
      }
      applyDesktopWorldStageMessage(state, {
        type: 'desktop_world_stage.layer.upsert',
        payload: initialLayer,
      })
      render()

      const descriptor = createVisualObjectDescriptor({
        id: 'desktop-world-stage-layer-width',
        label: 'Stage layer width',
        kind: 'slider',
        technology: 'canvas-2d',
        state_path: 'desktop_world.stage.layers.visual_object_live_proof.frame.2',
        route: 'canvas_object.transform.patch',
        coerce: 'number',
        renderer_sync: ['renderDesktopWorldStageLayer'],
        group_key: 'desktop-world.stage',
        object_ids: [`desktop_world_stage.layer:${layerId}`],
      })
      const proofState = {
        desktop_world: {
          stage: {
            layers: {
              visual_object_live_proof: initialLayer,
            },
          },
        },
      }
      const beforeRoot = root
      const beforeLayer = state.layers.get(layerId)
      const startedAt = performance.now()
      let result = null
      for (const value of editValues) {
        result = applyVisualObjectControllerUpdate(descriptor, value, proofState, {
          routeHandlers: {
            'canvas_object.transform.patch': ({ mutation }) => mutation.state_path,
          },
          rendererSyncHandlers: {
            renderDesktopWorldStageLayer: ({ mutation }) => {
              const nextLayer = state.layers.get(layerId) || beforeLayer
              nextLayer.frame[2] = mutation.value
              state.layers.set(layerId, nextLayer)
              state.version += 1
              render()
              return nextLayer.frame[2]
            },
          },
        })
      }
      const durationMs = performance.now() - startedAt
      const afterLayer = state.layers.get(layerId)
      const cleanupRemoved = applyDesktopWorldStageMessage(state, {
        type: 'desktop_world_stage.layer.remove',
        payload: { id: layerId },
      })
      render()
      const cleanup = {
        removed: cleanupRemoved,
        canvas_id: canvasId,
        layer_id: layerId,
        remaining: state.layers.has(layerId) ? 1 : 0,
      }
      const evidence = createVisualObjectResourceLifecycleEvidence({
        descriptor,
        updateResult: result,
        editCount: editValues.length,
        retainedResources: [beforeRoot, beforeLayer],
        retainedResourceLimit: 2,
        identityStable: beforeRoot === root && beforeLayer === afterLayer,
        cleanupResult: cleanup,
        poolingBoundary: {
          owner: 'toolkit-desktop-world-stage',
          decision: 'not-applicable',
          rationale: 'The live DesktopWorld stage proof retains a DOM root and stage-layer target; GPU resource pooling is outside this canvas-2d path.',
        },
        proofWindow: {
          kind: 'live_desktop_world_stage_edit_loop',
          duration_ms: durationMs,
          iteration_limit: editValues.length,
        },
        jsonSerializableState: proofState,
      })
      return {
        ok: validateVisualObjectResourceLifecycleEvidence(evidence).ok,
        evidence,
        cleanup,
      }
    },
  }
}

declareManifest({
  name: 'desktop-world-stage',
  accepts: [
    'desktop_world_stage.layer.upsert',
    'desktop_world_stage.layer.remove',
    'desktop_world_stage.layers.replace',
    'desktop_world_stage.clear',
  ],
  emits: ['ready', 'canvas_object.registry'],
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
installVisualObjectLiveProof()
emitReady()

import { emit, wireBridge } from '../../runtime/bridge.js'
import { DesktopWorldSurface2D } from '../../runtime/desktop-world-surface-2d.js'
import { declareManifest, emitLifecycleComplete, emitReady } from '../../runtime/manifest.js'
import { createVisualObjectDescriptor } from '../../workbench/visual-object-contract.js'
import { handleDesktopWorldStageLifecycle } from './lifecycle.js'
import { createDesktopWorldSceneOutlet } from './scene-outlet.js'
import { createDesktopWorldSceneInteractionRuntime } from './scene-interaction-runtime.js'
import { createDesktopWorldSceneOperationCoordinator } from './scene-operation-coordinator.js'
import {
  projectDesktopWorldDevToolsTopology,
  projectSceneEventTopology,
} from './topology.js'
import { createDesktopWorldDevToolsStageProbe } from '../../scene/desktop-world-devtools.js'
import {
  registerInputKeyLease,
  registerInputRegion,
  removeInputRegion,
  updateInputRegion,
} from '../../runtime/input-region.js'
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
const sceneCanvas = document.getElementById('desktop-world-stage-scene')
const canvasId = window.__aosSurfaceCanvasId || window.__aosCanvasId || 'aos-desktop-world-stage'
const escapeKeyLeaseId = `${canvasId}:desktop-world:escape`
const surface = new DesktopWorldSurface2D({ canvasId })
const state = createDesktopWorldStageState()
const sceneOutlet = createDesktopWorldSceneOutlet({ canvas: sceneCanvas })
let sceneInteractions = null
let lastSceneError = null

function sceneTopologySnapshot() {
  return projectSceneEventTopology(surface.topology)
}

function devtoolsTopologySnapshot() {
  return projectDesktopWorldDevToolsTopology(surface.topology)
}

const devtoolsProbe = createDesktopWorldDevToolsStageProbe({
  emit: (snapshot) => {
    if (surface.isPrimary) emit('desktop_world_stage.devtools.snapshot', { snapshot })
  },
  getStageFacts: () => {
    const outlet = sceneOutlet.devtoolsSnapshot()
    const interaction = sceneInteractions?.devtoolsSnapshot() ?? {
      affordances: [],
      gestures: [],
      hitRegions: [],
      interactions: [],
    }
    const interactionCountByResource = new Map()
    for (const entry of interaction.interactions) {
      interactionCountByResource.set(entry.resourceId, (interactionCountByResource.get(entry.resourceId) ?? 0) + 1)
    }
    return {
      interactions: interaction.interactions,
      lastError: lastSceneError,
      resources: outlet.resources.map((entry) => ({
        ...entry,
        interactionCount: interactionCountByResource.get(entry.id) ?? 0,
      })),
      status: 'available',
      world: {
        affordances: interaction.affordances,
        displays: devtoolsTopologySnapshot().displays,
        gestures: interaction.gestures,
        hitRegions: interaction.hitRegions,
        nodes: outlet.nodes,
        routes: outlet.routes,
      },
    }
  },
})
sceneOutlet.setDevToolsProbe(devtoolsProbe)

sceneInteractions = createDesktopWorldSceneInteractionRuntime({
  stageCanvasId: canvasId,
  outlet: sceneOutlet,
  registerRegion: registerInputRegion,
  updateRegion: updateInputRegion,
  removeRegion: removeInputRegion,
  isPrimary: () => surface.isPrimary,
  topology: sceneTopologySnapshot,
  scheduleFrame: (callback) => window.requestAnimationFrame(() => callback()),
  emitEvent: (payload) => {
    emit('desktop_world_stage.scene.event', payload)
    devtoolsProbe.recordEvent({
      code: payload.event?.gesture?.cancellationReason ?? null,
      kind: `gesture.${payload.event?.gesture?.phase ?? 'unknown'}`,
      resourceId: payload.event?.resourceId ?? null,
    })
  },
})
sceneOutlet.setInteractionGeometryObserver((key, generation) => {
  void enqueueSceneWork(async () => {
    try {
      const settled = await sceneInteractions.settleAnimationGeometry(key, generation)
      if (settled) {
        devtoolsProbe.recordEvent({
          kind: 'interaction.animation_geometry.settled',
          resourceId: sceneInteractions.configuration(key)?.resource ?? null,
        })
      }
    } catch {
      const code = 'INPUT_REGION_SYNC_FAILED'
      lastSceneError = { at: Date.now(), code }
      devtoolsProbe.recordEvent({
        code,
        kind: 'interaction.animation_geometry.failed',
        resourceId: sceneInteractions.configuration(key)?.resource ?? null,
      })
    }
  })
})
const sceneOperations = createDesktopWorldSceneOperationCoordinator({
  outlet: sceneOutlet,
  interactions: sceneInteractions,
})
let sceneOperationQueue = Promise.resolve()

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
    'desktop_world_stage.scene.operation',
    'desktop_world_stage.scene.release',
    'desktop_world_stage.devtools.configure',
    'desktop_world_stage.devtools.request',
    'input_region.event',
    'key_down',
    'lifecycle',
  ],
  emits: [
    'ready',
    'canvas_object.registry',
    'desktop_world_stage.scene.event',
    'desktop_world_stage.scene.result',
    'desktop_world_stage.devtools.snapshot',
    'input_region.register',
    'input_region.update',
    'input_region.remove',
    'input_key_lease.register',
    'lifecycle.complete',
  ],
  surface: 'desktop-world',
})

async function applySceneMessage(message) {
  const payload = message.payload ?? {}
  const key = payload.lease_key
  const op = payload.operation?.op ?? (message.type === 'desktop_world_stage.scene.release' ? 'release' : 'unknown')
  try {
    const { applied } = await sceneOperations.apply(message)
    window.__desktopWorldSceneOutlet = sceneOutlet.snapshot()
    window.__desktopWorldSceneInteractions = sceneInteractions.snapshot()
    if (surface.isPrimary) {
      emit('desktop_world_stage.scene.result', {
        lease_key: key,
        operation: op,
        resource: payload.resource ?? null,
        status: applied ? 'ok' : 'ignored',
        snapshot: sceneOutlet.snapshot(),
      })
    }
    devtoolsProbe.recordEvent({ kind: `scene.${op}`, resourceId: payload.resource ?? null })
    lastSceneError = null
  } catch (error) {
    const code = error instanceof RangeError ? 'SCENE_BUDGET_EXCEEDED' : 'SCENE_PROJECTION_FAILED'
    lastSceneError = { at: Date.now(), code }
    devtoolsProbe.recordEvent({ code, kind: `scene.${op}.failed`, resourceId: payload.resource ?? null })
    if (surface.isPrimary) {
      emit('desktop_world_stage.scene.result', {
        lease_key: key,
        operation: op,
        resource: payload.resource ?? null,
        status: 'error',
        code,
      })
    }
  }
}

function enqueueSceneWork(work) {
  sceneOperationQueue = sceneOperationQueue.then(work, work)
  return sceneOperationQueue
}

wireBridge((message) => {
  if (handleDesktopWorldStageLifecycle(message, emitLifecycleComplete)) return
  if (message?.type === 'desktop_world_stage.devtools.configure') {
    devtoolsProbe.configure(message.payload)
    if (message.payload?.enabled === true) devtoolsProbe.emitSnapshot('configured')
    return
  }
  if (message?.type === 'desktop_world_stage.devtools.request') {
    devtoolsProbe.emitSnapshot('requested')
    return
  }
  if (message?.type === 'input_region.event') {
    sceneOperations.handleInput(message)
    return
  }
  if (message?.input_schema_version === 2 && message?.event_kind === 'key' && message?.type === 'key_down') {
    sceneOperations.handleInput(message)
    return
  }
  if (message?.type?.startsWith('desktop_world_stage.scene.')) {
    void enqueueSceneWork(() => applySceneMessage(message))
    return
  }
  if (applyDesktopWorldStageMessage(state, message)) render()
})

surface.start({
  onInit: ({ segment }) => {
    sceneOutlet.updateSegment(segment)
    render()
  },
  onTopologyChange: ({ segment }) => {
    sceneOutlet.updateSegment(segment)
    devtoolsProbe.recordEvent({ kind: 'topology.changed' })
    void enqueueSceneWork(() => sceneInteractions.topologyChanged())
    render()
  },
}).then(async () => {
  await registerInputKeyLease({ id: escapeKeyLeaseId, key: 'Escape' })
  render()
  installVisualObjectLiveProof()
  emitReady()
}).catch(() => {
  const code = 'INPUT_KEY_LEASE_FAILED'
  lastSceneError = { at: Date.now(), code }
  devtoolsProbe.recordEvent({ code, kind: 'input.key_lease.failed', resourceId: null })
})

window.addEventListener('pagehide', () => {
  devtoolsProbe.dispose()
  sceneInteractions.cancelAll('stage_disposed')
  void sceneInteractions.dispose()
}, { once: true })

render()

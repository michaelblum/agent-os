import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as sceneToolkit from '../../packages/toolkit/scene/index.js'

const EXPECTED_EXPORTS = [
  'DEFAULT_SCENE_HOST_BUDGETS',
  'DEFAULT_THREE_RENDER_LIMITS',
  'DesktopWorldSurface3D',
  'DesktopWorldSurfaceThree',
  'SCENE_DOCUMENT_CONTRACT_ID',
  'SCENE_DOCUMENT_LIMITS',
  'SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID',
  'SCENE_IMPLEMENTATION_KINDS',
  'SCENE_INSPECTION_CONTRACT_ID',
  'SCENE_LEASE_CONTRACT_ID',
  'SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID',
  'SCENE_TRANSACTION_CONTRACT_ID',
  'VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID',
  'VISUAL_OBJECT_PROJECTION_REASONS',
  'VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID',
  'VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS',
  'VISUAL_OBJECT_SUPPORTED_TECHNOLOGIES',
  'applySceneTransaction',
  'applyVisualObjectControllerUpdate',
  'applyVisualObjectDescriptorMutation',
  'applyVisualObjectFormFieldChange',
  'bindVisualObjectForm',
  'canvasGeometryCanvasID',
  'canvasLifecycleCanvasID',
  'canonicalizeSceneDocument',
  'coerceVisualObjectDescriptorValue',
  'compileSceneAnimationBindings',
  'compileSceneSignalBindings',
  'createDesktopWorldSceneHost',
  'createLocalSceneViewportHost',
  'createSceneImplementationRegistry',
  'createSceneAnimationController',
  'createThreeRenderLifecycle',
  'createSceneLease',
  'createSceneSignalController',
  'createVisualObjectDescriptor',
  'createVisualObjectResourceLifecycleEvidence',
  'deriveOrthoCamera',
  'disposeThreeObjectTree',
  'disposeThreeRenderer',
  'findVisualObjectFormDescriptor',
  'mergeCanvasGeometryCanvas',
  'mergeCanvasLifecycleCanvas',
  'normalizeCanvasGeometry',
  'resolveThreeRenderMetrics',
  'sceneDocumentRequiredImplementations',
  'validateSceneDocument',
  'validateSceneLease',
  'validateSceneTransaction',
  'validateVisualObjectDescriptor',
  'validateVisualObjectDescriptors',
  'validateVisualObjectResourceLifecycleEvidence',
  'visualObjectDescriptorRequiredFields',
].sort()

test('scene package facade exposes only the reviewed scene-authoring contract', async () => {
  assert.deepEqual(Object.keys(sceneToolkit).sort(), EXPECTED_EXPORTS)
  const packageJson = JSON.parse(await readFile(
    new URL('../../packages/toolkit/package.json', import.meta.url),
    'utf8',
  ))
  assert.deepEqual(packageJson.exports, {
    './scene': {
      types: './scene/index.d.ts',
      import: './scene/index.js',
      default: './scene/index.js',
    },
  })
})

test('scene facade drives descriptor, form, and renderer synchronization without product policy', () => {
  const descriptor = sceneToolkit.createVisualObjectDescriptor({
    id: 'shape.scale',
    label: 'Scale',
    kind: 'slider',
    technology: 'threejs-3d',
    state_path: 'shape.scale',
    route: 'scene.shape.patch',
    coerce: 'number',
    min: 0.25,
    max: 4,
    step: 0.05,
    renderer_sync: ['syncShapeScale'],
    group_key: 'shape',
    object_ids: ['shape-root'],
    projection: { classification: 'editable', reason: null },
  })
  assert.equal(sceneToolkit.validateVisualObjectDescriptor(descriptor).ok, true)

  const state = { shape: { scale: 1 } }
  const calls = []
  let listener = null
  const unsubscribe = sceneToolkit.bindVisualObjectForm({
    onFieldChange(callback) {
      listener = callback
      return () => { listener = null }
    },
  }, {
    descriptors: [descriptor],
    state,
    routeHandlers: {
      'scene.shape.patch': ({ mutation }) => calls.push(['route', mutation.value]),
    },
    rendererSyncHandlers: {
      syncShapeScale: ({ mutation }) => calls.push(['render', mutation.value]),
    },
  })

  const result = listener({ descriptor_id: descriptor.id, value: '1.75' })
  assert.equal(state.shape.scale, 1.75)
  assert.equal(result.update.route_outcome.status, 'called')
  assert.deepEqual(calls, [['route', 1.75], ['render', 1.75]])
  unsubscribe()
  assert.equal(listener, null)
})

test('scene facade retains canvas lifecycle normalization and bounded render metrics', () => {
  const canvas = sceneToolkit.mergeCanvasLifecycleCanvas(null, {
    canvas_id: 'consumer-stage',
    at: [10, 20, 800, 600],
    scope: 'connection',
  })
  assert.equal(canvas.id, 'consumer-stage')
  assert.deepEqual(canvas.at, [10, 20, 800, 600])

  const metrics = sceneToolkit.resolveThreeRenderMetrics({
    width: 1800,
    height: 1200,
    devicePixelRatio: 4,
  })
  assert.ok(metrics.effectiveDevicePixelRatio <= 2)
  assert.ok(metrics.backingPixels <= metrics.limits.maxBackingPixels)
})

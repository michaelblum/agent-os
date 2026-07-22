import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as sceneToolkit from '../../packages/toolkit/scene/index.js'
import * as authoringToolkit from '../../packages/toolkit/scene/authoring.js'
import * as devtoolsToolkit from '../../packages/toolkit/scene/devtools.js'
import * as extensionToolkit from '../../packages/toolkit/scene/extensions.js'
import * as runtimeToolkit from '../../packages/toolkit/scene/runtime.js'
import * as radialMenuToolkit from '../../packages/toolkit/scene/radial-menu.js'

const EXPECTED_EXPORTS = [
  'DEFAULT_SCENE_HOST_BUDGETS',
  'DEFAULT_THREE_RENDER_LIMITS',
  'DESKTOP_WORLD_SCENE_REPLAY_LIMITS',
  'DESKTOP_WORLD_SCENE_RESULT_ERROR_CODES',
  'DESKTOP_WORLD_SCENE_SESSION_CONTRACT_ID',
  'DESKTOP_WORLD_SCENE_SESSION_EVENT_NAMES',
  'DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES',
  'DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES',
  'DESKTOP_WORLD_DEVTOOLS_LIMITS',
  'DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID',
  'DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID',
  'DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS',
  'DesktopWorldSurface3D',
  'DesktopWorldSurfaceThree',
  'GENERIC_SCENE_IMPLEMENTATIONS',
  'SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID',
  'SCENE_CARTRIDGE_CONTRACT_ID',
  'SCENE_CARTRIDGE_IMPLEMENTATIONS',
  'SCENE_CARTRIDGE_INTERACTIONS_CONTRACT_ID',
  'SCENE_CARTRIDGE_LIMITS',
  'SCENE_AFFORDANCE_LIMITS',
  'SCENE_DOCUMENT_CONTRACT_ID',
  'SCENE_DOCUMENT_LIMITS',
  'SCENE_EVENT_CONTRACT_ID',
  'SCENE_EXTENSION_BUDGET_LIMITS',
  'SCENE_EXTENSION_CONTRACT_ID',
  'SCENE_EXTENSION_REGISTRY_LIMIT',
  'SCENE_EXTENSION_SCENE_ABI',
  'SCENE_EXTENSION_SCHEMA_VERSION',
  'SCENE_EXTENSION_THREE_REVISION',
  'SCENE_GESTURE_CANCELLATION_REASONS',
  'SCENE_GESTURE_KINDS',
  'SCENE_GESTURE_PHASES',
  'SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID',
  'SCENE_IMPLEMENTATION_KINDS',
  'SCENE_INSPECTION_CONTRACT_ID',
  'SCENE_INTERACTIONS_CONTRACT_ID',
  'SCENE_INTERACTION_VISUAL_LIMITS',
  'SCENE_LEASE_CONTRACT_ID',
  'SCENE_RADIAL_MENU_LIMITS',
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
  'buildDesktopWorldMinimapLayout',
  'canvasGeometryCanvasID',
  'canvasLifecycleCanvasID',
  'canonicalizeSceneDocument',
  'coerceVisualObjectDescriptorValue',
  'compileSceneAnimationBindings',
  'compileSceneSignalBindings',
  'createDesktopWorldSceneHost',
  'createDesktopWorldSceneClient',
  'createDesktopWorldSceneSession',
  'createDesktopWorldDevToolsStageProbe',
  'createDesktopWorldDevToolsView',
  'createDesktopWorldGpuTimer',
  'createGenericSceneImplementationRegistry',
  'createGenericThreeSceneProjection',
  'createLocalSceneViewportHost',
  'createSceneImplementationRegistry',
  'createSceneInteractionController',
  'createSceneInteractionVisualController',
  'createSceneGestureArena',
  'createSceneAnimationController',
  'createSceneEventEnvelope',
  'createThreeRenderLifecycle',
  'createTrustedSceneExtensionRegistry',
  'createSceneLease',
  'createSceneSignalController',
  'createVisualObjectDescriptor',
  'createVisualObjectResourceLifecycleEvidence',
  'deriveOrthoCamera',
  'disposeThreeObjectTree',
  'disposeThreeRenderer',
  'evaluateDesktopWorldPerformanceAcceptance',
  'findVisualObjectFormDescriptor',
  'inspectSceneExtensionProjectionResources',
  'mergeCanvasGeometryCanvas',
  'mergeCanvasLifecycleCanvas',
  'listDesktopWorldResources',
  'normalizeCanvasGeometry',
  'normalizeDesktopWorldDevToolsSnapshot',
  'normalizeDesktopWorldDevToolsStageSnapshot',
  'normalizeDesktopWorldSceneEvent',
  'normalizeDesktopWorldSceneResultErrorCode',
  'normalizeSceneRadialMenuParameters',
  'resolveSceneCartridge',
  'resolveSceneAffordanceFrame',
  'resolveSceneGestureResponse',
  'resolveSceneAimVisualStyle',
  'resolveSceneRadialMenuItemLabel',
  'resolveSceneRadialMenuLayout',
  'resolveSceneRadialMenuResponse',
  'resolveSceneRadialVisualStyle',
  'resolveThreeRenderMetrics',
  'replayDesktopWorldSceneEvents',
  'sceneDocumentRequiredImplementations',
  'selectDesktopWorldResourceSnapshot',
  'serializeSceneExtensionDigestMaterial',
  'validateSceneCartridge',
  'validateSceneCartridgeManifest',
  'validateSceneAffordanceDescriptor',
  'validateSceneDocument',
  'validateSceneExtensionManifest',
  'validateSceneExtensionProjection',
  'validateSceneExtensionReference',
  'validateSceneLease',
  'validateSceneInteractionDocument',
  'validateSceneRadialMenuParameters',
  'validateSceneTransaction',
  'validateVisualObjectDescriptor',
  'validateVisualObjectDescriptors',
  'validateVisualObjectResourceLifecycleEvidence',
  'visualObjectDescriptorRequiredFields',
  'withSceneRadialSelection',
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
    './scene/authoring': {
      types: './scene/authoring.d.ts',
      import: './scene/authoring.js',
      default: './scene/authoring.js',
    },
    './scene/runtime': {
      types: './scene/runtime.d.ts',
      import: './scene/runtime.js',
      default: './scene/runtime.js',
    },
    './scene/extensions': {
      types: './scene/extensions.d.ts',
      import: './scene/extensions.js',
      default: './scene/extensions.js',
    },
    './scene/devtools': {
      types: './scene/devtools.d.ts',
      import: './scene/devtools.js',
      default: './scene/devtools.js',
    },
    './scene/radial-menu': {
      types: './scene/radial-menu.d.ts',
      import: './scene/radial-menu.js',
      default: './scene/radial-menu.js',
    },
    './status-item': {
      types: './status-item/index.d.ts',
      import: './status-item/index.js',
      default: './status-item/index.js',
    },
  })
})

test('focused scene entry points expose their owned contract families', () => {
  assert.equal(typeof authoringToolkit.validateSceneCartridge, 'function')
  assert.equal(typeof authoringToolkit.createSceneGestureArena, 'function')
  assert.equal(typeof authoringToolkit.compileSceneRadialMenuDefinition, 'function')
  assert.equal(Object.hasOwn(authoringToolkit, 'createDesktopWorldSceneSession'), false)

  assert.equal(typeof runtimeToolkit.createDesktopWorldSceneSession, 'function')
  assert.equal(typeof runtimeToolkit.normalizeDesktopWorldSceneResultErrorCode, 'function')
  assert.equal(typeof runtimeToolkit.createLocalSceneViewportHost, 'function')
  assert.equal(Object.hasOwn(runtimeToolkit, 'validateSceneExtensionManifest'), false)

  assert.equal(typeof extensionToolkit.validateSceneExtensionManifest, 'function')
  assert.equal(typeof extensionToolkit.createTrustedSceneExtensionRegistry, 'function')
  assert.equal(Object.hasOwn(extensionToolkit, 'createDesktopWorldSceneSession'), false)

  assert.equal(typeof devtoolsToolkit.createDesktopWorldDevToolsView, 'function')
  assert.equal(typeof devtoolsToolkit.replayDesktopWorldSceneEvents, 'function')
  assert.equal(Object.hasOwn(devtoolsToolkit, 'createLocalSceneViewportHost'), false)

  assert.equal(typeof radialMenuToolkit.resolveRadialMenuConfig, 'function')
  assert.equal(typeof radialMenuToolkit.resolveRadialItemActivationTransition, 'function')
  assert.equal(typeof radialMenuToolkit.compileSceneRadialMenuDefinition, 'function')
  assert.equal(typeof radialMenuToolkit.resolveSceneRadialMenuLayout, 'function')
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

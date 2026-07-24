import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

import { createSceneAnimationInteractionState } from '../../packages/toolkit/components/desktop-world-stage/scene-animation-interaction-state.js'
import {
  DESKTOP_WORLD_SCENE_RENDER_LIMITS,
  reconcileSceneStageRunState,
  sceneResourceCanRun,
  sceneStageShouldRender,
} from '../../packages/toolkit/components/desktop-world-stage/scene-outlet.js'
import { createScenePlaybackClock } from '../../packages/toolkit/components/desktop-world-stage/scene-playback-clock.js'
import {
  createSceneOutletDevToolsSnapshot,
  emitSceneOutletRouteStartedSnapshot,
} from '../../packages/toolkit/components/desktop-world-stage/scene-outlet-devtools.js'
import {
  DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  createSceneSegmentResourceBudget,
  evaluateSceneSegmentResourceBudget,
  remainingSceneSegmentResourceBudgets,
} from '../../packages/toolkit/components/desktop-world-stage/scene-resource-budget.js'
import {
  compileSceneAnimationBindings,
  createDesktopWorldDevToolsStageProbe,
  createSceneInteractionVisualController,
  resolveSceneAffordanceFrame,
} from '../../packages/toolkit/scene/index.js'

const outletURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-outlet.js', import.meta.url)
const mountedResourceURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-mounted-resource.js', import.meta.url)
const devtoolsSnapshotURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-outlet-devtools.js', import.meta.url)
const stageURL = new URL('../../packages/toolkit/components/desktop-world-stage/index.js', import.meta.url)
const threeURL = new URL('../../packages/toolkit/vendor/three/three.module.min.js', import.meta.url)
const threeCoreURL = new URL('../../packages/toolkit/vendor/three/three.core.min.js', import.meta.url)

function interactionScene() {
  const animation = (id, target, from, to) => ({
    id,
    implementation: 'aos.scene.animation.bind',
    parameters: { delayMs: 0, durationMs: 400, easing: 'linear', from, playback: 'once', target, to },
    enabled: true,
  })
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id: 'companion/main',
    revision: 1,
    rootObjectId: 'root',
    objects: [{
      id: 'root',
      parentId: null,
      kind: 'group',
      transform: { position: [20, 30, 0], rotation: [0, 0, 0], scale: [0.1, 0.1, 0.1] },
      visible: true,
      geometryId: null,
      materialId: null,
      components: [
        animation('animation/position-x', 'position.x', 20, 300),
        animation('animation/position-y', 'position.y', 30, 240),
        animation('animation/scale-x', 'scale.x', 0.1, 1),
        animation('animation/scale-y', 'scale.y', 0.1, 1),
      ],
    }],
    resources: [],
    metadata: {},
  }
}

test('completed spatial animations update one coalesced interaction document without rewriting source', () => {
  const source = interactionScene()
  const state = createSceneAnimationInteractionState(source)
  const bindings = new Map(compileSceneAnimationBindings(source).bindings.map((binding) => [binding.target, binding]))

  assert.equal(state.complete({ objectId: 'root', target: 'material.opacity' }, 0.5), false)
  assert.equal(state.complete(bindings.get('position.x'), 300), true)
  assert.equal(state.complete(bindings.get('position.y'), 240), true)
  assert.equal(state.complete(bindings.get('scale.x'), 1), true)
  assert.equal(state.complete(bindings.get('scale.y'), 1), true)
  assert.equal(state.takeDirty(), true)
  assert.equal(state.takeDirty(), false)
  assert.deepEqual(source.objects[0].transform.position, [20, 30, 0])
  assert.deepEqual(resolveSceneAffordanceFrame(state.document(), {
    objectId: 'root',
    geometry: { kind: 'rect', width: 80, height: 60, offset: [0, 0] },
  }), [260, 210, 80, 60])

  assert.equal(state.setObjectPosition('root', [500, 400, 0]), true)
  assert.deepEqual(state.document().objects[0].transform.scale, [1, 1, 0.1])
  assert.deepEqual(state.document().objects[0].transform.position, [500, 400, 0])
  state.reset(source)
  assert.equal(state.takeDirty(), false)
  assert.deepEqual(state.document().objects[0].transform.position, [20, 30, 0])
})

test('3D-only and continuous animation bindings do not claim native hit-geometry settlement', () => {
  const source = interactionScene()
  source.objects[0].components = [
    {
      id: 'animation/depth',
      implementation: 'aos.scene.animation.bind',
      parameters: {
        delayMs: 0,
        durationMs: 400,
        easing: 'linear',
        from: 0,
        playback: 'once',
        target: 'position.z',
        to: 100,
      },
      enabled: true,
    },
    {
      id: 'animation/orbit',
      implementation: 'aos.scene.animation.bind',
      parameters: {
        delayMs: 0,
        durationMs: 400,
        easing: 'linear',
        from: 0,
        playback: 'loop',
        target: 'rotation.z',
        to: Math.PI * 2,
      },
      enabled: true,
    },
  ]
  const state = createSceneAnimationInteractionState(source)
  const depth = compileSceneAnimationBindings(source).bindings.find((binding) => binding.target === 'position.z')

  assert.equal(state.hasSpatialAnimation(), false)
  assert.equal(state.complete(depth, 100), false)
  assert.equal(state.takeDirty(), false)
})

test('scene playback clock excludes operation, visibility, and context suspension time', () => {
  const clock = createScenePlaybackClock()

  assert.equal(clock.elapsed(100), 0)
  assert.equal(clock.restart(100), true)
  assert.equal(clock.elapsed(250), 150)
  assert.equal(clock.suspend(250), true)
  assert.equal(clock.elapsed(1_000), 150)
  assert.equal(clock.resume(1_000), true)
  assert.equal(clock.elapsed(1_100), 250)
  assert.deepEqual(clock.snapshot(), { paused: false, pausedAt: null, startedAt: 850 })

  assert.equal(clock.restart(2_000), true)
  assert.equal(clock.suspend(2_000), true)
  assert.equal(clock.resume(5_000), true)
  assert.equal(clock.elapsed(5_100), 100)
})

test('resource resume cannot reactivate a route while the stage remains suspended', () => {
  let at = 0
  const visuals = createSceneInteractionVisualController({ now: () => at })
  const event = {
    frame: {
      phase: 'end',
      origin: { x: 100, y: 200 },
      current: { x: 300, y: 200 },
      timing: { t: 9_000_000 },
    },
    interaction: {
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
      response: { implementation: 'aos.scene.response.aim-commit', parameters: { route: 'line' } },
    },
    response: {
      kind: 'aim_commit',
      objectId: 'body',
      origin: { x: 100, y: 200 },
      pointer: { x: 300, y: 200 },
      position: [300, 200, 0],
      angle: 0,
      distance: 200,
      route: 'line',
    },
  }
  visuals.apply(event)
  at = 10
  visuals.tick(at)
  const before = visuals.snapshot().route.progress

  assert.equal(sceneResourceCanRun(true, false, false), false)
  at = 20
  visuals.tick(at)
  const suspended = visuals.snapshot().route.progress
  visuals.suspend(at)
  assert.equal(sceneResourceCanRun(false, true, false), false)
  at = 1_000
  visuals.tick(at)
  assert.ok(suspended > before)
  assert.equal(visuals.snapshot().route.progress, suspended)

  assert.equal(sceneResourceCanRun(false, false, false), true)
  at = 5_010
  visuals.resume(at)
  visuals.tick(at)
  assert.equal(visuals.snapshot().route.progress, suspended)
  assert.equal(visuals.snapshot().route.active, true)
})

test('DesktopWorld render loop runs only while at least one visible resource is active', () => {
  assert.deepEqual(DESKTOP_WORLD_SCENE_RENDER_LIMITS, {
    maxDevicePixelRatio: 2,
    maxBackingDimension: 4096,
    maxBackingPixels: 2_097_152,
  })
  const resources = new Map()
  assert.equal(sceneStageShouldRender(resources, false, false), false)
  resources.set('parked', { suspended: true })
  assert.equal(sceneStageShouldRender(resources, false, false), false)
  resources.set('active', { suspended: false })
  assert.equal(sceneStageShouldRender(resources, false, false), true)
  assert.equal(sceneStageShouldRender(resources, true, false), false)
  assert.equal(sceneStageShouldRender(resources, false, true), false)
  assert.equal(sceneStageShouldRender(resources, false, false, true), false)
  assert.equal(sceneStageShouldRender(resources, false, false, false, true), false)
})

test('DesktopWorld segment resource budgets aggregate every mounted projection', () => {
  const half = {
    drawCalls: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxDrawCalls / 2,
    geometryBytes: 1024,
    objects: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxObjects / 2,
    resources: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxResources / 2,
    textureBytes: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxTextureBytes / 2,
    triangles: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxTriangles / 2,
    workingBytes: DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxWorkingBytes / 2,
  }
  const admitted = evaluateSceneSegmentResourceBudget([half, half])
  assert.equal(admitted.ok, true)
  assert.equal(admitted.metrics.objects, DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxObjects)
  const rejected = evaluateSceneSegmentResourceBudget([half, half, { ...half, drawCalls: 1 }])
  assert.equal(rejected.ok, false)
  assert.deepEqual(rejected.violations.map((entry) => entry.metric).sort(), [
    'drawCalls',
    'objects',
    'resources',
    'textureBytes',
    'triangles',
    'workingBytes',
  ])
  assert.throws(
    () => evaluateSceneSegmentResourceBudget([{ ...half, triangles: Number.POSITIVE_INFINITY }]),
    /non-negative safe integer/u,
  )
})

test('DesktopWorld extension admission receives only unallocated segment headroom', () => {
  const used = {
    drawCalls: 48,
    geometryBytes: 1024,
    objects: 12,
    resources: 10,
    textureBytes: 2 * 1024 * 1024,
    triangles: 50_000,
    workingBytes: 4 * 1024 * 1024,
  }
  const requested = {
    maxDrawCalls: 64,
    maxObjects: 64,
    maxResources: 64,
    maxTextureBytes: 8 * 1024 * 1024,
    maxTriangles: 100_000,
    maxWorkingBytes: 16 * 1024 * 1024,
  }
  const limits = {
    maxDrawCalls: 100,
    maxObjects: 60,
    maxResources: 70,
    maxTextureBytes: 6 * 1024 * 1024,
    maxTriangles: 120_000,
    maxWorkingBytes: 12 * 1024 * 1024,
  }

  assert.deepEqual(remainingSceneSegmentResourceBudgets(used, requested, limits), {
    maxDrawCalls: 52,
    maxObjects: 48,
    maxResources: 60,
    maxTextureBytes: 4 * 1024 * 1024,
    maxTriangles: 70_000,
    maxWorkingBytes: 8 * 1024 * 1024,
  })
})

test('DesktopWorld replacement admission budgets the old and candidate projections concurrently', () => {
  const limits = {
    maxDrawCalls: 4,
    maxObjects: 4,
    maxResources: 4,
    maxTextureBytes: 400,
    maxTriangles: 400,
    maxWorkingBytes: 400,
  }
  const budget = createSceneSegmentResourceBudget(limits)
  const mounted = {
    metricsAccounted: false,
    resourceMetrics: {
      drawCalls: 3,
      geometryBytes: 100,
      objects: 3,
      resources: 3,
      textureBytes: 100,
      triangles: 100,
      workingBytes: 200,
    },
  }
  const candidate = {
    metricsAccounted: false,
    resourceMetrics: {
      drawCalls: 2,
      geometryBytes: 50,
      objects: 2,
      resources: 2,
      textureBytes: 50,
      triangles: 50,
      workingBytes: 100,
    },
  }
  budget.assertCandidate(mounted)
  budget.commit(mounted)

  assert.throws(() => budget.assertCandidate(candidate), /segment resource budget exceeded/u)
  assert.deepEqual(budget.snapshot(), mounted.resourceMetrics)
})

test('DesktopWorld candidate reservations prevent concurrent resource overbooking', () => {
  const limits = {
    maxDrawCalls: 4,
    maxObjects: 4,
    maxResources: 4,
    maxTextureBytes: 400,
    maxTriangles: 400,
    maxWorkingBytes: 400,
  }
  const budget = createSceneSegmentResourceBudget(limits)
  const candidate = (value) => ({
    metricsAccounted: false,
    resourceMetrics: {
      drawCalls: value,
      geometryBytes: value,
      objects: value,
      resources: value,
      textureBytes: value,
      triangles: value,
      workingBytes: value,
    },
  })
  const first = candidate(3)
  const second = candidate(2)
  const reservation = budget.reserve(first)

  assert.throws(() => budget.reserve(second), /segment resource budget exceeded/u)
  assert.equal(budget.releaseReservation(reservation), true)
  const secondReservation = budget.reserve(second)
  budget.commit(second, null, secondReservation)
  assert.deepEqual(budget.snapshot(), second.resourceMetrics)
})

test('stage visibility and context transitions resume only runnable resources', () => {
  const visibilityClock = createScenePlaybackClock()
  visibilityClock.restart(0)
  const visibilityResources = new Map([['visible', {
    suspended: false,
    playClock: visibilityClock,
    interactionVisuals: null,
  }]])
  reconcileSceneStageRunState(
    visibilityResources,
    { hidden: false, contextLost: false },
    { hidden: true, contextLost: false },
    10,
  )
  reconcileSceneStageRunState(
    visibilityResources,
    { hidden: true, contextLost: false },
    { hidden: false, contextLost: false },
    100,
  )
  assert.equal(visibilityClock.elapsed(110), 20)

  const activeClock = createScenePlaybackClock()
  const resourceClock = createScenePlaybackClock()
  activeClock.restart(0)
  resourceClock.restart(0)
  const calls = []
  const resources = new Map([
    ['active', {
      suspended: false,
      playClock: activeClock,
      interactionVisuals: {
        suspend: (at) => calls.push(`active:suspend:${at}`),
        resume: (at) => calls.push(`active:resume:${at}`),
      },
    }],
    ['resource-suspended', {
      suspended: true,
      playClock: resourceClock,
      interactionVisuals: {
        suspend: (at) => calls.push(`resource:suspend:${at}`),
        resume: (at) => calls.push(`resource:resume:${at}`),
      },
    }],
  ])

  assert.equal(reconcileSceneStageRunState(
    resources,
    { hidden: false, contextLost: false },
    { hidden: true, contextLost: false },
    10,
  ), true)
  assert.equal(reconcileSceneStageRunState(
    resources,
    { hidden: true, contextLost: false },
    { hidden: true, contextLost: true },
    20,
  ), false)
  assert.equal(reconcileSceneStageRunState(
    resources,
    { hidden: true, contextLost: true },
    { hidden: false, contextLost: true },
    50,
  ), false)
  assert.equal(reconcileSceneStageRunState(
    resources,
    { hidden: false, contextLost: true },
    { hidden: false, contextLost: false },
    100,
  ), true)

  assert.deepEqual(calls, [
    'active:suspend:10',
    'resource:suspend:10',
    'active:resume:100',
  ])
  assert.equal(activeClock.elapsed(110), 20)
  assert.equal(resourceClock.snapshot().paused, true)
})

test('scene outlet DevTools projection is deterministic, bounded, and read-only', () => {
  const mounted = (resource, position, options = {}) => ({
    resource,
    owner: 'example.consumer',
    suspended: options.suspended === true,
    extensionReference: options.extensionReference ?? null,
    document: {
      id: resource,
      revision: options.revision ?? 1,
      resources: [
        { id: `${resource}/material`, kind: 'material', implementation: 'example.material' },
        { id: `${resource}/geometry`, kind: 'geometry', implementation: 'example.geometry' },
      ],
      objects: [{
        id: `${resource}/body`,
        parentId: null,
        kind: 'mesh',
        geometryId: `${resource}/geometry`,
        materialId: `${resource}/material`,
        transform: { position: [0, 0, 0] },
        visible: true,
        components: [],
      }],
    },
    projection: {
      objectPosition: () => position,
      ...(Object.hasOwn(options, 'extensionInspection')
        ? { inspectInteractionRoute: () => options.extensionInspection }
        : {}),
      ...(options.extensionInspectionThrows
        ? { inspectInteractionRoute: () => { throw new Error('invalid inspection') } }
        : {}),
    },
    animations: { snapshot: () => ({ bindings: [{}] }) },
    signals: { snapshot: () => ({ bindings: [{}, {}] }) },
    interactionVisuals: options.route
      ? { snapshot: () => ({ route: options.route }) }
      : null,
  })
  const second = mounted('zeta/main', [9, 8, 0], {
    route: { active: true, destination: [30, 40], kind: 'aim_commit', objectId: 'body', origin: [9, 8], progress: 0.5 },
  })
  const first = mounted('alpha/main', [1, 2, 0], { suspended: true })
  const sourcePosition = [...first.document.objects[0].transform.position]

  const snapshot = createSceneOutletDevToolsSnapshot(new Map([
    ['zeta', second],
    ['alpha', first],
  ]))

  assert.deepEqual(snapshot.resources.map((entry) => entry.id), ['alpha/main', 'zeta/main'])
  assert.deepEqual(snapshot.nodes.map((entry) => entry.resourceId), ['alpha/main', 'zeta/main'])
  assert.deepEqual(snapshot.nodes[1].position, [9, 8, 0])
  assert.equal(snapshot.resources[0].lifecycle, 'suspended')
  assert.deepEqual(snapshot.routes.map((entry) => entry.resourceId), ['zeta/main'])
  assert.deepEqual(first.document.objects[0].transform.position, sourcePosition)
})

test('scene outlet DevTools prefers bounded extension route inspection and isolates failures', () => {
  const base = {
    resource: 'companion/main',
    owner: 'example.consumer',
    suspended: false,
    extensionReference: { id: 'renderer', ownerId: 'example.consumer', digest: 'a'.repeat(64) },
    document: {
      id: 'companion/main',
      revision: 3,
      resources: [],
      objects: [{
        id: 'body',
        parentId: null,
        kind: 'group',
        geometryId: null,
        materialId: null,
        transform: { position: [400, 300, 0] },
        visible: true,
        components: [],
      }],
    },
    animations: { snapshot: () => ({ bindings: [] }) },
    signals: { snapshot: () => ({ bindings: [] }) },
    interactionVisuals: null,
  }
  const inspected = {
    ...base,
    interactionVisuals: {
      snapshot: () => ({
        route: {
          active: false,
          destination: [10, 20, 0],
          kind: 'wormhole',
          objectId: 'body',
          origin: [0, 0, 0],
          progress: 1,
        },
      }),
    },
    projection: {
      objectPosition: () => [400, 300, 0],
      inspectInteractionRoute: () => ({
        active: true,
        destination: [900, 600],
        kind: 'line',
        origin: [400, 300],
        progress: 0.4,
      }),
    },
  }
  const failed = {
    ...base,
    resource: 'failed/main',
    document: { ...base.document, id: 'failed/main' },
    interactionVisuals: {
      snapshot: () => ({
        route: {
          active: true,
          destination: [50, 60],
          kind: 'line',
          objectId: 'body',
          origin: [10, 20],
          progress: 0.5,
        },
      }),
    },
    projection: {
      objectPosition: () => [0, 0, 0],
      inspectInteractionRoute: () => { throw new TypeError('malformed inspection') },
    },
  }
  const fallback = {
    ...base,
    resource: 'fallback/main',
    document: { ...base.document, id: 'fallback/main' },
    interactionVisuals: {
      snapshot: () => ({
        route: {
          active: true,
          destination: [300, 220],
          kind: 'wormhole',
          objectId: 'body',
          origin: [100, 120],
          progress: 0.2,
        },
      }),
    },
    projection: {
      objectPosition: () => [100, 120, 0],
      inspectInteractionRoute: () => null,
    },
  }

  const snapshot = createSceneOutletDevToolsSnapshot(new Map([
    ['inspected', inspected],
    ['failed', failed],
    ['fallback', fallback],
  ]))

  assert.deepEqual(snapshot.routes, [
    {
      active: true,
      destination: [900, 600],
      kind: 'line',
      origin: [400, 300],
      progress: 0.4,
      resourceId: 'companion/main',
    },
    {
      active: true,
      destination: [300, 220],
      kind: 'wormhole',
      origin: [100, 120],
      progress: 0.2,
      resourceId: 'fallback/main',
    },
  ])
  assert.equal(
    snapshot.resources.find((entry) => entry.id === 'failed/main').errorCode,
    'SCENE_EXTENSION_INSPECTION_FAILED',
  )
  assert.equal(
    snapshot.resources.find((entry) => entry.id === 'companion/main').errorCode,
    null,
  )
})

test('scene outlet emits an immediate snapshot only after a route actually starts', () => {
  const emitted = []
  let route = null
  const probe = createDesktopWorldDevToolsStageProbe({
    emit: (snapshot) => emitted.push(snapshot),
    getStageFacts: () => ({
      status: 'available',
      world: {
        affordances: [],
        displays: [],
        gestures: [],
        hitRegions: [],
        nodes: [],
        routes: route == null ? [] : [route],
      },
      interactions: [],
      resources: [],
    }),
  })
  probe.configure({ enabled: true })

  assert.equal(emitSceneOutletRouteStartedSnapshot(probe, { routeStarted: false }), false)
  assert.equal(emitSceneOutletRouteStartedSnapshot(null, { routeStarted: true }), false)
  route = {
    active: true,
    destination: [900, 600],
    kind: 'line',
    origin: [400, 300],
    progress: 0,
    resourceId: 'companion/main',
  }
  assert.equal(emitSceneOutletRouteStartedSnapshot(probe, { routeStarted: true }), true)
  assert.equal(emitted.length, 1)
  assert.deepEqual(emitted[0].world.routes, [route])
})

test('DesktopWorld scene outlet is local, bounded, and shares one renderer loop', async () => {
  const [outlet, mountedResource, devtoolsSnapshot, stage, three, threeCore] = await Promise.all([
    readFile(outletURL, 'utf8'),
    readFile(mountedResourceURL, 'utf8'),
    readFile(devtoolsSnapshotURL, 'utf8'),
    readFile(stageURL, 'utf8'),
    stat(threeURL),
    stat(threeCoreURL),
  ])
  assert.match(outlet, /new THREE\.WebGLRenderer/u)
  assert.equal((outlet.match(/new THREE\.WebGLRenderer/gu) ?? []).length, 1)
  assert.match(outlet, /renderer\.setClearColor\(0x000000, 0\)/u)
  assert.match(outlet, /renderer\.setSize\(metrics\.cssWidth, metrics\.cssHeight, false\)[\s\S]*renderer\.clear\(true, true, true\)/u)
  assert.match(outlet, /new THREE\.OrthographicCamera/u)
  assert.doesNotMatch(outlet, /new THREE\.PerspectiveCamera/u)
  assert.match(outlet, /deriveOrthoCamera\(nextSegment\)/u)
  assert.match(outlet, /projection: 'desktop-world-orthographic'/u)
  assert.match(outlet, /createDesktopWorldSceneMountedResource/u)
  assert.match(mountedResource, /createSceneAnimationController\(document/u)
  assert.match(mountedResource, /createSceneSignalController\(document/u)
  assert.match(outlet, /mounted\.animations\.tick\(elapsed\)/u)
  assert.match(outlet, /mounted\.projection\.tick\?\.\(elapsed\)/u)
  assert.match(outlet, /emitSceneOutletRouteStartedSnapshot\(devtoolsProbe, visual\)/u)
  assert.match(outlet, /finally \{[\s\S]*if \(!stageFault\) scheduleRender\(\)/u)
  assert.match(outlet, /sceneStageShouldRender\(resources, hidden, contextLost, stageSuspended, Boolean\(stageFault\)\)/u)
  assert.match(outlet, /renderLoopActive: frame !== null/u)
  assert.match(outlet, /faultSceneSegment\(code, mounted\)/u)
  assert.match(outlet, /setFaultObserver\(observer\)/u)
  assert.match(outlet, /SCENE_EXTENSION_CONTEXT_LOST_FAILED/u)
  assert.match(outlet, /mounted\.projection\.contextRestored\?\.\(\)/u)
  assert.match(outlet, /SCENE_EXTENSION_CONTEXT_RESTORED_FAILED/u)
  assert.match(outlet, /SCENE_EXTENSION_INTERACTION_FAILED/u)
  assert.match(outlet, /candidate\.projection\.activate\?\.\(\)/u)
  assert.match(outlet, /error\?\.code === 'SCENE_EXTENSION_DISPOSE_FAILED'[\s\S]*faultSceneSegment\('SCENE_EXTENSION_DISPOSE_FAILED'\)/u)
  assert.match(mountedResource, /failures\.length > 0[\s\S]*SCENE_EXTENSION_DISPOSE_FAILED/u)
  assert.match(outlet, /candidate\.suspended \|\| stageSuspended/u)
  assert.match(outlet, /candidate\.stageSuspendedApplied = stageSuspended/u)
  assert.match(outlet, /segmentBudget\.reserve\(candidate\)/u)
  assert.match(outlet, /segmentBudget\.updateReservation\(resourceReservation, candidate\)/u)
  assert.match(outlet, /segmentBudget\.commit\(candidate, previous, resourceReservation\)/u)
  assert.match(outlet, /resources\.delete\(key\)[\s\S]*segmentBudget\.unaccount\(mounted\)[\s\S]*retireMounted\(mounted\)/u)
  assert.match(outlet, /operation\.op === 'mount'[\s\S]*Object\.hasOwn\(operation, 'extension'\) \? operation\.extension : null/u)
  assert.match(outlet, /mounted\.playClock\.elapsed\(at\)/u)
  assert.doesNotMatch(outlet, /playStartedAt/u)
  assert.match(mountedResource, /onComplete: \(binding, value\) => interactionState\.complete\(binding, value\)/u)
  assert.match(outlet, /notifyInteractionGeometry\(mounted\.key, mounted\.playGeneration\)/u)
  assert.match(outlet, /mounted\.playGeneration = \+\+nextPlayGeneration/u)
  assert.match(outlet, /resources\.has\(key\) \? nextPlayGeneration \+ 1 : null/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.tick\(at\)/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.suspend\(at\)/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.resume\(at\)/u)
  assert.match(outlet, /sceneResourceCanRun\([\s\S]*mounted\.suspended,[\s\S]*hidden \|\| stageSuspended,[\s\S]*contextLost \|\| Boolean\(stageFault\)/u)
  assert.match(outlet, /reconcileSceneStageRunState/u)
  assert.match(outlet, /createDesktopWorldSceneInteractionThree/u)
  assert.match(outlet, /ensureInteractionVisuals/u)
  assert.match(mountedResource, /interactionVisuals: null/u)
  const aimBranch = outlet.slice(outlet.indexOf("if (response.kind === 'aim_commit')"), outlet.indexOf("if (response.kind === 'translate')"))
  assert.match(aimBranch, /const revision = commitObjectPosition[\s\S]*response: \{ \.\.\.response, applied: true, revision \}[\s\S]*const extension = applyExtensionInteraction/u)
  assert.match(aimBranch, /revision === null[\s\S]*mounted\.interactionVisuals\?\.cancel\(\)/u)
  assert.match(aimBranch, /extension\.handled[\s\S]*ensureInteractionVisuals/u)
  assert.match(outlet, /mounted\.signals\.publish\(operation\.signalId/u)
  assert.doesNotMatch(outlet, /elapsed % duration/u)
  assert.match(outlet, /MAX_RESOURCES = 32/u)
  assert.match(outlet, /resources\.size \+ pendingResourceKeys\.size >= MAX_RESOURCES/u)
  assert.match(outlet, /if \(!previous\) pendingResourceKeys\.add\(key\)/u)
  assert.match(outlet, /if \(!previous\) pendingResourceKeys\.delete\(key\)/u)
  assert.match(outlet, /MAX_SIGNALS_PER_SECOND = 30/u)
  assert.match(outlet, /resolveThreeRenderMetrics/u)
  assert.match(outlet, /\.\.\.DESKTOP_WORLD_SCENE_RENDER_LIMITS/u)
  assert.match(outlet, /effectiveDevicePixelRatio/u)
  assert.match(outlet, /backingPixels/u)
  assert.match(outlet, /devtoolsProbe\?\.isEnabled\(\) === true/u)
  assert.match(outlet, /createDesktopWorldGpuTimer\(renderer\.getContext\(\)\)/u)
  assert.match(outlet, /gpuTimer\?\.dispose\(\)/u)
  assert.match(outlet, /renderer\.info/u)
  assert.match(outlet, /devtoolsSnapshot\(\)/u)
  assert.match(outlet, /createSceneOutletDevToolsSnapshot\(resources/u)
  assert.match(devtoolsSnapshot, /mountedResources\.push/u)
  assert.ok(outlet.split('\n').length < 900, 'scene outlet must remain below its decomposition ratchet')
  assert.match(stage, /desktop_world_stage\.devtools\.configure/u)
  assert.match(stage, /desktop_world_stage\.devtools\.snapshot/u)
  assert.match(outlet, /webglcontextlost/u)
  assert.match(outlet, /forceContextLoss/u)
  assert.doesNotMatch(outlet, /https?:\/\//u)
  assert.match(stage, /desktop_world_stage\.scene\.operation/u)
  assert.equal((stage.match(/emit\('desktop_world_stage\.scene\.result'/gu) ?? []).length, 2)
  assert.match(stage, /emit\('desktop_world_stage\.scene\.fault'/u)
  assert.match(stage, /await sceneOperations\?\.failClosed\(code\)/u)
  assert.match(stage, /message\?\.type === 'lifecycle'[\s\S]*enqueueSceneWork\(\(\) => handleDesktopWorldStageLifecycle/u)
  assert.equal((stage.match(/stageLifecycleState === 'active'\) sceneOperations\.handleInput\(message\)/gu) ?? []).length, 2)
  assert.match(stage, /stageLifecycleState = 'closing'[\s\S]*enqueueSceneWork\(async \(\) => \{[\s\S]*await disposeStage\(\)/u)
  assert.match(stage, /replaceRegionGeneration: replaceInputRegionGeneration/u)
  assert.match(stage, /sceneOutlet\.updateSegment\(segment\)/u)
  assert.match(stage, /enqueueSceneWork\(async \(\) => \{[\s\S]*settleAnimationGeometry\(key, generation\)/u)
  assert.doesNotMatch(stage, /animationGeometryChanged/u)
  assert.match(stage, /registerInputKeyLease\(\{ id: escapeKeyLeaseId, key: 'Escape' \}\)/u)
  assert.match(stage, /input_schema_version === 2[\s\S]*event_kind === 'key'[\s\S]*sceneOperations\.handleInput\(message\)/u)
  assert.match(stage, /\.then\(async \(\) => \{[\s\S]*registerInputKeyLease[\s\S]*emitReady\(\)/u)
  assert.doesNotMatch(stage, /\ninstallVisualObjectLiveProof\(\)\nemitReady\(\)\s*$/u)
  assert.ok(three.size > 100_000 && three.size < 1_000_000)
  assert.ok(threeCore.size > 100_000 && threeCore.size < 1_000_000)
})

test('vendored Three module carries its MIT license', async () => {
  const [license, provenance] = await Promise.all([
    readFile(new URL('../../packages/toolkit/vendor/three/LICENSE', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/toolkit/vendor/three/README.md', import.meta.url), 'utf8'),
  ])
  assert.match(license, /MIT License/u)
  assert.match(license, /three\.js authors/u)
  assert.match(provenance, /three@0\.183\.2/u)
  assert.match(provenance, /three\.core\.min\.js/u)
})

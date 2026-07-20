import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

import { createSceneAnimationInteractionState } from '../../packages/toolkit/components/desktop-world-stage/scene-animation-interaction-state.js'
import { createScenePlaybackClock } from '../../packages/toolkit/components/desktop-world-stage/scene-playback-clock.js'
import { compileSceneAnimationBindings, resolveSceneAffordanceFrame } from '../../packages/toolkit/scene/index.js'

const outletURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-outlet.js', import.meta.url)
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

test('DesktopWorld scene outlet is local, bounded, and shares one renderer loop', async () => {
  const [outlet, stage, three, threeCore] = await Promise.all([
    readFile(outletURL, 'utf8'),
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
  assert.match(outlet, /createSceneAnimationController\(document/u)
  assert.match(outlet, /createSceneSignalController\(document/u)
  assert.match(outlet, /mounted\.animations\.tick\(elapsed\)/u)
  assert.match(outlet, /mounted\.playClock\.elapsed\(at\)/u)
  assert.doesNotMatch(outlet, /playStartedAt/u)
  assert.match(outlet, /onComplete: \(binding, value\) => interactionState\.complete\(binding, value\)/u)
  assert.match(outlet, /notifyInteractionGeometry\(mounted\.key, mounted\.playGeneration\)/u)
  assert.match(outlet, /mounted\.playGeneration = \+\+nextPlayGeneration/u)
  assert.match(outlet, /resources\.has\(key\) \? nextPlayGeneration \+ 1 : null/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.tick\(at\)/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.suspend\(at\)/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.resume\(at\)/u)
  assert.match(outlet, /createDesktopWorldSceneInteractionThree/u)
  assert.match(outlet, /ensureInteractionVisuals/u)
  assert.match(outlet, /interactionVisuals: null/u)
  const aimBranch = outlet.slice(outlet.indexOf("if (response.kind === 'aim_commit')"), outlet.indexOf("if (response.kind === 'translate')"))
  assert.ok(aimBranch.indexOf('const revision = commitObjectPosition') < aimBranch.indexOf('const visual = interactionVisuals.apply'))
  assert.match(aimBranch, /revision === null[\s\S]*interactionVisuals\.cancel\(\)/u)
  assert.match(outlet, /mounted\.signals\.publish\(operation\.signalId/u)
  assert.doesNotMatch(outlet, /elapsed % duration/u)
  assert.match(outlet, /MAX_RESOURCES = 32/u)
  assert.match(outlet, /MAX_SIGNALS_PER_SECOND = 30/u)
  assert.match(outlet, /resolveThreeRenderMetrics/u)
  assert.match(outlet, /effectiveDevicePixelRatio/u)
  assert.match(outlet, /backingPixels/u)
  assert.match(outlet, /devtoolsProbe\?\.isEnabled\(\) === true/u)
  assert.match(outlet, /createDesktopWorldGpuTimer\(renderer\.getContext\(\)\)/u)
  assert.match(outlet, /gpuTimer\?\.dispose\(\)/u)
  assert.match(outlet, /renderer\.info/u)
  assert.match(outlet, /devtoolsSnapshot\(\)/u)
  assert.match(stage, /desktop_world_stage\.devtools\.configure/u)
  assert.match(stage, /desktop_world_stage\.devtools\.snapshot/u)
  assert.match(outlet, /webglcontextlost/u)
  assert.match(outlet, /forceContextLoss/u)
  assert.doesNotMatch(outlet, /https?:\/\//u)
  assert.match(stage, /desktop_world_stage\.scene\.operation/u)
  assert.match(stage, /if \(surface\.isPrimary\)/u)
  assert.equal((stage.match(/emit\('desktop_world_stage\.scene\.result'/gu) ?? []).length, 2)
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

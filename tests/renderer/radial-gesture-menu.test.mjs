import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilRadialGestureMenu,
  DEFAULT_SIGIL_RADIAL_ITEMS,
} from '../../apps/sigil/renderer/live-modules/radial-gesture-menu.js'
import { reticleOuterMarginExit } from '../../apps/sigil/renderer/live-modules/annotation-reticle.js'
import { normalizeSigilRadialGestureMenu } from '../../apps/sigil/renderer/radial-menu-defaults.js'
import defaultState from '../../apps/sigil/renderer/state.js'
import { pointAtAngle, radialItemPointerMetrics, shortestAngleDelta } from '../../packages/toolkit/runtime/radial-gesture.js'

function createMenu(options = {}) {
  const commits = []
  const menu = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: 100,
      radialGestureMenu: {
        startAngle: -90,
        spreadDegrees: 90,
        itemRadius: 1,
        itemHitRadius: 0.25,
        itemVisualRadius: 0.2,
        menuRadius: 1.2,
        handoffRadius: 1.8,
        reentryRadius: 1.45,
        deadZoneRadius: 0.3,
        items: DEFAULT_SIGIL_RADIAL_ITEMS,
      },
      ...options.state,
    },
    onCommitItem(item, snapshot, context) {
      commits.push({ item, snapshot, context })
    },
  })
  return { menu, commits }
}

test('Sigil radial menu commits configured context item on release', () => {
  const { menu, commits } = createMenu()
  const started = menu.start({ x: 200, y: 200, valid: true }, { x: 260, y: 200, valid: true })
  const contextItem = started.items.find((item) => item.id === 'avatar-controls')

  const moved = menu.move({ ...contextItem.center, valid: true })
  assert.equal(moved.snapshot.phase, 'radial')
  assert.equal(moved.snapshot.activeItemId, 'avatar-controls')

  const released = menu.release({ ...contextItem.center, valid: true })
  assert.equal(released.phase, 'committed')
  assert.equal(released.committed.type, 'item')
  assert.equal(commits.length, 1)
  assert.equal(commits[0].item.action, 'avatarControls')
  assert.deepEqual(commits[0].context.pointer, { ...contextItem.center, valid: true })
  assert.equal(menu.snapshot(), null)
})

test('Sigil radial menu preserves release context for activation adapters', () => {
  const { menu, commits } = createMenu()
  const started = menu.start({ x: 200, y: 200, valid: true }, { x: 260, y: 200, valid: true })
  const contextItem = started.items.find((item) => item.id === 'avatar-controls')

  menu.move({ ...contextItem.center, valid: true })
  menu.release({ ...contextItem.center, valid: true }, {
    input: {
      kind: 'click',
      source: 'sigil.radial-target-surface',
    },
  })

  assert.equal(commits.length, 1)
  assert.equal(commits[0].context.input.kind, 'click')
  assert.equal(commits[0].context.input.source, 'sigil.radial-target-surface')
})

test('Sigil click-open menu keeps trigger-vector geometry stable for item clicks', () => {
  const { menu, commits } = createMenu()
  const origin = { x: 200, y: 200, valid: true }
  const opened = menu.start(origin, { x: 200, y: 169, valid: true })
  const wikiItem = opened.items.find((item) => item.id === 'wiki-graph')

  assert.equal(opened.triggerLocked, true)
  assert.ok(wikiItem)

  const moved = menu.move({ ...wikiItem.center, valid: true })
  assert.equal(moved.snapshot.triggerLocked, true)
  assert.equal(moved.snapshot.triggerAngle, opened.triggerAngle)
  assert.equal(moved.snapshot.activeItemId, 'wiki-graph')

  const released = menu.release({ ...wikiItem.center, valid: true })
  assert.equal(released.phase, 'committed')
  assert.equal(released.committed.itemId, 'wiki-graph')
  assert.equal(commits.length, 1)
})

test('Sigil radial menu keeps its egress vector stable and adjusts it to fit the active display', () => {
  const displays = [
    {
      id: 'main',
      visibleBounds: { x: 0, y: 0, w: 640, h: 480 },
      bounds: { x: 0, y: 0, w: 640, h: 480 },
    },
    {
      id: 'secondary',
      visibleBounds: { x: 640, y: 0, w: 640, h: 480 },
      bounds: { x: 640, y: 0, w: 640, h: 480 },
    },
  ]
  const { menu } = createMenu({
    state: {
      radialGestureMenu: {
        orientation: 'trigger-vector',
      },
      displays,
    },
  })
  const origin = { x: 612, y: 240, valid: true }
  const opened = menu.start(origin, { x: 760, y: 240, valid: true })
  const moved = menu.move({ x: 220, y: 80, valid: true })

  assert.equal(opened.triggerAngle, moved.snapshot.triggerAngle)
  assert.deepEqual(
    moved.snapshot.items.map((item) => item.center),
    opened.items.map((item) => item.center),
  )
  assert.ok(opened.items.every((item) => item.center.x >= 24 && item.center.x <= 616))
  assert.ok(opened.items.every((item) => item.center.y >= 24 && item.center.y <= 456))
})

test('Sigil radial menu config carries native wiki model geometry', () => {
  const contextItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'avatar-controls')
  const agentTerminalItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'agent-terminal')
  const annotationItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'annotation-mode')
  const cameraItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'annotation-camera')
  const wikiItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'wiki-graph')

  assert.equal(contextItem.action, 'avatarControls')
  assert.equal(contextItem.geometry.type, 'gltf')
  assert.equal(contextItem.geometry.modelUid, '158a1e27214841589dce6d7361f1a422')
  assert.match(contextItem.geometry.src, /cog\/scene\.gltf$/)
  assert.deepEqual(contextItem.geometry.rotationDegrees, { x: 90, y: 0, z: 0 })
  assert.equal(contextItem.geometry.attribution.author, 'Jiri Kuba')

  assert.equal(agentTerminalItem.label, 'Agent Terminal')
  assert.equal(agentTerminalItem.action, 'agentTerminal')
  assert.equal(agentTerminalItem.geometry.type, 'gltf')
  assert.match(agentTerminalItem.geometry.src, /low-poly-sci-fi-tablet\/scene\.gltf$/)

  assert.equal(annotationItem.label, 'Annotate')
  assert.equal(annotationItem.action, 'annotationMode')
  assert.equal(annotationItem.geometry.type, 'glyph')
  assert.equal(annotationItem.geometry.glyph, 'annotation-reticle')

  assert.equal(cameraItem.label, 'Snapshot')
  assert.equal(cameraItem.action, 'annotationSnapshot')
  assert.equal(cameraItem.requiresLiveAnnotationAnchors, true)
  assert.equal(cameraItem.geometry.glyph, 'annotation-camera')

  assert.equal(wikiItem.action, 'wikiGraph')
  assert.equal(wikiItem.geometry.type, 'gltf')
  assert.equal(wikiItem.geometry.modelUid, '49bcdf19c1904c76a456b31838b0d7ac')
  assert.match(wikiItem.geometry.src, /human-brain\/scene\.gltf$/)
  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radiusScale, 1.1502)
  assert.equal(wikiItem.geometry.normalizedRadius, 0.28)
  assert.equal(wikiItem.geometry.hoverSpinSpeed, undefined)
  assert.equal(wikiItem.geometry.hoverYawDegrees, undefined)
  assert.equal(wikiItem.geometry.activationTransition, undefined)
  assert.equal(wikiItem.activationTransition.preset, 'wiki-brain-zoom-dissolve')
  assert.equal(wikiItem.activationTransition.item.focus.mode, 'fill-camera')
  assert.equal(wikiItem.activationTransition.menu.dissolve, true)
  assert.deepEqual(wikiItem.geometry.radialEffect, {
    kind: 'nested-neural-tree',
    holdExitDirection: 'outward',
    shellOpacity: {
      rest: 0.75,
      active: 0.26,
      held: 0.75,
    },
    fractalPulse: {
      intensity: 1,
    },
  })
  assert.equal(wikiItem.geometry.attribution.author, 'Versal')
  assert.equal(wikiItem.geometry.attribution.license, 'CC-BY-4.0')
})

test('Sigil radial menu hides camera affordance until live annotation anchors exist', () => {
  const hidden = createMenu().menu.start({ x: 200, y: 200, valid: true })
  assert.equal(hidden.items.some((item) => item.id === 'annotation-camera'), false)
  assert.equal(hidden.items.some((item) => item.id === 'annotation-mode'), true)

  const { menu } = createMenu({
    state: {
      annotationReticle: {
        camera_available: true,
        live_anchor_count: 1,
      },
    },
  })
  const visible = menu.start({ x: 200, y: 200, valid: true })
  assert.equal(visible.items.some((item) => item.id === 'annotation-camera'), true)
})

test('Sigil radial menu carries data-driven avatar-click open animation config', () => {
  const { menu } = createMenu()
  const snapshot = menu.start({ x: 200, y: 200, valid: true })

  assert.deepEqual(snapshot.visuals.openAnimation, {
    trigger: 'avatar-click',
    durationMs: 333,
    easing: 'easeOutCubic',
  })
})

test('Sigil radial menu preserves click-open animation metadata while radial stays open', () => {
  const { menu } = createMenu()
  const started = menu.start({ x: 200, y: 200, valid: true })
  const openAnimation = {
    trigger: 'avatar-click',
    startedAt: 0,
    durationMs: 333,
  }

  menu.applySnapshot({ ...started, openAnimation })
  const moved = menu.move({ x: 206, y: 202, valid: true })

  assert.deepEqual(moved.snapshot.openAnimation, openAnimation)
})

test('Sigil default radial geometry leaves adjacent four and five item targets separated', () => {
  function assertSeparated(snapshot) {
    const sorted = [...snapshot.items].sort((a, b) => a.angle - b.angle)
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1]
      const current = sorted[i]
      const centerDistance = Math.hypot(current.center.x - previous.center.x, current.center.y - previous.center.y)
      const minSemanticSpacing = previous.hitRadius + current.hitRadius
      const minVisualSpacing = previous.visualRadius + current.visualRadius
      assert.ok(centerDistance > minSemanticSpacing, `${previous.id} overlaps ${current.id} semantic hit targets`)
      assert.ok(centerDistance > minVisualSpacing, `${previous.id} overlaps ${current.id} visual targets`)
      assert.ok(centerDistance >= 56, `${previous.id} and ${current.id} are too close for AOS target surfaces`)
    }
  }

  const hiddenCamera = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: defaultState.avatarHitRadius,
      radialGestureMenu: defaultState.radialGestureMenu,
      annotationReticle: { camera_available: false, live_anchor_count: 0 },
    },
  }).start({ x: 200, y: 200, valid: true })
  assert.equal(hiddenCamera.items.length, 4)
  assertSeparated(hiddenCamera)

  const visibleCamera = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: defaultState.avatarHitRadius,
      radialGestureMenu: defaultState.radialGestureMenu,
      annotationReticle: { camera_available: true, live_anchor_count: 1 },
    },
  }).start({ x: 200, y: 200, valid: true })
  assert.equal(visibleCamera.items.length, 5)
  assertSeparated(visibleCamera)
})

test('Sigil radial menu leaves an egress lane on the threshold vector', () => {
  const origin = { x: 200, y: 200, valid: true }
  const rightward = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: defaultState.avatarHitRadius,
      radialGestureMenu: defaultState.radialGestureMenu,
      annotationReticle: { camera_available: false, live_anchor_count: 0 },
    },
  }).start(origin, { x: 260, y: 200, valid: true })
  const reticle = rightward.items.find((item) => item.id === 'annotation-mode')
  const deltas = Object.fromEntries(
    rightward.items.map((item) => [item.id, Math.round(shortestAngleDelta(item.angle, 0) * 1000) / 1000])
  )

  assert.equal(rightward.items.length, 4)
  assert.deepEqual(deltas, {
    'avatar-controls': -56,
    'agent-terminal': -18.667,
    'annotation-mode': 18.667,
    'wiki-graph': 56,
  })
  assert.ok(reticle.center.x > origin.x)
  assert.ok(reticle.center.y > origin.y)
  assert.equal(rightward.items.some((item) => item.angle === 0), false)

  const straightEgress = {
    ...rightward,
    pointer: pointAtAngle(origin, 0, rightward.radii.handoff + 16),
  }
  const metrics = radialItemPointerMetrics(straightEgress, reticle)
  assert.ok(metrics.lateralDistance > reticle.hitRadius)
  assert.equal(reticleOuterMarginExit(metrics, straightEgress), false)

  const upward = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: defaultState.avatarHitRadius,
      radialGestureMenu: defaultState.radialGestureMenu,
      annotationReticle: { camera_available: false, live_anchor_count: 0 },
    },
  }).start(origin, { x: 200, y: 140, valid: true })
  assert.equal(Math.round(shortestAngleDelta(upward.items.find((item) => item.id === 'annotation-mode').angle, 270) * 1000) / 1000, 18.667)
})

test('Sigil radial menu uses array order to put middle items beside the egress lane', () => {
  const origin = { x: 200, y: 200, valid: true }
  const visibleCamera = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: defaultState.avatarHitRadius,
      radialGestureMenu: defaultState.radialGestureMenu,
      annotationReticle: { camera_available: true, live_anchor_count: 1 },
    },
  }).start(origin, { x: 260, y: 200, valid: true })
  const deltas = Object.fromEntries(
    visibleCamera.items.map((item) => [item.id, Math.round(shortestAngleDelta(item.angle, 0) * 1000) / 1000])
  )
  const reticle = visibleCamera.items.find((item) => item.id === 'annotation-mode')

  assert.equal(visibleCamera.items.length, 5)
  assert.deepEqual(deltas, {
    'avatar-controls': -56,
    'agent-terminal': -33.6,
    'annotation-mode': -11.2,
    'annotation-camera': 11.2,
    'wiki-graph': 33.6,
  })
  assert.equal(visibleCamera.items.some((item) => item.angle === 0), false)

  const straightEgress = {
    ...visibleCamera,
    pointer: pointAtAngle(origin, 0, visibleCamera.radii.handoff + 16),
  }
  const metrics = radialItemPointerMetrics(straightEgress, reticle)
  assert.ok(metrics.lateralDistance > reticle.hitRadius)
  assert.equal(reticleOuterMarginExit(metrics, straightEgress), false)
})

test('Sigil radial menu normalizes stale wiki brain item geometry from saved config', () => {
  const staleMenu = {
    items: [
      {
        id: 'wiki-graph',
        label: 'Wiki Graph',
        action: 'wikiGraph',
        geometry: {
          type: 'gltf',
          src: '../assets/models/human-brain/scene.gltf',
          modelUid: '49bcdf19c1904c76a456b31838b0d7ac',
          title: 'Human Brain',
          radiusScale: 1.42,
          normalizedRadius: 0.28,
          material: 'translucent-brain',
        },
      },
    ],
  }

  const normalized = normalizeSigilRadialGestureMenu(staleMenu)
  const wikiItem = normalized.items.find((item) => item.id === 'wiki-graph')

  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radiusScale, 1.1502)
  assert.equal(wikiItem.geometry.hoverSpinSpeed, undefined)
  assert.equal(wikiItem.geometry.hoverYawDegrees, undefined)
  assert.equal(wikiItem.geometry.activationTransition, undefined)
  assert.equal(wikiItem.activationTransition.preset, 'wiki-brain-zoom-dissolve')
  assert.deepEqual(wikiItem.geometry.radialEffect, {
    kind: 'nested-neural-tree',
    holdExitDirection: 'outward',
    shellOpacity: {
      rest: 0.75,
      active: 0.26,
      held: 0.75,
    },
    fractalPulse: {
      intensity: 1,
    },
  })
  assert.equal(staleMenu.items[0].geometry.material, 'translucent-brain')
  assert.equal(staleMenu.items[0].geometry.radialEffect, undefined)
})

test('Sigil radial menu start applies normalized stale item geometry', () => {
  const { menu } = createMenu({
    state: {
      radialGestureMenu: {
        items: [
          {
            id: 'wiki-graph',
            label: 'Wiki Graph',
            action: 'wikiGraph',
            geometry: {
              type: 'gltf',
              src: '../assets/models/human-brain/scene.gltf',
              material: 'translucent-brain',
            },
          },
        ],
      },
    },
  })

  const started = menu.start({ x: 200, y: 200, valid: true })
  const wikiItem = started.items.find((item) => item.id === 'wiki-graph')

  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radialEffect.kind, 'nested-neural-tree')
})

test('Sigil radial menu carries visual motion config into snapshots', () => {
  const { menu } = createMenu({
    state: {
      radialGestureMenu: {
        visuals: {
          itemMotion: {
            modelHoverSpinSpeed: 0,
          },
        },
      },
    },
  })

  const started = menu.start({ x: 200, y: 200, valid: true })

  assert.deepEqual(started.visuals, {
    openAnimation: {
      trigger: 'avatar-click',
      durationMs: 333,
      easing: 'easeOutCubic',
    },
    itemMotion: {
      modelHoverSpinSpeed: 0,
    },
  })
})

test('Sigil radial menu keeps the menu radial while hovering outside the handoff radius', () => {
  const { menu } = createMenu()
  menu.start({ x: 0, y: 0, valid: true })

  const hover = menu.move({ x: 190, y: 0, valid: true })
  assert.equal(hover.enteredFastTravel, false)
  assert.equal(hover.reenteredRadial, false)
  assert.equal(hover.priorActiveItemId, null)
  assert.equal(hover.snapshot.phase, 'radial')

  const released = menu.release({ x: 220, y: 25, valid: true })
  assert.equal(released.phase, 'committed')
  assert.equal(released.committed.type, 'fastTravel')
})

test('Sigil radial menu keeps active item state while hovering past the outer radius', () => {
  const { menu } = createMenu()
  const started = menu.start({ x: 200, y: 200, valid: true }, { x: 260, y: 200, valid: true })
  const annotationItem = started.items.find((item) => item.id === 'annotation-mode')

  const hover = menu.move({ ...annotationItem.center, valid: true })
  assert.equal(hover.snapshot.activeItemId, 'annotation-mode')

  const origin = started.origin
  const dx = annotationItem.center.x - origin.x
  const dy = annotationItem.center.y - origin.y
  const length = Math.hypot(dx, dy)
  const handoff = menu.move({
    x: origin.x + (dx / length) * (started.radii.handoff + 12),
    y: origin.y + (dy / length) * (started.radii.handoff + 12),
    valid: true,
  })

  assert.equal(handoff.enteredFastTravel, false)
  assert.equal(handoff.priorActiveItemId, 'annotation-mode')
  assert.equal(handoff.snapshot.phase, 'radial')
})

test('Sigil radial menu commits item when release lands on item after hovering outside the handoff radius', () => {
  const { menu, commits } = createMenu()
  menu.start({ x: 200, y: 200, valid: true }, { x: 260, y: 200, valid: true })

  const handoff = menu.move({ x: 390, y: 200, valid: true })
  assert.equal(handoff.enteredFastTravel, false)
  assert.equal(handoff.snapshot.phase, 'radial')
  const wikiItem = handoff.snapshot.items.find((item) => item.id === 'wiki-graph')

  const released = menu.release({ ...wikiItem.center, valid: true }, {
    input: {
      kind: 'gesture',
      source: 'sigil.avatar',
    },
  })
  assert.equal(released.phase, 'committed')
  assert.equal(released.committed.type, 'item')
  assert.equal(released.committed.itemId, 'wiki-graph')
  assert.equal(commits.length, 1)
  assert.equal(commits[0].item.action, 'wikiGraph')
  assert.deepEqual(commits[0].context.pointer, { ...wikiItem.center, valid: true })
})

test('Sigil radial menu commits fast travel on release outside the handoff radius', () => {
  const { menu, commits } = createMenu()
  menu.start({ x: 0, y: 0, valid: true })

  const released = menu.release({ x: 220, y: 25, valid: true })
  assert.equal(released.phase, 'committed')
  assert.deepEqual(released.committed, {
    type: 'fastTravel',
    origin: { x: 0, y: 0 },
    destination: { x: 220, y: 25 },
  })
  assert.equal(commits.length, 0)
})

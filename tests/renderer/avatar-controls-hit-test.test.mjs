import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createSigilAvatarControls,
  avatarControlsSurfaceScrollDelta,
  avatarControlsContentProps,
  findAvatarControlsElementAt,
  avatarControlsMarkup,
  resolveAvatarControlsOrigin,
} from '../../apps/sigil/avatar-controls/surface.js'
import {
  resolveAvatarPanelAvoidancePosition,
} from '../../apps/sigil/avatar-controls/panel-avoidance.js'
import {
  applyAvatarControlsDescriptorUpdate,
  avatarControlsControlDescriptors,
  getAvatarControlsControlDescriptor,
} from '../../apps/sigil/avatar-controls/descriptors.js'
import {
  avatarControlsDescriptorForVisualObjectDescriptor,
} from '../../apps/sigil/avatar-controls/visual-object-binding.js'
import { createDefaultAvatarState } from '../../apps/sigil/renderer/state.js'
import { createDocument, patchSpreadSupport } from '../toolkit/zag-adapter-test-utils.mjs'

function createPatchedDocument() {
  const document = createDocument()
  const createElement = document.createElement.bind(document)
  document.createElement = (tagName) => patchSpreadSupport(createElement(tagName))
  return document
}

function waitForMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitUntil(predicate, message, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return
    await waitForMicrotasks()
  }
  assert.ok(predicate(), message)
}

function setRect(element, rect) {
  element.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
  })
}

function fieldByDescriptor(doc, descriptorId) {
  return Array.from(doc.body.querySelectorAll('.aos-form-field'))
    .find((element) => element.dataset?.descriptorId === descriptorId)
}

function setSliderRect(doc, descriptorId, rect) {
  const field = fieldByDescriptor(doc, descriptorId)
  assert.ok(field, `missing field for ${descriptorId}`)
  setRect(field, rect)
  for (const selector of [
    '[data-aos-slider-root]',
    '[data-aos-slider-control]',
    '[data-aos-slider-track]',
    '[data-aos-slider-thumb]',
  ]) {
    const element = field.querySelector(selector)
    if (element) setRect(element, rect)
  }
  return field
}

function avatarControlsAnchor(doc) {
  return Array.from(doc.body.children || [])
    .flatMap((child) => Array.from(child.children || []))
    .find((element) => element.id === 'sigil-avatar-controls') || null
}

function childWithClass(element, className) {
  return Array.from(element?.children || [])
    .find((child) => String(child.className || '').split(/\s+/).includes(className)) || null
}

function setToggleRect(doc, descriptorId, rect) {
  const field = fieldByDescriptor(doc, descriptorId)
  assert.ok(field, `missing field for ${descriptorId}`)
  setRect(field, rect)
  for (const element of [
    field.querySelector('label'),
    field.querySelector('input'),
  ].filter(Boolean)) {
    setRect(element, rect)
  }
  return field
}

function sliderX(value, min, max, rect) {
  return rect.left + (((value - min) / (max - min)) * rect.width)
}

function rounded(value) {
  return Number(Number(value).toFixed(6))
}

function fakeElement(id, rect, selector = '*') {
  return {
    id,
    selector,
    classList: {
      contains(name) {
        return selector.includes(`.${name}`)
      },
    },
    closest(query) {
      if (selector.includes(query)) return this
      return null
    },
    getBoundingClientRect() {
      return {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.w,
        bottom: rect.y + rect.h,
      }
    },
  }
}

function fakeAnchor(elements, viewportHit = null) {
  return {
    contains(element) {
      return element === viewportHit || elements.includes(element)
    },
    querySelectorAll(selector) {
      return elements.filter((element) => selector.includes(element.selector))
    },
  }
}

function overlaps(a, b) {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y
}

test('avatar controls origin avoids the avatar hit bounds', () => {
  const origin = resolveAvatarControlsOrigin(
    { x: 500, y: 500 },
    {
      visible: { x: 0, y: 0, w: 1200, h: 900 },
      avatar: { point: { x: 500, y: 500 }, radius: 40 },
    },
  )
  const surface = { x: origin.x, y: origin.y, w: 292, h: 448 }
  const avatar = { x: 460, y: 460, w: 80, h: 80 }

  assert.equal(overlaps(surface, avatar), false)
  assert.equal(origin.x, 558)
})

test('avatar controls origin chooses another side when right side would overlap after clamping', () => {
  const origin = resolveAvatarControlsOrigin(
    { x: 1160, y: 500 },
    {
      visible: { x: 0, y: 0, w: 1200, h: 900 },
      avatar: { point: { x: 1160, y: 500 }, radius: 40 },
    },
  )
  const surface = { x: origin.x, y: origin.y, w: 292, h: 448 }
  const avatar = { x: 1120, y: 460, w: 80, h: 80 }

  assert.equal(overlaps(surface, avatar), false)
  assert.equal(origin.x, 810)
})

test('avatar controls hit test falls back to off-viewport geometry', () => {
  const slider = fakeElement('sigil-avatar-controls-line-duration-slider', { x: 600, y: 1450, w: 180, h: 24 }, '[data-aos-slider-root]')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, slider])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findAvatarControlsElementAt(anchor, { x: 620, y: 1460 }, doc), slider)
})

test('avatar controls hit test prefers viewport hit when available', () => {
  const button = fakeElement('button', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const fallback = fakeElement('fallback', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const anchor = fakeAnchor([fallback], button)
  const doc = {
    elementFromPoint() {
      return button
    },
  }

  assert.equal(findAvatarControlsElementAt(anchor, { x: 30, y: 30 }, doc), button)
})

test('avatar controls hit test includes checkbox labels in projected fallback', () => {
  const label = fakeElement('line-interdim-label', { x: 600, y: 1450, w: 180, h: 24 }, 'label')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, label])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findAvatarControlsElementAt(anchor, { x: 640, y: 1460 }, doc), label)
})

test('avatar controls hit test includes toolkit select options in projected fallback', () => {
  const content = fakeElement('shape-listbox', { x: 600, y: 1450, w: 180, h: 88 }, '[data-aos-select-content]')
  const option = fakeElement('octahedron-option', { x: 604, y: 1478, w: 172, h: 24 }, '[data-aos-select-item]')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, content, option])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findAvatarControlsElementAt(anchor, { x: 640, y: 1484 }, doc), option)
})

test('avatar controls hit test returns the topmost compact toolkit control', () => {
  const field = fakeElement('field', { x: 600, y: 1450, w: 180, h: 48 }, '.aos-form-field')
  const button = fakeElement('surface-shortcut', { x: 610, y: 1460, w: 120, h: 24 }, 'button')
  const anchor = fakeAnchor([field, button])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findAvatarControlsElementAt(anchor, { x: 640, y: 1464 }, doc), button)
})

test('avatar controls markup exposes standard accessibility structure', () => {
  const html = avatarControlsMarkup()

  assert.match(html, /id="sigil-avatar-controls"[^>]*role="dialog"[^>]*aria-label="Sigil avatar control surface"/)
  assert.doesNotMatch(html, /avatar-controls-floating-card/)
  assert.doesNotMatch(html, /avatar-controls-select-popover/)
  assert.doesNotMatch(html, /data-avatar-controls-/)
})

test('avatar controls content props preserve visible open state', () => {
  assert.deepEqual(avatarControlsContentProps(true), {
    'aria-label': 'Sigil avatar control surface',
    'aria-hidden': 'false',
    'data-state': 'open',
    class: 'avatar-controls-anchor sigil-avatar-controls visible',
  })
})

test('avatar controls content props clear visible state when closed', () => {
  assert.deepEqual(avatarControlsContentProps(false), {
    'aria-label': 'Sigil avatar control surface',
    'aria-hidden': 'true',
    'data-state': 'closed',
    class: 'avatar-controls-anchor sigil-avatar-controls',
  })
})

test('avatar controls scroll deltas follow native input and preserve canvas-origin synthetic direction', () => {
  assert.deepEqual(avatarControlsSurfaceScrollDelta({ dy: -8 }), {
    dy: 8,
    dx: 0,
    rawY: -8,
    rawX: 0,
    sourceOrigin: null,
  })
  assert.deepEqual(avatarControlsSurfaceScrollDelta({
    dy: 120,
    dx: 4,
    sourceIdentity: { sourceOrigin: 'canvas' },
  }), {
    dy: 120,
    dx: 4,
    rawY: 120,
    rawX: 4,
    sourceOrigin: 'canvas',
  })
})

test('avatar controls descriptors expose compact avatar surface controls and Sigil-owned actions', () => {
  assert.equal(avatarControlsControlDescriptors.length > 0, true)
  for (const id of [
    'sigil-avatar-controls-shape-select',
    'sigil-avatar-controls-omega-shape',
    'sigil-avatar-controls-opacity',
    'sigil-avatar-controls-fast-travel-effect',
    'sigil-avatar-controls-line-trail-mode',
    'sigil-avatar-controls-grid-mode',
  ]) {
    assert.ok(getAvatarControlsControlDescriptor(id), id)
  }
  for (const action of ['toggle-inspector', 'toggle-trace', 'toggle-render-performance', 'toggle-log', 'copy', 'save', 'import']) {
    const descriptor = getAvatarControlsControlDescriptor(action)
    assert.equal(descriptor?.type, 'action')
    assert.equal(descriptor?.route, 'sigil.action')
  }
})

test('avatar controls descriptors carry toolkit form metadata for compact avatar surface controls', () => {
  const opacity = getAvatarControlsControlDescriptor('sigil-avatar-controls-opacity')
  const fastTravel = getAvatarControlsControlDescriptor('sigil-avatar-controls-fast-travel-effect')
  const grid = getAvatarControlsControlDescriptor('sigil-avatar-controls-grid-mode')

  assert.equal(opacity.type, 'slider')
  assert.equal(opacity.min, 0)
  assert.equal(opacity.max, 1)
  assert.equal(opacity.step, 0.01)
  assert.ok(fastTravel.options.some((option) => option.value === 'line'))
  assert.deepEqual(grid.options.map((option) => option.value), ['off', 'flat', '3d'])
})

test('panel avatar controls treats child panel canvas input as inside the surface', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const previousSetTimeout = globalThis.setTimeout
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const actions = []
    const closes = []
    const timeoutCalls = []
    globalThis.setTimeout = (...args) => {
      timeoutCalls.push(args)
      return previousSetTimeout(...args)
    }
    const controls = createSigilAvatarControls({
      state: {
        avatar: createDefaultAvatarState(),
        currentGeometryType: 12,
        currentType: 12,
        avatarBase: 153,
      },
      liveJs: {
        displays: [
          { id: 'main', visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } },
          { id: 'extended', visibleBounds: { x: 1200, y: 0, w: 1600, h: 900 } },
        ],
        avatarPos: { x: 300, y: 300 },
      },
      projectPoint: (point) => point,
      actionDispatcher(action, payload) {
        actions.push({ action, payload })
        return Promise.resolve({ status: 'ok' })
      },
      panelId: 'panel-test',
      panelUrl: 'aos://sigil/avatar-editor/panel.html',
      onClose(event) {
        closes.push(event.reason)
      },
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 300, y: 300 })
    assert.equal(controls.isOpen(), true)
    assert.equal(actions[0]?.action, 'panel.toggle')
    assert.equal(actions[0]?.payload?.focus, true)
    assert.deepEqual(actions[0]?.payload?.anchor, {
      coordinate_space: 'desktop_world',
      x: controls.bounds().x,
      y: controls.bounds().y,
      offset: { x: 0, y: 0 },
    })
    assert.deepEqual(actions[0]?.payload?.geometry, {
      logical_surface_key: 'sigil.avatar.controls',
    })
    const legacyAnchor = document.getElementById('sigil-avatar-controls')
    assert.ok(legacyAnchor)
    assert.equal(legacyAnchor.classList.contains('visible'), false)
    assert.equal(legacyAnchor.querySelector('.sigil-avatar-control-surface'), null)
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(timeoutCalls, [])
    assert.equal(legacyAnchor.classList.contains('visible'), false)
    assert.equal(legacyAnchor.querySelector('.sigil-avatar-control-surface'), null)

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      raw: { source_canvas_id: 'panel-test' },
    }), true)
    assert.equal(controls.isOpen(), true)
    assert.deepEqual(closes, [])

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      raw: { payload: { source_canvas_id: 'panel-test' } },
    }), true)
    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      sourceIdentity: { ownerCanvasId: 'panel-test' },
      raw: {},
    }), true)
    assert.equal(controls.isOpen(), true)
    assert.deepEqual(closes, [])

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      raw: { source_canvas_id: 'other-panel' },
    }), false)
    assert.equal(controls.isOpen(), true)
    assert.deepEqual(closes, [])

    controls.close('outside-click')
    assert.equal(controls.isOpen(), false)
    assert.equal(actions[actions.length - 1]?.action, 'canvas.suspend')
    assert.equal(actions.some((entry) => entry.action === 'panel.close'), false)
    assert.deepEqual(closes, ['outside-click'])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
    globalThis.setTimeout = previousSetTimeout
  }
})

test('panel avatar controls route detached panel changes through the compact session', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const state = {
      avatar: createDefaultAvatarState(),
      currentGeometryType: 12,
      currentType: 12,
      avatarBase: 153,
    }
    const calls = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [
          { id: 'main', bounds: { x: 0, y: 0, w: 1200, h: 900 }, visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } },
          { id: 'extended', bounds: { x: 1200, y: 0, w: 1600, h: 900 }, visibleBounds: { x: 1200, y: 0, w: 1600, h: 900 } },
        ],
        avatarPos: { x: 300, y: 300 },
      },
      projectPoint: (point) => point,
      updatePrimaryAppearance() { calls.push(['appearance']) },
      onAppearanceChange(event) { calls.push(['persist', event.controlId, event.value]) },
      trace: {
        record(stage, data) {
          if (stage === 'avatar-controls:descriptor-update') calls.push(['descriptor-route', data.id, data.value])
        },
      },
      actionDispatcher() {
        return Promise.resolve({ status: 'ok' })
      },
      panelId: 'panel-test',
      panelUrl: 'aos://sigil/avatar-editor/panel.html',
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 300, y: 300 })
    assert.equal(controls.handlePanelMessage({
      type: 'sigil.avatar_panel.control_change',
      payload: {
        values: { 'sigil-avatar-controls-opacity': 0.36 },
        controls: [{ id: 'sigil-avatar-controls-opacity', descriptor_id: 'sigil-avatar-controls-opacity' }],
      },
    }), true)

    assert.equal(state.avatar.appearance.opacity, 0.36)
    assert.deepEqual(calls.filter(([kind]) => kind === 'descriptor-route'), [[
      'descriptor-route',
      'sigil-avatar-controls-opacity',
      0.36,
    ]])
    assert.deepEqual(calls.filter(([kind]) => kind === 'appearance'), [['appearance']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [['persist', 'sigil-avatar-controls-opacity', 0.36]])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('panel avatar controls updates hit bounds from settled panel frame snapshots', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const controls = createSigilAvatarControls({
      state: {
        avatar: createDefaultAvatarState(),
        currentGeometryType: 12,
        currentType: 12,
        avatarBase: 153,
      },
      liveJs: {
        displays: [{ visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } }],
        avatarPos: { x: 300, y: 300 },
      },
      projectPoint: (point) => point,
      actionDispatcher() {
        return Promise.resolve({ status: 'ok' })
      },
      panelId: 'panel-test',
      panelUrl: 'aos://sigil/avatar-editor/panel.html',
      panelFrameToBounds(frame) {
        return { x: frame[0], y: frame[1], w: frame[2], h: frame[3] }
      },
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 300, y: 300 })
    assert.equal(controls.handlePanelMessage({
      type: 'sigil.avatar_panel.snapshot',
      payload: {
        frame: [520, 540, 332, 540],
        controls: [],
      },
    }), true)
    assert.deepEqual(controls.bounds(), { x: 520, y: 540, w: 332, h: 540 })

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 640, y: 620 }, { raw: {} }), true)
    assert.equal(controls.isOpen(), true)
    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 300, y: 300 }, { raw: {} }), false)
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('avatar panel avoidance moves overlapped avatar outside final panel frame', () => {
  const next = resolveAvatarPanelAvoidancePosition({
    avatarRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: { x: 1180, y: 442, w: 332, h: 540 },
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
    margin: 12,
  })

  assert.deepEqual(next, {
    x: 1128,
    y: 818,
    side: 'left',
    overlap: 0,
  })
})

test('avatar panel avoidance does nothing when avatar and panel do not overlap', () => {
  const next = resolveAvatarPanelAvoidancePosition({
    avatarRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: { x: 200, y: 120, w: 332, h: 540 },
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
  })

  assert.equal(next, null)
})

test('avatar panel avoidance ignores incomplete lifecycle geometry', () => {
  const next = resolveAvatarPanelAvoidancePosition({
    avatarRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: null,
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
  })

  assert.equal(next, null)
})

test('live avatar controls compact surface routes canonical controls through visual object binding once', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const state = {
      avatar: createDefaultAvatarState(),
      currentGeometryType: 12,
      currentType: 12,
      avatarBase: 153,
    }
    const calls = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [{ visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } }],
        avatarPos: { x: 0, y: 0 },
      },
      projectPoint: (point) => point,
      updatePrimaryAppearance() { calls.push(['appearance']) },
      onAppearanceChange(event) {
        calls.push([
          'persist',
          event.controlId,
          event.value,
          event.descriptor?.contract,
          event.descriptor?.id,
          event.compatibilityDescriptor?.id,
        ])
      },
      trace: {
        record(stage, data) {
          if (stage === 'avatar-controls:descriptor-update') calls.push(['legacy-route', data.id])
          if (stage === 'avatar-controls:visual-object-binding-update') calls.push(['binding-route', data.compatibilityId])
        },
      },
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const field = Array.from(document.body.querySelectorAll('.aos-form-field'))
      .find((element) => element.dataset?.descriptorId === 'sigil-avatar-controls-opacity')
    assert.ok(field)
    const track = field.querySelector('[data-aos-slider-track]')
    const slider = field.querySelector('[data-aos-slider-root]')
    assert.ok(track)
    assert.ok(slider)
    const sliderRect = () => ({
      left: 20,
      top: 20,
      right: 120,
      bottom: 28,
      width: 100,
      height: 8,
    })
    field.getBoundingClientRect = sliderRect
    slider.getBoundingClientRect = sliderRect
    track.getBoundingClientRect = sliderRect

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 62, y: 24 }), true)
    assert.equal(controls.handlePointerEvent('left_mouse_up', { x: 62, y: 24 }), true)
    await waitForMicrotasks()

    assert.equal(state.avatar.appearance.opacity, 0.42)
    assert.deepEqual(calls.filter(([kind]) => kind === 'binding-route'), [['binding-route', 'sigil-avatar-controls-opacity']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'legacy-route'), [])
    assert.deepEqual(calls.filter(([kind]) => kind === 'appearance'), [['appearance']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [[
      'persist',
      'sigil-avatar-controls-opacity',
      0.42,
      'aos.visual_object.descriptor.v0',
      'sigil.avatar.primary-polyhedron.avatar.appearance.opacity',
      'sigil-avatar-controls-opacity',
    ]])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live avatar controls snapshot includes compact surface tab control records', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  const liveJs = {
    displays: [{ visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } }],
    avatarPos: { x: 0, y: 0 },
  }
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const controls = createSigilAvatarControls({
      state: {
        avatar: createDefaultAvatarState(),
        currentGeometryType: 12,
        currentType: 12,
        avatarBase: 153,
      },
      liveJs,
      projectPoint: (point) => point,
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const omegaTrigger = Array.from(document.body.querySelectorAll('[data-aos-tabs-trigger]'))
      .find((element) => element.dataset.value === 'omega')
    omegaTrigger.getBoundingClientRect = () => ({
      left: 132,
      top: 20,
      right: 204,
      bottom: 44,
      width: 72,
      height: 24,
    })

    const omegaRecord = controls.snapshot().controls.find((record) => (
      record.ref === 'sigil.avatar.compact_control_surface:omega'
    ))

    assert.equal(omegaRecord.role, 'tab')
    assert.equal(omegaRecord.provenance.source_payload_id, 'omega')
    assert.equal(omegaRecord.state.value, 'omega')
    assert.equal(omegaRecord.name, 'Omega')
    assert.equal(omegaRecord.state.selected, false)
    assert.deepEqual(omegaRecord.provenance.frame, { x: 132, y: 20, width: 72, height: 24 })
    assert.ok(liveJs.avatarControls.controls.some((record) => (
      record.ref === 'sigil.avatar.compact_control_surface:alpha'
    )))
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live avatar controls visual binding suppresses duplicate slider commits', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const state = {
      avatar: createDefaultAvatarState(),
      currentGeometryType: 12,
      currentType: 12,
      avatarBase: 153,
    }
    const calls = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [{ visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } }],
        avatarPos: { x: 0, y: 0 },
      },
      projectPoint: (point) => point,
      updatePrimaryAppearance() { calls.push(['appearance']) },
      onAppearanceChange(event) { calls.push(['persist', event.value]) },
      trace: {
        record(stage, data) {
          if (stage === 'avatar-controls:visual-object-binding-update') calls.push(['binding-route', data.value])
        },
      },
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const field = Array.from(document.body.querySelectorAll('.aos-form-field'))
      .find((element) => element.dataset?.descriptorId === 'sigil-avatar-controls-opacity')
    const track = field.querySelector('[data-aos-slider-track]')
    const slider = field.querySelector('[data-aos-slider-root]')
    const sliderRect = () => ({
      left: 20,
      top: 20,
      right: 120,
      bottom: 28,
      width: 100,
      height: 8,
    })
    field.getBoundingClientRect = sliderRect
    slider.getBoundingClientRect = sliderRect
    track.getBoundingClientRect = sliderRect

    assert.equal(controls.handlePointerEvent('left_mouse_down', { x: 62, y: 24 }), true)
    assert.equal(controls.handlePointerEvent('left_mouse_up', { x: 62, y: 24 }), true)
    await waitForMicrotasks()

    assert.deepEqual(calls.filter(([kind]) => kind === 'binding-route'), [['binding-route', 0.42]])
    assert.deepEqual(calls.filter(([kind]) => kind === 'appearance'), [['appearance']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [['persist', 0.42]])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live avatar controls keeps scrolled compact Box sliders routed to their descriptors', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const avatar = createDefaultAvatarState()
    avatar.shape.type = 6
    avatar.shape.tesseron.enabled = true
    avatar.shape.stellationFactor = 0
    avatar.shape.params.box = { width: 1, height: 1, depth: 1 }
    const state = {
      avatar,
      currentGeometryType: 6,
      currentType: 6,
      avatarBase: 153,
      tesseron: avatar.shape.tesseron,
      stellationFactor: 0,
      boxWidth: 1,
      boxHeight: 1,
      boxDepth: 1,
    }
    const calls = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [{ visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } }],
        avatarPos: { x: 0, y: 0 },
      },
      projectPoint: (point) => point,
      updateGeometry(value) { calls.push(['geometry', value]) },
      updatePrimaryStellation(value) { calls.push(['stellation', value]) },
      trace: {
        record(stage, data) {
          if (stage === 'avatar-controls:visual-object-binding-update') {
            calls.push(['binding-route', data.compatibilityId, data.value])
          }
        },
      },
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const surface = document.body.querySelector('.sigil-avatar-control-surface')
    assert.ok(surface)
    setRect(surface, { left: 18, top: 18, width: 292, height: 448 })
    surface.scrollTop = 0
    surface.scrollLeft = 0

    assert.equal(controls.handlePointerEvent('scroll_wheel', { x: 80, y: 80 }, {
      raw: { dy: 180, sourceOrigin: 'canvas' },
    }), true)
    assert.equal(surface.scrollTop, 180)

    const tesseronInput = fieldByDescriptor(document, 'sigil-avatar-controls-tesseron')?.querySelector('input')
    assert.ok(tesseronInput)
    tesseronInput.checked = false
    tesseronInput.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForMicrotasks()
    await waitForMicrotasks()

    assert.equal(state.avatar.shape.tesseron.enabled, false)

    const hiddenLaterTabConflict = 'sigil-avatar-controls-trail-length'
    const drags = [
      ['sigil-avatar-controls-box-width', 'width', 2.05, 0.1, 4, { left: 34, top: 142, width: 180, height: 24 }],
      ['sigil-avatar-controls-box-height', 'height', 1.66, 0.1, 4, { left: 34, top: 178, width: 180, height: 24 }],
      ['sigil-avatar-controls-box-depth', 'depth', 3.22, 0.1, 4, { left: 34, top: 214, width: 180, height: 24 }],
      ['sigil-avatar-controls-stellation', 'stellationFactor', 1.25, -1, 2, { left: 34, top: 250, width: 180, height: 24 }],
    ]

    for (const [descriptorId, key, value, min, max, rect] of drags) {
      setSliderRect(document, descriptorId, rect)
      setSliderRect(document, hiddenLaterTabConflict, rect)
      const beforeRouteCount = calls.filter(([kind]) => kind === 'binding-route').length
      const beforeValue = key === 'stellationFactor'
        ? state.avatar.shape.stellationFactor
        : state.avatar.shape.params.box[key]
      const downPoint = { x: sliderX(min, min, max, rect), y: rect.top + 12 }
      const dragPoint = { x: sliderX((min + value) / 2, min, max, rect), y: rect.top + 12 }
      const upPoint = { x: sliderX(value, min, max, rect), y: rect.top + 12 }

      assert.equal(controls.handlePointerEvent('left_mouse_down', downPoint), true)
      assert.equal(controls.handlePointerEvent('left_mouse_dragged', dragPoint), true)
      await waitForMicrotasks()
      await waitForMicrotasks()

      assert.equal(calls.filter(([kind]) => kind === 'binding-route').length, beforeRouteCount)
      if (key === 'stellationFactor') {
        assert.equal(rounded(state.avatar.shape.stellationFactor), rounded(beforeValue))
      } else {
        assert.equal(rounded(state.avatar.shape.params.box[key]), rounded(beforeValue))
      }

      assert.equal(controls.handlePointerEvent('left_mouse_up', upPoint), true)
      await waitForMicrotasks()
      await waitForMicrotasks()

      if (key === 'stellationFactor') {
        assert.equal(rounded(state.avatar.shape.stellationFactor), value)
      } else {
        assert.equal(rounded(state.avatar.shape.params.box[key]), value)
      }
      assert.equal(state.avatar.effects.trail.length, 20)
    }

    assert.deepEqual({
      width: rounded(state.avatar.shape.params.box.width),
      height: rounded(state.avatar.shape.params.box.height),
      depth: rounded(state.avatar.shape.params.box.depth),
    }, { width: 2.05, height: 1.66, depth: 3.22 })
    assert.equal(rounded(state.avatar.shape.stellationFactor), 1.25)
    assert.deepEqual(calls.filter(([kind]) => kind === 'binding-route').map(([, id]) => id), [
      'sigil-avatar-controls-tesseron',
      'sigil-avatar-controls-box-width',
      'sigil-avatar-controls-box-height',
      'sigil-avatar-controls-box-depth',
      'sigil-avatar-controls-stellation',
    ])
    assert.deepEqual(calls.filter(([kind]) => kind === 'stellation'), [['stellation', 1.25]])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('visual object binding resolves compatibility descriptors without a copied behavior tree', async () => {
  assert.equal(
    avatarControlsDescriptorForVisualObjectDescriptor({
      id: 'compact-control:opacity',
      state_path: 'avatar.appearance.opacity',
      route: 'canvas_object.effects.patch',
    })?.id,
    'sigil-avatar-controls-opacity',
  )

  const menuSource = await readFile(new URL('../../apps/sigil/avatar-controls/surface.js', import.meta.url), 'utf8')
  const adapterSource = await readFile(new URL('../../apps/sigil/avatar-controls/visual-object-binding.js', import.meta.url), 'utf8')
  assert.equal(menuSource.includes('function applyVisualBindingCompatibility'), false)
  assert.equal(menuSource.includes("compatibility.id === 'sigil-avatar-controls-shape-select'"), false)
  assert.equal(adapterSource.includes('applyAvatarControlsDescriptorUpdate'), true)
})

test('descriptor routing applies a shape control through geometry sync', () => {
  const calls = []
  const state = { avatar: { shape: { type: 4, tesseron: { enabled: false } }, appearance: {}, effects: {} } }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-shape-select', '8', {
    state,
    updateGeometry(value) { calls.push(['geometry', value]) },
    onAppearanceChange(event) { calls.push(['persist', event.controlId, event.value]) },
    setControlDisabled(id, value) { calls.push(['disabled', id, value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.type, 8)
  assert.equal(state.currentGeometryType, 8)
  assert.deepEqual(calls.filter(([kind]) => kind === 'geometry'), [['geometry', 8]])
  assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [['persist', 'sigil-avatar-controls-shape-select', 8]])
})

test('descriptor routing applies primary stellation through minimal sync hook', () => {
  const calls = []
  const state = {
    avatar: {
      shape: { type: 20, stellationFactor: 0.2, tesseron: { enabled: false } },
      appearance: {},
      effects: {},
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-stellation', '1.25', {
    state,
    updateGeometry(value) { calls.push(['geometry', value]) },
    updatePrimaryStellation(value) { calls.push(['stellation', value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.stellationFactor, 1.25)
  assert.deepEqual(calls, [['stellation', 1.25]])
})

test('descriptor routing applies primary tesseron proportion through minimal sync hook', () => {
  const calls = []
  const state = {
    avatar: {
      shape: {
        type: 4,
        tesseron: { enabled: true, proportion: 0.5, matchMother: true, child: {} },
      },
      appearance: {},
      effects: {},
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-tesseron-proportion', '0.68', {
    state,
    updateGeometry(value) { calls.push(['geometry', value]) },
    updatePrimaryTesseronProportion(value) { calls.push(['tesseron-proportion', value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.tesseron.proportion, 0.68)
  assert.deepEqual(calls, [['tesseron-proportion', 0.68]])
})

test('descriptor routing applies primary appearance controls through minimal sync hook', () => {
  for (const [id, rawValue, expectedPath, expectedValue] of [
    ['sigil-avatar-controls-opacity', '0.35', ['appearance', 'opacity'], 0.35],
    ['sigil-avatar-controls-edge-opacity', '0.2', ['appearance', 'edgeOpacity'], 0.2],
    ['sigil-avatar-controls-xray', true, ['appearance', 'interiorEdges'], true],
    ['sigil-avatar-controls-specular', false, ['appearance', 'specular'], false],
  ]) {
    const calls = []
    const state = {
      avatar: {
        shape: { type: 20, tesseron: { enabled: false } },
        appearance: {
          opacity: 0.8,
          edgeOpacity: 0.6,
          interiorEdges: false,
          specular: true,
        },
        effects: {},
      },
    }
    const result = applyAvatarControlsDescriptorUpdate(id, rawValue, {
      state,
      updateGeometry(value) { calls.push(['geometry', value]) },
      updatePrimaryAppearance() { calls.push(['appearance']) },
    })

    assert.equal(result.route, 'canvas_object.effects.patch')
    assert.equal(state.avatar[expectedPath[0]][expectedPath[1]], expectedValue)
    assert.deepEqual(calls, [['appearance']])
  }
})

test('descriptor routing applies shape-specific prism parameters through shared geometry sync', () => {
  const calls = []
  const state = {
    avatar: {
      shape: {
        type: 93,
        params: { cylinder: { sides: 32 } },
      },
      appearance: {},
      effects: { omega: { shape: { type: 93 } } },
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-prism-sides', '12', {
    state,
    updateGeometry(value) { calls.push(['alpha', value]) },
    updateOmegaGeometry(value) { calls.push(['omega', value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.params.cylinder.sides, 12)
  assert.deepEqual(calls, [['alpha', 93]])
})

test('descriptor routing applies omega shape parameters through omega canonical graph only', () => {
  const calls = []
  const state = {
    avatar: {
      shape: {
        type: 93,
        params: { cylinder: { sides: 32 } },
      },
      appearance: {},
      effects: {
        omega: {
          shape: {
            type: 93,
            params: { cylinder: { sides: 16 } },
          },
        },
      },
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-omega-prism-sides', '12', {
    state,
    updateGeometry(value) { calls.push(['alpha', value]) },
    updateOmegaGeometry(value) { calls.push(['omega', value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.params.cylinder.sides, 32)
  assert.equal(state.avatar.effects.omega.shape.params.cylinder.sides, 12)
  assert.deepEqual(calls, [['omega', 93]])
})

test('descriptor routing applies a tesseron control and preserves child overrides', () => {
  const state = {
    avatar: {
      shape: {
        type: 4,
        tesseron: { enabled: true, proportion: 0.5, matchMother: true, child: {} },
      },
      appearance: {
        opacity: 0.4,
        edgeOpacity: 0.7,
        maskEnabled: true,
        interiorEdges: false,
        specular: true,
      },
      effects: {},
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-tesseron-match', false, { state })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.tesseron.matchMother, false)
  assert.equal(state.avatar.shape.tesseron.child.opacity, 0.4)
  assert.equal(state.avatar.shape.tesseron.child.edgeOpacity, 0.7)
  assert.equal(state.avatar.shape.tesseron.child.maskEnabled, true)
  assert.equal(state.avatar.shape.tesseron.child.specular, true)
})

test('descriptor routing applies an effect control through effect patch sync', () => {
  const calls = []
  const state = {
    avatar: {
      shape: {},
      appearance: {},
      effects: { phenomena: { pulsar: { enabled: false, count: 0 } } },
    },
  }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-pulsar', true, {
    state,
    updatePulsars(count) { calls.push(count) },
  })

  assert.equal(result.route, 'canvas_object.effects.patch')
  assert.equal(state.avatar.effects.phenomena.pulsar.enabled, true)
  assert.equal(state.pulsarRayCount, 1)
  assert.deepEqual(calls, [1])
})

test('descriptor routing applies a world/window control without turning it into an object patch', () => {
  const calls = []
  const state = { avatarWindowLevel: 'status_bar' }
  const result = applyAvatarControlsDescriptorUpdate('sigil-avatar-controls-avatar-above-menu', true, {
    state,
    onAvatarWindowLevelChange(level) { calls.push(level) },
  })

  assert.equal(result.route, 'world-context.patch')
  assert.equal(state.avatarWindowLevel, 'screen_saver')
  assert.deepEqual(calls, ['screen_saver'])
})

test('descriptor routing identifies product actions as Sigil actions', () => {
  const result = applyAvatarControlsDescriptorUpdate('toggle-render-performance', 'toggle-render-performance', {})

  assert.equal(result.route, 'sigil.action')
  assert.equal(result.persisted, false)
  assert.equal(result.actionId, 'render-performance')
})

// Option A — embedded path (panelUrl: null) gate test.
//
// Verifies that when panelUrl is null (production config after One-World Phase 3
// Task 2 flip), the controls surface uses the embedded path and the actionDispatcher
// is never called for any panel canvas or canvas lifecycle action. This is the
// unit-level "IPC→0 by construction" proof: the dispatch path is simply absent.
test('embedded controls (panelUrl:null) activate embedded path and never dispatch panel actions', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const state = {
      avatar: createDefaultAvatarState(),
      currentGeometryType: 12,
      currentType: 12,
      avatarBase: 153,
    }
    const dispatchedActions = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [
          { id: 'main', bounds: { x: 0, y: 0, w: 1200, h: 900 }, visibleBounds: { x: 0, y: 0, w: 1200, h: 900 } },
          { id: 'extended', bounds: { x: 1200, y: 0, w: 1600, h: 900 }, visibleBounds: { x: 1200, y: 0, w: 1600, h: 900 } },
        ],
        avatarPos: { x: 300, y: 300 },
      },
      projectPoint: (point) => point,
      updatePrimaryAppearance() {},
      onAppearanceChange() {},
      actionDispatcher(action, payload = {}) {
        dispatchedActions.push({ action, payload })
        return Promise.resolve({ status: 'ok' })
      },
      panelId: 'sigil-avatar-controls-avatar-main',
      panelUrl: null,
      allowTestAnchorFallback: true,
    })

    // usesExternalPanel must be false — embedded path active
    assert.equal(controls.usesExternalPanel(), false)

    // openAt must mount the embedded surface without any panel.toggle dispatch
    controls.openAt({ x: 300, y: 300 })
    assert.equal(controls.isOpen(), true)
    assert.equal(dispatchedActions.some((entry) => entry.action === 'panel.toggle'), false)
    assert.deepEqual(controls.bounds(), { x: 358, y: 30, w: 332, h: 540 })
    assert.equal(overlaps(controls.bounds(), { x: 260, y: 260, w: 80, h: 80 }), false)
    assert.equal(controls.snapshot().placementPlan.chosen_placement, 'right')
    assert.equal(controls.snapshot().placementPlan.anchor_display_id, 'main')
    assert.deepEqual(controls.snapshot().placementPlan.final_settled_frame, [358, 30, 332, 540])

    await waitUntil(
      () => childWithClass(avatarControlsAnchor(document), 'aos-panel'),
      'embedded controls must use toolkit panel chrome'
    )
    const anchor = avatarControlsAnchor(document)
    const panel = childWithClass(anchor, 'aos-panel')
    const header = childWithClass(panel, 'aos-header')
    assert.ok(header, 'embedded controls must expose toolkit panel header chrome')
    assert.equal(header.dataset?.draggable, 'true', 'embedded controls must use toolkit draggable panel chrome')
    assert.equal(header.dataset?.aosAction, 'panel_drag', 'embedded controls expose stock panel drag semantics')
    const controlsEl = childWithClass(header, 'aos-controls')
    const windowControlsEl = childWithClass(controlsEl, 'aos-window-controls')
    assert.ok(childWithClass(windowControlsEl, 'aos-window-close'), 'embedded controls must expose a standard close control')

    const beforeDragBounds = controls.interactiveBounds()
    setRect(anchor, { left: beforeDragBounds.x, top: beforeDragBounds.y, width: beforeDragBounds.w, height: beforeDragBounds.h })
    setRect(panel, { left: beforeDragBounds.x, top: beforeDragBounds.y, width: beforeDragBounds.w, height: beforeDragBounds.h })
    setRect(header, { left: beforeDragBounds.x, top: beforeDragBounds.y, width: beforeDragBounds.w, height: 38 })
    const previousElementFromPoint = document.elementFromPoint
    document.elementFromPoint = (x, y) => (
      x >= beforeDragBounds.x && x < beforeDragBounds.x + beforeDragBounds.w && y >= beforeDragBounds.y && y < beforeDragBounds.y + 38
        ? header
        : previousElementFromPoint?.call(document, x, y) || null
    )
    assert.equal(findAvatarControlsElementAt(anchor, { x: beforeDragBounds.x + 20, y: beforeDragBounds.y + 18 }, document), header)

    const hitRoute = { regionId: 'sigil-avatar-controls', source: 'canvas' }
    controls.handlePointerEvent('left_mouse_down', { x: beforeDragBounds.x + 20, y: beforeDragBounds.y + 18 }, hitRoute)
    controls.handlePointerEvent('left_mouse_dragged', { x: beforeDragBounds.x + 60, y: beforeDragBounds.y + 58 }, hitRoute)
    controls.handlePointerEvent('left_mouse_up', { x: beforeDragBounds.x + 60, y: beforeDragBounds.y + 58 }, hitRoute)
    assert.deepEqual(controls.bounds(), {
      x: beforeDragBounds.x + 40,
      y: beforeDragBounds.y + 40,
      w: beforeDragBounds.w,
      h: beforeDragBounds.h,
    })
    document.elementFromPoint = previousElementFromPoint

    // Slider drag must route through onControlChange in-heap without any dispatch
    const field = Array.from(document.body.querySelectorAll('.aos-form-field'))
      .find((element) => element.dataset?.descriptorId === 'sigil-avatar-controls-opacity')
    assert.ok(field, 'opacity field must be mounted in avatar-main document')
    const track = field.querySelector('[data-aos-slider-track]')
    const slider = field.querySelector('[data-aos-slider-root]')
    assert.ok(track)
    assert.ok(slider)
    const sliderRect = () => ({
      left: 20, top: 20, right: 120, bottom: 28, width: 100, height: 8,
    })
    field.getBoundingClientRect = sliderRect
    slider.getBoundingClientRect = sliderRect
    track.getBoundingClientRect = sliderRect

    controls.handlePointerEvent('left_mouse_down', { x: 62, y: 24 })
    controls.handlePointerEvent('left_mouse_up', { x: 62, y: 24 })
    await waitForMicrotasks()

    // Slider commit must apply geometry in-heap
    assert.equal(state.avatar.appearance.opacity, 0.42)

    // No cross-canvas dispatch for the entire open+drag+close cycle
    assert.equal(dispatchedActions.some((entry) => entry.action === 'panel.toggle'), false)

    // Outside focus/clicks should not destroy the embedded standard panel.
    controls.close('outside-click')
    assert.equal(controls.isOpen(), true)

    // Explicit panel close must not dispatch canvas.suspend or panel.close.
    controls.close('panel-close-request')
    assert.equal(controls.isOpen(), false)
    assert.equal(dispatchedActions.some((entry) => entry.action === 'canvas.suspend'), false)
    assert.equal(dispatchedActions.some((entry) => entry.action === 'panel.close'), false)

    // Dispatcher may only have been called for non-panel actions (e.g. state sync)
    const panelOrCanvasActions = dispatchedActions.filter((entry) =>
      entry.action === 'panel.toggle' ||
      entry.action === 'panel.close' ||
      entry.action === 'canvas.suspend' ||
      entry.action === 'canvas.resume'
    )
    assert.deepEqual(panelOrCanvasActions, [])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('embedded controls initial placement uses toolkit panel dimensions on stacked display seams', async () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 982 }
  globalThis.Event = document.defaultView.Event

  try {
    const state = {
      avatar: createDefaultAvatarState(),
      currentGeometryType: 12,
      currentType: 12,
      avatarBase: 153,
    }
    const dispatchedActions = []
    const controls = createSigilAvatarControls({
      state,
      liveJs: {
        displays: [
          { id: '1', bounds: { x: 207, y: 0, w: 1512, h: 982 }, visibleBounds: { x: 207, y: 0, w: 1512, h: 982 } },
          { id: '2', bounds: { x: 0, y: 982, w: 1920, h: 1080 }, visibleBounds: { x: 0, y: 982, w: 1920, h: 1080 } },
        ],
        avatarPos: { x: 1467, y: 818 },
      },
      projectPoint: (point) => point,
      updatePrimaryAppearance() {},
      onAppearanceChange() {},
      actionDispatcher(action, payload = {}) {
        dispatchedActions.push({ action, payload })
        return Promise.resolve({ status: 'ok' })
      },
      panelId: 'sigil-avatar-controls-avatar-main',
      panelUrl: null,
      allowTestAnchorFallback: true,
    })

    controls.openAt({ x: 1467, y: 818 })
    assert.equal(controls.usesExternalPanel(), false)
    assert.equal(dispatchedActions.some((entry) => entry.action === 'panel.toggle'), false)

    const expectedBounds = { x: 1077, y: 442, w: 332, h: 540 }
    assert.deepEqual(controls.bounds(), expectedBounds)
    assert.deepEqual(controls.snapshot().bounds, expectedBounds)
    assert.deepEqual(controls.interactiveBounds(), expectedBounds)
    assert.equal(controls.snapshot().placementPlan.chosen_placement, 'left')
    assert.equal(controls.snapshot().placementPlan.anchor_display_id, '1')
    assert.deepEqual(controls.snapshot().placementPlan.anchor_frame, [1427, 778, 80, 80])
    assert.deepEqual(controls.snapshot().placementPlan.final_settled_frame, [1077, 442, 332, 540])
    assert.equal(expectedBounds.y + expectedBounds.h, 982)

    await waitUntil(
      () => childWithClass(avatarControlsAnchor(document), 'aos-panel'),
      'embedded controls must mount toolkit panel chrome'
    )
    const anchor = avatarControlsAnchor(document)
    const panel = childWithClass(anchor, 'aos-panel')
    setRect(anchor, {
      left: expectedBounds.x,
      top: expectedBounds.y,
      width: expectedBounds.w,
      height: expectedBounds.h,
    })
    setRect(panel, {
      left: expectedBounds.x,
      top: expectedBounds.y,
      width: expectedBounds.w,
      height: expectedBounds.h,
    })
    assert.deepEqual(controls.snapshot().bounds, controls.interactiveBounds())
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

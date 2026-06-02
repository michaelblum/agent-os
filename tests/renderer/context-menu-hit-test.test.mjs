import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createSigilContextMenu,
  contextMenuSurfaceScrollDelta,
  contextMenuContentProps,
  findContextMenuElementAt,
  menuMarkup,
  resolveContextMenuOrigin,
} from '../../apps/sigil/context-menu/menu.js'
import {
  applyContextMenuDescriptorUpdate,
  contextMenuControlDescriptors,
  getContextMenuControlDescriptor,
} from '../../apps/sigil/context-menu/descriptors.js'
import {
  contextMenuDescriptorForVisualObjectDescriptor,
} from '../../apps/sigil/context-menu/visual-object-binding.js'
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

test('context menu origin avoids the avatar hit bounds', () => {
  const origin = resolveContextMenuOrigin(
    { x: 500, y: 500 },
    {
      visible: { x: 0, y: 0, w: 1200, h: 900 },
      avatar: { point: { x: 500, y: 500 }, radius: 40 },
    },
  )
  const menu = { x: origin.x, y: origin.y, w: 292, h: 448 }
  const avatar = { x: 460, y: 460, w: 80, h: 80 }

  assert.equal(overlaps(menu, avatar), false)
  assert.equal(origin.x, 558)
})

test('context menu origin chooses another side when right side would overlap after clamping', () => {
  const origin = resolveContextMenuOrigin(
    { x: 1160, y: 500 },
    {
      visible: { x: 0, y: 0, w: 1200, h: 900 },
      avatar: { point: { x: 1160, y: 500 }, radius: 40 },
    },
  )
  const menu = { x: origin.x, y: origin.y, w: 292, h: 448 }
  const avatar = { x: 1120, y: 460, w: 80, h: 80 }

  assert.equal(overlaps(menu, avatar), false)
  assert.equal(origin.x, 810)
})

test('context menu hit test falls back to off-viewport geometry', () => {
  const slider = fakeElement('sigil-menu-line-duration-slider', { x: 600, y: 1450, w: 180, h: 24 }, '[data-aos-slider-root]')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, slider])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 620, y: 1460 }, doc), slider)
})

test('context menu hit test prefers viewport hit when available', () => {
  const button = fakeElement('button', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const fallback = fakeElement('fallback', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const anchor = fakeAnchor([fallback], button)
  const doc = {
    elementFromPoint() {
      return button
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 30, y: 30 }, doc), button)
})

test('context menu hit test includes checkbox labels in projected fallback', () => {
  const label = fakeElement('line-interdim-label', { x: 600, y: 1450, w: 180, h: 24 }, 'label')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, label])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1460 }, doc), label)
})

test('context menu hit test includes toolkit select options in projected fallback', () => {
  const content = fakeElement('shape-listbox', { x: 600, y: 1450, w: 180, h: 88 }, '[data-aos-select-content]')
  const option = fakeElement('octahedron-option', { x: 604, y: 1478, w: 172, h: 24 }, '[data-aos-select-item]')
  const surface = fakeElement('sigil-avatar-control-surface', { x: 560, y: 1380, w: 292, h: 448 }, '.sigil-avatar-control-surface')
  const anchor = fakeAnchor([surface, content, option])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1484 }, doc), option)
})

test('context menu hit test returns the topmost compact toolkit control', () => {
  const field = fakeElement('field', { x: 600, y: 1450, w: 180, h: 48 }, '.aos-form-field')
  const button = fakeElement('surface-shortcut', { x: 610, y: 1460, w: 120, h: 24 }, 'button')
  const anchor = fakeAnchor([field, button])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1464 }, doc), button)
})

test('context menu markup exposes standard accessibility structure', () => {
  const html = menuMarkup()

  assert.match(html, /id="sigil-context-menu"[^>]*role="dialog"[^>]*aria-label="Sigil avatar control surface"/)
  assert.doesNotMatch(html, /ctx-menu-card/)
  assert.doesNotMatch(html, /ctx-select-popover/)
  assert.doesNotMatch(html, /data-ctx-/)
})

test('context menu content props preserve visible open state', () => {
  assert.deepEqual(contextMenuContentProps(true), {
    'aria-label': 'Sigil avatar control surface',
    'aria-hidden': 'false',
    'data-state': 'open',
    class: 'ctx-anchor sigil-context-menu visible',
  })
})

test('context menu content props clear visible state when closed', () => {
  assert.deepEqual(contextMenuContentProps(false), {
    'aria-label': 'Sigil avatar control surface',
    'aria-hidden': 'true',
    'data-state': 'closed',
    class: 'ctx-anchor sigil-context-menu',
  })
})

test('context menu scroll deltas follow native input and preserve canvas-origin synthetic direction', () => {
  assert.deepEqual(contextMenuSurfaceScrollDelta({ dy: -8 }), {
    dy: 8,
    dx: 0,
    rawY: -8,
    rawX: 0,
    sourceOrigin: null,
  })
  assert.deepEqual(contextMenuSurfaceScrollDelta({
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

test('context menu descriptors expose compact avatar surface controls and Sigil-owned actions', () => {
  assert.equal(contextMenuControlDescriptors.length > 0, true)
  for (const id of [
    'sigil-menu-shape-select',
    'sigil-menu-omega-shape',
    'sigil-menu-opacity',
    'sigil-menu-fast-travel-effect',
    'sigil-menu-line-trail-mode',
    'sigil-menu-grid-mode',
  ]) {
    assert.ok(getContextMenuControlDescriptor(id), id)
  }
  for (const action of ['toggle-inspector', 'toggle-trace', 'toggle-render-performance', 'toggle-log', 'copy', 'save', 'import']) {
    const descriptor = getContextMenuControlDescriptor(action)
    assert.equal(descriptor?.type, 'action')
    assert.equal(descriptor?.route, 'sigil.action')
  }
})

test('context menu descriptors carry toolkit form metadata for compact avatar surface controls', () => {
  const opacity = getContextMenuControlDescriptor('sigil-menu-opacity')
  const fastTravel = getContextMenuControlDescriptor('sigil-menu-fast-travel-effect')
  const grid = getContextMenuControlDescriptor('sigil-menu-grid-mode')

  assert.equal(opacity.type, 'slider')
  assert.equal(opacity.min, 0)
  assert.equal(opacity.max, 1)
  assert.equal(opacity.step, 0.01)
  assert.ok(fastTravel.options.some((option) => option.value === 'line'))
  assert.deepEqual(grid.options.map((option) => option.value), ['off', 'flat', '3d'])
})

test('panel context menu treats child panel canvas input as inside the menu', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousEvent = globalThis.Event
  const document = createPatchedDocument()
  globalThis.document = document
  globalThis.window = { innerHeight: 900 }
  globalThis.Event = document.defaultView.Event

  try {
    const actions = []
    const closes = []
    const menu = createSigilContextMenu({
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

    menu.openAt({ x: 300, y: 300 })
    assert.equal(menu.isOpen(), true)
    assert.equal(actions[0]?.action, 'panel.toggle')
    assert.equal(actions[0]?.payload?.focus, true)

    assert.equal(menu.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      raw: { source_canvas_id: 'panel-test' },
    }), true)
    assert.equal(menu.isOpen(), true)
    assert.deepEqual(closes, [])

    assert.equal(menu.handlePointerEvent('left_mouse_down', { x: 10, y: 10 }, {
      raw: { source_canvas_id: 'other-panel' },
    }), false)
    assert.equal(menu.isOpen(), false)
    assert.deepEqual(closes, ['outside-click'])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live context menu compact surface routes canonical controls through visual object binding once', async () => {
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
    const menu = createSigilContextMenu({
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
          if (stage === 'context-menu:descriptor-update') calls.push(['legacy-route', data.id])
          if (stage === 'context-menu:visual-object-binding-update') calls.push(['binding-route', data.compatibilityId])
        },
      },
      allowTestAnchorFallback: true,
    })

    menu.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const field = Array.from(document.body.querySelectorAll('.aos-form-field'))
      .find((element) => element.dataset?.descriptorId === 'sigil-menu-opacity')
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

    assert.equal(menu.handlePointerEvent('left_mouse_down', { x: 62, y: 24 }), true)
    assert.equal(menu.handlePointerEvent('left_mouse_up', { x: 62, y: 24 }), true)
    await waitForMicrotasks()

    assert.equal(state.avatar.appearance.opacity, 0.42)
    assert.deepEqual(calls.filter(([kind]) => kind === 'binding-route'), [['binding-route', 'sigil-menu-opacity']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'legacy-route'), [])
    assert.deepEqual(calls.filter(([kind]) => kind === 'appearance'), [['appearance']])
    assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [[
      'persist',
      'sigil-menu-opacity',
      0.42,
      'aos.visual_object.descriptor.v0',
      'sigil.avatar.primary-polyhedron.avatar.appearance.opacity',
      'sigil-menu-opacity',
    ]])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live context menu snapshot includes compact surface tab control records', async () => {
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
    const menu = createSigilContextMenu({
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

    menu.openAt({ x: 0, y: 0 })
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

    const omegaRecord = menu.snapshot().controls.find((record) => (
      record.ref === 'sigil.avatar.compact_control_surface:omega'
    ))

    assert.equal(omegaRecord.role, 'tab')
    assert.equal(omegaRecord.id, 'omega')
    assert.equal(omegaRecord.value, 'omega')
    assert.equal(omegaRecord.name, 'Omega')
    assert.equal(omegaRecord.selected, false)
    assert.deepEqual(omegaRecord.frame, { x: 132, y: 20, width: 72, height: 24 })
    assert.ok(liveJs.contextMenu.controls.some((record) => (
      record.ref === 'sigil.avatar.compact_control_surface:alpha'
    )))
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.Event = previousEvent
  }
})

test('live context menu visual binding suppresses duplicate slider commits', async () => {
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
    const menu = createSigilContextMenu({
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
          if (stage === 'context-menu:visual-object-binding-update') calls.push(['binding-route', data.value])
        },
      },
      allowTestAnchorFallback: true,
    })

    menu.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const field = Array.from(document.body.querySelectorAll('.aos-form-field'))
      .find((element) => element.dataset?.descriptorId === 'sigil-menu-opacity')
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

    assert.equal(menu.handlePointerEvent('left_mouse_down', { x: 62, y: 24 }), true)
    assert.equal(menu.handlePointerEvent('left_mouse_up', { x: 62, y: 24 }), true)
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

test('live context menu keeps scrolled compact Box sliders routed to their descriptors', async () => {
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
    const menu = createSigilContextMenu({
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
          if (stage === 'context-menu:visual-object-binding-update') {
            calls.push(['binding-route', data.compatibilityId, data.value])
          }
        },
      },
      allowTestAnchorFallback: true,
    })

    menu.openAt({ x: 0, y: 0 })
    await waitForMicrotasks()
    await waitForMicrotasks()

    const surface = document.body.querySelector('.sigil-avatar-control-surface')
    assert.ok(surface)
    setRect(surface, { left: 18, top: 18, width: 292, height: 448 })
    surface.scrollTop = 0
    surface.scrollLeft = 0

    assert.equal(menu.handlePointerEvent('scroll_wheel', { x: 80, y: 80 }, {
      raw: { dy: 180, sourceOrigin: 'canvas' },
    }), true)
    assert.equal(surface.scrollTop, 180)

    const tesseronInput = fieldByDescriptor(document, 'sigil-menu-tesseron')?.querySelector('input')
    assert.ok(tesseronInput)
    tesseronInput.checked = false
    tesseronInput.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForMicrotasks()
    await waitForMicrotasks()

    assert.equal(state.avatar.shape.tesseron.enabled, false)

    const hiddenLaterTabConflict = 'sigil-menu-trail-length'
    const drags = [
      ['sigil-menu-box-width', 'width', 2.05, 0.1, 4, { left: 34, top: 142, width: 180, height: 24 }],
      ['sigil-menu-box-height', 'height', 1.66, 0.1, 4, { left: 34, top: 178, width: 180, height: 24 }],
      ['sigil-menu-box-depth', 'depth', 3.22, 0.1, 4, { left: 34, top: 214, width: 180, height: 24 }],
      ['sigil-menu-stellation', 'stellationFactor', 1.25, -1, 2, { left: 34, top: 250, width: 180, height: 24 }],
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

      assert.equal(menu.handlePointerEvent('left_mouse_down', downPoint), true)
      assert.equal(menu.handlePointerEvent('left_mouse_dragged', dragPoint), true)
      await waitForMicrotasks()
      await waitForMicrotasks()

      assert.equal(calls.filter(([kind]) => kind === 'binding-route').length, beforeRouteCount)
      if (key === 'stellationFactor') {
        assert.equal(rounded(state.avatar.shape.stellationFactor), rounded(beforeValue))
      } else {
        assert.equal(rounded(state.avatar.shape.params.box[key]), rounded(beforeValue))
      }

      assert.equal(menu.handlePointerEvent('left_mouse_up', upPoint), true)
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
      'sigil-menu-tesseron',
      'sigil-menu-box-width',
      'sigil-menu-box-height',
      'sigil-menu-box-depth',
      'sigil-menu-stellation',
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
    contextMenuDescriptorForVisualObjectDescriptor({
      id: 'compact-control:opacity',
      state_path: 'avatar.appearance.opacity',
      route: 'canvas_object.effects.patch',
    })?.id,
    'sigil-menu-opacity',
  )

  const menuSource = await readFile(new URL('../../apps/sigil/context-menu/menu.js', import.meta.url), 'utf8')
  const adapterSource = await readFile(new URL('../../apps/sigil/context-menu/visual-object-binding.js', import.meta.url), 'utf8')
  assert.equal(menuSource.includes('function applyVisualBindingCompatibility'), false)
  assert.equal(menuSource.includes("compatibility.id === 'sigil-menu-shape-select'"), false)
  assert.equal(adapterSource.includes('applyContextMenuDescriptorUpdate'), true)
})

test('descriptor routing applies a shape control through geometry sync', () => {
  const calls = []
  const state = { avatar: { shape: { type: 4, tesseron: { enabled: false } }, appearance: {}, effects: {} } }
  const result = applyContextMenuDescriptorUpdate('sigil-menu-shape-select', '8', {
    state,
    updateGeometry(value) { calls.push(['geometry', value]) },
    onAppearanceChange(event) { calls.push(['persist', event.controlId, event.value]) },
    setControlDisabled(id, value) { calls.push(['disabled', id, value]) },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(state.avatar.shape.type, 8)
  assert.equal(state.currentGeometryType, 8)
  assert.deepEqual(calls.filter(([kind]) => kind === 'geometry'), [['geometry', 8]])
  assert.deepEqual(calls.filter(([kind]) => kind === 'persist'), [['persist', 'sigil-menu-shape-select', 8]])
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-stellation', '1.25', {
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-tesseron-proportion', '0.68', {
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
    ['sigil-menu-opacity', '0.35', ['appearance', 'opacity'], 0.35],
    ['sigil-menu-edge-opacity', '0.2', ['appearance', 'edgeOpacity'], 0.2],
    ['sigil-menu-xray', true, ['appearance', 'interiorEdges'], true],
    ['sigil-menu-specular', false, ['appearance', 'specular'], false],
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
    const result = applyContextMenuDescriptorUpdate(id, rawValue, {
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-prism-sides', '12', {
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-omega-prism-sides', '12', {
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-tesseron-match', false, { state })

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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-pulsar', true, {
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
  const result = applyContextMenuDescriptorUpdate('sigil-menu-avatar-above-menu', true, {
    state,
    onAvatarWindowLevelChange(level) { calls.push(level) },
  })

  assert.equal(result.route, 'world-context.patch')
  assert.equal(state.avatarWindowLevel, 'screen_saver')
  assert.deepEqual(calls, ['screen_saver'])
})

test('descriptor routing identifies product actions as Sigil actions', () => {
  const result = applyContextMenuDescriptorUpdate('toggle-render-performance', 'toggle-render-performance', {})

  assert.equal(result.route, 'sigil.action')
  assert.equal(result.persisted, false)
  assert.equal(result.actionId, 'render-performance')
})

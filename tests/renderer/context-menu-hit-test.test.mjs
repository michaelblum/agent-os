import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
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
  assert.deepEqual(calls, [['alpha', 93], ['omega', 93]])
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

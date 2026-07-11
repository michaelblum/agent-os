import { test } from 'node:test'
import assert from 'node:assert/strict'
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' }
import {
  resolveRadialMenuConfig,
  validateRadialMenuDefinition,
} from '../../packages/toolkit/runtime/radial-menu-config.js'

const exampleMenu = {
  kind: 'aos.radial_menu_3d',
  schema_version: '2026-05-16',
  id: 'example.radial.main',
  label: 'Example Radial Menu',
  extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
  defaults: {
    three: {
      item: {
        hover: {
          transform: { scale: { from: 1, to: 2 } },
        },
      },
    },
  },
  items: [
    {
      id: 'inspect',
      label: 'Inspect',
      action: 'inspect',
      geometry: { type: 'glyph', glyph: 'inspect', radiusScale: 1 },
      three: { item: { hover: { transform: { rotate: { spin: { axis: 'z', rate: 1.25 } } } } } },
    },
    {
      id: 'open',
      label: 'Open',
      action: 'open',
      geometry: { type: 'glyph', glyph: 'open', radiusScale: 1.1 },
    },
  ],
}

test('radial menu resolver validates the default toolkit 3D menu contract', () => {
  const validation = validateRadialMenuDefinition(default3d)
  assert.equal(validation.ok, true)
})

test('radial menu resolver cascades toolkit defaults into consumer override data', () => {
  const resolved = resolveRadialMenuConfig(exampleMenu, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  })

  assert.equal(resolved.kind, 'aos.radial_menu_3d')
  assert.equal(resolved.id, 'example.radial.main')
  assert.equal(resolved.items.length, 2)
  assert.equal(resolved.logical_items.length, 2)
  assert.deepEqual(
    resolved.logical_items.map((item) => [item.id, item.label, item.action]),
    [
      ['inspect', 'Inspect', 'inspect'],
      ['open', 'Open', 'open'],
    ]
  )

  for (const item of resolved.items) {
    assert.deepEqual(item.three.item.hover.transform.scale, { from: 1, to: 2 })
    assert.equal(item.logical.role, 'menuitem')
    assert.equal(item.logical.close_on_select, true)
  }

  const inspect = resolved.items.find((item) => item.id === 'inspect')
  assert.deepEqual(inspect.three.item.hover.transform.rotate.spin, { axis: 'z', rate: 1.25 })
})

test('radial menu resolver merges item overrides by id without replacing defaults wholesale', () => {
  const resolved = resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'test.radial',
    extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
    items: [
      {
        id: 'inspect',
        label: 'Inspect',
        geometry: {
          radiusScale: 3,
        },
      },
    ],
  }, {
    base: exampleMenu,
  })
  const inspect = resolved.items.find((item) => item.id === 'inspect')
  assert.equal(inspect.action, 'inspect')
  assert.equal(inspect.geometry.type, 'glyph')
  assert.equal(inspect.geometry.radiusScale, 3)
})

test('radial menu resolver cascades model, part, and effect defaults into items', () => {
  const resolved = resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'test.radial.defaults',
    extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
    items: [
      {
        id: 'model-item',
        label: 'Model Item',
        geometry: {
          type: 'gltf',
          src: 'aos://example/model.glb',
          parts: [
            { id: 'defaulted-part' },
            { id: 'hidden-part', visible: false },
          ],
        },
        effects: [
          { ref: 'test.effect.defaulted' },
          { ref: 'test.effect.disabled', enabled: false },
        ],
      },
    ],
  }, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  })

  const item = resolved.items[0]
  assert.equal(item.geometry.radiusScale, 1)
  assert.equal(item.geometry.normalizedRadius, 0.28)
  assert.equal(item.geometry.parts[0].visible, true)
  assert.equal(item.geometry.parts[1].visible, false)
  assert.equal(item.effects[0].enabled, true)
  assert.equal(item.effects[1].enabled, false)
})

test('radial menu resolver preserves nested menu children in logical projection', () => {
  const resolved = resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'test.radial.children',
    items: [
      {
        id: 'parent',
        label: 'Parent',
        action: 'openParent',
        children: [
          {
            id: 'child',
            label: 'Child Action',
            action: 'runChild',
            shortcut: 'C',
          },
        ],
      },
    ],
  })

  assert.equal(resolved.items[0].children[0].logical.id, 'child')
  assert.deepEqual(resolved.logical_items[0].children, [
    {
      id: 'child',
      label: 'Child Action',
      action: 'runChild',
      disabled: false,
      hidden: false,
      checked: false,
      current: false,
      role: 'menuitem',
      shortcut: 'C',
      typeahead: 'Child Action',
      close_on_select: true,
      target_surface: null,
      action_payload: null,
      submenu_ref: null,
      children: [],
    },
  ])
})

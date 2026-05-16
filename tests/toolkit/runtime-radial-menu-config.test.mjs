import { test } from 'node:test'
import assert from 'node:assert/strict'
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' }
import sigilMenu from '../../apps/sigil/renderer/radial-menu/sigil-radial-menu.json' with { type: 'json' }
import {
  resolveRadialMenuConfig,
  validateRadialMenuDefinition,
} from '../../packages/toolkit/runtime/radial-menu-config.js'

test('radial menu resolver validates the default toolkit 3D menu contract', () => {
  const validation = validateRadialMenuDefinition(default3d)
  assert.equal(validation.ok, true)
})

test('radial menu resolver cascades toolkit defaults into Sigil override data', () => {
  const resolved = resolveRadialMenuConfig(sigilMenu, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  })

  assert.equal(resolved.kind, 'aos.radial_menu_3d')
  assert.equal(resolved.id, 'sigil.radial.main')
  assert.equal(resolved.items.length, 5)
  assert.equal(resolved.logical_items.length, 5)
  assert.deepEqual(
    resolved.logical_items.map((item) => [item.id, item.label, item.action]),
    [
      ['context-menu', 'Context Menu', 'contextMenu'],
      ['agent-terminal', 'Agent Terminal', 'agentTerminal'],
      ['annotation-mode', 'Annotate', 'annotationMode'],
      ['annotation-camera', 'Snapshot', 'annotationSnapshot'],
      ['wiki-graph', 'Wiki Graph', 'wikiGraph'],
    ]
  )

  for (const item of resolved.items) {
    assert.deepEqual(item.three.item.hover.transform.scale, { from: 1, to: 2 })
    assert.equal(item.logical.role, 'menuitem')
    assert.equal(item.logical.close_on_select, true)
  }

  const context = resolved.items.find((item) => item.id === 'context-menu')
  const reticle = resolved.items.find((item) => item.id === 'annotation-mode')
  const wiki = resolved.items.find((item) => item.id === 'wiki-graph')

  assert.deepEqual(context.three.item.hover.transform.rotate.spin, { axis: 'z', rate: 1.45 })
  assert.deepEqual(reticle.three.item.hover.transform.rotate.spin, { axis: 'z', rate: 0.35 })
  assert.equal(wiki.geometry.module_ref, 'sigil.radial.geometry.wiki-brain')
  assert.equal(wiki.effects[0].ref, 'sigil.radial.effect.nested-neural-tree')
  assert.equal(wiki.activationTransition.preset, 'wiki-brain-zoom-dissolve')
})

test('radial menu resolver merges item overrides by id without replacing defaults wholesale', () => {
  const resolved = resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'test.radial',
    extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
    items: [
      {
        id: 'context-menu',
        label: 'Context Menu',
        geometry: {
          radiusScale: 3,
        },
      },
    ],
  }, {
    base: sigilMenu,
  })
  const context = resolved.items.find((item) => item.id === 'context-menu')
  assert.equal(context.action, 'contextMenu')
  assert.equal(context.geometry.type, 'gltf')
  assert.equal(context.geometry.radiusScale, 3)
})

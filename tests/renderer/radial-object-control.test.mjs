import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../../apps/sigil/renderer/live-modules/radial-gesture-menu.js'
import {
  WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  WIKI_BRAIN_SHELL_OBJECT_ID,
  WIKI_BRAIN_TREE_OBJECT_ID,
  applyWikiBrainTransformPatch,
  buildWikiBrainObjectRegistry,
  findWikiBrainRadialItem,
  resolveWikiBrainEffect,
} from '../../apps/sigil/renderer/live-modules/radial-object-control.js'

function radialConfig() {
  return {
    items: structuredClone(DEFAULT_SIGIL_RADIAL_ITEMS),
  }
}

test('wiki brain object registry advertises shell, fiber, and fractal tree controls', () => {
  const registry = buildWikiBrainObjectRegistry(radialConfig(), { canvasId: 'avatar-main' })

  assert.equal(registry.type, 'canvas_object.registry')
  assert.equal(registry.schema_version, '2026-05-03')
  assert.equal(registry.canvas_id, 'avatar-main')
  assert.deepEqual(registry.objects.map((object) => object.object_id), [
    WIKI_BRAIN_SHELL_OBJECT_ID,
    WIKI_BRAIN_TREE_OBJECT_ID,
    WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  ])

  const tree = registry.objects.find((object) => object.object_id === WIKI_BRAIN_TREE_OBJECT_ID)
  assert.equal(tree.name, 'Wiki Brain Fiber Optics')
  assert.equal(tree.kind, 'three.object3d')
  assert.deepEqual(tree.capabilities, ['transform.read', 'transform.patch', 'visibility.read', 'visibility.patch'])
  assert.deepEqual(tree.units, {
    position: 'scene',
    scale: 'multiplier',
    rotation: 'degrees',
  })
  assert.deepEqual(tree.transform.scale, { x: 1.32, y: 1.42, z: 1.2 })
  assert.deepEqual(tree.transform.rotation_degrees, { x: -11.5, y: 0, z: 0 })
  assert.equal(tree.visible, true)

  const fractalTree = registry.objects.find((object) => object.object_id === WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID)
  assert.equal(fractalTree.name, 'Wiki Brain Fractal Tree')
  assert.deepEqual(fractalTree.transform.position, { x: 0.008, y: -0.018, z: 0.012 })
  assert.deepEqual(fractalTree.transform.scale, { x: 1.26, y: 1.34, z: 1.16 })
  assert.deepEqual(fractalTree.transform.rotation_degrees, { x: -9, y: 0, z: 0 })
})

test('wiki brain visibility patch updates advertised object visibility', () => {
  const config = radialConfig()
  const result = applyWikiBrainTransformPatch(config, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-visible',
    target: {
      canvas_id: 'avatar-main',
      object_id: WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
    },
    patch: {
      visible: false,
    },
  }, { canvasId: 'avatar-main' })

  assert.equal(result.status, 'applied')
  assert.equal(result.visible, false)
  assert.deepEqual(result.transform.scale, { x: 1.26, y: 1.34, z: 1.16 })

  const fractalTree = buildWikiBrainObjectRegistry(config, { canvasId: 'avatar-main' })
    .objects.find((object) => object.object_id === WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID)
  assert.equal(fractalTree.visible, false)
})

test('wiki brain shell transform defaults to identity around the model host', () => {
  const item = findWikiBrainRadialItem(radialConfig())
  const effect = resolveWikiBrainEffect(item)

  assert.deepEqual(effect.shellTransform, {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
  })
})

test('wiki brain transform patch updates tree config and returns applied result', () => {
  const config = radialConfig()
  const result = applyWikiBrainTransformPatch(config, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-tree',
    target: {
      canvas_id: 'avatar-main',
      object_id: WIKI_BRAIN_TREE_OBJECT_ID,
    },
    patch: {
      scale: { x: 1.45, y: 1.55, z: 1.3 },
      rotation_degrees: { x: -9 },
    },
  }, { canvasId: 'avatar-main' })

  assert.equal(result.status, 'applied')
  assert.equal(result.request_id, 'req-tree')
  assert.deepEqual(result.transform.scale, { x: 1.45, y: 1.55, z: 1.3 })
  assert.deepEqual(result.transform.rotation_degrees, { x: -9, y: 0, z: 0 })

  const registry = buildWikiBrainObjectRegistry(config, { canvasId: 'avatar-main' })
  const tree = registry.objects.find((object) => object.object_id === WIKI_BRAIN_TREE_OBJECT_ID)
  assert.deepEqual(tree.transform.scale, { x: 1.45, y: 1.55, z: 1.3 })
  assert.deepEqual(tree.transform.rotation_degrees, { x: -9, y: 0, z: 0 })
})

test('wiki brain transform patch can independently tune the fractal tree', () => {
  const config = radialConfig()
  const result = applyWikiBrainTransformPatch(config, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-fractal-tree',
    target: {
      canvas_id: 'avatar-main',
      object_id: WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
    },
    patch: {
      position: { y: -0.024 },
      scale: { x: 1.4, y: 1.5, z: 1.25 },
    },
  }, { canvasId: 'avatar-main' })

  assert.equal(result.status, 'applied')
  assert.equal(result.request_id, 'req-fractal-tree')
  assert.deepEqual(result.transform.position, { x: 0.008, y: -0.024, z: 0.012 })
  assert.deepEqual(result.transform.scale, { x: 1.4, y: 1.5, z: 1.25 })

  const registry = buildWikiBrainObjectRegistry(config, { canvasId: 'avatar-main' })
  const fractalTree = registry.objects.find((object) => object.object_id === WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID)
  assert.deepEqual(fractalTree.transform.position, { x: 0.008, y: -0.024, z: 0.012 })
  assert.deepEqual(fractalTree.transform.scale, { x: 1.4, y: 1.5, z: 1.25 })
})

test('wiki brain transform patch can independently move the shell host', () => {
  const config = radialConfig()
  const result = applyWikiBrainTransformPatch(config, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-shell',
    target: {
      canvas_id: 'avatar-main',
      object_id: WIKI_BRAIN_SHELL_OBJECT_ID,
    },
    patch: {
      position: { x: 0.02, y: -0.01, z: 0.04 },
    },
  }, { canvasId: 'avatar-main' })

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.transform.position, { x: 0.02, y: -0.01, z: 0.04 })

  const shell = buildWikiBrainObjectRegistry(config, { canvasId: 'avatar-main' })
    .objects.find((object) => object.object_id === WIKI_BRAIN_SHELL_OBJECT_ID)
  assert.deepEqual(shell.transform.position, { x: 0.02, y: -0.01, z: 0.04 })
  assert.deepEqual(shell.transform.scale, { x: 1, y: 1, z: 1 })
})

test('wiki brain transform patch rejects unknown objects with a contract result', () => {
  const result = applyWikiBrainTransformPatch(radialConfig(), {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-unknown',
    target: {
      canvas_id: 'avatar-main',
      object_id: 'radial.wiki-brain.unknown',
    },
    patch: {
      scale: { x: 2 },
    },
  }, { canvasId: 'avatar-main' })

  assert.equal(result.status, 'rejected')
  assert.equal(result.reason, 'unknown_object')
  assert.equal(result.request_id, 'req-unknown')
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as THREE from '../../packages/toolkit/vendor/three/three.module.min.js'

import { createDesktopWorldSceneProjection } from '../../packages/toolkit/components/desktop-world-stage/scene-extension-projection.js'
import {
  SCENE_EXTENSION_CONTRACT_ID,
  SCENE_EXTENSION_SCENE_ABI,
  SCENE_EXTENSION_SCHEMA_VERSION,
  SCENE_EXTENSION_THREE_REVISION,
  createSceneAnimationController,
  createSceneSignalController,
  createTrustedSceneExtensionRegistry,
} from '../../packages/toolkit/scene/index.js'

const ownerId = 'io.ch-osctrl.sigil'
const digest = 'a'.repeat(64)
const implementation = `${ownerId}.companion.runtime`

function scene(componentImplementation = implementation) {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id: 'companion/main',
    revision: 1,
    rootObjectId: 'companion/main',
    objects: [{
      id: 'companion/main',
      parentId: null,
      kind: 'group',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      geometryId: null,
      materialId: null,
      components: componentImplementation ? [{
        id: 'runtime',
        implementation: componentImplementation,
        parameters: {},
        enabled: true,
      }] : [],
    }],
    resources: [],
    metadata: {},
  }
}

function manifest(overrides = {}) {
  return {
    contract: SCENE_EXTENSION_CONTRACT_ID,
    schemaVersion: SCENE_EXTENSION_SCHEMA_VERSION,
    id: 'companion-renderer',
    ownerId,
    digest,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    implementationIds: [implementation],
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
    budgets: {
      maxDrawCalls: 32,
      maxObjects: 64,
      maxResources: 64,
      maxTextureBytes: 8 * 1024 * 1024,
      maxTriangles: 100_000,
      maxWorkingBytes: 16 * 1024 * 1024,
    },
    ...overrides,
  }
}

function reference(overrides = {}) {
  const value = manifest(overrides)
  return {
    ownerId: value.ownerId,
    id: value.id,
    digest: value.digest,
    sceneAbi: value.sceneAbi,
    threeRevision: value.threeRevision,
  }
}

function projectionObject() {
  const child = {
    name: 'companion/main',
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z },
    },
  }
  return {
    name: 'extension-root',
    isObject3D: true,
    getObjectByName(id) { return id === child.name ? child : null },
    traverse(visitor) { visitor(this); visitor(child) },
    child,
  }
}

function factory(overrides = {}) {
  const object = projectionObject()
  return {
    manifest: manifest(overrides),
    createProjection() {
      return {
        object,
        applySignal() {},
        applyAnimation() {},
        tick() {},
        suspend() {},
        resume() {},
        contextLost() {},
        contextRestored() {},
        dispose() {},
      }
    },
  }
}

test('DesktopWorld selects an exact owner-matched extension projection', () => {
  const extension = factory()
  const registry = createTrustedSceneExtensionRegistry({ factories: [extension] })
  const result = createDesktopWorldSceneProjection({
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    document: scene(),
    expectedOwner: ownerId,
    extensionReference: reference(),
    extensionRegistry: registry,
  })

  assert.equal(result.extension.digest, digest)
  assert.deepEqual(result.projection.objectPosition('companion/main'), [0, 0, 0])
  assert.equal(result.projection.setObjectPosition('companion/main', [90, 40, 2]), true)
  assert.deepEqual(result.projection.objectPosition('companion/main'), [90, 40, 2])
})

test('neutral extension restores visibility after context loss without waking a suspended projection', async () => {
  const body = await readFile(new URL(
    '../../packages/toolkit/scene/extension-examples/basic-three/projection.js',
    import.meta.url,
  ), 'utf8')
  const createProjection = Function('context', body)
  const projection = createProjection({
    THREE,
    document: { id: 'example/main' },
  })

  projection.contextLost()
  assert.equal(projection.object.visible, false)
  projection.contextRestored()
  assert.equal(projection.object.visible, true)
  projection.suspend()
  projection.contextLost()
  projection.contextRestored()
  assert.equal(projection.object.visible, false)
  projection.resume()
  assert.equal(projection.object.visible, true)
  projection.dispose()
})

test('DesktopWorld lowers extension allocation budgets to remaining segment headroom', () => {
  let received = null
  const extension = factory()
  extension.createProjection = (context) => {
    received = context.budgets
    return {
      object: projectionObject(),
      applySignal() {},
      applyAnimation() {},
      tick() {},
      suspend() {},
      resume() {},
      contextLost() {},
      contextRestored() {},
      dispose() {},
    }
  }
  const registry = createTrustedSceneExtensionRegistry({ factories: [extension] })
  const budgets = {
    maxDrawCalls: 2,
    maxObjects: 3,
    maxResources: 4,
    maxTextureBytes: 1024,
    maxTriangles: 500,
    maxWorkingBytes: 2048,
  }

  createDesktopWorldSceneProjection({
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    budgets,
    document: scene(),
    expectedOwner: ownerId,
    extensionReference: reference(),
    extensionRegistry: registry,
  })

  assert.deepEqual(received, budgets)
})

test('DesktopWorld rejects wrong owners, missing digests, and undeclared implementations', () => {
  const registry = createTrustedSceneExtensionRegistry({ factories: [factory()] })
  const input = {
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    document: scene(),
    expectedOwner: ownerId,
    extensionReference: reference(),
    extensionRegistry: registry,
  }
  assert.throws(() => createDesktopWorldSceneProjection({
    ...input,
    extensionReference: reference({ ownerId: 'io.example.other', implementationIds: ['io.example.other.runtime'] }),
  }), /owner does not match/)
  assert.throws(() => createDesktopWorldSceneProjection({
    ...input,
    extensionReference: reference({ digest: 'b'.repeat(64) }),
  }), /not loaded/)
  assert.throws(() => createDesktopWorldSceneProjection({
    ...input,
    document: scene(`${ownerId}.undeclared.runtime`),
  }), /unavailable/)
})

test('DesktopWorld does not require an extension for generic-only documents', () => {
  assert.doesNotThrow(() => createDesktopWorldSceneProjection({
    THREE,
    document: scene(null),
    expectedOwner: ownerId,
  }))
})

test('DesktopWorld rejects an extension reference unused by the scene', () => {
  const registry = createTrustedSceneExtensionRegistry({ factories: [factory()] })
  assert.throws(() => createDesktopWorldSceneProjection({
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    document: scene(null),
    expectedOwner: ownerId,
    extensionReference: reference(),
    extensionRegistry: registry,
  }), /does not implement any required/)
})

test('generic numeric bindings drive consumer-owned runtime scalar targets', () => {
  const applied = []
  const document = scene()
  document.objects[0].components.push(
    {
      id: 'stellation/pointer',
      implementation: 'aos.scene.signal.bind',
      parameters: {
        clamp: true,
        inputMax: 500,
        inputMin: 0,
        outputMax: 1.75,
        outputMin: 0,
        signalId: 'pointer.distance',
        smoothingMs: 0,
        target: 'geometry.stellation',
      },
      enabled: true,
    },
    {
      id: 'core/breathe',
      implementation: 'aos.scene.animation.bind',
      parameters: {
        delayMs: 0,
        durationMs: 1_000,
        easing: 'linear',
        from: 0,
        playback: 'loop',
        target: 'core.pulse',
        to: 1,
      },
      enabled: true,
    },
  )
  const extension = factory()
  extension.createProjection = () => ({
    object: projectionObject(),
    applySignal(binding, value) { applied.push(['signal', binding.target, value]) },
    applyAnimation(binding, value) { applied.push(['animation', binding.target, value]) },
    tick() {},
    suspend() {},
    resume() {},
    contextLost() {},
    contextRestored() {},
    dispose() {},
  })
  const registry = createTrustedSceneExtensionRegistry({ factories: [extension] })
  const result = createDesktopWorldSceneProjection({
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    document,
    expectedOwner: ownerId,
    extensionReference: reference(),
    extensionRegistry: registry,
  })
  const signals = createSceneSignalController(document, {
    apply: (binding, value, input, at) => result.projection.applySignal(binding, value, input, at),
  })
  const animations = createSceneAnimationController(document, {
    apply: (binding, value, elapsed, progress) => result.projection.applyAnimation(binding, value, elapsed, progress),
  })

  assert.equal(signals.publish('pointer.distance', 250, 10), 1)
  animations.restart()
  animations.tick(500)
  assert.deepEqual(applied, [
    ['signal', 'geometry.stellation', 0.875],
    ['animation', 'core.pulse', 0.5],
  ])
})

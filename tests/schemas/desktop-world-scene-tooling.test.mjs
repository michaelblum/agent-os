import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const schemas = path.resolve(import.meta.dirname, '../../shared/schemas')

function validate(schemaName, instance) {
  return spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
root = Path(sys.argv[1])
schema = json.loads((root / sys.argv[2]).read_text())
registry = Registry()
for candidate in root.glob("*.json"):
    document = json.loads(candidate.read_text())
    if document.get("$id"):
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))
instance = json.load(sys.stdin)
errors = list(Draft202012Validator(schema, registry=registry).iter_errors(instance))
if errors:
    print(errors[0].message)
    sys.exit(1)
`, schemas, schemaName], { input: JSON.stringify(instance), encoding: 'utf8' })
}

function stage() {
  return {
    contract: 'aos.desktop-world.devtools.stage.v1', sequence: 1, status: 'available',
    world: {
      displays: [{ id: 'main', index: 0, bounds: [200, 0, 1440, 900], nativeBounds: [0, 0, 1440, 900] }],
      nodes: [{ id: 'body', resourceId: 'companion/main', parentId: null, kind: 'mesh', implementation: 'aos.scene.geometry.primitive', position: [100, 200, 0], visible: true }],
      hitRegions: [], affordances: [], gestures: [], routes: [],
    },
    resources: [{
      id: 'companion/main', owner: 'example', sceneId: 'main', revision: 1, suspended: false,
      objectCount: 1, descriptorCount: 1, animationCount: 0, signalCount: 0, interactionCount: 0,
      implementations: ['aos.scene.geometry.primitive'], allocations: { geometries: 1, materials: 1, textures: 0, programs: 1 },
      lifecycle: 'active', errorCode: null,
    }],
    interactions: [],
    performance: {
      enabled: true, recording: false, sampleCount: 1, currentFps: 60, p95FrameMs: 16,
      avgFrameMs: 16, avgRenderMs: 4, avgUpdateMs: 2, avgGpuMs: null, drawCalls: 1,
      triangles: 12, geometries: 1, textures: 0, programs: 1, backingPixels: 1296000, state: 'stable',
    },
    counters: { displays: 1, resources: 1, nodes: 1, hitRegions: 0, affordances: 0, activeGestures: 0, activeRoutes: 0, errors: 0 },
    events: [], lastError: null,
  }
}

test('DesktopWorld tooling schemas accept canonical content-free facts', () => {
  assert.equal(validate('desktop-world-devtools-stage-v1.schema.json', stage()).status, 0)
  assert.equal(validate('scene-replay-v1.schema.json', {
    status: 'ok', contract: 'aos.scene.replay.v1', eventCount: 3, resourceCount: 1,
    resources: ['companion/main'], completedGestures: 1, canceledGestures: 0,
    finalPositions: { 'companion/main': [100, 200, 0] },
  }).status, 0)
})

test('DesktopWorld tooling schemas reject product content and unknown fields', () => {
  assert.notEqual(validate('desktop-world-devtools-stage-v1.schema.json', { ...stage(), transcript: 'secret' }).status, 0)
  const malformedNativeBounds = stage()
  malformedNativeBounds.world.displays[0].nativeBounds = [0, 0, -1, 900]
  assert.notEqual(validate('desktop-world-devtools-stage-v1.schema.json', malformedNativeBounds).status, 0)
  assert.notEqual(validate('scene-replay-v1.schema.json', {
    status: 'ok', contract: 'aos.scene.replay.v1', eventCount: 0, resourceCount: 0,
    resources: [], completedGestures: 0, canceledGestures: 0, finalPositions: {}, prompt: 'secret',
  }).status, 0)
})

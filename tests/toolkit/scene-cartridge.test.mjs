import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  SCENE_CARTRIDGE_IMPLEMENTATIONS,
  resolveSceneCartridge,
  validateSceneCartridge,
  validateSceneCartridgeManifest,
} from '../../packages/toolkit/scene/index.js'

const examplesRoot = path.resolve(import.meta.dirname, '../../packages/toolkit/scene/examples')

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function example(name) {
  const root = path.join(examplesRoot, name)
  return {
    animations: await readJson(path.join(root, 'animations.json')),
    assets: [],
    interactions: await readJson(path.join(root, 'interactions.json')),
    manifest: await readJson(path.join(root, 'cartridge.json')),
    scene: await readJson(path.join(root, 'scene.json')),
  }
}

test('neutral scene cartridges validate and resolve into canonical scene documents', async () => {
  for (const name of ['aim-and-commit', 'conventional-drag', 'radial-menu', 'spinning-object']) {
    const cartridge = await example(name)
    assert.deepEqual(validateSceneCartridge(cartridge), { ok: true, errors: [] }, name)
    const resolved = resolveSceneCartridge(cartridge)
    assert.equal(resolved.document.id, cartridge.manifest.id)
    assert.deepEqual(
      resolved.requiredImplementations,
      cartridge.manifest.implementations.map(({ id }) => id).sort(),
    )
  }
})

test('cartridge manifests require canonical digest-bound files and bounded budgets', async () => {
  const cartridge = await example('spinning-object')
  const invalid = structuredClone(cartridge.manifest)
  invalid.files.scene.path = '../scene.json'
  invalid.files.animations.sha256 = 'not-a-digest'
  invalid.budgets.maxObjects = 1025
  invalid.assets = [{
    path: 'assets/remote.js',
    sha256: 'a'.repeat(64),
    bytes: 12,
    mediaType: 'text/javascript',
  }]
  const result = validateSceneCartridgeManifest(invalid)
  assert.equal(result.ok, false)
  for (const code of ['noncanonical_file_path', 'invalid_file_digest', 'invalid_budget', 'invalid_asset_media_type']) {
    assert.ok(result.errors.some((error) => error.code === code), code)
  }
})

test('cartridges reject executable fields, remote values, unknown implementations, and declaration drift', async () => {
  const cartridge = await example('aim-and-commit')
  cartridge.scene.metadata.script = 'alert(1)'
  cartridge.interactions.interactions[0].response.parameters.endpoint = 'https://example.test/run'
  cartridge.interactions.interactions[0].recognizer.implementation = 'consumer.custom.drag'
  const result = validateSceneCartridge(cartridge)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.code === 'executable_field'))
  assert.ok(result.errors.some((error) => error.code === 'remote_runtime_value'))
  assert.ok(result.errors.some((error) => error.code === 'unknown_implementation'))

  const declarationDrift = await example('conventional-drag')
  declarationDrift.manifest.implementations.pop()
  assert.ok(validateSceneCartridge(declarationDrift).errors.some((error) => error.code === 'implementation_declarations'))

  const budgetDrift = await example('spinning-object')
  budgetDrift.manifest.budgets.maxResources = 1
  assert.ok(validateSceneCartridge(budgetDrift).errors.some((error) => error.code === 'resource_budget'))
})

test('cartridge scene safety preserves the existing 1024-object structural allowance', async () => {
  const cartridge = await example('conventional-drag')
  cartridge.scene.objects = [cartridge.scene.objects[0], ...Array.from({ length: 1023 }, (_, index) => ({
    id: `node/${index}`,
    parentId: 'root',
    kind: 'group',
    transform: { position: [index, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    geometryId: null,
    materialId: null,
    components: [],
  }))]
  cartridge.manifest.budgets.maxObjects = 1024
  cartridge.interactions.interactions[0].affordanceId = 'node/0'
  const result = validateSceneCartridge(cartridge)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
})

test('cartridge interaction roles remain distinct from conventional object translation', async () => {
  const aim = await example('aim-and-commit')
  const conventional = await example('conventional-drag')
  assert.equal(aim.interactions.interactions[0].recognizer.implementation, SCENE_CARTRIDGE_IMPLEMENTATIONS.dragRecognizer)
  assert.equal(conventional.interactions.interactions[0].recognizer.implementation, SCENE_CARTRIDGE_IMPLEMENTATIONS.dragRecognizer)
  assert.equal(aim.interactions.interactions[0].response.implementation, SCENE_CARTRIDGE_IMPLEMENTATIONS.aimCommitResponse)
  assert.equal(conventional.interactions.interactions[0].response.implementation, SCENE_CARTRIDGE_IMPLEMENTATIONS.translateResponse)
})

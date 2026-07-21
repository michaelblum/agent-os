import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { serializeSceneExtensionDigestMaterial } from '../packages/toolkit/scene/scene-extension.js'
import { serializeSceneExtensionWrapperModule } from '../scripts/lib/scene-extension/module-inspector.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const storeSource = path.join(repoRoot, 'src/display/scene-extension-store.swift')
const handlerSource = path.join(repoRoot, 'src/display/scene-extension-scheme-handler.swift')
const taskStateSource = path.join(repoRoot, 'src/display/scene-extension-scheme-task-state.swift')
const unifiedSource = path.join(repoRoot, 'src/daemon/unified.swift')
const budgets = {
  maxDrawCalls: 64,
  maxObjects: 128,
  maxResources: 128,
  maxTextureBytes: 8 * 1024 * 1024,
  maxTriangles: 100_000,
  maxWorkingBytes: 16 * 1024 * 1024,
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function manifestFor(bodyBytes, overrides = {}) {
  const manifest = {
    contract: 'aos.scene.extension.v1',
    schemaVersion: 1,
    id: 'companion-renderer',
    ownerId: 'io.ch-osctrl.sigil',
    digest: '0'.repeat(64),
    sceneAbi: 'aos.scene.projection.v1',
    implementationIds: ['io.ch-osctrl.sigil.companion.runtime'],
    threeRevision: '183',
    budgets: { ...budgets },
    ...overrides,
  }
  manifest.digest = sha256(serializeSceneExtensionDigestMaterial(manifest, sha256(bodyBytes)))
  return manifest
}

async function writeInstalledFixture(root, bodyBytes = Buffer.from('return null\n')) {
  const stateDirectory = path.join(root, 'repo')
  const manifest = manifestFor(bodyBytes)
  const artifactRoot = path.join(
    stateDirectory,
    'scene-extensions',
    manifest.ownerId,
    manifest.id,
    manifest.digest,
  )
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
  for (let current = path.join(stateDirectory, 'scene-extensions'); current !== stateDirectory; current = path.dirname(current)) {
    await chmod(current, 0o700)
  }
  await writeFile(path.join(artifactRoot, 'extension.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
  await writeFile(path.join(artifactRoot, 'projection.js'), bodyBytes, { mode: 0o600 })
  const authorization = {
    contract: 'aos.scene.extension.authorization.v1',
    ownerId: manifest.ownerId,
    id: manifest.id,
    digest: manifest.digest,
    sceneAbi: manifest.sceneAbi,
    threeRevision: manifest.threeRevision,
  }
  await writeFile(path.join(artifactRoot, 'authorization.json'), `${JSON.stringify(authorization)}\n`, { mode: 0o600 })
  return { artifactRoot, authorization, bodyBytes, manifest, stateDirectory }
}

async function compileHarness(root) {
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'store-proof')
  await writeFile(main, `
import Foundation

func aosStateDir() -> String { fatalError("explicit state directory required") }

do {
    let data = Data(CommandLine.arguments[2].utf8)
    let dictionary = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let reference = try AOSSceneExtensionReference(dictionary: dictionary)
    let store = AOSSceneExtensionStore(stateDirectory: CommandLine.arguments[1])
    if CommandLine.arguments.count > 4 && CommandLine.arguments[4] == "admit-only" {
        let admitted = try store.admitSceneOperation(
            ["op": "mount", "extension": dictionary],
            expectedOwnerID: CommandLine.arguments[3]
        )
        let output = try JSONSerialization.data(withJSONObject: admitted, options: [.sortedKeys])
        print(String(data: output, encoding: .utf8)!)
        exit(0)
    }
    if CommandLine.arguments.count > 4 && CommandLine.arguments[4] == "transact" {
        _ = try store.admitSceneOperation(
            ["op": "transact", "extension": dictionary],
            expectedOwnerID: CommandLine.arguments[3]
        )
        exit(0)
    }
    let artifact = try store.load(reference)
    let admitted = try store.admitSceneOperation(
        ["op": "mount", "extension": dictionary],
        expectedOwnerID: CommandLine.arguments[3]
    )
    let wrapper = try artifact.wrapperModule()
    let result: [String: Any] = [
        "digest": artifact.reference.digest,
        "bodyBytes": artifact.body.count,
        "admittedExtension": admitted["extension"] as Any,
        "wrapper": String(data: wrapper, encoding: .utf8) ?? "",
    ]
    let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(data: output, encoding: .utf8)!)
} catch let failure as AOSSceneExtensionStoreFailure {
    fputs(failure.code + "\\n", stderr)
    exit(1)
} catch {
    fputs("SCENE_EXTENSION_STORE_INVALID\\n", stderr)
    exit(1)
}
`)
  const moduleCache = path.join(root, 'module-cache')
  await mkdir(moduleCache, { mode: 0o700 })
  execFileSync('swiftc', [storeSource, main, '-o', executable], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCache,
      SWIFT_MODULECACHE_PATH: moduleCache,
    },
    stdio: 'pipe',
  })
  return executable
}

test('native extension store revalidates artifact identity and generates a local immutable wrapper', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-store-'))
  try {
    const fixture = await writeInstalledFixture(root)
    const executable = await compileHarness(root)
    const result = spawnSync(executable, [fixture.stateDirectory, JSON.stringify({
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    }), fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.digest, fixture.manifest.digest)
    assert.equal(output.bodyBytes, fixture.bodyBytes.length)
    assert.deepEqual(output.admittedExtension, {
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    })
    assert.equal(
      output.wrapper,
      serializeSceneExtensionWrapperModule(
        fixture.manifest,
        fixture.bodyBytes.toString('utf8'),
      ).toString('utf8'),
    )
    assert.match(output.wrapper, /const createProjection = Function\("context",/u)
    assert.match(output.wrapper, /export default Object\.freeze/u)
    assert.doesNotMatch(output.wrapper, /\bimport\s/u)
    assert.doesNotMatch(output.wrapper, new RegExp(root.replaceAll('/', '\\/'), 'u'))

    await writeFile(path.join(fixture.artifactRoot, 'projection.js'), `${fixture.bodyBytes}\n`, { mode: 0o600 })
    const corrupt = spawnSync(executable, [fixture.stateDirectory, JSON.stringify({
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    }), fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(corrupt.status, 1)
    assert.match(corrupt.stderr, /SCENE_EXTENSION_DIGEST_MISMATCH/u)
    assert.doesNotMatch(corrupt.stderr, new RegExp(root.replaceAll('/', '\\/'), 'u'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native admission rejects an owner mismatch before reading stored bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-owner-'))
  try {
    const fixture = await writeInstalledFixture(root)
    const executable = await compileHarness(root)
    await rm(path.join(fixture.artifactRoot, 'authorization.json'))
    const result = spawnSync(executable, [fixture.stateDirectory, JSON.stringify({
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    }), 'io.ch-osctrl.other', 'admit-only'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^SCENE_EXTENSION_OWNER_MISMATCH\n$/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native admission permits extension references only on mount operations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-mount-only-'))
  try {
    const fixture = await writeInstalledFixture(root)
    const executable = await compileHarness(root)
    const result = spawnSync(executable, [fixture.stateDirectory, JSON.stringify({
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    }), fixture.manifest.ownerId, 'transact'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^SCENE_EXTENSION_REFERENCE_INVALID\n$/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native store requires an exact owner-only authorization marker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-authorization-'))
  try {
    const fixture = await writeInstalledFixture(root)
    const executable = await compileHarness(root)
    const reference = JSON.stringify({
      ownerId: fixture.manifest.ownerId,
      id: fixture.manifest.id,
      digest: fixture.manifest.digest,
      sceneAbi: fixture.manifest.sceneAbi,
      threeRevision: fixture.manifest.threeRevision,
    })

    await rm(path.join(fixture.artifactRoot, 'authorization.json'))
    const missing = spawnSync(executable, [fixture.stateDirectory, reference, fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /^SCENE_EXTENSION_NOT_AUTHORIZED\n$/u)
    assert.doesNotMatch(missing.stderr, new RegExp(root.replaceAll('/', '\\/'), 'u'))

    await writeFile(path.join(fixture.artifactRoot, 'authorization.json'), `${JSON.stringify({
      ...fixture.authorization,
      ownerId: 'io.ch-osctrl.other',
    })}\n`, { mode: 0o600 })
    const mismatched = spawnSync(executable, [fixture.stateDirectory, reference, fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(mismatched.status, 1)
    assert.match(mismatched.stderr, /^SCENE_EXTENSION_NOT_AUTHORIZED\n$/u)
    assert.doesNotMatch(mismatched.stderr, new RegExp(root.replaceAll('/', '\\/'), 'u'))

    await writeFile(path.join(fixture.artifactRoot, 'authorization.json'), `${JSON.stringify({
      ...fixture.authorization,
      unexpected: true,
    })}\n`, { mode: 0o600 })
    const extraField = spawnSync(executable, [fixture.stateDirectory, reference, fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(extraField.status, 1)
    assert.match(extraField.stderr, /^SCENE_EXTENSION_NOT_AUTHORIZED\n$/u)

    await writeFile(path.join(fixture.artifactRoot, 'authorization.json'), `${JSON.stringify(fixture.authorization)}\n`, { mode: 0o644 })
    await chmod(path.join(fixture.artifactRoot, 'authorization.json'), 0o644)
    const permissive = spawnSync(executable, [fixture.stateDirectory, reference, fixture.manifest.ownerId], { encoding: 'utf8' })
    assert.equal(permissive.status, 1)
    assert.match(permissive.stderr, /^SCENE_EXTENSION_STORE_INVALID\n$/u)
    assert.doesNotMatch(permissive.stderr, new RegExp(root.replaceAll('/', '\\/'), 'u'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scheme task state linearizes stop with callbacks and retires terminal IDs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-task-state-'))
  try {
    const main = path.join(root, 'main.swift')
    const executable = path.join(root, 'task-state-proof')
    const moduleCache = path.join(root, 'module-cache')
    await mkdir(moduleCache, { mode: 0o700 })
    await writeFile(main, `
import Foundation

final class Token {}

let state = AOSSceneExtensionSchemeTaskState()
let token = Token()
let taskID = ObjectIdentifier(token)
guard state.start(taskID) else { exit(1) }

let callbacksEntered = DispatchSemaphore(value: 0)
let releaseCallbacks = DispatchSemaphore(value: 0)
let completionReturned = DispatchSemaphore(value: 0)
let stopReturned = DispatchSemaphore(value: 0)
DispatchQueue.global().async {
    guard state.finish(taskID, callbacks: {
        callbacksEntered.signal()
        releaseCallbacks.wait()
    }) else { exit(2) }
    completionReturned.signal()
}
guard callbacksEntered.wait(timeout: .now() + 2) == .success else { exit(3) }
DispatchQueue.global().async {
    state.stop(taskID)
    stopReturned.signal()
}
guard stopReturned.wait(timeout: .now() + 0.05) == .timedOut,
      completionReturned.wait(timeout: .now() + 0.05) == .timedOut else { exit(4) }
releaseCallbacks.signal()
guard completionReturned.wait(timeout: .now() + 2) == .success,
      stopReturned.wait(timeout: .now() + 2) == .success,
      state.trackedTaskCount == 0 else { exit(5) }

var tokens: [Token] = []
for index in 0..<1_000 {
    let next = Token()
    tokens.append(next)
    let nextID = ObjectIdentifier(next)
    guard state.start(nextID) else { exit(6) }
    if index.isMultiple(of: 2) {
        state.stop(nextID)
        var callbacksRan = false
        if state.finish(nextID, callbacks: { callbacksRan = true }) || callbacksRan {
            exit(9)
        }
    } else if !state.finish(nextID, callbacks: {}) {
        exit(7)
    }
}
guard state.trackedTaskCount == 0 else { exit(8) }
print("ok")
`)
    execFileSync('swiftc', [taskStateSource, main, '-o', executable], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: moduleCache,
        SWIFT_MODULECACHE_PATH: moduleCache,
      },
      stdio: 'pipe',
    })
    const result = spawnSync(executable, [], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'ok\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native extension handler and store typecheck together without the AOS binary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-native-typecheck-'))
  try {
    const stub = path.join(root, 'runtime-path-stub.swift')
    const moduleCache = path.join(root, 'module-cache')
    await mkdir(moduleCache, { mode: 0o700 })
    await writeFile(stub, 'import Foundation\nfunc aosStateDir() -> String { "/tmp/aos-scene-extension-test" }\n')
    const result = spawnSync('swiftc', ['-parse-as-library', '-typecheck', storeSource, taskStateSource, handlerSource, stub], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: moduleCache,
        SWIFT_MODULECACHE_PATH: moduleCache,
      },
    })
    assert.equal(result.status, 0, result.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('daemon admission passes the validated scene lease owner into the native store', async () => {
  const source = await readFile(unifiedSource, 'utf8')
  assert.match(source, /sceneExtensionStore\.admitSceneOperation\(\s*operation,\s*expectedOwnerID: owner\s*\)/u)
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const extensionExample = path.join(repoRoot, 'packages/toolkit/scene/extension-examples/basic-three')

async function run(args) {
  const child = spawn(process.execPath, ['scripts/aos-scene.mjs', ...args], {
    cwd: repoRoot,
    env: { ...process.env, AOS_STATE_ROOT: path.join(os.tmpdir(), 'must-not-connect') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { ...result, stderr, stdout }
}

async function artifactBytes(root) {
  const names = (await readdir(root)).sort()
  return Promise.all(names.map(async (name) => [name, await readFile(path.join(root, name))]))
}

test('scene scaffold commands create deterministic, digest-valid artifacts without path or source disclosure', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-scaffold-'))
  try {
    const cartridgeA = path.join(temp, 'cartridge-a')
    const cartridgeB = path.join(temp, 'cartridge-b')
    const cartridgeArgs = ['--id', 'example/spinner', '--template', 'spinning-object', '--json']
    const createdA = await run(['cartridge', 'scaffold', cartridgeA, ...cartridgeArgs])
    const createdB = await run(['cartridge', 'scaffold', cartridgeB, ...cartridgeArgs])
    assert.equal(createdA.code, 0, createdA.stderr)
    assert.equal(createdB.code, 0, createdB.stderr)
    assert.deepEqual(await artifactBytes(cartridgeA), await artifactBytes(cartridgeB))
    const cartridgeSummary = JSON.parse(createdA.stdout)
    assert.equal(cartridgeSummary.kind, 'cartridge')
    assert.match(cartridgeSummary.digest, /^[a-f0-9]{64}$/u)
    assert.doesNotMatch(createdA.stdout, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
    const cartridgeValidation = await run(['cartridge', 'validate', cartridgeA, '--json'])
    assert.equal(cartridgeValidation.code, 0, cartridgeValidation.stderr)
    assert.equal(JSON.parse(cartridgeValidation.stdout).digest, cartridgeSummary.digest)

    const extensionA = path.join(temp, 'extension-a')
    const extensionB = path.join(temp, 'extension-b')
    const extensionArgs = ['--owner', 'example.consumer', '--id', 'basic-three', '--template', 'basic-three', '--json']
    const extensionCreatedA = await run(['extension', 'scaffold', extensionA, ...extensionArgs])
    const extensionCreatedB = await run(['extension', 'scaffold', extensionB, ...extensionArgs])
    assert.equal(extensionCreatedA.code, 0, extensionCreatedA.stderr)
    assert.equal(extensionCreatedB.code, 0, extensionCreatedB.stderr)
    assert.deepEqual(await artifactBytes(extensionA), await artifactBytes(extensionB))
    assert.deepEqual(await artifactBytes(extensionA), await artifactBytes(extensionExample))
    const extensionSummary = JSON.parse(extensionCreatedA.stdout)
    assert.match(extensionSummary.digest, /^[a-f0-9]{64}$/u)
    assert.doesNotMatch(extensionCreatedA.stdout, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
    assert.doesNotMatch(extensionCreatedA.stdout, /IcosahedronGeometry/u)
    const extensionValidation = await run(['extension', 'validate', extensionA, '--json'])
    assert.equal(extensionValidation.code, 0, extensionValidation.stderr)
    assert.equal(JSON.parse(extensionValidation.stdout).digest, extensionSummary.digest)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene scaffolds reject overwrite, traversal, linked parents, unsafe identity, and partial output', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-scaffold-attacks-'))
  try {
    const existing = path.join(temp, 'existing')
    await writeFile(existing, 'retain-me')
    const overwrite = await run([
      'cartridge', 'scaffold', existing,
      '--id', 'example/spinner', '--template', 'spinning-object', '--json',
    ])
    assert.equal(overwrite.code, 1)
    assert.match(overwrite.stderr, /SCENE_SCAFFOLD_EXISTS/u)
    assert.equal(await readFile(existing, 'utf8'), 'retain-me')

    const traversal = await run([
      'cartridge', 'scaffold', `${temp}/nested/../escape`,
      '--id', 'example/spinner', '--template', 'spinning-object', '--json',
    ])
    assert.equal(traversal.code, 1)
    assert.match(traversal.stderr, /SCENE_SCAFFOLD_TRAVERSAL/u)

    const realParent = path.join(temp, 'real-parent')
    const linkedParent = path.join(temp, 'linked-parent')
    await mkdir(realParent, { mode: 0o700 })
    await symlink(realParent, linkedParent)
    const linked = await run([
      'extension', 'scaffold', path.join(linkedParent, 'extension'),
      '--owner', 'example.consumer', '--id', 'basic-three', '--template', 'basic-three', '--json',
    ])
    assert.equal(linked.code, 1)
    assert.match(linked.stderr, /SCENE_SCAFFOLD_PARENT_INVALID/u)

    const invalidTarget = path.join(temp, 'invalid')
    const invalid = await run([
      'extension', 'scaffold', invalidTarget,
      '--owner', 'INVALID OWNER', '--id', 'basic-three', '--template', 'basic-three', '--json',
    ])
    assert.equal(invalid.code, 1)
    assert.match(invalid.stderr, /SCENE_SCAFFOLD_ID_INVALID/u)
    assert.equal(await lstat(invalidTarget).catch(() => null), null)

    const unsafeParent = path.join(temp, 'unsafe-parent')
    await mkdir(unsafeParent, { mode: 0o777 })
    await chmod(unsafeParent, 0o777)
    const unsafe = await run([
      'cartridge', 'scaffold', path.join(unsafeParent, 'cartridge'),
      '--id', 'example/spinner', '--template', 'spinning-object', '--json',
    ])
    assert.equal(unsafe.code, 1)
    assert.match(unsafe.stderr, /SCENE_SCAFFOLD_PARENT_PERMISSIONS/u)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})


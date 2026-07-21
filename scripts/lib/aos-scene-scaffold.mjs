import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'

import {
  SCENE_EXTENSION_CONTRACT_ID,
  SCENE_EXTENSION_SCENE_ABI,
  SCENE_EXTENSION_SCHEMA_VERSION,
  SCENE_EXTENSION_THREE_REVISION,
  serializeSceneExtensionDigestMaterial,
  validateSceneExtensionManifest,
} from '../../packages/toolkit/scene/scene-extension.js'
import { loadSceneCartridge } from './aos-scene-cartridge.mjs'
import { validateSceneExtensionDirectory } from './aos-scene-extension.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const CARTRIDGE_TEMPLATE_ROOT = path.join(REPO_ROOT, 'packages/toolkit/scene/examples')
const CARTRIDGE_TEMPLATES = new Set([
  'aim-and-commit',
  'conventional-drag',
  'radial-menu',
  'spinning-object',
])
const EXTENSION_TEMPLATES = new Set(['basic-three'])
const OWNER_ONLY_DIRECTORY_MODE = 0o700
const OWNER_ONLY_FILE_MODE = 0o600
const SAFE_EXTENSION_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
const SAFE_RESOURCE_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u
const STAGING_PREFIX = '.aos-scene-scaffold-'

const BASIC_THREE_BODY = `const { THREE, document } = context
const root = new THREE.Group()
root.name = document.id
const geometry = new THREE.IcosahedronGeometry(1, 1)
const material = new THREE.MeshStandardMaterial({
  color: 0x5f6fff,
  emissive: 0x141b66,
  emissiveIntensity: 0.45,
  metalness: 0.55,
  roughness: 0.3,
})
const mesh = new THREE.Mesh(geometry, material)
root.add(mesh)
let disposed = false
let suspended = false

return Object.freeze({
  object: root,
  activate() {
    if (!disposed) root.visible = true
  },
  applySignal(binding, value) {
    if (disposed || binding?.target !== 'material.emissiveIntensity' || !Number.isFinite(value)) return false
    material.emissiveIntensity = Math.max(0, Math.min(2, value))
    return true
  },
  applyAnimation(binding, value) {
    if (disposed || binding?.target !== 'rotation.y' || !Number.isFinite(value)) return false
    mesh.rotation.y = value
    return true
  },
  tick(elapsedMs) {
    if (!disposed && !suspended && Number.isFinite(elapsedMs)) mesh.rotation.y = elapsedMs * 0.00025
  },
  suspend() {
    suspended = true
    root.visible = false
  },
  resume() {
    if (disposed) return
    suspended = false
    root.visible = true
  },
  contextLost() {
    root.visible = false
  },
  contextRestored() {
    if (!disposed && !suspended) root.visible = true
  },
  dispose() {
    if (disposed) return
    disposed = true
    root.remove(mesh)
    geometry.dispose()
    material.dispose()
    root.clear()
  },
})
`

export class SceneScaffoldError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SceneScaffoldError'
    this.code = code
  }
}

function fail(code, message) {
  throw new SceneScaffoldError(code, message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]))
  }
  return value
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortedValue(value), null, 2)}\n`)
}

function isOwnerControlled(info) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  return (uid === null || info.uid === uid) && (info.mode & 0o022) === 0
}

async function inspectDestination(destination) {
  if (typeof destination !== 'string' || destination.length === 0 || destination.includes('\0')) {
    fail('SCENE_SCAFFOLD_DESTINATION_INVALID', 'Scene scaffold destination is invalid.')
  }
  if (destination.split(/[\\/]/u).some((segment) => segment === '..')) {
    fail('SCENE_SCAFFOLD_TRAVERSAL', 'Scene scaffold destination cannot contain traversal segments.')
  }
  const requested = path.resolve(destination)
  const name = path.basename(requested)
  if (name === '.' || name === path.parse(requested).root) {
    fail('SCENE_SCAFFOLD_DESTINATION_INVALID', 'Scene scaffold destination requires a new directory name.')
  }
  const existing = await lstat(requested).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (existing) fail('SCENE_SCAFFOLD_EXISTS', 'Scene scaffold destination already exists.')

  const requestedParent = path.dirname(requested)
  const parentInfo = await lstat(requestedParent).catch(() => null)
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    fail('SCENE_SCAFFOLD_PARENT_INVALID', 'Scene scaffold parent must be a real directory.')
  }
  if (!isOwnerControlled(parentInfo)) {
    fail('SCENE_SCAFFOLD_PARENT_PERMISSIONS', 'Scene scaffold parent must be owner-controlled.')
  }
  const canonicalParent = await realpath(requestedParent)
  return Object.freeze({
    parent: canonicalParent,
    target: path.join(canonicalParent, name),
  })
}

async function writeOwnerOnlyFile(file, bytes) {
  const handle = await open(file, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, OWNER_ONLY_FILE_MODE)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(file, OWNER_ONLY_FILE_MODE)
}

async function createArtifact(destination, files, validate) {
  const location = await inspectDestination(destination)
  const staging = path.join(location.parent, `${STAGING_PREFIX}${randomUUID()}`)
  let stagingActive = true
  try {
    await mkdir(staging, { mode: OWNER_ONLY_DIRECTORY_MODE })
    await chmod(staging, OWNER_ONLY_DIRECTORY_MODE)
    for (const [name, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      await writeOwnerOnlyFile(path.join(staging, name), bytes)
    }
    const validation = await validate(staging)
    if (await lstat(location.target).catch(() => null)) {
      fail('SCENE_SCAFFOLD_EXISTS', 'Scene scaffold destination already exists.')
    }
    await rename(staging, location.target)
    stagingActive = false
    return validation
  } catch (error) {
    if (error instanceof SceneScaffoldError) throw error
    fail('SCENE_SCAFFOLD_WRITE_FAILED', 'Scene scaffold could not be created atomically.')
  } finally {
    if (stagingActive) await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

async function readCartridgeTemplate(template, id) {
  if (!CARTRIDGE_TEMPLATES.has(template)) {
    fail('SCENE_SCAFFOLD_TEMPLATE_INVALID', 'Scene cartridge scaffold template is invalid.')
  }
  const root = path.join(CARTRIDGE_TEMPLATE_ROOT, template)
  const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))
  const [manifest, scene, animations, interactions] = await Promise.all([
    readJson('cartridge.json'),
    readJson('scene.json'),
    readJson('animations.json'),
    readJson('interactions.json'),
  ])
  manifest.id = id
  scene.id = id
  const payloads = new Map([
    ['animations.json', canonicalJsonBytes(animations)],
    ['interactions.json', canonicalJsonBytes(interactions)],
    ['scene.json', canonicalJsonBytes(scene)],
  ])
  for (const descriptor of Object.values(manifest.files)) {
    descriptor.sha256 = sha256(payloads.get(descriptor.path))
  }
  payloads.set('cartridge.json', canonicalJsonBytes(manifest))
  return payloads
}

function validateResourceId(id) {
  if (typeof id !== 'string' || id.length > 128 || !SAFE_RESOURCE_ID.test(id)) {
    fail('SCENE_SCAFFOLD_ID_INVALID', 'Scene cartridge resource ID is invalid.')
  }
  return id
}

function validateExtensionSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_EXTENSION_SEGMENT.test(value)) {
    fail('SCENE_SCAFFOLD_ID_INVALID', `Scene extension ${label} is invalid.`)
  }
  return value
}

function extensionFiles(ownerId, id, template) {
  if (!EXTENSION_TEMPLATES.has(template)) {
    fail('SCENE_SCAFFOLD_TEMPLATE_INVALID', 'Scene extension scaffold template is invalid.')
  }
  const implementationId = `${ownerId}.${id}`
  const body = Buffer.from(BASIC_THREE_BODY)
  const manifest = {
    contract: SCENE_EXTENSION_CONTRACT_ID,
    schemaVersion: SCENE_EXTENSION_SCHEMA_VERSION,
    id,
    ownerId,
    digest: '0'.repeat(64),
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    implementationIds: [implementationId],
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
    budgets: {
      maxDrawCalls: 2,
      maxObjects: 4,
      maxResources: 4,
      maxTextureBytes: 0,
      maxTriangles: 80,
      maxWorkingBytes: 64 * 1024,
    },
  }
  const provisional = validateSceneExtensionManifest(manifest)
  if (!provisional.ok) fail('SCENE_SCAFFOLD_ID_INVALID', provisional.errors[0].message)
  manifest.digest = sha256(serializeSceneExtensionDigestMaterial(manifest, sha256(body)))
  return new Map([
    ['extension.json', canonicalJsonBytes(manifest)],
    ['projection.js', body],
  ])
}

function fileSummary(files) {
  return [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bytes]) => Object.freeze({ bytes: bytes.length, path: name, sha256: sha256(bytes) }))
}

export async function scaffoldSceneCartridge(destination, { id, template } = {}) {
  validateResourceId(id)
  const files = await readCartridgeTemplate(template, id)
  const loaded = await createArtifact(destination, files, loadSceneCartridge)
  return Object.freeze({
    status: 'created',
    kind: 'cartridge',
    id,
    template,
    digest: loaded.summary.digest,
    files: fileSummary(files),
  })
}
export async function scaffoldSceneExtension(destination, { ownerId, id, template } = {}) {
  validateExtensionSegment(ownerId, 'owner')
  validateExtensionSegment(id, 'ID')
  const files = extensionFiles(ownerId, id, template)
  const validated = await createArtifact(destination, files, validateSceneExtensionDirectory)
  return Object.freeze({
    status: 'created',
    kind: 'extension',
    ownerId,
    id,
    template,
    digest: validated.digest,
    implementationIds: validated.implementationIds,
    files: fileSummary(files),
  })
}

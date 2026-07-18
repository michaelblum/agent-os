import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  resolveSceneCartridge,
  validateSceneCartridge,
  validateSceneCartridgeManifest,
} from '../../packages/toolkit/scene/index.js'

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_SCENE_BYTES = 2 * 1024 * 1024
const MAX_AUXILIARY_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 1024

export class SceneCartridgeLoadError extends Error {
  constructor(message, code = 'SCENE_CARTRIDGE_INVALID') {
    super(message)
    this.name = 'SceneCartridgeLoadError'
    this.code = code
  }
}

function fail(code, message) {
  throw new SceneCartridgeLoadError(message, code)
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function validateContained(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    fail('SCENE_CARTRIDGE_PATH', 'Scene cartridge contains a noncanonical path.')
  }
  const segments = relative.split('/')
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('SCENE_CARTRIDGE_PATH', 'Scene cartridge contains a noncanonical path.')
  }
  const absolute = path.resolve(root, ...segments)
  const prefix = `${path.resolve(root)}${path.sep}`
  if (!absolute.startsWith(prefix)) fail('SCENE_CARTRIDGE_PATH', 'Scene cartridge path escapes its root.')
  return absolute
}

async function readBoundedJson(absolute, maxBytes, label) {
  const info = await lstat(absolute).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) fail('SCENE_CARTRIDGE_FILE', `Scene cartridge ${label} is missing or invalid.`)
  if (info.size <= 0 || info.size > maxBytes) fail('SCENE_CARTRIDGE_FILE_SIZE', `Scene cartridge ${label} exceeds its byte limit.`)
  let value
  try {
    value = JSON.parse(await readFile(absolute, 'utf8'))
  } catch {
    fail('SCENE_CARTRIDGE_JSON', `Scene cartridge ${label} is not valid JSON.`)
  }
  return { bytes: info.size, value }
}

async function sha256File(absolute) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(absolute)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertAssetMagic(absolute, mediaType) {
  const handle = await open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    const ascii = bytes.toString('ascii')
    const valid = mediaType === 'image/png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mediaType === 'image/jpeg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mediaType === 'image/webp'
          ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
          : mediaType === 'image/avif'
            ? ascii.slice(4, 12).includes('ftypavif') || ascii.slice(4, 12).includes('ftypavis')
            : mediaType === 'model/gltf-binary'
              ? ascii.startsWith('glTF')
              : false
    if (!valid) fail('SCENE_CARTRIDGE_ASSET_TYPE', 'Scene cartridge asset bytes do not match the declared media type.')
  } finally {
    await handle.close()
  }
}

async function scanTree(root) {
  const files = new Set()
  const directories = new Set()
  const queue = [root]
  let entries = 0
  while (queue.length > 0) {
    const current = queue.shift()
    const children = await readdir(current, { withFileTypes: true })
    for (const child of children) {
      entries += 1
      if (entries > MAX_TREE_ENTRIES) fail('SCENE_CARTRIDGE_ENTRY_COUNT', 'Scene cartridge contains too many filesystem entries.')
      const absolute = path.join(current, child.name)
      const relative = relativePath(root, absolute)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) fail('SCENE_CARTRIDGE_LINK', 'Scene cartridges cannot contain symbolic links.')
      if (info.isDirectory()) {
        directories.add(relative)
        queue.push(absolute)
      } else if (info.isFile()) {
        files.add(relative)
      } else {
        fail('SCENE_CARTRIDGE_SPECIAL_FILE', 'Scene cartridges cannot contain special files.')
      }
    }
  }
  return { directories, files }
}

function expectedDirectories(files) {
  const directories = new Set()
  for (const file of files) {
    const segments = file.split('/')
    segments.pop()
    while (segments.length > 0) {
      directories.add(segments.join('/'))
      segments.pop()
    }
  }
  return directories
}

function assertExactTree(tree, manifest) {
  const expectedFiles = new Set([
    'cartridge.json',
    ...Object.values(manifest.files).map((file) => file.path),
    ...manifest.assets.map((asset) => asset.path),
  ])
  for (const file of tree.files) {
    if (!expectedFiles.has(file)) fail('SCENE_CARTRIDGE_UNDECLARED_FILE', 'Scene cartridge contains an undeclared file.')
  }
  for (const file of expectedFiles) {
    if (!tree.files.has(file)) fail('SCENE_CARTRIDGE_FILE', 'Scene cartridge is missing a declared file.')
  }
  const expected = expectedDirectories(expectedFiles)
  for (const directory of tree.directories) {
    if (!expected.has(directory)) fail('SCENE_CARTRIDGE_UNDECLARED_DIRECTORY', 'Scene cartridge contains an undeclared directory.')
  }
}

function validationFailure(validation) {
  const first = validation.errors[0]
  fail(first?.code?.toUpperCase() ?? 'SCENE_CARTRIDGE_INVALID', first?.message ?? 'Scene cartridge validation failed.')
}

export async function loadSceneCartridge(directory, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) fail('MISSING_ARG', 'Scene cartridge validation requires a directory path.')
  const root = path.resolve(directory)
  const rootInfo = await lstat(root).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail('SCENE_CARTRIDGE_ROOT', 'Scene cartridge root must be a real directory.')
  const tree = await scanTree(root)
  const manifestFile = await readBoundedJson(path.join(root, 'cartridge.json'), MAX_MANIFEST_BYTES, 'manifest')
  const manifestValidation = validateSceneCartridgeManifest(manifestFile.value)
  if (!manifestValidation.ok) validationFailure(manifestValidation)
  const manifest = manifestFile.value
  assertExactTree(tree, manifest)

  const payloads = {}
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    const absolute = validateContained(root, descriptor.path)
    const limit = key === 'scene' ? MAX_SCENE_BYTES : MAX_AUXILIARY_BYTES
    const payload = await readBoundedJson(absolute, limit, descriptor.path)
    const digest = await sha256File(absolute)
    if (digest !== descriptor.sha256) fail('SCENE_CARTRIDGE_DIGEST', 'Scene cartridge payload digest does not match its manifest.')
    payloads[key] = payload.value
  }

  const assets = []
  let assetBytes = 0
  for (const descriptor of manifest.assets) {
    const absolute = validateContained(root, descriptor.path)
    const info = await lstat(absolute).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) fail('SCENE_CARTRIDGE_ASSET', 'Scene cartridge asset is missing or invalid.')
    if (info.size !== descriptor.bytes) fail('SCENE_CARTRIDGE_ASSET_SIZE', 'Scene cartridge asset size does not match its manifest.')
    assetBytes += info.size
    if (assetBytes > manifest.budgets.maxAssetBytes) fail('SCENE_CARTRIDGE_ASSET_BUDGET', 'Scene cartridge assets exceed the declared byte budget.')
    await assertAssetMagic(absolute, descriptor.mediaType)
    if (await sha256File(absolute) !== descriptor.sha256) fail('SCENE_CARTRIDGE_DIGEST', 'Scene cartridge asset digest does not match its manifest.')
    assets.push({ ...descriptor })
  }

  const cartridge = {
    animations: payloads.animations,
    assets,
    interactions: payloads.interactions,
    manifest,
    scene: payloads.scene,
  }
  const validation = validateSceneCartridge(cartridge, options)
  if (!validation.ok) validationFailure(validation)
  const resolved = resolveSceneCartridge(cartridge, options)
  const digest = createHash('sha256').update(JSON.stringify(resolved.manifest)).digest('hex')
  return Object.freeze({
    digest,
    resolved,
    summary: Object.freeze({
      animations: resolved.animations.animations.length,
      assetBytes,
      assets: resolved.assets.length,
      contract: resolved.manifest.contract,
      digest,
      id: resolved.manifest.id,
      implementations: resolved.manifest.implementations.map(({ id, kind }) => ({ id, kind })),
      interactions: resolved.interactions.interactions.length,
      objects: resolved.document.objects.length,
      resources: resolved.document.resources.length,
      revision: resolved.manifest.revision,
      status: 'ok',
    }),
  })
}

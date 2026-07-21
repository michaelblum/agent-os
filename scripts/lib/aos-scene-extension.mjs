import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'

import {
  serializeSceneExtensionDigestMaterial,
  validateSceneExtensionManifest,
} from '../../packages/toolkit/scene/scene-extension.js'
import { runtimeMode, stateDir } from './agent-workspace/core.mjs'
import { failSceneExtension as fail, SceneExtensionStoreError } from './scene-extension/errors.mjs'
import {
  validateSceneExtensionFactoryBody as validateFactoryBody,
  withSceneExtensionFactoryBodyCompiler as withCompiler,
} from './scene-extension/module-inspector.mjs'

export { SceneExtensionStoreError } from './scene-extension/errors.mjs'

const MANIFEST_FILE = 'extension.json'
const BODY_FILE = 'projection.js'
const AUTHORIZATION_FILE = 'authorization.json'
const AUTHORIZATION_CONTRACT = 'aos.scene.extension.authorization.v1'
const MAX_AUTHORIZATION_BYTES = 16 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_LIST_ENTRIES = 256
const MAX_LIST_VALIDATION_BYTES = 64 * 1024 * 1024
const MAX_LIST_VALIDATION_MS = 10_000
const OWNER_ONLY_DIRECTORY_MODE = 0o700
const OWNER_ONLY_FILE_MODE = 0o600
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
const SAFE_PATH_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
const SHA256 = /^[a-f0-9]{64}$/u
const STAGING_PREFIX = '.scene-extension-stage-'
const MAX_STAGING_ENTRIES = 64
const STAGING_MAX_AGE_MS = 60 * 60 * 1000

function normalizeFilesystemError(error, code = 'SCENE_EXTENSION_FILESYSTEM') {
  if (error instanceof SceneExtensionStoreError) return error
  return new SceneExtensionStoreError(code, 'Scene extension filesystem operation failed.')
}

function isOwnerOnly(info, expectedMode) {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  return (info.mode & 0o777) === expectedMode
    && (currentUid === null || info.uid === currentUid)
}

function isOwnerControlled(info) {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  return (currentUid === null || info.uid === currentUid) && (info.mode & 0o022) === 0
}

async function inspectRealDirectory(directory, { stored = false } = {}) {
  if (typeof directory !== 'string' || directory.length === 0 || directory.includes('\0')) {
    fail('SCENE_EXTENSION_ROOT_INVALID', 'Scene extension root is invalid.')
  }
  const resolved = path.resolve(directory)
  let info
  try {
    info = await lstat(resolved)
  } catch {
    fail('SCENE_EXTENSION_ROOT_INVALID', 'Scene extension root is unavailable.')
  }
  if (info.isSymbolicLink()) fail('SCENE_EXTENSION_LINK', 'Scene extension roots cannot be symbolic links.')
  if (!info.isDirectory()) fail('SCENE_EXTENSION_ROOT_INVALID', 'Scene extension root must be a directory.')
  let canonical
  try {
    canonical = await realpath(resolved)
  } catch (error) {
    throw normalizeFilesystemError(error)
  }
  if (stored && !isOwnerOnly(info, OWNER_ONLY_DIRECTORY_MODE)) {
    fail('SCENE_EXTENSION_STORE_PERMISSIONS', 'Stored scene extension directories must be owner-only.')
  }
  if (!stored && !isOwnerControlled(info)) {
    fail('SCENE_EXTENSION_SOURCE_PERMISSIONS', 'Scene extension sources must be owner-controlled and not group- or world-writable.')
  }
  return canonical
}

async function readExactLayout(root, { stored = false } = {}) {
  const expected = stored
    ? [AUTHORIZATION_FILE, MANIFEST_FILE, BODY_FILE]
    : [MANIFEST_FILE, BODY_FILE]
  const names = []
  let directory
  try {
    directory = await opendir(root)
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) fail('SCENE_EXTENSION_LINK', 'Scene extensions cannot contain symbolic links.')
      if (!entry.isFile()) fail('SCENE_EXTENSION_SPECIAL_FILE', 'Scene extensions cannot contain special files or directories.')
      names.push(entry.name)
      if (names.length > expected.length) {
        fail('SCENE_EXTENSION_EXTRA_FILE', 'Scene extensions contain an unexpected file.')
      }
    }
  } catch (error) {
    throw normalizeFilesystemError(error)
  }
  names.sort()
  if (stored && names.length === 2 && names[0] === MANIFEST_FILE && names[1] === BODY_FILE) {
    fail('SCENE_EXTENSION_NOT_AUTHORIZED', 'Stored scene extension authorization is unavailable.')
  }
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    fail('SCENE_EXTENSION_LAYOUT_INVALID', 'Scene extension layout is invalid.')
  }
}

async function readBoundedFile(root, name, maximumBytes, { aggregate = null, stored = false } = {}) {
  const absolute = path.join(root, name)
  let before
  let handle
  try {
    before = await lstat(absolute)
    if (before.isSymbolicLink()) fail('SCENE_EXTENSION_LINK', 'Scene extension files cannot be symbolic links.')
    if (!before.isFile()) fail('SCENE_EXTENSION_FILE_INVALID', 'Scene extension payload is not a regular file.')
    if (before.size <= 0 || before.size > maximumBytes) {
      fail('SCENE_EXTENSION_FILE_SIZE', 'Scene extension payload exceeds its byte limit.')
    }
    if (aggregate) {
      if (Date.now() >= aggregate.deadline || before.size > aggregate.remainingBytes) {
        fail('SCENE_EXTENSION_LIST_BUDGET', 'Scene extension listing reached its validation budget.')
      }
      aggregate.remainingBytes -= before.size
    }
    if (stored && !isOwnerOnly(before, OWNER_ONLY_FILE_MODE)) {
      fail('SCENE_EXTENSION_STORE_PERMISSIONS', 'Stored scene extension files must be owner-only.')
    }
    if (!stored && !isOwnerControlled(before)) {
      fail('SCENE_EXTENSION_SOURCE_PERMISSIONS', 'Scene extension source files must be owner-controlled and not group- or world-writable.')
    }
    handle = await open(absolute, fsConstants.O_RDONLY | NO_FOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      fail('SCENE_EXTENSION_FILE_CHANGED', 'Scene extension payload changed during validation.')
    }
    const bytes = await handle.readFile()
    if (bytes.length !== opened.size || bytes.length > maximumBytes) {
      fail('SCENE_EXTENSION_FILE_CHANGED', 'Scene extension payload changed during validation.')
    }
    return bytes
  } catch (error) {
    if (error?.code === 'ELOOP') fail('SCENE_EXTENSION_LINK', 'Scene extension files cannot be symbolic links.')
    throw normalizeFilesystemError(error)
  } finally {
    await handle?.close().catch(() => {})
  }
}

function decodeUtf8(bytes, code, message) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail(code, message)
  }
}

function parseManifest(bytes) {
  const source = decodeUtf8(bytes, 'SCENE_EXTENSION_MANIFEST_ENCODING', 'Scene extension manifest must be valid UTF-8.')
  let manifest
  try {
    manifest = JSON.parse(source)
  } catch {
    fail('SCENE_EXTENSION_MANIFEST_JSON', 'Scene extension manifest is not valid JSON.')
  }
  const validation = validateSceneExtensionManifest(manifest)
  if (!validation.ok) fail('SCENE_EXTENSION_MANIFEST_INVALID', 'Scene extension manifest does not satisfy the public contract.')
  return manifest
}

function authorizationFor(manifest) {
  return Object.freeze({
    contract: AUTHORIZATION_CONTRACT,
    ownerId: manifest.ownerId,
    id: manifest.id,
    digest: manifest.digest,
    sceneAbi: manifest.sceneAbi,
    threeRevision: manifest.threeRevision,
  })
}

function canonicalAuthorizationBytes(manifest) {
  return Buffer.from(`${JSON.stringify(authorizationFor(manifest))}\n`)
}

function identityStoreSegment(value) {
  if (typeof value !== 'string' || !SAFE_PATH_SEGMENT.test(value)) {
    fail('SCENE_EXTENSION_MANIFEST_UNSAFE', 'Scene extension identity is not canonical.')
  }
  return value
}

function identityFromStoreSegment(value) {
  return typeof value === 'string' && SAFE_PATH_SEGMENT.test(value) ? value : null
}

function summary(artifact, status = 'ok') {
  return Object.freeze({
    status,
    contract: artifact.manifest.contract,
    schemaVersion: artifact.manifest.schemaVersion,
    ownerId: artifact.manifest.ownerId,
    id: artifact.manifest.id,
    digest: artifact.manifest.digest,
    sceneAbi: artifact.manifest.sceneAbi,
    threeRevision: artifact.manifest.threeRevision,
    implementationIds: [...artifact.manifest.implementationIds],
    budgets: { ...artifact.manifest.budgets },
    manifestBytes: artifact.manifestBytes.length,
    bodyBytes: artifact.bodyBytes.length,
  })
}

async function loadSceneExtension(directory, { aggregate = null, compiler, stored = false } = {}) {
  const root = await inspectRealDirectory(directory, { stored })
  await readExactLayout(root, { stored })
  const storedAuthorizationBytes = stored
    ? await readBoundedFile(root, AUTHORIZATION_FILE, MAX_AUTHORIZATION_BYTES, { aggregate, stored })
    : null
  const sourceManifestBytes = await readBoundedFile(root, MANIFEST_FILE, MAX_MANIFEST_BYTES, { aggregate, stored })
  const bodyBytes = await readBoundedFile(root, BODY_FILE, MAX_BODY_BYTES, { aggregate, stored })
  const manifest = parseManifest(sourceManifestBytes)
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  const bodyDigest = createHash('sha256').update(bodyBytes).digest('hex')
  const digest = createHash('sha256')
    .update(serializeSceneExtensionDigestMaterial(manifest, bodyDigest))
    .digest('hex')
  if (digest !== manifest.digest) fail('SCENE_EXTENSION_DIGEST_MISMATCH', 'Scene extension factory-body digest does not match its manifest.')
  await validateFactoryBody(bodyBytes, manifest, compiler, aggregate)
  const authorizationBytes = canonicalAuthorizationBytes(manifest)
  if (stored && !storedAuthorizationBytes.equals(authorizationBytes)) {
    fail('SCENE_EXTENSION_NOT_AUTHORIZED', 'Stored scene extension authorization does not match its artifact.')
  }
  return Object.freeze({ authorizationBytes, bodyBytes, manifest, manifestBytes, root })
}

async function ensurePrivateDirectory(directory) {
  try {
    await mkdir(directory, { mode: OWNER_ONLY_DIRECTORY_MODE })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
  let info
  try {
    info = await lstat(directory)
  } catch (error) {
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
  if (info.isSymbolicLink()) fail('SCENE_EXTENSION_STORE_LINK', 'Scene extension store directories cannot be symbolic links.')
  if (!info.isDirectory()) fail('SCENE_EXTENSION_STORE_INVALID', 'Scene extension store path is invalid.')
  if (!isOwnerOnly(info, OWNER_ONLY_DIRECTORY_MODE)) {
    fail('SCENE_EXTENSION_STORE_PERMISSIONS', 'Scene extension store directories must be owner-only.')
  }
}

async function openPrivateDirectory(directory) {
  await ensurePrivateDirectory(directory)
  let handle
  try {
    handle = await open(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | NO_FOLLOW)
    const opened = await handle.stat()
    const current = await lstat(directory)
    if (
      !opened.isDirectory()
      || !current.isDirectory()
      || current.isSymbolicLink()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || !isOwnerOnly(opened, OWNER_ONLY_DIRECTORY_MODE)
    ) {
      fail('SCENE_EXTENSION_STORE_CHANGED', 'Scene extension store directory changed during installation.')
    }
    return { directory, dev: opened.dev, handle, ino: opened.ino }
  } catch (error) {
    await handle?.close().catch(() => {})
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
}

async function assertDirectoryIdentity(identity) {
  let opened
  let current
  try {
    [opened, current] = await Promise.all([identity.handle.stat(), lstat(identity.directory)])
  } catch (error) {
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
  if (
    !opened.isDirectory()
    || !current.isDirectory()
    || current.isSymbolicLink()
    || opened.dev !== identity.dev
    || opened.ino !== identity.ino
    || current.dev !== identity.dev
    || current.ino !== identity.ino
    || !isOwnerOnly(opened, OWNER_ONLY_DIRECTORY_MODE)
    || !isOwnerOnly(current, OWNER_ONLY_DIRECTORY_MODE)
  ) {
    fail('SCENE_EXTENSION_STORE_CHANGED', 'Scene extension store directory changed during installation.')
  }
}

async function prepareStore(env) {
  const requestedModeRoot = stateDir(env)
  const requestedStateRoot = path.dirname(requestedModeRoot)
  try {
    await mkdir(requestedStateRoot, { mode: OWNER_ONLY_DIRECTORY_MODE, recursive: true })
  } catch (error) {
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
  const stateInfo = await lstat(requestedStateRoot).catch(() => null)
  if (!stateInfo?.isDirectory() || stateInfo.isSymbolicLink()) {
    fail('SCENE_EXTENSION_STORE_INVALID', 'AOS state root is invalid.')
  }
  const canonicalStateRoot = await realpath(requestedStateRoot).catch((error) => { throw normalizeFilesystemError(error) })
  const modeRoot = path.join(canonicalStateRoot, runtimeMode(env))
  await ensurePrivateDirectory(modeRoot)
  const storeRoot = path.join(modeRoot, 'scene-extensions')
  await ensurePrivateDirectory(storeRoot)
  return { modeRoot, storeRoot }
}

async function writeOwnerOnlyFile(file, bytes) {
  let handle
  try {
    handle = await open(file, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | NO_FOLLOW, OWNER_ONLY_FILE_MODE)
    await handle.writeFile(bytes)
    await handle.chmod(OWNER_ONLY_FILE_MODE)
    await handle.sync()
  } catch (error) {
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function syncDirectoryHandle(handle) {
  try {
    await handle.sync()
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP'].includes(error?.code)) throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
}

async function trySyncDirectoryHandle(handle) {
  try {
    await handle.sync()
    return true
  } catch {
    return false
  }
}

async function scanStagingDirectories(extensionRoot) {
  const entries = []
  let directory
  try {
    directory = await opendir(extensionRoot)
    for await (const entry of directory) {
      if (!entry.name.startsWith(STAGING_PREFIX)) continue
      entries.push(entry)
      if (entries.length > MAX_STAGING_ENTRIES) break
    }
  } catch (error) {
    throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
  }
  return entries
}

async function reconcileStagingDirectories(extensionRoot) {
  const now = Date.now()
  const candidates = await scanStagingDirectories(extensionRoot)
  for (const entry of candidates.slice(0, MAX_STAGING_ENTRIES)) {
    const candidate = path.join(extensionRoot, entry.name)
    let info
    try {
      info = await lstat(candidate)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
    }
    if (
      entry.isSymbolicLink()
      || !entry.isDirectory()
      || info.isSymbolicLink()
      || !info.isDirectory()
      || !isOwnerOnly(info, OWNER_ONLY_DIRECTORY_MODE)
    ) {
      fail('SCENE_EXTENSION_STAGING_INVALID', 'Scene extension staging state is invalid.')
    }
    if (now - info.mtimeMs < STAGING_MAX_AGE_MS) continue
    try {
      await rm(candidate, { recursive: true, force: true })
    } catch (error) {
      throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
    }
  }
  const remaining = await scanStagingDirectories(extensionRoot)
  if (remaining.length >= MAX_STAGING_ENTRIES) {
    fail('SCENE_EXTENSION_STAGING_CAPACITY', 'Scene extension staging capacity is unavailable.')
  }
}

function artifactBytesMatch(left, right) {
  return left.authorizationBytes.equals(right.authorizationBytes)
    && left.manifestBytes.equals(right.manifestBytes)
    && left.bodyBytes.equals(right.bodyBytes)
}

async function compareInstalled(target, artifact, compiler) {
  const existing = await loadSceneExtension(target, { compiler, stored: true })
  if (!artifactBytesMatch(existing, artifact)) {
    fail('SCENE_EXTENSION_STORE_CONFLICT', 'Immutable scene extension bytes already exist for this digest.')
  }
  return existing
}

export async function validateSceneExtensionDirectory(directory) {
  return withCompiler(async (compiler) => summary(await loadSceneExtension(directory, { compiler })))
}

export async function installSceneExtension(directory, { env = process.env, expectedDigest } = {}) {
  if (typeof expectedDigest !== 'string' || !SHA256.test(expectedDigest)) {
    fail('SCENE_EXTENSION_EXPECTED_DIGEST_REQUIRED', 'Scene extension installation requires an exact expected digest.')
  }
  return withCompiler(async (compiler) => {
    const artifact = await loadSceneExtension(directory, { compiler })
    if (artifact.manifest.digest !== expectedDigest) {
      fail('SCENE_EXTENSION_APPROVAL_MISMATCH', 'Scene extension bytes do not match the explicitly approved digest.')
    }
    const { storeRoot } = await prepareStore(env)
    const ownerRoot = path.join(storeRoot, identityStoreSegment(artifact.manifest.ownerId))
    const extensionRoot = path.join(ownerRoot, identityStoreSegment(artifact.manifest.id))
    const target = path.join(extensionRoot, artifact.manifest.digest)
    const identities = []
    const staging = path.join(extensionRoot, `${STAGING_PREFIX}${randomUUID()}`)
    let stagingActive = true
    try {
      const storeIdentity = await openPrivateDirectory(storeRoot)
      identities.push(storeIdentity)
      await assertDirectoryIdentity(storeIdentity)
      const ownerIdentity = await openPrivateDirectory(ownerRoot)
      identities.push(ownerIdentity)
      await assertDirectoryIdentity(storeIdentity)
      await assertDirectoryIdentity(ownerIdentity)
      const extensionIdentity = await openPrivateDirectory(extensionRoot)
      identities.push(extensionIdentity)
      for (const identity of identities) await assertDirectoryIdentity(identity)

      const targetInfo = await lstat(target).catch((error) => {
        if (error?.code === 'ENOENT') return null
        throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
      })
      if (targetInfo) {
        const existing = await compareInstalled(target, artifact, compiler)
        for (const identity of identities) await assertDirectoryIdentity(identity)
        return Object.freeze({ ...summary(existing), action: 'already_installed', installed: false })
      }

      await reconcileStagingDirectories(extensionRoot)
      try {
        await mkdir(staging, { mode: OWNER_ONLY_DIRECTORY_MODE })
        await chmod(staging, OWNER_ONLY_DIRECTORY_MODE)
      } catch (error) {
        throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
      }
      await writeOwnerOnlyFile(path.join(staging, AUTHORIZATION_FILE), artifact.authorizationBytes)
      await writeOwnerOnlyFile(path.join(staging, MANIFEST_FILE), artifact.manifestBytes)
      await writeOwnerOnlyFile(path.join(staging, BODY_FILE), artifact.bodyBytes)
      const stagingIdentity = await openPrivateDirectory(staging)
      try {
        const staged = await loadSceneExtension(staging, { compiler, stored: true })
        if (!artifactBytesMatch(staged, artifact)) {
          fail('SCENE_EXTENSION_INSTALL_FAILED', 'Staged scene extension bytes failed validation.')
        }
        await syncDirectoryHandle(stagingIdentity.handle)
      } finally {
        await stagingIdentity.handle.close().catch(() => {})
      }
      for (const identity of identities) await assertDirectoryIdentity(identity)
      try {
        await rename(staging, target)
        stagingActive = false
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw normalizeFilesystemError(error, 'SCENE_EXTENSION_INSTALL_FAILED')
        for (const identity of identities) await assertDirectoryIdentity(identity)
        const existing = await compareInstalled(target, artifact, compiler)
        return Object.freeze({ ...summary(existing), action: 'already_installed', installed: false })
      }
      await trySyncDirectoryHandle(extensionIdentity.handle)
      return Object.freeze({ ...summary(artifact), action: 'installed', installed: true })
    } finally {
      if (stagingActive && identities.length > 0) {
        const stable = await Promise.all(identities.map((identity) => assertDirectoryIdentity(identity)
          .then(() => true, () => false)))
        if (stable.every(Boolean)) await rm(staging, { recursive: true, force: true }).catch(() => {})
      }
      await Promise.all(identities.map(({ handle }) => handle.close().catch(() => {})))
    }
  })
}

async function boundedDirectoryEntries(directory, limit) {
  const entries = []
  let truncated = false
  let handle
  try {
    handle = await opendir(directory)
    for await (const entry of handle) {
      if (entries.length >= limit) {
        truncated = true
        break
      }
      entries.push(entry)
    }
  } catch (error) {
    throw normalizeFilesystemError(error)
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return { entries, truncated }
}

function invalidEntry(code, identity = {}) {
  return Object.freeze({ status: 'invalid', code, ...identity })
}

async function inspectStoreDirectory(directory, expectedMode = OWNER_ONLY_DIRECTORY_MODE) {
  const info = await lstat(directory).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isDirectory()) return false
  return isOwnerOnly(info, expectedMode)
}

export async function listSceneExtensions({ env = process.env } = {}) {
  const mode = runtimeMode(env)
  const root = path.join(stateDir(env), 'scene-extensions')
  const rootInfo = await lstat(root).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw normalizeFilesystemError(error)
  })
  if (!rootInfo) {
    return Object.freeze({ status: 'ok', runtimeMode: mode, count: 0, invalidCount: 0, truncated: false, extensions: [] })
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || !isOwnerOnly(rootInfo, OWNER_ONLY_DIRECTORY_MODE)) {
    fail('SCENE_EXTENSION_STORE_INVALID', 'Scene extension store root is invalid.')
  }

  return withCompiler(async (compiler) => {
    const extensions = []
    const aggregate = {
      deadline: Date.now() + MAX_LIST_VALIDATION_MS,
      remainingBytes: MAX_LIST_VALIDATION_BYTES,
    }
    let truncated = false
    const room = () => Math.max(0, MAX_LIST_ENTRIES - extensions.length)
    const owners = await boundedDirectoryEntries(root, room())
    truncated ||= owners.truncated
    scan: for (const owner of owners.entries) {
      if (Date.now() >= aggregate.deadline) { truncated = true; break }
      if (extensions.length >= MAX_LIST_ENTRIES) { truncated = true; break }
      const ownerId = identityFromStoreSegment(owner.name)
      if (!ownerId || !owner.isDirectory() || owner.isSymbolicLink()) {
        extensions.push(invalidEntry('SCENE_EXTENSION_STORE_ENTRY_INVALID'))
        continue
      }
      const ownerRoot = path.join(root, owner.name)
      if (!await inspectStoreDirectory(ownerRoot)) {
        extensions.push(invalidEntry('SCENE_EXTENSION_STORE_PERMISSIONS', { ownerId }))
        continue
      }
      const ids = await boundedDirectoryEntries(ownerRoot, room())
      truncated ||= ids.truncated
      for (const id of ids.entries) {
        if (Date.now() >= aggregate.deadline) { truncated = true; break scan }
        if (extensions.length >= MAX_LIST_ENTRIES) { truncated = true; break }
        const extensionId = identityFromStoreSegment(id.name)
        if (!extensionId || !id.isDirectory() || id.isSymbolicLink()) {
          extensions.push(invalidEntry('SCENE_EXTENSION_STORE_ENTRY_INVALID', { ownerId }))
          continue
        }
        const idRoot = path.join(ownerRoot, id.name)
        if (!await inspectStoreDirectory(idRoot)) {
          extensions.push(invalidEntry('SCENE_EXTENSION_STORE_PERMISSIONS', { ownerId, id: extensionId }))
          continue
        }
        const digests = await boundedDirectoryEntries(idRoot, room())
        truncated ||= digests.truncated
        for (const digest of digests.entries) {
          if (Date.now() >= aggregate.deadline) { truncated = true; break scan }
          if (extensions.length >= MAX_LIST_ENTRIES) { truncated = true; break }
          const identity = { ownerId, id: extensionId }
          if (!SHA256.test(digest.name) || !digest.isDirectory() || digest.isSymbolicLink()) {
            extensions.push(invalidEntry('SCENE_EXTENSION_STORE_ENTRY_INVALID', identity))
            continue
          }
          const fullIdentity = { ...identity, digest: digest.name }
          const target = path.join(idRoot, digest.name)
          try {
            const artifact = await loadSceneExtension(target, { aggregate, compiler, stored: true })
            if (
              artifact.manifest.ownerId !== ownerId
              || artifact.manifest.id !== extensionId
              || artifact.manifest.digest !== digest.name
            ) {
              extensions.push(invalidEntry('SCENE_EXTENSION_STORE_IDENTITY', fullIdentity))
              continue
            }
            extensions.push(Object.freeze({ ...summary(artifact, 'valid') }))
          } catch (error) {
            if (error?.code === 'SCENE_EXTENSION_LIST_BUDGET') {
              truncated = true
              break scan
            }
            extensions.push(invalidEntry(error?.code ?? 'SCENE_EXTENSION_STORE_CORRUPT', fullIdentity))
          }
        }
      }
    }
    const count = extensions.filter((entry) => entry.status === 'valid').length
    return Object.freeze({
      status: 'ok',
      runtimeMode: mode,
      count,
      invalidCount: extensions.length - count,
      truncated,
      extensions: Object.freeze(extensions),
    })
  })
}

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { serializeSceneExtensionDigestMaterial } from '../packages/toolkit/scene/scene-extension.js'

const repoRoot = path.resolve(import.meta.dirname, '..')
const BUDGETS = Object.freeze({
  maxDrawCalls: 64,
  maxObjects: 128,
  maxResources: 128,
  maxTextureBytes: 8 * 1024 * 1024,
  maxTriangles: 100_000,
  maxWorkingBytes: 16 * 1024 * 1024,
})
const DEFAULT_BODY = 'return null\n'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function extensionManifest(bodyBytes, overrides = {}) {
  const manifest = {
    contract: 'aos.scene.extension.v1',
    schemaVersion: 1,
    id: 'companion-renderer',
    ownerId: 'io.ch-osctrl.sigil',
    digest: '0'.repeat(64),
    sceneAbi: 'aos.scene.projection.v1',
    implementationIds: ['io.ch-osctrl.sigil.companion'],
    threeRevision: '183',
    budgets: { ...BUDGETS },
    ...overrides,
  }
  if (!Object.hasOwn(overrides, 'digest')) {
    manifest.digest = sha256(serializeSceneExtensionDigestMaterial(manifest, sha256(bodyBytes)))
  }
  return manifest
}

function authorizationFor(manifest) {
  return {
    contract: 'aos.scene.extension.authorization.v1',
    ownerId: manifest.ownerId,
    id: manifest.id,
    digest: manifest.digest,
    sceneAbi: manifest.sceneAbi,
    threeRevision: manifest.threeRevision,
  }
}

async function writeExtension(parent, {
  directoryName = 'extension',
  manifestBytes = null,
  manifestOverrides = {},
  bodyBytes = Buffer.from(DEFAULT_BODY),
} = {}) {
  const root = path.join(parent, directoryName)
  await mkdir(root, { mode: 0o700 })
  const manifest = extensionManifest(bodyBytes, manifestOverrides)
  await writeFile(path.join(root, 'extension.json'), manifestBytes ?? `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(root, 'projection.js'), bodyBytes)
  return { manifest, root }
}

function installArgs(fixture) {
  return ['extension', 'install', fixture.root, '--expected-digest', fixture.manifest.digest, '--json']
}

async function run(args, { mode = 'repo', stateRoot } = {}) {
  const child = spawn(process.execPath, ['scripts/aos-scene.mjs', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: mode,
      AOS_STATE_ROOT: stateRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { ...result, stderr, stdout }
}

function errorCode(result) {
  return JSON.parse(result.stderr).code
}

async function modeStore(stateRoot, mode = 'repo') {
  return path.join(await realpath(stateRoot), mode, 'scene-extensions')
}

test('scene extension validate is read-only and never invokes the projection factory', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-validate-'))
  const stateRoot = path.join(temp, 'state')
  const marker = 'TOP_LEVEL_EXECUTION_MUST_NOT_RUN'
  try {
    const bodyBytes = Buffer.from(`throw new Error('${marker}')\n`)
    const fixture = await writeExtension(temp, { bodyBytes })
    const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot })
    assert.equal(result.code, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.status, 'ok')
    assert.equal(output.contract, 'aos.scene.extension.v1')
    assert.equal(output.ownerId, fixture.manifest.ownerId)
    assert.equal(output.id, fixture.manifest.id)
    assert.equal(output.digest, fixture.manifest.digest)
    assert.equal(output.bodyBytes, bodyBytes.length)
    assert.doesNotMatch(result.stdout, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
    assert.doesNotMatch(result.stdout, new RegExp(marker, 'u'))
    assert.equal(await lstat(path.join(stateRoot, 'repo')).catch(() => null), null)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension install requires and verifies an explicit approved digest before store mutation', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-approval-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const missing = await run(['extension', 'install', fixture.root, '--json'], { stateRoot })
    assert.equal(missing.code, 1)
    assert.equal(errorCode(missing), 'MISSING_ARG')

    const mismatch = await run([
      'extension', 'install', fixture.root, '--expected-digest', 'f'.repeat(64), '--json',
    ], { stateRoot })
    assert.equal(mismatch.code, 1)
    assert.equal(errorCode(mismatch), 'SCENE_EXTENSION_APPROVAL_MISMATCH')
    assert.equal(await lstat(path.join(stateRoot, 'repo')).catch(() => null), null)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension install is atomic, owner-only, immutable, and byte-idempotent', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-install-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const first = await run(installArgs(fixture), { stateRoot })
    assert.equal(first.code, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).action, 'installed')
    assert.equal(JSON.parse(first.stdout).installed, true)
    assert.equal(Object.hasOwn(JSON.parse(first.stdout), 'durability'), false)

    const store = await modeStore(stateRoot)
    const target = path.join(store, fixture.manifest.ownerId, fixture.manifest.id, fixture.manifest.digest)
    for (const directory of [store, path.dirname(path.dirname(target)), path.dirname(target), target]) {
      assert.equal((await lstat(directory)).mode & 0o777, 0o700)
    }
    for (const file of ['authorization.json', 'extension.json', 'projection.js']) {
      assert.equal((await lstat(path.join(target, file))).mode & 0o777, 0o600)
    }
    assert.equal(
      await readFile(path.join(target, 'authorization.json'), 'utf8'),
      `${JSON.stringify(authorizationFor(fixture.manifest))}\n`,
    )
    assert.equal(await readFile(path.join(target, 'extension.json'), 'utf8'), `${JSON.stringify(fixture.manifest)}\n`)
    assert.deepEqual(await readFile(path.join(target, 'projection.js')), await readFile(path.join(fixture.root, 'projection.js')))

    const second = await run(installArgs(fixture), { stateRoot })
    assert.equal(second.code, 0, second.stderr)
    assert.equal(JSON.parse(second.stdout).action, 'already_installed')
    assert.equal(JSON.parse(second.stdout).installed, false)

    const originalManifest = await readFile(path.join(target, 'extension.json'))
    await writeFile(path.join(fixture.root, 'extension.json'), JSON.stringify(fixture.manifest))
    const reformatted = await run(installArgs(fixture), { stateRoot })
    assert.equal(reformatted.code, 0, reformatted.stderr)
    assert.equal(JSON.parse(reformatted.stdout).action, 'already_installed')
    assert.deepEqual(await readFile(path.join(target, 'extension.json')), originalManifest)

    await writeFile(path.join(fixture.root, 'extension.json'), JSON.stringify({
      ...fixture.manifest,
      budgets: { ...fixture.manifest.budgets, maxObjects: fixture.manifest.budgets.maxObjects - 1 },
    }))
    const changedAuthority = await run(installArgs(fixture), { stateRoot })
    assert.equal(changedAuthority.code, 1)
    assert.equal(errorCode(changedAuthority), 'SCENE_EXTENSION_DIGEST_MISMATCH')
    assert.deepEqual(await readFile(path.join(target, 'extension.json')), originalManifest)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('concurrent identical scene extension installs converge on one immutable directory', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-concurrent-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const results = await Promise.all([
      run(installArgs(fixture), { stateRoot }),
      run(installArgs(fixture), { stateRoot }),
    ])
    assert.ok(results.every((result) => result.code === 0), results.map((result) => result.stderr).join('\n'))
    assert.deepEqual(results.map((result) => JSON.parse(result.stdout).action).sort(), ['already_installed', 'installed'])
    const modeRoot = path.join(await realpath(stateRoot), 'repo')
    const entries = await readdir(modeRoot)
    assert.deepEqual(entries, ['scene-extensions'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension installation removes stale staging and bounds recent crash residue', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-staging-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const extensionRoot = path.join(
      stateRoot,
      'repo',
      'scene-extensions',
      fixture.manifest.ownerId,
      fixture.manifest.id,
    )
    await mkdir(extensionRoot, { mode: 0o700, recursive: true })
    for (const directory of [
      stateRoot,
      path.join(stateRoot, 'repo'),
      path.join(stateRoot, 'repo', 'scene-extensions'),
      path.join(stateRoot, 'repo', 'scene-extensions', fixture.manifest.ownerId),
      extensionRoot,
    ]) await chmod(directory, 0o700)

    const stale = path.join(extensionRoot, '.scene-extension-stage-stale')
    await mkdir(stale, { mode: 0o700 })
    await writeFile(path.join(stale, 'partial'), 'stale')
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(stale, old, old)
    const installed = await run(installArgs(fixture), { stateRoot })
    assert.equal(installed.code, 0, installed.stderr)
    assert.equal(await lstat(stale).catch(() => null), null)

    const secondFixture = await writeExtension(temp, {
      directoryName: 'second-extension',
      manifestOverrides: { id: 'second-renderer' },
    })
    const secondRoot = path.join(
      stateRoot,
      'repo',
      'scene-extensions',
      secondFixture.manifest.ownerId,
      secondFixture.manifest.id,
    )
    await mkdir(secondRoot, { mode: 0o700, recursive: true })
    await chmod(secondRoot, 0o700)
    for (let index = 0; index < 64; index += 1) {
      await mkdir(path.join(secondRoot, `.scene-extension-stage-${index}`), { mode: 0o700 })
    }
    const bounded = await run(installArgs(secondFixture), { stateRoot })
    assert.equal(bounded.code, 1)
    assert.equal(errorCode(bounded), 'SCENE_EXTENSION_STAGING_CAPACITY')
    assert.doesNotMatch(bounded.stderr, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension storage respects the installed runtime mode and list is read-only', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-mode-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const empty = await run(['extension', 'list', '--json'], { mode: 'installed', stateRoot })
    assert.equal(empty.code, 0, empty.stderr)
    assert.deepEqual(JSON.parse(empty.stdout), {
      status: 'ok', runtimeMode: 'installed', count: 0, invalidCount: 0, truncated: false, extensions: [],
    })
    assert.equal(await lstat(path.join(stateRoot, 'installed')).catch(() => null), null)

    const installed = await run(installArgs(fixture), { mode: 'installed', stateRoot })
    assert.equal(installed.code, 0, installed.stderr)
    const listing = await run(['extension', 'list', '--json'], { mode: 'installed', stateRoot })
    assert.equal(listing.code, 0, listing.stderr)
    const output = JSON.parse(listing.stdout)
    assert.equal(output.runtimeMode, 'installed')
    assert.equal(output.count, 1)
    assert.equal(output.invalidCount, 0)
    assert.equal(output.extensions[0].status, 'valid')
    assert.equal(output.extensions[0].digest, fixture.manifest.digest)
    assert.equal(await lstat(path.join(stateRoot, 'repo')).catch(() => null), null)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension validation rejects digest drift, unsafe manifests, encoding, and byte-limit violations', async (t) => {
  const cases = [
    {
      name: 'digest drift',
      code: 'SCENE_EXTENSION_DIGEST_MISMATCH',
      mutate: async ({ root }) => writeFile(path.join(root, 'projection.js'), `${DEFAULT_BODY}\n`),
    },
    {
      name: 'unsafe owner path segment',
      code: 'SCENE_EXTENSION_MANIFEST_INVALID',
      fixture: {
        manifestOverrides: {
          ownerId: 'io.ch-osctrl//sigil',
          implementationIds: ['io.ch-osctrl//sigil.companion'],
          digest: '0'.repeat(64),
        },
      },
    },
    {
      name: 'malformed manifest',
      code: 'SCENE_EXTENSION_MANIFEST_JSON',
      fixture: { manifestBytes: '{' },
    },
    {
      name: 'manifest invalid UTF-8',
      code: 'SCENE_EXTENSION_MANIFEST_ENCODING',
      fixture: { manifestBytes: Buffer.from([0xff]) },
    },
    {
      name: 'factory body invalid UTF-8',
      code: 'SCENE_EXTENSION_BODY_ENCODING',
      fixture: { bodyBytes: Buffer.from([0xff]) },
    },
    {
      name: 'manifest exceeds 64 KiB',
      code: 'SCENE_EXTENSION_FILE_SIZE',
      fixture: { manifestBytes: Buffer.alloc(64 * 1024 + 1, 0x20) },
    },
    {
      name: 'factory body exceeds 4 MiB',
      code: 'SCENE_EXTENSION_FILE_SIZE',
      fixture: { bodyBytes: Buffer.alloc(4 * 1024 * 1024 + 1, 0x20) },
    },
  ]
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-invalid-'))
      try {
        const fixture = await writeExtension(temp, entry.fixture)
        await entry.mutate?.(fixture)
        const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
        assert.equal(result.code, 1)
        assert.equal(errorCode(result), entry.code)
        assert.doesNotMatch(result.stderr, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
        assert.equal(result.stdout, '')
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    })
  }
})

test('scene extension validation rejects links, extra files, special files, and linked roots', async (t) => {
  await t.test('symbolic link payload', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-link-'))
    try {
      const fixture = await writeExtension(temp)
      await rm(path.join(fixture.root, 'projection.js'))
      await symlink(path.join(fixture.root, 'extension.json'), path.join(fixture.root, 'projection.js'))
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_LINK')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  await t.test('extra file', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-extra-'))
    try {
      const fixture = await writeExtension(temp)
      await writeFile(path.join(fixture.root, 'extra.txt'), 'not allowed')
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_EXTRA_FILE')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  await t.test('non-regular entry', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-special-'))
    try {
      const fixture = await writeExtension(temp)
      await mkdir(path.join(fixture.root, 'nested'))
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_SPECIAL_FILE')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  await t.test('linked root', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-root-link-'))
    try {
      const fixture = await writeExtension(temp)
      const linked = path.join(temp, 'linked-extension')
      await symlink(fixture.root, linked)
      const result = await run(['extension', 'validate', linked, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_LINK')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  await t.test('group-writable source root', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-root-mode-'))
    try {
      const fixture = await writeExtension(temp)
      await chmod(fixture.root, 0o770)
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_SOURCE_PERMISSIONS')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  await t.test('world-writable source file', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-file-mode-'))
    try {
      const fixture = await writeExtension(temp)
      await chmod(path.join(fixture.root, 'projection.js'), 0o666)
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(errorCode(result), 'SCENE_EXTENSION_SOURCE_PERMISSIONS')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})

test('scene extension validation compiles a factory body without executing it', async (t) => {
  const cases = [
    ['static import declaration', "import fs from 'node:fs'\nreturn fs", 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['export declaration', 'export default null\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['invalid syntax', 'if ( {\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['module-scope brace escape', '}\nglobalThis.sceneExtensionEscaped = true\nfunction reopened(context) {\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['sloppy-only with statement', 'with ({ value: null }) { return value }\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['top-level await', 'await new Promise(() => {})\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
    ['import meta', 'return import.meta.url\n', 'SCENE_EXTENSION_BODY_SYNTAX'],
  ]
  for (const [name, source, code] of cases) {
    await t.test(name, async () => {
      const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-module-'))
      try {
        const fixture = await writeExtension(temp, { bodyBytes: Buffer.from(source) })
        const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
        assert.equal(result.code, 1)
        assert.equal(errorCode(result), code)
        assert.doesNotMatch(result.stderr, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    })
  }

  await t.test('trusted runtime syntax is accepted without execution or custom token scanning', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-inert-import-'))
    try {
      const source = `const pattern = /import()/\nconst endpoint = 'https://example.invalid/runtime'\n//# sourceURL=projection.js\nreturn { pattern, endpoint }\n`
      const fixture = await writeExtension(temp, { bodyBytes: Buffer.from(source) })
      const result = await run(['extension', 'validate', fixture.root, '--json'], { stateRoot: path.join(temp, 'state') })
      assert.equal(result.code, 0, result.stderr)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})

test('scene extension list revalidates stored bytes and reports corruption without paths or source', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-corrupt-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const fixture = await writeExtension(temp)
    const installed = await run(installArgs(fixture), { stateRoot })
    assert.equal(installed.code, 0, installed.stderr)
    const store = await modeStore(stateRoot)
    const target = path.join(store, fixture.manifest.ownerId, fixture.manifest.id, fixture.manifest.digest)
    const secret = 'CORRUPT_SOURCE_MUST_NOT_LEAK'
    await writeFile(path.join(target, 'projection.js'), `${DEFAULT_BODY}// ${secret}\n`)

    const malformed = await writeExtension(temp, {
      directoryName: 'malformed-stored',
      bodyBytes: Buffer.from('if ({'),
    })
    const malformedTarget = path.join(store, malformed.manifest.ownerId, malformed.manifest.id, malformed.manifest.digest)
    await mkdir(malformedTarget, { recursive: true, mode: 0o700 })
    await chmod(malformedTarget, 0o700)
    await writeFile(path.join(malformedTarget, 'extension.json'), await readFile(path.join(malformed.root, 'extension.json')), { mode: 0o600 })
    await writeFile(path.join(malformedTarget, 'projection.js'), await readFile(path.join(malformed.root, 'projection.js')), { mode: 0o600 })
    await writeFile(
      path.join(malformedTarget, 'authorization.json'),
      `${JSON.stringify(authorizationFor(malformed.manifest))}\n`,
      { mode: 0o600 },
    )

    const listing = await run(['extension', 'list', '--json'], { stateRoot })
    assert.equal(listing.code, 0, listing.stderr)
    const output = JSON.parse(listing.stdout)
    assert.equal(output.count, 0)
    assert.equal(output.invalidCount, 2)
    assert.ok(output.extensions.every((entry) => entry.status === 'invalid'))
    assert.deepEqual(
      output.extensions.map((entry) => entry.code).sort(),
      ['SCENE_EXTENSION_BODY_SYNTAX', 'SCENE_EXTENSION_DIGEST_MISMATCH'],
    )
    assert.doesNotMatch(listing.stdout, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
    assert.doesNotMatch(listing.stdout, new RegExp(secret, 'u'))

    const retry = await run(installArgs(fixture), { stateRoot })
    assert.equal(retry.code, 1)
    assert.equal(errorCode(retry), 'SCENE_EXTENSION_DIGEST_MISMATCH')
    assert.match(await readFile(path.join(target, 'projection.js'), 'utf8'), new RegExp(secret, 'u'))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension listing rejects missing and mismatched installation authorization', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-authorization-'))
  const stateRoot = path.join(temp, 'state')
  try {
    const first = await writeExtension(temp, { directoryName: 'first' })
    const second = await writeExtension(temp, {
      directoryName: 'second',
      manifestOverrides: { id: 'second-renderer' },
    })
    for (const fixture of [first, second]) {
      const installed = await run(installArgs(fixture), { stateRoot })
      assert.equal(installed.code, 0, installed.stderr)
    }
    const store = await modeStore(stateRoot)
    const firstTarget = path.join(store, first.manifest.ownerId, first.manifest.id, first.manifest.digest)
    const secondTarget = path.join(store, second.manifest.ownerId, second.manifest.id, second.manifest.digest)
    await rm(path.join(firstTarget, 'authorization.json'))
    await writeFile(
      path.join(secondTarget, 'authorization.json'),
      `${JSON.stringify({ ...authorizationFor(second.manifest), ownerId: 'io.ch-osctrl.other' })}\n`,
      { mode: 0o600 },
    )

    const listing = await run(['extension', 'list', '--json'], { stateRoot })
    assert.equal(listing.code, 0, listing.stderr)
    const output = JSON.parse(listing.stdout)
    assert.equal(output.count, 0)
    assert.equal(output.invalidCount, 2)
    assert.deepEqual(
      output.extensions.map((entry) => entry.code),
      ['SCENE_EXTENSION_NOT_AUTHORIZED', 'SCENE_EXTENSION_NOT_AUTHORIZED'],
    )
    assert.doesNotMatch(listing.stdout, new RegExp(temp.replaceAll('/', '\\/'), 'u'))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension list output is bounded when the store contains excess corrupt entries', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-list-bound-'))
  const stateRoot = path.join(temp, 'state')
  const store = path.join(stateRoot, 'repo', 'scene-extensions')
  try {
    await mkdir(store, { recursive: true, mode: 0o700 })
    await chmod(path.join(stateRoot, 'repo'), 0o700)
    await chmod(store, 0o700)
    await Promise.all(Array.from({ length: 257 }, (_, index) => writeFile(path.join(store, `invalid-${index}`), '', { mode: 0o600 })))
    const listing = await run(['extension', 'list', '--json'], { stateRoot })
    assert.equal(listing.code, 0, listing.stderr)
    const output = JSON.parse(listing.stdout)
    assert.equal(output.count, 0)
    assert.equal(output.invalidCount, 256)
    assert.equal(output.extensions.length, 256)
    assert.equal(output.truncated, true)
    assert.ok(output.extensions.every((entry) => entry.status === 'invalid'))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('scene extension CLI rejects unknown forms and missing machine-readable mode before filesystem work', async () => {
  const stateRoot = path.join(os.tmpdir(), 'must-not-create-scene-extension-store')
  for (const [args, code] of [
    [['extension', 'remove', 'anything', '--json'], 'UNKNOWN_SUBCOMMAND'],
    [['extension', 'validate', '/does/not/exist'], 'MISSING_ARG'],
    [['extension', 'install', '/does/not/exist', '--json'], 'MISSING_ARG'],
    [['extension', 'install', '/does/not/exist', '--expected-digest', 'nope', '--json'], 'INVALID_DIGEST'],
    [['extension', 'install', '/does/not/exist', '--unsafe', '--json'], 'UNKNOWN_FLAG'],
    [['extension', 'list', 'extra', '--json'], 'UNKNOWN_ARG'],
    [['extension', 'list', '--json', '--json'], 'DUPLICATE_FLAG'],
  ]) {
    const result = await run(args, { stateRoot })
    assert.equal(result.code, 1)
    assert.equal(errorCode(result), code)
    assert.equal(result.stdout, '')
  }
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const exampleRoot = path.join(repoRoot, 'packages/toolkit/scene/examples')

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

test('scene cartridge CLI validates every neutral sample without daemon access', async () => {
  for (const name of ['aim-and-commit', 'conventional-drag', 'radial-menu', 'spinning-object']) {
    const result = await run(['cartridge', 'validate', path.join(exampleRoot, name), '--json'])
    assert.equal(result.code, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.status, 'ok')
    assert.equal(summary.id, `samples/${name}`)
    assert.match(summary.digest, /^[a-f0-9]{64}$/u)
    assert.doesNotMatch(result.stdout, new RegExp(repoRoot.replaceAll('/', '\\/'), 'u'))
  }
})

test('scene cartridge CLI fails closed on digest drift and does not echo content or local paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-cartridge-drift-'))
  try {
    await cp(path.join(exampleRoot, 'spinning-object'), root, { recursive: true })
    await writeFile(path.join(root, 'scene.json'), `${await readFile(path.join(root, 'scene.json'), 'utf8')}\n`)
    const result = await run(['cartridge', 'validate', root, '--json'])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /SCENE_CARTRIDGE_DIGEST/u)
    assert.doesNotMatch(result.stderr, new RegExp(root.replaceAll('/', '\\/'), 'u'))
    assert.doesNotMatch(result.stderr, /spinning-object/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scene cartridge CLI rejects undeclared files and symbolic links', async () => {
  const undeclared = await mkdtemp(path.join(os.tmpdir(), 'aos-cartridge-extra-'))
  const linked = await mkdtemp(path.join(os.tmpdir(), 'aos-cartridge-link-'))
  try {
    await cp(path.join(exampleRoot, 'conventional-drag'), undeclared, { recursive: true })
    await writeFile(path.join(undeclared, 'extra.json'), '{}')
    const extraResult = await run(['cartridge', 'validate', undeclared, '--json'])
    assert.equal(extraResult.code, 1)
    assert.match(extraResult.stderr, /SCENE_CARTRIDGE_UNDECLARED_FILE/u)

    await cp(path.join(exampleRoot, 'conventional-drag'), linked, { recursive: true })
    await symlink(path.join(linked, 'scene.json'), path.join(linked, 'linked.json'))
    const linkResult = await run(['cartridge', 'validate', linked, '--json'])
    assert.equal(linkResult.code, 1)
    assert.match(linkResult.stderr, /SCENE_CARTRIDGE_LINK/u)
  } finally {
    await rm(undeclared, { recursive: true, force: true })
    await rm(linked, { recursive: true, force: true })
  }
})

test('scene cartridge CLI rejects unknown subcommands and flags before filesystem work', async () => {
  const unknown = await run(['cartridge', 'install', '/does/not/exist', '--json'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /UNKNOWN_SUBCOMMAND/u)

  const flag = await run(['cartridge', 'validate', '/does/not/exist', '--unsafe'])
  assert.equal(flag.code, 1)
  assert.match(flag.stderr, /UNKNOWN_FLAG/u)
})

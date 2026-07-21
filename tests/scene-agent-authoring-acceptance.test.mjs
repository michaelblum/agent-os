import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, AOS_STATE_ROOT: path.join(os.tmpdir(), 'must-not-connect') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return { ...result, stderr, stdout }
}

function assertOk(result, label) {
  assert.equal(result.signal, null, `${label} received ${result.signal}`)
  assert.equal(result.code, 0, `${label}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

test('documented agent route works from an empty directory without live AOS', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-agent-acceptance-'))
  const cartridge = path.join(parent, 'companion')
  const extension = path.join(parent, 'renderer')
  try {
    const cartridgeCreated = assertOk(await runNode([
      'scripts/aos-scene.mjs', 'cartridge', 'scaffold', cartridge,
      '--id', 'companion/main', '--template', 'aim-and-commit', '--json',
    ]), 'cartridge scaffold')
    const cartridgeValidated = assertOk(await runNode([
      'scripts/aos-scene.mjs', 'cartridge', 'validate', cartridge, '--json',
    ]), 'cartridge validate')
    assert.equal(cartridgeValidated.digest, cartridgeCreated.digest)

    const extensionCreated = assertOk(await runNode([
      'scripts/aos-scene.mjs', 'extension', 'scaffold', extension,
      '--owner', 'example.consumer', '--id', 'companion-renderer',
      '--template', 'basic-three', '--json',
    ]), 'extension scaffold')
    const extensionValidated = assertOk(await runNode([
      'scripts/aos-scene.mjs', 'extension', 'validate', extension, '--json',
    ]), 'extension validate')
    assert.equal(extensionValidated.digest, extensionCreated.digest)

    const session = assertOk(await runNode([
      'packages/toolkit/scene/examples/session-lifecycle.mjs',
      '--cartridge', cartridge,
    ]), 'scene session example')
    assert.deepEqual(session, {
      status: 'ok',
      cartridgeDigest: cartridgeCreated.digest,
      committedRevision: 2,
      generation: 2,
      recoveryAttempts: 1,
      remounts: 1,
      staleEventsIgnored: true,
      uncertainOperationsReplayed: false,
      replay: {
        events: 3,
        resources: ['companion/main'],
        completedGestures: 1,
      },
      closed: true,
    })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
  await assert.rejects(access(parent))
})

test('authoring skill contains exact routes without placeholders or private transport instructions', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/aos-desktop-world-authoring/SKILL.md'), 'utf8')
  for (const command of [
    'aos scene cartridge scaffold ./scene-work/companion',
    'aos scene cartridge validate ./scene-work/companion --json',
    'aos scene extension scaffold ./scene-work/renderer',
    'aos scene extension validate ./scene-work/renderer --json',
    'node packages/toolkit/scene/examples/session-lifecycle.mjs',
    'aos scene inspect --resource companion/main --json',
    'aos scene perf --resource companion/main --json',
    'aos scene replay',
    'aos scene devtools close --session "$session_id" --json',
  ]) {
    assert.match(skill, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(skill, /\{\.\.\.\}/u)
  assert.doesNotMatch(skill, /<[a-z][a-z0-9_-]*>/iu)
  assert.doesNotMatch(skill, /AOS_STATE_ROOT|net\.connect|\/sock\b/u)
  assert.doesNotMatch(skill, /roadmap|future status-item|dependent visual slice/iu)
})

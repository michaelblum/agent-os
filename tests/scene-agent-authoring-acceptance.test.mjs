import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function runProcess(executable, args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(executable, args, {
    cwd,
    env: {
      ...process.env,
      AOS_STATE_ROOT: path.join(os.tmpdir(), 'must-not-connect'),
      ...env,
    },
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

async function runNode(args) {
  return runProcess(process.execPath, args)
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

test('public scene scaffold dispatch preserves an empty consumer workspace as cwd', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-public-dispatch-'))
  const workspace = path.join(parent, 'workspace')
  const dispatcher = path.join(parent, 'aos-scene-dispatch-test')
  const main = path.join(parent, 'main.swift')
  await mkdir(workspace, { mode: 0o700 })
  await writeFile(main, `
import Darwin
import Foundation

struct ProcessOutput {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

enum AOSRuntimeMode: String { case repo }

func aosCurrentRepoRoot() -> String? {
    ProcessInfo.processInfo.environment["TEST_AOS_REPO_ROOT"]
}
func aosCurrentRuntimeMode() -> AOSRuntimeMode { .repo }
func aosStateRoot() -> String { "/private/tmp/aos-scene-public-dispatch-state" }
func aosCurrentSessionKey() -> String { "scene-public-dispatch" }
func aosCurrentSessionHarness() -> String { "node-test" }
func aosInvocationDisplayName() -> String { "aos" }
func exitError(_ message: String, code: String) -> Never {
    FileHandle.standardError.write(Data("\\(code): \\(message)\\n".utf8))
    exit(1)
}

if !runExternalCommandIfMatched(args: Array(CommandLine.arguments.dropFirst())) {
    exit(64)
}
`)

  try {
    const compiled = await runProcess('/usr/bin/swiftc', [
      path.join(repoRoot, 'src/shared/external-command-dispatch.swift'),
      main,
      '-o', dispatcher,
    ], {
      env: {
        CLANG_MODULE_CACHE_PATH: path.join(parent, 'clang-module-cache'),
        SWIFT_MODULECACHE_PATH: path.join(parent, 'swift-module-cache'),
      },
    })
    assert.equal(compiled.code, 0, compiled.stderr)

    const cartridge = await runProcess(dispatcher, [
      'scene', 'cartridge', 'scaffold', './companion',
      '--id', 'companion/main', '--template', 'aim-and-commit', '--json',
    ], {
      cwd: workspace,
      env: { TEST_AOS_REPO_ROOT: repoRoot },
    })
    assertOk(cartridge, 'public cartridge scaffold')
    await access(path.join(workspace, 'companion', 'cartridge.json'))

    const extension = await runProcess(dispatcher, [
      'scene', 'extension', 'scaffold', './renderer',
      '--owner', 'example.consumer', '--id', 'companion-renderer',
      '--template', 'basic-three', '--json',
    ], {
      cwd: workspace,
      env: { TEST_AOS_REPO_ROOT: repoRoot },
    })
    assertOk(extension, 'public extension scaffold')
    await access(path.join(workspace, 'renderer', 'extension.json'))
    await assert.rejects(access(path.join(workspace, 'scripts', 'aos-scene.mjs')))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
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

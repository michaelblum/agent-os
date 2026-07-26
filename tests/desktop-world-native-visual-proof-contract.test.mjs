import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'tests/manual/desktop-world-native-visual-proof.swift')
const runnerPath = path.join(root, 'tests/manual/desktop-world-native-visual-proof.sh')

test('native visual proof typechecks without executing ScreenCaptureKit', () => {
  execFileSync('zsh', [runnerPath, '--typecheck'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 30_000,
  })
})

test('native visual proof is bounded, content-free, and explicitly live', () => {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const runner = fs.readFileSync(runnerPath, 'utf8')

  assert.match(source, /SCScreenshotManager\.captureImage/u)
  assert.match(source, /configuration\.sourceRect = sourceRect/u)
  assert.match(source, /window\.ignoresMouseEvents = true/u)
  assert.match(source, /pixels_persisted["']:\s*false/u)
  assert.match(source, /captureAttemptLimit = 8/u)
  assert.match(source, /maximumDisplayCount = 8/u)
  assert.match(source, /maximumMarkerPixelDimension = 512/u)
  assert.match(source, /sourcePointSize/u)
  assert.match(source, /cleanup_complete["']:\s*retainedWindowCount == 0/u)
  assert.match(source, /surfaces\.removeAll\(keepingCapacity: false\)/u)
  assert.doesNotMatch(source, /pngData|jpegData|write\(to:|CGImageDestination/u)
  assert.match(runner, /AOS_NATIVE_VISUAL_PROOF_OK/u)
  assert.match(runner, /run_with_deadline 500 "\$BINARY"/u)
  assert.match(runner, /trap 'exit 130' INT/u)
  assert.match(runner, /trap 'exit 143' TERM/u)
  assert.match(runner, /stop_owned_pid "\$BINARY_PID"/u)
  assert.match(runner, /kill -TERM "\$pid"/u)
  assert.match(runner, /kill -KILL "\$pid"/u)
  assert.match(runner, /"error_code":"PROOF_TIMEOUT"/u)
  assert.match(runner, /mktemp -d/u)
  assert.match(runner, /rm -rf "\$TMP_ROOT"/u)
  assert.doesNotMatch(runner, /\.\/aos|build\.sh|tccutil/u)
})

test('native visual proof external watchdog terminates only its owned child', () => {
  const startedAt = Date.now()
  const result = spawnSync('zsh', [runnerPath, '--timeout-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  })

  assert.equal(result.status, 124)
  assert.ok(Date.now() - startedAt < 2_000)
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.deepEqual(payload, {
    cleanup_complete: true,
    error_code: 'PROOF_TIMEOUT',
    pixels_persisted: false,
    process_exited: true,
    status: 'failed',
  })

  const cleanup = spawnSync('zsh', [runnerPath, '--cleanup-self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  })
  assert.equal(cleanup.status, 0)
  assert.deepEqual(JSON.parse(cleanup.stdout.trim()), {
    owned_child_reaped: true,
    status: 'passed',
  })
})

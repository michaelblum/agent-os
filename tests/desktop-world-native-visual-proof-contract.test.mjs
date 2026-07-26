import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
  assert.match(source, /surfaces\.removeAll\(keepingCapacity: false\)/u)
  assert.doesNotMatch(source, /pngData|jpegData|write\(to:|CGImageDestination/u)
  assert.match(runner, /AOS_NATIVE_VISUAL_PROOF_OK/u)
  assert.match(runner, /mktemp -d/u)
  assert.match(runner, /rm -rf "\$TMP_ROOT"/u)
  assert.doesNotMatch(runner, /\.\/aos|build\.sh|tccutil/u)
})

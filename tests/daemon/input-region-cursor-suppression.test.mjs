import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const registryPath = new URL('../../src/daemon/input-surface-ownership.swift', import.meta.url)
const daemonPath = new URL('../../src/daemon/unified.swift', import.meta.url)

function swiftFunctionBody(source, signature) {
  const signatureIndex = source.indexOf(signature)
  assert.notEqual(signatureIndex, -1, `${signature} should exist`)
  const openBraceIndex = source.indexOf('{', signatureIndex)
  assert.notEqual(openBraceIndex, -1, `${signature} should have a body`)

  let depth = 0
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index)
      }
    }
  }
  assert.fail(`${signature} body should close`)
}

test('input-region native cursor suppression reconciler balances process-level hide/show lifecycle', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-cursor-suppression-'))
  const mainPath = path.join(tmp, 'main.swift')
  const binPath = path.join(tmp, 'test-cursor-suppression')
  fs.writeFileSync(mainPath, `
import Foundation
import CoreGraphics

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \\(message)\\n", stderr)
        exit(1)
    }
}

let reconciler = AOSNativeCursorSuppressionReconciler()

let first = reconciler.reconcile(active: true)
assert(first.hideNativeCursor == true, "first suppressing region hides the process cursor exactly once")
assert(first.showNativeCursor == false, "first suppressing region must not show")
assert(first.active == true, "suppression should be active")

let second = reconciler.reconcile(active: true)
assert(second.hideNativeCursor == false, "adding/updating another suppressing region must not double-hide")
assert(second.showNativeCursor == false, "unchanged suppression must not show")
assert(second.active == true, "unchanged suppression remains active")

let displayChanged = reconciler.reconcile(active: true)
assert(displayChanged.hideNativeCursor == false, "display reconfiguration while active must not double-hide")
assert(displayChanged.showNativeCursor == false, "display reconfiguration while active must not restore")
assert(displayChanged.active == true, "display reconfiguration keeps process suppression active")

let cleared = reconciler.reconcile(active: false)
assert(cleared.hideNativeCursor == false, "removing the last suppressing region must not hide")
assert(cleared.showNativeCursor == true, "removing the last suppressing region restores once")
assert(cleared.active == false, "cleanup leaves suppression inactive")

let ownerCleanup = reconciler.reconcile(active: true)
assert(ownerCleanup.hideNativeCursor == true, "owner setup hides once")
let ownerCleared = reconciler.restore()
assert(ownerCleared.showNativeCursor == true, "owner cleanup follows the same reconciliation path")
let restoredAgain = reconciler.restore()
assert(restoredAgain.showNativeCursor == false, "repeated cleanup is idempotent")

print("PASS cursor suppression reconciler lifecycle")
`)

  try {
    const compile = spawnSync('swiftc', [registryPath.pathname, mainPath, '-o', binPath], {
      encoding: 'utf8',
    })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binPath, [], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS cursor suppression reconciler lifecycle/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('input-region native cursor suppression is wired to region lifecycle', () => {
  const registrySource = fs.readFileSync(registryPath, 'utf8')
  const daemonSource = fs.readFileSync(daemonPath, 'utf8')
  const displayChangeBody = swiftFunctionBody(daemonSource, 'private func scheduleDisplayGeometryBroadcast()')
  const displayReconcileBody = swiftFunctionBody(
    daemonSource,
    'private func reconcileNativeCursorSuppressionAfterDisplayGeometryChange()',
  )

  assert.match(registrySource, /func nativeCursorSuppressionActive\(\) -> Bool/)
  assert.match(registrySource, /metadata\["cursor_suppression"\]/)
  assert.match(daemonSource, /reconcileNativeCursorSuppression\(active: cursorSuppressionActive\)/)
  assert.doesNotMatch(daemonSource, /activeDisplayIDsForCursorSuppression/)
  assert.doesNotMatch(daemonSource, /CGGetActiveDisplayList/)
  assert.match(registrySource, /final class AOSNativeCursorSuppressionReconciler/)
  assert.match(daemonSource, /nativeCursorSuppressionReconciler\.reconcile\(active: active\)/)
  assert.match(daemonSource, /if result\.hideNativeCursor[\s\S]*CGDisplayHideCursor\(CGMainDisplayID\(\)\)/)
  assert.match(daemonSource, /if result\.showNativeCursor[\s\S]*CGDisplayShowCursor\(CGMainDisplayID\(\)\)/)
  assert.match(daemonSource, /removeInputRegionsOwned[\s\S]*nativeCursorSuppressionActive\(\)/)
  assert.match(daemonSource, /func shutdown\(\)[\s\S]*restoreNativeCursorSuppressionForExit\(\)/)
  assert.match(daemonSource, /setupSignalHandlers\(\)[\s\S]*aosRestoreNativeCursorSuppressionForSignalExit\(\)/)
  assert.match(displayChangeBody, /retargetTrackedCanvases\(\)[\s\S]*syncCanvasFrames\(excluding: retargeted\)[\s\S]*broadcastDisplayGeometry\(\)/)
  assert.match(displayChangeBody, /broadcastDisplayGeometry\(\)[\s\S]*reconcileNativeCursorSuppressionAfterDisplayGeometryChange\(\)/)
  assert.match(displayReconcileBody, /inputRegions\.nativeCursorSuppressionActive\(\)/)
  assert.match(displayReconcileBody, /guard cursorSuppressionActive else \{ return \}/)
  assert.match(displayReconcileBody, /reconcileNativeCursorSuppression\(active: cursorSuppressionActive\)/)
})

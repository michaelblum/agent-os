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

test('input-region native cursor suppression reconciler balances hide/show lifecycle', () => {
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

let first = reconciler.reconcile(activeDisplayIDs: [1001, 1002])
assert(first.hideDisplayIDs == [1001, 1002], "first suppressing region hides every active display exactly once")
assert(first.showDisplayIDs.isEmpty, "first suppressing region must not show displays")
assert(first.suppressedDisplayIDs == [1001, 1002], "suppressed displays should be tracked")

let second = reconciler.reconcile(activeDisplayIDs: [1001, 1002])
assert(second.hideDisplayIDs.isEmpty, "adding/updating another suppressing region must not double-hide")
assert(second.showDisplayIDs.isEmpty, "unchanged suppression must not show")
assert(second.suppressedDisplayIDs == [1001, 1002], "unchanged suppression keeps both displays")

let stillActive = reconciler.reconcile(activeDisplayIDs: [1001, 1002])
assert(stillActive.hideDisplayIDs.isEmpty, "removing one of multiple suppressing regions keeps suppression active")
assert(stillActive.showDisplayIDs.isEmpty, "removing one of multiple suppressing regions must not restore")

let displayChanged = reconciler.reconcile(activeDisplayIDs: [1002, 1003])
assert(displayChanged.hideDisplayIDs == [1003], "newly covered active display should hide once")
assert(displayChanged.showDisplayIDs == [1001], "display no longer covered should restore once")
assert(displayChanged.suppressedDisplayIDs == [1002, 1003], "display set should update exactly")

let cleared = reconciler.reconcile(activeDisplayIDs: [])
assert(cleared.hideDisplayIDs.isEmpty, "removing the last suppressing region must not hide")
assert(cleared.showDisplayIDs == [1002, 1003], "removing the last suppressing region restores exactly hidden displays")
assert(cleared.suppressedDisplayIDs.isEmpty, "cleanup leaves no hidden displays")

let ownerCleanup = reconciler.reconcile(activeDisplayIDs: [2001, 2002])
assert(ownerCleanup.hideDisplayIDs == [2001, 2002], "owner setup hides displays")
let ownerCleared = reconciler.reconcile(activeDisplayIDs: [])
assert(ownerCleared.showDisplayIDs == [2001, 2002], "owner cleanup follows the same reconciliation path")

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
  assert.match(daemonSource, /activeDisplayIDsForCursorSuppression\(\) -> \[CGDirectDisplayID\]/)
  assert.match(daemonSource, /CGGetActiveDisplayList/)
  assert.match(registrySource, /final class AOSNativeCursorSuppressionReconciler/)
  assert.match(daemonSource, /nativeCursorSuppressionReconciler\.reconcile\(activeDisplayIDs: activeDisplayIDs\)/)
  assert.match(daemonSource, /for display in result\.hideDisplayIDs[\s\S]*CGDisplayHideCursor\(display\)/)
  assert.match(daemonSource, /for display in result\.showDisplayIDs[\s\S]*CGDisplayShowCursor\(display\)/)
  assert.doesNotMatch(daemonSource, /CGDisplayHideCursor\(CGMainDisplayID\(\)\)/)
  assert.doesNotMatch(daemonSource, /CGDisplayShowCursor\(CGMainDisplayID\(\)\)/)
  assert.match(daemonSource, /removeInputRegionsOwned[\s\S]*nativeCursorSuppressionActive\(\)/)
  assert.match(displayChangeBody, /retargetTrackedCanvases\(\)[\s\S]*syncCanvasFrames\(excluding: retargeted\)[\s\S]*broadcastDisplayGeometry\(\)/)
  assert.match(displayChangeBody, /broadcastDisplayGeometry\(\)[\s\S]*reconcileNativeCursorSuppressionAfterDisplayGeometryChange\(\)/)
  assert.match(displayReconcileBody, /inputRegions\.nativeCursorSuppressionActive\(\)/)
  assert.match(displayReconcileBody, /guard cursorSuppressionActive else \{ return \}/)
  assert.match(displayReconcileBody, /reconcileNativeCursorSuppression\(active: cursorSuppressionActive\)/)
})

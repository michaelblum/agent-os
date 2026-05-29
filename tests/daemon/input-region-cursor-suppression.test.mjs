import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('input-region native cursor suppression is tied to region lifecycle', () => {
  const registrySource = fs.readFileSync(new URL('../../src/daemon/input-surface-ownership.swift', import.meta.url), 'utf8')
  const daemonSource = fs.readFileSync(new URL('../../src/daemon/unified.swift', import.meta.url), 'utf8')

  assert.match(registrySource, /func nativeCursorSuppressionActive\(\) -> Bool/)
  assert.match(registrySource, /metadata\["cursor_suppression"\]/)
  assert.match(daemonSource, /reconcileNativeCursorSuppression\(active: cursorSuppressionActive\)/)
  assert.match(daemonSource, /activeDisplayIDsForCursorSuppression\(\) -> \[CGDirectDisplayID\]/)
  assert.match(daemonSource, /CGGetActiveDisplayList/)
  assert.match(daemonSource, /nativeCursorSuppressedDisplayIDs/)
  assert.match(daemonSource, /for display in displays[\s\S]*CGDisplayHideCursor\(display\)/)
  assert.match(daemonSource, /for display in displays[\s\S]*CGDisplayShowCursor\(display\)/)
  assert.doesNotMatch(daemonSource, /CGDisplayHideCursor\(CGMainDisplayID\(\)\)/)
  assert.doesNotMatch(daemonSource, /CGDisplayShowCursor\(CGMainDisplayID\(\)\)/)
  assert.match(daemonSource, /removeInputRegionsOwned[\s\S]*nativeCursorSuppressionActive\(\)/)
})

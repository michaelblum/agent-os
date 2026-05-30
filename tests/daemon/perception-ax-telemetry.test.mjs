import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const daemonPath = new URL('../../src/perceive/daemon.swift', import.meta.url)
const axPath = new URL('../../src/perceive/ax.swift', import.meta.url)

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
      if (depth === 0) return source.slice(openBraceIndex + 1, index)
    }
  }
  assert.fail(`${signature} body should close`)
}

test('AX cursor telemetry emits for same-role elements with different identity evidence', () => {
  const source = fs.readFileSync(daemonPath, 'utf8')
  const signatureBody = swiftFunctionBody(source, 'func axElementTelemetrySignature(_ hit: AXHitResult) -> String')
  const queryBody = swiftFunctionBody(source, 'private func queryAXElementAtCursor(_ point: CGPoint)')
  const tapBody = swiftFunctionBody(source, 'private func handleTapEvent(_ event: CGEvent) -> Bool')
  const clickRefreshBody = swiftFunctionBody(source, 'private func refreshCursorTargetForInputEvent(_ event: CGEvent)')

  assert.match(source, /private var lastElementSignature: String = ""/)
  assert.doesNotMatch(source, /lastElementRole/)
  assert.doesNotMatch(source, /lastElementTitle/)
  assert.match(queryBody, /let signature = axElementTelemetrySignature\(hit\)/)
  assert.match(queryBody, /signature != lastElementSignature/)
  assert.match(signatureBody, /hit\.role/)
  assert.match(signatureBody, /hit\.title \?\? ""/)
  assert.match(signatureBody, /hit\.label \?\? ""/)
  assert.match(signatureBody, /hit\.value \?\? ""/)
  assert.match(signatureBody, /rect\.origin\.x\.rounded\(\)/)
  assert.match(signatureBody, /rect\.origin\.y\.rounded\(\)/)
  assert.match(signatureBody, /rect\.size\.width\.rounded\(\)/)
  assert.match(signatureBody, /rect\.size\.height\.rounded\(\)/)
  assert.match(signatureBody, /hit\.contextPath\.joined/)
  assert.match(signatureBody, /hit\.actionNames\.joined/)
  assert.match(signatureBody, /hit\.capabilities\.joined/)
  assert.match(tapBody, /type == \.leftMouseDown[\s\S]*refreshCursorTargetForInputEvent\(event\)[\s\S]*guard let eventName = inputEventName/)
  assert.match(tapBody, /type == \.leftMouseUp[\s\S]*refreshCursorTargetForInputEvent\(event\)[\s\S]*guard let eventName = inputEventName/)
  assert.match(clickRefreshBody, /lastCursorPoint = point/)
  assert.match(clickRefreshBody, /checkWindowAndAppChange\(at: point\)/)
  assert.match(clickRefreshBody, /queryAXElementAtCursor\(point\)/)
})

test('AX cursor telemetry carries browser window and active tab context', () => {
  const daemonSource = fs.readFileSync(daemonPath, 'utf8')
  const axSource = fs.readFileSync(axPath, 'utf8')
  const windowBody = swiftFunctionBody(daemonSource, 'private func checkWindowAndAppChange(at point: CGPoint)')
  const queryBody = swiftFunctionBody(daemonSource, 'private func queryAXElementAtCursor(_ point: CGPoint)')

  assert.match(axSource, /func axBrowserContext\(pid: pid_t, appName: String, bundleID: String\?, point: CGPoint\? = nil\) -> \[String: Any\]\?/)
  assert.match(axSource, /active_url/)
  assert.match(axSource, /active_tab_title/)
  assert.match(axSource, /content_bounds/)
  assert.match(axSource, /window_bounds/)
  assert.match(windowBody, /let browserContext = axBrowserContext\(pid: pid, appName: ownerName, bundleID: bundleID, point: point\)/)
  assert.match(windowBody, /bounds: browserContextWindowBounds\(browserContext\) \?\? Bounds\(from: rect\)/)
  assert.match(windowBody, /data\["browser_context"\] = browserContext/)
  assert.match(queryBody, /axBrowserContext\(pid: lastAppPID, appName: app\.name, bundleID: app\.bundleID, point: point\)/)
  assert.match(queryBody, /data\["browser_context"\] = browserContext/)
})

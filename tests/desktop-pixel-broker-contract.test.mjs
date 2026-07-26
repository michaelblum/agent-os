import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('desktop pixel acquisition stays native, serialized, and artifact-free', async () => {
  const [broker, native, adapter, daemon] = await Promise.all([
    source('src/daemon/desktop-pixel-broker.swift'),
    source('src/daemon/desktop-pixel-native.swift'),
    source('src/daemon/desktop-frame-capture-adapter.swift'),
    source('src/daemon/unified.swift'),
  ])

  assert.match(native, /SCScreenshotManager\.captureImage/u)
  assert.match(native, /SCStream\(/u)
  assert.match(native, /configuration\.queueDepth = 1/u)
  assert.match(native, /waitUntilReady\(timeout: 0\.75\)/u)
  assert.doesNotMatch(native, /try\? await entry\.stream\.stopCapture\(\)/u)
  assert.match(native, /func quiesce\(\)/u)
  assert.match(native, /withTaskGroup\(of: Bool\.self\)/u)
  assert.match(broker, /DESKTOP_FRAME_RETIREMENT_UNCERTAIN/u)
  assert.match(broker, /defaultRetirementTimeout: TimeInterval = 5/u)
  assert.match(broker, /maximumPixelsPerDisplay = 16_777_216/u)
  assert.match(broker, /maximumTotalPixels = 67_108_864/u)
  assert.match(broker, /superviseSnapshotRetirement/u)
  assert.match(broker, /superviseWarmRetirement/u)
  assert.doesNotMatch(`${broker}\n${native}`, /base64|CGImageDestination|write\s*\(/iu)
  assert.match(adapter, /CGImageDestinationCreateWithData/u)
  assert.match(adapter, /performRetirement\(action\)[\s\S]*completion\(result\)/u)
  assert.match(daemon, /private let desktopPixelBroker = AOSDesktopPixelBroker\(\)/u)
  assert.match(daemon, /desktopFrameProbeCapturer[\s\S]*strategy: \.warmSnapshot/u)
  assert.match(daemon, /desktopFrameCapturer[\s\S]*strategy: \.warmSnapshot/u)
  assert.doesNotMatch(native, /Task\s*\{\s*@MainActor/u)
})

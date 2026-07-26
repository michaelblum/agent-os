import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('desktop pixel acquisition stays native, serialized, and artifact-free', async () => {
  const [broker, lifecycle, native, pool, adapter, daemon] = await Promise.all([
    source('src/daemon/desktop-pixel-broker.swift'),
    source('src/daemon/desktop-pixel-stream-lifecycle.swift'),
    source('src/daemon/desktop-pixel-native.swift'),
    source('src/daemon/desktop-frame-warm-pool.swift'),
    source('src/daemon/desktop-frame-capture-adapter.swift'),
    source('src/daemon/unified.swift'),
  ])

  assert.match(native, /SCScreenshotManager\.captureImage/u)
  assert.match(native, /SCStream\(/u)
  assert.match(native, /configuration\.queueDepth = 3/u)
  assert.match(native, /AOSDesktopPixelFrameAdvancement/u)
  assert.match(native, /requiredDistinctFrames: UInt64 = 2/u)
  assert.match(native, /waitUntilReady\(timeout: 0\.75\)/u)
  assert.doesNotMatch(native, /try\? await entry\.stream\.stopCapture\(\)/u)
  assert.doesNotMatch(native, /\(try\? \$0\.output\.snapshot\(\)\) != nil/u)
  assert.match(lifecycle, /aosDesktopPixelStopErrorConfirmsRetirement/u)
  assert.match(native, /aosStartDesktopPixelStreams/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupDecision/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupSettlement/u)
  assert.match(lifecycle, /tasks\.forEach \{ \$0\.cancel\(\) \}/u)
  assert.match(lifecycle, /decision\.complete\(completion\)[\s\S]*await decision\.compensationIsRequired\(\)/u)
  assert.match(lifecycle, /let retired = shouldCompensate \? await compensate\(index\) : true/u)
  assert.match(native, /entries\.append\([\s\S]*aosStartDesktopPixelStreams/u)
  assert.match(native, /aosSettleDesktopPixelStreamRetirement/u)
  assert.match(lifecycle, /retirementWasObserved\(\)/u)
  assert.match(lifecycle, /lifecycle\.confirmRetirement\(\)/u)
  assert.match(native, /func quiesce\(\)/u)
  assert.match(lifecycle, /withTaskGroup\(of: Bool\.self\)/u)
  assert.match(native, /\[desktop-pixel\] warm-open failed phase=/u)
  assert.match(broker, /DESKTOP_FRAME_RETIREMENT_UNCERTAIN/u)
  assert.match(broker, /defaultRetirementTimeout: TimeInterval = 5/u)
  assert.match(broker, /maximumPixelsPerDisplay = 16_777_216/u)
  assert.match(broker, /maximumTotalPixels = 67_108_864/u)
  assert.match(broker, /superviseSnapshotRetirement/u)
  assert.match(broker, /superviseWarmRetirement/u)
  assert.match(pool, /final class AOSDesktopFrameWarmPool/u)
  assert.match(pool, /desired == configuration/u)
  assert.match(pool, /broker\.freezeWarm/u)
  assert.doesNotMatch(
    `${broker}\n${lifecycle}\n${native}\n${pool}`,
    /base64|CGImageDestination|write\s*\(/iu,
  )
  assert.match(adapter, /CGImageDestinationCreateWithData/u)
  assert.match(adapter, /performRetirement\(action\)[\s\S]*completion\(result\)/u)
  assert.match(daemon, /private let desktopPixelBroker = AOSDesktopPixelBroker\(\)/u)
  assert.match(daemon, /desktopFrameProbeCapturer[\s\S]*strategy: \.oneShotWarmSnapshot/u)
  assert.match(daemon, /desktopFrameCapturer[\s\S]*strategy: \.prewarmedSnapshot/u)
  assert.match(daemon, /desktopFrameTextureAuthorization/u)
  assert.doesNotMatch(native, /Task\s*\{\s*@MainActor/u)
})

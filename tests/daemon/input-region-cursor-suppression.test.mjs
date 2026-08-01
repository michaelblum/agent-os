import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const registryPath = new URL('../../src/daemon/input-surface-ownership.swift', import.meta.url)
const cursorPath = new URL('../../src/daemon/input-region-cursor-presentation.swift', import.meta.url)
const daemonPath = new URL('../../src/daemon/unified.swift', import.meta.url)
const perceptionPath = new URL('../../src/perceive/daemon.swift', import.meta.url)
const canvasGenerationPath = new URL('../../src/display/canvas-generation.swift', import.meta.url)
const inputEventPath = new URL('../../src/shared/input-event.swift', import.meta.url)

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

test('input-region cursor presentation is phase-aware and balances checked hide/show lifecycle', () => {
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

var hideCalls = 0
var showCalls = 0
let controller = AOSNativeCursorPresentationController(
    hide: {
        hideCalls += 1
        return hideCalls == 1 ? .illegalArgument : .success
    },
    show: {
        showCalls += 1
        return showCalls == 1 ? .illegalArgument : .success
    }
)

let failedHide = controller.reconcile(hidden: true)
assert(failedHide.appliedHidden == false, "a failed hide must not be reported as applied")
assert(failedHide.errorCode == CGError.illegalArgument.rawValue, "hide failure must retain a content-free code")
let hidden = controller.reconcile(hidden: true)
assert(hidden.didHide == true && hidden.appliedHidden == true, "bounded retry should record one successful hide")
let unchanged = controller.reconcile(hidden: true)
assert(unchanged.didHide == false && hideCalls == 2, "stable suppression must not double-hide")
let failedShow = controller.reconcile(hidden: false)
assert(failedShow.appliedHidden == true && failedShow.didShow == false, "failed show must retain applied hide state")
let shown = controller.reconcile(hidden: false)
assert(shown.didShow == true && shown.appliedHidden == false, "bounded retry should balance the successful hide")
assert(controller.restore().didShow == false, "repeated cleanup is idempotent")

let owner = CanvasLifecycleGeneration(canvasID: "stage", value: 1)
let region = AOSInputRegionRecord(
    id: "object-hit",
    ownerCanvasGeneration: owner,
    nativeFrame: CGRect(x: 0, y: 0, width: 100, height: 100),
    consumePolicy: "captured",
    metadata: [
        "cursor_hover_system": "hidden",
        "cursor_hover_visual": "true",
        "cursor_captured_system": "hidden",
    ]
)
var coordinatedHideCalls = 0
var coordinatedShowCalls = 0
let coordinator = AOSInputRegionCursorPresentationCoordinator(
    native: AOSNativeCursorPresentationController(
        hide: {
            coordinatedHideCalls += 1
            return coordinatedHideCalls == 1 ? .illegalArgument : .success
        },
        show: {
            coordinatedShowCalls += 1
            return coordinatedShowCalls == 1 ? .illegalArgument : .success
        }
    )
)
let hoverTarget = AOSInputRegionCursorTarget(
    region: region,
    mode: .hover,
    desktopWorld: CGPoint(x: 120, y: 130)
)
let deferredEnter = coordinator.reconcile(target: hoverTarget, emitMove: false)
assert(deferredEnter.deliveries.isEmpty, "extension enter must wait for native hide success")
let appliedEnter = coordinator.reconcile(target: hoverTarget, emitMove: true)
assert(appliedEnter.deliveries.map { $0.phase } == [.enter], "successful hide must publish enter, not a move")
let capturedTarget = AOSInputRegionCursorTarget(
    region: region,
    mode: .captured,
    desktopWorld: CGPoint(x: 130, y: 140)
)
let capturedWithoutVisual = coordinator.reconcile(target: capturedTarget, emitMove: true)
assert(capturedWithoutVisual.deliveries.map { $0.phase } == [.leave], "hidden capture without custom art must retire hover art without publishing captured updates")
let resumedHover = coordinator.reconcile(target: hoverTarget, emitMove: true)
assert(resumedHover.deliveries.map { $0.phase } == [.enter], "returning to declared hover art must publish enter")
let deferredLeave = coordinator.reconcile(target: nil, emitMove: false)
assert(deferredLeave.deliveries.isEmpty, "extension leave must wait for native show success")
let appliedLeave = coordinator.reconcile(target: nil, emitMove: false)
assert(appliedLeave.deliveries.map { $0.phase } == [.leave], "successful show must publish the deferred leave")

let registry = AOSInputRegionRegistry()
registry.register(region)
let move = AOSInputEventDescriptor(type: "mouse_moved")!
_ = registry.route(event: move, point: CGPoint(x: 20, y: 30), desktopWorld: CGPoint(x: 120, y: 130))
let hover = registry.cursorPresentationSnapshot()!
assert(hover.mode == .hover && hover.desktopWorld == CGPoint(x: 120, y: 130), "hover should use the daemon world point")

let down = AOSInputEventDescriptor(type: "left_mouse_down")!
_ = registry.route(event: down, point: CGPoint(x: 20, y: 30), desktopWorld: CGPoint(x: 120, y: 130))
let captured = registry.cursorPresentationSnapshot()!
assert(captured.mode == .captured, "pointer admission should transfer cursor presentation to capture")
let transfer = aosInputRegionCursorDeliveries(from: hover, to: captured, emitMove: true)
assert(transfer.map { $0.phase } == [.leave, .enter], "hover-to-capture transfer should be explicit")

let drag = AOSInputEventDescriptor(type: "left_mouse_dragged")!
_ = registry.route(event: drag, point: CGPoint(x: 200, y: 200), desktopWorld: CGPoint(x: 300, y: 300))
assert(registry.cursorPresentationSnapshot()?.mode == .captured, "capture should keep suppression outside the original hit region")
let up = AOSInputEventDescriptor(type: "left_mouse_up")!
_ = registry.route(event: up, point: CGPoint(x: 200, y: 200), desktopWorld: CGPoint(x: 300, y: 300))
assert(registry.cursorPresentationSnapshot() == nil, "release outside the region should restore inherited cursor presentation")

let hoverOnlyRegistry = AOSInputRegionRegistry()
let hoverOnlyRegion = AOSInputRegionRecord(
    id: "hover-only",
    ownerCanvasGeneration: owner,
    nativeFrame: CGRect(x: 0, y: 0, width: 100, height: 100),
    consumePolicy: "captured",
    metadata: ["cursor_hover_system": "hidden"]
)
hoverOnlyRegistry.register(hoverOnlyRegion)
_ = hoverOnlyRegistry.route(event: move, point: CGPoint(x: 20, y: 30), desktopWorld: CGPoint(x: 120, y: 130))
assert(hoverOnlyRegistry.cursorPresentationSnapshot()?.mode == .hover, "hover-only policy should hide while hovering")
_ = hoverOnlyRegistry.route(event: down, point: CGPoint(x: 20, y: 30), desktopWorld: CGPoint(x: 120, y: 130))
assert(hoverOnlyRegistry.cursorPresentationSnapshot() == nil, "captured inherit must override hover hiding")

print("PASS cursor presentation lifecycle")
`)

  try {
    const compile = spawnSync('swiftc', [
      canvasGenerationPath.pathname,
      inputEventPath.pathname,
      registryPath.pathname,
      cursorPath.pathname,
      mainPath,
      '-o',
      binPath,
    ], {
      encoding: 'utf8',
    })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binPath, [], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS cursor presentation lifecycle/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('input-region cursor presentation is wired to hover, capture, teardown, and diagnostics', () => {
  const registrySource = fs.readFileSync(registryPath, 'utf8')
  const cursorSource = fs.readFileSync(cursorPath, 'utf8')
  const daemonSource = fs.readFileSync(daemonPath, 'utf8')
  const perceptionSource = fs.readFileSync(perceptionPath, 'utf8')
  const displayChangeBody = swiftFunctionBody(daemonSource, 'private func scheduleDisplayGeometryBroadcast()')
  const displayReconcileBody = swiftFunctionBody(
    daemonSource,
    'private func reconcileCursorPresentationAfterDisplayGeometryChange()',
  )
  const regionRouteBody = swiftFunctionBody(daemonSource, 'private func routeInputRegionEvent')
  const escapeRouteBody = swiftFunctionBody(daemonSource, 'private func routeInputEscapeCancellation')
  const shutdownBody = swiftFunctionBody(daemonSource, 'func shutdown(reason: String = "idle")')
  const cursorRestoreBody = swiftFunctionBody(
    daemonSource,
    'private func restoreNativeCursorSuppressionForExit()',
  )
  const signalHandlerBody = swiftFunctionBody(daemonSource, 'private func setupSignalHandlers()')
  const permissionLossBody = swiftFunctionBody(
    daemonSource,
    'private func releaseInputRegionCaptureAfterPermissionLoss()',
  )

  assert.match(registrySource, /func cursorPresentationSnapshot\(\) -> AOSInputRegionCursorTarget\?/)
  assert.match(registrySource, /cursor_hover_system/)
  assert.match(registrySource, /cursor_captured_system/)
  assert.match(registrySource, /metadata\["cursor_suppression"\]/)
  assert.match(registrySource, /lastNativePoint/)
  assert.match(registrySource, /refreshPointerTarget\(\)/)
  assert.match(daemonSource, /private let inputRegionCursorPresentation = AOSInputRegionCursorPresentationCoordinator\(\)/)
  assert.doesNotMatch(daemonSource, /activeDisplayIDsForCursorSuppression/)
  assert.doesNotMatch(daemonSource, /CGGetActiveDisplayList/)
  assert.match(cursorSource, /final class AOSNativeCursorPresentationController/)
  assert.match(cursorSource, /final class AOSInputRegionCursorPresentationCoordinator/)
  assert.match(cursorSource, /CGDisplayHideCursor\(CGMainDisplayID\(\)\)/)
  assert.match(cursorSource, /CGDisplayShowCursor\(CGMainDisplayID\(\)\)/)
  assert.match(cursorSource, /if result == \.success/)
  assert.match(daemonSource, /inputRegionCursorPresentation\.reconcile\(/)
  assert.match(daemonSource, /removeInputRegionsOwned[\s\S]*cursorPresentationSnapshot\(\)/)
  assert.match(shutdownBody, /restoreNativeCursorSuppressionForExit\(\)/)
  assert.match(shutdownBody, /perception\.stop\(\)[\s\S]*restoreNativeCursorSuppressionForExit\(\)/)
  assert.match(cursorRestoreBody, /inputRegionLock\.lock\(\)[\s\S]*clearPointerState\(\)[\s\S]*inputRegionCursorPresentation\.restore\(\)[\s\S]*inputRegionLock\.unlock\(\)[\s\S]*publishInputRegionCursorPresentation/)
  assert.match(signalHandlerBody, /shutdown\(reason: "signal"\)/)
  assert.match(displayChangeBody, /retargetTrackedCanvases\(\)[\s\S]*syncCanvasFrames\(excluding: retargeted\)[\s\S]*broadcastDisplayGeometry\(\)/)
  assert.match(displayChangeBody, /broadcastDisplayGeometry\(\)[\s\S]*reconcileCursorPresentationAfterDisplayGeometryChange\(\)/)
  assert.match(displayReconcileBody, /inputRegionLock\.lock\(\)[\s\S]*refreshPointerTarget\(\)[\s\S]*inputRegionCursorPresentation\.reconcile[\s\S]*inputRegionLock\.unlock\(\)[\s\S]*publishInputRegionCursorPresentation/)
  assert.match(regionRouteBody, /inputRegionLock\.lock\(\)[\s\S]*resolveDelivery[\s\S]*inputRegionCursorPresentation\.reconcile[\s\S]*inputRegionLock\.unlock\(\)[\s\S]*publishInputRegionCursorPresentation/)
  assert.match(escapeRouteBody, /inputRegionLock\.lock\(\)[\s\S]*cancelActiveCapture[\s\S]*inputRegionCursorPresentation\.reconcile[\s\S]*inputRegionLock\.unlock\(\)[\s\S]*publishInputRegionCursorPresentation/)
  assert.match(perceptionSource, /onInputTapPermissionLost: \(\(\) -> Void\)\?/)
  assert.match(perceptionSource, /failOpenAfterInputTapPermissionLoss[\s\S]*onInputTapPermissionLost\?\(\)/)
  assert.match(daemonSource, /perception\.onInputTapPermissionLost[\s\S]*releaseInputRegionCaptureAfterPermissionLoss\(\)/)
  assert.match(permissionLossBody, /cancelActiveCapture\(reason: \.osCancelled\)/)
  assert.match(permissionLossBody, /clearPointerState\(\)[\s\S]*inputRegionCursorPresentation\.reconcile[\s\S]*inputRegionLock\.unlock\(\)[\s\S]*publishInputRegionCursorPresentation/)
  assert.match(daemonSource, /"native_cursor"[\s\S]*"requested_hidden"[\s\S]*"applied_hidden"[\s\S]*"error_code"/)
})

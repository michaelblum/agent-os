import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('desktop pixel acquisition stays native, serialized, and artifact-free', async () => {
  const [broker, retirement, nativeOperation, lifecycle, sampleAdmission, displayGeometry, captureFilter, native, pool, adapter, daemon, publicCapture, publicTransfer, perceive, canvasRuntime, savedCapture] = await Promise.all([
    source('src/daemon/desktop-pixel-broker.swift'),
    source('src/daemon/desktop-pixel-retirement.swift'),
    source('src/daemon/desktop-pixel-native-operation.swift'),
    source('src/daemon/desktop-pixel-stream-lifecycle.swift'),
    source('src/shared/desktop-pixel-sample-admission.swift'),
    source('src/shared/desktop-world-display-geometry.swift'),
    source('src/daemon/desktop-pixel-capture-filter.swift'),
    source('src/daemon/desktop-pixel-native.swift'),
    source('src/daemon/desktop-frame-warm-pool.swift'),
    source('src/daemon/desktop-frame-capture-adapter.swift'),
    source('src/daemon/unified.swift'),
    source('src/daemon/public-capture-controller.swift'),
    source('src/daemon/public-capture-transfer.swift'),
    source('src/perceive/capture-pipeline.swift'),
    source('packages/toolkit/runtime/canvas-host-runtime.js'),
    source('scripts/lib/agent-workspace/capture.mjs'),
  ])

  const warmNative = native.slice(
    native.indexOf('private final class AOSNativeDesktopPixelWarmSource'),
    native.indexOf('final class AOSNativeDesktopPixelAcquirer'),
  )
  const snapshotNative = native.slice(
    native.indexOf('private final class AOSNativeDesktopPixelStillOperation'),
    native.indexOf('private struct AOSDesktopPixelLatestSample'),
  )
  const retainedNativeOperation = nativeOperation

  assert.match(native, /SCScreenshotManager\.captureImage/u)
  assert.match(native, /SCStream\(/u)
  assert.match(native, /AOSDesktopPixelWarmStreamProfile/u)
  assert.match(displayGeometry, /struct AOSDesktopWorldDisplayLayout/u)
  assert.match(native, /request\.displayLayout\?\.geometry\(displayID: display\.displayID\)/u)
  assert.doesNotMatch(native, /display\.width\.multipliedReportingOverflow/u)
  assert.match(native, /static let queueDepth = 3/u)
  assert.match(warmNative, /onScreenWindowsOnly: false/u)
  assert.match(captureFilter, /aosDesktopPixelCaptureFilterSelection/u)
  assert.match(captureFilter, /policy == \.warmSelfExcluding,[\s\S]*applicationSelfExclusionEligible,[\s\S]*availableApplicationProcessIDs\.contains\(currentProcessID\)/u)
  assert.match(captureFilter, /Bundle\.main\.bundleURL/u)
  assert.match(captureFilter, /Bundle\.main\.bundleIdentifier/u)
  assert.match(captureFilter, /excludingApplications: \[application\]/u)
  assert.match(captureFilter, /exceptingWindows: \[\]/u)
  assert.match(captureFilter, /return SCContentFilter\(display: display, excludingWindows: windows\)/u)
  assert.match(captureFilter, /guard windows\.count == requested\.count/u)
  assert.equal((snapshotNative.match(/aosDesktopPixelCaptureFilter\(/gu) ?? []).length, 1)
  assert.match(
    snapshotNative,
    /content: content,[\s\S]*display: display,[\s\S]*excludingWindowIDs: request\.excludingWindowIDs/u,
  )
  assert.match(snapshotNative, /policy: request\.capturePolicy/u)
  assert.match(snapshotNative, /SCShareableContent\.getExcludingDesktopWindows\(/u)
  assert.match(snapshotNative, /SCScreenshotManager\.captureImage\([\s\S]*completionHandler: callback/u)
  assert.doesNotMatch(snapshotNative, /try\s+await\s+(?:SCShareableContent|SCScreenshotManager)/u)
  assert.match(snapshotNative, /var prepared: \[PreparedDisplayCapture\][\s\S]*displayOutcomes = outcomes[\s\S]*pendingCaptureCallbacks = prepared\.count[\s\S]*for entry in prepared/u)
  assert.match(snapshotNative, /SCShareableContent\.getExcludingDesktopWindows[\s\S]*prepared\.append\(PreparedDisplayCapture\([\s\S]*source: \.display[\s\S]*if let windowID = requestedWindowID[\s\S]*source: \.window\(windowID\)/u)
  assert.match(snapshotNative, /aosResolveDesktopPixelStillOutcomes\([\s\S]*displayIDs: request\.displayIDs,[\s\S]*outcomes: outcomes/u)
  assert.match(snapshotNative, /outstandingNativeCallbacks[\s\S]*authoritativeSettlement:[\s\S]*nativeCallbackSettled/u)
  assert.equal((warmNative.match(/aosDesktopPixelCaptureFilter\(/gu) ?? []).length, 1)
  assert.match(
    warmNative,
    /content: content,[\s\S]*display: display,[\s\S]*excludingWindowIDs: request\.excludingWindowIDs/u,
  )
  assert.match(warmNative, /@MainActor\s+static func open/u)
  assert.match(
    warmNative,
    /aosStartDesktopPixelStreams[\s\S]*let stream = entry\.stream[\s\S]*startOperation\.start[\s\S]*stream\.startCapture\(completionHandler: nativeCompletion\)[\s\S]*stop:[\s\S]*let stream = entry\.stream[\s\S]*stopOperation\.start[\s\S]*stream\.stopCapture\(completionHandler: nativeCompletion\)/u,
  )
  assert.match(nativeOperation, /final class AOSDesktopPixelRetainedNativeOperation/u)
  assert.match(nativeOperation, /final class AOSDesktopPixelRetainedCallbackToken/u)
  assert.match(nativeOperation, /private var selfRetain: AOSDesktopPixelRetainedCallbackToken/u)
  assert.match(nativeOperation, /deadline <= 10/u)
  assert.match(nativeOperation, /\.retirementUncertain/u)
  assert.match(nativeOperation, /if delivered \{[\s\S]*delivery = nil[\s\S]*result = nil/u)
  assert.match(nativeOperation, /only the native callback settles[\s\S]*settlementObserver/u)
  assert.match(nativeOperation, /func nativeSettled[\s\S]*settlementObserver = self\.settlementObserver[\s\S]*settlementObserver\?\(\)/u)
  assert.match(retainedNativeOperation, /DispatchQueue\.global\([\s\S]*qos: \.userInitiated/u)
  assert.match(retainedNativeOperation, /executionQueue\.async/u)
  assert.match(
    retainedNativeOperation,
    /executionQueue\.async \{ \[weak self\] in[\s\S]*self\?\.invokeIfPending\(\)/u,
  )
  assert.doesNotMatch(retainedNativeOperation, /invokeIfPending\(operation\)/u)
  assert.doesNotMatch(retainedNativeOperation, /DispatchQueue\.main/u)
  assert.match(
    retainedNativeOperation,
    /invokeIfPending[\s\S]*guard settlement == nil, let pendingOperation[\s\S]*invoking = true[\s\S]*self\.pendingOperation = nil[\s\S]*operation[\s\S]*invoking = false[\s\S]*finishLocked/u,
  )
  assert.match(
    retainedNativeOperation,
    /func settle\(_ result: Result<Void, Error>\)[\s\S]*guard settlement == nil[\s\S]*settlement = result[\s\S]*delivery = invoking \? nil : finishLocked\(\)[\s\S]*delivery\?\(result\)/u,
  )
  assert.match(
    retainedNativeOperation,
    /func finishLocked[\s\S]*completion = nil[\s\S]*pendingOperation = nil/u,
  )
  assert.doesNotMatch(retainedNativeOperation, /Task(?:\.|<)|withChecked/u)
  assert.doesNotMatch(native, /func aosPerformDesktopPixelNativeOperation/u)
  assert.doesNotMatch(native, /cancelPendingStart/u)
  assert.match(warmNative, /configuration\.width = profile\.width/u)
  assert.match(warmNative, /configuration\.height = profile\.height/u)
  assert.doesNotMatch(warmNative, /configuration\.captureResolution/u)
  assert.match(native, /AOSDesktopPixelFrameAdvancement/u)
  assert.match(sampleAdmission, /requiredDistinctFrames: UInt64 = 2/u)
  assert.match(native, /waitUntilReady\(timeout: 0\.75\)/u)
  assert.doesNotMatch(native, /try\? await entry\.stream\.stopCapture\(\)/u)
  assert.doesNotMatch(native, /\(try\? \$0\.output\.snapshot\(\)\) != nil/u)
  assert.match(lifecycle, /aosDesktopPixelStopErrorConfirmsRetirement/u)
  assert.match(native, /aosStartDesktopPixelStreams/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupDecision/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupSignal/u)
  assert.match(native, /first_sample[\s\S]*startupSignal\.succeed\(\)/u)
  assert.match(
    native,
    /delegate_stopped[\s\S]*retirementLatch\.observe\(\)[\s\S]*nativeStopped\(error\)[\s\S]*startupSignal\.fail\(error\)/u,
  )
  assert.match(
    warmNative,
    /nativeStopped: \{ \[weak startOperation, weak stopOperation, weak sourceFailure\] error in[\s\S]*sourceFailure\?\.record\(error\)[\s\S]*startOperation\?\.settle\(\.failure\(error\)\)[\s\S]*stopOperation\?\.settle\(\.failure\(error\)\)/u,
  )
  assert.match(native, /start_settled/u)
  assert.match(native, /stop_settled/u)
  assert.match(native, /lateFailure: \{ error in sourceFailure\.record\(error\) \}/u)
  assert.match(native, /failureState\.current\(\)/u)
  assert.doesNotMatch(warmNative, /\.startCapture\s*\{/u)
  assert.doesNotMatch(warmNative, /\.stopCapture\s*\{/u)
  assert.match(lifecycle, /AOSDesktopPixelAggregateSettlement/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupStreamCoordinator/u)
  assert.match(lifecycle, /AOSDesktopPixelStartupOwner/u)
  assert.match(lifecycle, /AOSDesktopPixelLateStartupFailure/u)
  assert.match(lifecycle, /start \{ \[weak self, signal\] result in/u)
  assert.match(lifecycle, /func admitExplicitStop\(\) -> AOSDesktopPixelStopAdmission/u)
  assert.match(
    retirement,
    /func admitExplicitStop\(\)[\s\S]*if observed \{ return \.retired \}[\s\S]*guard !stopAdmitted else \{ return \.unavailable \}[\s\S]*stopAdmitted = true/u,
  )
  assert.match(
    lifecycle,
    /switch lifecycle\.admitExplicitStop\(\)[\s\S]*case \.retired:[\s\S]*case \.unavailable:[\s\S]*case \.admitted:/u,
  )
  assert.match(lifecycle, /case \.failed:[\s\S]*action = \.confirmInactive/u)
  assert.doesNotMatch(
    lifecycle,
    /private func startupFailed[\s\S]*?startState\s*=/u,
  )
  assert.match(lifecycle, /case \.succeeded:[\s\S]*action = \.stop\(attempt\)/u)
  assert.match(lifecycle, /AOSDesktopPixelWarmOpenOperation/u)
  assert.match(lifecycle, /cancellationRequested = true/u)
  assert.match(lifecycle, /cancellation\.register\(\{ decision\.cancel\(\) \}\)/u)
  assert.match(native, /cancellation: cancellation/u)
  assert.match(lifecycle, /coordinators\.forEach \{ \$0\.requestRetirement\(\) \}/u)
  assert.match(lifecycle, /Task\.detached\(priority: \.utility\)/u)
  assert.match(native, /entries\.append\([\s\S]*aosStartDesktopPixelStreams/u)
  assert.match(native, /startupOwner\?\.retire/u)
  assert.match(lifecycle, /retirementWasObserved\(\)/u)
  assert.match(lifecycle, /lifecycle\.confirmRetirement\(\)/u)
  assert.match(native, /func quiesce\(\)/u)
  assert.match(lifecycle, /withTaskGroup\(of: Bool\.self\)/u)
  assert.match(native, /\[desktop-pixel\] warm-open failed phase=/u)
  assert.match(broker, /DESKTOP_FRAME_RETIREMENT_UNCERTAIN/u)
  assert.match(broker, /defaultRetirementTimeout: TimeInterval = 5/u)
  assert.match(broker, /maximumPixelsPerDisplay = 16_777_216/u)
  assert.match(broker, /maximumTotalPixels = 67_108_864/u)
  assert.match(broker, /publicCaptureMaximumPixelsPerDisplay = 67_108_864/u)
  assert.match(broker, /publicCaptureMaximumTotalPixels = 134_217_728/u)
  assert.match(broker, /enum AOSDesktopPixelCapturePolicy/u)
  assert.match(broker, /case publicExplicitExclusions/u)
  assert.match(broker, /setTerminalObserver/u)
  assert.match(broker, /superviseSnapshotRetirement/u)
  assert.match(broker, /superviseWarmRetirement/u)
  assert.match(broker, /retirementDeadlineDelivered/u)
  assert.match(broker, /awaitSnapshotRetirement[\s\S]*finishAuthoritativeSnapshotRetirement/u)
  assert.match(broker, /active\.retiring,[\s\S]*!active\.retirementDeadlineDelivered else/u)
  assert.match(pool, /final class AOSDesktopFrameWarmPool/u)
  assert.match(pool, /AOSDesktopFrameWarmSourceIdentity/u)
  assert.match(pool, /excludingWindowIDs: Array\(Set\(excludingWindowIDs\)\)\.sorted\(\)/u)
  assert.match(pool, /desired\?\.sourceIdentity == configuration\?\.sourceIdentity/u)
  assert.match(pool, /desired = configuration/u)
  assert.match(pool, /broker\.freezeWarm/u)
  assert.match(pool, /func captureExclusiveStill/u)
  assert.match(pool, /case quiescing[\s\S]*case capturing[\s\S]*case restoring/u)
  assert.match(pool, /retireCurrentOnQueue\(\)[\s\S]*startExclusiveSnapshotOnQueue/u)
  assert.match(
    pool,
    /broker\.snapshot\(\s*transaction\.request,[\s\S]*authoritativeSettlementObserver:/u,
  )
  assert.match(pool, /awaitingAuthoritativeStillSettlement/u)
  assert.match(pool, /exclusiveSnapshotAuthoritativelySettledOnQueue/u)
  assert.match(
    broker,
    /activeSnapshot = nil[\s\S]*authoritativeSettlementObserver[\s\S]*observer\?\(\)/u,
  )
  assert.match(pool, /request\.capturePolicy == \.publicExplicitExclusions/u)
  assert.match(pool, /aosPublicCaptureDaemonTransactionBudget: TimeInterval = 24/u)
  assert.match(pool, /scheduleDeadline[\s\S]*exclusiveStillDeadlineOnQueue/u)
  assert.match(pool, /topologyDrifted = true/u)
  assert.match(pool, /transaction\.topologyDrifted && !transaction\.canceled[\s\S]*\.topologyMismatch/u)
  assert.match(pool, /terminalObserver:/u)
  assert.doesNotMatch(
    `${broker}\n${lifecycle}\n${native}\n${pool}`,
    /base64|CGImageDestination|write\s*\(/iu,
  )
  assert.match(adapter, /CGImageDestinationCreateWithData/u)
  assert.match(adapter, /return broker\.snapshot\(request\)/u)
  assert.match(adapter, /return warmPool\.captureExclusiveStill/u)
  assert.doesNotMatch(
    adapter,
    /oneShotWarmSnapshot|AOSDesktopFrameWarmSnapshotOperation/u,
  )
  assert.match(daemon, /private let desktopPixelBroker = AOSDesktopPixelBroker\(\)/u)
  assert.match(daemon, /desktopFrameProbeCapturer[\s\S]*strategy: \.snapshot/u)
  assert.match(daemon, /preflightPermission: \{ CGPreflightScreenCaptureAccess\(\) \}/u)
  assert.match(daemon, /desktopFrameCapturer[\s\S]*strategy: \.prewarmedSnapshot/u)
  assert.match(daemon, /desktopFrameTextureAuthorization/u)
  assert.match(daemon, /private lazy var publicCaptureController = AOSPublicCaptureController/u)
  assert.match(daemon, /case \("see", "capture"\):\s+return "capture"/u)
  assert.match(daemon, /var publicCaptureToken: UUID\?/u)
  assert.match(daemon, /publicCaptureToken = captureToken[\s\S]*captureAdmitted = true/u)
  assert.match(daemon, /publicCaptureToken == captureToken[\s\S]*publicCaptureToken = nil/u)
  assert.match(daemon, /if !ownsCapture \{ capture\.cancel\(\) \}/u)
  assert.match(publicCapture, /capturer\.captureExclusiveStill\(wire\.request\)/u)
  assert.match(publicCapture, /aosStreamPublicCaptureData\(/u)
  assert.match(publicTransfer, /let aosPublicCaptureChunkBytes = 384 \* 1024/u)
  assert.match(publicTransfer, /"sha256": digest/u)
  assert.match(publicTransfer, /"bytes_base64": chunk\.base64EncodedString\(\)/u)
  assert.doesNotMatch(daemon, /capture\.region|handleCaptureRegion/u)
  assert.doesNotMatch(canvasRuntime, /captureRegion|capture\.region/u)
  assert.doesNotMatch(perceive, /CaptureSessionLock|SCScreenshotManager|SCShareableContent|SCContentFilter/u)
  assert.match(perceive, /session\.connectWithAutoStart\(binaryPath:/u)
  assert.equal((perceive.match(/connectWithAutoStart\(/gu) ?? []).length, 1)
  assert.match(perceive, /guard session\.connectWithAutoStart[\s\S]*code: "DAEMON_UNREACHABLE"/u)
  assert.match(perceive, /aosDecodePublicCaptureForegroundMessage\(/u)
  assert.match(
    publicTransfer,
    /Set\(message\.keys\) == eventKeys[\s\S]*message\["service"\] as\? String == "see"[\s\S]*message\["event"\] as\? String == "capture_chunk"/u,
  )
  assert.match(perceive, /aosCaptureDigest\(accumulator\.data\) == digest/u)
  const captureCommand = perceive.slice(perceive.indexOf('func captureCommand(args: [String]) async'))
  const browserDispatch = captureCommand.indexOf('if opts.target.hasPrefix("browser:")')
  const topologyObservation = captureCommand.indexOf('let displayTopologySnapshot = observeDisplayTopologySnapshot()')
  const daemonCapture = captureCommand.indexOf('captureNativeFramesThroughDaemon(')
  assert.ok(browserDispatch >= 0 && browserDispatch < topologyObservation && topologyObservation < daemonCapture)
  assert.equal((perceive.match(/captureNativeFramesThroughDaemon\(/gu) ?? []).length, 2)
  const savedCaptureCommand = savedCapture.slice(
    savedCapture.indexOf('export async function savedCaptureCommand'),
  )
  assert.equal((savedCaptureCommand.match(/runNativeSeeSync\(/gu) ?? []).length, 1)
  assert.match(savedCaptureCommand, /primitive: 'capture'/u)
  assert.doesNotMatch(native, /Task\s*\{\s*@MainActor/u)
})

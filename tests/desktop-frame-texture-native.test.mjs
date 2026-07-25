import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const taskStateSource = path.join(repoRoot, 'src/display/scene-extension-scheme-task-state.swift')
const storeSource = path.join(repoRoot, 'src/display/desktop-frame-texture.swift')
const controllerSource = path.join(repoRoot, 'src/daemon/desktop-frame-capture-controller.swift')

async function compileHarness(root) {
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'desktop-frame-proof')
  await writeFile(main, `
import Foundation

struct AOSSceneExtensionReference: Equatable {
    let ownerID: String
    let id: String
    let digest: String
    let sceneABI: String
    let threeRevision: String

    var dictionary: [String: Any] {
        [
            "ownerId": ownerID,
            "id": id,
            "digest": digest,
            "sceneAbi": sceneABI,
            "threeRevision": threeRevision,
        ]
    }
}

final class CanvasManager {
    var consumers: [AOSDesktopFrameConsumerIdentity]
    var windows: [Int]

    init(consumers: [AOSDesktopFrameConsumerIdentity], windows: [Int]) {
        self.consumers = consumers
        self.windows = windows
    }

    func desktopFrameConsumers(canvasID: String) -> [AOSDesktopFrameConsumerIdentity] {
        consumers
    }

    func windowNumbers(forID id: String) -> [Int] { windows }
}

final class AOSDesktopWorldSceneTransportController {
    static let stageCanvasID = "aos-desktop-world-stage"
}

final class FakeCapturer: AOSDesktopFrameCapturing {
    var canceled = 0
    var displayIDs: [UInt32] = []
    var excludedWindowIDs: [Int] = []
    var maximumPixels = 0
    var pending: ((Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void)?
    var deferred = false

    @discardableResult
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        self.displayIDs = displayIDs
        excludedWindowIDs = excludingWindowIDs
        maximumPixels = maximumPixelsPerDisplay
        if deferred {
            pending = completion
        } else {
            completion(.success(result(displayIDs)))
        }
        return AOSDesktopFrameCancellation { self.canceled += 1 }
    }

    func result(_ displayIDs: [UInt32]) -> AOSDesktopFrameCaptureSetResult {
        AOSDesktopFrameCaptureSetResult(
            capturedAt: Date(timeIntervalSince1970: 10),
            durationMilliseconds: 14,
            frames: displayIDs.map {
                AOSDesktopFrameCaptureResult(
                    data: Data([0xff, 0xd8, UInt8($0 & 0xff), 0xd9]),
                    displayID: $0,
                    height: 640,
                    mimeType: "image/jpeg",
                    width: 1024
                )
            }
        )
    }
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs(message + "\\n", stderr)
        exit(1)
    }
}

@main
struct DesktopFrameProof {
    static func main() throws {
        var scheduledExpirations: [() -> Void] = []
        let store = AOSDesktopFrameStore(scheduleExpiration: { _, action in
            scheduledExpirations.append(action)
        })
        let stageA = NSObject()
        let stageB = NSObject()
        let consumerA = AOSDesktopFrameConsumerIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            topologyGeneration: 11,
            displayID: 42,
            segmentIndex: 0,
            webViewID: ObjectIdentifier(stageA)
        )
        let consumerB = AOSDesktopFrameConsumerIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            topologyGeneration: 11,
            displayID: 43,
            segmentIndex: 1,
            webViewID: ObjectIdentifier(stageB)
        )
        let reference = AOSSceneExtensionReference(
            ownerID: "io.ch-osctrl.sigil",
            id: "companion-renderer",
            digest: String(repeating: "a", count: 64),
            sceneABI: "aos.scene.projection.v1",
            threeRevision: "183"
        )
        let leaseIdentity = AOSDesktopFrameLeaseIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            extensionReference: reference,
            ownerID: "io.ch-osctrl.sigil",
            resourceID: "companion/main",
            resourceRevision: 3,
            topologyGeneration: 11
        )
        let start = Date(timeIntervalSince1970: 20)
        let epoch = "11111111-1111-4111-8111-111111111111"
        let first = try store.insert(
            data: Data([1, 2, 3]),
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: epoch,
            width: 64,
            height: 32,
            now: start
        )
        require(first.url.hasPrefix("aos://toolkit/.aos-desktop-frame/v1/"), "opaque URL missing")
        do {
            _ = try store.take(
                handle: first.handle,
                consumer: consumerB,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "cross-WebView frame load succeeded")
        } catch AOSDesktopFrameStoreFailure.unauthorized {
        }
        let loaded = try store.take(
            handle: first.handle,
            consumer: consumerA,
            authorize: { $0 == leaseIdentity },
            now: start
        )
        require(loaded.data == Data([1, 2, 3]), "stored bytes changed")
        do {
            _ = try store.take(
                handle: first.handle,
                consumer: consumerA,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "one-shot frame loaded twice")
        } catch AOSDesktopFrameStoreFailure.notFound {
        }

        _ = try store.insert(
            data: Data([4]),
            mimeType: "image/png",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: "22222222-2222-4222-8222-222222222222",
            width: 1,
            height: 1,
            now: start
        )
        require(store.count(now: start) == 1, "scheduled frame missing")
        scheduledExpirations.removeFirst()()
        scheduledExpirations.removeFirst()()
        require(store.count(now: start) == 0, "scheduled expiry retained pixels")

        for value in 0..<(AOSDesktopFrameStore.maximumEntries + 3) {
            _ = try store.insert(
                data: Data([UInt8(value)]),
                mimeType: "image/jpeg",
                ownerCanvasID: "stage",
                consumer: consumerA,
                leaseIdentity: leaseIdentity,
                epochID: UUID().uuidString,
                width: 1,
                height: 1,
                now: start.addingTimeInterval(Double(value))
            )
        }
        require(
            store.count(now: start.addingTimeInterval(Double(AOSDesktopFrameStore.maximumEntries + 3)))
                <= AOSDesktopFrameStore.maximumEntries,
            "frame store exceeded entry bound"
        )
        let boundedChunk = Data(
            repeating: 0x7f,
            count: (AOSDesktopFrameStore.maximumEncodedBytes / 2) + 1
        )
        let aggregateFirst = try store.insert(
            data: boundedChunk,
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: UUID().uuidString,
            width: 1,
            height: 1,
            now: start.addingTimeInterval(100)
        )
        let aggregateSecond = try store.insert(
            data: boundedChunk,
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: UUID().uuidString,
            width: 1,
            height: 1,
            now: start.addingTimeInterval(101)
        )
        do {
            _ = try store.take(
                handle: aggregateFirst.handle,
                consumer: consumerA,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "aggregate byte bound retained the oldest oversized set")
        } catch AOSDesktopFrameStoreFailure.notFound {
        }
        let loadedAggregateSecond = try store.take(
            handle: aggregateSecond.handle,
            consumer: consumerA,
            authorize: { $0 == leaseIdentity },
            now: start
        )
        require(
            loadedAggregateSecond.data.count == boundedChunk.count,
            "aggregate byte bound removed the newest frame"
        )
        _ = store.releaseAll(ownerCanvasID: "stage")

        let atomicEpoch = try store.insertEpoch(
            frames: [
                AOSDesktopFrameStoreFrame(
                    consumer: consumerA,
                    data: Data([1]),
                    height: 1,
                    mimeType: "image/jpeg",
                    width: 1
                ),
                AOSDesktopFrameStoreFrame(
                    consumer: consumerB,
                    data: Data([2]),
                    height: 1,
                    mimeType: "image/jpeg",
                    width: 1
                ),
            ],
            leaseIdentity: leaseIdentity,
            ownerCanvasID: "stage",
            epochID: "99999999-9999-4999-8999-999999999999",
            now: start
        )
        for value in 0..<(AOSDesktopFrameStore.maximumEntries - 1) {
            _ = try store.insert(
                data: Data([UInt8(value)]),
                mimeType: "image/jpeg",
                ownerCanvasID: "stage",
                consumer: consumerA,
                leaseIdentity: leaseIdentity,
                epochID: UUID().uuidString,
                width: 1,
                height: 1,
                now: start.addingTimeInterval(Double(value + 1))
            )
        }
        for lease in atomicEpoch {
            do {
                _ = try store.take(
                    handle: lease.handle,
                    consumer: lease == atomicEpoch[0] ? consumerA : consumerB,
                    authorize: { $0 == leaseIdentity },
                    now: start
                )
                require(false, "capacity eviction retained part of an old capture epoch")
            } catch AOSDesktopFrameStoreFailure.notFound {
            }
        }
        _ = store.releaseAll(ownerCanvasID: "stage")

        let authorization = AOSDesktopFrameCaptureAuthorization(
            canvasID: "stage",
            canvasGeneration: 7,
            extensionReference: reference,
            ownerID: "io.ch-osctrl.sigil",
            resourceID: "companion/main",
            resourceRevision: 3,
            topologyGeneration: 11
        )
        let payload: [String: Any] = [
            "canvas_generation": 7,
            "extension": reference.dictionary,
            "owner": "io.ch-osctrl.sigil",
            "request_id": "request-main",
            "resource": "companion/main",
            "revision": 3,
            "segment_display_id": 42,
            "segment_index": 0,
            "topology_generation": 11,
        ]
        let canvas = CanvasManager(consumers: [consumerA, consumerB], windows: [7, 8])
        let capturer = FakeCapturer()
        var capabilityEnabled = true
        var scheduledDeadlines: [() -> Void] = []
        var aborts: [AOSDesktopFrameCaptureAbort] = []
        let controller = AOSDesktopFrameCaptureController(
            canvasManager: canvas,
            store: store,
            capturer: capturer,
            allowedCanvasID: "stage",
            reauthorize: { capabilityEnabled && $0 == leaseIdentity },
            handleAbort: { aborts.append($0) },
            scheduleDeadline: { _, action in
                scheduledDeadlines.append(action)
                return AOSDesktopFrameCancellation()
            },
            authorize: { _ in capabilityEnabled ? authorization : nil }
        )

        capabilityEnabled = false
        var unauthorizedCode: String?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) {
            if case .failure(let failure as AOSDesktopFrameCaptureFailure) = $0 {
                unauthorizedCode = failure.code
            }
        }
        require(unauthorizedCode == "DESKTOP_FRAME_UNAUTHORIZED", "undeclared capability admitted")

        capabilityEnabled = true
        var admittedConsumers = 0
        var delivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: {
                admittedConsumers = $0.consumers.count
                return true
            }
        ) {
            delivery = try? $0.get()
        }
        guard let delivery else {
            require(false, "capture response missing")
            return
        }
        let response = delivery.payload
        require(admittedConsumers == 2, "capture admission omitted exact consumers")
        require(capturer.displayIDs == [42, 43], "capture epoch omitted a display")
        require(capturer.excludedWindowIDs == [7, 8], "stage windows were not excluded")
        require(
            capturer.maximumPixels == AOSDesktopFrameCaptureController.maximumPixelsPerDisplay,
            "pixel bound changed"
        )
        let frames = response["frames"] as? [[String: Any]] ?? []
        require(frames.count == 2, "multi-display frame set missing")
        require(Set(frames.compactMap { $0["display_id"] as? Int }) == Set([42, 43]), "display identity changed")
        require(response["capture_duration_ms"] as? Int == 14, "capture duration changed")
        require(response["data"] == nil, "raw bytes escaped")
        require(response["base64"] == nil, "base64 bytes escaped")
        require(response["path"] == nil, "local path escaped")

        let readyBase: [String: Any] = [
            "canvas_generation": 7,
            "epoch_id": delivery.epochID,
            "request_id": delivery.requestID,
            "topology_generation": 11,
        ]
        var staleReady = readyBase
        staleReady["canvas_generation"] = 8
        staleReady["segment_display_id"] = 42
        staleReady["segment_index"] = 0
        if case .rejected = controller.ready(callerCanvasID: "stage", payload: staleReady) {
        } else {
            require(false, "stale canvas generation entered the ready barrier")
        }
        var readyA = readyBase
        readyA["segment_display_id"] = 42
        readyA["segment_index"] = 0
        if case .pending = controller.ready(callerCanvasID: "stage", payload: readyA) {
        } else {
            require(false, "first display committed before the all-display barrier")
        }
        var readyB = readyBase
        readyB["segment_display_id"] = 43
        readyB["segment_index"] = 1
        if case .commit(let committed) = controller.ready(
            callerCanvasID: "stage",
            payload: readyB
        ) {
            require(committed.epochID == delivery.epochID, "committed epoch changed")
        } else {
            require(false, "all-display readiness did not commit")
        }
        var presentedA = readyBase
        presentedA["segment_display_id"] = 42
        presentedA["segment_index"] = 0
        if case .pending = controller.presented(
            callerCanvasID: "stage",
            payload: presentedA
        ) {
        } else {
            require(false, "first presented display completed before the all-display barrier")
        }
        var presentedB = readyBase
        presentedB["segment_display_id"] = 43
        presentedB["segment_index"] = 1
        if case .complete = controller.presented(
            callerCanvasID: "stage",
            payload: presentedB
        ) {
        } else {
            require(false, "all-display presentation did not settle")
        }

        capabilityEnabled = false
        let secondHandle = frames[1]["handle"] as! String
        do {
            _ = try store.take(
                handle: secondHandle,
                consumer: consumerB,
                authorize: { capabilityEnabled && $0 == leaseIdentity }
            )
            require(false, "revoked scene revision retained its frame lease")
        } catch AOSDesktopFrameStoreFailure.unauthorized {
        }
        require(store.count() == 0, "authorization revocation retained the capture epoch")
        capabilityEnabled = true

        var revocationDelivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { revocationDelivery = try? $0.get() }
        guard let revocationDelivery else {
            require(false, "revocation capture response missing")
            return
        }
        var revocationReadyA = readyBase
        revocationReadyA["epoch_id"] = revocationDelivery.epochID
        revocationReadyA["request_id"] = revocationDelivery.requestID
        revocationReadyA["segment_display_id"] = 42
        revocationReadyA["segment_index"] = 0
        if case .pending = controller.ready(
            callerCanvasID: "stage",
            payload: revocationReadyA
        ) {
        } else {
            require(false, "revocation capture first display did not stage")
        }
        var revocationReadyB = revocationReadyA
        revocationReadyB["segment_display_id"] = 43
        revocationReadyB["segment_index"] = 1
        if case .commit = controller.ready(
            callerCanvasID: "stage",
            payload: revocationReadyB
        ) {
        } else {
            require(false, "revocation capture did not enter presentation")
        }
        let abortCount = aborts.count
        capabilityEnabled = false
        require(controller.cancelUnauthorized(), "revoked authorization did not cancel capture")
        require(aborts.count == abortCount + 1, "revocation did not notify exact consumers")
        require(
            aborts.last?.requestID == revocationDelivery.requestID,
            "revocation aborted the wrong request"
        )
        capabilityEnabled = true

        capturer.deferred = true
        var lateResult: Result<AOSDesktopFrameCaptureDelivery, Error>?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { lateResult = $0 }
        scheduledDeadlines.last?()
        require(capturer.canceled > 0, "hung capture deadline did not cancel native work")
        capturer.deferred = false
        var recoveryDelivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { recoveryDelivery = try? $0.get() }
        require(recoveryDelivery != nil, "capture deadline wedged the capability")
        _ = controller.releaseAll(callerCanvasID: "stage")
        capturer.pending?(.success(capturer.result([42, 43])))
        require(lateResult == nil, "late native result escaped after deadline cancellation")
        require(store.count() == 0, "late capture retained pixels")

        let output: [String: Any] = [
            "captureDurationMs": response["capture_duration_ms"] as! Int,
            "displayCount": frames.count,
            "excludedWindowCount": capturer.excludedWindowIDs.count,
            "maximumPixels": capturer.maximumPixels,
            "storeBound": AOSDesktopFrameStore.maximumEntries,
        ]
        let encoded = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        print(String(data: encoded, encoding: .utf8)!)
    }
}
`)
  const moduleCache = path.join(root, 'module-cache')
  await mkdir(moduleCache, { mode: 0o700 })
  execFileSync('swiftc', [
    '-parse-as-library',
    taskStateSource,
    storeSource,
    controllerSource,
    main,
    '-o',
    executable,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCache,
      SWIFT_MODULECACHE_PATH: moduleCache,
    },
    stdio: 'pipe',
  })
  return executable
}

test('native desktop-frame epoch is capability-bound, generation-safe, one-shot, and content-free', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-desktop-frame-native-'))
  try {
    const executable = await compileHarness(root)
    const result = spawnSync(executable, [], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      captureDurationMs: 14,
      displayCount: 2,
      excludedWindowCount: 2,
      maximumPixels: 1_048_576,
      storeBound: 16,
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('daemon desktop-frame routing uses exact consumers and the decode-ready barrier', async () => {
  const unified = await readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  const surface = await readFile(
    path.join(repoRoot, 'src/display/desktop-world-surface.swift'),
    'utf8',
  )
  const route = unified.slice(
    unified.indexOf('private func handleDesktopFrameAcquire'),
    unified.indexOf('// MARK: - Connection Handling'),
  )
  assert.match(route, /desktop_frame\.started/u)
  assert.match(route, /desktop_frame\.available/u)
  assert.match(route, /desktop_frame\.commit/u)
  assert.match(route, /desktop_frame\.complete/u)
  assert.match(route, /desktop_frame\.abort/u)
  assert.match(unified, /desktop_frame\.presented/u)
  assert.match(unified, /desktopFrameCapture\.cancelUnauthorized\(\)/u)
  assert.match(route, /exactDesktopFrameConsumers/u)
  assert.doesNotMatch(route, /postMessageToCurrentCanvasAsync/u)
  assert.match(surface, /type == "desktop_frame\.ready"/u)
  assert.match(surface, /type == "desktop_frame\.presented"/u)
  assert.match(surface, /type == "desktop_frame\.cancel"/u)
  assert.match(surface, /type == "desktop_frame\.release"/u)
})

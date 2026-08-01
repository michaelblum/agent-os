import Foundation
import WebKit

struct AOSDesktopFrameConsumerIdentity: Hashable {
    let canvasID: String
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
    let displayID: UInt32
    let segmentIndex: Int
    let webViewID: ObjectIdentifier
}

struct AOSDesktopFrameCaptureContext: Equatable {
    let canvasGeneration: UInt64
    let canvasID: String
    let consumers: [AOSDesktopFrameConsumerIdentity]
    let displayLayout: AOSDesktopWorldDisplayLayout
    let excludingWindowIDs: [Int]
    let topologyGeneration: UInt64

    init?(
        canvasID: String,
        consumers: [AOSDesktopFrameConsumerIdentity],
        displayLayout: AOSDesktopWorldDisplayLayout,
        excludingWindowIDs: [Int]
    ) {
        let ordered = consumers.sorted { left, right in
            left.segmentIndex == right.segmentIndex
                ? left.displayID < right.displayID
                : left.segmentIndex < right.segmentIndex
        }
        guard !canvasID.isEmpty,
              let first = ordered.first,
              Set(ordered.map(\.displayID)).count == ordered.count,
              Set(ordered.map(\.segmentIndex)).count == ordered.count,
              displayLayout.matches(indexedDisplays: ordered.map {
                  (displayID: $0.displayID, index: $0.segmentIndex)
              }),
              ordered.allSatisfy({
                  $0.canvasID == canvasID
                      && $0.canvasGeneration == first.canvasGeneration
                      && $0.topologyGeneration == first.topologyGeneration
              }) else {
            return nil
        }
        self.canvasGeneration = first.canvasGeneration
        self.canvasID = canvasID
        self.consumers = ordered
        self.displayLayout = displayLayout
        self.excludingWindowIDs = Array(Set(excludingWindowIDs)).sorted()
        self.topologyGeneration = first.topologyGeneration
    }

    var displayIDs: [UInt32] { consumers.map(\.displayID) }
}

struct AOSDesktopFrameLeaseIdentity: Equatable {
    let canvasID: String
    let canvasGeneration: UInt64
    let extensionReference: AOSSceneExtensionReference
    let ownerID: String
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64
}

struct AOSDesktopFrameStoreFrame {
    let consumer: AOSDesktopFrameConsumerIdentity
    let data: Data
    let height: Int
    let mimeType: String
    let width: Int
}

struct AOSDesktopFrameLeaseSnapshot: Equatable {
    let epochID: String
    let handle: String
    let height: Int
    let mimeType: String
    let ownerCanvasID: String
    let url: String
    let width: Int
}

enum AOSDesktopFrameStoreFailure: Error {
    case invalidFrame
    case invalidHandle
    case notFound
    case oversizedFrame
    case unauthorized
}

final class AOSDesktopFrameStore {
    static let routePrefix = "/.aos-desktop-frame/v1/"
    static let maximumEntries = 16
    static let maximumEncodedBytes = 8 * 1024 * 1024
    static let leaseLifetime: TimeInterval = 5

    typealias ExpirationScheduler = (
        _ delay: TimeInterval,
        _ action: @escaping () -> Void
    ) -> Void

    private struct Entry {
        let consumer: AOSDesktopFrameConsumerIdentity
        let createdAt: Date
        let data: Data
        let epochID: String
        let expiresAt: Date
        let height: Int
        let leaseIdentity: AOSDesktopFrameLeaseIdentity
        let mimeType: String
        let ownerCanvasID: String
        let width: Int
    }

    private let lock = NSLock()
    private let scheduleExpiration: ExpirationScheduler
    private var entries: [String: Entry] = [:]

    init(scheduleExpiration: @escaping ExpirationScheduler = { delay, action in
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + delay,
            execute: action
        )
    }) {
        self.scheduleExpiration = scheduleExpiration
    }

    private func cleanupExpiredLocked(now: Date) {
        entries = entries.filter { $0.value.expiresAt > now }
    }

    private func encodedByteCountLocked() -> Int {
        entries.values.reduce(into: 0) { total, entry in
            total += entry.data.count
        }
    }

    private func oldestEpochLocked() -> String? {
        entries.values.min(by: { $0.createdAt < $1.createdAt })?.epochID
    }

    private func removeEpochLocked(_ epochID: String) {
        entries = entries.filter { $0.value.epochID != epochID }
    }

    private func expire(handle: String, expectedExpiry: Date) {
        lock.lock()
        defer { lock.unlock() }
        guard entries[handle]?.expiresAt == expectedExpiry else { return }
        entries.removeValue(forKey: handle)
    }

    func insert(
        data: Data,
        mimeType: String,
        ownerCanvasID: String,
        consumer: AOSDesktopFrameConsumerIdentity,
        leaseIdentity: AOSDesktopFrameLeaseIdentity,
        epochID: String,
        width: Int,
        height: Int,
        now: Date = Date()
    ) throws -> AOSDesktopFrameLeaseSnapshot {
        guard let snapshot = try insertEpoch(
            frames: [AOSDesktopFrameStoreFrame(
                consumer: consumer,
                data: data,
                height: height,
                mimeType: mimeType,
                width: width
            )],
            leaseIdentity: leaseIdentity,
            ownerCanvasID: ownerCanvasID,
            epochID: epochID,
            now: now
        ).first else {
            throw AOSDesktopFrameStoreFailure.invalidFrame
        }
        return snapshot
    }

    func insertEpoch(
        frames: [AOSDesktopFrameStoreFrame],
        leaseIdentity: AOSDesktopFrameLeaseIdentity,
        ownerCanvasID: String,
        epochID: String,
        now: Date = Date()
    ) throws -> [AOSDesktopFrameLeaseSnapshot] {
        let normalizedEpochID = epochID.lowercased()
        guard !frames.isEmpty,
              frames.count <= Self.maximumEntries,
              UUID(uuidString: epochID) != nil,
              ownerCanvasID == leaseIdentity.canvasID,
              leaseIdentity.resourceRevision >= 0,
              Set(frames.map(\.consumer)).count == frames.count,
              frames.allSatisfy({
                  $0.consumer.canvasID == ownerCanvasID
                      && $0.consumer.canvasGeneration == leaseIdentity.canvasGeneration
                      && $0.consumer.topologyGeneration == leaseIdentity.topologyGeneration
                      && ["image/jpeg", "image/png"].contains($0.mimeType)
                      && $0.width > 0
                      && $0.height > 0
                      && $0.width <= 4096
                      && $0.height <= 4096
                      && !$0.data.isEmpty
              }) else {
            throw AOSDesktopFrameStoreFailure.invalidFrame
        }
        let epochBytes = frames.reduce(into: 0) { total, frame in
            total += frame.data.count
        }
        guard epochBytes <= Self.maximumEncodedBytes else {
            throw AOSDesktopFrameStoreFailure.oversizedFrame
        }

        let expiresAt = now.addingTimeInterval(Self.leaseLifetime)
        let handles = frames.map { _ in UUID().uuidString.lowercased() }
        lock.lock()
        cleanupExpiredLocked(now: now)
        while (
            entries.count + frames.count > Self.maximumEntries
                || encodedByteCountLocked() + epochBytes > Self.maximumEncodedBytes
        ), let oldestEpoch = oldestEpochLocked() {
            removeEpochLocked(oldestEpoch)
        }
        guard entries.count + frames.count <= Self.maximumEntries,
              encodedByteCountLocked() + epochBytes <= Self.maximumEncodedBytes else {
            lock.unlock()
            throw AOSDesktopFrameStoreFailure.oversizedFrame
        }
        for (index, frame) in frames.enumerated() {
            entries[handles[index]] = Entry(
                consumer: frame.consumer,
                createdAt: now,
                data: frame.data,
                epochID: normalizedEpochID,
                expiresAt: expiresAt,
                height: frame.height,
                leaseIdentity: leaseIdentity,
                mimeType: frame.mimeType,
                ownerCanvasID: ownerCanvasID,
                width: frame.width
            )
        }
        lock.unlock()

        for handle in handles {
            scheduleExpiration(Self.leaseLifetime) { [weak self] in
                self?.expire(handle: handle, expectedExpiry: expiresAt)
            }
        }
        return zip(frames, handles).map { frame, handle in
            AOSDesktopFrameLeaseSnapshot(
                epochID: normalizedEpochID,
                handle: handle,
                height: frame.height,
                mimeType: frame.mimeType,
                ownerCanvasID: ownerCanvasID,
                url: "aos://toolkit\(Self.routePrefix)\(handle)/frame",
                width: frame.width
            )
        }
    }

    func take(
        handle: String,
        consumer: AOSDesktopFrameConsumerIdentity,
        authorize: (AOSDesktopFrameLeaseIdentity) -> Bool,
        now: Date = Date()
    ) throws -> (data: Data, mimeType: String) {
        guard UUID(uuidString: handle) != nil else {
            throw AOSDesktopFrameStoreFailure.invalidHandle
        }
        lock.lock()
        defer { lock.unlock() }
        cleanupExpiredLocked(now: now)
        let key = handle.lowercased()
        guard let entry = entries[key] else {
            throw AOSDesktopFrameStoreFailure.notFound
        }
        guard entry.consumer == consumer else {
            throw AOSDesktopFrameStoreFailure.unauthorized
        }
        guard authorize(entry.leaseIdentity) else {
            removeEpochLocked(entry.epochID)
            throw AOSDesktopFrameStoreFailure.unauthorized
        }
        entries.removeValue(forKey: key)
        return (entry.data, entry.mimeType)
    }

    @discardableResult
    func release(handle: String, ownerCanvasID: String) -> Bool {
        guard UUID(uuidString: handle) != nil else { return false }
        lock.lock()
        defer { lock.unlock() }
        let key = handle.lowercased()
        guard entries[key]?.ownerCanvasID == ownerCanvasID else { return false }
        entries.removeValue(forKey: key)
        return true
    }

    @discardableResult
    func release(epochID: String, ownerCanvasID: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let handles = entries.compactMap {
            $0.value.ownerCanvasID == ownerCanvasID && $0.value.epochID == epochID.lowercased()
                ? $0.key
                : nil
        }
        for handle in handles {
            entries.removeValue(forKey: handle)
        }
        return handles.count
    }

    @discardableResult
    func releaseAll(ownerCanvasID: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let handles = entries.compactMap { $0.value.ownerCanvasID == ownerCanvasID ? $0.key : nil }
        for handle in handles {
            entries.removeValue(forKey: handle)
        }
        return handles.count
    }

    func count(now: Date = Date()) -> Int {
        lock.lock()
        defer { lock.unlock() }
        cleanupExpiredLocked(now: now)
        return entries.count
    }
}

final class AOSDesktopFrameSchemeHandler: NSObject, WKURLSchemeHandler {
    private enum LoadOutcome {
        case failure(URLError)
        case success(url: URL, data: Data, mimeType: String)
    }

    private let store: AOSDesktopFrameStore
    private let authorize: (AOSDesktopFrameLeaseIdentity) -> Bool
    private let identityResolver: (WKWebView) -> AOSDesktopFrameConsumerIdentity?
    private let loadQueue = DispatchQueue(label: "io.agent-os.desktop-frame-loader", qos: .userInteractive)
    private let taskState = AOSSceneExtensionSchemeTaskState()

    init(
        store: AOSDesktopFrameStore,
        authorize: @escaping (AOSDesktopFrameLeaseIdentity) -> Bool,
        identityResolver: @escaping (WKWebView) -> AOSDesktopFrameConsumerIdentity?
    ) {
        self.store = store
        self.authorize = authorize
        self.identityResolver = identityResolver
    }

    func handles(_ url: URL) -> Bool {
        url.scheme == "aos"
            && url.host == "toolkit"
            && url.path.hasPrefix(AOSDesktopFrameStore.routePrefix)
    }

    private func handle(from url: URL) throws -> String {
        guard handles(url), url.query == nil else {
            throw AOSDesktopFrameStoreFailure.invalidHandle
        }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 4,
              parts[0] == ".aos-desktop-frame",
              parts[1] == "v1",
              parts[3] == "frame",
              UUID(uuidString: parts[2]) != nil else {
            throw AOSDesktopFrameStoreFailure.invalidHandle
        }
        return parts[2].lowercased()
    }

    func frameData(
        for url: URL,
        consumer: AOSDesktopFrameConsumerIdentity
    ) throws -> (data: Data, mimeType: String) {
        try store.take(
            handle: handle(from: url),
            consumer: consumer,
            authorize: authorize
        )
    }

    private func complete(
        taskID: ObjectIdentifier,
        task: WKURLSchemeTask,
        outcome: LoadOutcome
    ) {
        taskState.complete(taskID) {
            switch outcome {
            case .failure(let error):
                task.didFailWithError(error)
            case .success(let url, let data, let mimeType):
                let response = URLResponse(
                    url: url,
                    mimeType: mimeType,
                    expectedContentLength: data.count,
                    textEncodingName: nil
                )
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func startTask(
        _ urlSchemeTask: WKURLSchemeTask,
        consumer: AOSDesktopFrameConsumerIdentity?
    ) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard taskState.start(taskID) else { return }
        guard let url = urlSchemeTask.request.url, let consumer else {
            complete(
                taskID: taskID,
                task: urlSchemeTask,
                outcome: .failure(URLError(.noPermissionsToReadFile))
            )
            return
        }
        loadQueue.async { [weak self] in
            guard let self else { return }
            do {
                let frame = try self.frameData(for: url, consumer: consumer)
                self.complete(
                    taskID: taskID,
                    task: urlSchemeTask,
                    outcome: .success(url: url, data: frame.data, mimeType: frame.mimeType)
                )
            } catch {
                self.complete(
                    taskID: taskID,
                    task: urlSchemeTask,
                    outcome: .failure(URLError(.noPermissionsToReadFile))
                )
            }
        }
    }

    func stopTask(_ urlSchemeTask: WKURLSchemeTask) {
        taskState.stop(ObjectIdentifier(urlSchemeTask as AnyObject))
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        startTask(urlSchemeTask, consumer: identityResolver(webView))
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        stopTask(urlSchemeTask)
    }
}

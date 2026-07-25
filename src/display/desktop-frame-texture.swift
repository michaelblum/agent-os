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
        epochID: String,
        width: Int,
        height: Int,
        now: Date = Date()
    ) throws -> AOSDesktopFrameLeaseSnapshot {
        guard ownerCanvasID == consumer.canvasID,
              UUID(uuidString: epochID) != nil,
              ["image/jpeg", "image/png"].contains(mimeType),
              width > 0,
              height > 0,
              width <= 4096,
              height <= 4096 else {
            throw AOSDesktopFrameStoreFailure.invalidFrame
        }
        guard !data.isEmpty, data.count <= Self.maximumEncodedBytes else {
            throw AOSDesktopFrameStoreFailure.oversizedFrame
        }

        let handle = UUID().uuidString.lowercased()
        let expiresAt = now.addingTimeInterval(Self.leaseLifetime)
        lock.lock()
        cleanupExpiredLocked(now: now)
        var encodedBytes = encodedByteCountLocked()
        while (
            entries.count >= Self.maximumEntries
                || encodedBytes + data.count > Self.maximumEncodedBytes
        ), let oldest = entries.min(by: { $0.value.createdAt < $1.value.createdAt })?.key {
            if let removed = entries.removeValue(forKey: oldest) {
                encodedBytes -= removed.data.count
            }
        }
        guard encodedBytes + data.count <= Self.maximumEncodedBytes else {
            lock.unlock()
            throw AOSDesktopFrameStoreFailure.oversizedFrame
        }
        entries[handle] = Entry(
            consumer: consumer,
            createdAt: now,
            data: data,
            epochID: epochID.lowercased(),
            expiresAt: expiresAt,
            height: height,
            mimeType: mimeType,
            ownerCanvasID: ownerCanvasID,
            width: width
        )
        lock.unlock()
        scheduleExpiration(Self.leaseLifetime) { [weak self] in
            self?.expire(handle: handle, expectedExpiry: expiresAt)
        }
        return AOSDesktopFrameLeaseSnapshot(
            epochID: epochID.lowercased(),
            handle: handle,
            height: height,
            mimeType: mimeType,
            ownerCanvasID: ownerCanvasID,
            url: "aos://toolkit\(Self.routePrefix)\(handle)/frame",
            width: width
        )
    }

    func take(
        handle: String,
        consumer: AOSDesktopFrameConsumerIdentity,
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
    private let identityResolver: (WKWebView) -> AOSDesktopFrameConsumerIdentity?
    private let loadQueue = DispatchQueue(label: "io.agent-os.desktop-frame-loader", qos: .userInteractive)
    private let taskState = AOSSceneExtensionSchemeTaskState()

    init(
        store: AOSDesktopFrameStore,
        identityResolver: @escaping (WKWebView) -> AOSDesktopFrameConsumerIdentity?
    ) {
        self.store = store
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
        try store.take(handle: handle(from: url), consumer: consumer)
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

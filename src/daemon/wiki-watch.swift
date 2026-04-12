// wiki-watch.swift — FSEvents watcher for the wiki directory (Task 4)
//
// Watches wikiRoot for .md file changes and emits wiki_page_changed events
// via WikiChangeBus with ~100ms debounce.

import Foundation

final class WikiWatcher {
    private var stream: FSEventStreamRef?
    private let wikiRoot: URL
    private let debounceMs: Int = 100
    private var pendingPaths: [String: (op: WikiChangeOp, fireAt: DispatchTime)] = [:]
    private let queue = DispatchQueue(label: "aos.wiki.watch")

    init(wikiRoot: URL) {
        self.wikiRoot = wikiRoot
    }

    deinit {
        stop()
    }

    func start() {
        // Ensure the wiki directory exists so FSEvents has something to watch.
        try? FileManager.default.createDirectory(at: wikiRoot, withIntermediateDirectories: true)

        let callback: FSEventStreamCallback = { _, info, numEvents, eventPaths, eventFlags, _ in
            guard let info = info else { return }
            let watcher = Unmanaged<WikiWatcher>.fromOpaque(info).takeUnretainedValue()
            let pathsPtr = unsafeBitCast(eventPaths, to: UnsafePointer<UnsafePointer<CChar>>.self)
            for i in 0..<numEvents {
                let p = String(cString: pathsPtr[i])
                let f = eventFlags[i]
                watcher.handle(path: p, flags: f)
            }
        }

        var ctx = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let paths = [wikiRoot.path] as CFArray
        stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &ctx,
            paths,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1,  // latency: 100ms coalesce window in FSEvents itself
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer)
        )

        if let s = stream {
            FSEventStreamSetDispatchQueue(s, queue)
            FSEventStreamStart(s)
            fputs("wiki-watch: watching \(wikiRoot.path)\n", stderr)
        } else {
            fputs("wiki-watch: failed to create FSEventStream for \(wikiRoot.path)\n", stderr)
        }
    }

    func stop() {
        if let s = stream {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
            FSEventStreamRelease(s)
            stream = nil
        }
    }

    // MARK: - Event handling

    private func handle(path: String, flags: FSEventStreamEventFlags) {
        // Only care about paths under wikiRoot
        let rootPath = wikiRoot.path
        guard path.hasPrefix(rootPath) else { return }

        // Strip the root prefix (plus the trailing slash)
        let afterRoot = path.dropFirst(rootPath.count)
        let rel: String
        if afterRoot.hasPrefix("/") {
            rel = String(afterRoot.dropFirst())
        } else {
            rel = String(afterRoot)
        }

        // Only .md files
        guard rel.hasSuffix(".md"), !rel.isEmpty else { return }

        let isItemRemoved = (flags & UInt32(kFSEventStreamEventFlagItemRemoved)) != 0
        let isItemCreated = (flags & UInt32(kFSEventStreamEventFlagItemCreated)) != 0
        let fileExists = FileManager.default.fileExists(atPath: path)

        let op: WikiChangeOp
        if isItemRemoved && !fileExists {
            op = .deleted
        } else if isItemCreated && fileExists {
            op = .created
        } else {
            op = .updated
        }

        // Debounce: schedule emit after debounceMs; cancel if superseded
        let fireAt = DispatchTime.now() + .milliseconds(debounceMs)
        pendingPaths[rel] = (op, fireAt)

        queue.asyncAfter(deadline: fireAt) { [weak self] in
            guard let self = self,
                  let pending = self.pendingPaths[rel],
                  pending.fireAt <= DispatchTime.now() + .milliseconds(10) else { return }
            self.pendingPaths.removeValue(forKey: rel)
            WikiChangeBus.shared.emit(path: rel, op: pending.op)
        }
    }
}

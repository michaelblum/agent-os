import Foundation

final class VoicePolicyWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private let path: String
    private let dirPath: String
    private let store: VoicePolicyStore
    private let queue = DispatchQueue(label: "aos.voice.policy-watcher")
    var onChange: ((VoicePolicy) -> Void)?

    /// Pass the bus-owned store so `reload()` invalidates the cache that
    /// `VoiceRegistry`'s `policyLoader` reads through.
    init(store: VoicePolicyStore) {
        self.store = store
        self.path = store.filePath
        self.dirPath = (store.filePath as NSString).deletingLastPathComponent
    }

    /// Convenience for tests / standalone callers without a bus.
    convenience init(path: String = aosVoicePolicyPath()) {
        self.init(store: VoicePolicyStore(path: path))
    }

    func start() {
        try? FileManager.default.createDirectory(atPath: dirPath, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: path) {
            store.save(.empty)
        }
        // Watch the parent directory, not the file. The directory fd survives
        // VoicePolicyStore.save()'s write-tmp + remove + rename cycle; a
        // file-fd would be left attached to the old inode after rename.
        fd = open(dirPath, O_EVTONLY)
        guard fd >= 0 else {
            fputs("Warning: cannot watch voice policy directory at \(dirPath)\n", stderr); return
        }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write],
            queue: queue
        )
        src.setEventHandler { [weak self] in
            guard let self else { return }
            // Directory `.write` fires for any in-dir entry change; reload
            // unconditionally - the .tmp create + rename of policy.json
            // collapses to one observable change after the brief debounce.
            usleep(50_000)
            let policy = self.store.reload()
            self.onChange?(policy)
        }
        src.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.fd >= 0 { close(self.fd); self.fd = -1 }
        }
        src.resume()
        self.source = src
    }

    func stop() {
        source?.cancel(); source = nil
    }
}

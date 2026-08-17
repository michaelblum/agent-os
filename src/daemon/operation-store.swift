import Darwin
import Foundation

protocol AOSOperationStateStore: AnyObject {
    func load() throws -> AOSOperationDurableState?
    func save(_ state: AOSOperationDurableState) throws
}

final class AOSInMemoryOperationStateStore: AOSOperationStateStore {
    private let lock = NSLock()
    private var value: AOSOperationDurableState?
    private(set) var saveCount = 0
    private(set) var savedStates: [AOSOperationDurableState] = []
    var failNextSave = false

    init(initial: AOSOperationDurableState? = nil) {
        value = initial
    }

    func load() throws -> AOSOperationDurableState? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        if failNextSave {
            failNextSave = false
            throw AOSOperationCoreError.storeUnavailable
        }
        value = state
        saveCount += 1
        savedStates.append(state)
    }
}

final class AOSFileOperationStateStore: AOSOperationStateStore {
    static let recordName = "operation-control-state.json"
    static let maximumRecordBytes = 16 * 1024 * 1024

    private let rootFD: Int32
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let lock = NSLock()

    init(rootURL: URL) throws {
        guard rootURL.path.hasPrefix("/"), !rootURL.path.isEmpty else {
            throw AOSOperationCoreError.invalidRecord("store_root")
        }
        var rootStat = stat()
        if lstat(rootURL.path, &rootStat) != 0 {
            guard errno == ENOENT else { throw AOSOperationCoreError.storeUnavailable }
            if mkdir(rootURL.path, mode_t(0o700)) != 0 {
                throw AOSOperationCoreError.storeUnavailable
            }
            guard lstat(rootURL.path, &rootStat) == 0 else {
                throw AOSOperationCoreError.storeUnavailable
            }
        }
        guard (rootStat.st_mode & S_IFMT) == S_IFDIR,
              (rootStat.st_mode & mode_t(0o777)) == mode_t(0o700),
              rootStat.st_uid == geteuid() else {
            throw AOSOperationCoreError.storeCorrupt
        }

        let descriptor = open(rootURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw AOSOperationCoreError.storeUnavailable }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw AOSOperationCoreError.storeLocked
        }
        var openedStat = stat()
        guard fstat(descriptor, &openedStat) == 0,
              openedStat.st_dev == rootStat.st_dev,
              openedStat.st_ino == rootStat.st_ino,
              (openedStat.st_mode & S_IFMT) == S_IFDIR,
              (openedStat.st_mode & mode_t(0o777)) == mode_t(0o700),
              openedStat.st_uid == geteuid() else {
            flock(descriptor, LOCK_UN)
            Darwin.close(descriptor)
            throw AOSOperationCoreError.storeCorrupt
        }
        rootFD = descriptor
        encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        decoder = JSONDecoder()
    }

    deinit {
        flock(rootFD, LOCK_UN)
        Darwin.close(rootFD)
    }

    func load() throws -> AOSOperationDurableState? {
        lock.lock()
        defer { lock.unlock() }
        let fd = openat(rootFD, Self.recordName, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if fd < 0 {
            if errno == ENOENT { return nil }
            throw AOSOperationCoreError.storeUnavailable
        }
        defer { Darwin.close(fd) }
        try validateRecordDescriptor(fd)
        let data = try readAll(fd)
        guard !data.isEmpty,
              let value = try? decoder.decode(AOSOperationDurableState.self, from: data),
              value.schema == AOSOperationDurableState.schemaVersion else {
            throw AOSOperationCoreError.storeCorrupt
        }
        return value
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        guard state.schema == AOSOperationDurableState.schemaVersion,
              let data = try? encoder.encode(state),
              !data.isEmpty,
              data.count <= Self.maximumRecordBytes else {
            throw AOSOperationCoreError.invalidRecord("durable_state")
        }

        let temporaryName = ".operation-control-state.\(UUID().uuidString.lowercased()).tmp"
        let fd = openat(
            rootFD,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard fd >= 0 else { throw AOSOperationCoreError.storeUnavailable }
        var removeTemporary = true
        defer {
            Darwin.close(fd)
            if removeTemporary { _ = unlinkat(rootFD, temporaryName, 0) }
        }
        do {
            try validateWritableDescriptor(fd)
            try writeAll(data, to: fd)
            guard fsync(fd) == 0 else { throw AOSOperationCoreError.storeUnavailable }
            guard renameat(rootFD, temporaryName, rootFD, Self.recordName) == 0 else {
                throw AOSOperationCoreError.storeUnavailable
            }
            removeTemporary = false
            guard fsync(rootFD) == 0 else { throw AOSOperationCoreError.storeUnavailable }
            try verifyPublishedRecord(expected: data)
        } catch let error as AOSOperationCoreError {
            throw error
        } catch {
            throw AOSOperationCoreError.storeUnavailable
        }
    }

    private func validateRecordDescriptor(_ fd: Int32) throws {
        var value = stat()
        guard fstat(fd, &value) == 0,
              (value.st_mode & S_IFMT) == S_IFREG,
              (value.st_mode & mode_t(0o777)) == mode_t(0o600),
              value.st_uid == geteuid(),
              value.st_nlink == 1,
              value.st_size > 0,
              value.st_size <= off_t(Self.maximumRecordBytes) else {
            throw AOSOperationCoreError.storeCorrupt
        }
    }

    private func validateWritableDescriptor(_ fd: Int32) throws {
        var value = stat()
        guard fstat(fd, &value) == 0,
              (value.st_mode & S_IFMT) == S_IFREG,
              (value.st_mode & mode_t(0o777)) == mode_t(0o600),
              value.st_uid == geteuid(),
              value.st_nlink == 1 else {
            throw AOSOperationCoreError.storeCorrupt
        }
    }

    private func readAll(_ fd: Int32) throws -> Data {
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { return result }
            if count < 0 {
                if errno == EINTR { continue }
                throw AOSOperationCoreError.storeUnavailable
            }
            guard result.count + count <= Self.maximumRecordBytes else {
                throw AOSOperationCoreError.storeCorrupt
            }
            result.append(buffer, count: count)
        }
    }

    private func writeAll(_ data: Data, to fd: Int32) throws {
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { throw AOSOperationCoreError.storeUnavailable }
            var offset = 0
            while offset < rawBuffer.count {
                let count = Darwin.write(fd, base.advanced(by: offset), rawBuffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw AOSOperationCoreError.storeUnavailable
                }
                guard count > 0 else { throw AOSOperationCoreError.storeUnavailable }
                offset += count
            }
        }
    }

    private func verifyPublishedRecord(expected: Data) throws {
        let fd = openat(rootFD, Self.recordName, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard fd >= 0 else { throw AOSOperationCoreError.storeUnavailable }
        defer { Darwin.close(fd) }
        try validateRecordDescriptor(fd)
        let actual = try readAll(fd)
        guard actual == expected else { throw AOSOperationCoreError.storeCorrupt }
    }
}

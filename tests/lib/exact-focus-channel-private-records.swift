import Darwin
import Foundation

let exactFocusFixtureResultMaxBytes = 2_048
let exactFocusCloseAckMaxBytes = 128
let exactFocusFixtureCleanupMaxBytes = 256

private func exactFocusHeldDestination(
    _ destination: URL,
    descriptor: Int32,
    byteCount: Int,
    permissions: mode_t
) -> Bool {
    var held = stat()
    var named = stat()
    return Darwin.fstat(descriptor, &held) == 0
        && Darwin.lstat(destination.path, &named) == 0
        && held.st_mode & S_IFMT == S_IFREG
        && named.st_mode & S_IFMT == S_IFREG
        && held.st_dev == named.st_dev && held.st_ino == named.st_ino
        && held.st_nlink == 1 && named.st_nlink == 1
        && held.st_size == off_t(byteCount) && named.st_size == off_t(byteCount)
        && held.st_mode & mode_t(0o777) == permissions
        && named.st_mode & mode_t(0o777) == permissions
}

private func exactFocusFsyncParent(of destination: URL) -> Bool {
    let descriptor = Darwin.open(
        destination.deletingLastPathComponent().path,
        O_RDONLY | O_DIRECTORY | O_CLOEXEC
    )
    guard descriptor >= 0 else { return false }
    defer { _ = Darwin.close(descriptor) }
    if Darwin.fsync(descriptor) == 0 { return true }
    return errno == EINVAL || errno == ENOTSUP
}

func publishExactFocusPrivateJSON(
    _ encoded: Data,
    to destination: URL,
    maximumBytes: Int,
    beforeReadiness: (() throws -> Void)? = nil
) -> Bool {
    var bytes = encoded
    bytes.append(0x0A)
    guard maximumBytes > 0,
          !encoded.isEmpty,
          bytes.count <= maximumBytes,
          !encoded.contains(0x0A),
          !encoded.contains(0x0D) else { return false }
    let descriptor = Darwin.open(
        destination.path,
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
        mode_t(0)
    )
    guard descriptor >= 0 else { return false }
    defer { _ = Darwin.close(descriptor) }
    guard Darwin.fchmod(descriptor, mode_t(0)) == 0,
          exactFocusHeldDestination(
              destination, descriptor: descriptor, byteCount: 0, permissions: mode_t(0)
          ) else { return false }
    let fullyWritten = bytes.withUnsafeBytes { rawBytes -> Bool in
        guard let base = rawBytes.baseAddress else { return false }
        var offset = 0
        while offset < rawBytes.count {
            let count = Darwin.pwrite(
                descriptor,
                base.advanced(by: offset),
                rawBytes.count - offset,
                off_t(offset)
            )
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { return false }
            offset += count
        }
        return true
    }
    guard fullyWritten,
          exactFocusHeldDestination(
              destination, descriptor: descriptor, byteCount: bytes.count, permissions: mode_t(0)
          ),
          Darwin.fsync(descriptor) == 0 else { return false }
    do { try beforeReadiness?() } catch { return false }
    guard exactFocusHeldDestination(
        destination, descriptor: descriptor, byteCount: bytes.count, permissions: mode_t(0)
    ), exactFocusFsyncParent(of: destination), exactFocusHeldDestination(
        destination, descriptor: descriptor, byteCount: bytes.count, permissions: mode_t(0)
    ), Darwin.fchmod(descriptor, mode_t(S_IRUSR | S_IWUSR)) == 0 else { return false }
    return true
}

func writeExactFocusPrivateJSON<T: Encodable>(
    _ value: T,
    to destination: URL,
    maximumBytes: Int,
    beforeReadiness: (() throws -> Void)? = nil
) -> Bool {
    guard let data = try? JSONEncoder.exactFocusSorted.encode(value) else { return false }
    return publishExactFocusPrivateJSON(
        data,
        to: destination,
        maximumBytes: maximumBytes,
        beforeReadiness: beforeReadiness
    )
}

func writeExactFocusPrivateJSON(
    _ value: [String: Any],
    to destination: URL,
    maximumBytes: Int,
    beforeReadiness: (() throws -> Void)? = nil
) -> Bool {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        return false
    }
    return publishExactFocusPrivateJSON(
        data,
        to: destination,
        maximumBytes: maximumBytes,
        beforeReadiness: beforeReadiness
    )
}

extension JSONEncoder {
    static var exactFocusSorted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

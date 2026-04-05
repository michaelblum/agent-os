// connection.swift — Unix domain socket lifecycle.
//
// Lowest layer of the shared IPC library. Handles connect with timeout,
// sockaddr construction, poll-based read, close. No JSON awareness.

import Foundation

// MARK: - Default Socket Path

/// Default daemon socket path. Consumers can override per-call.
let kDefaultSocketPath: String = {
    NSString(string: "~/.config/aos/sock").expandingTildeInPath
}()

let kDefaultSocketDir: String = {
    NSString(string: "~/.config/aos").expandingTildeInPath
}()

// MARK: - Socket Address

/// Construct a sockaddr_un for the given path and pass it to a closure.
/// Returns the closure's return value.
func withSocketAddress(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = path.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    return withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            body(sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}

// MARK: - Connect

/// Connect to a Unix domain socket. Returns fd >= 0 on success, -1 on failure.
/// Uses non-blocking connect with poll-based timeout.
func connectSocket(_ path: String = kDefaultSocketPath, timeoutMs: Int32 = 1000) -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }

    let flags = fcntl(fd, F_GETFL)
    fcntl(fd, F_SETFL, flags | O_NONBLOCK)

    let r = withSocketAddress(path) { addr, len in connect(fd, addr, len) }
    if r != 0 {
        if errno == EINPROGRESS {
            var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            let ready = poll(&pfd, 1, timeoutMs)
            if ready <= 0 { close(fd); return -1 }
            var optErr: Int32 = 0
            var optLen = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
            if optErr != 0 { close(fd); return -1 }
        } else {
            close(fd); return -1
        }
    }

    // Restore blocking mode for subsequent reads/writes
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
    return fd
}

// MARK: - Read with Timeout

/// Poll-based read. Returns bytes read, or -1 on timeout/error.
func readWithTimeout(_ fd: Int32, _ buf: inout [UInt8], _ count: Int, timeoutMs: Int32 = 2000) -> Int {
    var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    let ready = poll(&pfd, 1, timeoutMs)
    guard ready > 0 else { return -1 }
    return read(fd, &buf, count)
}

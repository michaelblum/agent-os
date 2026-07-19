import Darwin
import Foundation

struct AOSConnectionOutboundLimits {
    let maxQueuedBytes: Int
    let maxQueuedMessages: Int
    let writeTimeoutMilliseconds: Int

    static let daemonDefault = AOSConnectionOutboundLimits(
        maxQueuedBytes: 32 * 1024 * 1024,
        maxQueuedMessages: 256,
        writeTimeoutMilliseconds: 2_000
    )
}

struct AOSConnectionOutboundSnapshot {
    let pendingBytes: Int
    let pendingMessages: Int
    let maximumObservedBytes: Int
    let maximumObservedMessages: Int
    let writeSystemCalls: Int
    let closed: Bool
    let disconnectReason: String?
}

final class AOSConnectionOutboundWriter {
    let connectionID: UUID

    private enum WriteResult: Equatable {
        case success
        case timeout
        case failure
    }

    private let fd: Int32
    private let limits: AOSConnectionOutboundLimits
    private let queue: DispatchQueue
    private let stateLock = NSLock()
    private var pendingBytes = 0
    private var pendingMessages = 0
    private var maximumObservedBytes = 0
    private var maximumObservedMessages = 0
    private var writeSystemCalls = 0
    private var closed = false
    private var disconnectReason: String?

    init(
        connectionID: UUID,
        fd: Int32,
        limits: AOSConnectionOutboundLimits = .daemonDefault
    ) {
        precondition(limits.maxQueuedBytes > 0)
        precondition(limits.maxQueuedMessages > 0)
        precondition(limits.writeTimeoutMilliseconds > 0)
        self.connectionID = connectionID
        self.fd = fd
        self.limits = limits
        self.queue = DispatchQueue(label: "aos.connection-outbound.\(connectionID.uuidString)")
        if !configureSocketWriteBoundary() {
            closed = true
            disconnectReason = "outbound_socket_configuration_failed"
            shutdownConnection()
        }
    }

    @discardableResult
    func enqueue(_ frame: Data) -> Bool {
        let isNDJSONLine = !frame.isEmpty
            && frame.last == UInt8(ascii: "\n")
            && !frame.dropLast().contains(UInt8(ascii: "\n"))
        var accepted = false
        var shouldDisconnect = false

        stateLock.lock()
        if !closed {
            if !isNDJSONLine {
                closed = true
                disconnectReason = "invalid_ndjson_frame"
                shouldDisconnect = true
            } else if pendingMessages + 1 > limits.maxQueuedMessages
                        || pendingBytes + frame.count > limits.maxQueuedBytes {
                closed = true
                disconnectReason = "outbound_queue_overflow"
                shouldDisconnect = true
            } else {
                pendingMessages += 1
                pendingBytes += frame.count
                maximumObservedMessages = max(maximumObservedMessages, pendingMessages)
                maximumObservedBytes = max(maximumObservedBytes, pendingBytes)
                accepted = true
                queue.async { [self] in
                    let shouldWrite: Bool = withStateLock { !closed }
                    let result = shouldWrite ? writeFully(frame) : .failure
                    var disconnect = false
                    stateLock.lock()
                    pendingMessages -= 1
                    pendingBytes -= frame.count
                    if shouldWrite && result != .success && !closed {
                        closed = true
                        disconnectReason = result == .timeout ? "outbound_write_timeout" : "outbound_write_failed"
                        disconnect = true
                    }
                    stateLock.unlock()
                    if disconnect { shutdownConnection() }
                }
            }
        }
        stateLock.unlock()

        if shouldDisconnect {
            shutdownConnection()
            return false
        }
        return accepted
    }

    @discardableResult
    func enqueueResponse(
        _ dict: [String: Any],
        envelopeActive: Bool = false,
        envelopeRef: String? = nil
    ) -> Bool {
        guard let frame = responseJSONBytes(
            dict,
            envelopeActive: envelopeActive,
            envelopeRef: envelopeRef
        ) else { return false }
        return enqueue(frame)
    }

    func close(reason: String = "connection_closed") {
        let shouldShutdown: Bool = withStateLock {
            guard !closed else { return false }
            closed = true
            disconnectReason = reason
            return true
        }
        if shouldShutdown { shutdownConnection() }
    }

    func closeAndWait(reason: String = "connection_closed") {
        close(reason: reason)
        queue.sync {}
    }

    func snapshot() -> AOSConnectionOutboundSnapshot {
        withStateLock {
            AOSConnectionOutboundSnapshot(
                pendingBytes: pendingBytes,
                pendingMessages: pendingMessages,
                maximumObservedBytes: maximumObservedBytes,
                maximumObservedMessages: maximumObservedMessages,
                writeSystemCalls: writeSystemCalls,
                closed: closed,
                disconnectReason: disconnectReason
            )
        }
    }

    private func withStateLock<T>(_ body: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return body()
    }

    private func shutdownConnection() {
        _ = shutdown(fd, SHUT_RDWR)
    }

    private func configureSocketWriteBoundary() -> Bool {
        let currentFlags = fcntl(fd, F_GETFL)
        let nonblockingConfigured = currentFlags >= 0
            && fcntl(fd, F_SETFL, currentFlags | O_NONBLOCK) == 0
        var suppressSIGPIPE: Int32 = 1
        let signalConfigured = setsockopt(
            fd,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &suppressSIGPIPE,
            socklen_t(MemoryLayout.size(ofValue: suppressSIGPIPE))
        ) == 0
        return nonblockingConfigured && signalConfigured
    }

    private func writeFully(_ frame: Data) -> WriteResult {
        let timeoutNanos = UInt64(limits.writeTimeoutMilliseconds) * 1_000_000
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanos
        return frame.withUnsafeBytes { buffer in
            guard let baseAddress = buffer.baseAddress else { return .success }
            var offset = 0
            while offset < buffer.count {
                if withStateLock({ closed }) { return .failure }
                stateLock.lock()
                writeSystemCalls += 1
                stateLock.unlock()
                let sent = Darwin.send(
                    fd,
                    baseAddress.advanced(by: offset),
                    buffer.count - offset,
                    MSG_DONTWAIT
                )
                if sent > 0 {
                    offset += sent
                    continue
                }
                if sent == 0 { return .failure }
                if errno == EINTR { continue }
                if errno != EAGAIN && errno != EWOULDBLOCK { return .failure }

                let now = DispatchTime.now().uptimeNanoseconds
                if now >= deadline { return .timeout }
                let remainingNanos = deadline - now
                let remainingMilliseconds = max(1, (remainingNanos + 999_999) / 1_000_000)
                var descriptor = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
                let pollResult = poll(
                    &descriptor,
                    1,
                    Int32(min(remainingMilliseconds, UInt64(Int32.max)))
                )
                if pollResult == 0 { return .timeout }
                if pollResult < 0 {
                    if errno == EINTR { continue }
                    return .failure
                }
                let failedEvents = Int16(POLLERR | POLLHUP | POLLNVAL)
                if descriptor.revents & failedEvents != 0 { return .failure }
            }
            return .success
        }
    }
}

func sendResponseJSON(to writer: AOSConnectionOutboundWriter, _ dict: [String: Any]) {
    writer.enqueueResponse(dict)
}

func sendResponseJSON(
    to writer: AOSConnectionOutboundWriter,
    _ dict: [String: Any],
    envelopeActive: Bool,
    envelopeRef: String?
) {
    writer.enqueueResponse(dict, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
}

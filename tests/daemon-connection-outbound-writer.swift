import Darwin
import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

private final class LineResult {
    private let lock = NSLock()
    private var stored: [Data] = []

    func set(_ lines: [Data]) {
        lock.lock()
        stored = lines
        lock.unlock()
    }

    func get() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

private func makeSocketPair() -> (writer: Int32, reader: Int32) {
    var descriptors: [Int32] = [-1, -1]
    require(socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0, "socketpair failed")
    return (descriptors[0], descriptors[1])
}

private func setSendBuffer(_ fd: Int32, bytes: Int32) {
    var value = bytes
    require(
        setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &value, socklen_t(MemoryLayout.size(ofValue: value))) == 0,
        "could not set socket send buffer"
    )
}

private func voiceFrame(sequence: Int, payloadBytes: Int) -> Data {
    let object: [String: Any] = [
        "v": 1,
        "service": "voice",
        "event": "audio_frame",
        "ts": 1,
        "data": [
            "stream": "speech",
            "sequence": sequence,
            "payload": String(repeating: "x", count: payloadBytes),
        ],
        "ref": "voice-owner",
    ]
    var data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    data.append(UInt8(ascii: "\n"))
    return data
}

private func readLines(
    from fd: Int32,
    expectedCount: Int,
    timeoutMilliseconds: Int
) -> [Data] {
    let deadline = DispatchTime.now().uptimeNanoseconds
        + UInt64(timeoutMilliseconds) * 1_000_000
    var buffer = Data()
    var lines: [Data] = []
    var chunk = [UInt8](repeating: 0, count: 1_024)

    while lines.count < expectedCount && DispatchTime.now().uptimeNanoseconds < deadline {
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let result = poll(&descriptor, 1, 100)
        if result < 0 {
            if errno == EINTR { continue }
            break
        }
        if result == 0 { continue }
        let count = read(fd, &chunk, chunk.count)
        if count <= 0 { break }
        buffer.append(contentsOf: chunk[0..<count])
        while let newline = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            lines.append(Data(buffer[..<newline]))
            buffer.removeSubrange(...newline)
        }
        usleep(250)
    }
    return lines
}

private func waitUntil(
    timeoutMilliseconds: Int,
    _ condition: () -> Bool
) -> Bool {
    let deadline = DispatchTime.now().uptimeNanoseconds
        + UInt64(timeoutMilliseconds) * 1_000_000
    while DispatchTime.now().uptimeNanoseconds < deadline {
        if condition() { return true }
        usleep(1_000)
    }
    return condition()
}

private func peerReachedEOF(_ fd: Int32, timeoutMilliseconds: Int = 2_000) -> Bool {
    let deadline = DispatchTime.now().uptimeNanoseconds
        + UInt64(timeoutMilliseconds) * 1_000_000
    var chunk = [UInt8](repeating: 0, count: 4_096)
    while DispatchTime.now().uptimeNanoseconds < deadline {
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN | POLLHUP), revents: 0)
        let result = poll(&descriptor, 1, 100)
        if result < 0 {
            if errno == EINTR { continue }
            return false
        }
        if result == 0 { continue }
        let count = read(fd, &chunk, chunk.count)
        if count == 0 { return true }
        if count < 0 && errno != EINTR { return false }
    }
    return false
}

@main
struct DaemonConnectionOutboundWriterTest {
    static func main() {
        let activePair = makeSocketPair()
        let timeoutPair = makeSocketPair()
        let overflowPair = makeSocketPair()
        setSendBuffer(activePair.writer, bytes: 2_048)
        setSendBuffer(timeoutPair.writer, bytes: 2_048)
        setSendBuffer(overflowPair.writer, bytes: 2_048)

        let activeLimits = AOSConnectionOutboundLimits(
            maxQueuedBytes: 2 * 1024 * 1024,
            maxQueuedMessages: 64,
            writeTimeoutMilliseconds: 2_000
        )
        let timeoutLimits = AOSConnectionOutboundLimits(
            maxQueuedBytes: 8 * 1024 * 1024,
            maxQueuedMessages: 8,
            writeTimeoutMilliseconds: 150
        )
        let overflowLimits = AOSConnectionOutboundLimits(
            maxQueuedBytes: 64 * 1024,
            maxQueuedMessages: 4,
            writeTimeoutMilliseconds: 2_000
        )
        let activeWriter = AOSConnectionOutboundWriter(
            connectionID: UUID(),
            fd: activePair.writer,
            limits: activeLimits
        )
        let timeoutWriter = AOSConnectionOutboundWriter(
            connectionID: UUID(),
            fd: timeoutPair.writer,
            limits: timeoutLimits
        )
        let overflowWriter = AOSConnectionOutboundWriter(
            connectionID: UUID(),
            fd: overflowPair.writer,
            limits: overflowLimits
        )

        let voiceEventCount = 16
        let expectedLineCount = voiceEventCount + 1
        let readerDone = DispatchSemaphore(value: 0)
        let lineResult = LineResult()
        DispatchQueue.global(qos: .userInitiated).async {
            lineResult.set(readLines(
                from: activePair.reader,
                expectedCount: expectedLineCount,
                timeoutMilliseconds: 5_000
            ))
            readerDone.signal()
        }

        require(
            timeoutWriter.enqueue(voiceFrame(sequence: 0, payloadBytes: 4 * 1024 * 1024)),
            "stalled subscriber rejected its initial frame"
        )
        require(
            activeWriter.enqueueResponse(["status": "ok"], envelopeActive: true, envelopeRef: "voice-owner"),
            "active voice response was rejected"
        )
        for sequence in 0..<voiceEventCount {
            require(
                activeWriter.enqueue(voiceFrame(sequence: sequence, payloadBytes: 32 * 1024)),
                "active voice event \(sequence) was rejected"
            )
        }

        require(
            readerDone.wait(timeout: .now() + 5) == .success,
            "active voice stream was delayed by a non-reading subscriber"
        )
        let lines = lineResult.get()
        let activeAfterRead = activeWriter.snapshot()
        require(
            lines.count == expectedLineCount,
            "active voice stream lost NDJSON lines "
                + "received=\(lines.count) "
                + "closed=\(activeAfterRead.closed) "
                + "reason=\(activeAfterRead.disconnectReason ?? "none") "
                + "pending=\(activeAfterRead.pendingMessages) "
                + "write_calls=\(activeAfterRead.writeSystemCalls)"
        )
        let response = try! JSONSerialization.jsonObject(with: lines[0]) as! [String: Any]
        require(response["status"] as? String == "success", "response/event ordering drifted")
        require(response["ref"] as? String == "voice-owner", "response ref drifted")
        for sequence in 0..<voiceEventCount {
            let event = try! JSONSerialization.jsonObject(with: lines[sequence + 1]) as! [String: Any]
            require(event["service"] as? String == "voice", "non-voice event entered active stream")
            let data = event["data"] as? [String: Any]
            require(data?["sequence"] as? Int == sequence, "voice event ordering drifted")
        }

        let reachedWriteTimeout = waitUntil(timeoutMilliseconds: 2_000) {
            timeoutWriter.snapshot().disconnectReason == "outbound_write_timeout"
        }
        let timeoutAfterWait = timeoutWriter.snapshot()
        require(
            reachedWriteTimeout,
            "non-reading subscriber did not hit its bounded write timeout "
                + "closed=\(timeoutAfterWait.closed) "
                + "reason=\(timeoutAfterWait.disconnectReason ?? "none") "
                + "pending_bytes=\(timeoutAfterWait.pendingBytes) "
                + "write_calls=\(timeoutAfterWait.writeSystemCalls)"
        )
        let timeoutSnapshot = timeoutWriter.snapshot()
        require(timeoutSnapshot.closed, "timed-out subscriber remained open")
        require(
            timeoutSnapshot.maximumObservedBytes <= timeoutLimits.maxQueuedBytes,
            "timed-out subscriber exceeded its byte bound"
        )
        require(
            timeoutSnapshot.maximumObservedMessages <= timeoutLimits.maxQueuedMessages,
            "timed-out subscriber exceeded its message bound"
        )

        let overflowFrame = voiceFrame(sequence: 1, payloadBytes: 16 * 1024)
        var overflowRejected = false
        for _ in 0..<16 {
            if !overflowWriter.enqueue(overflowFrame) {
                overflowRejected = true
                break
            }
        }
        require(overflowRejected, "slow subscriber queue did not reject overflow")
        let overflowSnapshot = overflowWriter.snapshot()
        require(overflowSnapshot.closed, "overflowing subscriber remained open")
        require(
            overflowSnapshot.disconnectReason == "outbound_queue_overflow",
            "overflowing subscriber reported the wrong disconnect reason"
        )
        require(
            overflowSnapshot.maximumObservedBytes <= overflowLimits.maxQueuedBytes,
            "overflowing subscriber exceeded its byte bound"
        )
        require(
            overflowSnapshot.maximumObservedMessages <= overflowLimits.maxQueuedMessages,
            "overflowing subscriber exceeded its message bound"
        )

        require(
            waitUntil(timeoutMilliseconds: 2_000) {
                activeWriter.snapshot().pendingMessages == 0
            },
            "active voice writer did not drain its queue"
        )
        let activeSnapshot = activeWriter.snapshot()
        require(!activeSnapshot.closed, "slow subscriber disconnected the active voice owner")
        require(
            activeSnapshot.maximumObservedBytes <= activeLimits.maxQueuedBytes,
            "active writer exceeded its byte bound"
        )
        require(
            activeSnapshot.maximumObservedMessages <= activeLimits.maxQueuedMessages,
            "active writer exceeded its message bound"
        )
        require(
            activeSnapshot.writeSystemCalls > expectedLineCount,
            "short-write completion loop was not exercised"
        )

        activeWriter.closeAndWait()
        timeoutWriter.closeAndWait()
        overflowWriter.closeAndWait()
        require(peerReachedEOF(activePair.reader), "active voice socket did not close")
        require(peerReachedEOF(timeoutPair.reader), "timed-out subscriber socket did not close")
        require(peerReachedEOF(overflowPair.reader), "overflowing subscriber socket did not close")

        let staleFD = activePair.writer
        close(activePair.writer)
        close(activePair.reader)
        close(timeoutPair.writer)
        close(timeoutPair.reader)
        close(overflowPair.writer)
        close(overflowPair.reader)

        let reusePair = makeSocketPair()
        require(reusePair.writer == staleFD, "test did not obtain deterministic descriptor reuse")
        require(
            !activeWriter.enqueue(voiceFrame(sequence: 99, payloadBytes: 1)),
            "closed writer accepted a frame after descriptor reuse"
        )
        var descriptor = pollfd(fd: reusePair.reader, events: Int16(POLLIN), revents: 0)
        require(poll(&descriptor, 1, 100) == 0, "stale writer targeted a reused descriptor")
        close(reusePair.writer)
        close(reusePair.reader)

        print(
            "daemon outbound writer stress passed "
            + "voice_lines=\(expectedLineCount) "
            + "write_calls=\(activeSnapshot.writeSystemCalls) "
            + "max_bytes=\(activeSnapshot.maximumObservedBytes) "
            + "max_messages=\(activeSnapshot.maximumObservedMessages)"
        )
    }
}

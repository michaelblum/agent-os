import CryptoKit
import Darwin
import Foundation

private func require(_ condition: @autoclosure () -> Bool) throws {
    if !condition() { throw NSError(domain: "fixture-geometry-test", code: 1) }
}

@main
private enum Harness {
    static func main() throws {
        let key = SymmetricKey(data: Array(UInt8(0)...UInt8(31)))
        let target = FixtureGeometryFact(
            ownerPID: 4242,
            windowID: 77,
            bounds: FixtureBounds(x: -1440, y: -120, width: 480, height: 348),
            displayID: 42,
            scaleFactor: 2
        )
        let sibling = FixtureGeometryFact(
            ownerPID: 4242,
            windowID: 78,
            bounds: FixtureBounds(x: -1370, y: -80, width: 340, height: 278),
            displayID: 43,
            scaleFactor: 1.5
        )
        let observation = FixtureGeometryObservation(target: target, sibling: sibling)
        let hmacs = fixtureGeometryHMACs(observation: observation, key: key)!
        let nonce = String(repeating: "01", count: 32)
        let readyMAC = fixtureGeometryReadyReceiptMAC(
            schema: fixtureGeometryCheckpointSchema,
            status: "ready",
            nonce: nonce,
            phase: .initialPre,
            targetFactHMAC: hmacs.target,
            fullFixtureFactHMAC: hmacs.full,
            key: key
        )!
        let failureMAC = fixtureGeometryFailureReceiptMAC(
            schema: fixtureGeometryCheckpointSchema,
            status: "failed",
            nonce: nonce,
            phase: .initialPre,
            errorCode: .readinessUnavailable,
            key: key
        )!

        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let requestURL = root.appendingPathComponent("request.json")
        let receiptURL = root.appendingPathComponent("receipt.json")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let request = FixtureGeometryCheckpointRequest(
            schema: fixtureGeometryCheckpointSchema,
            nonce: nonce,
            phase: .initialPre
        )
        let encoded = try encoder.encode(request)
        for phase in FixtureGeometryCheckpointPhase.allCases {
            let phaseRequest = FixtureGeometryCheckpointRequest(
                schema: fixtureGeometryCheckpointSchema,
                nonce: nonce,
                phase: phase
            )
            try encoder.encode(phaseRequest).write(to: requestURL)
            try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == phaseRequest)
        }
        var boundary = encoded
        boundary.append(Data(repeating: 0x20, count: fixtureGeometryCheckpointRequestMaxBytes - encoded.count))
        try boundary.write(to: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == request)
        boundary.append(0x20)
        try boundary.write(to: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == nil)
        try Data([0xc3]).write(to: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == nil)
        try Data("{\"schema\":\"unknown\"}".utf8).write(to: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == nil)
        try encoded.write(to: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: requestURL) == request)
        let linkURL = root.appendingPathComponent("request-link.json")
        try FileManager.default.createSymbolicLink(at: linkURL, withDestinationURL: requestURL)
        try require(parseFixtureGeometryCheckpointRequest(at: linkURL) == nil)

        var publishedMode: mode_t = 0
        var consumerUnlinked = false
        var publishedReady: FixtureGeometryCheckpointReadyReceipt?
        let service = FixtureGeometryCheckpointService(key: key) {
            var info = stat()
            if lstat(receiptURL.path, &info) == 0 { publishedMode = info.st_mode & mode_t(0o777) }
            publishedReady = try? JSONDecoder().decode(
                FixtureGeometryCheckpointReadyReceipt.self,
                from: Data(contentsOf: receiptURL)
            )
            consumerUnlinked = Darwin.unlink(receiptURL.path) == 0
        }
        try require(service.serviceIfRequested(
            requestURL: requestURL,
            receiptURL: receiptURL,
            observation: { observation }
        ) == .publishedReady)
        try require(publishedMode == mode_t(0o600) && consumerUnlinked)
        try require(publishedReady?.schema == fixtureGeometryCheckpointSchema)
        try require(publishedReady?.status == "ready")
        try require(publishedReady?.nonce == nonce && publishedReady?.phase == .initialPre)
        try require(publishedReady?.target_fact_hmac == hmacs.target)
        try require(publishedReady?.full_fixture_fact_hmac == hmacs.full)
        try require(publishedReady?.receipt_mac == readyMAC)
        try require(service.serviceIfRequested(
            requestURL: requestURL,
            receiptURL: receiptURL,
            observation: { observation }
        ) == .idle)

        let secondNonce = String(repeating: "02", count: 32)
        let failureRequest = FixtureGeometryCheckpointRequest(
            schema: fixtureGeometryCheckpointSchema,
            nonce: secondNonce,
            phase: .preservedPost
        )
        try encoder.encode(failureRequest).write(to: requestURL)
        let failureService = FixtureGeometryCheckpointService(key: key)
        try require(failureService.serviceIfRequested(
            requestURL: requestURL,
            receiptURL: receiptURL,
            observation: { nil }
        ) == .publishedFailure)
        let failure = try JSONDecoder().decode(
            FixtureGeometryCheckpointFailureReceipt.self,
            from: Data(contentsOf: receiptURL)
        )
        try require(failure.schema == fixtureGeometryCheckpointSchema && failure.status == "failed")
        try require(failure.nonce == secondNonce && failure.phase == .preservedPost)
        try require(failure.error_code == .readinessUnavailable)
        let emittedFailureMAC = fixtureGeometryFailureReceiptMAC(
            schema: failure.schema,
            status: failure.status,
            nonce: failure.nonce,
            phase: failure.phase,
            errorCode: failure.error_code,
            key: key
        )
        try require(failure.receipt_mac == emittedFailureMAC)
        try require(fixtureGeometryCheckpointServiceAllowed(
            metadataPublished: true,
            targetClosed: false,
            stopStarted: false,
            closeRequested: false,
            stopRequested: false
        ))
        let blocked = [
            fixtureGeometryCheckpointServiceAllowed(metadataPublished: false, targetClosed: false, stopStarted: false, closeRequested: false, stopRequested: false),
            fixtureGeometryCheckpointServiceAllowed(metadataPublished: true, targetClosed: true, stopStarted: false, closeRequested: false, stopRequested: false),
            fixtureGeometryCheckpointServiceAllowed(metadataPublished: true, targetClosed: false, stopStarted: true, closeRequested: false, stopRequested: false),
            fixtureGeometryCheckpointServiceAllowed(metadataPublished: true, targetClosed: false, stopStarted: false, closeRequested: true, stopRequested: false),
            fixtureGeometryCheckpointServiceAllowed(metadataPublished: true, targetClosed: false, stopStarted: false, closeRequested: false, stopRequested: true),
        ]
        try require(blocked.allSatisfy { !$0 })
        let output: [String: Any] = [
            "failure_receipt_mac": failureMAC,
            "full_fixture_fact_hmac": hmacs.full,
            "immediate_consumer_unlink_committed": true,
            "ready_receipt_mac": readyMAC,
            "request_boundaries_and_lifecycle": true,
            "status": "passed",
            "target_fact_hmac": hmacs.target,
        ]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}

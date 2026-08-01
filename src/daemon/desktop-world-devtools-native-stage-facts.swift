import Foundation

struct AOSDesktopWorldDevToolsNativeStageFacts: Equatable {
    private static let maximumSafeGeneration: UInt64 = 9_007_199_254_740_991
    private static let maximumSafeCount = 1_000_000_000
    private static let nativeEffectStates = [
        "capturing", "installing", "preparing", "presenting", "ready",
        "retiring", "stopped", "unavailable",
    ]
    private static let warmStates = ["failed", "idle", "ready", "retiring", "warming"]

    let displayCount: Int
    let errorCode: String?
    let generation: UInt64
    let nativeEffectActiveInstanceCount: Int
    let nativeEffectActiveSheetCount: Int
    let nativeEffectAcceptedCount: Int
    let nativeEffectAttemptedCount: Int
    let nativeEffectCompletedCount: Int
    let nativeEffectDisposedCount: Int
    let nativeEffectFailedCount: Int
    let nativeEffectLastErrorCode: String?
    let nativeEffectLastOwnerID: String?
    let nativeEffectLastPresentationLatencyMilliseconds: Int?
    let nativeEffectLastRenderBackingPixelCount: Int?
    let nativeEffectLastRenderBackingPixelPercentage: Double?
    let nativeEffectLastRenderTriangleCount: Int?
    let nativeEffectLastProgramDigest: String?
    let nativeEffectLastProgramID: String?
    let nativeEffectLastProgramRevision: Int?
    let nativeEffectLastResourceID: String?
    let nativeEffectLastResourceRevision: Int?
    let nativeEffectPresentedCount: Int
    let nativeEffectRejectedCount: Int
    let nativeEffectRetainedBufferCount: Int
    let nativeEffectRetainedTextureCount: Int
    let nativeEffectRetainedViewCount: Int
    let nativeEffectState: String
    let state: String

    init(
        displayCount: Int,
        errorCode: String?,
        generation: UInt64,
        nativeEffectActiveInstanceCount: Int = 0,
        nativeEffectActiveSheetCount: Int = 0,
        nativeEffectAcceptedCount: Int = 0,
        nativeEffectAttemptedCount: Int = 0,
        nativeEffectCompletedCount: Int = 0,
        nativeEffectDisposedCount: Int = 0,
        nativeEffectFailedCount: Int = 0,
        nativeEffectLastErrorCode: String? = nil,
        nativeEffectLastOwnerID: String? = nil,
        nativeEffectLastPresentationLatencyMilliseconds: Int? = nil,
        nativeEffectLastRenderBackingPixelCount: Int? = nil,
        nativeEffectLastRenderBackingPixelPercentage: Double? = nil,
        nativeEffectLastRenderTriangleCount: Int? = nil,
        nativeEffectLastProgramDigest: String? = nil,
        nativeEffectLastProgramID: String? = nil,
        nativeEffectLastProgramRevision: Int? = nil,
        nativeEffectLastResourceID: String? = nil,
        nativeEffectLastResourceRevision: Int? = nil,
        nativeEffectPresentedCount: Int = 0,
        nativeEffectRejectedCount: Int = 0,
        nativeEffectRetainedBufferCount: Int = 0,
        nativeEffectRetainedTextureCount: Int = 0,
        nativeEffectRetainedViewCount: Int = 0,
        nativeEffectState: String = "unavailable",
        state: String
    ) {
        self.displayCount = min(max(displayCount, 0), 16)
        self.errorCode = errorCode.map { String($0.prefix(64)) }
        self.generation = min(generation, Self.maximumSafeGeneration)
        self.nativeEffectActiveInstanceCount = min(
            Self.boundedCount(nativeEffectActiveInstanceCount), 1
        )
        self.nativeEffectActiveSheetCount = min(
            Self.boundedCount(nativeEffectActiveSheetCount), 1
        )
        self.nativeEffectAcceptedCount = Self.boundedCount(nativeEffectAcceptedCount)
        self.nativeEffectAttemptedCount = Self.boundedCount(nativeEffectAttemptedCount)
        self.nativeEffectCompletedCount = Self.boundedCount(nativeEffectCompletedCount)
        self.nativeEffectDisposedCount = Self.boundedCount(nativeEffectDisposedCount)
        self.nativeEffectFailedCount = Self.boundedCount(nativeEffectFailedCount)
        self.nativeEffectLastErrorCode = nativeEffectLastErrorCode.map {
            String($0.prefix(64))
        }
        self.nativeEffectLastOwnerID = Self.boundedID(nativeEffectLastOwnerID)
        self.nativeEffectLastPresentationLatencyMilliseconds =
            nativeEffectLastPresentationLatencyMilliseconds.map(Self.boundedCount)
        self.nativeEffectLastRenderBackingPixelCount =
            nativeEffectLastRenderBackingPixelCount.map(Self.boundedCount)
        self.nativeEffectLastRenderBackingPixelPercentage =
            nativeEffectLastRenderBackingPixelPercentage.flatMap(Self.percentage)
        self.nativeEffectLastRenderTriangleCount =
            nativeEffectLastRenderTriangleCount.map(Self.boundedCount)
        self.nativeEffectLastProgramDigest = Self.digest(nativeEffectLastProgramDigest)
        self.nativeEffectLastProgramID = Self.boundedID(nativeEffectLastProgramID)
        self.nativeEffectLastProgramRevision = nativeEffectLastProgramRevision.map {
            min(max($0, 1), Int(Int32.max))
        }
        self.nativeEffectLastResourceID = Self.boundedID(nativeEffectLastResourceID)
        self.nativeEffectLastResourceRevision = nativeEffectLastResourceRevision.map {
            min(max($0, 1), Int(Int32.max))
        }
        self.nativeEffectPresentedCount = Self.boundedCount(nativeEffectPresentedCount)
        self.nativeEffectRejectedCount = Self.boundedCount(nativeEffectRejectedCount)
        self.nativeEffectRetainedBufferCount = min(
            Self.boundedCount(nativeEffectRetainedBufferCount), 32
        )
        self.nativeEffectRetainedTextureCount = min(
            Self.boundedCount(nativeEffectRetainedTextureCount), 16
        )
        self.nativeEffectRetainedViewCount = min(
            Self.boundedCount(nativeEffectRetainedViewCount), 16
        )
        self.nativeEffectState = Self.nativeEffectStates.contains(nativeEffectState)
            ? nativeEffectState
            : "unavailable"
        self.state = Self.warmStates.contains(state) ? state : "idle"
    }

    static let idle = AOSDesktopWorldDevToolsNativeStageFacts(
        displayCount: 0,
        errorCode: nil,
        generation: 0,
        state: "idle"
    )

    var dictionary: [String: Any] {
        [
            "desktopFrameWarm": [
                "displayCount": displayCount,
                "errorCode": errorCode.map { $0 as Any } ?? NSNull(),
                "generation": Int(generation),
                "state": state,
            ],
            "nativeEffect": [
                "activeInstanceCount": nativeEffectActiveInstanceCount,
                "activeSheetCount": nativeEffectActiveSheetCount,
                "acceptedCount": nativeEffectAcceptedCount,
                "attemptedCount": nativeEffectAttemptedCount,
                "completedCount": nativeEffectCompletedCount,
                "disposedCount": nativeEffectDisposedCount,
                "failedCount": nativeEffectFailedCount,
                "lastErrorCode": nativeEffectLastErrorCode.map { $0 as Any } ?? NSNull(),
                "lastExecution": lastExecution,
                "lastPresentationLatencyMs": nativeEffectLastPresentationLatencyMilliseconds
                    .map { $0 as Any } ?? NSNull(),
                "lastRenderBackingPixelCount": nativeEffectLastRenderBackingPixelCount
                    .map { $0 as Any } ?? NSNull(),
                "lastRenderBackingPixelPercentage": nativeEffectLastRenderBackingPixelPercentage
                    .map { $0 as Any } ?? NSNull(),
                "lastRenderTriangleCount": nativeEffectLastRenderTriangleCount
                    .map { $0 as Any } ?? NSNull(),
                "presentedCount": nativeEffectPresentedCount,
                "rejectedCount": nativeEffectRejectedCount,
                "retainedBufferCount": nativeEffectRetainedBufferCount,
                "retainedTextureCount": nativeEffectRetainedTextureCount,
                "retainedViewCount": nativeEffectRetainedViewCount,
                "state": nativeEffectState,
            ],
        ]
    }

    private static func boundedCount(_ value: Int) -> Int {
        min(max(value, 0), maximumSafeCount)
    }

    private static func percentage(_ value: Double) -> Double? {
        guard value.isFinite else { return nil }
        return min(100, max(0, value))
    }

    private static func boundedID(_ value: String?) -> String? {
        guard let value else { return nil }
        let bytes = Array(value.utf8)
        let alphanumeric: (UInt8) -> Bool = {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x7a)
        }
        guard !bytes.isEmpty, bytes.count <= 256,
              alphanumeric(bytes[0]), alphanumeric(bytes[bytes.count - 1]),
              bytes.allSatisfy({
                alphanumeric($0) || [0x2d, 0x2e, 0x2f, 0x5f].contains($0)
              }),
              !value.contains("//"),
              !value.split(separator: "/", omittingEmptySubsequences: false)
                .contains(where: { $0 == "." || $0 == ".." || $0.isEmpty }) else {
            return nil
        }
        return value
    }

    private static func digest(_ value: String?) -> String? {
        guard let value, value.utf8.count == 64,
              value.utf8.allSatisfy({
                ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
              }) else { return nil }
        return value
    }

    private var lastExecution: Any {
        guard let ownerID = nativeEffectLastOwnerID,
              let resourceID = nativeEffectLastResourceID,
              let resourceRevision = nativeEffectLastResourceRevision else {
            return NSNull()
        }
        return [
            "ownerId": ownerID,
            "programDigest": nativeEffectLastProgramDigest.map { $0 as Any } ?? NSNull(),
            "programId": nativeEffectLastProgramID.map { $0 as Any } ?? NSNull(),
            "programRevision": nativeEffectLastProgramRevision.map { $0 as Any } ?? NSNull(),
            "resourceId": resourceID,
            "resourceRevision": resourceRevision,
        ]
    }
}

import Foundation

struct AOSDesktopWorldNativeFeedbackCaptureContext: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let topologyGeneration: UInt64
}

@MainActor
protocol AOSDesktopWorldNativeFeedbackRuntime: AnyObject {
    var retainedBufferCount: Int { get }
    var retainedTextureCount: Int { get }
    var retainedViewCount: Int { get }

    func dispose()
    func present(
        onPresented: @escaping () -> Void,
        onFailure: @escaping (String) -> Void,
        onComplete: @escaping () -> Void
    )
}

protocol AOSDesktopWorldNativeEffectPreparation: AnyObject, Sendable {}

struct AOSDesktopWorldNativeFeedbackInstallation {
    let identity: AOSDesktopWorldResourceIdentity
    let runtime: AOSDesktopWorldNativeFeedbackRuntime
}

enum AOSDesktopWorldNativeFeedbackInstallationOutcome {
    case installed(AOSDesktopWorldNativeFeedbackInstallation)
    case rollbackRequired(
        identity: AOSDesktopWorldResourceIdentity,
        error: Error
    )
}

struct AOSDesktopWorldNativeFeedbackSnapshot: Equatable {
    let activeInstanceCount: Int
    let activeSheetCount: Int
    let acceptedCount: Int
    let attemptedCount: Int
    let completedCount: Int
    let disposedCount: Int
    let failedCount: Int
    let lastErrorCode: String?
    let lastOwnerID: String?
    let lastPresentationLatencyMilliseconds: Int?
    let lastProgramDigest: String?
    let lastProgramID: String?
    let lastProgramRevision: Int?
    let lastResourceID: String?
    let lastResourceRevision: Int?
    let presentedCount: Int
    let rejectedCount: Int
    let retainedBufferCount: Int
    let retainedTextureCount: Int
    let retainedViewCount: Int
    let state: String

    static let idle = AOSDesktopWorldNativeFeedbackSnapshot(
        activeInstanceCount: 0,
        activeSheetCount: 0,
        acceptedCount: 0,
        attemptedCount: 0,
        completedCount: 0,
        disposedCount: 0,
        failedCount: 0,
        lastErrorCode: nil,
        lastOwnerID: nil,
        lastPresentationLatencyMilliseconds: nil,
        lastProgramDigest: nil,
        lastProgramID: nil,
        lastProgramRevision: nil,
        lastResourceID: nil,
        lastResourceRevision: nil,
        presentedCount: 0,
        rejectedCount: 0,
        retainedBufferCount: 0,
        retainedTextureCount: 0,
        retainedViewCount: 0,
        state: "unavailable"
    )
}

protocol AOSDesktopWorldNativeFeedbackHosting: AnyObject {
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext?

    func prepare(
        programs: [AOSDesktopWorldNativeEffectProgram],
        completion: @escaping @Sendable (
            Result<AOSDesktopWorldNativeEffectPreparation, Error>
        ) -> Void
    )

    /// Publishes one already-prepared context with a bounded, nonblocking
    /// pointer swap. Implementations must not reenter the controller.
    @MainActor
    func activate(
        preparation: AOSDesktopWorldNativeEffectPreparation
    ) throws

    @MainActor
    func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallationOutcome

    @MainActor
    func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) -> Bool

    @MainActor
    func releasePreparedResources()

    @MainActor
    func shutdown()
}

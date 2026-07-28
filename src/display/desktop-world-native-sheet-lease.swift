import Foundation

final class DesktopWorldNativeSheetProcessLease: @unchecked Sendable {
    struct Token: Equatable, Sendable {
        fileprivate let owner: ObjectIdentifier
        fileprivate let canvasGeneration: UInt64
        fileprivate let leaseSerial: UInt64
    }

    enum LeaseError: Error {
        case invalidGeneration
        case occupied
    }

    static let shared = DesktopWorldNativeSheetProcessLease()

    private let lock = NSLock()
    private var active: Token?
    private var nextSerial: UInt64 = 0

    private init() {}

    func claim(owner: AnyObject, canvasGeneration: UInt64) throws -> Token {
        guard canvasGeneration > 0 else { throw LeaseError.invalidGeneration }
        lock.lock()
        defer { lock.unlock() }
        guard active == nil else { throw LeaseError.occupied }
        nextSerial &+= 1
        if nextSerial == 0 { nextSerial = 1 }
        let token = Token(
            owner: ObjectIdentifier(owner),
            canvasGeneration: canvasGeneration,
            leaseSerial: nextSerial
        )
        active = token
        return token
    }

    func release(_ token: Token) {
        lock.lock()
        defer { lock.unlock() }
        guard active == token else { return }
        active = nil
    }
}

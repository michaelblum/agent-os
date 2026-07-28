import Foundation

private final class LeaseOwner {}

@main
struct DesktopWorldNativeSheetLeaseTests {
    static func main() throws {
        let lease = DesktopWorldNativeSheetProcessLease.shared
        let firstOwner = LeaseOwner()
        let secondOwner = LeaseOwner()
        let thirdOwner = LeaseOwner()

        do {
            _ = try lease.claim(owner: firstOwner, canvasGeneration: 0)
            preconditionFailure("zero canvas generation must fail")
        } catch DesktopWorldNativeSheetProcessLease.LeaseError.invalidGeneration {
        }

        let first = try lease.claim(owner: firstOwner, canvasGeneration: 1)
        do {
            _ = try lease.claim(owner: secondOwner, canvasGeneration: 1)
            preconditionFailure("a second owner must not claim native-sheet/main")
        } catch DesktopWorldNativeSheetProcessLease.LeaseError.occupied {
        }

        lease.release(first)
        let second = try lease.claim(owner: secondOwner, canvasGeneration: 2)

        lease.release(first)
        do {
            _ = try lease.claim(owner: thirdOwner, canvasGeneration: 3)
            preconditionFailure("a stale token must not release the current owner")
        } catch DesktopWorldNativeSheetProcessLease.LeaseError.occupied {
        }

        lease.release(second)
        let sameOwnerFirst = try lease.claim(owner: firstOwner, canvasGeneration: 1)
        lease.release(sameOwnerFirst)
        let sameOwnerSecond = try lease.claim(owner: firstOwner, canvasGeneration: 1)
        lease.release(sameOwnerFirst)
        do {
            _ = try lease.claim(owner: thirdOwner, canvasGeneration: 3)
            preconditionFailure("a stale same-owner token must not release a replacement lease")
        } catch DesktopWorldNativeSheetProcessLease.LeaseError.occupied {
        }
        lease.release(sameOwnerSecond)

        let third = try lease.claim(owner: thirdOwner, canvasGeneration: 3)
        lease.release(third)

        print("PASS DesktopWorld native sheet process lease")
    }
}

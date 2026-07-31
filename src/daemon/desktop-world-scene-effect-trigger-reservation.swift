import Foundation

/// Scene state owns the registry under its aggregate lock. Each token then
/// linearizes cancellation against native admission without retaining that
/// aggregate lock across capture-context or main-thread work.
final class AOSDesktopWorldSceneEffectTriggerReservation {
    let key: String
    private var active = true
    private let lock = NSLock()

    init(key: String) {
        self.key = key
    }

    func cancel() {
        lock.lock()
        active = false
        lock.unlock()
    }

    func performIfActive(_ body: () -> Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard active else { return false }
        return body()
    }
}

final class AOSDesktopWorldSceneEffectTriggerReservationRegistry {
    private var reservations: [
        String: AOSDesktopWorldSceneEffectTriggerReservation
    ] = [:]

    var isEmpty: Bool { reservations.isEmpty }

    func contains(key: String) -> Bool {
        reservations[key] != nil
    }

    func begin(
        key: String,
        operationPending: Bool,
        programMutationPending: Bool
    ) -> AOSDesktopWorldSceneEffectTriggerReservation? {
        guard reservations[key] == nil,
              !operationPending,
              !programMutationPending else {
            return nil
        }
        let reservation = AOSDesktopWorldSceneEffectTriggerReservation(key: key)
        reservations[key] = reservation
        return reservation
    }

    func release(_ reservation: AOSDesktopWorldSceneEffectTriggerReservation) {
        guard reservations[reservation.key] === reservation else { return }
        reservations.removeValue(forKey: reservation.key)
    }

    func cancel(key: String) {
        reservations.removeValue(forKey: key)?.cancel()
    }

    func cancelAll() {
        let active = Array(reservations.values)
        reservations.removeAll(keepingCapacity: false)
        for reservation in active {
            reservation.cancel()
        }
    }
}

// wiki-change-bus.swift — Stub for wiki write notifications (Task 4 will flesh this out)

import Foundation

/// Change operation type for wiki file events.
enum WikiChangeOp {
    case created
    case updated
    case deleted
}

/// Bus for emitting wiki change events to interested subscribers.
/// Task 4 will implement real pub/sub; for now these are no-ops so the
/// write API (Task 3) compiles and ships.
enum WikiChangeBus {
    static func emit(path: String, op: WikiChangeOp) {
        // no-op stub — Task 4 implements event dispatch
    }
}

/// Static hooks for updating the wiki index from the write API.
/// Task 4 will replace these stubs with real WikiIndex instance calls
/// routed through the daemon's index manager.
enum WikiIndexHooks {
    static func reindex(path: String) {
        // no-op stub — Task 4 wires in daemon-held WikiIndex instance
    }

    static func remove(path: String) {
        // no-op stub — Task 4 wires in daemon-held WikiIndex instance
    }
}

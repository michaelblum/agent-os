// status-item-host-contract.swift — Testable native host boundary for status-item leases.

import Foundation

enum AOSStatusItemActionAdmissionResult {
    case stale
    case exhausted
    case dryRun(Int)
    case delivered(Int)
    case deliveryFailed(Int)
}

final class AOSStatusItemActionAdmission {
    static let maximum = 9_007_199_254_740_991

    private(set) var generation = 0
    private(set) var current = 1
    private let maximumSequence: Int

    init(maximumSequence: Int = AOSStatusItemActionAdmission.maximum) {
        precondition((1...AOSStatusItemActionAdmission.maximum).contains(maximumSequence))
        self.maximumSequence = maximumSequence
    }

    func install(generation: Int) {
        precondition(Thread.isMainThread, "status item action admission must run on the main actor boundary")
        guard generation != self.generation else { return }
        self.generation = generation
        current = 1
    }

    func admit(
        expected: Int? = nil,
        dryRun: Bool = false,
        deliver: (Int) -> Bool
    ) -> AOSStatusItemActionAdmissionResult {
        precondition(Thread.isMainThread, "status item action admission must run on the main actor boundary")
        if let expected, expected != current { return .stale }
        guard current < maximumSequence else { return .exhausted }
        let accepted = current
        if dryRun { return .dryRun(accepted) }
        current += 1
        return deliver(accepted) ? .delivered(accepted) : .deliveryFailed(accepted)
    }
}

struct AOSHostedStatusItemDescriptor {
    let owner: String
    let itemID: String
    let revision: Int
    let signature: String
    let label: String
    let helpText: String?
    let primaryActionID: String
    let menuItems: [[String: Any]]
}

protocol AOSStatusItemHosting: AnyObject {
    var hostedDescriptor: AOSHostedStatusItemDescriptor? { get }
    var hostedGeneration: Int { get }
    var hostedActionSequence: Int { get }
    var hostedEventSink: (([String: Any]) -> Bool)? { get set }

    func installHostedDescriptor(_ descriptor: AOSHostedStatusItemDescriptor, generation: Int) -> [String: Any]?
    func clearHostedDescriptor(owner: String, itemID: String, generation: Int) -> Bool
    func hostedInspectState() -> [String: Any]
    func invokeHostedAction(
        owner: String,
        itemID: String,
        actionID: String,
        expectedGeneration: Int?,
        expectedRevision: Int?,
        expectedActionSequence: Int,
        dryRun: Bool
    ) -> [String: Any]
    func statusItemAnchorPayload(owner: String, itemID: String) -> [String: Any]?
    func teardown()
}

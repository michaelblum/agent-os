// status-item-host-contract.swift — Testable native host boundary for status-item leases.

import Foundation

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
        dryRun: Bool
    ) -> [String: Any]
    func statusItemAnchorPayload(owner: String, itemID: String) -> [String: Any]?
    func teardown()
}

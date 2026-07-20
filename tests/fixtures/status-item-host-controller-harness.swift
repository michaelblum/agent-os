import Foundation

private let descriptorSchema = "aos.status_item.descriptor.v1"

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

private func descriptorPayload(revision: Int, label: String? = nil) -> [String: Any] {
    [
        "schema_version": descriptorSchema,
        "owner": "io.example.app",
        "item_id": "companion",
        "revision": revision,
        "label": label ?? "Example Companion \(revision)",
        "primary_action_id": "summon",
        "menu": [],
    ]
}

private func updatePayload(revision: Int, currentRevision: Int, generation: Int = 1) -> [String: Any] {
    [
        "owner": "io.example.app",
        "item_id": "companion",
        "generation": generation,
        "current_revision": currentRevision,
        "descriptor": descriptorPayload(revision: revision),
    ]
}

private func exactIdentity(revision: Int, generation: Int = 1) -> [String: Any] {
    [
        "owner": "io.example.app",
        "item_id": "companion",
        "generation": generation,
        "descriptor_revision": revision,
    ]
}

private func invokePayload(revision: Int, generation: Int = 1) -> [String: Any] {
    var payload = exactIdentity(revision: revision, generation: generation)
    payload["action_id"] = "summon"
    return payload
}

private func responseCode(_ result: AOSStatusItemHostCommandResult) -> String? {
    result.response["code"] as? String
}

private final class FakeStatusItemHost: AOSStatusItemHosting {
    private(set) var hostedDescriptor: AOSHostedStatusItemDescriptor?
    private(set) var hostedGeneration = 0
    var hostedEventSink: (([String: Any]) -> Bool)?

    var installOutcomes: [Bool] = []
    var invalidateAnchorAfterInstall = false
    private var anchorAvailable = true
    private(set) var installCalls: [(revision: Int, generation: Int)] = []
    private(set) var clearCalls: [(owner: String, itemID: String, generation: Int)] = []
    private(set) var teardownCount = 0

    func installHostedDescriptor(
        _ descriptor: AOSHostedStatusItemDescriptor,
        generation: Int
    ) -> [String: Any]? {
        installCalls.append((descriptor.revision, generation))
        hostedDescriptor = descriptor
        hostedGeneration = generation
        let succeeds = installOutcomes.isEmpty ? true : installOutcomes.removeFirst()
        guard succeeds else { return nil }
        let installedAnchor = anchor(owner: descriptor.owner, itemID: descriptor.itemID)
        if invalidateAnchorAfterInstall { anchorAvailable = false }
        return installedAnchor
    }

    func clearHostedDescriptor(owner: String, itemID: String, generation: Int) -> Bool {
        clearCalls.append((owner, itemID, generation))
        guard let descriptor = hostedDescriptor,
              descriptor.owner == owner,
              descriptor.itemID == itemID,
              hostedGeneration == generation else { return false }
        hostedDescriptor = nil
        hostedGeneration = 0
        return true
    }

    func hostedInspectState() -> [String: Any] {
        guard let descriptor = hostedDescriptor else {
            return ["status": "absent", "anchor": NSNull()]
        }
        return [
            "status": "leased",
            "owner": descriptor.owner,
            "item_id": descriptor.itemID,
            "generation": hostedGeneration,
            "descriptor_revision": descriptor.revision,
            "anchor": anchor(owner: descriptor.owner, itemID: descriptor.itemID),
        ]
    }

    func invokeHostedAction(
        owner: String,
        itemID: String,
        actionID: String,
        expectedGeneration: Int?,
        expectedRevision: Int?,
        dryRun: Bool
    ) -> [String: Any] {
        guard let descriptor = hostedDescriptor,
              descriptor.owner == owner,
              descriptor.itemID == itemID else {
            return ["error": "status item lease is unavailable", "code": "STATUS_ITEM_UNAVAILABLE"]
        }
        guard expectedGeneration == hostedGeneration,
              expectedRevision == descriptor.revision else {
            return ["error": "status item lease is stale", "code": "STATUS_ITEM_STALE_REVISION"]
        }
        guard actionID == descriptor.primaryActionID else {
            return ["error": "status item action is unknown", "code": "STATUS_ITEM_ACTION_NOT_FOUND"]
        }
        if dryRun {
            return ["status": "dry_run", "action_id": actionID]
        }
        let accepted = hostedEventSink?([
            "type": "primary_activation",
            "owner": owner,
            "item_id": itemID,
            "generation": hostedGeneration,
            "descriptor_revision": descriptor.revision,
            "source": "status_item",
            "action_id": actionID,
            "origin_x": 13,
            "origin_y": 14,
            "modifiers": [],
            "bounds": bounds(),
            "anchor": anchor(owner: owner, itemID: itemID),
        ]) ?? false
        guard accepted else {
            return ["error": "status item event delivery is unavailable", "code": "STATUS_ITEM_EVENT_UNAVAILABLE"]
        }
        return ["status": "ok", "action_id": actionID]
    }

    func statusItemAnchorPayload(owner: String, itemID: String) -> [String: Any]? {
        guard anchorAvailable,
              let descriptor = hostedDescriptor,
              descriptor.owner == owner,
              descriptor.itemID == itemID else { return nil }
        return anchor(owner: owner, itemID: itemID)
    }

    func teardown() {
        teardownCount += 1
        hostedDescriptor = nil
        hostedGeneration = 0
    }

    private func bounds() -> [String: Any] {
        [
            "x": 1.0,
            "y": 2.0,
            "width": 24.0,
            "height": 24.0,
            "origin_x": 13.0,
            "origin_y": 14.0,
            "display_id": 1,
        ]
    }

    private func anchor(owner: String, itemID: String) -> [String: Any] {
        [
            "schema_version": "aos.status_item.anchor.v1",
            "anchor_id": "native-status-item/\(owner)/\(itemID)",
            "host": "native_status_item",
            "coordinate_space": "global_display_top_left",
            "visible": true,
            "bounds": bounds(),
        ]
    }
}

private final class CallbackRecorder {
    var admitsEvents = true
    private(set) var emittedEvents: [(owner: UUID, event: String)] = []
    private(set) var terminations: [(owner: UUID, reason: String)] = []

    func emit(owner: UUID, event: String, data: [String: Any], ref: String?) -> Bool {
        emittedEvents.append((owner, event))
        return admitsEvents
    }

    func terminate(owner: UUID, reason: String) {
        terminations.append((owner, reason))
    }
}

private func makeController() -> (FakeStatusItemHost, CallbackRecorder, AOSStatusItemHostController) {
    let manager = FakeStatusItemHost()
    let recorder = CallbackRecorder()
    let controller = AOSStatusItemHostController(
        manager: manager,
        emit: recorder.emit,
        terminate: recorder.terminate
    )
    return (manager, recorder, controller)
}

private func command(
    _ controller: AOSStatusItemHostController,
    action: String,
    payload: [String: Any],
    connectionID: UUID
) -> AOSStatusItemHostCommandResult {
    var result: AOSStatusItemHostCommandResult?
    controller.handleCommand(
        action: action,
        payload: payload,
        connectionID: connectionID,
        ref: "harness-ref"
    ) { result = $0 }
    guard let result else {
        fputs("FAIL: status item command did not deliver a result\n", stderr)
        exit(1)
    }
    return result
}

private func register(
    _ controller: AOSStatusItemHostController,
    owner: UUID,
    revision: Int = 3,
    emitReady: Bool = true
) -> AOSStatusItemHostCommandResult {
    let result = command(
        controller,
        action: "status-item-register",
        payload: ["descriptor": descriptorPayload(revision: revision)],
        connectionID: owner
    )
    if emitReady { result.afterResponse?() }
    return result
}

private func testLeaseBusyRegistration() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    let contender = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    expect(responseCode(register(controller, owner: owner)) == nil, "initial registration failed")

    let busy = register(controller, owner: contender, emitReady: false)
    expect(responseCode(busy) == "STATUS_ITEM_LEASE_BUSY", "contending registration did not fail busy")
    expect(manager.installCalls.count == 1, "busy registration touched the native host")
    expect(recorder.terminations.isEmpty, "busy registration terminated the active owner")
}

private func testReadyUsesCommittedInstallationAnchor() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "88888888-8888-8888-8888-888888888888")!
    manager.invalidateAnchorAfterInstall = true

    let registered = register(controller, owner: owner)
    expect(responseCode(registered) == nil, "committed-anchor registration failed")
    expect(registered.response["anchor"] is [String: Any], "registration discarded its committed anchor")
    expect(recorder.emittedEvents.count == 1, "registration did not emit readiness")
    expect(recorder.emittedEvents.first?.event == "ready", "registration emitted the wrong initial event")
}

private func testExactRevisionCAS() {
    let (manager, _, controller) = makeController()
    let owner = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    expect(responseCode(register(controller, owner: owner)) == nil, "CAS registration failed")

    let updated = command(
        controller,
        action: "status-item-update",
        payload: updatePayload(revision: 4, currentRevision: 3),
        connectionID: UUID()
    )
    expect(responseCode(updated) == nil, "exact CAS update failed")
    expect(updated.response["descriptor_revision"] as? Int == 4, "CAS update returned the wrong revision")

    let stale = command(
        controller,
        action: "status-item-update",
        payload: updatePayload(revision: 5, currentRevision: 3),
        connectionID: UUID()
    )
    expect(responseCode(stale) == "STATUS_ITEM_STALE_REVISION", "stale CAS update did not fail closed")
    expect(manager.installCalls.map(\.revision) == [3, 4], "stale CAS update reached the native host")
}

private func testFailedInstallAndRestoreTerminatesOwner() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!
    expect(responseCode(register(controller, owner: owner)) == nil, "rollback registration failed")
    manager.installOutcomes = [false, false]

    let failed = command(
        controller,
        action: "status-item-update",
        payload: updatePayload(revision: 4, currentRevision: 3),
        connectionID: UUID()
    )
    expect(responseCode(failed) == "STATUS_ITEM_ANCHOR_UNAVAILABLE", "double install failure returned the wrong code")
    expect(recorder.terminations.isEmpty, "owner terminated before the update response")
    expect(manager.installCalls.map(\.revision) == [3, 4, 3], "controller did not attempt exact descriptor restoration")
    expect(manager.teardownCount == 1, "failed restoration did not tear down the host")

    failed.afterResponse?()
    expect(recorder.terminations.count == 1, "failed restoration did not terminate the registration owner")
    expect(recorder.terminations.first?.owner == owner, "failed restoration terminated the wrong owner")
    expect(recorder.terminations.first?.reason == "status_item_lease_lost", "failed restoration used the wrong termination reason")

    let inspect = command(
        controller,
        action: "status-item-inspect",
        payload: exactIdentity(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(inspect) == "STATUS_ITEM_NOT_FOUND", "failed restoration left a live controller lease")
}

private func testRejectedInvokeEventFailsAndCleansLease() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "55555555-5555-5555-5555-555555555555")!
    expect(responseCode(register(controller, owner: owner)) == nil, "invoke registration failed")
    recorder.admitsEvents = false

    let invoked = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(invoked) == "STATUS_ITEM_EVENT_UNAVAILABLE", "rejected invoke event returned success")
    expect(manager.teardownCount == 1, "rejected invoke event did not tear down the host")
    expect(recorder.terminations.count == 1, "rejected invoke event did not terminate the registration owner")
    expect(recorder.terminations.first?.owner == owner, "rejected invoke event terminated the wrong owner")
    expect(recorder.terminations.first?.reason == "status_item_event_delivery_failed", "rejected invoke event used the wrong termination reason")

    let inspect = command(
        controller,
        action: "status-item-inspect",
        payload: exactIdentity(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(inspect) == "STATUS_ITEM_NOT_FOUND", "rejected invoke event left a live controller lease")
}

private func testConnectionCloseClearsOnlyExactOwner() {
    let (manager, _, controller) = makeController()
    let owner = UUID(uuidString: "66666666-6666-6666-6666-666666666666")!
    let other = UUID(uuidString: "77777777-7777-7777-7777-777777777777")!
    expect(responseCode(register(controller, owner: owner)) == nil, "cleanup registration failed")

    controller.connectionClosed(other)
    expect(manager.clearCalls.isEmpty, "non-owner disconnect cleared the lease")
    let stillLive = command(
        controller,
        action: "status-item-inspect",
        payload: exactIdentity(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(stillLive) == nil, "non-owner disconnect removed the lease")

    controller.connectionClosed(owner)
    expect(manager.clearCalls.count == 1, "owner disconnect did not clear the host")
    expect(manager.clearCalls.first?.owner == "io.example.app", "cleanup used the wrong semantic owner")
    expect(manager.clearCalls.first?.itemID == "companion", "cleanup used the wrong item id")
    expect(manager.clearCalls.first?.generation == 1, "cleanup used the wrong generation")
    let removed = command(
        controller,
        action: "status-item-inspect",
        payload: exactIdentity(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(removed) == "STATUS_ITEM_NOT_FOUND", "owner disconnect left a live controller lease")
}

@main
private struct StatusItemHostControllerHarness {
    static func main() {
        testLeaseBusyRegistration()
        testReadyUsesCommittedInstallationAnchor()
        testExactRevisionCAS()
        testFailedInstallAndRestoreTerminatesOwner()
        testRejectedInvokeEventFailsAndCleansLease()
        testConnectionCloseClearsOnlyExactOwner()
        print("status item host controller lifecycle harness passed")
    }
}

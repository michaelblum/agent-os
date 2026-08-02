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
        "item_id": "tool",
        "revision": revision,
        "label": label ?? "Example Tool \(revision)",
        "primary_action_id": "activate",
        "menu": [],
    ]
}

private func updatePayload(revision: Int, currentRevision: Int, generation: Int = 1) -> [String: Any] {
    [
        "owner": "io.example.app",
        "item_id": "tool",
        "generation": generation,
        "current_revision": currentRevision,
        "descriptor": descriptorPayload(revision: revision),
    ]
}

private func exactIdentity(revision: Int, generation: Int = 1) -> [String: Any] {
    [
        "owner": "io.example.app",
        "item_id": "tool",
        "generation": generation,
        "descriptor_revision": revision,
    ]
}

private func invokePayload(revision: Int, generation: Int = 1, actionSequence: Int = 1) -> [String: Any] {
    var payload = exactIdentity(revision: revision, generation: generation)
    payload["action_id"] = "activate"
    payload["action_sequence"] = actionSequence
    return payload
}

private func responseCode(_ result: AOSStatusItemHostCommandResult) -> String? {
    result.response["code"] as? String
}

private final class FakeStatusItemHost: AOSStatusItemHosting {
    private(set) var hostedDescriptor: AOSHostedStatusItemDescriptor?
    private(set) var hostedGeneration = 0
    private var actionAdmission = AOSStatusItemActionAdmission()
    var hostedActionSequence: Int { actionAdmission.current }
    var hostedEventSink: (([String: Any]) -> Bool)?

    var installOutcomes: [Bool] = []
    var invalidateAnchorAfterInstall = false
    private var anchorAvailable = true
    private(set) var installCalls: [(revision: Int, generation: Int)] = []
    private(set) var clearCalls: [(owner: String, itemID: String, generation: Int)] = []
    private(set) var teardownCount = 0
    private(set) var invokeCalls = 0

    func installHostedDescriptor(
        _ descriptor: AOSHostedStatusItemDescriptor,
        generation: Int
    ) -> [String: Any]? {
        installCalls.append((descriptor.revision, generation))
        actionAdmission.install(generation: generation)
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
            "action_sequence": hostedActionSequence,
            "anchor": anchor(owner: descriptor.owner, itemID: descriptor.itemID),
        ]
    }

    func invokeHostedAction(
        owner: String,
        itemID: String,
        actionID: String,
        expectedGeneration: Int?,
        expectedRevision: Int?,
        expectedActionSequence: Int,
        dryRun: Bool
    ) -> [String: Any] {
        invokeCalls += 1
        guard let descriptor = hostedDescriptor,
              descriptor.owner == owner,
              descriptor.itemID == itemID else {
            return ["error": "status item lease is unavailable", "code": "STATUS_ITEM_UNAVAILABLE"]
        }
        guard expectedGeneration == hostedGeneration else {
            return ["error": "status item generation is stale", "code": "STATUS_ITEM_STALE_GENERATION"]
        }
        guard expectedRevision == descriptor.revision else {
            return ["error": "status item descriptor revision is stale", "code": "STATUS_ITEM_STALE_REVISION"]
        }
        guard actionID == descriptor.primaryActionID else {
            return ["error": "status item action is unknown", "code": "STATUS_ITEM_ACTION_NOT_FOUND"]
        }
        let admission = actionAdmission.admit(expected: expectedActionSequence, dryRun: dryRun) { acceptedSequence in
            self.emitAction(actionID: actionID, actionSequence: acceptedSequence)
        }
        switch admission {
        case .stale:
            return ["error": "status item action sequence is stale", "code": "STATUS_ITEM_STALE_ACTION_SEQUENCE"]
        case .exhausted:
            return ["error": "status item action sequence is exhausted", "code": "STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED"]
        case .deliveryFailed:
            return ["error": "status item event delivery is unavailable", "code": "STATUS_ITEM_EVENT_UNAVAILABLE"]
        case .dryRun(let sequence):
            return invocationResponse(status: "dry_run", actionID: actionID, actionSequence: sequence)
        case .delivered(let sequence):
            return invocationResponse(status: "ok", actionID: actionID, actionSequence: sequence)
        }
    }

    func forceActionSequenceExhaustion() {
        actionAdmission = AOSStatusItemActionAdmission(maximumSequence: 1)
        actionAdmission.install(generation: hostedGeneration)
    }

    func emitNativeAction() -> Bool {
        guard let descriptor = hostedDescriptor else { return false }
        let admission = actionAdmission.admit { actionSequence in
            self.emitAction(actionID: descriptor.primaryActionID, actionSequence: actionSequence)
        }
        if case .delivered = admission { return true }
        return false
    }

    private func emitAction(actionID: String, actionSequence: Int) -> Bool {
        hostedEventSink?([
            "type": "primary_activation",
            "owner": hostedDescriptor?.owner ?? "",
            "item_id": hostedDescriptor?.itemID ?? "",
            "generation": hostedGeneration,
            "descriptor_revision": hostedDescriptor?.revision ?? 0,
            "action_sequence": actionSequence,
            "source": "status_item",
            "action_id": actionID,
            "origin_x": 13,
            "origin_y": 14,
            "modifiers": [],
            "bounds": bounds(),
            "anchor": anchor(owner: hostedDescriptor?.owner ?? "", itemID: hostedDescriptor?.itemID ?? ""),
        ]) ?? false
    }

    private func invocationResponse(status: String, actionID: String, actionSequence: Int) -> [String: Any] {
        let currentAnchor = anchor(owner: hostedDescriptor?.owner ?? "", itemID: hostedDescriptor?.itemID ?? "")
        return [
            "status": status,
            "owner": hostedDescriptor?.owner ?? "",
            "item_id": hostedDescriptor?.itemID ?? "",
            "action_id": actionID,
            "generation": hostedGeneration,
            "descriptor_revision": hostedDescriptor?.revision ?? 0,
            "action_sequence": actionSequence,
            "event_type": "primary_activation",
            "bounds": currentAnchor["bounds"] ?? NSNull(),
            "anchor": currentAnchor,
        ]
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
            "display": [
                "id": 1,
                "frame": ["x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0, "origin_x": 960.0, "origin_y": 540.0],
                "visible_frame": ["x": 0.0, "y": 24.0, "width": 1920.0, "height": 1056.0, "origin_x": 960.0, "origin_y": 552.0],
            ],
            "topology": ["display_count": 1, "display_ids": [1], "truncated": false],
        ]
    }
}

private final class CallbackRecorder {
    var admitsEvents = true
    private(set) var attemptedEvents: [(owner: UUID, event: String, data: [String: Any])] = []
    private(set) var emittedEvents: [(owner: UUID, event: String, data: [String: Any])] = []
    private(set) var terminations: [(owner: UUID, reason: String)] = []

    func emit(owner: UUID, event: String, data: [String: Any], ref: String?) -> Bool {
        attemptedEvents.append((owner, event, data))
        guard admitsEvents else { return false }
        emittedEvents.append((owner, event, data))
        return true
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

private func inspectActionSequence(
    _ controller: AOSStatusItemHostController,
    revision: Int,
    generation: Int = 1
) -> Int? {
    let result = command(
        controller,
        action: "status-item-inspect",
        payload: exactIdentity(revision: revision, generation: generation),
        connectionID: UUID()
    )
    return (result.response["state"] as? [String: Any])?["action_sequence"] as? Int
}

private func actionEvents(_ recorder: CallbackRecorder) -> [(owner: UUID, event: String, data: [String: Any])] {
    recorder.emittedEvents.filter { $0.data["action_sequence"] != nil }
}

private func runConcurrentCommands(
    _ first: @escaping () -> AOSStatusItemHostCommandResult,
    _ second: @escaping () -> AOSStatusItemHostCommandResult
) -> [AOSStatusItemHostCommandResult] {
    let group = DispatchGroup()
    let lock = NSLock()
    var results: [AOSStatusItemHostCommandResult] = []
    for operation in [first, second] {
        group.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            let result = operation()
            lock.lock()
            results.append(result)
            lock.unlock()
            group.leave()
        }
    }
    while group.wait(timeout: .now()) == .timedOut {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.005))
    }
    return results
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

private func testDryRunDoesNotConsumeActionSequence() {
    let (_, recorder, controller) = makeController()
    let owner = UUID(uuidString: "55555555-5555-5555-5555-555555555555")!
    expect(responseCode(register(controller, owner: owner)) == nil, "dry-run registration failed")

    let dryRun = command(
        controller,
        action: "status-item-invoke-dry-run",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(dryRun) == nil, "dry-run failed")
    expect(dryRun.response["status"] as? String == "dry_run", "dry-run returned the wrong status")
    expect(dryRun.response["action_sequence"] as? Int == 1, "dry-run returned the wrong action sequence")
    expect(inspectActionSequence(controller, revision: 3) == 1, "dry-run consumed the action sequence")
    expect(actionEvents(recorder).isEmpty, "dry-run emitted an action event")

    let invoked = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(invoked) == nil, "effectful invoke after dry-run failed")
    expect(invoked.response["action_sequence"] as? Int == 1, "effectful invoke accepted the wrong sequence")
    expect(inspectActionSequence(controller, revision: 3) == 2, "effectful invoke did not consume admission")
}

private func testInvokeRejectsUnknownRequestFieldsBeforeAdmission() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "12121212-1212-1212-1212-121212121212")!
    expect(responseCode(register(controller, owner: owner)) == nil, "unknown-field registration failed")
    var payload = invokePayload(revision: 3)
    payload["unexpected"] = true

    let rejected = command(controller, action: "status-item-invoke", payload: payload, connectionID: UUID())
    expect(responseCode(rejected) == "INVALID_STATUS_ITEM_INVOKE", "unknown invoke field was not rejected")
    expect(manager.invokeCalls == 0, "unknown invoke field reached the host action")
    expect(manager.hostedActionSequence == 1, "unknown invoke field consumed admission")
    expect(actionEvents(recorder).isEmpty, "unknown invoke field emitted an action event")
}

private func testInvokeRejectsTransportKeysBeforeHostAction() {
    let reservedFields: [(String, Any)] = [
        ("action", "status-item-invoke"),
        ("__envelope_ref", "attacker-ref"),
        ("__envelope_active", true),
    ]
    for (index, field) in reservedFields.enumerated() {
        let (manager, recorder, controller) = makeController()
        let owner = UUID(uuidString: "14141414-1414-1414-1414-14141414141\(index + 4)")!
        expect(responseCode(register(controller, owner: owner)) == nil, "reserved-field registration failed")
        var payload = invokePayload(revision: 3)
        payload[field.0] = field.1

        let rejected = command(controller, action: "status-item-invoke", payload: payload, connectionID: UUID())
        expect(responseCode(rejected) == "INVALID_STATUS_ITEM_INVOKE", "reserved invoke field \(field.0) was not rejected")
        expect(manager.invokeCalls == 0, "reserved invoke field \(field.0) reached the host action")
        expect(manager.hostedActionSequence == 1, "reserved invoke field \(field.0) consumed admission")
        expect(actionEvents(recorder).isEmpty, "reserved invoke field \(field.0) emitted an action event")
    }
}

private func testDryRunAndEffectfulInvokeShareExhaustionChecks() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "13131313-1313-1313-1313-131313131313")!
    expect(responseCode(register(controller, owner: owner)) == nil, "exhaustion registration failed")
    manager.forceActionSequenceExhaustion()

    let dryRun = command(controller, action: "status-item-invoke-dry-run", payload: invokePayload(revision: 3), connectionID: UUID())
    let effectful = command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3), connectionID: UUID())
    expect(responseCode(dryRun) == "STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED", "dry-run ignored sequence exhaustion")
    expect(responseCode(effectful) == "STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED", "effectful invoke used a different exhaustion result")
    expect(manager.hostedActionSequence == 1, "exhaustion mutated the action sequence")
    expect(actionEvents(recorder).isEmpty, "exhaustion emitted an action event")
}

private func testConcurrentSameSequenceAdmitsExactlyOnce() {
    let (_, recorder, controller) = makeController()
    let owner = UUID(uuidString: "99999999-9999-9999-9999-999999999999")!
    expect(responseCode(register(controller, owner: owner)) == nil, "concurrent registration failed")

    let invoke = {
        command(
            controller,
            action: "status-item-invoke",
            payload: invokePayload(revision: 3),
            connectionID: UUID()
        )
    }
    let results = runConcurrentCommands(invoke, invoke)
    let codes = results.map(responseCode)
    expect(codes.filter { $0 == nil }.count == 1, "concurrent invokes did not produce exactly one success")
    expect(codes.filter { $0 == "STATUS_ITEM_STALE_ACTION_SEQUENCE" }.count == 1, "concurrent invokes did not reject one stale sequence")
    let events = actionEvents(recorder)
    expect(events.count == 1, "concurrent invokes emitted duplicate events")
    expect(events.first?.data["action_sequence"] as? Int == 1, "concurrent invoke event used the wrong sequence")
    expect(inspectActionSequence(controller, revision: 3) == 2, "concurrent invokes consumed more than one admission")
}

private func testNativeAndProgrammaticRaceShareAllocator() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
    expect(responseCode(register(controller, owner: owner)) == nil, "native race registration failed")

    let group = DispatchGroup()
    let lock = NSLock()
    var programResult: AOSStatusItemHostCommandResult?
    group.enter()
    DispatchQueue.global(qos: .userInitiated).async {
        let result = command(
            controller,
            action: "status-item-invoke",
            payload: invokePayload(revision: 3),
            connectionID: UUID()
        )
        lock.lock()
        programResult = result
        lock.unlock()
        group.leave()
    }
    group.enter()
    DispatchQueue.global(qos: .userInitiated).async {
        _ = DispatchQueue.main.sync { manager.emitNativeAction() }
        group.leave()
    }
    while group.wait(timeout: .now()) == .timedOut {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.005))
    }

    lock.lock()
    let programCode = programResult.map(responseCode) ?? "missing"
    lock.unlock()
    expect(programCode == nil || programCode == "STATUS_ITEM_STALE_ACTION_SEQUENCE", "programmatic race returned the wrong result")
    let sequences = actionEvents(recorder).compactMap { $0.data["action_sequence"] as? Int }.sorted()
    expect(sequences == Array(1...sequences.count), "native/programmatic events did not receive unique monotonic sequences")
    expect(inspectActionSequence(controller, revision: 3) == sequences.count + 1, "native/programmatic race left the wrong current sequence")
    let replay = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(replay) == "STATUS_ITEM_STALE_ACTION_SEQUENCE", "native/programmatic race allowed sequence reuse")
}

private func testDescriptorUpdatePreservesActionSequence() {
    let (_, _, controller) = makeController()
    let owner = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
    expect(responseCode(register(controller, owner: owner)) == nil, "preservation registration failed")
    let invoked = command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3), connectionID: UUID())
    expect(responseCode(invoked) == nil, "preservation invoke failed")
    let updated = command(
        controller,
        action: "status-item-update",
        payload: updatePayload(revision: 4, currentRevision: 3),
        connectionID: UUID()
    )
    expect(responseCode(updated) == nil, "preservation update failed")
    expect(inspectActionSequence(controller, revision: 4) == 2, "descriptor update reset the action sequence")
}

private func testLeaseReplacementResetsSequenceAndKeepsReplayIdentityDistinct() {
    let (_, recorder, controller) = makeController()
    let firstOwner = UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!
    let secondOwner = UUID(uuidString: "dddddddd-dddd-dddd-dddd-dddddddddddd")!
    expect(responseCode(register(controller, owner: firstOwner)) == nil, "first generation registration failed")
    expect(responseCode(command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3), connectionID: UUID())) == nil, "first generation invoke failed")
    controller.connectionClosed(firstOwner)

    let replacement = register(controller, owner: secondOwner)
    expect(replacement.response["generation"] as? Int == 2, "replacement did not install a new generation")
    expect(inspectActionSequence(controller, revision: 3, generation: 2) == 1, "replacement did not reset the action sequence")
    expect(responseCode(command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3, generation: 2), connectionID: UUID())) == nil, "replacement invoke failed")
    let replayKeys = actionEvents(recorder).compactMap { event -> String? in
        guard let generation = event.data["generation"] as? Int,
              let sequence = event.data["action_sequence"] as? Int else { return nil }
        return "\(generation):\(sequence)"
    }
    expect(replayKeys == ["1:1", "2:1"], "generation plus action sequence did not identify replay domains")
}

private func testRejectedInvokeEventConsumesAdmissionWithoutDuplicate() {
    let (manager, recorder, controller) = makeController()
    let owner = UUID(uuidString: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")!
    expect(responseCode(register(controller, owner: owner)) == nil, "invoke registration failed")
    recorder.admitsEvents = false

    let invoked = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(invoked) == "STATUS_ITEM_EVENT_UNAVAILABLE", "rejected invoke event returned success")
    expect(manager.hostedActionSequence == 2, "rejected invoke event rolled back its admission")
    expect(manager.teardownCount == 0, "rejected invoke event discarded the consumed generation")
    expect(recorder.terminations.isEmpty, "rejected invoke event terminated before reporting failure")
    expect(actionEvents(recorder).isEmpty, "rejected invoke event was recorded as delivered")

    recorder.admitsEvents = true
    let replay = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3),
        connectionID: UUID()
    )
    expect(responseCode(replay) == "STATUS_ITEM_STALE_ACTION_SEQUENCE", "failed delivery allowed the consumed sequence to replay")
    let next = command(
        controller,
        action: "status-item-invoke",
        payload: invokePayload(revision: 3, actionSequence: 2),
        connectionID: UUID()
    )
    expect(responseCode(next) == nil, "next sequence after failed delivery was not usable")
    expect(actionEvents(recorder).count == 1, "failed delivery produced a duplicate event")
    expect(actionEvents(recorder).first?.data["action_sequence"] as? Int == 2, "post-failure event reused the consumed sequence")
}

private func testStaleGenerationRevisionAndActionSequenceAreDistinct() {
    let (_, _, controller) = makeController()
    let owner = UUID(uuidString: "ffffffff-ffff-ffff-ffff-ffffffffffff")!
    expect(responseCode(register(controller, owner: owner)) == nil, "stale-error registration failed")

    let staleGeneration = command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3, generation: 2), connectionID: UUID())
    let staleRevision = command(controller, action: "status-item-invoke", payload: invokePayload(revision: 4), connectionID: UUID())
    let staleAction = command(controller, action: "status-item-invoke", payload: invokePayload(revision: 3, actionSequence: 2), connectionID: UUID())
    expect(responseCode(staleGeneration) == "STATUS_ITEM_STALE_GENERATION", "stale generation used the wrong error")
    expect(responseCode(staleRevision) == "STATUS_ITEM_STALE_REVISION", "stale revision used the wrong error")
    expect(responseCode(staleAction) == "STATUS_ITEM_STALE_ACTION_SEQUENCE", "stale action sequence used the wrong error")
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
    expect(manager.clearCalls.first?.itemID == "tool", "cleanup used the wrong item id")
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
        testDryRunDoesNotConsumeActionSequence()
        testInvokeRejectsUnknownRequestFieldsBeforeAdmission()
        testInvokeRejectsTransportKeysBeforeHostAction()
        testDryRunAndEffectfulInvokeShareExhaustionChecks()
        testConcurrentSameSequenceAdmitsExactlyOnce()
        testNativeAndProgrammaticRaceShareAllocator()
        testDescriptorUpdatePreservesActionSequence()
        testLeaseReplacementResetsSequenceAndKeepsReplayIdentityDistinct()
        testRejectedInvokeEventConsumesAdmissionWithoutDuplicate()
        testStaleGenerationRevisionAndActionSequenceAreDistinct()
        testConnectionCloseClearsOnlyExactOwner()
        print("status item host controller lifecycle harness passed")
    }
}

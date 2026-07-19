// status-item-host-controller.swift — Owner-scoped native status-item lease controller.

import CoreFoundation
import Foundation

private let aosStatusItemDescriptorSchema = "aos.status_item.descriptor.v1"
private let aosStatusItemEventSchema = "aos.status_item.event.v1"
private let maxSafeJSONInteger = 9_007_199_254_740_991.0

private struct AOSStatusItemLease {
    let owner: UUID
    let ownerID: String
    let itemID: String
    let generation: Int
    let revision: Int
    let signature: String
    var sequence: Int
}

private enum AOSStatusItemDescriptorParseResult {
    case success(AOSHostedStatusItemDescriptor)
    case failure([String: Any])
}

struct AOSStatusItemHostCommandResult {
    let response: [String: Any]
    let afterResponse: (() -> Void)?

    init(_ response: [String: Any], afterResponse: (() -> Void)? = nil) {
        self.response = response
        self.afterResponse = afterResponse
    }
}

final class AOSStatusItemHostController {
    private let manager: StatusItemManager
    private var lease: AOSStatusItemLease?
    private var nextGeneration = 1
    private let emit: (UUID, String, [String: Any], String?) -> Void
    private let iso8601 = ISO8601DateFormatter()

    init(manager: StatusItemManager, emit: @escaping (UUID, String, [String: Any], String?) -> Void) {
        self.manager = manager
        self.emit = emit
        self.manager.hostedEventSink = { [weak self] event in
            self?.receiveHostedEvent(event)
        }
    }

    func connectionClosed(_ connectionID: UUID) {
        runOnMainSync {
            guard let current = self.lease, current.owner == connectionID else { return }
            let cleared = self.manager.clearHostedDescriptor(
                owner: current.ownerID,
                itemID: current.itemID,
                generation: current.generation
            )
            if !cleared { self.manager.teardown() }
            self.lease = nil
        }
    }

    func handleCommand(
        action: String,
        payload: [String: Any],
        connectionID: UUID,
        ref: String?,
        deliver: (AOSStatusItemHostCommandResult) -> Void
    ) {
        runOnMainSync {
            let result: AOSStatusItemHostCommandResult
            switch action {
            case "status-item-register":
                result = self.register(payload: payload, connectionID: connectionID)
            case "status-item-update":
                result = AOSStatusItemHostCommandResult(self.update(payload: payload))
            case "status-item-inspect":
                result = AOSStatusItemHostCommandResult(self.inspect(payload: payload))
            case "status-item-invoke":
                result = AOSStatusItemHostCommandResult(self.invoke(payload: payload, dryRun: false))
            case "status-item-invoke-dry-run":
                result = AOSStatusItemHostCommandResult(self.invoke(payload: payload, dryRun: true))
            default:
                result = AOSStatusItemHostCommandResult(self.failure("UNKNOWN_ACTION", "unknown status item action"))
            }
            deliver(result)
        }
    }

    private func register(payload: [String: Any], connectionID: UUID) -> AOSStatusItemHostCommandResult {
        guard let descriptorPayload = payload["descriptor"] as? [String: Any] else {
            return AOSStatusItemHostCommandResult(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item register requires descriptor"))
        }
        let parsed = parseDescriptor(descriptorPayload)
        guard case .success(let descriptor) = parsed else {
            if case .failure(let error) = parsed { return AOSStatusItemHostCommandResult(error) }
            return AOSStatusItemHostCommandResult(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item descriptor is invalid"))
        }

        if let current = lease,
           current.ownerID != descriptor.owner || current.itemID != descriptor.itemID || current.owner != connectionID {
            return AOSStatusItemHostCommandResult(failure("STATUS_ITEM_LEASE_BUSY", "native status item is already leased"))
        }
        if let current = lease {
            if descriptor.revision < current.revision {
                return AOSStatusItemHostCommandResult(failure("STATUS_ITEM_STALE_REVISION", "status item descriptor revision is stale"))
            }
            if descriptor.revision == current.revision {
                guard descriptor.signature == current.signature else {
                    return AOSStatusItemHostCommandResult(failure("STATUS_ITEM_REVISION_CONFLICT", "status item descriptor revision already names different content"))
                }
                return AOSStatusItemHostCommandResult(registrationResponse(current, updated: false))
            }
            return AOSStatusItemHostCommandResult(failure("STATUS_ITEM_UPDATE_REQUIRED", "advance a live lease with status-item update"))
        }

        let previousDescriptor = manager.hostedDescriptor
        let previousGeneration = manager.hostedGeneration
        let generation = lease?.generation ?? nextGeneration
        guard manager.installHostedDescriptor(descriptor, generation: generation) != nil else {
            if let previousDescriptor {
                _ = manager.installHostedDescriptor(previousDescriptor, generation: previousGeneration)
            } else {
                manager.teardown()
            }
            return AOSStatusItemHostCommandResult(failure("STATUS_ITEM_ANCHOR_UNAVAILABLE", "native status item anchor is unavailable"))
        }

        let isNewLease = lease == nil
        if isNewLease { nextGeneration += 1 }
        let current = AOSStatusItemLease(
            owner: connectionID,
            ownerID: descriptor.owner,
            itemID: descriptor.itemID,
            generation: generation,
            revision: descriptor.revision,
            signature: descriptor.signature,
            sequence: lease?.sequence ?? 0
        )
        lease = current
        let afterResponse: (() -> Void)? = isNewLease ? { [weak self] in self?.emitReady(current) } : nil
        return AOSStatusItemHostCommandResult(
            registrationResponse(current, updated: true),
            afterResponse: afterResponse
        )
    }

    private func update(payload: [String: Any]) -> [String: Any] {
        guard let descriptorPayload = payload["descriptor"] as? [String: Any] else {
            return failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item update requires descriptor")
        }
        let parsed = parseDescriptor(descriptorPayload)
        guard case .success(let descriptor) = parsed else {
            if case .failure(let error) = parsed { return error }
            return failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item descriptor is invalid")
        }
        guard let identity = checkedUpdateIdentity(payload) else {
            return failure("INVALID_STATUS_ITEM_UPDATE", "status item update requires owner, item_id, generation, current_revision, and descriptor")
        }
        guard descriptor.owner == identity.owner, descriptor.itemID == identity.itemID else {
            return failure("STATUS_ITEM_IDENTITY_MISMATCH", "descriptor owner and item must match the requested lease")
        }
        guard descriptor.revision > identity.currentRevision else {
            return failure("STATUS_ITEM_REVISION_NOT_ADVANCED", "updated descriptor revision must advance current_revision")
        }
        guard let current = lease,
              current.ownerID == identity.owner,
              current.itemID == identity.itemID else {
            return failure("STATUS_ITEM_NOT_FOUND", "status item lease was not found")
        }
        guard current.generation == identity.generation,
              current.revision == identity.currentRevision else {
            return failure("STATUS_ITEM_STALE_REVISION", "status item generation or current revision is stale")
        }

        let previousDescriptor = manager.hostedDescriptor
        let previousGeneration = manager.hostedGeneration
        guard let anchor = manager.installHostedDescriptor(descriptor, generation: current.generation) else {
            let restored = previousDescriptor.map {
                manager.installHostedDescriptor($0, generation: previousGeneration) != nil
            } ?? false
            if !restored {
                manager.teardown()
                lease = nil
            }
            return failure("STATUS_ITEM_ANCHOR_UNAVAILABLE", "native status item anchor is unavailable")
        }

        let updated = AOSStatusItemLease(
            owner: current.owner,
            ownerID: current.ownerID,
            itemID: current.itemID,
            generation: current.generation,
            revision: descriptor.revision,
            signature: descriptor.signature,
            sequence: current.sequence
        )
        lease = updated
        return [
            "status": "ok",
            "schema_version": aosStatusItemDescriptorSchema,
            "owner": updated.ownerID,
            "item_id": updated.itemID,
            "generation": updated.generation,
            "previous_descriptor_revision": identity.currentRevision,
            "descriptor_revision": updated.revision,
            "updated": true,
            "anchor": anchor,
            "lease": ["status": "active", "cleanup": "connection_scoped"],
        ]
    }

    private func registrationResponse(_ current: AOSStatusItemLease, updated: Bool) -> [String: Any] {
        [
            "status": "ok",
            "schema_version": aosStatusItemDescriptorSchema,
            "owner": current.ownerID,
            "item_id": current.itemID,
            "generation": current.generation,
            "descriptor_revision": current.revision,
            "updated": updated,
            "anchor": manager.statusItemAnchorPayload(owner: current.ownerID, itemID: current.itemID) ?? NSNull(),
            "lease": ["status": "active", "cleanup": "connection_scoped"],
        ]
    }

    private func inspect(payload: [String: Any]) -> [String: Any] {
        guard let identity = checkedIdentity(payload, actionRequired: false) else {
            return failure("INVALID_STATUS_ITEM_INSPECT", "status item inspect requires owner, item_id, generation, and descriptor_revision")
        }
        guard let current = lease,
              current.ownerID == identity.owner,
              current.itemID == identity.itemID else {
            return failure("STATUS_ITEM_NOT_FOUND", "status item lease was not found")
        }
        guard current.generation == identity.generation,
              current.revision == identity.revision else {
            return failure("STATUS_ITEM_STALE_REVISION", "status item generation or descriptor revision is stale")
        }
        let state = manager.hostedInspectState()
        guard state["anchor"] is [String: Any] else {
            return failure("STATUS_ITEM_ANCHOR_UNAVAILABLE", "native status item anchor is unavailable")
        }
        return ["status": "ok", "state": state]
    }

    private func invoke(payload: [String: Any], dryRun: Bool) -> [String: Any] {
        guard let identity = checkedIdentity(payload, actionRequired: true),
              let actionID = identity.actionID else {
            return failure("INVALID_STATUS_ITEM_INVOKE", "status item invoke requires owner, item_id, action_id, generation, and descriptor_revision")
        }
        guard let current = lease,
              current.ownerID == identity.owner,
              current.itemID == identity.itemID else {
            return failure("STATUS_ITEM_NOT_FOUND", "status item lease was not found")
        }
        guard current.generation == identity.generation,
              current.revision == identity.revision else {
            return failure("STATUS_ITEM_STALE_REVISION", "status item generation or descriptor revision is stale")
        }
        return manager.invokeHostedAction(
            owner: identity.owner,
            itemID: identity.itemID,
            actionID: actionID,
            expectedGeneration: identity.generation,
            expectedRevision: identity.revision,
            dryRun: dryRun
        )
    }

    private func receiveHostedEvent(_ event: [String: Any]) {
        runOnMainSync {
            guard var current = self.lease,
                  current.ownerID == event["owner"] as? String,
                  current.itemID == event["item_id"] as? String,
                  current.generation == self.intValue(event["generation"]),
                  current.revision == self.intValue(event["descriptor_revision"]) else { return }
            current.sequence += 1
            self.lease = current
            var payload = self.redactedEvent(event)
            payload["schema_version"] = aosStatusItemEventSchema
            payload["sequence"] = current.sequence
            payload["timestamp"] = self.iso8601.string(from: Date())
            self.emit(current.owner, event["type"] as? String ?? "event", payload, nil)
        }
    }

    private func emitReady(_ current: AOSStatusItemLease) {
        runOnMainSync {
            guard let anchor = self.manager.statusItemAnchorPayload(owner: current.ownerID, itemID: current.itemID) else { return }
            self.receiveHostedEvent([
                "type": "ready",
                "owner": current.ownerID,
                "item_id": current.itemID,
                "generation": current.generation,
                "descriptor_revision": current.revision,
                "source": "status_item",
                "bounds": anchor["bounds"] ?? NSNull(),
                "anchor": anchor,
            ])
        }
    }

    private func parseDescriptor(_ payload: [String: Any]) -> AOSStatusItemDescriptorParseResult {
        let allowed = Set(["schema_version", "owner", "item_id", "revision", "label", "help_text", "primary_action_id", "menu"])
        guard !payload.keys.contains(where: { !allowed.contains($0) }) else {
            return .failure(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item descriptor contains unsupported fields"))
        }
        guard payload["schema_version"] as? String == aosStatusItemDescriptorSchema else {
            return .failure(failure("INVALID_STATUS_ITEM_SCHEMA", "status item descriptor schema_version is invalid"))
        }
        guard let owner = payload["owner"] as? String,
              let itemID = payload["item_id"] as? String,
              let revision = intValue(payload["revision"]),
              let label = boundedString(payload["label"], min: 1, max: 128),
              let primaryActionID = boundedString(payload["primary_action_id"], min: 1, max: 128),
              validateIdentifier(owner, allowSlash: false),
              validateIdentifier(itemID, allowSlash: false),
              validateIdentifier(primaryActionID, allowSlash: true),
              revision >= 0 else {
            return .failure(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item descriptor identity is invalid"))
        }
        var helpText: String?
        if payload.keys.contains("help_text") {
            guard let value = boundedString(payload["help_text"], min: 0, max: 256) else {
                return .failure(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item help_text is invalid"))
            }
            helpText = value
        }
        guard let menuItems = parseMenu(payload["menu"], primaryActionID: primaryActionID) else {
            return .failure(failure("INVALID_STATUS_ITEM_MENU", "status item menu is invalid"))
        }
        var canonical: [String: Any] = [
            "schema_version": aosStatusItemDescriptorSchema,
            "owner": owner,
            "item_id": itemID,
            "revision": revision,
            "label": label,
            "primary_action_id": primaryActionID,
            "menu": menuItems,
        ]
        if let helpText { canonical["help_text"] = helpText }
        guard let signature = descriptorSignature(canonical) else {
            return .failure(failure("INVALID_STATUS_ITEM_DESCRIPTOR", "status item descriptor could not be canonicalized"))
        }
        return .success(AOSHostedStatusItemDescriptor(
            owner: owner,
            itemID: itemID,
            revision: revision,
            signature: signature,
            label: label,
            helpText: helpText,
            primaryActionID: primaryActionID,
            menuItems: menuItems
        ))
    }

    private func parseMenu(_ value: Any?, primaryActionID: String) -> [[String: Any]]? {
        if value == nil { return [] }
        guard let items = value as? [[String: Any]], items.count <= 32 else { return nil }
        var itemIDs = Set<String>()
        var actionIDs = Set<String>()
        var normalized: [[String: Any]] = []
        for item in items {
            guard let kind = item["kind"] as? String else { return nil }
            if kind == "separator" {
                guard Set(item.keys) == Set(["kind"]) else { return nil }
                normalized.append(["kind": "separator"])
                continue
            }
            let allowed = Set(["kind", "id", "action_id", "label", "enabled", "state", "key_equivalent"])
            guard kind == "item",
                  !item.keys.contains(where: { !allowed.contains($0) }),
                  let id = boundedString(item["id"], min: 1, max: 128),
                  let actionID = boundedString(item["action_id"], min: 1, max: 128),
                  let label = boundedString(item["label"], min: 1, max: 128),
                  validateIdentifier(id, allowSlash: true),
                  validateIdentifier(actionID, allowSlash: true),
                  actionID != primaryActionID,
                  itemIDs.insert(id).inserted,
                  actionIDs.insert(actionID).inserted else { return nil }
            var output: [String: Any] = ["kind": "item", "id": id, "action_id": actionID, "label": label]
            if item.keys.contains("enabled") {
                guard let enabled = item["enabled"] as? Bool else { return nil }
                output["enabled"] = enabled
            }
            if item.keys.contains("state") {
                guard let state = item["state"] as? String, ["off", "on", "mixed"].contains(state) else { return nil }
                output["state"] = state
            }
            if item.keys.contains("key_equivalent") {
                guard let key = boundedString(item["key_equivalent"], min: 0, max: 8) else { return nil }
                output["key_equivalent"] = key
            }
            normalized.append(output)
        }
        return normalized
    }

    private func checkedIdentity(_ payload: [String: Any], actionRequired: Bool) -> (owner: String, itemID: String, generation: Int, revision: Int, actionID: String?)? {
        guard let owner = payload["owner"] as? String,
              let itemID = payload["item_id"] as? String,
              let generation = intValue(payload["generation"]), generation >= 1,
              let revision = intValue(payload["descriptor_revision"]), revision >= 0,
              validateIdentifier(owner, allowSlash: false),
              validateIdentifier(itemID, allowSlash: false) else { return nil }
        let actionID = payload["action_id"] as? String
        if actionRequired, actionID == nil { return nil }
        if let actionID, !validateIdentifier(actionID, allowSlash: true) { return nil }
        return (owner, itemID, generation, revision, actionID)
    }

    private func checkedUpdateIdentity(_ payload: [String: Any]) -> (owner: String, itemID: String, generation: Int, currentRevision: Int)? {
        guard let owner = payload["owner"] as? String,
              let itemID = payload["item_id"] as? String,
              let generation = intValue(payload["generation"]), generation >= 1,
              let currentRevision = intValue(payload["current_revision"]), currentRevision >= 0,
              validateIdentifier(owner, allowSlash: false),
              validateIdentifier(itemID, allowSlash: false) else { return nil }
        return (owner, itemID, generation, currentRevision)
    }

    private func validateIdentifier(_ value: String, allowSlash: Bool) -> Bool {
        let pattern = allowSlash
            ? "^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$"
            : "^[a-z0-9][a-z0-9._-]{0,127}$"
        return value.utf8.count <= 128
            && value.range(of: pattern, options: .regularExpression) != nil
            && !value.contains("..")
    }

    private func boundedString(_ value: Any?, min: Int, max: Int) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let count = trimmed.utf8.count
        return count >= min && count <= max ? trimmed : nil
    }

    private func intValue(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite,
              double.rounded() == double,
              abs(double) <= maxSafeJSONInteger else { return nil }
        return Int(exactly: double)
    }

    private func redactedEvent(_ event: [String: Any]) -> [String: Any] {
        let allowed = Set([
            "type", "owner", "item_id", "generation", "descriptor_revision",
            "source", "origin_x", "origin_y", "modifiers", "bounds", "anchor",
            "action_id", "menu_item_id",
        ])
        return event.filter { allowed.contains($0.key) }
    }

    private func descriptorSignature(_ payload: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return nil }
        return data.base64EncodedString()
    }

    private func runOnMainSync<T>(_ block: () -> T) -> T {
        if Thread.isMainThread { return block() }
        return DispatchQueue.main.sync(execute: block)
    }

    private func failure(_ code: String, _ message: String) -> [String: Any] {
        ["error": message, "code": code]
    }
}

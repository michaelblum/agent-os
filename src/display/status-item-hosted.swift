// status-item-hosted.swift — Hosted descriptor projection for StatusItemManager.

import AppKit
import Foundation

extension StatusItemManager {
    var currentAccessibilityLabel: String {
        hostedDescriptor?.label ?? Self.defaultAccessibilityLabel
    }

    func installHostedDescriptor(_ descriptor: AOSHostedStatusItemDescriptor, generation: Int) -> [String: Any]? {
        hostedDescriptor = descriptor
        hostedGeneration = generation
        statusMenuItems = descriptor.menuItems.compactMap(StatusItemMenuDescriptor.init(raw:))
        if statusItem == nil { setup() }
        updateAccessibilityIdentity()
        updateIcon()
        startHostedAnchorObservation()
        return statusItemAnchorPayload(owner: descriptor.owner, itemID: descriptor.itemID)
    }

    func clearHostedDescriptor(owner: String, itemID: String, generation: Int) -> Bool {
        guard let hosted = hostedDescriptor,
              hosted.owner == owner,
              hosted.itemID == itemID,
              hostedGeneration == generation else {
            return false
        }
        hostedDescriptor = nil
        hostedGeneration = 0
        statusMenuItems = []
        updateAccessibilityIdentity()
        updateIcon()
        teardown()
        return true
    }

    func hostedInspectState() -> [String: Any] {
        var payload: [String: Any] = [
            "schema_version": "aos.status_item.inspect.v1",
            "host": "native_status_item",
            "visible": statusItem != nil,
            "accessibility_label": currentAccessibilityLabel,
            "bounds": statusItemBoundsPayload() ?? NSNull(),
        ]
        if let hosted = hostedDescriptor {
            payload["status"] = "leased"
            payload["owner"] = hosted.owner
            payload["item_id"] = hosted.itemID
            payload["generation"] = hostedGeneration
            payload["descriptor_revision"] = hosted.revision
            payload["label"] = hosted.label
            payload["primary_action_id"] = hosted.primaryActionID
            payload["menu_item_count"] = statusMenuItems.filter { !$0.isSeparator }.count
            payload["anchor"] = statusItemAnchorPayload(owner: hosted.owner, itemID: hosted.itemID) ?? NSNull()
        } else {
            payload["status"] = statusItem == nil ? "absent" : "unleased"
            payload["owner"] = NSNull()
            payload["item_id"] = NSNull()
            payload["generation"] = NSNull()
            payload["descriptor_revision"] = NSNull()
            payload["anchor"] = NSNull()
        }
        return payload
    }

    func invokeHostedAction(owner: String, itemID: String, actionID: String, expectedGeneration: Int?, expectedRevision: Int?, dryRun: Bool) -> [String: Any] {
        guard let hosted = hostedDescriptor,
              hosted.owner == owner,
              hosted.itemID == itemID else {
            return ["error": "status item lease is unavailable", "code": "STATUS_ITEM_UNAVAILABLE"]
        }
        if let expectedGeneration, expectedGeneration != hostedGeneration {
            return ["error": "status item generation is stale", "code": "STATUS_ITEM_STALE_GENERATION"]
        }
        if let expectedRevision, expectedRevision != hosted.revision {
            return ["error": "status item descriptor revision is stale", "code": "STATUS_ITEM_STALE_REVISION"]
        }
        let menuItem = statusMenuItems.first(where: { !$0.isSeparator && $0.actionId == actionID })
        let isPrimary = hosted.primaryActionID == actionID
        guard isPrimary || menuItem != nil else {
            return ["error": "status item action is unknown", "code": "STATUS_ITEM_ACTION_NOT_FOUND"]
        }
        if let menuItem, !menuItem.enabled {
            return ["error": "status item action is disabled", "code": "STATUS_ITEM_ACTION_DISABLED"]
        }
        guard let anchor = statusItemAnchorPayload(owner: owner, itemID: itemID) else {
            return ["error": "status item native anchor is unavailable", "code": "STATUS_ITEM_ANCHOR_UNAVAILABLE"]
        }
        var payload: [String: Any] = [
            "status": dryRun ? "dry_run" : "ok",
            "owner": owner,
            "item_id": itemID,
            "action_id": actionID,
            "generation": hostedGeneration,
            "descriptor_revision": hosted.revision,
            "event_type": isPrimary ? "primary_activation" : "menu_selection",
            "bounds": anchor["bounds"] ?? NSNull(),
            "anchor": anchor,
        ]
        if let menuItem { payload["menu_item_id"] = menuItem.id }
        if !dryRun, !emitHostedEvent(
                type: isPrimary ? "primary_activation" : "menu_selection",
                actionID: actionID,
                menuItemID: menuItem?.id,
                modifiers: [],
                origin: statusItemCGPosition()
            ) {
            return ["error": "status item event delivery is unavailable", "code": "STATUS_ITEM_EVENT_UNAVAILABLE"]
        }
        return payload
    }

    func statusItemBoundsPayload() -> [String: Any]? {
        guard let button = statusItem?.button,
              let window = button.window else {
            return nil
        }
        let buttonRect = window.convertToScreen(button.convert(button.bounds, to: nil))
        guard let displayID = screenDisplayID(window.screen) else { return nil }
        var payload = cgRectPayload(buttonRect)
        payload["display_id"] = Int(displayID)
        return payload
    }

    func statusItemAnchorPayload(owner: String, itemID: String) -> [String: Any]? {
        guard let button = statusItem?.button,
              let window = button.window,
              let screen = window.screen,
              let displayID = screenDisplayID(screen),
              let bounds = statusItemBoundsPayload() else { return nil }
        let allScreens = NSScreen.screens
        let allDisplayIDs = allScreens.compactMap { screenDisplayID($0) }.map(Int.init).sorted()
        var displayIDs = Array(allDisplayIDs.prefix(32))
        if !displayIDs.contains(Int(displayID)) {
            if displayIDs.count == 32 { displayIDs.removeLast() }
            displayIDs.append(Int(displayID))
            displayIDs.sort()
        }
        return [
            "schema_version": "aos.status_item.anchor.v1",
            "anchor_id": "native-status-item/\(owner)/\(itemID)",
            "host": "native_status_item",
            "coordinate_space": "global_display_top_left",
            "visible": true,
            "bounds": bounds,
            "display": [
                "id": Int(displayID),
                "frame": cgRectPayload(screen.frame),
                "visible_frame": cgRectPayload(screen.visibleFrame),
            ],
            "topology": [
                "display_count": allScreens.count,
                "display_ids": displayIDs,
                "truncated": allScreens.count > displayIDs.count,
            ],
        ]
    }

    func updateAccessibilityIdentity() {
        let label = currentAccessibilityLabel
        statusItem?.button?.toolTip = hostedDescriptor?.helpText ?? label
        statusItem?.button?.setAccessibilityLabel(label)
        if let help = hostedDescriptor?.helpText {
            statusItem?.button?.setAccessibilityHelp(help)
        } else {
            statusItem?.button?.setAccessibilityHelp(nil)
        }
    }

    @discardableResult
    func emitHostedEvent(type: String, actionID: String?, menuItemID: String?, modifiers: [String], origin: CGPoint) -> Bool {
        guard let hosted = hostedDescriptor else { return false }
        guard let anchor = statusItemAnchorPayload(owner: hosted.owner, itemID: hosted.itemID) else { return false }
        var payload: [String: Any] = [
            "type": type,
            "owner": hosted.owner,
            "item_id": hosted.itemID,
            "generation": hostedGeneration,
            "descriptor_revision": hosted.revision,
            "source": "status_item",
            "origin_x": Int(origin.x),
            "origin_y": Int(origin.y),
            "modifiers": modifiers,
            "bounds": anchor["bounds"] ?? NSNull(),
            "anchor": anchor,
        ]
        if let actionID { payload["action_id"] = actionID }
        if let menuItemID { payload["menu_item_id"] = menuItemID }
        return hostedEventSink?(payload) ?? false
    }

    private func screenDisplayID(_ screen: NSScreen?) -> UInt32? {
        guard let value = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }
        return value.uint32Value
    }

    private func cgRectPayload(_ rect: NSRect) -> [String: Any] {
        let primaryMaxY = NSScreen.screens.first?.frame.maxY ?? 0
        return [
            "x": Double(rect.minX),
            "y": Double(primaryMaxY - rect.maxY),
            "width": Double(rect.width),
            "height": Double(rect.height),
            "origin_x": Double(rect.midX),
            "origin_y": Double(primaryMaxY - rect.midY),
        ]
    }
}

extension StatusItemManager: AOSStatusItemHosting {}

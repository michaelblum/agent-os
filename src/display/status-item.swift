// status-item.swift — Focused native host for owner-scoped status-item leases.

import AppKit
import Foundation

struct StatusItemMenuDescriptor {
    let id: String
    let actionId: String
    let title: String
    let keyEquivalent: String
    let enabled: Bool
    let state: NSControl.StateValue
    let isSeparator: Bool

    init?(raw: [String: Any]) {
        let kind = raw["kind"] as? String ?? "item"
        if kind == "separator" {
            id = ""
            actionId = ""
            title = ""
            keyEquivalent = ""
            enabled = false
            state = .off
            isSeparator = true
            return
        }

        guard kind == "item",
              let id = raw["id"] as? String,
              let actionId = raw["action_id"] as? String,
              let title = raw["label"] as? String else { return nil }
        self.id = id
        self.actionId = actionId
        self.title = title
        keyEquivalent = raw["key_equivalent"] as? String ?? ""
        enabled = raw["enabled"] as? Bool ?? true
        switch raw["state"] as? String {
        case "on": state = .on
        case "mixed": state = .mixed
        default: state = .off
        }
        isSeparator = false
    }
}

final class StatusItemManager {
    static let defaultAccessibilityLabel = "AOS status item"

    var statusItem: NSStatusItem?
    var statusMenuItems: [StatusItemMenuDescriptor] = []
    var hostedDescriptor: AOSHostedStatusItemDescriptor?
    var hostedGeneration: Int = 0
    var hostedEventSink: (([String: Any]) -> Void)?

    private var fallbackIcon: NSImage?
    private var anchorObservationTokens: [NSObjectProtocol] = []
    private var lastAnchorSignature: String?

    func setup() {
        guard statusItem == nil else { return }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
        statusItem?.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        updateAccessibilityIdentity()
    }

    func teardown() {
        stopHostedAnchorObservation()
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
        hostedDescriptor = nil
        hostedGeneration = 0
        statusMenuItems = []
        lastAnchorSignature = nil
    }

    @objc func handleClick(_ sender: Any?) {
        guard let hosted = hostedDescriptor else { return }
        let event = NSApp.currentEvent
        let modifiers = modifierNames(from: event?.modifierFlags ?? [])
        let origin = statusItemCGPosition()

        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.option) == true {
            emitHostedEvent(type: "secondary_activation", actionID: nil, menuItemID: nil, modifiers: modifiers, origin: origin)
            showContextMenu()
            return
        }

        emitHostedEvent(type: "primary_activation", actionID: hosted.primaryActionID, menuItemID: nil, modifiers: modifiers, origin: origin)
    }

    func updateIcon() {
        guard let button = statusItem?.button else { return }
        if fallbackIcon == nil { fallbackIcon = drawFallbackIcon() }
        button.image = fallbackIcon
        button.imagePosition = .imageOnly
    }

    func statusItemCGPosition() -> CGPoint {
        guard let bounds = statusItemBoundsPayload(),
              let x = bounds["origin_x"] as? Double,
              let y = bounds["origin_y"] as? Double else { return .zero }
        return CGPoint(x: x, y: y)
    }

    private func showContextMenu() {
        guard let button = statusItem?.button, !statusMenuItems.isEmpty else { return }
        let menu = NSMenu()
        for item in statusMenuItems {
            if item.isSeparator {
                menu.addItem(.separator())
                continue
            }
            let menuItem = NSMenuItem(title: item.title, action: #selector(handleMenuItem(_:)), keyEquivalent: item.keyEquivalent)
            menuItem.target = self
            menuItem.representedObject = item.id
            menuItem.isEnabled = item.enabled
            menuItem.state = item.state
            menu.addItem(menuItem)
        }
        statusItem?.menu = menu
        button.performClick(nil)
        statusItem?.menu = nil
    }

    @objc private func handleMenuItem(_ sender: NSMenuItem) {
        guard let itemID = sender.representedObject as? String,
              let item = statusMenuItems.first(where: { !$0.isSeparator && $0.id == itemID }) else {
            return
        }
        emitHostedEvent(
            type: "menu_selection",
            actionID: item.actionId,
            menuItemID: item.id,
            modifiers: modifierNames(from: NSApp.currentEvent?.modifierFlags ?? []),
            origin: statusItemCGPosition()
        )
    }

    private func drawFallbackIcon() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.clear.setFill()
        NSRect(origin: .zero, size: size).fill()
        let path = NSBezierPath()
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = min(size.width, size.height) * 0.36
        for index in 0..<6 {
            let angle = CGFloat.pi / 6 + CGFloat(index) * CGFloat.pi / 3
            let point = CGPoint(
                x: center.x + cos(angle) * radius,
                y: center.y + sin(angle) * radius
            )
            if index == 0 { path.move(to: point) } else { path.line(to: point) }
        }
        path.close()
        NSColor.labelColor.setFill()
        path.fill()
        image.unlockFocus()
        image.isTemplate = true
        return image
    }

    func startHostedAnchorObservation() {
        stopHostedAnchorObservation()
        guard let window = statusItem?.button?.window else { return }
        let center = NotificationCenter.default
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            anchorObservationTokens.append(center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                self?.emitHostedAnchorEvent(type: "bounds_changed", onlyWhenChanged: true)
            })
        }
        anchorObservationTokens.append(center.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.emitHostedAnchorEvent(type: "topology_changed", onlyWhenChanged: false)
        })
        primeHostedAnchorObservation()
    }

    private func stopHostedAnchorObservation() {
        let center = NotificationCenter.default
        anchorObservationTokens.forEach(center.removeObserver)
        anchorObservationTokens.removeAll()
    }

    private func primeHostedAnchorObservation() {
        guard let hosted = hostedDescriptor,
              let anchor = statusItemAnchorPayload(owner: hosted.owner, itemID: hosted.itemID) else {
            lastAnchorSignature = nil
            return
        }
        lastAnchorSignature = anchorSignature(anchor)
    }

    private func emitHostedAnchorEvent(type: String, onlyWhenChanged: Bool) {
        guard let hosted = hostedDescriptor,
              let anchor = statusItemAnchorPayload(owner: hosted.owner, itemID: hosted.itemID) else { return }
        let signature = anchorSignature(anchor)
        if onlyWhenChanged, signature == lastAnchorSignature { return }
        lastAnchorSignature = signature
        hostedEventSink?([
            "type": type,
            "owner": hosted.owner,
            "item_id": hosted.itemID,
            "generation": hostedGeneration,
            "descriptor_revision": hosted.revision,
            "source": "status_item",
            "bounds": anchor["bounds"] ?? NSNull(),
            "anchor": anchor,
        ])
    }

    private func anchorSignature(_ anchor: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(anchor),
              let data = try? JSONSerialization.data(withJSONObject: anchor, options: [.sortedKeys]) else {
            return nil
        }
        return data.base64EncodedString()
    }

    private func modifierNames(from flags: NSEvent.ModifierFlags) -> [String] {
        var values: [String] = []
        if flags.contains(.control) { values.append("control") }
        if flags.contains(.option) { values.append("option") }
        if flags.contains(.command) { values.append("command") }
        if flags.contains(.shift) { values.append("shift") }
        return values
    }
}

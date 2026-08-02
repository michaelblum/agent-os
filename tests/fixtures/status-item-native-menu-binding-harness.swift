import AppKit
import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

private func descriptor(revision: Int, actionID: String, enabled: Bool = true) -> AOSHostedStatusItemDescriptor {
    AOSHostedStatusItemDescriptor(
        owner: "io.example.app",
        itemID: "tool",
        revision: revision,
        signature: "revision-\(revision)-\(actionID)-\(enabled)",
        label: "Example Tool",
        helpText: nil,
        primaryActionID: "activate",
        menuItems: [[
            "kind": "item",
            "id": "panel",
            "action_id": actionID,
            "label": "Panel",
            "enabled": enabled,
        ]]
    )
}

private func prepare(_ manager: StatusItemManager, descriptor: AOSHostedStatusItemDescriptor, generation: Int = 7) {
    manager.hostedActionAdmission.install(generation: generation)
    manager.hostedGeneration = generation
    manager.hostedDescriptor = descriptor
    manager.statusMenuItems = descriptor.menuItems.compactMap(StatusItemMenuDescriptor.init(raw:))
}

private func retainedRenderedRow(_ manager: StatusItemManager) -> NSMenuItem {
    let menu = manager.makeHostedContextMenu()
    guard let row = menu.items.first else {
        fputs("FAIL: production menu rendering produced no row\n", stderr)
        exit(1)
    }
    return row
}

private func testRemappedRenderedRowIsRejected() {
    let manager = StatusItemManager()
    var emitted = 0
    manager.hostedEventSink = { _ in emitted += 1; return true }
    prepare(manager, descriptor: descriptor(revision: 1, actionID: "open_panel"))
    let oldRow = retainedRenderedRow(manager)
    let binding = oldRow.representedObject as? AOSStatusItemMenuActionBinding
    expect(binding?.generation == 7, "rendered row omitted generation")
    expect(binding?.descriptorRevision == 1, "rendered row omitted descriptor revision")
    expect(binding?.menuItemID == "panel", "rendered row omitted menu-item id")
    expect(binding?.actionID == "open_panel", "rendered row omitted action id")
    expect(binding?.enabled == true, "rendered row omitted enabled state")

    prepare(manager, descriptor: descriptor(revision: 2, actionID: "close_panel"))
    manager.handleMenuItem(oldRow)
    expect(emitted == 0, "remapped rendered row emitted an event")
    expect(manager.hostedActionSequence == 1, "remapped rendered row consumed admission")
}

private func testDisabledRenderedRowIsRejected() {
    let manager = StatusItemManager()
    var emitted = 0
    manager.hostedEventSink = { _ in emitted += 1; return true }
    prepare(manager, descriptor: descriptor(revision: 3, actionID: "open_panel"))
    let oldRow = retainedRenderedRow(manager)
    manager.statusMenuItems = descriptor(revision: 3, actionID: "open_panel", enabled: false)
        .menuItems.compactMap(StatusItemMenuDescriptor.init(raw:))

    manager.handleMenuItem(oldRow)
    expect(emitted == 0, "disabled rendered row emitted an event")
    expect(manager.hostedActionSequence == 1, "disabled rendered row consumed admission")
}

private func testPreviousGenerationRenderedRowIsRejected() {
    let manager = StatusItemManager()
    var emitted = 0
    manager.hostedEventSink = { _ in emitted += 1; return true }
    prepare(manager, descriptor: descriptor(revision: 4, actionID: "open_panel"), generation: 7)
    let oldRow = retainedRenderedRow(manager)

    prepare(manager, descriptor: descriptor(revision: 4, actionID: "open_panel"), generation: 8)
    manager.handleMenuItem(oldRow)
    expect(emitted == 0, "previous-generation rendered row emitted an event")
    expect(manager.hostedActionSequence == 1, "previous-generation rendered row consumed admission")
}

@main
private struct StatusItemNativeMenuBindingHarness {
    static func main() {
        testRemappedRenderedRowIsRejected()
        testDisabledRenderedRowIsRejected()
        testPreviousGenerationRenderedRowIsRejected()
        print("status item native menu binding harness passed")
    }
}

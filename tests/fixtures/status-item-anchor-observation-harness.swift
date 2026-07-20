import AppKit
import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

private func waitForObservation() {
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
}

@main
struct StatusItemAnchorObservationHarness {
    static func main() {
        let center = NotificationCenter()
        let firstButton = NSView()
        let firstWindow = NSObject()
        firstButton.postsFrameChangedNotifications = false
        var host: AOSStatusItemAnchorObservationHost? = AOSStatusItemAnchorObservationHost(
            button: firstButton,
            window: firstWindow
        )
        var signature = "initial"
        var boundsEvents = 0
        var topologyEvents = 0
        let observation = AOSStatusItemAnchorObservation(
            center: center,
            reacquisitionInterval: 0.01,
            resolveHost: { host },
            readSignature: { host == nil ? nil : signature },
            onBoundsChanged: { boundsEvents += 1 },
            onTopologyChanged: { topologyEvents += 1 }
        )

        observation.start()
        expect(firstButton.postsFrameChangedNotifications, "frame notifications were not enabled")
        center.post(name: NSView.frameDidChangeNotification, object: firstButton)
        expect(boundsEvents == 0, "unchanged frame emitted a duplicate event")
        signature = "first-move"
        center.post(name: NSView.frameDidChangeNotification, object: firstButton)
        center.post(name: NSView.frameDidChangeNotification, object: firstButton)
        expect(boundsEvents == 1, "changed frame was not emitted exactly once")

        host = nil
        center.post(name: NSView.frameDidChangeNotification, object: firstButton)
        expect(!firstButton.postsFrameChangedNotifications, "first button notification state was not restored")

        let secondButton = NSView()
        let secondWindow = NSObject()
        secondButton.postsFrameChangedNotifications = true
        host = AOSStatusItemAnchorObservationHost(button: secondButton, window: secondWindow)
        signature = "reacquired"
        waitForObservation()
        expect(boundsEvents == 2, "detached host was not reacquired")
        expect(secondButton.postsFrameChangedNotifications, "rehosted button notifications were not enabled")

        let thirdButton = NSView()
        let thirdWindow = NSObject()
        thirdButton.postsFrameChangedNotifications = false
        host = AOSStatusItemAnchorObservationHost(button: thirdButton, window: thirdWindow)
        signature = "silent-rehost"
        waitForObservation()
        expect(boundsEvents == 3, "silent host replacement was not discovered")
        expect(secondButton.postsFrameChangedNotifications, "second button prior notification state was not restored")
        expect(thirdButton.postsFrameChangedNotifications, "third button notifications were not enabled")

        signature = "third-move"
        center.post(name: NSView.frameDidChangeNotification, object: firstButton)
        center.post(name: NSView.frameDidChangeNotification, object: secondButton)
        expect(boundsEvents == 3, "retired button still emitted events")
        center.post(name: NSView.frameDidChangeNotification, object: thirdButton)
        expect(boundsEvents == 4, "current button did not emit a changed frame")

        signature = "topology-change"
        center.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
        expect(topologyEvents == 1, "topology change was not emitted")

        observation.stop()
        expect(!thirdButton.postsFrameChangedNotifications, "stop did not restore the observed button")
        signature = "after-stop"
        center.post(name: NSView.frameDidChangeNotification, object: thirdButton)
        center.post(name: NSWindow.didMoveNotification, object: thirdWindow)
        center.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
        waitForObservation()
        expect(boundsEvents == 4 && topologyEvents == 1, "stopped observation emitted events")
        print("status item anchor observation lifecycle harness passed")
    }
}

import AppKit
import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
private struct AOSDaemonAppKitReadinessTests {
    static func main() {
        var scheduled: [() -> Void] = []
        var starts = 0
        let lifecycle = AOSDaemonApplicationLifecycle(
            schedule: { scheduled.append($0) },
            startDaemon: { starts += 1 }
        )
        let notification = Notification(name: NSApplication.didFinishLaunchingNotification)

        lifecycle.applicationDidFinishLaunching(notification)
        lifecycle.applicationDidFinishLaunching(notification)

        require(starts == 0, "daemon started inline before an AppKit event-loop turn")
        require(scheduled.count == 1, "duplicate launch notification scheduled daemon twice")

        scheduled.removeFirst()()
        require(starts == 1, "queued AppKit turn did not start daemon exactly once")

        lifecycle.applicationDidFinishLaunching(notification)
        require(scheduled.isEmpty, "settled daemon launch scheduled another start")
        require(starts == 1, "settled daemon launch started twice")

        print("daemon AppKit readiness harness passed")
    }
}

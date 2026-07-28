import AppKit
import Foundation

final class AOSDaemonApplicationLifecycle: NSObject, NSApplicationDelegate {
    typealias Scheduler = (@escaping () -> Void) -> Void

    private let schedule: Scheduler
    private let startDaemon: () -> Void
    private var startScheduled = false
    private var started = false

    init(
        schedule: @escaping Scheduler = { action in
            DispatchQueue.main.async(execute: action)
        },
        startDaemon: @escaping () -> Void
    ) {
        self.schedule = schedule
        self.startDaemon = startDaemon
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !startScheduled else { return }
        startScheduled = true
        schedule { [weak self] in
            self?.startOnce()
        }
    }

    private func startOnce() {
        guard !started else { return }
        started = true
        startDaemon()
    }
}

// input-safety-visual-feedback.swift — daemon-owned log-console countdown presenter.

import Foundation

struct InputSafetyVisualFeedbackSnapshot {
    let active: Bool
    let reusedExistingLogConsole: Bool
    let createdLogConsole: Bool
    let deadline: Date?
    let lastDisplayedRemaining: Int?
    let cleanupPending: Bool
    let cleanupComplete: Bool
}

protocol InputSafetyVisualFeedbackRuntime: AnyObject {
    func logConsoleExists() -> Bool
    func createLogConsole() -> Bool
    func resumeLogConsole()
    func bringLogConsoleForward()
    func sendCountdown(remaining: Int, deadline: Date, active: Bool)
    func removeLogConsole()
}

final class InputSafetyVisualFeedbackPresenter {
    private let runtime: InputSafetyVisualFeedbackRuntime
    private let lock = NSLock()
    private var timer: DispatchSourceTimer?
    private var active = false
    private var reusedExistingLogConsole = false
    private var createdLogConsole = false
    private var deadline: Date?
    private var lastDisplayedRemaining: Int?
    private var cleanupPending = false
    private var cleanupComplete = false

    init(runtime: InputSafetyVisualFeedbackRuntime) {
        self.runtime = runtime
    }

    func trigger(deadline newDeadline: Date, now: Date = Date()) {
        cancelTimer()

        let existedBefore = runtime.logConsoleExists()
        var createdNow = false
        if !existedBefore {
            createdNow = runtime.createLogConsole()
        }

        lock.lock()
        active = true
        deadline = newDeadline
        cleanupPending = false
        cleanupComplete = false
        if createdNow {
            createdLogConsole = true
            reusedExistingLogConsole = false
        } else if existedBefore && !createdLogConsole {
            reusedExistingLogConsole = true
        }
        lock.unlock()

        runtime.resumeLogConsole()
        runtime.bringLogConsoleForward()
        tick(now: now)
        startTimer()
    }

    func tick(now: Date = Date()) {
        lock.lock()
        guard active, let deadline else {
            lock.unlock()
            return
        }
        let shouldCleanupCreatedConsole = createdLogConsole
        let remaining = Int(ceil(deadline.timeIntervalSince(now)))
        if remaining <= 0 {
            active = false
            lastDisplayedRemaining = nil
            cleanupPending = shouldCleanupCreatedConsole
            lock.unlock()

            runtime.sendCountdown(remaining: 0, deadline: deadline, active: false)
            if shouldCleanupCreatedConsole {
                runtime.removeLogConsole()
            }

            lock.lock()
            cleanupComplete = shouldCleanupCreatedConsole
            cleanupPending = false
            if shouldCleanupCreatedConsole {
                createdLogConsole = false
            }
            lock.unlock()
            cancelTimer()
            return
        }

        lastDisplayedRemaining = remaining
        lock.unlock()
        runtime.sendCountdown(remaining: remaining, deadline: deadline, active: true)
    }

    func snapshot() -> InputSafetyVisualFeedbackSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return InputSafetyVisualFeedbackSnapshot(
            active: active,
            reusedExistingLogConsole: reusedExistingLogConsole,
            createdLogConsole: createdLogConsole,
            deadline: deadline,
            lastDisplayedRemaining: lastDisplayedRemaining,
            cleanupPending: cleanupPending,
            cleanupComplete: cleanupComplete
        )
    }

    private func startTimer() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(1), repeating: .seconds(1))
        timer.setEventHandler { [weak self] in
            self?.tick()
        }
        timer.resume()
        self.timer = timer
    }

    private func cancelTimer() {
        timer?.cancel()
        timer = nil
    }
}

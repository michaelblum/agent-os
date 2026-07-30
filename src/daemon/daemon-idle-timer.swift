import Foundation

final class AOSDaemonIdleTimer {
    typealias TimerFactory = (DispatchQueue) -> DispatchSourceTimer

    private let lock = NSLock()
    private let queue: DispatchQueue
    private let timerFactory: TimerFactory
    private var timer: DispatchSourceTimer?

    init(
        queue: DispatchQueue = .main,
        timerFactory: @escaping TimerFactory = { DispatchSource.makeTimerSource(queue: $0) }
    ) {
        self.queue = queue
        self.timerFactory = timerFactory
    }

    func schedule(after interval: TimeInterval, handler: @escaping @Sendable () -> Void) {
        precondition(interval.isFinite)

        let candidate = timerFactory(queue)
        candidate.schedule(deadline: .now() + interval)
        candidate.setEventHandler(handler: handler)

        lock.lock()
        let previous = timer
        timer = candidate
        candidate.resume()
        lock.unlock()

        previous?.cancel()
    }

    func cancel() {
        lock.lock()
        let previous = timer
        timer = nil
        lock.unlock()

        previous?.cancel()
    }

    var isScheduled: Bool {
        lock.lock()
        let result = timer != nil
        lock.unlock()
        return result
    }

    deinit {
        cancel()
    }
}

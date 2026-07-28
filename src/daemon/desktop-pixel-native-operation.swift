import Foundation

final class AOSDesktopPixelRetainedNativeOperation: @unchecked Sendable {
    typealias Operation = @Sendable (
        _ completion: @escaping @Sendable (Error?) -> Void
    ) -> Void

    private var completion: AOSDesktopPixelNativeCompletion?
    private let executionQueue: DispatchQueue
    private var finished = false
    private var invoking = false
    private let lock = NSLock()
    private var pendingOperation: Operation?
    private var settlement: Result<Void, Error>?
    private var started = false

    init(
        executionQueue: DispatchQueue = DispatchQueue.global(
            qos: .userInitiated
        )
    ) {
        self.executionQueue = executionQueue
    }

    @discardableResult
    func start(
        operation: @escaping Operation,
        completion: @escaping AOSDesktopPixelNativeCompletion
    ) -> Bool {
        lock.lock()
        guard !started, !finished else {
            lock.unlock()
            return false
        }
        started = true
        self.completion = completion
        pendingOperation = operation
        lock.unlock()

        // Raw-host startup on AppKit's main thread can interrupt the
        // ScreenCaptureKit application connection.
        executionQueue.async { [weak self] in
            self?.invokeIfPending()
        }
        return true
    }

    func settle(_ result: Result<Void, Error>) {
        let delivery: AOSDesktopPixelNativeCompletion?
        lock.lock()
        guard settlement == nil else {
            lock.unlock()
            return
        }
        settlement = result
        delivery = invoking ? nil : finishLocked()
        lock.unlock()
        delivery?(result)
    }

    private func invokeIfPending() {
        let operation: Operation
        lock.lock()
        guard settlement == nil, let pendingOperation else {
            lock.unlock()
            return
        }
        invoking = true
        operation = pendingOperation
        self.pendingOperation = nil
        lock.unlock()

        operation { [weak self] error in
            if let error {
                self?.settle(.failure(error))
            } else {
                self?.settle(.success(()))
            }
        }

        let delivery: AOSDesktopPixelNativeCompletion?
        let result: Result<Void, Error>?
        lock.lock()
        invoking = false
        result = settlement
        delivery = result == nil ? nil : finishLocked()
        lock.unlock()
        if let result { delivery?(result) }
    }

    private func finishLocked() -> AOSDesktopPixelNativeCompletion? {
        guard !finished else { return nil }
        finished = true
        let delivery = completion
        completion = nil
        pendingOperation = nil
        return delivery
    }
}

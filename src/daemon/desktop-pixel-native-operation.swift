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

/// A deadline may end logical delivery, but only the native callback settles
/// ownership. A timed-out token therefore self-retains in quarantine until a
/// late callback arrives; if it never arrives the broker remains terminally
/// failed and no later ScreenCaptureKit work can be admitted.
final class AOSDesktopPixelRetainedCallbackToken<Value>: @unchecked Sendable {
    typealias NativeStart = (@escaping (Value?, Error?) -> Void) -> Void

    let token = UUID()
    private let lock = NSLock()
    private var completion: ((Result<Value, Error>) -> Void)?
    private var delivered = false
    private var selfRetain: AOSDesktopPixelRetainedCallbackToken<Value>?
    private var settled = false

    func start(
        deadline: TimeInterval,
        nativeStart: @escaping NativeStart,
        completion: @escaping (Result<Value, Error>) -> Void
    ) {
        precondition(deadline > 0 && deadline <= 10)
        lock.lock()
        precondition(self.completion == nil && selfRetain == nil)
        self.completion = completion
        selfRetain = self
        lock.unlock()

        DispatchQueue.global(qos: .userInitiated).asyncAfter(
            deadline: .now() + deadline
        ) { [weak self] in
            self?.deadlineExpired()
        }
        nativeStart { [weak self] value, error in
            self?.nativeSettled(value: value, error: error)
        }
    }

    private func deadlineExpired() {
        let delivery: ((Result<Value, Error>) -> Void)?
        lock.lock()
        guard !settled, !delivered else {
            lock.unlock()
            return
        }
        delivered = true
        delivery = completion
        completion = nil
        lock.unlock()
        delivery?(.failure(AOSDesktopFrameCaptureFailure.retirementUncertain))
    }

    private func nativeSettled(value: Value?, error: Error?) {
        let delivery: ((Result<Value, Error>) -> Void)?
        let result: Result<Value, Error>?
        lock.lock()
        guard !settled else {
            lock.unlock()
            return
        }
        settled = true
        if delivered {
            delivery = nil
            result = nil
        } else {
            delivered = true
            delivery = completion
            completion = nil
            if let error {
                result = .failure(error)
            } else if let value {
                result = .success(value)
            } else {
                result = .failure(AOSDesktopFrameCaptureFailure.captureFailed)
            }
        }
        selfRetain = nil
        lock.unlock()
        if let result { delivery?(result) }
    }
}

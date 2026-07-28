import Foundation

private final class InvocationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

struct AOSDesktopPixelNativeBaselineFailure: Error {
    let code: String
    let nativeCode: Int?

    init(code: String, nativeCode: Int? = nil) {
        self.code = code
        self.nativeCode = nativeCode
    }
}

@main
struct DesktopPixelNativeBaselineLifecycleTests {
    static func main() async {
        let success = await AOSDesktopPixelNativeBaselineStopSettlement().wait(
            timeoutMilliseconds: 100,
            operation: { completion in completion(nil) }
        )
        guard case .stopped = success else {
            preconditionFailure("expected settled stop")
        }

        let failure = await AOSDesktopPixelNativeBaselineStopSettlement().wait(
            timeoutMilliseconds: 100,
            operation: { completion in
                completion(NSError(domain: "test", code: 73))
            }
        )
        guard case .failed(73) = failure else {
            preconditionFailure("expected native stop failure")
        }

        let timeout = await AOSDesktopPixelNativeBaselineStopSettlement().wait(
            timeoutMilliseconds: 10,
            operation: { _ in }
        )
        guard case .timedOut = timeout else {
            preconditionFailure("expected bounded stop timeout")
        }

        let reused = AOSDesktopPixelNativeBaselineStopSettlement()
        let invocations = InvocationCounter()
        let first = await reused.wait(timeoutMilliseconds: 10) { _ in
            invocations.increment()
        }
        let second = await reused.wait(timeoutMilliseconds: 10) { _ in
            invocations.increment()
        }
        guard case .timedOut = first, case .timedOut = second else {
            preconditionFailure("expected stable timeout settlement")
        }
        precondition(invocations.count == 1)

        let concurrent = AOSDesktopPixelNativeBaselineStopSettlement()
        let concurrentInvocations = InvocationCounter()
        async let concurrentFirst = concurrent.wait(timeoutMilliseconds: 100) { completion in
            concurrentInvocations.increment()
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(10)) {
                completion(nil)
            }
        }
        async let concurrentSecond = concurrent.wait(timeoutMilliseconds: 100) { completion in
            concurrentInvocations.increment()
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(10)) {
                completion(nil)
            }
        }
        let concurrentOutcomes = await [concurrentFirst, concurrentSecond]
        guard concurrentOutcomes.allSatisfy({ outcome in
            if case .stopped = outcome { return true }
            return false
        }) else {
            preconditionFailure("expected every concurrent waiter to observe the same settlement")
        }
        precondition(concurrentInvocations.count == 1)

        print("PASS desktop pixel native baseline lifecycle settlement")
    }
}

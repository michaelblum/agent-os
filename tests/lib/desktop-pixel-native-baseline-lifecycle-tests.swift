import CoreMedia
import Foundation
import ScreenCaptureKit

enum AOSDesktopFrameCaptureFailure: Error {
    case busy
    case captureFailed
    case retirementUncertain
}

protocol AOSDesktopFrameCancelling {
    func cancel()
}

protocol AOSDesktopPixelWarmSource: AnyObject {
    func cancel(completion: @escaping (Result<Void, Error>) -> Void)
}

final class AOSDesktopPixelBroker {
    static let defaultRetirementTimeout: TimeInterval = 3
}

struct AOSDesktopPixelNativeBaselineFailure: Error {
    let code: String
    let nativeCode: Int?

    init(code: String, nativeCode: Int? = nil) {
        self.code = code
        self.nativeCode = nativeCode
    }
}

private struct StartupFailure: Error {}
private struct LaterFailure: Error {}

private final class FakeLifecycle: AOSDesktopPixelStreamLifecycle,
    @unchecked Sendable
{
    private let latch = AOSDesktopPixelRetirementLatch()
    private let lock = NSLock()
    private var retirementWaitStarted = false
    var ready = false

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        latch.admitExplicitStop()
    }

    func confirmRetirement() {
        latch.observe()
    }

    func sampleIsReady() throws -> Bool {
        ready
    }

    func retirementWasObserved() -> Bool {
        latch.snapshot()
    }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        markRetirementWaitStarted()
        return await latch.wait(timeout: timeout)
    }

    private func markRetirementWaitStarted() {
        lock.lock()
        retirementWaitStarted = true
        lock.unlock()
    }

    func isWaitingForRetirement() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return retirementWaitStarted
    }
}

private final class NativeStartCompletion: @unchecked Sendable {
    private var completion: AOSDesktopPixelNativeCompletion?
    private let lock = NSLock()

    func install(_ completion: @escaping AOSDesktopPixelNativeCompletion) {
        lock.lock()
        self.completion = completion
        lock.unlock()
    }

    func settle(_ result: Result<Void, Error>) {
        lock.lock()
        let completion = self.completion
        self.completion = nil
        lock.unlock()
        precondition(completion != nil)
        completion?(result)
    }
}

private final class IndexRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Int] = []

    func append(_ value: Int) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func snapshot() -> [Int] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

@main
struct DesktopPixelNativeBaselineLifecycleTests {
    static func main() async {
        sampleAdmissionRequiresUsableAdvancingFrames()
        exclusionSetsCoverEveryEndpointExactlyOnce()
        lateFailureStatePreservesTheFirstFailure()
        await partialStartupStopsOnlyTheActiveStream()
        await pendingStartFailureSurvivesRetirementAdmission()
        print("PASS desktop pixel native baseline lifecycle settlement")
    }

    private static func sampleAdmissionRequiresUsableAdvancingFrames() {
        let first = CMTime(value: 1, timescale: 30)
        let second = CMTime(value: 2, timescale: 30)
        precondition(aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.blank.rawValue,
            presentationTime: first,
            hasImageBuffer: true
        ) == nil)
        precondition(aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.complete.rawValue,
            presentationTime: first,
            hasImageBuffer: true
        ) == .frame)

        var advancement = AOSDesktopPixelFrameAdvancement()
        precondition(advancement.observe(presentationTime: first))
        precondition(!advancement.isReady)
        precondition(!advancement.observe(presentationTime: first))
        precondition(!advancement.isReady)
        precondition(advancement.observe(presentationTime: second))
        precondition(advancement.isReady)
    }

    private static func exclusionSetsCoverEveryEndpointExactlyOnce() {
        precondition(aosDesktopPixelNativeBaselineExclusionsAreComplete(
            endpointCount: 2,
            windowIDs: [101, 202]
        ))
        precondition(!aosDesktopPixelNativeBaselineExclusionsAreComplete(
            endpointCount: 2,
            windowIDs: [101]
        ))
        precondition(!aosDesktopPixelNativeBaselineExclusionsAreComplete(
            endpointCount: 2,
            windowIDs: [101, 101]
        ))
        precondition(!aosDesktopPixelNativeBaselineExclusionsAreComplete(
            endpointCount: 2,
            windowIDs: [101, 0]
        ))
    }

    private static func lateFailureStatePreservesTheFirstFailure() {
        let state = AOSDesktopPixelNativeBaselineFailureState()
        let first = StartupFailure()
        state.record(first)
        state.record(LaterFailure())
        precondition(state.current() is StartupFailure)
    }

    private static func partialStartupStopsOnlyTheActiveStream() async {
        let lifecycles = [FakeLifecycle(), FakeLifecycle()]
        let signals = [AOSDesktopPixelStartupSignal(), AOSDesktopPixelStartupSignal()]
        let stopped = IndexRecorder()
        do {
            _ = try await aosStartDesktopPixelStreams(
                signals: signals,
                lifecycles: lifecycles,
                settlementTimeout: 0.25,
                start: { index, completion in
                    completion(index == 0 ? .success(()) : .failure(StartupFailure()))
                },
                stop: { index, completion in
                    stopped.append(index)
                    completion(.success(()))
                }
            )
            preconditionFailure("partial startup unexpectedly succeeded")
        } catch {
            precondition(error is StartupFailure)
        }
        precondition(stopped.snapshot() == [0])
        precondition(lifecycles.allSatisfy { $0.retirementWasObserved() })
    }

    private static func pendingStartFailureSurvivesRetirementAdmission() async {
        let lifecycle = FakeLifecycle()
        let signal = AOSDesktopPixelStartupSignal()
        let nativeStart = NativeStartCompletion()
        let failureState = AOSDesktopPixelNativeBaselineFailureState()
        let owner: AOSDesktopPixelStartupOwner
        do {
            owner = try await aosStartDesktopPixelStreams(
                signals: [signal],
                lifecycles: [lifecycle],
                settlementTimeout: 0.25,
                lateFailure: { error in failureState.record(error) },
                start: { _, completion in
                    nativeStart.install(completion)
                    signal.succeed()
                },
                stop: { _, completion in completion(.success(())) }
            )
        } catch {
            preconditionFailure("published startup unexpectedly failed: \(error)")
        }

        let retirement = Task { await owner.retire(timeout: 0.25) }
        let deadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
        while !lifecycle.isWaitingForRetirement(),
              DispatchTime.now().uptimeNanoseconds < deadline {
            await Task.yield()
        }
        precondition(lifecycle.isWaitingForRetirement())

        let error = StartupFailure()
        let result = Result<Void, Error>.failure(error)
        aosRecordDesktopPixelNativeBaselineStartSettlement(
            result,
            failureState: failureState
        )
        nativeStart.settle(result)

        let retired = await retirement.value
        precondition(retired)
        precondition(failureState.current() is StartupFailure)
    }
}

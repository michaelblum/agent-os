import AVFoundation
import Foundation

typealias AOSMicrophoneNativeInputHandler = (
    AVAudioPCMBuffer,
    AVAudioTime
) -> Void

struct AOSMicrophoneNativeSessionDependencies {
    let start: (@escaping AOSMicrophoneNativeInputHandler) throws -> AVAudioFormat
    let healthy: () -> Bool
    let stop: () -> Bool

    static func live() -> Self {
        let backend = AOSLiveMicrophoneNativeSessionBackend()
        return Self(
            start: { try backend.start($0) },
            healthy: { backend.healthy() },
            stop: { backend.stop() }
        )
    }
}

protocol AOSMicrophoneNativeSessionControlling: AnyObject, Sendable {
    var healthy: Bool { get }
    var authorityAbsent: Bool { get }
    func start(_ handler: @escaping AOSMicrophoneNativeInputHandler) throws -> AVAudioFormat
    @discardableResult func stop() -> Bool
}

final class AOSMicrophoneNativeSession: AOSMicrophoneNativeSessionControlling,
    @unchecked Sendable
{
    private enum State {
        case idle
        case arming
        case active
        case stopping
        case stopped
    }

    private let dependencies: AOSMicrophoneNativeSessionDependencies
    private let lock = NSLock()
    private var state: State = .idle
    private var stopRequested = false

    init(dependencies: AOSMicrophoneNativeSessionDependencies = .live()) {
        self.dependencies = dependencies
    }

    var healthy: Bool {
        lock.lock()
        let active = state == .active && !stopRequested
        lock.unlock()
        return active && dependencies.healthy()
    }

    var authorityAbsent: Bool {
        lock.lock()
        let inactive = state == .idle || state == .stopped
        lock.unlock()
        return inactive && !dependencies.healthy()
    }

    func start(
        _ handler: @escaping AOSMicrophoneNativeInputHandler
    ) throws -> AVAudioFormat {
        lock.lock()
        guard state == .idle else {
            lock.unlock()
            throw AOSOperationCoreError.recordingMicrophoneUnavailable
        }
        state = .arming
        lock.unlock()

        let format: AVAudioFormat
        do {
            format = try dependencies.start(handler)
        } catch {
            let absent = dependencies.stop()
            lock.lock()
            state = absent ? .stopped : .stopping
            lock.unlock()
            throw error
        }

        lock.lock()
        let retireImmediately = stopRequested
        state = retireImmediately ? .stopping : .active
        lock.unlock()
        if retireImmediately {
            let absent = dependencies.stop()
            lock.lock()
            state = absent ? .stopped : .stopping
            lock.unlock()
            throw absent
                ? AOSOperationCoreError.recordingMicrophoneUnavailable
                : AOSOperationCoreError.recordingCleanupRequired
        }
        guard dependencies.healthy() else {
            _ = stop()
            throw AOSOperationCoreError.recordingMicrophoneUnavailable
        }
        return format
    }

    @discardableResult
    func stop() -> Bool {
        lock.lock()
        switch state {
        case .idle, .stopped:
            state = .stopped
            lock.unlock()
            return !dependencies.healthy()
        case .arming:
            stopRequested = true
            lock.unlock()
            return false
        case .stopping:
            lock.unlock()
            let absent = dependencies.stop()
            lock.lock()
            state = absent ? .stopped : .stopping
            lock.unlock()
            return absent
        case .active:
            state = .stopping
            stopRequested = true
            lock.unlock()
        }
        let absent = dependencies.stop()
        lock.lock()
        state = absent ? .stopped : .stopping
        lock.unlock()
        return absent
    }
}

private final class AOSLiveMicrophoneNativeSessionBackend: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var tapInstalled = false

    func start(
        _ handler: @escaping AOSMicrophoneNativeInputHandler
    ) throws -> AVAudioFormat {
        var result: Result<AVAudioFormat, Error>!
        aosRunOnMainSync {
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard !tapInstalled,
                  !engine.isRunning,
                  format.channelCount > 0,
                  format.sampleRate.isFinite,
                  format.sampleRate > 0 else {
                result = .failure(AOSOperationCoreError.recordingMicrophoneUnavailable)
                return
            }
            input.installTap(
                onBus: 0,
                bufferSize: 1_024,
                format: format,
                block: handler
            )
            tapInstalled = true
            engine.prepare()
            do {
                try engine.start()
                result = .success(format)
            } catch {
                input.removeTap(onBus: 0)
                tapInstalled = false
                result = .failure(AOSOperationCoreError.recordingMicrophoneUnavailable)
            }
        }
        return try result.get()
    }

    func healthy() -> Bool {
        var value = false
        aosRunOnMainSync {
            value = tapInstalled
                && engine.isRunning
                && engine.inputNode.outputFormat(forBus: 0).channelCount > 0
        }
        return value
    }

    func stop() -> Bool {
        var absent = false
        aosRunOnMainSync {
            if tapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                tapInstalled = false
            }
            if engine.isRunning { engine.stop() }
            absent = !engine.isRunning && !tapInstalled
        }
        return absent
    }
}

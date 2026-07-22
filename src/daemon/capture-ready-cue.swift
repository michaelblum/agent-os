import AVFoundation
import Darwin
import Foundation

enum AOSCaptureReadyCue: String {
    case none
    case chime

    static func parse(_ value: String?) throws -> AOSCaptureReadyCue {
        guard let value else { return .none }
        guard let cue = AOSCaptureReadyCue(rawValue: value) else {
            throw AOSVoiceTransportFailure(
                code: "INVALID_READY_CUE",
                message: "microphone ready cue must be none or chime"
            )
        }
        return cue
    }
}

final class AOSCaptureInputGate {
    private let lock = NSLock()
    private var openState = false
    private var latestSampleTime: AVAudioFramePosition?
    private var observedTimingSource = false
    private var minimumHostTime: UInt64?
    private var minimumSampleTime: AVAudioFramePosition?

    func observe(_ time: AVAudioTime) -> AOSCaptureInputTimestamp {
        let timestamp = AOSCaptureInputTimestamp(time)
        lock.lock()
        if timestamp.hostTime != nil { observedTimingSource = true }
        if let sampleTime = timestamp.sampleTime {
            observedTimingSource = true
            latestSampleTime = max(latestSampleTime ?? sampleTime, sampleTime)
        }
        lock.unlock()
        return timestamp
    }

    func acceptsInput(at time: AVAudioTime) -> Bool {
        acceptsInput(AOSCaptureInputTimestamp(time))
    }

    func acceptsInput(hostTime: UInt64) -> Bool {
        acceptsInput(AOSCaptureInputTimestamp(hostTime: hostTime, sampleTime: nil))
    }

    func acceptsInput(_ timestamp: AOSCaptureInputTimestamp) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard openState else { return false }
        if let hostTime = timestamp.hostTime, let minimumHostTime {
            return hostTime >= minimumHostTime
        }
        if let sampleTime = timestamp.sampleTime, let minimumSampleTime {
            return sampleTime >= minimumSampleTime
        }
        return minimumHostTime == nil && minimumSampleTime == nil
    }

    @discardableResult
    func open(afterHostTime boundary: UInt64, requireCueExclusion: Bool = true) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if requireCueExclusion && !observedTimingSource { return false }
        minimumHostTime = requireCueExclusion ? boundary : nil
        if requireCueExclusion, let latestSampleTime {
            minimumSampleTime = latestSampleTime == .max ? .max : latestSampleTime + 1
        } else {
            minimumSampleTime = nil
        }
        openState = true
        return true
    }

    func close() {
        lock.lock()
        openState = false
        lock.unlock()
    }
}

struct AOSCaptureInputTimestamp: Equatable {
    let hostTime: UInt64?
    let sampleTime: AVAudioFramePosition?

    init(hostTime: UInt64?, sampleTime: AVAudioFramePosition?) {
        self.hostTime = hostTime
        self.sampleTime = sampleTime
    }

    init(_ time: AVAudioTime) {
        hostTime = time.isHostTimeValid ? time.hostTime : nil
        sampleTime = time.isSampleTimeValid ? time.sampleTime : nil
    }
}

private let aosCaptureReadyCueSampleRate = 48_000.0
private let aosCaptureReadyCueDuration: TimeInterval = 0.14
private let aosCaptureReadyCueSettleDuration: TimeInterval = 0.06
private let aosCaptureReadyCueTimeout: TimeInterval = 1

func aosMakeCaptureReadyCueBuffer() throws -> AVAudioPCMBuffer {
    guard let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: aosCaptureReadyCueSampleRate,
        channels: 1,
        interleaved: false
    ) else {
        throw AOSVoiceTransportFailure(
            code: "READY_CUE_UNAVAILABLE",
            message: "microphone ready cue format is unavailable"
        )
    }
    let frameCount = AVAudioFrameCount((aosCaptureReadyCueDuration * aosCaptureReadyCueSampleRate).rounded())
    guard frameCount > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
          let samples = buffer.floatChannelData?[0] else {
        throw AOSVoiceTransportFailure(
            code: "READY_CUE_UNAVAILABLE",
            message: "microphone ready cue buffer is unavailable"
        )
    }
    buffer.frameLength = frameCount
    var phase = 0.0
    for index in 0..<Int(frameCount) {
        let progress = Double(index) / Double(max(1, Int(frameCount) - 1))
        let attack = min(1, progress / 0.08)
        let release = min(1, (1 - progress) / 0.32)
        let envelope = min(attack, release)
        let frequency = 659.25 + 220.75 * progress
        phase += 2 * Double.pi * frequency / aosCaptureReadyCueSampleRate
        samples[index] = Float(sin(phase) * envelope * 0.18)
    }
    return buffer
}

func aosPlayCaptureReadyCue(
    _ cue: AOSCaptureReadyCue,
    isCanceled: @escaping () -> Bool = { false }
) throws -> UInt64 {
    guard cue == .chime else { return mach_absolute_time() }
    let buffer = try aosMakeCaptureReadyCueBuffer()
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let completed = DispatchSemaphore(value: 0)
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: buffer.format)
    engine.prepare()
    do {
        try engine.start()
    } catch {
        throw AOSVoiceTransportFailure(
            code: "READY_CUE_UNAVAILABLE",
            message: "microphone ready cue output is unavailable"
        )
    }
    defer {
        player.stop()
        engine.stop()
    }
    player.scheduleBuffer(
        buffer,
        at: nil,
        options: [],
        completionCallbackType: .dataPlayedBack
    ) { _ in
        completed.signal()
    }
    player.play()
    let deadline = DispatchTime.now() + aosCaptureReadyCueTimeout
    while completed.wait(timeout: .now() + .milliseconds(10)) != .success {
        if isCanceled() {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        if DispatchTime.now() >= deadline {
            throw AOSVoiceTransportFailure(
                code: "READY_CUE_UNAVAILABLE",
                message: "microphone ready cue did not complete"
            )
        }
    }
    Thread.sleep(forTimeInterval: aosCaptureReadyCueSettleDuration)
    guard !isCanceled() else {
        throw AOSVoiceTransportFailure(
            code: "CAPTURE_CANCELED",
            message: "microphone capture was canceled before startup"
        )
    }
    return mach_absolute_time()
}

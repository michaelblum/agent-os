#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import AVFoundation
import Darwin
import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

private func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var encoded = value.littleEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}

private func writeOneSecondPCMFixture(to output: URL) throws {
    let sampleCount = UInt32(aosVoiceCaptureSampleRate)
    let audioByteCount = sampleCount * 2
    var data = Data("RIFF".utf8)
    appendLittleEndian(UInt32(36) + audioByteCount, to: &data)
    data.append(Data("WAVEfmt ".utf8))
    appendLittleEndian(UInt32(16), to: &data)
    appendLittleEndian(UInt16(1), to: &data)
    appendLittleEndian(UInt16(aosVoiceCaptureChannels), to: &data)
    appendLittleEndian(UInt32(aosVoiceCaptureSampleRate), to: &data)
    appendLittleEndian(UInt32(aosVoiceCaptureSampleRate * 2), to: &data)
    appendLittleEndian(UInt16(2), to: &data)
    appendLittleEndian(UInt16(16), to: &data)
    data.append(Data("data".utf8))
    appendLittleEndian(audioByteCount, to: &data)
    data.append(Data(count: Int(audioByteCount)))
    try data.write(to: output, options: .atomic)
}

private final class FakeMicrophoneAuthorization: AOSMicrophoneAuthorizationProviding {
    private(set) var current: AOSMicrophoneAuthorizationState
    private let requestedState: AOSMicrophoneAuthorizationState
    private(set) var requestCount = 0

    init(
        current: AOSMicrophoneAuthorizationState,
        requestedState: AOSMicrophoneAuthorizationState? = nil
    ) {
        self.current = current
        self.requestedState = requestedState ?? current
    }

    func status() -> AOSMicrophoneAuthorizationState { current }

    func request(timeout: TimeInterval) -> AOSMicrophoneAuthorizationRequestResult {
        let before = current
        guard before == .notDetermined else {
            return AOSMicrophoneAuthorizationRequestResult(
                before: before,
                after: before,
                attempted: false,
                completed: true
            )
        }
        requestCount += 1
        current = requestedState
        return AOSMicrophoneAuthorizationRequestResult(
            before: before,
            after: current,
            attempted: true,
            completed: true
        )
    }
}

@main
struct VoiceTransportNativeTest {
    static func main() throws {
        var events: [String] = []
        let owner = UUID()
        let other = UUID()
        let authorizedMicrophone = FakeMicrophoneAuthorization(current: .authorized)
        let transport = AOSVoiceTransport(emit: { emittedOwner, event, data, ref in
            require(emittedOwner == owner, "event owner drifted")
            require(ref == "hotkey-ref", "event ref drifted")
            require(data["key_code"] == nil, "hotkey event exposed a key code")
            events.append(event)
        }, microphoneAuthorization: authorizedMicrophone)
        try transport.acquireHotkey(owner: owner, shortcut: "Control+Option+Space", ref: "hotkey-ref")
        let modifiers = AOSVoiceModifierSnapshot(control: true, option: true, command: false, shift: false)
        let down = AOSVoiceHotkeyInput(kind: .keyDown, keyCode: 49, modifiers: modifiers, isRepeat: false)
        require(transport.handleHotkey(down), "exact key down was not consumed")
        require(transport.handleHotkey(AOSVoiceHotkeyInput(kind: .keyDown, keyCode: 49, modifiers: modifiers, isRepeat: true)), "repeat was not consumed")
        require(events == ["dictation_opened"], "repeat emitted a second open event")
        let releasedModifiers = AOSVoiceModifierSnapshot(control: false, option: false, command: false, shift: false)
        require(transport.handleHotkey(AOSVoiceHotkeyInput(kind: .keyDown, keyCode: 49, modifiers: releasedModifiers, isRepeat: true)), "active repeat leaked after modifier release")
        require(!transport.handleHotkey(AOSVoiceHotkeyInput(kind: .keyDown, keyCode: 0, modifiers: modifiers, isRepeat: false)), "unrelated key was consumed")
        require(events == ["dictation_opened"], "unrelated key was exposed")
        require(transport.handleHotkey(AOSVoiceHotkeyInput(kind: .keyUp, keyCode: 49, modifiers: releasedModifiers, isRepeat: false)), "active key release was not consumed")
        require(events == ["dictation_opened", "dictation_closed_send"], "hotkey lifecycle drifted")

        do {
            try transport.acquireHotkey(owner: other, shortcut: "Control+Option+Space", ref: nil)
            require(false, "concurrent hotkey lease was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "HOTKEY_LEASE_BUSY", "wrong concurrent lease error")
        }
        transport.connectionClosed(owner)
        try transport.acquireHotkey(owner: other, shortcut: "Control+Option+Space", ref: nil)
        transport.connectionClosed(other)

        require(AOSVoiceShortcut.parse("Command+Space") != nil, "valid shortcut was rejected")
        require(AOSVoiceShortcut.parse("Space") == nil, "modifier-free shortcut was accepted")
        require(AOSVoiceShortcut.parse("Control+Control+Space") == nil, "duplicate modifier was accepted")
        require(AOSVoiceShortcut.parse("Command+Option+Escape") == nil, "input safety shortcut was accepted")
        require(aosVoiceCaptureDuration(120) == 120, "duration bound drifted")
        require(aosVoiceCaptureDuration(121) == 120, "duration cap was not applied")
        require(aosVoiceCaptureDuration(0) == nil, "zero duration was accepted")
        require(aosVoiceCaptureDuration(0.0005) == nil, "sub-millisecond duration was accepted")
        let deadlineStart = DispatchTime(uptimeNanoseconds: 1_000_000_000)
        require(
            !aosVoiceCaptureDeadlineReached(
                startedAt: deadlineStart,
                now: DispatchTime(uptimeNanoseconds: 1_500_000_000),
                maximumDuration: 1
            ),
            "capture deadline fired early"
        )
        require(
            aosVoiceCaptureDeadlineReached(
                startedAt: deadlineStart,
                now: DispatchTime(uptimeNanoseconds: 2_000_000_000),
                maximumDuration: 1
            ),
            "capture deadline did not fire at the wall-clock bound"
        )

        let durationRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("aos-voice-duration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: durationRoot,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        defer { try? FileManager.default.removeItem(at: durationRoot) }
        let durationOutput = durationRoot.appendingPathComponent("duration.wav")
        try writeOneSecondPCMFixture(to: durationOutput)
        require(
            aosVoiceCaptureDurationMilliseconds(at: durationOutput, fallback: 0) == 1000,
            "finalized WAV duration was not authoritative"
        )
        require(
            aosVoiceCaptureDurationMilliseconds(
                at: durationRoot.appendingPathComponent("missing.wav"),
                fallback: 0.5
            ) == 500,
            "unavailable WAV duration did not use recorder fallback"
        )

        let stateCases: [(AVAuthorizationStatus, AOSMicrophoneAuthorizationState)] = [
            (.notDetermined, .notDetermined),
            (.restricted, .restricted),
            (.denied, .denied),
            (.authorized, .authorized),
        ]
        for (native, expected) in stateCases {
            require(AOSMicrophoneAuthorizationState(native) == expected, "native microphone state mapping drifted")
            let status = expected.statusDictionary()
            require(status["owner"] as? String == "daemon", "microphone owner drifted")
            require(status["state"] as? String == expected.rawValue, "microphone state was collapsed")
            require(status["authorized"] as? Bool == expected.isAuthorized, "microphone authorized projection drifted")
        }

        let firstUse = FakeMicrophoneAuthorization(current: .notDetermined, requestedState: .denied)
        let firstUseTransport = AOSVoiceTransport(emit: { _, _, _, _ in }, microphoneAuthorization: firstUse)
        let request = firstUseTransport.requestMicrophoneAuthorization(timeout: 1)
        require(request.before == .notDetermined, "first-use request lost before state")
        require(request.after == .denied, "first-use request lost denied state")
        require(request.attempted && request.completed, "first-use request was not completed")
        require(firstUse.requestCount == 1, "first-use request count drifted")

        for state in [AOSMicrophoneAuthorizationState.restricted, .denied, .unknown] {
            let provider = FakeMicrophoneAuthorization(current: state)
            let deniedTransport = AOSVoiceTransport(emit: { _, _, _, _ in }, microphoneAuthorization: provider)
            let deniedOutput = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("aos-voice-denied-\(UUID().uuidString).wav")
            do {
                try deniedTransport.startCapture(
                    owner: owner,
                    outputPath: deniedOutput.path,
                    maximumDuration: 1,
                    ref: nil
                )
                require(false, "non-authorized microphone state started capture")
            } catch let failure as AOSVoiceTransportFailure {
                require(failure.code == state.failure?.code, "microphone state failure code was collapsed")
            }
            require(!FileManager.default.fileExists(atPath: deniedOutput.path), "failed microphone state created an output file")
        }

        let deniedAfterPrompt = FakeMicrophoneAuthorization(current: .notDetermined, requestedState: .denied)
        let deniedAfterPromptTransport = AOSVoiceTransport(emit: { _, _, _, _ in }, microphoneAuthorization: deniedAfterPrompt)
        do {
            try deniedAfterPromptTransport.startCapture(
                owner: owner,
                outputPath: NSTemporaryDirectory() + "/aos-voice-prompt-denied-\(UUID().uuidString).wav",
                maximumDuration: 1,
                ref: nil
            )
            require(false, "capture continued after first-use denial")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "MICROPHONE_PERMISSION_DENIED", "first-use denial code drifted")
        }
        require(deniedAfterPrompt.requestCount == 1, "capture did not request first-use authorization exactly once")

        let normalizedVoice = try aosSystemSpeechVoiceIdentifier("voice://system/example")
        require(normalizedVoice == "example", "canonical system voice did not normalize")
        do {
            _ = try aosSystemSpeechVoiceIdentifier("voice://mock/example")
            require(false, "non-system streamed voice was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "INVALID_VOICE_PROVIDER", "wrong non-system voice error")
        }

        let tempRoot = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("aos-voice-native-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: tempRoot) }
        let output = tempRoot.appendingPathComponent("capture.wav")
        _ = try aosCreateVoiceCaptureTarget(output.path)
        let attributes = try FileManager.default.attributesOfItem(atPath: output.path)
        require(((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o777 == 0o600, "capture target is not 0600")
        do {
            _ = try aosCreateVoiceCaptureTarget(output.path)
            require(false, "existing target was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "OUTPUT_EXISTS", "wrong existing-target error")
        }
        try FileManager.default.removeItem(at: output)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tempRoot.path)
        do {
            _ = try aosCreateVoiceCaptureTarget(output.path)
            require(false, "non-owner-only parent was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "UNSAFE_OUTPUT_PARENT", "wrong parent-mode error")
        }

        let segmentRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("aos-voice-segments-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: segmentRoot,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        defer { try? FileManager.default.removeItem(at: segmentRoot) }
        let validatedSegmentRoot = try aosValidateVoiceSegmentDirectory(segmentRoot.path)
        require(validatedSegmentRoot.path == segmentRoot.standardizedFileURL.path, "canonical segment directory was rejected")
        let segmentWriter = try AOSAtomicVoiceSegmentWriter(
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1
        )
        let segmentBuffer = AVAudioPCMBuffer(
            pcmFormat: segmentWriter.outputFormat,
            frameCapacity: AVAudioFrameCount(aosVoiceCaptureSampleRate)
        )!
        segmentBuffer.frameLength = segmentBuffer.frameCapacity
        for index in 0..<Int(segmentBuffer.frameLength) {
            segmentBuffer.int16ChannelData![0][index] = index.isMultiple(of: 2) ? 1024 : -1024
        }
        let readySegments = try segmentWriter.append(segmentBuffer)
        require(readySegments.count == 2, "fixed PCM did not produce deterministic segment boundaries")
        require(readySegments.map(\.index) == [1, 2], "segment indexes were not monotonic")
        require(readySegments.allSatisfy { $0.durationMilliseconds == 500 }, "segment duration drifted")
        require(segmentWriter.reachedMaximumDuration, "segment writer did not enforce the capture duration")
        require(segmentWriter.totalBytes <= aosVoiceCaptureMaximumBytes, "segment writer exceeded aggregate bytes")
        for index in 1...2 {
            let segment = segmentRoot.appendingPathComponent(String(format: "segment-%06d.wav", index))
            let attributes = try FileManager.default.attributesOfItem(atPath: segment.path)
            require(
                ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o777 == 0o600,
                "published segment is not 0600"
            )
        }
        let publishedSegmentNames = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(publishedSegmentNames.allSatisfy { !$0.contains("partial") }, "partial segment was exposed after publication")
        segmentWriter.cancel()
        let namesAfterCancellation = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterCancellation.isEmpty, "segment cancellation did not remove owned files")

        let partialWriter = try AOSAtomicVoiceSegmentWriter(
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1
        )
        let partial = AVAudioPCMBuffer(
            pcmFormat: partialWriter.outputFormat,
            frameCapacity: 4_000
        )!
        partial.frameLength = 4_000
        let partialReady = try partialWriter.append(partial)
        require(partialReady.isEmpty, "partial segment published before finalization")
        let finalizedPartial = try partialWriter.finish()
        require(
            finalizedPartial.count == 1 && finalizedPartial[0].durationMilliseconds == 250,
            "explicit stop did not atomically publish the final partial segment"
        )
        partialWriter.cancel()
        try Data("occupied".utf8).write(to: segmentRoot.appendingPathComponent("unexpected.txt"))
        do {
            _ = try aosValidateVoiceSegmentDirectory(segmentRoot.path)
            require(false, "non-empty segment directory was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "SEGMENT_DIRECTORY_NOT_EMPTY", "wrong non-empty segment directory error")
        }
        try FileManager.default.removeItem(at: segmentRoot.appendingPathComponent("unexpected.txt"))
        do {
            _ = try AOSAtomicVoiceSegmentWriter(
                directoryPath: segmentRoot.path,
                segmentDuration: 0.1,
                maximumDuration: 1
            )
            require(false, "undersized segment duration was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "INVALID_SEGMENT_DURATION", "wrong segment duration error")
        }

        let preStartCancelCompleted = DispatchSemaphore(value: 0)
        let canceledBeforeStart = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "cancel-before-start",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            authorizationState: { .authorized },
            emit: { event, data in
                require(event == "capture_segmented_canceled", "pre-start cancel emitted an unexpected event")
                require(data["reason"] as? String == "superseded", "pre-start cancel reason drifted")
            },
            terminal: { _ in preStartCancelCompleted.signal() }
        )
        canceledBeforeStart.cancel(reason: "superseded")
        let preStartCancelDeadline = Date().addingTimeInterval(2)
        var preStartCancelDidComplete = false
        while !preStartCancelDidComplete, Date() < preStartCancelDeadline {
            preStartCancelDidComplete = preStartCancelCompleted.wait(timeout: .now()) == .success
            if !preStartCancelDidComplete {
                RunLoop.current.run(until: Date().addingTimeInterval(0.01))
            }
        }
        require(preStartCancelDidComplete, "pre-start segment cancellation did not terminate")
        let namesAfterPreStartCancel = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterPreStartCancel.isEmpty, "pre-start segment cancellation left output")

        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4)!
        buffer.frameLength = 4
        buffer.floatChannelData![0][0] = 1
        buffer.floatChannelData![0][1] = -1
        buffer.floatChannelData![0][2] = 0
        buffer.floatChannelData![0][3] = 0
        let metrics = aosAudioFrameMetrics(buffer)!
        require(abs(metrics.rms - sqrt(0.5)) < 0.0001, "RMS calculation drifted")
        require(metrics.peak == 1, "peak calculation drifted")

        let interleavedFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 2, interleaved: true)!
        let interleaved = AVAudioPCMBuffer(pcmFormat: interleavedFormat, frameCapacity: 2)!
        interleaved.frameLength = 2
        let audioBuffers = UnsafeMutableAudioBufferListPointer(interleaved.mutableAudioBufferList)
        let samples = audioBuffers[0].mData!.assumingMemoryBound(to: Float.self)
        samples[0] = 1
        samples[1] = 0
        samples[2] = -1
        samples[3] = 0
        let interleavedMetrics = aosAudioFrameMetrics(interleaved)!
        require(abs(interleavedMetrics.rms - sqrt(0.5)) < 0.0001, "interleaved RMS calculation drifted")
        require(interleavedMetrics.peak == 1, "interleaved peak calculation drifted")
        samples[0] = .nan
        samples[1] = 1
        samples[2] = 0
        samples[3] = 0
        let finiteMetrics = aosAudioFrameMetrics(interleaved)!
        require(finiteMetrics.rms.isFinite && finiteMetrics.peak.isFinite, "non-finite sample poisoned meter output")

        print("voice transport native contracts passed")
    }
}
SWIFT

swiftc -parse-as-library \
    "$ROOT/src/daemon/microphone-authorization.swift" \
    "$ROOT/src/daemon/segmented-microphone-capture.swift" \
    "$ROOT/src/daemon/voice-transport.swift" \
    "$TMP/main.swift" \
    -o "$TMP/voice-transport-native"
"$TMP/voice-transport-native"

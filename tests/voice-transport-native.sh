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
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: tempRoot.path)
        let playbackInput = tempRoot.appendingPathComponent("playback.wav")
        try writeOneSecondPCMFixture(to: playbackInput)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: playbackInput.path)
        let playbackSource = try aosValidateAudioPlaybackSource(playbackInput.path)
        require(playbackSource.durationMilliseconds == 1000, "playback duration drifted")
        require(playbackSource.sampleRate == aosVoiceCaptureSampleRate, "playback sample rate drifted")
        require(playbackSource.channels == aosVoiceCaptureChannels, "playback channels drifted")
        require(playbackSource.bytes > 44, "playback byte count drifted")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: playbackInput.path)
        do {
            _ = try aosValidateAudioPlaybackSource(playbackInput.path)
            require(false, "non-owner-only playback input was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "UNSAFE_AUDIO_INPUT", "wrong playback input mode error")
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: playbackInput.path)
        let playbackSymlink = tempRoot.appendingPathComponent("playback-link.wav")
        try FileManager.default.createSymbolicLink(at: playbackSymlink, withDestinationURL: playbackInput)
        do {
            _ = try aosValidateAudioPlaybackSource(playbackSymlink.path)
            require(false, "symlinked playback input was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "INVALID_AUDIO_PATH", "wrong playback symlink error")
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

        let defaultReadyCue = try AOSCaptureReadyCue.parse(nil)
        let chimeReadyCue = try AOSCaptureReadyCue.parse("chime")
        require(defaultReadyCue == .none, "missing ready cue did not default to none")
        require(chimeReadyCue == .chime, "chime ready cue was rejected")
        do {
            _ = try AOSCaptureReadyCue.parse("voice")
            require(false, "unknown ready cue was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "INVALID_READY_CUE", "wrong ready cue error")
        }
        let inputGate = AOSCaptureInputGate()
        require(!inputGate.acceptsInput(hostTime: 100), "capture input gate started open")
        _ = inputGate.observe(AVAudioTime(hostTime: 100))
        require(inputGate.open(afterHostTime: 200), "host-time capture gate did not establish a boundary")
        require(!inputGate.acceptsInput(hostTime: 199), "capture input gate accepted a cue-era buffer")
        require(inputGate.acceptsInput(hostTime: 200), "capture input gate did not open at its timestamp boundary")
        inputGate.close()
        require(!inputGate.acceptsInput(hostTime: 201), "capture input gate did not close")
        let sampleTimeGate = AOSCaptureInputGate()
        _ = sampleTimeGate.observe(AVAudioTime(sampleTime: 100, atRate: 16_000))
        require(sampleTimeGate.open(afterHostTime: 200), "sample-time capture gate did not establish a boundary")
        require(
            !sampleTimeGate.acceptsInput(AOSCaptureInputTimestamp(hostTime: nil, sampleTime: 100)),
            "sample-time capture gate accepted a cue-era buffer"
        )
        require(
            sampleTimeGate.acceptsInput(AOSCaptureInputTimestamp(hostTime: nil, sampleTime: 101)),
            "sample-time capture gate dropped post-cue input"
        )
        let clocklessGate = AOSCaptureInputGate()
        require(
            !clocklessGate.open(afterHostTime: 200),
            "capture gate admitted a cue without an observable input clock"
        )
        let noCueGate = AOSCaptureInputGate()
        require(
            noCueGate.open(afterHostTime: 200, requireCueExclusion: false),
            "capture gate rejected a no-cue lease without a timestamp"
        )
        require(
            noCueGate.acceptsInput(AOSCaptureInputTimestamp(hostTime: nil, sampleTime: nil)),
            "no-cue capture gate rejected ordinary untimed input"
        )
        let readyCueBuffer = try aosMakeCaptureReadyCueBuffer()
        require(readyCueBuffer.format.sampleRate == 48_000, "ready cue sample rate drifted")
        require(readyCueBuffer.frameLength > 0, "ready cue buffer was empty")
        let cueSamples = readyCueBuffer.floatChannelData![0]
        var cuePeak: Float = 0
        for index in 0..<Int(readyCueBuffer.frameLength) {
            cuePeak = max(cuePeak, abs(cueSamples[index]))
        }
        require(cuePeak > 0.1 && cuePeak <= 0.18, "ready cue amplitude left its safe envelope")
        require(abs(cueSamples[0]) < 0.001, "ready cue did not fade in")
        require(abs(cueSamples[Int(readyCueBuffer.frameLength) - 1]) < 0.001, "ready cue did not fade out")

        let preparedDisconnectTerminal = DispatchSemaphore(value: 0)
        var preparedDisconnectEvents: [String] = []
        let preparedDisconnectTransport = AOSVoiceTransport(
            emit: { emittedOwner, event, _, ref in
                require(emittedOwner == owner, "prepared capture event owner drifted")
                require(ref == "prepared-disconnect", "prepared capture event ref drifted")
                preparedDisconnectEvents.append(event)
                if event == "capture_segmented_canceled" { preparedDisconnectTerminal.signal() }
            },
            microphoneAuthorization: authorizedMicrophone
        )
        let beginPreparedCapture = try preparedDisconnectTransport.prepareSegmentedCapture(
            owner: owner,
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            ref: "prepared-disconnect"
        )
        preparedDisconnectTransport.connectionClosed(owner)
        beginPreparedCapture()
        require(
            preparedDisconnectTerminal.wait(timeout: .now() + 1) == .success,
            "connection cleanup did not cancel a prepared segmented capture"
        )
        require(
            preparedDisconnectEvents == ["capture_segmented_canceled"],
            "prepared owner disconnect emitted an unexpected lifecycle"
        )
        let namesAfterPreparedDisconnect = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterPreparedDisconnect.isEmpty, "prepared owner disconnect left output")

        let authorizationEntered = DispatchSemaphore(value: 0)
        let releaseAuthorization = DispatchSemaphore(value: 0)
        let authorizationStopDone = DispatchSemaphore(value: 0)
        let authorizationStopTerminal = DispatchSemaphore(value: 0)
        let authorizationStopLock = NSLock()
        var authorizationStopFailure: String?
        var authorizationStopEvents: [String] = []
        let stoppedDuringAuthorization = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "stop-during-authorization",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in
                throw AOSVoiceTransportFailure(code: "UNEXPECTED_CUE", message: "cue must not start after stop")
            },
            startInputEngine: { _ in
                throw AOSVoiceTransportFailure(code: "UNEXPECTED_ENGINE", message: "engine must not start after stop")
            },
            authorizeMicrophone: {
                authorizationEntered.signal()
                _ = releaseAuthorization.wait(timeout: .now() + 2)
                return .authorized
            },
            authorizationState: { .authorized },
            emit: { event, _ in
                authorizationStopLock.lock()
                authorizationStopEvents.append(event)
                authorizationStopLock.unlock()
            },
            terminal: { _ in authorizationStopTerminal.signal() }
        )
        DispatchQueue.global().async {
            do {
                try stoppedDuringAuthorization.start()
            } catch let failure as AOSVoiceTransportFailure {
                authorizationStopLock.lock()
                authorizationStopFailure = failure.code
                authorizationStopLock.unlock()
            } catch {
                authorizationStopLock.lock()
                authorizationStopFailure = "UNEXPECTED"
                authorizationStopLock.unlock()
            }
            authorizationStopDone.signal()
        }
        require(
            authorizationEntered.wait(timeout: .now() + 1) == .success,
            "microphone authorization did not block"
        )
        stoppedDuringAuthorization.finalize(reason: "signal")
        require(
            authorizationStopTerminal.wait(timeout: .now() + 1) == .success,
            "stop during authorization did not terminate capture"
        )
        releaseAuthorization.signal()
        require(
            authorizationStopDone.wait(timeout: .now() + 1) == .success,
            "stop during authorization did not release startup"
        )
        authorizationStopLock.lock()
        let authorizationFailure = authorizationStopFailure
        let authorizationLifecycle = authorizationStopEvents
        authorizationStopLock.unlock()
        require(
            authorizationFailure == "CAPTURE_CANCELED",
            "stop during authorization returned the wrong failure"
        )
        require(
            authorizationLifecycle == ["capture_segmented_canceled"],
            "stop during authorization emitted a false completion"
        )

        let cueEntered = DispatchSemaphore(value: 0)
        let canceledStartupDone = DispatchSemaphore(value: 0)
        let canceledStartupTerminal = DispatchSemaphore(value: 0)
        let canceledStartupLock = NSLock()
        var canceledStartupFailure: String?
        var canceledStartupEvents: [String] = []
        var canceledStartupStops = 0
        let canceledDuringCue = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "cancel-during-cue",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, isCanceled in
                cueEntered.signal()
                let deadline = Date().addingTimeInterval(2)
                while !isCanceled(), Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.005)
                }
                guard isCanceled() else {
                    throw AOSVoiceTransportFailure(code: "READY_CUE_UNAVAILABLE", message: "test cue timed out")
                }
                throw AOSVoiceTransportFailure(code: "CAPTURE_CANCELED", message: "capture canceled")
            },
            startInputEngine: { _ in },
            inputEngineHealthy: { true },
            stopInputEngine: {
                canceledStartupLock.lock()
                canceledStartupStops += 1
                canceledStartupLock.unlock()
            },
            authorizationState: { .authorized },
            emit: { event, _ in
                canceledStartupLock.lock()
                canceledStartupEvents.append(event)
                canceledStartupLock.unlock()
            },
            terminal: { _ in canceledStartupTerminal.signal() }
        )
        DispatchQueue.global().async {
            do {
                try canceledDuringCue.start()
            } catch let failure as AOSVoiceTransportFailure {
                canceledStartupLock.lock()
                canceledStartupFailure = failure.code
                canceledStartupLock.unlock()
            } catch {
                canceledStartupLock.lock()
                canceledStartupFailure = "UNEXPECTED"
                canceledStartupLock.unlock()
            }
            canceledStartupDone.signal()
        }
        require(cueEntered.wait(timeout: .now() + 1) == .success, "blocking ready cue did not start")
        canceledDuringCue.finalize(reason: "signal")
        require(canceledStartupDone.wait(timeout: .now() + 1) == .success, "cue cancellation did not release startup")
        require(canceledStartupTerminal.wait(timeout: .now() + 1) == .success, "cue cancellation did not terminate capture")
        canceledStartupLock.lock()
        let canceledFailure = canceledStartupFailure
        let canceledEvents = canceledStartupEvents
        let canceledStops = canceledStartupStops
        canceledStartupLock.unlock()
        require(canceledFailure == "CAPTURE_CANCELED", "cue stop returned the wrong failure")
        require(!canceledEvents.contains("capture_segmented_started"), "cue stop emitted a false ready event")
        require(canceledEvents == ["capture_segmented_canceled"], "cue stop emitted a false completion")
        require(canceledStops == 1, "cue stop did not stop its input engine exactly once")
        let namesAfterCueCancellation = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterCueCancellation.isEmpty, "cue cancellation left output")

        let armingEntered = DispatchSemaphore(value: 0)
        let releaseArming = DispatchSemaphore(value: 0)
        let armingDone = DispatchSemaphore(value: 0)
        let armingTerminal = DispatchSemaphore(value: 0)
        let armingLock = NSLock()
        var armingFailure: String?
        var armingEvents: [String] = []
        var armingStops = 0
        let canceledDuringArming = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "cancel-during-arming",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in
                throw AOSVoiceTransportFailure(code: "UNEXPECTED_CUE", message: "cue must not start after cancellation")
            },
            startInputEngine: { _ in
                armingEntered.signal()
                _ = releaseArming.wait(timeout: .now() + 2)
            },
            inputEngineHealthy: { true },
            stopInputEngine: {
                armingLock.lock()
                armingStops += 1
                armingLock.unlock()
            },
            authorizationState: { .authorized },
            emit: { event, _ in
                armingLock.lock()
                armingEvents.append(event)
                armingLock.unlock()
            },
            terminal: { _ in armingTerminal.signal() }
        )
        DispatchQueue.global().async {
            do {
                try canceledDuringArming.start()
            } catch let failure as AOSVoiceTransportFailure {
                armingLock.lock()
                armingFailure = failure.code
                armingLock.unlock()
            } catch {
                armingLock.lock()
                armingFailure = "UNEXPECTED"
                armingLock.unlock()
            }
            armingDone.signal()
        }
        require(armingEntered.wait(timeout: .now() + 1) == .success, "input engine arming did not begin")
        canceledDuringArming.cancel(reason: "owner_disconnect")
        require(
            armingTerminal.wait(timeout: .now() + .milliseconds(50)) == .timedOut,
            "capture cleanup completed before input engine arming settled"
        )
        releaseArming.signal()
        require(armingDone.wait(timeout: .now() + 1) == .success, "arming cancellation did not release startup")
        require(armingTerminal.wait(timeout: .now() + 1) == .success, "arming cancellation did not terminate capture")
        armingLock.lock()
        let armingResult = armingFailure
        let armingLifecycle = armingEvents
        let armingStopCount = armingStops
        armingLock.unlock()
        require(armingResult == "CAPTURE_CANCELED", "arming cancellation returned the wrong failure")
        require(armingLifecycle == ["capture_segmented_canceled"], "arming cancellation emitted an unexpected lifecycle")
        require(armingStopCount == 1, "late-started input engine was not stopped exactly once")

        let admissionFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        )!
        let admissionBuffer = AVAudioPCMBuffer(pcmFormat: admissionFormat, frameCapacity: 8)!
        admissionBuffer.frameLength = 8
        let admissionTerminal = DispatchSemaphore(value: 0)
        let admissionInput = DispatchSemaphore(value: 0)
        let admissionLock = NSLock()
        var admissionHandler: AOSSegmentedMicrophoneCaptureSession.InputHandler?
        var admissionOrder: [String] = []
        let orderedAdmission = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "ordered-admission",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in
                admissionHandler?(admissionBuffer, AVAudioTime(hostTime: 199))
                return 200
            },
            startInputEngine: { handler in
                admissionHandler = handler
                handler(admissionBuffer, AVAudioTime(hostTime: 100))
            },
            inputEngineHealthy: { true },
            stopInputEngine: {},
            receiveInput: { _ in
                admissionLock.lock()
                admissionOrder.append("input")
                admissionLock.unlock()
                admissionInput.signal()
            },
            authorizationState: { .authorized },
            emit: { event, _ in
                guard event != "audio_frame" else { return }
                admissionLock.lock()
                admissionOrder.append(event)
                admissionLock.unlock()
            },
            terminal: { _ in admissionTerminal.signal() }
        )
        try orderedAdmission.start()
        admissionHandler?(admissionBuffer, AVAudioTime(hostTime: 201))
        require(admissionInput.wait(timeout: .now() + 1) == .success, "post-cue input was not accepted")
        admissionLock.lock()
        let orderedLifecycle = admissionOrder
        admissionLock.unlock()
        require(
            orderedLifecycle == ["capture_segmented_started", "input"],
            "accepted input was not ordered after the capture-started event"
        )
        orderedAdmission.cancel(reason: "test_complete")
        require(admissionTerminal.wait(timeout: .now() + 1) == .success, "ordered admission did not clean up")

        let clockFailureTerminal = DispatchSemaphore(value: 0)
        var clockFailureEvents: [String] = []
        var clockFailureStops = 0
        let clocklessAdmission = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "clockless-admission",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in 300 },
            startInputEngine: { _ in },
            inputEngineHealthy: { true },
            stopInputEngine: { clockFailureStops += 1 },
            authorizationState: { .authorized },
            emit: { event, _ in clockFailureEvents.append(event) },
            terminal: { _ in clockFailureTerminal.signal() }
        )
        do {
            try clocklessAdmission.start()
            require(false, "cue admission without an input clock was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "CAPTURE_CLOCK_UNAVAILABLE", "clockless admission returned the wrong failure")
        }
        require(clockFailureTerminal.wait(timeout: .now() + 1) == .success, "clockless admission did not terminate")
        require(clockFailureEvents == ["capture_segmented_failed"], "clockless admission emitted an unexpected lifecycle")
        require(clockFailureStops == 1, "clockless admission did not stop its input engine")

        var authorizationAfterCue = AOSMicrophoneAuthorizationState.authorized
        var permissionLossEvents: [String] = []
        var permissionLossStops = 0
        let permissionLossTerminal = DispatchSemaphore(value: 0)
        let permissionLostBeforeAdmission = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "permission-loss-before-admission",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in
                authorizationAfterCue = .denied
                return 300
            },
            startInputEngine: { _ in },
            inputEngineHealthy: { true },
            stopInputEngine: { permissionLossStops += 1 },
            authorizationState: { authorizationAfterCue },
            emit: { event, _ in permissionLossEvents.append(event) },
            terminal: { _ in permissionLossTerminal.signal() }
        )
        do {
            try permissionLostBeforeAdmission.start()
            require(false, "permission loss before capture admission was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "MICROPHONE_PERMISSION_LOST", "permission loss returned the wrong failure")
        }
        require(permissionLossTerminal.wait(timeout: .now() + 1) == .success, "permission loss did not terminate capture")
        require(permissionLossEvents == ["capture_segmented_failed"], "permission loss emitted an unexpected lifecycle")
        require(permissionLossStops == 1, "permission loss did not stop its input engine")
        let namesAfterPermissionLoss = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterPermissionLoss.isEmpty, "permission loss left output")

        var hardwareLossEvents: [String] = []
        var hardwareLossStops = 0
        let hardwareLossTerminal = DispatchSemaphore(value: 0)
        let hardwareLostBeforeAdmission = try AOSSegmentedMicrophoneCaptureSession(
            owner: owner,
            ref: "hardware-loss-before-admission",
            directoryPath: segmentRoot.path,
            segmentDuration: 0.5,
            maximumDuration: 1,
            readyCue: .chime,
            playReadyCue: { _, _ in 400 },
            startInputEngine: { _ in },
            inputEngineHealthy: { false },
            stopInputEngine: { hardwareLossStops += 1 },
            authorizationState: { .authorized },
            emit: { event, _ in hardwareLossEvents.append(event) },
            terminal: { _ in hardwareLossTerminal.signal() }
        )
        do {
            try hardwareLostBeforeAdmission.start()
            require(false, "hardware loss before capture admission was accepted")
        } catch let failure as AOSVoiceTransportFailure {
            require(failure.code == "MICROPHONE_UNAVAILABLE", "hardware loss returned the wrong failure")
        }
        require(hardwareLossTerminal.wait(timeout: .now() + 1) == .success, "hardware loss did not terminate capture")
        require(hardwareLossEvents == ["capture_segmented_failed"], "hardware loss emitted an unexpected lifecycle")
        require(hardwareLossStops == 1, "hardware loss did not stop its input engine")
        let namesAfterHardwareLoss = try FileManager.default.contentsOfDirectory(atPath: segmentRoot.path)
        require(namesAfterHardwareLoss.isEmpty, "hardware loss left output")

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
    "$ROOT/src/daemon/capture-ready-cue.swift" \
    "$ROOT/src/daemon/segmented-microphone-capture.swift" \
    "$ROOT/src/daemon/audio-playback.swift" \
    "$ROOT/src/daemon/voice-transport.swift" \
    "$TMP/main.swift" \
    -o "$TMP/voice-transport-native"
"$TMP/voice-transport-native"

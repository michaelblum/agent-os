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
    "$ROOT/src/daemon/voice-transport.swift" \
    "$TMP/main.swift" \
    -o "$TMP/voice-transport-native"
"$TMP/voice-transport-native"

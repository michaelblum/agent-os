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

@main
struct VoiceTransportNativeTest {
    static func main() throws {
        var events: [String] = []
        let owner = UUID()
        let other = UUID()
        let transport = AOSVoiceTransport { emittedOwner, event, data, ref in
            require(emittedOwner == owner, "event owner drifted")
            require(ref == "hotkey-ref", "event ref drifted")
            require(data["key_code"] == nil, "hotkey event exposed a key code")
            events.append(event)
        }
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

swiftc -parse-as-library "$ROOT/src/daemon/voice-transport.swift" "$TMP/main.swift" -o "$TMP/voice-transport-native"
"$TMP/voice-transport-native"

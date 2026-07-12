import AVFoundation
import AudioToolbox
import Darwin
import Foundation

let aosVoiceCaptureSampleRate = 16_000.0
let aosVoiceCaptureChannels = 1
let aosVoiceCaptureMaximumBytes = 4 * 1024 * 1024
let aosVoiceCaptureMaximumDuration: TimeInterval = 120

struct AOSVoiceModifierSnapshot: Equatable {
    let control: Bool
    let option: Bool
    let command: Bool
    let shift: Bool
}

struct AOSVoiceHotkeyInput {
    enum Kind {
        case keyDown
        case keyUp
        case other
    }

    let kind: Kind
    let keyCode: Int64?
    let modifiers: AOSVoiceModifierSnapshot
    let isRepeat: Bool
}

struct AOSVoiceShortcut: Equatable {
    let keyCode: Int64
    let modifiers: AOSVoiceModifierSnapshot

    static func parse(_ value: String) -> AOSVoiceShortcut? {
        let parts = value
            .split(separator: "+")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        guard parts.count >= 2, let keyName = parts.last else { return nil }

        var control = false
        var option = false
        var command = false
        var shift = false
        var seen = Set<String>()
        for rawModifier in parts.dropLast() {
            let modifier: String
            switch rawModifier {
            case "control", "ctrl", "^": modifier = "control"
            case "option", "alt", "opt": modifier = "option"
            case "command", "cmd", "meta": modifier = "command"
            case "shift": modifier = "shift"
            default: return nil
            }
            guard seen.insert(modifier).inserted else { return nil }
            switch modifier {
            case "control": control = true
            case "option": option = true
            case "command": command = true
            case "shift": shift = true
            default: break
            }
        }
        guard control || option || command || shift,
              let keyCode = keyCodes[keyName] else { return nil }
        if keyCode == 53, command, option, !control, !shift {
            return nil
        }
        return AOSVoiceShortcut(
            keyCode: keyCode,
            modifiers: AOSVoiceModifierSnapshot(
                control: control,
                option: option,
                command: command,
                shift: shift
            )
        )
    }

    private static let keyCodes: [String: Int64] = [
        "space": 49,
        "return": 36,
        "enter": 36,
        "tab": 48,
        "escape": 53,
        "esc": 53,
        "a": 0,
        "b": 11,
        "c": 8,
        "d": 2,
        "e": 14,
        "f": 3,
        "g": 5,
        "h": 4,
        "i": 34,
        "j": 38,
        "k": 40,
        "l": 37,
        "m": 46,
        "n": 45,
        "o": 31,
        "p": 35,
        "q": 12,
        "r": 15,
        "s": 1,
        "t": 17,
        "u": 32,
        "v": 9,
        "w": 13,
        "x": 7,
        "y": 16,
        "z": 6,
        "0": 29,
        "1": 18,
        "2": 19,
        "3": 20,
        "4": 21,
        "5": 23,
        "6": 22,
        "7": 26,
        "8": 28,
        "9": 25,
    ]
}

struct AOSAudioFrameMetrics: Equatable {
    let rms: Double
    let peak: Double
}

func aosLinearAmplitude(decibels: Float) -> Double {
    guard decibels.isFinite else { return 0 }
    return min(1, max(0, pow(10, Double(decibels) / 20)))
}

func aosAudioFrameMetrics(_ buffer: AVAudioPCMBuffer) -> AOSAudioFrameMetrics? {
    guard buffer.frameLength > 0, buffer.format.channelCount > 0 else { return nil }

    var sumSquares = 0.0
    var peak = 0.0
    var sampleCount = 0
    let audioBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)

    switch buffer.format.commonFormat {
    case .pcmFormatFloat32:
        for audioBuffer in audioBuffers {
            guard let rawData = audioBuffer.mData else { continue }
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Float>.size
            let data = rawData.assumingMemoryBound(to: Float.self)
            for index in 0..<count {
                let value = Double(data[index])
                guard value.isFinite else { continue }
                sumSquares += value * value
                peak = max(peak, abs(value))
                sampleCount += 1
            }
        }
    case .pcmFormatInt16:
        for audioBuffer in audioBuffers {
            guard let rawData = audioBuffer.mData else { continue }
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Int16>.size
            let data = rawData.assumingMemoryBound(to: Int16.self)
            for index in 0..<count {
                let value = Double(data[index]) / Double(Int16.max)
                sumSquares += value * value
                peak = max(peak, abs(value))
                sampleCount += 1
            }
        }
    case .pcmFormatInt32:
        for audioBuffer in audioBuffers {
            guard let rawData = audioBuffer.mData else { continue }
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Int32>.size
            let data = rawData.assumingMemoryBound(to: Int32.self)
            for index in 0..<count {
                let value = Double(data[index]) / Double(Int32.max)
                sumSquares += value * value
                peak = max(peak, abs(value))
                sampleCount += 1
            }
        }
    default:
        return nil
    }

    guard sampleCount > 0 else { return nil }
    return AOSAudioFrameMetrics(
        rms: min(1, sqrt(sumSquares / Double(sampleCount))),
        peak: min(1, peak)
    )
}

struct AOSVoiceTransportFailure: Error {
    let code: String
    let message: String
}

func aosVoiceCaptureDuration(_ requested: TimeInterval) -> TimeInterval? {
    guard requested.isFinite, requested > 0 else { return nil }
    let bytesPerSecond = aosVoiceCaptureSampleRate * Double(aosVoiceCaptureChannels) * 2
    let byteBound = Double(aosVoiceCaptureMaximumBytes - 4096) / bytesPerSecond
    return min(requested, aosVoiceCaptureMaximumDuration, byteBound)
}

func aosSystemSpeechVoiceIdentifier(_ value: String?) throws -> String? {
    guard let value else { return nil }
    guard !value.isEmpty else {
        throw AOSVoiceTransportFailure(code: "VOICE_NOT_FOUND", message: "requested system voice is unavailable")
    }
    guard value.hasPrefix("voice://") else { return value }
    let body = value.dropFirst("voice://".count)
    guard let separator = body.firstIndex(of: "/") else {
        throw AOSVoiceTransportFailure(code: "INVALID_VOICE_ID", message: "voice identifier is malformed")
    }
    let provider = String(body[..<separator])
    let identifier = String(body[body.index(after: separator)...])
    guard provider == "system" else {
        throw AOSVoiceTransportFailure(code: "INVALID_VOICE_PROVIDER", message: "streamed speech requires a system voice")
    }
    guard !identifier.isEmpty else {
        throw AOSVoiceTransportFailure(code: "INVALID_VOICE_ID", message: "voice identifier is malformed")
    }
    return identifier
}

func aosCreateVoiceCaptureTarget(_ outputPath: String) throws -> URL {
    guard outputPath.hasPrefix("/") else {
        throw AOSVoiceTransportFailure(code: "INVALID_OUTPUT_PATH", message: "voice capture output must be absolute")
    }
    let standardized = URL(fileURLWithPath: outputPath).standardizedFileURL.path
    guard standardized == outputPath, outputPath.lowercased().hasSuffix(".wav") else {
        throw AOSVoiceTransportFailure(code: "INVALID_OUTPUT_PATH", message: "voice capture output must be a canonical WAV path")
    }

    let parent = URL(fileURLWithPath: outputPath).deletingLastPathComponent().path
    guard URL(fileURLWithPath: parent).resolvingSymlinksInPath().path == parent else {
        throw AOSVoiceTransportFailure(code: "UNSAFE_OUTPUT_PARENT", message: "voice capture parent must not contain symlinks")
    }
    let attributes: [FileAttributeKey: Any]
    do {
        attributes = try FileManager.default.attributesOfItem(atPath: parent)
    } catch {
        throw AOSVoiceTransportFailure(code: "UNSAFE_OUTPUT_PARENT", message: "voice capture parent is unavailable")
    }
    guard attributes[.type] as? FileAttributeType == .typeDirectory,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
          ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? -1) & 0o777 == 0o700 else {
        throw AOSVoiceTransportFailure(code: "UNSAFE_OUTPUT_PARENT", message: "voice capture parent must be owner-only mode 0700")
    }

    var existing = stat()
    errno = 0
    if lstat(outputPath, &existing) == 0 || errno != ENOENT {
        throw AOSVoiceTransportFailure(code: "OUTPUT_EXISTS", message: "voice capture output must not already exist")
    }
    let fd = open(outputPath, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
    guard fd >= 0 else {
        throw AOSVoiceTransportFailure(code: "OUTPUT_CREATE_FAILED", message: "voice capture output could not be created")
    }
    close(fd)
    _ = chmod(outputPath, mode_t(0o600))
    return URL(fileURLWithPath: outputPath)
}

private final class AOSMicrophoneCaptureSession: NSObject, AVAudioRecorderDelegate {
    let token = UUID()
    let owner: UUID
    let ref: String?
    let outputURL: URL
    private let maximumDuration: TimeInterval
    private let emit: (String, [String: Any]) -> Void
    private let terminal: (UUID) -> Void
    private var recorder: AVAudioRecorder
    private let stateLock = NSLock()
    private var meterTimer: DispatchSourceTimer?
    private var finished = false
    private var sequence = 0

    init(
        owner: UUID,
        ref: String?,
        outputPath: String,
        maximumDuration: TimeInterval,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (UUID) -> Void
    ) throws {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw AOSVoiceTransportFailure(code: "MICROPHONE_PERMISSION_DENIED", message: "microphone permission is not granted")
        }
        guard let boundedDuration = aosVoiceCaptureDuration(maximumDuration) else {
            throw AOSVoiceTransportFailure(code: "INVALID_MAX_DURATION", message: "voice capture duration must be positive")
        }
        self.owner = owner
        self.ref = ref
        self.outputURL = try aosCreateVoiceCaptureTarget(outputPath)
        self.maximumDuration = boundedDuration
        self.emit = emit
        self.terminal = terminal
        do {
            self.recorder = try AVAudioRecorder(
                url: self.outputURL,
                settings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: aosVoiceCaptureSampleRate,
                    AVNumberOfChannelsKey: aosVoiceCaptureChannels,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                ]
            )
        } catch {
            try? FileManager.default.removeItem(at: self.outputURL)
            throw AOSVoiceTransportFailure(code: "MICROPHONE_UNAVAILABLE", message: "microphone input is unavailable")
        }
        super.init()
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        guard recorder.prepareToRecord() else {
            try? FileManager.default.removeItem(at: self.outputURL)
            throw AOSVoiceTransportFailure(code: "MICROPHONE_UNAVAILABLE", message: "microphone input is unavailable")
        }
        _ = chmod(self.outputURL.path, mode_t(0o600))
    }

    func start() throws {
        var started = false
        aosRunOnMainSync {
            started = recorder.record(forDuration: maximumDuration)
        }
        guard started else {
            try? FileManager.default.removeItem(at: outputURL)
            throw AOSVoiceTransportFailure(code: "MICROPHONE_UNAVAILABLE", message: "microphone input is unavailable")
        }
        emit("capture_started", [
            "sample_rate": Int(aosVoiceCaptureSampleRate),
            "channels": aosVoiceCaptureChannels,
            "max_duration_ms": Int(maximumDuration * 1000),
        ])
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.emitMeter() }
        timer.resume()
        meterTimer = timer
    }

    func finalize(reason: String) {
        aosRunOnMainSync { [self] in
            finish(keepFile: true, event: "capture_completed", reason: reason, failureCode: nil)
        }
    }

    func cancel(reason: String) {
        aosRunOnMainSync { [self] in
            finish(keepFile: false, event: "capture_canceled", reason: reason, failureCode: nil)
        }
    }

    private func fail(code: String) {
        aosRunOnMainSync { [self] in
            finish(keepFile: false, event: "capture_failed", reason: "failure", failureCode: code)
        }
    }

    private func emitMeter() {
        stateLock.lock()
        let isFinished = finished
        stateLock.unlock()
        guard !isFinished else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            fail(code: "MICROPHONE_PERMISSION_LOST")
            return
        }
        if let size = try? outputURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
           size > aosVoiceCaptureMaximumBytes {
            fail(code: "OUTPUT_LIMIT_EXCEEDED")
            return
        }
        recorder.updateMeters()
        sequence += 1
        emit("audio_frame", [
            "stream": "capture",
            "rms": aosLinearAmplitude(decibels: recorder.averagePower(forChannel: 0)),
            "peak": aosLinearAmplitude(decibels: recorder.peakPower(forChannel: 0)),
            "sequence": sequence,
        ])
    }

    private func finish(keepFile: Bool, event: String, reason: String, failureCode: String?) {
        stateLock.lock()
        guard !finished else {
            stateLock.unlock()
            return
        }
        finished = true
        stateLock.unlock()
        meterTimer?.cancel()
        meterTimer = nil
        let duration = recorder.currentTime
        recorder.stop()
        _ = chmod(outputURL.path, mode_t(0o600))
        let size = (try? outputURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let limitExceeded = size > aosVoiceCaptureMaximumBytes
        if !keepFile || limitExceeded {
            try? FileManager.default.removeItem(at: outputURL)
        }
        if let failureCode {
            emit(event, ["code": failureCode])
        } else if limitExceeded {
            emit("capture_failed", ["code": "OUTPUT_LIMIT_EXCEEDED"])
        } else if keepFile {
            emit(event, [
                "reason": reason,
                "duration_ms": max(0, Int(duration * 1000)),
                "bytes": size,
            ])
        } else {
            emit("capture_canceled", ["reason": reason])
        }
        terminal(token)
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if flag {
            finalize(reason: "max_duration")
        } else {
            fail(code: "CAPTURE_INTERRUPTED")
        }
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        fail(code: "CAPTURE_WRITE_FAILED")
    }
}

private func aosCopyPCMBuffer(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let copy = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameLength) else { return nil }
    copy.frameLength = source.frameLength
    let sourceBuffers = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
    let destinationBuffers = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
    guard sourceBuffers.count == destinationBuffers.count else { return nil }
    for index in 0..<sourceBuffers.count {
        guard let sourceData = sourceBuffers[index].mData,
              let destinationData = destinationBuffers[index].mData else { return nil }
        let bytes = Int(sourceBuffers[index].mDataByteSize)
        memcpy(destinationData, sourceData, bytes)
        destinationBuffers[index].mDataByteSize = sourceBuffers[index].mDataByteSize
    }
    return copy
}

private func aosRunOnMainSync(_ operation: () -> Void) {
    if Thread.isMainThread {
        operation()
    } else {
        DispatchQueue.main.sync(execute: operation)
    }
}

private final class AOSStreamingSpeechSession {
    let token = UUID()
    let owner: UUID
    let ref: String?
    private let text: String
    private let voiceID: String?
    private let rateWPM: Double?
    private let emit: (String, [String: Any]) -> Void
    private let terminal: (UUID) -> Void
    private let synthesizer = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queue = DispatchQueue(label: "aos.voice.speech-stream")
    private var configuredFormat: AVAudioFormat?
    private var outstandingBuffers = 0
    private var sourceFinished = false
    private var finished = false
    private var sequence = 0
    private var lastMeterAt = Date.distantPast

    init(
        owner: UUID,
        ref: String?,
        text: String,
        voiceID: String?,
        rateWPM: Double?,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (UUID) -> Void
    ) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 65_536 else {
            throw AOSVoiceTransportFailure(code: "INVALID_SPEECH_TEXT", message: "speech input must contain 1 to 65536 bytes")
        }
        if let rateWPM, !rateWPM.isFinite || rateWPM < 80 || rateWPM > 450 {
            throw AOSVoiceTransportFailure(code: "INVALID_SPEECH_RATE", message: "speech rate must be between 80 and 450 WPM")
        }
        let systemVoiceID = try aosSystemSpeechVoiceIdentifier(voiceID)
        if let systemVoiceID, AVSpeechSynthesisVoice(identifier: systemVoiceID) == nil {
            throw AOSVoiceTransportFailure(code: "VOICE_NOT_FOUND", message: "requested system voice is unavailable")
        }
        self.owner = owner
        self.ref = ref
        self.text = trimmed
        self.voiceID = systemVoiceID
        self.rateWPM = rateWPM
        self.emit = emit
        self.terminal = terminal
    }

    func start() {
        queue.sync {
            guard !finished else { return }
            emit("speech_started", rateWPM.map { ["rate_wpm": $0] } ?? [:])
            aosRunOnMainSync { [weak self] in
                guard let self else { return }
                let utterance = AVSpeechUtterance(string: self.text)
                if let voiceID = self.voiceID { utterance.voice = AVSpeechSynthesisVoice(identifier: voiceID) }
                if let rateWPM = self.rateWPM {
                    let scaled = Double(AVSpeechUtteranceDefaultSpeechRate) * (rateWPM / 180)
                    utterance.rate = Float(
                        min(
                            Double(AVSpeechUtteranceMaximumSpeechRate),
                            max(Double(AVSpeechUtteranceMinimumSpeechRate), scaled)
                        )
                    )
                }
                self.synthesizer.write(utterance) { [weak self] buffer in
                    guard let pcm = buffer as? AVAudioPCMBuffer else {
                        self?.fail(code: "SPEECH_BUFFER_UNAVAILABLE")
                        return
                    }
                    self?.receive(pcm)
                }
            }
        }
    }

    func cancel(reason: String) {
        queue.sync {
            guard !finished else { return }
            finished = true
            aosRunOnMainSync { [synthesizer] in
                synthesizer.stopSpeaking(at: .immediate)
            }
            player.stop()
            engine.stop()
            emit("speech_canceled", ["reason": reason])
            terminal(token)
        }
    }

    private func receive(_ buffer: AVAudioPCMBuffer) {
        queue.async { [weak self] in
            guard let self, !self.finished else { return }
            guard buffer.frameLength > 0 else {
                self.sourceFinished = true
                self.finishIfReady()
                return
            }
            guard let copy = aosCopyPCMBuffer(buffer) else {
                self.failLocked(code: "SPEECH_BUFFER_UNAVAILABLE")
                return
            }
            do {
                try self.configureIfNeeded(format: copy.format)
            } catch {
                self.failLocked(code: "AUDIO_OUTPUT_UNAVAILABLE")
                return
            }
            self.outstandingBuffers += 1
            self.emitMeterIfDue(copy)
            self.player.scheduleBuffer(copy) { [weak self] in
                self?.queue.async {
                    guard let self, !self.finished else { return }
                    self.outstandingBuffers = max(0, self.outstandingBuffers - 1)
                    self.finishIfReady()
                }
            }
        }
    }

    private func configureIfNeeded(format: AVAudioFormat) throws {
        if let configuredFormat {
            guard configuredFormat == format else {
                throw AOSVoiceTransportFailure(code: "SPEECH_FORMAT_CHANGED", message: "speech audio format changed")
            }
            return
        }
        configuredFormat = format
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        player.play()
    }

    private func emitMeterIfDue(_ buffer: AVAudioPCMBuffer) {
        let now = Date()
        guard now.timeIntervalSince(lastMeterAt) >= 0.1,
              let metrics = aosAudioFrameMetrics(buffer) else { return }
        lastMeterAt = now
        sequence += 1
        emit("audio_frame", [
            "stream": "speech",
            "rms": metrics.rms,
            "peak": metrics.peak,
            "sequence": sequence,
        ])
    }

    private func finishIfReady() {
        guard sourceFinished, outstandingBuffers == 0, !finished else { return }
        finished = true
        player.stop()
        engine.stop()
        emit("speech_finished", ["reason": "completed"])
        terminal(token)
    }

    private func fail(code: String) {
        queue.async { [weak self] in self?.failLocked(code: code) }
    }

    private func failLocked(code: String) {
        guard !finished else { return }
        finished = true
        aosRunOnMainSync { [synthesizer] in
            synthesizer.stopSpeaking(at: .immediate)
        }
        player.stop()
        engine.stop()
        emit("speech_failed", ["code": code])
        terminal(token)
    }
}

final class AOSVoiceTransport {
    typealias EventEmitter = (UUID, String, [String: Any], String?) -> Void

    private struct HotkeyLease {
        let owner: UUID
        let shortcut: AOSVoiceShortcut
        let ref: String?
        var isPressed: Bool
    }

    private let lock = NSLock()
    private let emit: EventEmitter
    private var hotkey: HotkeyLease?
    private var capture: AOSMicrophoneCaptureSession?
    private var speech: AOSStreamingSpeechSession?

    init(emit: @escaping EventEmitter) {
        self.emit = emit
    }

    func acquireHotkey(owner: UUID, shortcut value: String, ref: String?) throws {
        guard let shortcut = AOSVoiceShortcut.parse(value) else {
            throw AOSVoiceTransportFailure(code: "INVALID_SHORTCUT", message: "unsupported voice shortcut")
        }
        lock.lock()
        defer { lock.unlock() }
        guard hotkey == nil else {
            throw AOSVoiceTransportFailure(code: "HOTKEY_LEASE_BUSY", message: "a voice hotkey listener is already active")
        }
        hotkey = HotkeyLease(owner: owner, shortcut: shortcut, ref: ref, isPressed: false)
    }

    func handleHotkey(_ input: AOSVoiceHotkeyInput) -> Bool {
        lock.lock()
        guard var lease = hotkey else {
            lock.unlock()
            return false
        }
        let shouldConsume: Bool
        var event: (String, [String: Any])?
        switch input.kind {
        case .keyDown:
            let exactChord = input.keyCode == lease.shortcut.keyCode && input.modifiers == lease.shortcut.modifiers
            let activeChordRepeat = lease.isPressed && input.keyCode == lease.shortcut.keyCode
            shouldConsume = exactChord || activeChordRepeat
            if exactChord && !input.isRepeat && !lease.isPressed {
                lease.isPressed = true
                hotkey = lease
                event = ("dictation_opened", ["source": "hotkey"])
            }
        case .keyUp:
            shouldConsume = lease.isPressed && input.keyCode == lease.shortcut.keyCode
            if shouldConsume {
                lease.isPressed = false
                hotkey = lease
                event = ("dictation_closed_send", ["reason": "key_release"])
            }
        case .other:
            shouldConsume = false
        }
        let owner = lease.owner
        let ref = lease.ref
        lock.unlock()
        if let event { emit(owner, event.0, event.1, ref) }
        return shouldConsume
    }

    func startCapture(owner: UUID, outputPath: String, maximumDuration: TimeInterval, ref: String?) throws {
        lock.lock()
        guard capture == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_LEASE_BUSY", message: "microphone capture is already active")
        }
        let activeSpeech = speech
        lock.unlock()
        activeSpeech?.cancel(reason: "barge_in")

        let session = try AOSMicrophoneCaptureSession(
            owner: owner,
            ref: ref,
            outputPath: outputPath,
            maximumDuration: maximumDuration,
            emit: { [emit] event, data in emit(owner, event, data, ref) },
            terminal: { [weak self] token in self?.captureDidTerminate(token: token) }
        )
        lock.lock()
        guard capture == nil else {
            lock.unlock()
            session.cancel(reason: "superseded")
            throw AOSVoiceTransportFailure(code: "CAPTURE_LEASE_BUSY", message: "microphone capture is already active")
        }
        capture = session
        lock.unlock()
        do {
            try session.start()
        } catch {
            captureDidTerminate(token: session.token)
            throw error
        }
    }

    func stopCapture(owner: UUID, finalize: Bool, reason: String) throws {
        lock.lock()
        guard let session = capture, session.owner == owner else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_NOT_OWNED", message: "this connection does not own microphone capture")
        }
        lock.unlock()
        if finalize { session.finalize(reason: reason) } else { session.cancel(reason: reason) }
    }

    func startSpeech(owner: UUID, text: String, voiceID: String?, rateWPM: Double?, ref: String?) throws {
        lock.lock()
        guard capture == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_ACTIVE", message: "speech cannot start during microphone capture")
        }
        guard speech == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "SPEECH_LEASE_BUSY", message: "speech playback is already active")
        }
        lock.unlock()

        let session = try AOSStreamingSpeechSession(
            owner: owner,
            ref: ref,
            text: text,
            voiceID: voiceID,
            rateWPM: rateWPM,
            emit: { [emit] event, data in emit(owner, event, data, ref) },
            terminal: { [weak self] token in self?.speechDidTerminate(token: token) }
        )
        lock.lock()
        guard speech == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "SPEECH_LEASE_BUSY", message: "speech playback is already active")
        }
        speech = session
        lock.unlock()
        session.start()
    }

    func stopSpeech(owner: UUID, reason: String) throws {
        lock.lock()
        guard let session = speech, session.owner == owner else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "SPEECH_NOT_OWNED", message: "this connection does not own speech playback")
        }
        lock.unlock()
        session.cancel(reason: reason)
    }

    func connectionClosed(_ owner: UUID) {
        lock.lock()
        if hotkey?.owner == owner { hotkey = nil }
        let captureToCancel = capture?.owner == owner ? capture : nil
        let speechToCancel = speech?.owner == owner ? speech : nil
        lock.unlock()
        captureToCancel?.cancel(reason: "owner_disconnect")
        speechToCancel?.cancel(reason: "owner_disconnect")
    }

    func shutdown() {
        lock.lock()
        hotkey = nil
        let captureToCancel = capture
        let speechToCancel = speech
        lock.unlock()
        captureToCancel?.cancel(reason: "daemon_shutdown")
        speechToCancel?.cancel(reason: "daemon_shutdown")
    }

    private func captureDidTerminate(token: UUID) {
        lock.lock()
        if capture?.token == token { capture = nil }
        lock.unlock()
    }

    private func speechDidTerminate(token: UUID) {
        lock.lock()
        if speech?.token == token { speech = nil }
        lock.unlock()
    }
}

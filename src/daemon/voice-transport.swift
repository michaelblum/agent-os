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
    guard requested.isFinite, requested >= 0.001 else { return nil }
    let bytesPerSecond = aosVoiceCaptureSampleRate * Double(aosVoiceCaptureChannels) * 2
    let byteBound = Double(aosVoiceCaptureMaximumBytes - 4096) / bytesPerSecond
    return min(requested, aosVoiceCaptureMaximumDuration, byteBound)
}

func aosVoiceCaptureDurationMilliseconds(at outputURL: URL, fallback: TimeInterval) -> Int {
    if let file = try? AVAudioFile(forReading: outputURL),
       file.fileFormat.sampleRate.isFinite,
       file.fileFormat.sampleRate > 0 {
        let duration = Double(file.length) / file.fileFormat.sampleRate
        return max(0, Int((duration * 1000).rounded()))
    }
    guard fallback.isFinite else { return 0 }
    return max(0, Int((fallback * 1000).rounded()))
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

private final class AOSMicrophoneCaptureSession: NSObject, AVAudioRecorderDelegate, AOSMicrophoneCaptureLease {
    let token = UUID()
    let owner: UUID
    let ref: String?
    let outputURL: URL
    private let maximumDuration: TimeInterval
    private let authorizationState: () -> AOSMicrophoneAuthorizationState
    private let emit: (String, [String: Any]) -> Void
    private let terminal: (AOSMicrophoneCaptureTermination) -> Void
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
        authorizationState: @escaping () -> AOSMicrophoneAuthorizationState,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (AOSMicrophoneCaptureTermination) -> Void
    ) throws {
        guard let boundedDuration = aosVoiceCaptureDuration(maximumDuration) else {
            throw AOSVoiceTransportFailure(code: "INVALID_MAX_DURATION", message: "voice capture duration must be positive")
        }
        self.owner = owner
        self.ref = ref
        self.outputURL = try aosCreateVoiceCaptureTarget(outputPath)
        self.maximumDuration = boundedDuration
        self.authorizationState = authorizationState
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
        stateLock.lock()
        let canceledBeforeStart = finished
        stateLock.unlock()
        guard !canceledBeforeStart else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
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
        guard authorizationState().isAuthorized else {
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
        let fallbackDuration = recorder.currentTime
        recorder.stop()
        let authorityAbsent = !recorder.isRecording
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
                "duration_ms": aosVoiceCaptureDurationMilliseconds(
                    at: outputURL,
                    fallback: fallbackDuration
                ),
                "bytes": size,
            ])
        } else {
            emit("capture_canceled", ["reason": reason])
        }
        terminal(AOSMicrophoneCaptureTermination(
            token: token,
            trigger: aosMicrophoneCaptureTerminalTrigger(
                completed: keepFile && !limitExceeded,
                reason: reason,
                failureCode: failureCode ?? (limitExceeded ? "OUTPUT_LIMIT_EXCEEDED" : nil)
            ),
            authorityAbsent: authorityAbsent
        ))
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

func aosCopyPCMBuffer(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
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

func aosRunOnMainSync(_ operation: () -> Void) {
    if Thread.isMainThread {
        operation()
    } else {
        DispatchQueue.main.sync(execute: operation)
    }
}

private final class AOSStreamingSpeechSession: AOSLegacyVoiceOutputSentinel {
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

    private struct PendingCaptureAdmission {
        let token: UUID
        let owner: UUID
        var operation: (any AOSMicrophoneOperationClaimLease)?
    }

    private let lock = NSLock()
    private let captureStartupQueue = DispatchQueue(label: "aos.voice.capture-startup", qos: .userInitiated)
    private let emit: EventEmitter
    private let microphoneAuthorization: AOSMicrophoneAuthorizationProviding
    private let microphoneOperations: (any AOSMicrophoneOperationClaiming)?
    private var hotkey: HotkeyLease?
    private var pendingCaptureAdmission: PendingCaptureAdmission?
    private var capture: (any AOSMicrophoneCaptureLease)?
    private var captureOperation: (any AOSMicrophoneOperationClaimLease)?
    private var output: (any AOSLegacyVoiceOutputSentinel)?

    init(
        emit: @escaping EventEmitter,
        microphoneAuthorization: AOSMicrophoneAuthorizationProviding = AOSSystemMicrophoneAuthorization(),
        microphoneOperations: (any AOSMicrophoneOperationClaiming)? = nil
    ) {
        self.emit = emit
        self.microphoneAuthorization = microphoneAuthorization
        self.microphoneOperations = microphoneOperations
    }

    func microphoneAuthorizationStatus() -> AOSMicrophoneAuthorizationState {
        microphoneAuthorization.status()
    }

    func requestMicrophoneAuthorization(timeout: TimeInterval = 30) -> AOSMicrophoneAuthorizationRequestResult {
        microphoneAuthorization.request(timeout: timeout)
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
        let admissionToken = try beginCaptureAdmission(owner: owner)
        var operation: (any AOSMicrophoneOperationClaimLease)?
        do {
            operation = try prepareCaptureOperation(owner: owner, admissionToken: admissionToken)
            var authorization = microphoneAuthorization.status()
            if authorization == .notDetermined {
                authorization = microphoneAuthorization.request(timeout: 30).after
            }
            if let failure = authorization.failure {
                throw AOSVoiceTransportFailure(code: failure.code, message: failure.message)
            }
            let session = try AOSMicrophoneCaptureSession(
                owner: owner,
                ref: ref,
                outputPath: outputPath,
                maximumDuration: maximumDuration,
                authorizationState: { [microphoneAuthorization] in microphoneAuthorization.status() },
                emit: { [emit] event, data in emit(owner, event, data, ref) },
                terminal: { [weak self] termination in
                    self?.captureDidTerminate(termination)
                }
            )
            try installCapture(
                session,
                operation: operation,
                admissionToken: admissionToken
            )
            try operation?.bindAuthority(
                stop: { [weak session] force in
                    session?.cancel(reason: force ? "operation_kill" : "operation_cancel")
                },
                residualDigest: { nil }
            )
            try session.start()
            try operation?.markAuthorityStarted()
        } catch {
            failCaptureAdmission(
                admissionToken: admissionToken,
                operation: operation,
                trigger: .adapterFailed
            )
            throw voiceOperationError(error)
        }
    }

    func prepareSegmentedCapture(
        owner: UUID,
        directoryPath: String,
        segmentDuration: TimeInterval,
        maximumDuration: TimeInterval,
        readyCue: AOSCaptureReadyCue,
        ref: String?
    ) throws -> () -> Void {
        let admissionToken = try beginCaptureAdmission(owner: owner)
        var operation: (any AOSMicrophoneOperationClaimLease)?
        do {
            operation = try prepareCaptureOperation(owner: owner, admissionToken: admissionToken)
            let session = try AOSSegmentedMicrophoneCaptureSession(
                owner: owner,
                ref: ref,
                directoryPath: directoryPath,
                segmentDuration: segmentDuration,
                maximumDuration: maximumDuration,
                readyCue: readyCue,
                authorizeMicrophone: { [microphoneAuthorization] in
                    let current = microphoneAuthorization.status()
                    return current == .notDetermined
                        ? microphoneAuthorization.request(timeout: 30).after
                        : current
                },
                authorizationState: { [microphoneAuthorization] in microphoneAuthorization.status() },
                emit: { [emit] event, data in emit(owner, event, data, ref) },
                terminal: { [weak self] termination in
                    self?.captureDidTerminate(termination)
                }
            )
            try installCapture(
                session,
                operation: operation,
                admissionToken: admissionToken
            )
            try operation?.bindAuthority(
                stop: { [weak session] force in
                    session?.cancel(reason: force ? "operation_kill" : "operation_cancel")
                },
                residualDigest: { nil }
            )
            return { [captureStartupQueue] in
                captureStartupQueue.async {
                    do {
                        try session.start()
                        try operation?.markAuthorityStarted()
                    } catch {
                        session.cancel(reason: "startup_failed")
                    }
                }
            }
        } catch {
            failCaptureAdmission(
                admissionToken: admissionToken,
                operation: operation,
                trigger: .adapterFailed
            )
            throw voiceOperationError(error)
        }
    }

    func stopCapture(owner: UUID, finalize: Bool, reason: String) throws {
        lock.lock()
        guard let session = capture, session.owner == owner else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_NOT_OWNED", message: "this connection does not own microphone capture")
        }
        let operation = captureOperation
        lock.unlock()
        do {
            try operation?.noteStop(trigger: finalize ? .completed : .cancelled)
        } catch {
            throw voiceOperationError(error)
        }
        if finalize { session.finalize(reason: reason) } else { session.cancel(reason: reason) }
    }

    func startSpeech(owner: UUID, text: String, voiceID: String?, rateWPM: Double?, ref: String?) throws {
        lock.lock()
        guard capture == nil, pendingCaptureAdmission == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_ACTIVE", message: "speech cannot start during microphone capture")
        }
        guard output == nil else {
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
            terminal: { [weak self] token in self?.outputDidTerminate(token: token) }
        )
        lock.lock()
        guard capture == nil, pendingCaptureAdmission == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_ACTIVE", message: "speech cannot start during microphone capture")
        }
        guard output == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "SPEECH_LEASE_BUSY", message: "speech playback is already active")
        }
        output = session
        lock.unlock()
        session.start()
    }

    func startPlayback(owner: UUID, inputPath: String, ref: String?) throws {
        lock.lock()
        guard capture == nil, pendingCaptureAdmission == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_ACTIVE", message: "audio playback cannot start during microphone capture")
        }
        guard output == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "SPEECH_LEASE_BUSY", message: "voice output is already active")
        }
        lock.unlock()

        let session = try AOSAudioPlaybackSession(
            owner: owner,
            ref: ref,
            inputPath: inputPath,
            emit: { [emit] event, data in emit(owner, event, data, ref) },
            terminal: { [weak self] token in self?.outputDidTerminate(token: token) }
        )
        lock.lock()
        guard capture == nil, pendingCaptureAdmission == nil else {
            lock.unlock()
            throw AOSVoiceTransportFailure(code: "CAPTURE_ACTIVE", message: "audio playback cannot start during microphone capture")
        }
        guard output == nil else {
            lock.unlock()
            session.cancel(reason: "superseded")
            throw AOSVoiceTransportFailure(code: "SPEECH_LEASE_BUSY", message: "voice output is already active")
        }
        output = session
        lock.unlock()
        do {
            try session.start()
        } catch {
            outputDidTerminate(token: session.token)
            throw error
        }
    }

    func stopSpeech(owner: UUID, reason: String) throws {
        lock.lock()
        guard let session = output, session.owner == owner else {
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
        let captureOperationToCancel = capture?.owner == owner ? captureOperation : nil
        let pendingOperationToCancel = pendingCaptureAdmission?.owner == owner
            ? pendingCaptureAdmission?.operation
            : nil
        if pendingCaptureAdmission?.owner == owner { pendingCaptureAdmission = nil }
        let outputToCancel = output?.owner == owner ? output : nil
        lock.unlock()
        try? captureOperationToCancel?.noteStop(trigger: .ownerDisconnected)
        try? pendingOperationToCancel?.noteStop(trigger: .ownerDisconnected)
        if let pendingOperationToCancel {
            pendingOperationToCancel.authorityDidTerminate(AOSMicrophoneCaptureTermination(
                token: UUID(),
                trigger: .ownerDisconnected,
                authorityAbsent: true
            ))
        }
        captureToCancel?.cancel(reason: "owner_disconnect")
        outputToCancel?.cancel(reason: "owner_disconnect")
    }

    func shutdown() {
        lock.lock()
        hotkey = nil
        let captureToCancel = capture
        let captureOperationToCancel = captureOperation
        let pendingOperationToCancel = pendingCaptureAdmission?.operation
        pendingCaptureAdmission = nil
        let outputToCancel = output
        lock.unlock()
        try? captureOperationToCancel?.noteStop(trigger: .daemonShutdown)
        try? pendingOperationToCancel?.noteStop(trigger: .daemonShutdown)
        if let pendingOperationToCancel {
            pendingOperationToCancel.authorityDidTerminate(AOSMicrophoneCaptureTermination(
                token: UUID(),
                trigger: .daemonShutdown,
                authorityAbsent: true
            ))
        }
        captureToCancel?.cancel(reason: "daemon_shutdown")
        outputToCancel?.cancel(reason: "daemon_shutdown")
    }

    private func captureDidTerminate(_ termination: AOSMicrophoneCaptureTermination) {
        lock.lock()
        let operation: (any AOSMicrophoneOperationClaimLease)?
        if capture?.token == termination.token {
            capture = nil
            operation = captureOperation
            captureOperation = nil
        } else {
            operation = nil
        }
        lock.unlock()
        operation?.authorityDidTerminate(termination)
    }

    private func beginCaptureAdmission(owner: UUID) throws -> UUID {
        lock.lock()
        defer { lock.unlock() }
        guard capture == nil, pendingCaptureAdmission == nil else {
            throw AOSVoiceTransportFailure(
                code: "OPERATION_RESOURCE_BUSY",
                message: "microphone capture is already active"
            )
        }
        guard output == nil else {
            throw AOSVoiceTransportFailure(
                code: "OPERATION_RESOURCE_BUSY",
                message: "the shared voice native session is busy"
            )
        }
        let token = UUID()
        pendingCaptureAdmission = PendingCaptureAdmission(token: token, owner: owner, operation: nil)
        return token
    }

    private func prepareCaptureOperation(
        owner: UUID,
        admissionToken: UUID
    ) throws -> (any AOSMicrophoneOperationClaimLease)? {
        guard let microphoneOperations else { return nil }
        let operation = try microphoneOperations.prepareCapture(owner: owner)
        lock.lock()
        guard var pending = pendingCaptureAdmission,
              pending.token == admissionToken,
              pending.owner == owner else {
            lock.unlock()
            try? operation.noteStop(trigger: .cancelled)
            operation.authorityDidTerminate(AOSMicrophoneCaptureTermination(
                token: admissionToken,
                trigger: .cancelled,
                authorityAbsent: true
            ))
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture admission was canceled"
            )
        }
        pending.operation = operation
        pendingCaptureAdmission = pending
        lock.unlock()
        return operation
    }

    private func installCapture(
        _ session: any AOSMicrophoneCaptureLease,
        operation: (any AOSMicrophoneOperationClaimLease)?,
        admissionToken: UUID
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let pending = pendingCaptureAdmission,
              pending.token == admissionToken,
              pending.owner == session.owner,
              capture == nil,
              output == nil else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture admission was canceled"
            )
        }
        capture = session
        captureOperation = operation
        pendingCaptureAdmission = nil
    }

    private func failCaptureAdmission(
        admissionToken: UUID,
        operation: (any AOSMicrophoneOperationClaimLease)?,
        trigger: AOSMicrophoneCaptureTerminalTrigger
    ) {
        lock.lock()
        if pendingCaptureAdmission?.token == admissionToken {
            pendingCaptureAdmission = nil
        }
        let installedSession: (any AOSMicrophoneCaptureLease)?
        if let operation, let activeOperation = captureOperation, activeOperation === operation {
            installedSession = capture
        } else if operation == nil, captureOperation == nil {
            installedSession = capture
        } else {
            installedSession = nil
        }
        lock.unlock()

        if let installedSession {
            installedSession.cancel(reason: "startup_failed")
            return
        }
        guard let operation else { return }
        try? operation.noteStop(trigger: trigger)
        operation.authorityDidTerminate(AOSMicrophoneCaptureTermination(
            token: admissionToken,
            trigger: trigger,
            authorityAbsent: true
        ))
    }

    private func voiceOperationError(_ error: Error) -> Error {
        if error is AOSVoiceTransportFailure { return error }
        return AOSVoiceTransportFailure(
            code: "OPERATION_ADMISSION_FAILED",
            message: "microphone operation admission failed"
        )
    }

    private func outputDidTerminate(token: UUID) {
        lock.lock()
        if output?.token == token { output = nil }
        lock.unlock()
    }
}

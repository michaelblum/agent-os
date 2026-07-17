import AVFoundation
import Darwin
import Foundation

let aosAudioPlaybackMaximumBytes = 4 * 1024 * 1024
let aosAudioPlaybackMaximumDuration: TimeInterval = 120

protocol AOSVoiceOutputLease: AnyObject {
    var token: UUID { get }
    var owner: UUID { get }

    func cancel(reason: String)
}
struct AOSAudioPlaybackSource {
    let url: URL
    let file: AVAudioFile
    let bytes: Int
    let durationMilliseconds: Int
    let sampleRate: Double
    let channels: Int
}

func aosValidateAudioPlaybackSource(_ inputPath: String) throws -> AOSAudioPlaybackSource {
    guard inputPath.hasPrefix("/") else {
        throw AOSVoiceTransportFailure(code: "INVALID_AUDIO_PATH", message: "audio playback input must be absolute")
    }
    let url = URL(fileURLWithPath: inputPath).standardizedFileURL
    guard url.path == inputPath,
          url.pathExtension.lowercased() == "wav",
          url.resolvingSymlinksInPath().path == inputPath else {
        throw AOSVoiceTransportFailure(code: "INVALID_AUDIO_PATH", message: "audio playback input must be a canonical WAV path")
    }

    let parent = url.deletingLastPathComponent()
    guard parent.resolvingSymlinksInPath().path == parent.path else {
        throw AOSVoiceTransportFailure(code: "UNSAFE_AUDIO_PARENT", message: "audio playback parent must not contain symlinks")
    }
    let parentAttributes: [FileAttributeKey: Any]
    let fileAttributes: [FileAttributeKey: Any]
    do {
        parentAttributes = try FileManager.default.attributesOfItem(atPath: parent.path)
        fileAttributes = try FileManager.default.attributesOfItem(atPath: inputPath)
    } catch {
        throw AOSVoiceTransportFailure(code: "AUDIO_INPUT_UNAVAILABLE", message: "audio playback input is unavailable")
    }
    guard parentAttributes[.type] as? FileAttributeType == .typeDirectory,
          (parentAttributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
          ((parentAttributes[.posixPermissions] as? NSNumber)?.intValue ?? -1) & 0o777 == 0o700 else {
        throw AOSVoiceTransportFailure(code: "UNSAFE_AUDIO_PARENT", message: "audio playback parent must be owner-only mode 0700")
    }
    guard fileAttributes[.type] as? FileAttributeType == .typeRegular,
          (fileAttributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
          ((fileAttributes[.posixPermissions] as? NSNumber)?.intValue ?? -1) & 0o777 == 0o600 else {
        throw AOSVoiceTransportFailure(code: "UNSAFE_AUDIO_INPUT", message: "audio playback input must be an owner-only regular file")
    }
    let bytes = (fileAttributes[.size] as? NSNumber)?.intValue ?? -1
    guard bytes > 44, bytes <= aosAudioPlaybackMaximumBytes else {
        throw AOSVoiceTransportFailure(code: "AUDIO_INPUT_LIMIT", message: "audio playback input exceeds the supported size")
    }

    let file: AVAudioFile
    do {
        file = try AVAudioFile(forReading: url)
    } catch {
        throw AOSVoiceTransportFailure(code: "INVALID_AUDIO_FILE", message: "audio playback input is not readable PCM audio")
    }
    let sampleRate = file.processingFormat.sampleRate
    let channels = Int(file.processingFormat.channelCount)
    let duration = sampleRate > 0 ? Double(file.length) / sampleRate : 0
    guard sampleRate.isFinite,
          sampleRate >= 8_000,
          sampleRate <= 192_000,
          (1...2).contains(channels),
          duration.isFinite,
          duration > 0,
          duration <= aosAudioPlaybackMaximumDuration else {
        throw AOSVoiceTransportFailure(code: "UNSUPPORTED_AUDIO_FILE", message: "audio playback format or duration is unsupported")
    }
    return AOSAudioPlaybackSource(
        url: url,
        file: file,
        bytes: bytes,
        durationMilliseconds: Int((duration * 1000).rounded()),
        sampleRate: sampleRate,
        channels: channels
    )
}

final class AOSAudioPlaybackSession: AOSVoiceOutputLease {
    let token = UUID()
    let owner: UUID
    let ref: String?

    private let source: AOSAudioPlaybackSource
    private let emit: (String, [String: Any]) -> Void
    private let terminal: (UUID) -> Void
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queue = DispatchQueue(label: "aos.voice.audio-playback")
    private var finished = false
    private var tapInstalled = false
    private var sequence = 0
    private var lastMeterAt = Date.distantPast

    init(
        owner: UUID,
        ref: String?,
        inputPath: String,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (UUID) -> Void
    ) throws {
        self.owner = owner
        self.ref = ref
        self.source = try aosValidateAudioPlaybackSource(inputPath)
        self.emit = emit
        self.terminal = terminal
    }

    func start() throws {
        try queue.sync {
            guard !finished else {
                throw AOSVoiceTransportFailure(code: "PLAYBACK_CANCELED", message: "audio playback was canceled before startup")
            }
            do {
                engine.attach(player)
                engine.connect(player, to: engine.mainMixerNode, format: source.file.processingFormat)
                engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
                    self?.receiveMeter(buffer)
                }
                tapInstalled = true
                engine.prepare()
                try engine.start()
                player.scheduleFile(source.file, at: nil) { [weak self] in
                    self?.queue.async { self?.finishLocked() }
                }
                player.play()
            } catch {
                cleanupLocked()
                throw AOSVoiceTransportFailure(code: "AUDIO_OUTPUT_UNAVAILABLE", message: "audio playback output is unavailable")
            }
            emit("playback_started", [
                "duration_ms": source.durationMilliseconds,
                "bytes": source.bytes,
                "sample_rate": Int(source.sampleRate.rounded()),
                "channels": source.channels,
            ])
        }
    }

    func cancel(reason: String) {
        queue.sync {
            guard !finished else { return }
            finished = true
            cleanupLocked()
            emit("playback_canceled", ["reason": reason])
            terminal(token)
        }
    }

    private func receiveMeter(_ buffer: AVAudioPCMBuffer) {
        guard let copy = aosCopyPCMBuffer(buffer) else { return }
        queue.async { [weak self] in
            guard let self, !self.finished else { return }
            let now = Date()
            guard now.timeIntervalSince(self.lastMeterAt) >= 0.1,
                  let metrics = aosAudioFrameMetrics(copy) else { return }
            self.lastMeterAt = now
            self.sequence += 1
            self.emit("audio_frame", [
                "stream": "playback",
                "rms": metrics.rms,
                "peak": metrics.peak,
                "sequence": self.sequence,
            ])
        }
    }

    private func finishLocked() {
        guard !finished else { return }
        finished = true
        cleanupLocked()
        emit("playback_finished", ["reason": "completed"])
        terminal(token)
    }

    private func cleanupLocked() {
        if tapInstalled {
            engine.mainMixerNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        player.stop()
        engine.stop()
    }
}

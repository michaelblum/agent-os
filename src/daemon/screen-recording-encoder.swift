import AVFoundation
import CryptoKit
import Darwin
import Foundation

struct AOSScreenRecordingEncoderProgress: Equatable {
    let frameCount: UInt64
    let byteCount: UInt64
    let trackSummary: AOSScreenRecordingTrackSummary
    let sessionStarted: Bool
}

protocol AOSScreenRecordingEncoding: AnyObject {
    var progress: AOSScreenRecordingEncoderProgress { get }
    func append(
        _ sampleBuffer: CMSampleBuffer,
        track: AOSScreenRecordingTrackKind
    ) throws
    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void)
    func cancel()
}

struct AOSScreenRecordingWriterDependencies {
    let startWriting: () -> Bool
    let startSession: (CMTime) -> Void
    let isWriting: () -> Bool
    let finish: (@escaping (Bool) -> Void) -> Void
    let cancel: () -> Void
}

struct AOSScreenRecordingWriterInputDependencies {
    let isReady: () -> Bool
    let append: (CMSampleBuffer) -> Bool
    let markFinished: () -> Void
}

private struct AOSScreenRecordingPendingSample {
    let buffer: CMSampleBuffer
    let presentationTime: CMTime
    let sampleByteCount: UInt64
}

private struct AOSScreenRecordingMutableTrackTruth {
    let selected: Bool
    let admitted: Bool
    var available = false
    var firstSamplePresent = false
    var sampleCount: UInt64 = 0
    var sampleByteCount: UInt64 = 0
    var failureCode: String?
    var drained: Bool
    var finalized: Bool
    var lastPresentationTime: CMTime?
    var pending: [AOSScreenRecordingPendingSample] = []
    var inputFinished = false

    init(selected: Bool, admitted: Bool) {
        self.selected = selected
        self.admitted = admitted
        drained = !selected
        finalized = !selected
    }

    var publicTruth: AOSScreenRecordingTrackTruth {
        AOSScreenRecordingTrackTruth(
            selected: selected,
            admitted: admitted,
            available: available,
            firstSamplePresent: firstSamplePresent,
            sampleCount: sampleCount,
            sampleByteCount: sampleByteCount,
            failureCode: failureCode,
            drained: drained,
            finalized: finalized
        )
    }
}

final class AOSScreenRecordingMultitrackCoordinator: @unchecked Sendable {
    private let inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies]
    private let lock = NSLock()
    private let maximumPendingSamplesPerTrack: Int
    private let observeOutputBytes: () throws -> UInt64
    private let writer: AOSScreenRecordingWriterDependencies
    private var artifactByteCount: UInt64 = 0
    private var cancelled = false
    private var commonEpoch: CMTime?
    private var finishAdmitted = false
    private var finishCompleted = false
    private var sessionStarted = false
    private var tracks: [AOSScreenRecordingTrackKind: AOSScreenRecordingMutableTrackTruth]

    init(
        systemAudioSelected: Bool,
        maximumPendingSamplesPerTrack: Int,
        writer: AOSScreenRecordingWriterDependencies,
        inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies],
        observeOutputBytes: @escaping () throws -> UInt64
    ) throws {
        guard (1...8).contains(maximumPendingSamplesPerTrack),
              inputs[.video] != nil,
              !systemAudioSelected || inputs[.systemAudio] != nil else {
            throw AOSOperationCoreError.recordingSystemAudioUnavailable
        }
        self.maximumPendingSamplesPerTrack = maximumPendingSamplesPerTrack
        self.writer = writer
        self.inputs = inputs
        self.observeOutputBytes = observeOutputBytes
        tracks = [
            .video: AOSScreenRecordingMutableTrackTruth(selected: true, admitted: true),
            .systemAudio: AOSScreenRecordingMutableTrackTruth(
                selected: systemAudioSelected,
                admitted: systemAudioSelected
            ),
        ]
    }

    var progress: AOSScreenRecordingEncoderProgress {
        lock.lock()
        defer { lock.unlock() }
        return progressLocked()
    }

    func append(
        _ sampleBuffer: CMSampleBuffer,
        track kind: AOSScreenRecordingTrackKind
    ) throws {
        guard CMSampleBufferIsValid(sampleBuffer) else { return }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        guard presentationTime.isValid, !presentationTime.isIndefinite,
              CMTimeCompare(presentationTime, .zero) >= 0 else {
            throw recordFailure(
                track: kind,
                error: AOSOperationCoreError.recordingTimestampNonMonotonic
            )
        }
        let bytes = AOSScreenRecordingEncoder.sampleByteCount(sampleBuffer, track: kind)
        lock.lock()
        do {
            try appendLocked(AOSScreenRecordingPendingSample(
                buffer: sampleBuffer,
                presentationTime: presentationTime,
                sampleByteCount: bytes
            ), track: kind)
            lock.unlock()
        } catch {
            lock.unlock()
            throw error
        }
    }

    func finish(
        identity: @escaping (AOSScreenRecordingTrackSummary) throws -> AOSArtifactFileIdentity,
        completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void
    ) {
        lock.lock()
        guard !finishAdmitted, !cancelled else {
            lock.unlock()
            completion(.failure(AOSOperationCoreError.recordingEncoderFailed))
            return
        }
        finishAdmitted = true
        do {
            if tracks[.systemAudio]?.selected == true,
               tracks[.systemAudio]?.firstSamplePresent != true {
                throw recordFailureLocked(
                    track: .systemAudio,
                    error: AOSOperationCoreError.recordingSystemAudioNoSamples
                )
            }
            guard tracks[.video]?.firstSamplePresent == true else {
                throw recordFailureLocked(
                    track: .video,
                    error: AOSOperationCoreError.recordingNoFrames
                )
            }
            try drainPendingLocked()
            guard allPendingEmptyLocked() else {
                throw recordFailureLocked(
                    track: tracks[.systemAudio]?.pending.isEmpty == false ? .systemAudio : .video,
                    error: AOSOperationCoreError.recordingBackpressureExceeded
                )
            }
            guard tracks[.video]?.sampleCount ?? 0 > 0,
                  tracks[.systemAudio]?.selected != true
                    || (tracks[.systemAudio]?.sampleCount ?? 0) > 0 else {
                throw AOSOperationCoreError.recordingEncoderFailed
            }
            markInputsFinishedLocked()
        } catch {
            lock.unlock()
            completion(.failure(error))
            return
        }
        lock.unlock()

        writer.finish { [weak self] succeeded in
            guard let self else {
                completion(.failure(AOSOperationCoreError.recordingCleanupRequired))
                return
            }
            self.lock.lock()
            guard !self.finishCompleted else {
                self.lock.unlock()
                completion(.failure(AOSOperationCoreError.recordingEncoderFailed))
                return
            }
            self.finishCompleted = true
            if succeeded {
                for kind in AOSScreenRecordingTrackKind.allCases
                    where self.tracks[kind]?.selected == true {
                    self.tracks[kind]?.finalized = true
                }
            } else {
                _ = self.recordFailureLocked(
                    track: .video,
                    error: AOSOperationCoreError.recordingEncoderFailed
                )
                if self.tracks[.systemAudio]?.selected == true {
                    _ = self.recordFailureLocked(
                        track: .systemAudio,
                        error: AOSOperationCoreError.recordingSystemAudioFailed
                    )
                }
            }
            let summary = self.summaryLocked()
            self.lock.unlock()
            guard succeeded else {
                completion(.failure(
                    summary.systemAudio.selected
                        ? AOSOperationCoreError.recordingSystemAudioFailed
                        : AOSOperationCoreError.recordingEncoderFailed
                ))
                return
            }
            do {
                completion(.success(try identity(summary)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func cancel() {
        lock.lock()
        guard !cancelled, !finishCompleted else {
            lock.unlock()
            return
        }
        cancelled = true
        markInputsFinishedLocked()
        lock.unlock()
        writer.cancel()
    }

    private func appendLocked(
        _ sample: AOSScreenRecordingPendingSample,
        track kind: AOSScreenRecordingTrackKind
    ) throws {
        guard !finishAdmitted, !cancelled,
              var state = tracks[kind], state.selected, state.admitted else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        if let previous = state.lastPresentationTime,
           CMTimeCompare(sample.presentationTime, previous) < 0 {
            throw recordFailureLocked(
                track: kind,
                error: AOSOperationCoreError.recordingTimestampNonMonotonic
            )
        }
        state.available = true
        state.firstSamplePresent = true
        state.lastPresentationTime = sample.presentationTime
        guard state.pending.count < maximumPendingSamplesPerTrack else {
            tracks[kind] = state
            throw recordFailureLocked(
                track: kind,
                error: AOSOperationCoreError.recordingBackpressureExceeded
            )
        }
        state.pending.append(sample)
        tracks[kind] = state
        if !sessionStarted, allSelectedFirstSamplesPresentLocked() {
            let firstTimes = AOSScreenRecordingTrackKind.allCases.compactMap {
                tracks[$0]?.selected == true ? tracks[$0]?.pending.first?.presentationTime : nil
            }
            guard let epoch = firstTimes.min(by: { CMTimeCompare($0, $1) < 0 }),
                  writer.startWriting() else {
                throw recordFailureLocked(
                    track: kind,
                    error: AOSOperationCoreError.recordingEncoderFailed
                )
            }
            writer.startSession(epoch)
            commonEpoch = epoch
            sessionStarted = true
        }
        if sessionStarted { try drainPendingLocked() }
    }

    private func drainPendingLocked() throws {
        guard sessionStarted, writer.isWriting() else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        for kind in AOSScreenRecordingTrackKind.allCases {
            guard var state = tracks[kind], state.selected, let input = inputs[kind] else { continue }
            while !state.pending.isEmpty, input.isReady() {
                let sample = state.pending.removeFirst()
                guard input.append(sample.buffer) else {
                    tracks[kind] = state
                    throw recordFailureLocked(
                        track: kind,
                        error: kind == .systemAudio
                            ? AOSOperationCoreError.recordingSystemAudioFailed
                            : AOSOperationCoreError.recordingEncoderFailed
                    )
                }
                state.sampleCount &+= 1
                state.sampleByteCount &+= sample.sampleByteCount
                tracks[kind] = state
                do {
                    artifactByteCount = try observeOutputBytes()
                } catch let error as AOSOperationCoreError {
                    throw recordFailureLocked(track: kind, error: error)
                } catch {
                    throw recordFailureLocked(
                        track: kind,
                        error: kind == .systemAudio
                            ? AOSOperationCoreError.recordingSystemAudioFailed
                            : AOSOperationCoreError.recordingEncoderFailed
                    )
                }
            }
            tracks[kind] = state
        }
    }

    private func markInputsFinishedLocked() {
        for kind in AOSScreenRecordingTrackKind.allCases {
            guard var state = tracks[kind], state.selected, !state.inputFinished else { continue }
            state.inputFinished = true
            state.drained = state.pending.isEmpty
            tracks[kind] = state
            inputs[kind]?.markFinished()
        }
    }

    private func allSelectedFirstSamplesPresentLocked() -> Bool {
        AOSScreenRecordingTrackKind.allCases.allSatisfy {
            tracks[$0]?.selected != true || tracks[$0]?.firstSamplePresent == true
        }
    }

    private func allPendingEmptyLocked() -> Bool {
        tracks.values.allSatisfy { !$0.selected || $0.pending.isEmpty }
    }

    private func progressLocked() -> AOSScreenRecordingEncoderProgress {
        AOSScreenRecordingEncoderProgress(
            frameCount: tracks[.video]?.sampleCount ?? 0,
            byteCount: artifactByteCount,
            trackSummary: summaryLocked(),
            sessionStarted: sessionStarted
        )
    }

    private func summaryLocked() -> AOSScreenRecordingTrackSummary {
        let video = tracks[.video]!.publicTruth
        let audio = tracks[.systemAudio]!.publicTruth
        let selected = audio.selected ? ["video", "system_audio"] : ["video"]
        let finalized = selected.filter { name in
            name == "video" ? video.finalized : audio.finalized
        }
        return AOSScreenRecordingTrackSummary(
            selectedTracks: selected,
            finalizedTracks: finalized,
            commonMediaEpochNanoseconds: commonEpoch.flatMap(Self.nanoseconds),
            video: video,
            systemAudio: audio
        )
    }

    private func recordFailure(
        track kind: AOSScreenRecordingTrackKind,
        error: AOSOperationCoreError
    ) -> AOSOperationCoreError {
        lock.lock()
        defer { lock.unlock() }
        return recordFailureLocked(track: kind, error: error)
    }

    private func recordFailureLocked(
        track kind: AOSScreenRecordingTrackKind,
        error: AOSOperationCoreError
    ) -> AOSOperationCoreError {
        if var state = tracks[kind], state.failureCode == nil {
            state.failureCode = error.code
            tracks[kind] = state
        }
        return error
    }

    private static func nanoseconds(_ time: CMTime) -> UInt64? {
        guard time.isNumeric, time.value >= 0, time.timescale > 0 else { return nil }
        let converted = CMTimeConvertScale(time, timescale: 1_000_000_000, method: .default)
        return converted.value >= 0 ? UInt64(converted.value) : nil
    }
}

final class AOSScreenRecordingEncoder: AOSScreenRecordingEncoding,
    @unchecked Sendable
{
    private let coordinator: AOSScreenRecordingMultitrackCoordinator
    private let maximumOutputBytes: UInt64
    private let outputURL: URL
    private let rootURL: URL

    init(
        outputURL: URL,
        rootURL: URL,
        geometry: AOSScreenRecordingGeometry,
        maximumOutputBytes: UInt64,
        maximumPendingSamplesPerTrack: Int,
        systemAudioSelected: Bool
    ) throws {
        guard outputURL.deletingLastPathComponent().standardizedFileURL == rootURL.standardizedFileURL,
              !FileManager.default.fileExists(atPath: outputURL.path),
              maximumOutputBytes >= AOSScreenRecordingLimits.minimumOutputBytes,
              maximumOutputBytes <= AOSScreenRecordingLimits.maximumOutputBytes else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_output")
        }
        self.outputURL = outputURL
        self.rootURL = rootURL
        self.maximumOutputBytes = maximumOutputBytes

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let videoInput = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: geometry.pixelWidth,
                AVVideoHeightKey: geometry.pixelHeight,
            ]
        )
        videoInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(videoInput) else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        writer.add(videoInput)

        var inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies] = [
            .video: Self.dependencies(videoInput),
        ]
        if systemAudioSelected {
            let audioInput = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 48_000,
                    AVNumberOfChannelsKey: 2,
                    AVEncoderBitRateKey: 192_000,
                ]
            )
            audioInput.expectsMediaDataInRealTime = true
            guard writer.canAdd(audioInput) else {
                throw AOSOperationCoreError.recordingSystemAudioUnavailable
            }
            writer.add(audioInput)
            inputs[.systemAudio] = Self.dependencies(audioInput)
        }
        coordinator = try AOSScreenRecordingMultitrackCoordinator(
            systemAudioSelected: systemAudioSelected,
            maximumPendingSamplesPerTrack: maximumPendingSamplesPerTrack,
            writer: AOSScreenRecordingWriterDependencies(
                startWriting: { writer.startWriting() },
                startSession: { writer.startSession(atSourceTime: $0) },
                isWriting: { writer.status == .writing },
                finish: { completion in
                    writer.finishWriting { completion(writer.status == .completed) }
                },
                cancel: { writer.cancelWriting() }
            ),
            inputs: inputs,
            observeOutputBytes: { [outputURL] in
                let bytes = try Self.fileSizeIfPresent(outputURL)
                guard bytes <= maximumOutputBytes else {
                    throw AOSOperationCoreError.recordingBoundsExceeded
                }
                return bytes
            }
        )
    }

    var progress: AOSScreenRecordingEncoderProgress { coordinator.progress }

    func append(
        _ sampleBuffer: CMSampleBuffer,
        track: AOSScreenRecordingTrackKind
    ) throws {
        try coordinator.append(sampleBuffer, track: track)
    }

    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void) {
        coordinator.finish(
            identity: { [outputURL, rootURL, maximumOutputBytes] summary in
                try Self.validateArtifact(
                    outputURL,
                    rootURL: rootURL,
                    maximumOutputBytes: maximumOutputBytes,
                    trackSummary: summary
                )
            },
            completion: completion
        )
    }

    func cancel() { coordinator.cancel() }

    static func validateArtifact(
        _ outputURL: URL,
        rootURL: URL,
        maximumOutputBytes: UInt64,
        trackSummary: AOSScreenRecordingTrackSummary
    ) throws -> AOSArtifactFileIdentity {
        guard outputURL.deletingLastPathComponent().standardizedFileURL == rootURL.standardizedFileURL,
              trackSummary.isSuccessful else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        var metadata = stat()
        guard lstat(outputURL.path, &metadata) == 0,
              (metadata.st_mode & S_IFMT) == S_IFREG,
              metadata.st_uid == geteuid(),
              metadata.st_nlink == 1,
              metadata.st_size > 0,
              UInt64(metadata.st_size) <= maximumOutputBytes else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        let bytes = try Data(contentsOf: outputURL, options: [.mappedIfSafe])
        guard bytes.count == Int(metadata.st_size) else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        return AOSArtifactFileIdentity(
            rootIdentityDigest: digest("root:\(rootURL.standardizedFileURL.path)"),
            relativeLocatorDigest: digest("name:\(outputURL.lastPathComponent)"),
            device: UInt64(metadata.st_dev),
            inode: UInt64(metadata.st_ino),
            byteCount: UInt64(metadata.st_size),
            contentDigest: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
            mediaType: trackSummary.selectedSystemAudio
                ? "video/quicktime; codecs=avc1,mp4a.40.2"
                : "video/quicktime; codecs=avc1",
            trackSummary: trackSummary
        )
    }

    static func fileSizeIfPresent(_ url: URL) throws -> UInt64 {
        var metadata = stat()
        guard lstat(url.path, &metadata) == 0 else {
            if errno == ENOENT { return 0 }
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        guard (metadata.st_mode & S_IFMT) == S_IFREG, metadata.st_size >= 0 else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        return UInt64(metadata.st_size)
    }

    static func sampleByteCount(
        _ sampleBuffer: CMSampleBuffer,
        track: AOSScreenRecordingTrackKind
    ) -> UInt64 {
        let direct = CMSampleBufferGetTotalSampleSize(sampleBuffer)
        if direct > 0 { return UInt64(direct) }
        if track == .video, let image = CMSampleBufferGetImageBuffer(sampleBuffer) {
            return UInt64(CVPixelBufferGetDataSize(image))
        }
        return 0
    }

    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func dependencies(
        _ input: AVAssetWriterInput
    ) -> AOSScreenRecordingWriterInputDependencies {
        AOSScreenRecordingWriterInputDependencies(
            isReady: { input.isReadyForMoreMediaData },
            append: { input.append($0) },
            markFinished: { input.markAsFinished() }
        )
    }
}

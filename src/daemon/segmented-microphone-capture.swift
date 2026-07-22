import AVFoundation
import Darwin
import Foundation

let aosVoiceSegmentMinimumDuration: TimeInterval = 0.5
let aosVoiceSegmentMaximumDuration: TimeInterval = 5
let aosVoiceSegmentDefaultDuration: TimeInterval = 3

protocol AOSMicrophoneCaptureLease: AnyObject {
    var token: UUID { get }
    var owner: UUID { get }

    func start() throws
    func finalize(reason: String)
    func cancel(reason: String)
}

struct AOSVoiceSegmentReady: Equatable {
    let index: Int
    let durationMilliseconds: Int
    let bytes: Int
}

func aosVoiceCaptureDeadlineReached(
    startedAt: DispatchTime,
    now: DispatchTime = .now(),
    maximumDuration: TimeInterval
) -> Bool {
    guard maximumDuration.isFinite,
          maximumDuration > 0,
          now.uptimeNanoseconds >= startedAt.uptimeNanoseconds else { return false }
    let elapsed = Double(now.uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000_000
    return elapsed >= maximumDuration
}

func aosValidateVoiceSegmentDirectory(_ directoryPath: String) throws -> URL {
    guard directoryPath.hasPrefix("/") else {
        throw AOSVoiceTransportFailure(
            code: "INVALID_SEGMENT_DIRECTORY",
            message: "voice segment directory must be absolute"
        )
    }
    let directoryURL = URL(fileURLWithPath: directoryPath).standardizedFileURL
    guard directoryURL.path == directoryPath,
          directoryURL.resolvingSymlinksInPath().path == directoryPath else {
        throw AOSVoiceTransportFailure(
            code: "INVALID_SEGMENT_DIRECTORY",
            message: "voice segment directory must be canonical and contain no symlinks"
        )
    }

    let attributes: [FileAttributeKey: Any]
    do {
        attributes = try FileManager.default.attributesOfItem(atPath: directoryPath)
    } catch {
        throw AOSVoiceTransportFailure(
            code: "UNSAFE_SEGMENT_DIRECTORY",
            message: "voice segment directory is unavailable"
        )
    }
    guard attributes[.type] as? FileAttributeType == .typeDirectory,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
          ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? -1) & 0o777 == 0o700 else {
        throw AOSVoiceTransportFailure(
            code: "UNSAFE_SEGMENT_DIRECTORY",
            message: "voice segment directory must be owner-only mode 0700"
        )
    }

    let contents: [String]
    do {
        contents = try FileManager.default.contentsOfDirectory(atPath: directoryPath)
    } catch {
        throw AOSVoiceTransportFailure(
            code: "UNSAFE_SEGMENT_DIRECTORY",
            message: "voice segment directory cannot be inspected"
        )
    }
    guard contents.isEmpty else {
        throw AOSVoiceTransportFailure(
            code: "SEGMENT_DIRECTORY_NOT_EMPTY",
            message: "voice segment directory must be empty"
        )
    }
    return directoryURL
}

final class AOSAtomicVoiceSegmentWriter {
    let outputFormat: AVAudioFormat
    let maximumDuration: TimeInterval
    let segmentDuration: TimeInterval

    private let directoryURL: URL
    private let framesPerSegment: AVAudioFramePosition
    private let maximumFrames: AVAudioFramePosition
    private var nextIndex = 1
    private var currentFile: AVAudioFile?
    private var currentTemporaryURL: URL?
    private var currentFinalURL: URL?
    private var currentFrames: AVAudioFramePosition = 0
    private(set) var totalFrames: AVAudioFramePosition = 0
    private(set) var totalBytes = 0
    private(set) var completedSegmentCount = 0
    private var ownedURLs: [URL] = []

    init(directoryPath: String, segmentDuration: TimeInterval, maximumDuration: TimeInterval) throws {
        guard segmentDuration.isFinite,
              segmentDuration >= aosVoiceSegmentMinimumDuration,
              segmentDuration <= aosVoiceSegmentMaximumDuration else {
            throw AOSVoiceTransportFailure(
                code: "INVALID_SEGMENT_DURATION",
                message: "voice segment duration must be between 0.5 and 5 seconds"
            )
        }
        guard let boundedDuration = aosVoiceCaptureDuration(maximumDuration) else {
            throw AOSVoiceTransportFailure(
                code: "INVALID_MAX_DURATION",
                message: "voice capture duration must be positive"
            )
        }
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: aosVoiceCaptureSampleRate,
            channels: AVAudioChannelCount(aosVoiceCaptureChannels),
            interleaved: false
        ) else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_FORMAT_UNAVAILABLE",
                message: "voice segment format is unavailable"
            )
        }
        self.directoryURL = try aosValidateVoiceSegmentDirectory(directoryPath)
        self.segmentDuration = segmentDuration
        self.maximumDuration = boundedDuration
        self.outputFormat = format
        self.framesPerSegment = max(1, AVAudioFramePosition((segmentDuration * aosVoiceCaptureSampleRate).rounded()))
        self.maximumFrames = max(1, AVAudioFramePosition((boundedDuration * aosVoiceCaptureSampleRate).rounded(.down)))
    }

    var reachedMaximumDuration: Bool {
        totalFrames >= maximumFrames
    }

    var durationMilliseconds: Int {
        Int((Double(totalFrames) / aosVoiceCaptureSampleRate * 1000).rounded())
    }

    func append(_ buffer: AVAudioPCMBuffer) throws -> [AOSVoiceSegmentReady] {
        guard buffer.format == outputFormat,
              buffer.frameLength > 0,
              let source = buffer.int16ChannelData?[0] else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_FORMAT_CHANGED",
                message: "voice segment audio format changed"
            )
        }

        var ready: [AOSVoiceSegmentReady] = []
        var sourceOffset: AVAudioFramePosition = 0
        while sourceOffset < AVAudioFramePosition(buffer.frameLength), totalFrames < maximumFrames {
            try openSegmentIfNeeded()
            let sourceRemaining = AVAudioFramePosition(buffer.frameLength) - sourceOffset
            let segmentRemaining = framesPerSegment - currentFrames
            let captureRemaining = maximumFrames - totalFrames
            let frameCount = min(sourceRemaining, segmentRemaining, captureRemaining)
            guard frameCount > 0 else { break }
            guard let slice = AVAudioPCMBuffer(
                pcmFormat: outputFormat,
                frameCapacity: AVAudioFrameCount(frameCount)
            ), let destination = slice.int16ChannelData?[0] else {
                throw AOSVoiceTransportFailure(
                    code: "CAPTURE_BUFFER_UNAVAILABLE",
                    message: "voice segment buffer is unavailable"
                )
            }
            slice.frameLength = AVAudioFrameCount(frameCount)
            memcpy(
                destination,
                source.advanced(by: Int(sourceOffset)),
                Int(frameCount) * MemoryLayout<Int16>.size
            )
            guard let currentFile else {
                throw AOSVoiceTransportFailure(
                    code: "CAPTURE_WRITE_FAILED",
                    message: "voice segment writer is unavailable"
                )
            }
            do {
                try currentFile.write(from: slice)
            } catch {
                throw AOSVoiceTransportFailure(
                    code: "CAPTURE_WRITE_FAILED",
                    message: "voice segment could not be written"
                )
            }
            sourceOffset += frameCount
            currentFrames += frameCount
            totalFrames += frameCount
            if currentFrames >= framesPerSegment || totalFrames >= maximumFrames {
                ready.append(try finalizeCurrentSegment())
            }
        }
        return ready
    }

    func finish() throws -> [AOSVoiceSegmentReady] {
        guard currentFrames > 0 else { return [] }
        return [try finalizeCurrentSegment()]
    }

    func cancel() {
        currentFile = nil
        for url in ownedURLs {
            try? FileManager.default.removeItem(at: url)
        }
        ownedURLs.removeAll()
        currentTemporaryURL = nil
        currentFinalURL = nil
        currentFrames = 0
    }

    private func openSegmentIfNeeded() throws {
        guard currentFile == nil else { return }
        let stem = String(format: "segment-%06d", nextIndex)
        let temporaryURL = directoryURL.appendingPathComponent(".\(stem).partial.wav")
        let finalURL = directoryURL.appendingPathComponent("\(stem).wav")
        let fd = open(temporaryURL.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
        guard fd >= 0 else {
            throw AOSVoiceTransportFailure(
                code: "SEGMENT_CREATE_FAILED",
                message: "voice segment could not be created"
            )
        }
        close(fd)
        ownedURLs.append(temporaryURL)
        do {
            currentFile = try AVAudioFile(
                forWriting: temporaryURL,
                settings: outputFormat.settings,
                commonFormat: .pcmFormatInt16,
                interleaved: false
            )
        } catch {
            try? FileManager.default.removeItem(at: temporaryURL)
            ownedURLs.removeAll { $0 == temporaryURL }
            throw AOSVoiceTransportFailure(
                code: "SEGMENT_CREATE_FAILED",
                message: "voice segment could not be opened"
            )
        }
        _ = chmod(temporaryURL.path, mode_t(0o600))
        currentTemporaryURL = temporaryURL
        currentFinalURL = finalURL
        currentFrames = 0
    }

    private func finalizeCurrentSegment() throws -> AOSVoiceSegmentReady {
        guard let temporaryURL = currentTemporaryURL,
              let finalURL = currentFinalURL,
              currentFrames > 0 else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_WRITE_FAILED",
                message: "voice segment state is incomplete"
            )
        }
        currentFile = nil
        _ = chmod(temporaryURL.path, mode_t(0o600))
        let size = (try? temporaryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, totalBytes + size <= aosVoiceCaptureMaximumBytes else {
            cancel()
            throw AOSVoiceTransportFailure(
                code: "OUTPUT_LIMIT_EXCEEDED",
                message: "voice segment output exceeded the capture limit"
            )
        }
        do {
            try FileManager.default.moveItem(at: temporaryURL, to: finalURL)
        } catch {
            cancel()
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_WRITE_FAILED",
                message: "voice segment could not be published"
            )
        }
        _ = chmod(finalURL.path, mode_t(0o600))
        ownedURLs.removeAll { $0 == temporaryURL }
        ownedURLs.append(finalURL)
        let ready = AOSVoiceSegmentReady(
            index: nextIndex,
            durationMilliseconds: max(
                1,
                Int((Double(currentFrames) / aosVoiceCaptureSampleRate * 1000).rounded())
            ),
            bytes: size
        )
        totalBytes += size
        completedSegmentCount += 1
        nextIndex += 1
        currentTemporaryURL = nil
        currentFinalURL = nil
        currentFrames = 0
        return ready
    }
}

final class AOSSegmentedMicrophoneCaptureSession: AOSMicrophoneCaptureLease {
    typealias InputHandler = (AVAudioPCMBuffer, AVAudioTime) -> Void

    private struct FinishRequest {
        let keepSegments: Bool
        let event: String
        let reason: String
        let failureCode: String?
    }

    let token = UUID()
    let owner: UUID
    let ref: String?

    private let maximumDuration: TimeInterval
    private let segmentDuration: TimeInterval
    private let readyCue: AOSCaptureReadyCue
    private let playReadyCue: (AOSCaptureReadyCue, @escaping () -> Bool) throws -> UInt64
    private let startInputEngine: ((@escaping InputHandler) throws -> Void)?
    private let inputEngineHealthy: (() -> Bool)?
    private let stopInputEngine: (() -> Void)?
    private let receiveInput: ((AVAudioPCMBuffer) -> Void)?
    private let authorizeMicrophone: () -> AOSMicrophoneAuthorizationState
    private let authorizationState: () -> AOSMicrophoneAuthorizationState
    private let emit: (String, [String: Any]) -> Void
    private let terminal: (UUID) -> Void
    private let writer: AOSAtomicVoiceSegmentWriter
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "aos.voice.segmented-capture")
    private let finishLock = NSLock()
    private let inputGate = AOSCaptureInputGate()
    private var engineArming = false
    private var engineOwned = false
    private var captureAdmitted = false
    private var finishRequested = false
    private var finished = false
    private var pendingFinish: FinishRequest?
    private var converter: AVAudioConverter?
    private var meterTimer: DispatchSourceTimer?
    private var startedAt: DispatchTime?
    private var tapInstalled = false
    private var sequence = 0
    private var lastMetrics = AOSAudioFrameMetrics(rms: 0, peak: 0)

    init(
        owner: UUID,
        ref: String?,
        directoryPath: String,
        segmentDuration: TimeInterval,
        maximumDuration: TimeInterval,
        readyCue: AOSCaptureReadyCue = .none,
        playReadyCue: @escaping (
            AOSCaptureReadyCue,
            @escaping () -> Bool
        ) throws -> UInt64 = { cue, isCanceled in
            try aosPlayCaptureReadyCue(cue, isCanceled: isCanceled)
        },
        startInputEngine: ((@escaping InputHandler) throws -> Void)? = nil,
        inputEngineHealthy: (() -> Bool)? = nil,
        stopInputEngine: (() -> Void)? = nil,
        receiveInput: ((AVAudioPCMBuffer) -> Void)? = nil,
        authorizeMicrophone: (() -> AOSMicrophoneAuthorizationState)? = nil,
        authorizationState: @escaping () -> AOSMicrophoneAuthorizationState,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (UUID) -> Void
    ) throws {
        self.owner = owner
        self.ref = ref
        self.segmentDuration = segmentDuration
        self.readyCue = readyCue
        self.playReadyCue = playReadyCue
        self.startInputEngine = startInputEngine
        self.inputEngineHealthy = inputEngineHealthy
        self.stopInputEngine = stopInputEngine
        self.receiveInput = receiveInput
        self.authorizeMicrophone = authorizeMicrophone ?? authorizationState
        self.authorizationState = authorizationState
        self.emit = emit
        self.terminal = terminal
        self.writer = try AOSAtomicVoiceSegmentWriter(
            directoryPath: directoryPath,
            segmentDuration: segmentDuration,
            maximumDuration: maximumDuration
        )
        self.maximumDuration = writer.maximumDuration
    }

    func start() throws {
        guard !startupCanceled() else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        let authorization = authorizeMicrophone()
        if let failure = authorization.failure {
            let error = AOSVoiceTransportFailure(code: failure.code, message: failure.message)
            throw failStartup(error)
        }

        try beginEngineArming()
        do {
            try startCaptureEngine()
        } catch {
            let resolved = completeEngineArming(started: false, startupError: error)
                ?? AOSVoiceTransportFailure(
                    code: "MICROPHONE_UNAVAILABLE",
                    message: "microphone input is unavailable"
                )
            throw failStartup(resolved)
        }
        if let cancellation = completeEngineArming(started: true, startupError: nil) {
            throw failStartup(cancellation)
        }

        let admissionBoundary: UInt64
        do {
            admissionBoundary = try playReadyCue(readyCue) { [weak self] in
                self?.startupCanceled() ?? true
            }
        } catch let failure as AOSVoiceTransportFailure {
            throw failStartup(failure)
        } catch {
            let failure = AOSVoiceTransportFailure(
                code: "READY_CUE_UNAVAILABLE",
                message: "microphone ready cue failed"
            )
            throw failStartup(failure)
        }

        do {
            try admitCapture(afterHostTime: admissionBoundary)
        } catch let failure as AOSVoiceTransportFailure {
            throw failStartup(failure)
        } catch {
            let failure = AOSVoiceTransportFailure(
                code: "VOICE_TRANSPORT_FAILED",
                message: "microphone capture admission failed"
            )
            throw failStartup(failure)
        }
    }

    private func beginEngineArming() throws {
        finishLock.lock()
        guard !finishRequested, !finished else {
            finishLock.unlock()
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        engineArming = true
        finishLock.unlock()
    }

    private func completeEngineArming(
        started: Bool,
        startupError: Error?
    ) -> AOSVoiceTransportFailure? {
        finishLock.lock()
        engineArming = false
        if started { engineOwned = true }
        let cancellationWon = finishRequested
        let shouldScheduleFinish = cancellationWon && !finished
        finishLock.unlock()
        if shouldScheduleFinish { schedulePendingFinish() }
        if cancellationWon {
            return AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        if let failure = startupError as? AOSVoiceTransportFailure { return failure }
        if startupError != nil {
            return AOSVoiceTransportFailure(
                code: "MICROPHONE_UNAVAILABLE",
                message: "microphone input is unavailable"
            )
        }
        return nil
    }

    private func failStartup(_ failure: AOSVoiceTransportFailure) -> AOSVoiceTransportFailure {
        finishLock.lock()
        if finishRequested {
            finishLock.unlock()
            return AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        finishRequested = true
        pendingFinish = FinishRequest(
            keepSegments: false,
            event: "capture_segmented_failed",
            reason: "failure",
            failureCode: failure.code
        )
        let shouldSchedule = !engineArming
        finishLock.unlock()
        if shouldSchedule { schedulePendingFinish() }
        return failure
    }

    func finalize(reason: String) {
        requestFinish(
            keepSegments: true,
            event: "capture_segmented_completed",
            reason: reason,
            failureCode: nil,
            cancelBeforeAdmission: true
        )
    }

    func cancel(reason: String) {
        requestFinish(keepSegments: false, event: "capture_segmented_canceled", reason: reason, failureCode: nil)
    }

    private func receive(_ input: AVAudioPCMBuffer) {
        guard !finished else { return }
        guard authorizationState().isAuthorized else {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "MICROPHONE_PERMISSION_LOST"
            )
            return
        }
        if let metrics = aosAudioFrameMetrics(input) { lastMetrics = metrics }
        guard let converter else {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "CAPTURE_FORMAT_UNAVAILABLE"
            )
            return
        }
        let ratio = writer.outputFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount(max(1, ceil(Double(input.frameLength) * ratio) + 32))
        guard let output = AVAudioPCMBuffer(pcmFormat: writer.outputFormat, frameCapacity: capacity) else {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "CAPTURE_BUFFER_UNAVAILABLE"
            )
            return
        }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return input
        }
        guard conversionError == nil, status != .error else {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "CAPTURE_CONVERSION_FAILED"
            )
            return
        }
        guard output.frameLength > 0 else { return }
        do {
            emitReady(try writer.append(output))
        } catch let failure as AOSVoiceTransportFailure {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: failure.code
            )
            return
        } catch {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "CAPTURE_WRITE_FAILED"
            )
            return
        }
        if writer.reachedMaximumDuration {
            requestFinish(
                keepSegments: true,
                event: "capture_segmented_completed",
                reason: "max_duration",
                failureCode: nil
            )
        }
    }

    private func emitMeterOrStop() {
        guard !finished else { return }
        if let startedAt,
           aosVoiceCaptureDeadlineReached(startedAt: startedAt, maximumDuration: maximumDuration) {
            requestFinish(
                keepSegments: true,
                event: "capture_segmented_completed",
                reason: "max_duration",
                failureCode: nil
            )
            return
        }
        guard authorizationState().isAuthorized else {
            requestFinish(
                keepSegments: false,
                event: "capture_segmented_failed",
                reason: "failure",
                failureCode: "MICROPHONE_PERMISSION_LOST"
            )
            return
        }
        sequence += 1
        emit("audio_frame", [
            "stream": "capture",
            "rms": lastMetrics.rms,
            "peak": lastMetrics.peak,
            "sequence": sequence,
        ])
    }

    private func requestFinish(
        keepSegments: Bool,
        event: String,
        reason: String,
        failureCode: String?,
        cancelBeforeAdmission: Bool = false
    ) {
        finishLock.lock()
        guard !finishRequested else {
            finishLock.unlock()
            return
        }
        finishRequested = true
        let canceledBeforeAdmission = cancelBeforeAdmission && !captureAdmitted
        pendingFinish = FinishRequest(
            keepSegments: canceledBeforeAdmission ? false : keepSegments,
            event: canceledBeforeAdmission ? "capture_segmented_canceled" : event,
            reason: reason,
            failureCode: canceledBeforeAdmission ? nil : failureCode
        )
        let shouldSchedule = !engineArming
        finishLock.unlock()
        if shouldSchedule { schedulePendingFinish() }
    }

    private func schedulePendingFinish() {
        queue.async { [weak self] in self?.finishPending() }
    }

    private func startupCanceled() -> Bool {
        finishLock.lock()
        defer { finishLock.unlock() }
        return finishRequested || finished
    }

    private func admitCapture(afterHostTime boundary: UInt64) throws {
        guard !startupCanceled() else {
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        guard authorizationState().isAuthorized else {
            throw AOSVoiceTransportFailure(
                code: "MICROPHONE_PERMISSION_LOST",
                message: "microphone permission was lost before capture started"
            )
        }
        guard captureEngineIsHealthy() else {
            throw AOSVoiceTransportFailure(
                code: "MICROPHONE_UNAVAILABLE",
                message: "microphone input became unavailable before capture started"
            )
        }

        finishLock.lock()
        guard !finishRequested, !finished else {
            finishLock.unlock()
            throw AOSVoiceTransportFailure(
                code: "CAPTURE_CANCELED",
                message: "microphone capture was canceled before startup"
            )
        }
        let admissionCompleted = DispatchSemaphore(value: 0)
        var admissionFailure: AOSVoiceTransportFailure?
        queue.async { [self] in
            finishLock.lock()
            if finishRequested || finished {
                admissionFailure = AOSVoiceTransportFailure(
                    code: "CAPTURE_CANCELED",
                    message: "microphone capture was canceled before startup"
                )
                finishLock.unlock()
            } else if !inputGate.open(
                afterHostTime: boundary,
                requireCueExclusion: readyCue == .chime
            ) {
                admissionFailure = AOSVoiceTransportFailure(
                    code: "CAPTURE_CLOCK_UNAVAILABLE",
                    message: "microphone input timing is unavailable"
                )
                finishLock.unlock()
            } else {
                captureAdmitted = true
                finishLock.unlock()
                emitStartedAndBeginMetering()
            }
            admissionCompleted.signal()
        }
        finishLock.unlock()
        admissionCompleted.wait()
        if let admissionFailure { throw admissionFailure }
    }

    private func emitStartedAndBeginMetering() {
        startedAt = .now()
        emit("capture_segmented_started", [
            "sample_rate": Int(aosVoiceCaptureSampleRate),
            "channels": aosVoiceCaptureChannels,
            "max_duration_ms": Int(maximumDuration * 1000),
            "segment_duration_ms": Int(segmentDuration * 1000),
        ])
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.emitMeterOrStop() }
        timer.resume()
        meterTimer = timer
    }

    private func startCaptureEngine() throws {
        let handler: InputHandler = { [weak self] buffer, time in
            self?.enqueueInput(buffer, at: time)
        }
        if let startInputEngine {
            try startInputEngine(handler)
            return
        }
        var startupError: Error?
        aosRunOnMainSync {
            let input = engine.inputNode
            let inputFormat = input.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0,
                  inputFormat.sampleRate.isFinite,
                  inputFormat.sampleRate > 0,
                  let converter = AVAudioConverter(from: inputFormat, to: writer.outputFormat) else {
                startupError = AOSVoiceTransportFailure(
                    code: "MICROPHONE_UNAVAILABLE",
                    message: "microphone input is unavailable"
                )
                return
            }
            self.converter = converter
            input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat, block: handler)
            tapInstalled = true
            engine.prepare()
            do {
                try engine.start()
            } catch {
                if tapInstalled {
                    input.removeTap(onBus: 0)
                    tapInstalled = false
                }
                startupError = AOSVoiceTransportFailure(
                    code: "MICROPHONE_UNAVAILABLE",
                    message: "microphone input is unavailable"
                )
            }
        }
        if let startupError { throw startupError }
    }

    private func enqueueInput(_ input: AVAudioPCMBuffer, at time: AVAudioTime) {
        let timestamp = inputGate.observe(time)
        guard let copy = aosCopyPCMBuffer(input) else { return }
        queue.async { [weak self] in
            guard let self, self.inputGate.acceptsInput(timestamp) else { return }
            if let receiveInput = self.receiveInput {
                receiveInput(copy)
            } else {
                self.receive(copy)
            }
        }
    }

    private func captureEngineIsHealthy() -> Bool {
        if let inputEngineHealthy { return inputEngineHealthy() }
        var healthy = false
        aosRunOnMainSync {
            healthy = engine.isRunning
                && engine.inputNode.outputFormat(forBus: 0).channelCount > 0
        }
        return healthy
    }

    private func finishPending() {
        finishLock.lock()
        guard !finished, let request = pendingFinish else {
            finishLock.unlock()
            return
        }
        finished = true
        finishRequested = true
        pendingFinish = nil
        finishLock.unlock()
        meterTimer?.cancel()
        meterTimer = nil
        stopEngine()

        if !request.keepSegments {
            writer.cancel()
        } else {
            do {
                emitReady(try writer.finish())
            } catch let failure as AOSVoiceTransportFailure {
                writer.cancel()
                emit("capture_segmented_failed", ["code": failure.code])
                terminal(token)
                return
            } catch {
                writer.cancel()
                emit("capture_segmented_failed", ["code": "CAPTURE_WRITE_FAILED"])
                terminal(token)
                return
            }
        }

        if let failureCode = request.failureCode {
            emit(request.event, ["code": failureCode])
        } else if request.keepSegments {
            emit(request.event, [
                "reason": request.reason,
                "duration_ms": writer.durationMilliseconds,
                "bytes": writer.totalBytes,
                "segments": writer.completedSegmentCount,
            ])
        } else {
            emit(request.event, ["reason": request.reason])
        }
        terminal(token)
    }

    private func emitReady(_ segments: [AOSVoiceSegmentReady]) {
        for segment in segments {
            emit("capture_segment_ready", [
                "index": segment.index,
                "duration_ms": segment.durationMilliseconds,
                "bytes": segment.bytes,
            ])
        }
    }

    private func stopEngine() {
        inputGate.close()
        finishLock.lock()
        let shouldStop = engineOwned
        engineOwned = false
        finishLock.unlock()
        guard shouldStop else { return }
        if let stopInputEngine {
            stopInputEngine()
            return
        }
        aosRunOnMainSync {
            if tapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                tapInstalled = false
            }
            if engine.isRunning { engine.stop() }
        }
    }
}

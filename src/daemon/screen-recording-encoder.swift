import AVFoundation
import CryptoKit
import Darwin
import Foundation

struct AOSScreenRecordingEncoderProgress: Equatable {
    let frameCount: UInt64
    let byteCount: UInt64
}

protocol AOSScreenRecordingEncoding: AnyObject {
    var progress: AOSScreenRecordingEncoderProgress { get }
    func append(_ sampleBuffer: CMSampleBuffer) throws
    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void)
    func cancel()
}

final class AOSScreenRecordingEncoder: AOSScreenRecordingEncoding,
    @unchecked Sendable
{
    private let input: AVAssetWriterInput
    private let lock = NSLock()
    private let maximumOutputBytes: UInt64
    private let outputURL: URL
    private let rootURL: URL
    private var started = false
    private var finished = false
    private var frameCount: UInt64 = 0
    private var byteCount: UInt64 = 0
    private let writer: AVAssetWriter

    init(
        outputURL: URL,
        rootURL: URL,
        geometry: AOSScreenRecordingGeometry,
        maximumOutputBytes: UInt64
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
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: geometry.pixelWidth,
                AVVideoHeightKey: geometry.pixelHeight,
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        writer.add(input)
    }

    var progress: AOSScreenRecordingEncoderProgress {
        lock.lock()
        defer { lock.unlock() }
        return AOSScreenRecordingEncoderProgress(
            frameCount: frameCount,
            byteCount: byteCount
        )
    }

    func append(_ sampleBuffer: CMSampleBuffer) throws {
        guard CMSampleBufferIsValid(sampleBuffer),
              CMSampleBufferGetImageBuffer(sampleBuffer) != nil else {
            return
        }
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { throw AOSOperationCoreError.recordingEncoderFailed }
        if !started {
            guard writer.startWriting() else {
                throw AOSOperationCoreError.recordingEncoderFailed
            }
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            started = true
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData,
              input.append(sampleBuffer) else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        frameCount &+= 1
        byteCount = try Self.fileSize(outputURL)
        guard byteCount <= maximumOutputBytes else {
            throw AOSOperationCoreError.recordingBoundsExceeded
        }
    }

    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            completion(.failure(AOSOperationCoreError.recordingEncoderFailed))
            return
        }
        finished = true
        let hadStarted = started
        lock.unlock()
        guard hadStarted else {
            writer.cancelWriting()
            completion(.failure(AOSOperationCoreError.recordingEncoderFailed))
            return
        }
        input.markAsFinished()
        writer.finishWriting { [writer, outputURL, rootURL, maximumOutputBytes] in
            do {
                guard writer.status == .completed else {
                    throw AOSOperationCoreError.recordingEncoderFailed
                }
                completion(.success(try Self.validateArtifact(
                    outputURL,
                    rootURL: rootURL,
                    maximumOutputBytes: maximumOutputBytes
                )))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func cancel() {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        lock.unlock()
        input.markAsFinished()
        writer.cancelWriting()
    }

    static func validateArtifact(
        _ outputURL: URL,
        rootURL: URL,
        maximumOutputBytes: UInt64
    ) throws -> AOSArtifactFileIdentity {
        guard outputURL.deletingLastPathComponent().standardizedFileURL == rootURL.standardizedFileURL else {
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
            mediaType: "video/quicktime; codecs=avc1"
        )
    }

    static func fileSize(_ url: URL) throws -> UInt64 {
        var metadata = stat()
        guard lstat(url.path, &metadata) == 0,
              (metadata.st_mode & S_IFMT) == S_IFREG,
              metadata.st_size >= 0 else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        return UInt64(metadata.st_size)
    }

    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

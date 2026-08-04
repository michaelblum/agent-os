// image-file-compare.swift — Stateless canonical PNG file comparison

import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import ImageIO

private let imageCompareEncodedByteLimit: UInt64 = 128 * 1024 * 1024
private let imageComparePixelLimit: UInt64 = 33_554_432
private let imageCompareFloatScale = 1_000_000_000_000.0
private let imageComparePNGSignature = Data([137, 80, 78, 71, 13, 10, 26, 10])
private let imageCompareArtifactStagePrefix = ".aos-image-compare-"

private enum ImageCompareExpectation: String {
    case change
    case noChange = "no-change"
}

private struct ImageCompareOptions {
    let beforePath: String
    let afterPath: String
    let pixelTolerance: UInt8
    let expectation: ImageCompareExpectation?
    let changeMapPath: String?
    let maskPath: String?
}

private enum ImageCompareArtifactKind: Hashable {
    case changeMap
    case mask

    var encodingVersion: String {
        switch self {
        case .changeMap: return "aos.image-compare.change-map.gray8.v1"
        case .mask: return "aos.image-compare.mask.gray8.v1"
        }
    }

    var hashDomain: String {
        switch self {
        case .changeMap: return "AOS_IMAGE_COMPARE_CHANGE_MAP_U8_V1\0"
        case .mask: return "AOS_IMAGE_COMPARE_MASK_U8_V1\0"
        }
    }
}

private struct ImageCompareArtifactTarget {
    let kind: ImageCompareArtifactKind
    let path: String
    let parentPath: String
    let fileName: String
    let directoryDescriptor: Int32
    let parentDevice: dev_t
    let parentInode: ino_t
}

private struct ImageCompareArtifactPlane {
    let samples: Data
    let selectedPixels: UInt64
}

private struct ImageCompareComputation {
    let payload: [String: Any]
    let changeMap: ImageCompareArtifactPlane?
    let mask: ImageCompareArtifactPlane?
}

private struct ImageCompareMetrics {
    var changedPixels: UInt64 = 0
    var nonzeroDeltaPixels: UInt64 = 0
    var sumChannelDelta: UInt64 = 0
    var maxChannelDelta = 0
    var minimumX: Int
    var minimumY: Int
    var maximumX = -1
    var maximumY = -1
}

private struct ImageCompareStagedArtifact {
    let fileName: String
    let directoryDescriptor: Int32
    let device: dev_t
    let inode: ino_t
}

private struct ImageCompareArtifactPublication {
    let descriptors: [ImageCompareArtifactKind: [String: Any]]
    let published: [ImageCompareStagedArtifact]
}

private struct CanonicalImage {
    let path: String
    let width: Int
    let height: Int
    let pixels: Data
    let sha256: String
}

private struct ImageCompareFailure: Error {
    let code: String
    let message: String
}

func imageFileCompareCommand(args: [String]) -> Never {
    var artifactTargets: [ImageCompareArtifactTarget] = []
    do {
        let options = try parseImageCompareOptions(args)
        artifactTargets = try validateImageCompareArtifactTargets(options)
        let before = try decodeCanonicalPNG(path: options.beforePath, label: "before")
        let after = try decodeCanonicalPNG(path: options.afterPath, label: "after")

        guard before.width == after.width, before.height == after.height else {
            throw ImageCompareFailure(
                code: "IMAGE_GEOMETRY_MISMATCH",
                message: "Decoded image dimensions differ: before is \(before.width)x\(before.height), after is \(after.width)x\(after.height)."
            )
        }

        let computation = compareCanonicalImages(before: before, after: after, options: options)
        var result = computation.payload
        var artifactPublication: ImageCompareArtifactPublication?
        if !artifactTargets.isEmpty {
            let publication = try writeImageCompareArtifacts(
                targets: artifactTargets,
                computation: computation,
                width: before.width,
                height: before.height
            )
            artifactPublication = publication
            result["schema_version"] = "aos.image-compare.v2"
            result["artifacts"] = [
                "change_map": publication.descriptors[.changeMap] as Any? ?? NSNull(),
                "mask": publication.descriptors[.mask] as Any? ?? NSNull(),
            ]
        }
        if let expectation = result["expectation"] as? [String: Any], expectation["met"] as? Bool == false {
            var failure = result
            failure["status"] = "expectation_failed"
            failure["code"] = "IMAGE_COMPARISON_EXPECTATION_FAILED"
            failure["error"] = "Image comparison expectation was not met."
            if let publication = artifactPublication {
                do {
                    try verifyImageCompareArtifactPublication(targets: artifactTargets, published: publication.published)
                    try writeImageCompareJSONChecked(failure, to: .standardError)
                } catch let operationFailure as ImageCompareFailure {
                    failImageCompareArtifactOperation(
                        publication: publication,
                        targets: artifactTargets,
                        failure: operationFailure
                    )
                } catch {
                    failImageCompareArtifactOperation(
                        publication: publication,
                        targets: artifactTargets,
                        failure: ImageCompareFailure(
                            code: "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED",
                            message: "Could not write the required image comparison artifact receipt."
                        )
                    )
                }
            } else {
                closeImageCompareArtifactTargets(artifactTargets)
                writeImageCompareJSON(failure, to: .standardError)
            }
            closeImageCompareArtifactTargets(artifactTargets)
            exit(1)
        }

        if let publication = artifactPublication {
            do {
                try verifyImageCompareArtifactPublication(targets: artifactTargets, published: publication.published)
                try writeImageCompareJSONChecked(result, to: .standardOutput)
            } catch let operationFailure as ImageCompareFailure {
                failImageCompareArtifactOperation(
                    publication: publication,
                    targets: artifactTargets,
                    failure: operationFailure
                )
            } catch {
                failImageCompareArtifactOperation(
                    publication: publication,
                    targets: artifactTargets,
                    failure: ImageCompareFailure(
                        code: "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED",
                        message: "Could not write the required image comparison artifact receipt."
                    )
                )
            }
        } else {
            writeImageCompareJSON(result, to: .standardOutput)
        }
        closeImageCompareArtifactTargets(artifactTargets)
        exit(0)
    } catch let failure as ImageCompareFailure {
        closeImageCompareArtifactTargets(artifactTargets)
        writeImageCompareJSON(["code": failure.code, "error": failure.message], to: .standardError)
        exit(1)
    } catch {
        closeImageCompareArtifactTargets(artifactTargets)
        writeImageCompareJSON(
            ["code": "IMAGE_DECODE_FAILED", "error": "Image comparison failed: \(error.localizedDescription)"],
            to: .standardError
        )
        exit(1)
    }
}

private func parseImageCompareOptions(_ args: [String]) throws -> ImageCompareOptions {
    var paths: [String] = []
    var tolerance: UInt8 = 0
    var toleranceSeen = false
    var expectation: ImageCompareExpectation?
    var expectationSeen = false
    var changeMapPath: String?
    var changeMapSeen = false
    var maskPath: String?
    var maskSeen = false
    var index = 0

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--pixel-tolerance":
            guard !toleranceSeen else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--pixel-tolerance may be provided only once.")
            }
            guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw ImageCompareFailure(code: "MISSING_ARG", message: "--pixel-tolerance requires an integer from 0 through 255.")
            }
            guard let value = UInt16(args[index + 1]), value <= 255 else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--pixel-tolerance must be an integer from 0 through 255.")
            }
            tolerance = UInt8(value)
            toleranceSeen = true
            index += 2
        case "--expect":
            guard !expectationSeen else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--expect may be provided only once.")
            }
            guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw ImageCompareFailure(code: "MISSING_ARG", message: "--expect requires change or no-change.")
            }
            guard let value = ImageCompareExpectation(rawValue: args[index + 1]) else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--expect must be change or no-change.")
            }
            expectation = value
            expectationSeen = true
            index += 2
        case "--change-map-out":
            guard !changeMapSeen else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--change-map-out may be provided only once.")
            }
            guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw ImageCompareFailure(code: "MISSING_ARG", message: "--change-map-out requires a new .png output path.")
            }
            changeMapPath = args[index + 1]
            changeMapSeen = true
            index += 2
        case "--mask-out":
            guard !maskSeen else {
                throw ImageCompareFailure(code: "INVALID_ARG", message: "--mask-out may be provided only once.")
            }
            guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw ImageCompareFailure(code: "MISSING_ARG", message: "--mask-out requires a new .png output path.")
            }
            maskPath = args[index + 1]
            maskSeen = true
            index += 2
        default:
            if arg.hasPrefix("-") {
                throw ImageCompareFailure(code: "UNKNOWN_OPTION", message: "Unknown image comparison option: \(arg).")
            }
            paths.append(arg)
            index += 1
        }
    }

    guard paths.count >= 1 else {
        throw ImageCompareFailure(code: "MISSING_ARG", message: "aos see compare requires <before.png> and <after.png>.")
    }
    guard paths.count >= 2 else {
        throw ImageCompareFailure(code: "MISSING_ARG", message: "aos see compare requires <after.png>.")
    }
    guard paths.count == 2 else {
        throw ImageCompareFailure(code: "INVALID_ARG", message: "aos see compare accepts exactly two image paths.")
    }

    return ImageCompareOptions(
        beforePath: paths[0],
        afterPath: paths[1],
        pixelTolerance: tolerance,
        expectation: expectation,
        changeMapPath: changeMapPath,
        maskPath: maskPath
    )
}

private func standardizedImageComparePath(_ rawPath: String) -> String {
    let expanded = NSString(string: rawPath).expandingTildeInPath
    let absolute: String
    if NSString(string: expanded).isAbsolutePath {
        absolute = expanded
    } else {
        absolute = (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent(expanded)
    }
    return NSString(string: absolute).standardizingPath
}

private func standardizedImageCompareArtifactPath(_ rawPath: String) -> String {
    let expanded = NSString(string: rawPath).expandingTildeInPath
    let absolute = NSString(string: expanded).isAbsolutePath
        ? expanded
        : (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent(expanded)
    var components: [Substring] = []
    for component in absolute.split(separator: "/", omittingEmptySubsequences: true) {
        if component == "." { continue }
        if component == ".." {
            if !components.isEmpty { components.removeLast() }
            continue
        }
        components.append(component)
    }
    return "/" + components.joined(separator: "/")
}

private func validateImageCompareArtifactTargets(_ options: ImageCompareOptions) throws -> [ImageCompareArtifactTarget] {
    let requested: [(ImageCompareArtifactKind, String?)] = [
        (.changeMap, options.changeMapPath),
        (.mask, options.maskPath),
    ]
    var targets: [ImageCompareArtifactTarget] = []

    do {
        for (kind, rawPath) in requested {
            guard let rawPath else { continue }
            guard rawPath != "-",
                  !rawPath.contains("\0"),
                  !rawPath.hasSuffix("/"),
                  NSString(string: rawPath).pathExtension == "png" else {
                throw ImageCompareFailure(
                    code: "IMAGE_ARTIFACT_PATH_INVALID",
                    message: "Image comparison artifact output must be a .png path and may not be '-': \(rawPath)."
                )
            }
            let path = standardizedImageCompareArtifactPath(rawPath)
            let fileName = NSString(string: path).lastPathComponent
            guard path != "/", fileName.hasSuffix(".png") else {
                throw ImageCompareFailure(code: "IMAGE_ARTIFACT_PATH_INVALID", message: "Invalid image comparison artifact output path: \(path).")
            }
            if targets.contains(where: { $0.path == path }) {
                throw ImageCompareFailure(
                    code: "IMAGE_ARTIFACT_PATH_INVALID",
                    message: "Image comparison artifact output paths must be distinct after standardization: \(path)."
                )
            }

            let parentPath = NSString(string: path).deletingLastPathComponent
            let directoryDescriptor = try openImageCompareArtifactParent(parentPath, targetPath: path)
            var parentStatus = stat()
            guard Darwin.fstat(directoryDescriptor, &parentStatus) == 0,
                  parentStatus.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) else {
                Darwin.close(directoryDescriptor)
                throw ImageCompareFailure(
                    code: "IMAGE_ARTIFACT_PARENT_INVALID",
                    message: "Could not identify image comparison artifact parent: \(parentPath)."
                )
            }
            var existing = stat()
            if Darwin.fstatat(directoryDescriptor, fileName, &existing, AT_SYMLINK_NOFOLLOW) == 0 {
                Darwin.close(directoryDescriptor)
                throw ImageCompareFailure(
                    code: "IMAGE_ARTIFACT_TARGET_EXISTS",
                    message: "Image comparison artifact target already exists and will not be overwritten: \(path)."
                )
            }
            guard errno == ENOENT else {
                Darwin.close(directoryDescriptor)
                throw ImageCompareFailure(
                    code: "IMAGE_ARTIFACT_PATH_INVALID",
                    message: "Could not validate image comparison artifact target: \(path)."
                )
            }
            targets.append(ImageCompareArtifactTarget(
                kind: kind,
                path: path,
                parentPath: parentPath,
                fileName: fileName,
                directoryDescriptor: directoryDescriptor,
                parentDevice: parentStatus.st_dev,
                parentInode: parentStatus.st_ino
            ))
        }
        return targets
    } catch {
        closeImageCompareArtifactTargets(targets)
        throw error
    }
}

private func openImageCompareArtifactParent(_ parentPath: String, targetPath: String) throws -> Int32 {
    guard NSString(string: parentPath).isAbsolutePath else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_PATH_INVALID", message: "Artifact parent path is not absolute: \(parentPath).")
    }

    var descriptor = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_PARENT_INVALID", message: "Could not open the filesystem root for artifact output.")
    }
    for component in NSString(string: parentPath).pathComponents where component != "/" {
        let nextDescriptor = Darwin.openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        Darwin.close(descriptor)
        guard nextDescriptor >= 0 else {
            throw ImageCompareFailure(
                code: "IMAGE_ARTIFACT_PARENT_INVALID",
                message: "Image comparison artifact parent must exist with no symlink or non-directory components: \(targetPath)."
            )
        }
        descriptor = nextDescriptor
    }
    return descriptor
}

private func revalidateImageCompareArtifactParent(_ target: ImageCompareArtifactTarget) throws {
    var pinnedStatus = stat()
    guard Darwin.fstat(target.directoryDescriptor, &pinnedStatus) == 0,
          pinnedStatus.st_dev == target.parentDevice,
          pinnedStatus.st_ino == target.parentInode else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_PARENT_CHANGED",
            message: "Pinned image comparison artifact parent identity changed: \(target.parentPath)."
        )
    }

    let currentDescriptor: Int32
    do {
        currentDescriptor = try openImageCompareArtifactParent(target.parentPath, targetPath: target.path)
    } catch {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_PARENT_CHANGED",
            message: "Image comparison artifact parent path changed before publication: \(target.parentPath)."
        )
    }
    defer { Darwin.close(currentDescriptor) }

    var currentStatus = stat()
    guard Darwin.fstat(currentDescriptor, &currentStatus) == 0,
          currentStatus.st_dev == target.parentDevice,
          currentStatus.st_ino == target.parentInode else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_PARENT_CHANGED",
            message: "Image comparison artifact parent path changed before publication: \(target.parentPath)."
        )
    }
}

private func closeImageCompareArtifactTargets(_ targets: [ImageCompareArtifactTarget]) {
    for target in targets {
        Darwin.close(target.directoryDescriptor)
    }
}

private func readBoundedImageData(path: String) throws -> Data {
    let descriptor = Darwin.open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
    guard descriptor >= 0 else {
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }

    var status = stat()
    guard Darwin.fstat(descriptor, &status) == 0 else {
        Darwin.close(descriptor)
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }
    guard status.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), status.st_size >= 0 else {
        Darwin.close(descriptor)
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }

    let encodedSize = UInt64(status.st_size)
    guard encodedSize <= imageCompareEncodedByteLimit else {
        Darwin.close(descriptor)
        throw ImageCompareFailure(code: "IMAGE_TOO_LARGE", message: "Encoded image exceeds the 128 MiB input limit: \(path).")
    }

    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? handle.close() }

    var data = Data()
    data.reserveCapacity(Int(encodedSize))
    do {
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            let nextSize = UInt64(data.count) + UInt64(chunk.count)
            guard nextSize <= imageCompareEncodedByteLimit else {
                throw ImageCompareFailure(code: "IMAGE_TOO_LARGE", message: "Encoded image exceeds the 128 MiB input limit: \(path).")
            }
            data.append(chunk)
        }
    } catch let failure as ImageCompareFailure {
        throw failure
    } catch {
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }
    return data
}

private func decodeCanonicalPNG(path rawPath: String, label: String) throws -> CanonicalImage {
    let path = standardizedImageComparePath(rawPath)
    let data = try readBoundedImageData(path: path)

    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        if data.starts(with: imageComparePNGSignature) {
            throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not decode PNG image: \(path).")
        }
        throw ImageCompareFailure(code: "UNSUPPORTED_IMAGE_FORMAT", message: "\(label.capitalized) image must be a PNG file: \(path).")
    }
    guard CGImageSourceGetType(source) as String? == "public.png" else {
        throw ImageCompareFailure(code: "UNSUPPORTED_IMAGE_FORMAT", message: "\(label.capitalized) image must be a PNG file: \(path).")
    }
    if pngContainsAnimationControl(data) {
        throw ImageCompareFailure(code: "UNSUPPORTED_IMAGE_FORMAT", message: "Animated or multi-frame PNG input is not supported: \(path).")
    }
    guard CGImageSourceGetCount(source) > 0 else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not decode PNG image: \(path).")
    }
    guard CGImageSourceGetCount(source) == 1 else {
        throw ImageCompareFailure(code: "UNSUPPORTED_IMAGE_FORMAT", message: "Animated or multi-frame PNG input is not supported: \(path).")
    }
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not read PNG image properties: \(path).")
    }

    let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
    guard orientation == 1 else {
        throw ImageCompareFailure(code: "UNSUPPORTED_IMAGE_ORIENTATION", message: "PNG orientation must be upright (1): \(path).")
    }

    guard let width = positiveImageDimension(properties[kCGImagePropertyPixelWidth]),
          let height = positiveImageDimension(properties[kCGImagePropertyPixelHeight]) else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "PNG dimensions are missing or invalid: \(path).")
    }
    let (pixelCount, pixelOverflow) = UInt64(width).multipliedReportingOverflow(by: UInt64(height))
    guard !pixelOverflow, pixelCount <= imageComparePixelLimit else {
        throw ImageCompareFailure(code: "IMAGE_TOO_LARGE", message: "Decoded image exceeds the 33,554,432 pixel input limit: \(path).")
    }
    let (bytesPerRow64, rowOverflow) = UInt64(width).multipliedReportingOverflow(by: 4)
    let (byteCount64, byteOverflow) = bytesPerRow64.multipliedReportingOverflow(by: UInt64(height))
    guard !rowOverflow, !byteOverflow, bytesPerRow64 <= UInt64(Int.max), byteCount64 <= UInt64(Int.max) else {
        throw ImageCompareFailure(code: "IMAGE_TOO_LARGE", message: "Decoded image byte geometry is too large: \(path).")
    }

    let imageOptions = [kCGImageSourceShouldCacheImmediately: true] as CFDictionary
    guard let sourceImage = CGImageSourceCreateImageAtIndex(source, 0, imageOptions),
          sourceImage.width == width,
          sourceImage.height == height else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not decode PNG pixels: \(path).")
    }
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not create the canonical sRGB color space.")
    }

    let bytesPerRow = Int(bytesPerRow64)
    var pixels = Data(count: Int(byteCount64))
    let drewImage = pixels.withUnsafeMutableBytes { rawBuffer -> Bool in
        guard let baseAddress = rawBuffer.baseAddress,
              let context = CGContext(
                data: baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
              ) else {
            return false
        }
        context.interpolationQuality = .none
        context.setBlendMode(.copy)
        context.draw(sourceImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard drewImage else {
        throw ImageCompareFailure(code: "IMAGE_DECODE_FAILED", message: "Could not canonicalize PNG pixels: \(path).")
    }

    return CanonicalImage(
        path: path,
        width: width,
        height: height,
        pixels: pixels,
        sha256: canonicalImageSHA256(width: UInt64(width), height: UInt64(height), pixels: pixels)
    )
}

private func pngContainsAnimationControl(_ data: Data) -> Bool {
    var offset = imageComparePNGSignature.count
    while offset <= data.count - 12 {
        let length = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let payloadStart = offset + 8
        let (payloadEnd, overflow) = payloadStart.addingReportingOverflow(Int(length))
        guard !overflow, payloadEnd <= data.count - 4 else { return false }
        let type = data[(offset + 4)..<(offset + 8)]
        if type.elementsEqual([97, 99, 84, 76]) { return true }
        if type.elementsEqual([73, 69, 78, 68]) { return false }
        offset = payloadEnd + 4
    }
    return false
}

private func positiveImageDimension(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber else { return nil }
    let dimension = number.int64Value
    guard dimension > 0, dimension <= Int64(Int.max) else { return nil }
    return Int(dimension)
}

private func canonicalImageSHA256(width: UInt64, height: UInt64, pixels: Data) -> String {
    var hasher = SHA256()
    hasher.update(data: Data("AOS_RGBA8_V1\0".utf8))
    var widthBE = width.bigEndian
    var heightBE = height.bigEndian
    withUnsafeBytes(of: &widthBE) { hasher.update(data: Data($0)) }
    withUnsafeBytes(of: &heightBE) { hasher.update(data: Data($0)) }
    hasher.update(data: pixels)
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

private func compareCanonicalImages(
    before: CanonicalImage,
    after: CanonicalImage,
    options: ImageCompareOptions
) -> ImageCompareComputation {
    let totalPixels = UInt64(before.width) * UInt64(before.height)
    let tolerance = Int(options.pixelTolerance)
    let canonicalByteCount = Int(totalPixels) * 4
    precondition(
        before.pixels.count == canonicalByteCount && after.pixels.count == canonicalByteCount,
        "Canonical image buffers must contain exactly width * height * 4 bytes."
    )

    var changeMapSamples = options.changeMapPath.map { _ in Data(count: Int(totalPixels)) }
    var maskSamples = options.maskPath.map { _ in Data(count: Int(totalPixels)) }
    let metrics: ImageCompareMetrics
    if changeMapSamples != nil, maskSamples != nil {
        metrics = changeMapSamples!.withUnsafeMutableBytes { changeMapBuffer in
            maskSamples!.withUnsafeMutableBytes { maskBuffer in
                scanCanonicalImageDelta(
                    before: before,
                    after: after,
                    tolerance: tolerance,
                    changeMapBytes: changeMapBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    maskBytes: maskBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self)
                )
            }
        }
    } else if changeMapSamples != nil {
        metrics = changeMapSamples!.withUnsafeMutableBytes { changeMapBuffer in
            scanCanonicalImageDelta(
                before: before,
                after: after,
                tolerance: tolerance,
                changeMapBytes: changeMapBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self),
                maskBytes: nil
            )
        }
    } else if maskSamples != nil {
        metrics = maskSamples!.withUnsafeMutableBytes { maskBuffer in
            scanCanonicalImageDelta(
                before: before,
                after: after,
                tolerance: tolerance,
                changeMapBytes: nil,
                maskBytes: maskBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self)
            )
        }
    } else {
        metrics = scanCanonicalImageDelta(
            before: before,
            after: after,
            tolerance: tolerance,
            changeMapBytes: nil,
            maskBytes: nil
        )
    }

    let actual = metrics.changedPixels > 0 ? ImageCompareExpectation.change : ImageCompareExpectation.noChange
    let bounds: Any = metrics.changedPixels == 0
        ? NSNull()
        : [
            "x": metrics.minimumX,
            "y": metrics.minimumY,
            "width": metrics.maximumX - metrics.minimumX + 1,
            "height": metrics.maximumY - metrics.minimumY + 1,
        ]
    let expectationPayload: Any = options.expectation.map { requested in
        [
            "requested": requested.rawValue,
            "actual": actual.rawValue,
            "met": requested == actual,
        ] as [String: Any]
    } ?? NSNull()

    let payload: [String: Any] = [
        "status": "success",
        "schema_version": "aos.image-compare.v1",
        "before": imageCompareDescription(before),
        "after": imageCompareDescription(after),
        "comparison": [
            "pixel_tolerance": Int(options.pixelTolerance),
            "total_pixels": totalPixels,
            "changed_pixels": metrics.changedPixels,
            "changed_ratio": roundedImageCompareFloat(Double(metrics.changedPixels) / Double(totalPixels)),
            "changed_bounds": bounds,
            "sum_channel_delta": metrics.sumChannelDelta,
            "mean_channel_delta": roundedImageCompareFloat(Double(metrics.sumChannelDelta) / (4.0 * Double(totalPixels))),
            "max_channel_delta": metrics.maxChannelDelta,
        ],
        "expectation": expectationPayload,
    ]

    return ImageCompareComputation(
        payload: payload,
        changeMap: changeMapSamples.map {
            ImageCompareArtifactPlane(samples: $0, selectedPixels: metrics.nonzeroDeltaPixels)
        },
        mask: maskSamples.map {
            ImageCompareArtifactPlane(samples: $0, selectedPixels: metrics.changedPixels)
        }
    )
}

private func scanCanonicalImageDelta(
    before: CanonicalImage,
    after: CanonicalImage,
    tolerance: Int,
    changeMapBytes: UnsafeMutablePointer<UInt8>?,
    maskBytes: UnsafeMutablePointer<UInt8>?
) -> ImageCompareMetrics {
    let canonicalByteCount = before.width * before.height * 4
    var metrics = ImageCompareMetrics(minimumX: before.width, minimumY: before.height)

    before.pixels.withUnsafeBytes { beforeBytes in
        after.pixels.withUnsafeBytes { afterBytes in
            let lhs = beforeBytes.baseAddress!.assumingMemoryBound(to: UInt8.self)
            let rhs = afterBytes.baseAddress!.assumingMemoryBound(to: UInt8.self)
            guard Darwin.memcmp(lhs, rhs, canonicalByteCount) != 0 else { return }

            let bytesPerRow = before.width * 4
            var y = 0
            while y < before.height {
                let lhsRow = lhs.advanced(by: y * bytesPerRow)
                let rhsRow = rhs.advanced(by: y * bytesPerRow)
                if Darwin.memcmp(lhsRow, rhsRow, bytesPerRow) != 0 {
                    var rowMinimumX = before.width
                    var rowMaximumX = -1
                    var x = 0
                    var byteOffset = 0
                    while x < before.width {
                        let redDelta = abs(Int(lhsRow[byteOffset]) - Int(rhsRow[byteOffset]))
                        let greenDelta = abs(Int(lhsRow[byteOffset + 1]) - Int(rhsRow[byteOffset + 1]))
                        let blueDelta = abs(Int(lhsRow[byteOffset + 2]) - Int(rhsRow[byteOffset + 2]))
                        let alphaDelta = abs(Int(lhsRow[byteOffset + 3]) - Int(rhsRow[byteOffset + 3]))
                        let pixelMaximumDelta = max(max(redDelta, greenDelta), max(blueDelta, alphaDelta))
                        let planeIndex = y * before.width + x
                        changeMapBytes?[planeIndex] = UInt8(pixelMaximumDelta)
                        maskBytes?[planeIndex] = pixelMaximumDelta > tolerance ? 255 : 0
                        metrics.sumChannelDelta += UInt64(redDelta + greenDelta + blueDelta + alphaDelta)
                        metrics.maxChannelDelta = max(metrics.maxChannelDelta, pixelMaximumDelta)
                        if pixelMaximumDelta > 0 {
                            metrics.nonzeroDeltaPixels += 1
                        }
                        if pixelMaximumDelta > tolerance {
                            metrics.changedPixels += 1
                            rowMinimumX = min(rowMinimumX, x)
                            rowMaximumX = x
                        }
                        x += 1
                        byteOffset += 4
                    }
                    if rowMaximumX >= 0 {
                        metrics.minimumX = min(metrics.minimumX, rowMinimumX)
                        metrics.minimumY = min(metrics.minimumY, y)
                        metrics.maximumX = max(metrics.maximumX, rowMaximumX)
                        metrics.maximumY = y
                    }
                }
                y += 1
            }
        }
    }

    return metrics
}

private func writeImageCompareArtifacts(
    targets: [ImageCompareArtifactTarget],
    computation: ImageCompareComputation,
    width: Int,
    height: Int
) throws -> ImageCompareArtifactPublication {
    var staged: [ImageCompareStagedArtifact] = []
    var published: [ImageCompareStagedArtifact] = []
    var descriptors: [ImageCompareArtifactKind: [String: Any]] = [:]

    do {
        for target in targets {
            let plane: ImageCompareArtifactPlane
            switch target.kind {
            case .changeMap:
                guard let changeMap = computation.changeMap else {
                    throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Change-map sample plane was not produced.")
                }
                plane = changeMap
            case .mask:
                guard let mask = computation.mask else {
                    throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Mask sample plane was not produced.")
                }
                plane = mask
            }

            let pngData = try encodeImageCompareGrayscalePNG(samples: plane.samples, width: width, height: height)
            let stage = try stageImageCompareArtifact(pngData, target: target)
            staged.append(stage)
            try revalidateImageCompareArtifactParent(target)

            guard Darwin.renameatx_np(
                stage.directoryDescriptor,
                stage.fileName,
                target.directoryDescriptor,
                target.fileName,
                UInt32(RENAME_EXCL)
            ) == 0 else {
                throw ImageCompareFailure(
                    code: errno == EEXIST ? "IMAGE_ARTIFACT_TARGET_EXISTS" : "IMAGE_ARTIFACT_WRITE_FAILED",
                    message: "Could not publish image comparison artifact without overwriting: \(target.path)."
                )
            }
            let publishedArtifact = ImageCompareStagedArtifact(
                fileName: target.fileName,
                directoryDescriptor: target.directoryDescriptor,
                device: stage.device,
                inode: stage.inode
            )
            published.append(publishedArtifact)
            try verifyPublishedImageCompareArtifact(target: target, artifact: publishedArtifact)
            try fsyncImageCompareDirectory(target)
            try revalidateImageCompareArtifactParent(target)
            try verifyPublishedImageCompareArtifact(target: target, artifact: publishedArtifact)

            descriptors[target.kind] = [
                "path": target.path,
                "width": width,
                "height": height,
                "encoding_version": target.kind.encodingVersion,
                "canonical_sample_sha256": canonicalImageCompareSampleSHA256(
                    kind: target.kind,
                    width: UInt64(width),
                    height: UInt64(height),
                    samples: plane.samples
                ),
                "png_file_sha256": sha256Hex(pngData),
                "selected_pixels": plane.selectedPixels,
            ]
        }
        try verifyImageCompareArtifactPublication(targets: targets, published: published)
        return ImageCompareArtifactPublication(descriptors: descriptors, published: published)
    } catch {
        do {
            try cleanupImageCompareArtifacts(staged: staged, published: published)
        } catch let cleanupFailure as ImageCompareFailure {
            throw cleanupFailure
        }
        throw error
    }
}

private func verifyImageCompareArtifactPublication(
    targets: [ImageCompareArtifactTarget],
    published: [ImageCompareStagedArtifact]
) throws {
    guard targets.count == published.count else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_WRITE_FAILED",
            message: "Image comparison artifact publication was incomplete."
        )
    }
    for (target, artifact) in zip(targets, published) {
        try revalidateImageCompareArtifactParent(target)
        try verifyPublishedImageCompareArtifact(target: target, artifact: artifact)
    }
}

private func verifyPublishedImageCompareArtifact(
    target: ImageCompareArtifactTarget,
    artifact: ImageCompareStagedArtifact
) throws {
    var status = stat()
    guard Darwin.fstatat(target.directoryDescriptor, target.fileName, &status, AT_SYMLINK_NOFOLLOW) == 0,
          status.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          status.st_dev == artifact.device,
          status.st_ino == artifact.inode else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_WRITE_FAILED",
            message: "Published image comparison artifact identity could not be verified: \(target.path)."
        )
    }
}

private func encodeImageCompareGrayscalePNG(samples: Data, width: Int, height: Int) throws -> Data {
    guard samples.count == width * height,
          let provider = CGDataProvider(data: samples as CFData),
          let image = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
          ) else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not create an 8-bit grayscale artifact image.")
    }

    let encoded = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(encoded, "public.png" as CFString, 1, nil) else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not create the PNG artifact encoder.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not encode the PNG artifact.")
    }
    return encoded as Data
}

private func stageImageCompareArtifact(
    _ data: Data,
    target: ImageCompareArtifactTarget
) throws -> ImageCompareStagedArtifact {
    var stageName: String?
    var descriptor: Int32 = -1
    var stagedArtifact: ImageCompareStagedArtifact?
    for _ in 0..<16 {
        let candidate = "\(imageCompareArtifactStagePrefix)\(UUID().uuidString).stage"
        descriptor = Darwin.openat(
            target.directoryDescriptor,
            candidate,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        if descriptor >= 0 {
            stageName = candidate
            break
        }
        if errno != EEXIST { break }
    }
    guard descriptor >= 0, let stageName else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not create a private artifact stage in: \(target.parentPath).")
    }
    do {
        var status = stat()
        guard Darwin.fstat(descriptor, &status) == 0 else {
            throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not identify the staged PNG artifact.")
        }
        stagedArtifact = ImageCompareStagedArtifact(
            fileName: stageName,
            directoryDescriptor: target.directoryDescriptor,
            device: status.st_dev,
            inode: status.st_ino
        )
        guard Darwin.fchmod(descriptor, mode_t(0o600)) == 0 else {
            throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not secure artifact staging permissions.")
        }
        try data.withUnsafeBytes { buffer in
            guard let baseAddress = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(descriptor, baseAddress.advanced(by: offset), buffer.count - offset)
                if written > 0 {
                    offset += written
                } else if written < 0, errno == EINTR {
                    continue
                } else {
                    throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not write the staged PNG artifact.")
                }
            }
        }
        guard Darwin.fsync(descriptor) == 0 else {
            throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not fsync the staged PNG artifact.")
        }
        guard Darwin.close(descriptor) == 0 else {
            descriptor = -1
            throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not close the staged PNG artifact.")
        }
        descriptor = -1
        guard let stagedArtifact else {
            throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Staged PNG artifact identity was lost.")
        }
        return stagedArtifact
    } catch {
        if descriptor >= 0 { Darwin.close(descriptor) }
        do {
            if let stagedArtifact {
                try cleanupImageCompareArtifacts(staged: [stagedArtifact], published: [])
            } else {
                try cleanupUnidentifiedImageCompareStage(
                    fileName: stageName,
                    directoryDescriptor: target.directoryDescriptor
                )
            }
        } catch let cleanupFailure as ImageCompareFailure {
            throw cleanupFailure
        }
        throw error
    }
}

private func fsyncImageCompareDirectory(_ target: ImageCompareArtifactTarget) throws {
    guard Darwin.fsync(target.directoryDescriptor) == 0 else {
        throw ImageCompareFailure(code: "IMAGE_ARTIFACT_WRITE_FAILED", message: "Could not fsync artifact parent: \(target.parentPath).")
    }
}

private func cleanupImageCompareArtifacts(
    staged: [ImageCompareStagedArtifact],
    published: [ImageCompareStagedArtifact]
) throws {
    var failures: [String] = []
    for artifact in Array(staged.reversed()) + Array(published.reversed()) {
        do {
            try unlinkImageCompareArtifactIfOwned(artifact)
        } catch let failure as ImageCompareFailure {
            failures.append(failure.message)
        } catch {
            failures.append("Unexpected rollback failure for \(artifact.fileName).")
        }
    }
    guard failures.isEmpty else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Image comparison artifact cleanup failed: \(failures.joined(separator: " "))"
        )
    }
}

private func unlinkImageCompareArtifactIfOwned(_ artifact: ImageCompareStagedArtifact) throws {
    var status = stat()
    guard Darwin.fstatat(artifact.directoryDescriptor, artifact.fileName, &status, AT_SYMLINK_NOFOLLOW) == 0 else {
        if errno == ENOENT { return }
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Could not inspect owned artifact during rollback: \(artifact.fileName)."
        )
    }
    guard status.st_dev == artifact.device, status.st_ino == artifact.inode else {
        return
    }
    guard Darwin.unlinkat(artifact.directoryDescriptor, artifact.fileName, 0) == 0 else {
        if errno == ENOENT { return }
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Could not remove owned artifact during rollback: \(artifact.fileName)."
        )
    }
    guard Darwin.fsync(artifact.directoryDescriptor) == 0 else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Could not fsync artifact parent after rollback: \(artifact.fileName)."
        )
    }
}

private func cleanupUnidentifiedImageCompareStage(
    fileName: String,
    directoryDescriptor: Int32
) throws {
    guard Darwin.unlinkat(directoryDescriptor, fileName, 0) == 0 else {
        if errno == ENOENT { return }
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Could not remove unidentified private artifact stage: \(fileName)."
        )
    }
    guard Darwin.fsync(directoryDescriptor) == 0 else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Could not fsync artifact parent after private-stage rollback: \(fileName)."
        )
    }
}

private func canonicalImageCompareSampleSHA256(
    kind: ImageCompareArtifactKind,
    width: UInt64,
    height: UInt64,
    samples: Data
) -> String {
    var hasher = SHA256()
    hasher.update(data: Data(kind.hashDomain.utf8))
    var widthBE = width.bigEndian
    var heightBE = height.bigEndian
    withUnsafeBytes(of: &widthBE) { hasher.update(data: Data($0)) }
    withUnsafeBytes(of: &heightBE) { hasher.update(data: Data($0)) }
    hasher.update(data: samples)
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func imageCompareDescription(_ image: CanonicalImage) -> [String: Any] {
    [
        "path": image.path,
        "width": image.width,
        "height": image.height,
        "canonical_pixel_sha256": image.sha256,
    ]
}

private func roundedImageCompareFloat(_ value: Double) -> Double {
    (value * imageCompareFloatScale).rounded() / imageCompareFloatScale
}

private func failImageCompareArtifactOperation(
    publication: ImageCompareArtifactPublication,
    targets: [ImageCompareArtifactTarget],
    failure: ImageCompareFailure
) -> Never {
    var reportedFailure = failure
    do {
        try cleanupImageCompareArtifacts(staged: [], published: publication.published)
    } catch let cleanupFailure as ImageCompareFailure {
        reportedFailure = cleanupFailure
    } catch {
        reportedFailure = ImageCompareFailure(
            code: "IMAGE_ARTIFACT_CLEANUP_FAILED",
            message: "Image comparison artifact cleanup failed after artifact finalization."
        )
    }
    closeImageCompareArtifactTargets(targets)
    writeImageCompareJSON(
        ["code": reportedFailure.code, "error": reportedFailure.message],
        to: .standardError
    )
    exit(1)
}

private func writeImageCompareJSONChecked(_ payload: [String: Any], to handle: FileHandle) throws {
    guard JSONSerialization.isValidJSONObject(payload) else {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED",
            message: "Could not serialize the required image comparison artifact receipt."
        )
    }
    do {
        var data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        data.append(Data("\n".utf8))
        try handle.write(contentsOf: data)
    } catch {
        throw ImageCompareFailure(
            code: "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED",
            message: "Could not write the required image comparison artifact receipt."
        )
    }
}

private func writeImageCompareJSON(_ payload: [String: Any], to handle: FileHandle) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
        let fallback = Data("{\"code\":\"IMAGE_DECODE_FAILED\",\"error\":\"Could not serialize image comparison result.\"}\n".utf8)
        try? handle.write(contentsOf: fallback)
        return
    }
    try? handle.write(contentsOf: data)
    try? handle.write(contentsOf: Data("\n".utf8))
}

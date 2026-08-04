// image-file-compare.swift — Stateless canonical PNG file comparison

import CoreGraphics
import CryptoKit
import Foundation
import ImageIO

private let imageCompareEncodedByteLimit: UInt64 = 128 * 1024 * 1024
private let imageComparePixelLimit: UInt64 = 33_554_432
private let imageCompareFloatScale = 1_000_000_000_000.0
private let imageComparePNGSignature = Data([137, 80, 78, 71, 13, 10, 26, 10])

private enum ImageCompareExpectation: String {
    case change
    case noChange = "no-change"
}

private struct ImageCompareOptions {
    let beforePath: String
    let afterPath: String
    let pixelTolerance: UInt8
    let expectation: ImageCompareExpectation?
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
    do {
        let options = try parseImageCompareOptions(args)
        let before = try decodeCanonicalPNG(path: options.beforePath, label: "before")
        let after = try decodeCanonicalPNG(path: options.afterPath, label: "after")

        guard before.width == after.width, before.height == after.height else {
            throw ImageCompareFailure(
                code: "IMAGE_GEOMETRY_MISMATCH",
                message: "Decoded image dimensions differ: before is \(before.width)x\(before.height), after is \(after.width)x\(after.height)."
            )
        }

        let result = compareCanonicalImages(before: before, after: after, options: options)
        if let expectation = result["expectation"] as? [String: Any], expectation["met"] as? Bool == false {
            var failure = result
            failure["status"] = "expectation_failed"
            failure["code"] = "IMAGE_COMPARISON_EXPECTATION_FAILED"
            failure["error"] = "Image comparison expectation was not met."
            writeImageCompareJSON(failure, to: .standardError)
            exit(1)
        }

        writeImageCompareJSON(result, to: .standardOutput)
        exit(0)
    } catch let failure as ImageCompareFailure {
        writeImageCompareJSON(["code": failure.code, "error": failure.message], to: .standardError)
        exit(1)
    } catch {
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
        expectation: expectation
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

private func readBoundedImageData(path: String) throws -> Data {
    let url = URL(fileURLWithPath: path)
    let attributes: [FileAttributeKey: Any]
    do {
        attributes = try FileManager.default.attributesOfItem(atPath: path)
    } catch {
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }

    if let size = attributes[.size] as? NSNumber, size.uint64Value > imageCompareEncodedByteLimit {
        throw ImageCompareFailure(code: "IMAGE_TOO_LARGE", message: "Encoded image exceeds the 128 MiB input limit: \(path).")
    }

    let handle: FileHandle
    do {
        handle = try FileHandle(forReadingFrom: url)
    } catch {
        throw ImageCompareFailure(code: "IMAGE_READ_FAILED", message: "Could not read image file: \(path).")
    }
    defer { try? handle.close() }

    var data = Data()
    if let size = attributes[.size] as? NSNumber, size.uint64Value <= UInt64(Int.max) {
        data.reserveCapacity(Int(size.uint64Value))
    }
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
) -> [String: Any] {
    let totalPixels = UInt64(before.width) * UInt64(before.height)
    let tolerance = Int(options.pixelTolerance)
    var changedPixels: UInt64 = 0
    var sumChannelDelta: UInt64 = 0
    var maxChannelDelta = 0
    var minimumX = before.width
    var minimumY = before.height
    var maximumX = -1
    var maximumY = -1

    before.pixels.withUnsafeBytes { beforeBytes in
        after.pixels.withUnsafeBytes { afterBytes in
            let lhs = beforeBytes.bindMemory(to: UInt8.self)
            let rhs = afterBytes.bindMemory(to: UInt8.self)
            for pixelIndex in 0..<Int(totalPixels) {
                let byteIndex = pixelIndex * 4
                var pixelChanged = false
                for channel in 0..<4 {
                    let delta = abs(Int(lhs[byteIndex + channel]) - Int(rhs[byteIndex + channel]))
                    sumChannelDelta += UInt64(delta)
                    maxChannelDelta = max(maxChannelDelta, delta)
                    if delta > tolerance { pixelChanged = true }
                }
                if pixelChanged {
                    changedPixels += 1
                    let x = pixelIndex % before.width
                    let y = pixelIndex / before.width
                    minimumX = min(minimumX, x)
                    minimumY = min(minimumY, y)
                    maximumX = max(maximumX, x)
                    maximumY = max(maximumY, y)
                }
            }
        }
    }

    let actual = changedPixels > 0 ? ImageCompareExpectation.change : ImageCompareExpectation.noChange
    let bounds: Any = changedPixels == 0
        ? NSNull()
        : [
            "x": minimumX,
            "y": minimumY,
            "width": maximumX - minimumX + 1,
            "height": maximumY - minimumY + 1,
        ]
    let expectationPayload: Any = options.expectation.map { requested in
        [
            "requested": requested.rawValue,
            "actual": actual.rawValue,
            "met": requested == actual,
        ] as [String: Any]
    } ?? NSNull()

    return [
        "status": "success",
        "schema_version": "aos.image-compare.v1",
        "before": imageCompareDescription(before),
        "after": imageCompareDescription(after),
        "comparison": [
            "pixel_tolerance": Int(options.pixelTolerance),
            "total_pixels": totalPixels,
            "changed_pixels": changedPixels,
            "changed_ratio": roundedImageCompareFloat(Double(changedPixels) / Double(totalPixels)),
            "changed_bounds": bounds,
            "sum_channel_delta": sumChannelDelta,
            "mean_channel_delta": roundedImageCompareFloat(Double(sumChannelDelta) / (4.0 * Double(totalPixels))),
            "max_channel_delta": maxChannelDelta,
        ],
        "expectation": expectationPayload,
    ]
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

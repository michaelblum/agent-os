import AppKit
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO

private let targetIdentifier = "aos-exact-target-control"
private let siblingIdentifier = "aos-exact-sibling-control"

private enum ProofFailure: Error {
    case invalidArguments
    case fixtureUnavailable
    case imageInvalid
    case pixelMismatch
}

private struct FixtureBounds: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

private struct FixtureMetadata: Codable {
    let schema: String
    let pid: Int
    let target_window_id: Int
    let sibling_window_id: Int
    let target_bounds: FixtureBounds
    let sibling_bounds: FixtureBounds
    let display_id: Int
    let scale_factor: Double
    let target_identifier: String
    let sibling_identifier: String
    let ownership_token: String
    let same_process_windows: Bool
    let layer_zero_windows: Bool
    let sibling_above_target: Bool
    let target_center_occluded: Bool
    let overlap_fraction: Double
}

private struct FixtureCleanup: Codable {
    let target_window_removed: Bool
    let sibling_window_removed: Bool
    let fixture_windows_removed: Bool
}

private struct PixelAnalysis: Codable {
    let status: String
    let width: Int
    let height: Int
    let magenta_fraction: Double
    let green_fraction: Double
    let target_color_fraction: Double
    let cyan_fraction: Double
    let opaque_fraction: Double
    let left_magenta_fraction: Double
    let right_green_fraction: Double
    let decoded_rgba_sha256: String
    let exact_window_pixels_verified: Bool
}

private struct ClassifierSelfTest: Codable {
    let classifier_self_test: Bool
    let status: String
}

private final class SplitTargetView: NSView {
    override var isOpaque: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let left = NSRect(x: bounds.minX, y: bounds.minY, width: bounds.width / 2, height: bounds.height)
        let right = NSRect(x: left.maxX, y: bounds.minY, width: bounds.width - left.width, height: bounds.height)
        NSColor(srgbRed: 0.88, green: 0.06, blue: 0.82, alpha: 1).setFill()
        left.fill()
        NSColor(srgbRed: 0.05, green: 0.76, blue: 0.10, alpha: 1).setFill()
        right.fill()
    }
}

private final class SolidSiblingView: NSView {
    override var isOpaque: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(srgbRed: 0.04, green: 0.76, blue: 0.86, alpha: 1).setFill()
        bounds.fill()
    }
}

@MainActor
private final class FixtureController: NSObject {
    private let metadataURL: URL
    private let closeRequestURL: URL
    private let closeAckURL: URL
    private let stopRequestURL: URL
    private let cleanupURL: URL
    private let ownershipToken: String
    private var timer: Timer?
    private var targetClosed = false
    private var stopStarted = false
    private var readinessAttempts = 0
    private var targetWindowID = 0
    private var siblingWindowID = 0

    private let targetWindow: NSWindow
    private let siblingWindow: NSWindow

    init(
        metadataURL: URL,
        closeRequestURL: URL,
        closeAckURL: URL,
        stopRequestURL: URL,
        cleanupURL: URL,
        ownershipToken: String
    ) throws {
        self.metadataURL = metadataURL
        self.closeRequestURL = closeRequestURL
        self.closeAckURL = closeAckURL
        self.stopRequestURL = stopRequestURL
        self.cleanupURL = cleanupURL
        self.ownershipToken = ownershipToken

        guard let screen = NSScreen.main, screen.visibleFrame.width >= 760, screen.visibleFrame.height >= 560 else {
            throw ProofFailure.fixtureUnavailable
        }

        let targetContent = NSRect(x: 0, y: 0, width: 480, height: 320)
        targetWindow = NSWindow(
            contentRect: targetContent,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false,
            screen: screen
        )
        targetWindow.title = "AOS Exact Target Window"
        targetWindow.isReleasedWhenClosed = false
        targetWindow.level = .normal
        targetWindow.collectionBehavior = [.canJoinAllSpaces]
        targetWindow.backgroundColor = .black
        targetWindow.sharingType = .readOnly
        let targetView = SplitTargetView(frame: targetContent)
        let targetControl = NSButton(title: "Exact Target", target: nil, action: nil)
        targetControl.setAccessibilityIdentifier(targetIdentifier)
        targetControl.setAccessibilityChildren([])
        targetControl.frame = NSRect(x: 165, y: 135, width: 150, height: 42)
        targetView.addSubview(targetControl)
        targetWindow.contentView = targetView

        let siblingContent = NSRect(x: 0, y: 0, width: 340, height: 250)
        siblingWindow = NSWindow(
            contentRect: siblingContent,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false,
            screen: screen
        )
        siblingWindow.title = "AOS Exact Sibling Window"
        siblingWindow.isReleasedWhenClosed = false
        siblingWindow.level = .normal
        siblingWindow.collectionBehavior = [.canJoinAllSpaces]
        siblingWindow.backgroundColor = .black
        siblingWindow.sharingType = .readOnly
        let siblingView = SolidSiblingView(frame: siblingContent)
        let siblingControl = NSButton(title: "Exact Sibling", target: nil, action: nil)
        siblingControl.setAccessibilityIdentifier(siblingIdentifier)
        siblingControl.frame = NSRect(x: 95, y: 100, width: 150, height: 42)
        siblingView.addSubview(siblingControl)
        siblingWindow.contentView = siblingView

        let targetFrame = targetWindow.frame
        let targetOrigin = NSPoint(
            x: floor(screen.visibleFrame.midX - targetFrame.width / 2),
            y: floor(screen.visibleFrame.midY - targetFrame.height / 2)
        )
        targetWindow.setFrameOrigin(targetOrigin)
        let siblingFrame = siblingWindow.frame
        siblingWindow.setFrameOrigin(NSPoint(
            x: floor(targetWindow.frame.midX - siblingFrame.width / 2),
            y: floor(targetWindow.frame.midY - siblingFrame.height / 2)
        ))

        super.init()
    }

    func start() {
        targetWindow.orderFront(nil)
        siblingWindow.orderFront(nil)
        targetWindow.order(.below, relativeTo: siblingWindow.windowNumber)
        targetWindowID = targetWindow.windowNumber
        siblingWindowID = siblingWindow.windowNumber
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.tick()
            }
        }
    }

    private func tick() {
        if !FileManager.default.fileExists(atPath: metadataURL.path) {
            readinessAttempts += 1
            if let metadata = currentMetadata() {
                writeJSON(metadata, to: metadataURL)
            } else if readinessAttempts > 80 {
                writeJSON(["error_code": "FIXTURE_UNAVAILABLE", "status": "failed"], to: metadataURL)
            }
        }

        if !targetClosed, FileManager.default.fileExists(atPath: closeRequestURL.path) {
            targetClosed = true
            targetWindow.orderOut(nil)
            targetWindow.close()
            waitForWindowRemoval(windowID: targetWindowID, attemptsRemaining: 40) { [weak self] removed in
                guard let self else { return }
                self.writeJSON(
                    ["target_window_removed": removed, "status": removed ? "ok" : "failed"],
                    to: self.closeAckURL
                )
            }
        }

        if !stopStarted, FileManager.default.fileExists(atPath: stopRequestURL.path) {
            stopStarted = true
            targetWindow.orderOut(nil)
            targetWindow.close()
            siblingWindow.orderOut(nil)
            siblingWindow.close()
            waitForFixtureRemoval(attemptsRemaining: 40)
        }
    }

    private func currentMetadata() -> FixtureMetadata? {
        let entries = onScreenWindowEntries()
        guard targetWindowID > 0,
              siblingWindowID > 0,
              let targetIndex = entries.firstIndex(where: { windowID($0) == targetWindowID }),
              let siblingIndex = entries.firstIndex(where: { windowID($0) == siblingWindowID }),
              let targetBounds = windowBounds(entries[targetIndex]),
              let siblingBounds = windowBounds(entries[siblingIndex]),
              windowPID(entries[targetIndex]) == Int(getpid()),
              windowPID(entries[siblingIndex]) == Int(getpid()),
              windowLayer(entries[targetIndex]) == 0,
              windowLayer(entries[siblingIndex]) == 0 else {
            return nil
        }

        let overlap = targetBounds.intersection(siblingBounds)
        let overlapFraction = overlap.isNull ? 0 : (overlap.width * overlap.height) / (targetBounds.width * targetBounds.height)
        guard siblingIndex < targetIndex,
              overlapFraction >= 0.35,
              siblingBounds.contains(CGPoint(x: targetBounds.midX, y: targetBounds.midY)),
              let display = soleContainingDisplay(for: targetBounds) else {
            return nil
        }

        return FixtureMetadata(
            schema: "aos.exact-focus-channel-native-fixture.v1",
            pid: Int(getpid()),
            target_window_id: targetWindowID,
            sibling_window_id: siblingWindowID,
            target_bounds: fixtureBounds(targetBounds),
            sibling_bounds: fixtureBounds(siblingBounds),
            display_id: Int(display),
            scale_factor: targetWindow.backingScaleFactor,
            target_identifier: targetIdentifier,
            sibling_identifier: siblingIdentifier,
            ownership_token: ownershipToken,
            same_process_windows: true,
            layer_zero_windows: true,
            sibling_above_target: true,
            target_center_occluded: true,
            overlap_fraction: overlapFraction
        )
    }

    private func waitForWindowRemoval(windowID: Int, attemptsRemaining: Int, completion: @escaping (Bool) -> Void) {
        if !onScreenWindowEntries().contains(where: { self.windowID($0) == windowID }) {
            completion(true)
            return
        }
        guard attemptsRemaining > 0 else {
            completion(false)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.waitForWindowRemoval(
                windowID: windowID,
                attemptsRemaining: attemptsRemaining - 1,
                completion: completion
            )
        }
    }

    private func waitForFixtureRemoval(attemptsRemaining: Int) {
        let entries = onScreenWindowEntries()
        let targetRemoved = !entries.contains(where: { windowID($0) == targetWindowID })
        let siblingRemoved = !entries.contains(where: { windowID($0) == siblingWindowID })
        if (targetRemoved && siblingRemoved) || attemptsRemaining <= 0 {
            writeJSON(
                FixtureCleanup(
                    target_window_removed: targetRemoved,
                    sibling_window_removed: siblingRemoved,
                    fixture_windows_removed: targetRemoved && siblingRemoved
                ),
                to: cleanupURL
            )
            timer?.invalidate()
            timer = nil
            NSApp.terminate(nil)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.waitForFixtureRemoval(attemptsRemaining: attemptsRemaining - 1)
        }
    }

    private func onScreenWindowEntries() -> [[String: Any]] {
        CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    }

    private func windowID(_ entry: [String: Any]) -> Int? {
        (entry[kCGWindowNumber as String] as? NSNumber)?.intValue
    }

    private func windowPID(_ entry: [String: Any]) -> Int? {
        (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue
    }

    private func windowLayer(_ entry: [String: Any]) -> Int? {
        (entry[kCGWindowLayer as String] as? NSNumber)?.intValue
    }

    private func windowBounds(_ entry: [String: Any]) -> CGRect? {
        guard let raw = entry[kCGWindowBounds as String] as? NSDictionary else { return nil }
        return CGRect(dictionaryRepresentation: raw)?.integral
    }

    private func soleContainingDisplay(for bounds: CGRect) -> CGDirectDisplayID? {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return nil }
        let matches = displays.prefix(Int(count)).filter {
            CGDisplayMirrorsDisplay($0) == kCGNullDirectDisplay && CGDisplayBounds($0).contains(bounds)
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private func fixtureBounds(_ bounds: CGRect) -> FixtureBounds {
        FixtureBounds(
            x: Int(bounds.origin.x),
            y: Int(bounds.origin.y),
            width: Int(bounds.width),
            height: Int(bounds.height)
        )
    }

    private func writeJSON<T: Encodable>(_ value: T, to url: URL) {
        guard let data = try? JSONEncoder.sorted.encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func writeJSON(_ value: [String: Any], to url: URL) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

private extension JSONEncoder {
    static var sorted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

private func analyzePNG(at url: URL) throws -> PixelAnalysis {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width >= 100,
          image.height >= 100 else {
        throw ProofFailure.imageInvalid
    }

    let width = image.width
    let height = image.height
    let bytesPerRow = width * 4
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
    let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
        guard let base = bytes.baseAddress,
              let context = CGContext(
                data: base,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
              ) else { return false }
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard rendered else { throw ProofFailure.imageInvalid }

    return try analyzeRGBA(pixels, width: width, height: height)
}

private func analyzeRGBA(_ pixels: [UInt8], width: Int, height: Int) throws -> PixelAnalysis {
    guard width >= 100,
          height >= 100,
          pixels.count == width * height * 4 else {
        throw ProofFailure.imageInvalid
    }

    var magenta = 0
    var green = 0
    var cyan = 0
    var opaque = 0
    var leftMagenta = 0
    var leftSampled = 0
    var rightGreen = 0
    var rightSampled = 0
    for index in stride(from: 0, to: pixels.count, by: 4) {
        let pixelIndex = index / 4
        let x = pixelIndex % width
        let y = pixelIndex / width
        let red = pixels[index]
        let greenValue = pixels[index + 1]
        let blue = pixels[index + 2]
        let alpha = pixels[index + 3]
        if alpha >= 250 { opaque += 1 }
        if red >= 170, blue >= 150, greenValue <= 125 { magenta += 1 }
        if greenValue >= 145, red <= 130, blue <= 135 { green += 1 }
        if greenValue >= 145, blue >= 145, red <= 130 { cyan += 1 }
        if x >= width / 10, x < width * 3 / 10,
           y >= height / 4, y < height * 3 / 4 {
            leftSampled += 1
            if red >= 170, blue >= 150, greenValue <= 125, alpha >= 250 {
                leftMagenta += 1
            }
        }
        if x >= width * 7 / 10, x < width * 9 / 10,
           y >= height / 4, y < height * 3 / 4 {
            rightSampled += 1
            if greenValue >= 145, red <= 130, blue <= 135, alpha >= 250 {
                rightGreen += 1
            }
        }
    }
    guard leftSampled > 0, rightSampled > 0 else { throw ProofFailure.imageInvalid }
    let denominator = Double(width * height)
    let magentaFraction = Double(magenta) / denominator
    let greenFraction = Double(green) / denominator
    let cyanFraction = Double(cyan) / denominator
    let opaqueFraction = Double(opaque) / denominator
    let leftMagentaFraction = Double(leftMagenta) / Double(leftSampled)
    let rightGreenFraction = Double(rightGreen) / Double(rightSampled)
    let targetFraction = magentaFraction + greenFraction
    let verified = opaqueFraction >= 0.995
        && magentaFraction >= 0.30
        && greenFraction >= 0.30
        && targetFraction >= 0.72
        && cyanFraction <= 0.02
        && leftMagentaFraction >= 0.90
        && rightGreenFraction >= 0.90
    guard verified else { throw ProofFailure.pixelMismatch }
    let decodedDigest = SHA256.hash(data: Data(pixels))
        .map { String(format: "%02x", $0) }
        .joined()

    return PixelAnalysis(
        status: "passed",
        width: width,
        height: height,
        magenta_fraction: magentaFraction,
        green_fraction: greenFraction,
        target_color_fraction: targetFraction,
        cyan_fraction: cyanFraction,
        opaque_fraction: opaqueFraction,
        left_magenta_fraction: leftMagentaFraction,
        right_green_fraction: rightGreenFraction,
        decoded_rgba_sha256: decodedDigest,
        exact_window_pixels_verified: true
    )
}

private func writeSelfTestPNG(
    at url: URL,
    width: Int = 160,
    height: Int = 120,
    pixel: (Int, Int) -> (UInt8, UInt8, UInt8, UInt8)
) throws {
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    for y in 0..<height {
        for x in 0..<width {
            let (red, green, blue, alpha) = pixel(x, y)
            let offset = (y * width + x) * 4
            bytes[offset] = red
            bytes[offset + 1] = green
            bytes[offset + 2] = blue
            bytes[offset + 3] = alpha
        }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData),
          let image = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo.byteOrder32Big.union(
                CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
            ),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
          ),
          let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.png" as CFString,
            1,
            nil
          ) else {
        throw ProofFailure.imageInvalid
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw ProofFailure.imageInvalid
    }
}

private func analyzerSelfTest() throws -> ClassifierSelfTest {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("aos-exact-focus-analyzer-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let passing = directory.appendingPathComponent("passing.png")
    try writeSelfTestPNG(at: passing) { x, _ in
        x < 80 ? (224, 15, 209, 255) : (13, 194, 26, 255)
    }
    guard try analyzePNG(at: passing).exact_window_pixels_verified else {
        throw ProofFailure.pixelMismatch
    }

    let cyan = directory.appendingPathComponent("cyan.png")
    try writeSelfTestPNG(at: cyan) { _, _ in (10, 194, 219, 255) }
    var cyanRejected = false
    do {
        _ = try analyzePNG(at: cyan)
    } catch ProofFailure.pixelMismatch {
        cyanRejected = true
    }
    guard cyanRejected else { throw ProofFailure.pixelMismatch }

    let reversed = directory.appendingPathComponent("reversed.png")
    try writeSelfTestPNG(at: reversed) { x, _ in
        x < 80 ? (13, 194, 26, 255) : (224, 15, 209, 255)
    }
    var reversedRejected = false
    do {
        _ = try analyzePNG(at: reversed)
    } catch ProofFailure.pixelMismatch {
        reversedRejected = true
    }
    guard reversedRejected else { throw ProofFailure.pixelMismatch }

    let transparent = directory.appendingPathComponent("transparent.png")
    try writeSelfTestPNG(at: transparent) { x, _ in
        x < 80 ? (224, 15, 209, 80) : (13, 194, 26, 80)
    }
    var transparentRejected = false
    do {
        _ = try analyzePNG(at: transparent)
    } catch ProofFailure.pixelMismatch {
        transparentRejected = true
    }
    guard transparentRejected else { throw ProofFailure.pixelMismatch }

    let insufficient = directory.appendingPathComponent("insufficient.png")
    try writeSelfTestPNG(at: insufficient) { _, _ in (20, 20, 20, 255) }
    var insufficientRejected = false
    do {
        _ = try analyzePNG(at: insufficient)
    } catch ProofFailure.pixelMismatch {
        insufficientRejected = true
    }
    guard insufficientRejected else { throw ProofFailure.pixelMismatch }

    return ClassifierSelfTest(classifier_self_test: true, status: "passed")
}

private func value(after flag: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
    return args[index + 1]
}

private func emit<T: Encodable>(_ value: T) {
    guard let data = try? JSONEncoder.sorted.encode(value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

@main
private enum ExactFocusChannelNativeProof {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        do {
            if args.first == "--fixture" {
                guard let metadata = value(after: "--metadata", in: args),
                      let closeRequest = value(after: "--close-request", in: args),
                      let closeAck = value(after: "--close-ack", in: args),
                      let stopRequest = value(after: "--stop-request", in: args),
                      let cleanup = value(after: "--cleanup-report", in: args),
                      let ownershipToken = value(after: "--ownership-token", in: args),
                      !ownershipToken.isEmpty else {
                    throw ProofFailure.invalidArguments
                }
                let app = NSApplication.shared
                app.setActivationPolicy(.accessory)
                let controller = try FixtureController(
                    metadataURL: URL(fileURLWithPath: metadata),
                    closeRequestURL: URL(fileURLWithPath: closeRequest),
                    closeAckURL: URL(fileURLWithPath: closeAck),
                    stopRequestURL: URL(fileURLWithPath: stopRequest),
                    cleanupURL: URL(fileURLWithPath: cleanup),
                    ownershipToken: ownershipToken
                )
                controller.start()
                withExtendedLifetime(controller) {
                    app.run()
                }
                return
            }

            if args.first == "--analyze-png",
               let path = value(after: "--path", in: args) {
                emit(try analyzePNG(at: URL(fileURLWithPath: path)))
                return
            }

            if args.first == "--analyzer-self-test" {
                emit(try analyzerSelfTest())
                return
            }

            throw ProofFailure.invalidArguments
        } catch ProofFailure.invalidArguments {
            emit(["error_code": "INVALID_ARGUMENTS", "status": "failed"])
            exit(2)
        } catch ProofFailure.fixtureUnavailable {
            emit(["error_code": "FIXTURE_UNAVAILABLE", "status": "failed"])
            exit(1)
        } catch ProofFailure.imageInvalid {
            emit(["error_code": "IMAGE_INVALID", "status": "failed"])
            exit(1)
        } catch ProofFailure.pixelMismatch {
            emit(["error_code": "PIXEL_FIDELITY_MISMATCH", "status": "failed"])
            exit(1)
        } catch {
            emit(["error_code": "PROOF_HELPER_FAILED", "status": "failed"])
            exit(1)
        }
    }
}

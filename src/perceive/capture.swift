// capture.swift — aos see capture: one-shot screenshot capture
//
// Delegates to the side-eye binary for the full capture pipeline (ScreenCaptureKit,
// crop, overlays, xray, encode, output). This avoids duplicating ~1500 lines of
// mature capture code and keeps the pipeline in one authoritative location.
//
// Resolution order for side-eye binary:
//   1. Adjacent to aos binary (same directory)
//   2. packages/side-eye/side-eye relative to aos binary's parent
//   3. In PATH

import Foundation

/// Known capture targets that can be used as bare subcommands (aos see main, etc.)
let captureTargets: Set<String> = ["main", "center", "middle", "external", "user_active", "all", "selfie", "mouse"]

/// Resolve the real directory containing the aos executable.
/// Uses _NSGetExecutablePath to get the true path even when invoked via PATH or symlink.
private func executableDir() -> String {
    var pathBuf = [CChar](repeating: 0, count: 4096)
    var size = UInt32(pathBuf.count)
    if _NSGetExecutablePath(&pathBuf, &size) == 0 {
        let raw = String(cString: pathBuf)
        // Resolve symlinks to get the canonical location
        let resolved = (raw as NSString).resolvingSymlinksInPath
        return (resolved as NSString).deletingLastPathComponent
    }
    // Fallback: use argv[0] as-is
    return (CommandLine.arguments[0] as NSString).deletingLastPathComponent
}

/// Locate the side-eye binary.
private func findSideEye() -> String? {
    let selfDir = executableDir()

    // 1. Adjacent to aos binary
    let adjacent = (selfDir as NSString).appendingPathComponent("side-eye")
    if FileManager.default.isExecutableFile(atPath: adjacent) { return adjacent }

    // 2. packages/side-eye/side-eye relative to binary's parent (repo root layout)
    let repoRelative = (selfDir as NSString).appendingPathComponent("packages/side-eye/side-eye")
    if FileManager.default.isExecutableFile(atPath: repoRelative) { return repoRelative }

    // 3. In PATH via /usr/bin/which
    let which = Process()
    which.executableURL = URL(fileURLWithPath: "/usr/bin/which")
    which.arguments = ["side-eye"]
    let pipe = Pipe()
    which.standardOutput = pipe
    which.standardError = FileHandle.nullDevice
    do { try which.run() } catch { return nil }
    which.waitUntilExit()
    guard which.terminationStatus == 0 else { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return (path?.isEmpty == false) ? path : nil
}

/// aos see capture [target] [options...] — delegates to side-eye for the full capture pipeline.
///
/// Supports all side-eye capture targets (main, external, user_active, selfie, mouse, all)
/// and all capture options (--window, --xray, --crop, --grid, --base64, --out, etc.).
/// Zone names also work as targets if configured in side-eye.
func seeCaptureCommand(args: [String]) {
    guard let sideEyePath = findSideEye() else {
        exitError(
            "side-eye binary not found. Build it with: cd packages/side-eye && bash build.sh",
            code: "MISSING_DEPENDENCY"
        )
    }

    // Determine whether args already start with "capture" or a known target/options.
    // side-eye accepts both `side-eye capture main` and `side-eye main`.
    // We always prepend "capture" for clarity unless it's already there.
    let sideEyeArgs: [String]
    if args.first == "capture" {
        sideEyeArgs = args
    } else {
        sideEyeArgs = ["capture"] + args
    }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: sideEyePath)
    proc.arguments = sideEyeArgs
    proc.standardOutput = FileHandle.standardOutput
    proc.standardError = FileHandle.standardError

    do { try proc.run() } catch {
        exitError("Failed to launch side-eye: \(error.localizedDescription)", code: "EXEC_FAILED")
    }
    proc.waitUntilExit()
    exit(proc.terminationStatus)
}

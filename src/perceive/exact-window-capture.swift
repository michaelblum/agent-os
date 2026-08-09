import CoreGraphics
import Foundation

struct AOSExactChannelCaptureSurface {
    let kind: String
    let windowID: Int?
    let ownerPID: Int?
}

struct AOSExactChannelCaptureWindow {
    let windowID: Int
    let ownerPID: Int?
    let layer: Int
    let frame: CGRect
}

struct AOSExactChannelCaptureDisplay {
    let displayID: UInt32
    let bounds: CGRect
    let scaleFactor: Double
    let mirrored: Bool
}

struct AOSExactChannelCapturePlan: Equatable {
    let displayID: UInt32
    let windowID: Int
    let ownerPID: Int
    let globalBounds: CGRect
    let captureScaleFactor: Double
}

enum AOSExactChannelCapturePlanError: Error, Equatable {
    case missingIdentity
    case windowNotFound
    case ambiguousWindow
    case ownerMismatch
    case invalidWindowBounds
    case displayNotFound
    case ambiguousDisplay
    case invalidDisplayScale
}

func aosExactChannelCapturePlan(
    surface: AOSExactChannelCaptureSurface,
    windows: [AOSExactChannelCaptureWindow],
    displays: [AOSExactChannelCaptureDisplay]
) throws -> AOSExactChannelCapturePlan? {
    guard surface.kind == "channel" else { return nil }
    guard let windowID = surface.windowID,
          windowID > 0,
          let ownerPID = surface.ownerPID,
          ownerPID > 0 else {
        throw AOSExactChannelCapturePlanError.missingIdentity
    }

    let matches = windows.filter { $0.windowID == windowID }
    guard !matches.isEmpty else {
        throw AOSExactChannelCapturePlanError.windowNotFound
    }
    guard matches.count == 1 else {
        throw AOSExactChannelCapturePlanError.ambiguousWindow
    }
    let window = matches[0]
    guard window.ownerPID == ownerPID else {
        throw AOSExactChannelCapturePlanError.ownerMismatch
    }
    guard window.layer == 0 else {
        throw AOSExactChannelCapturePlanError.invalidWindowBounds
    }

    let bounds = window.frame.integral
    guard bounds.origin.x.isFinite,
          bounds.origin.y.isFinite,
          bounds.width.isFinite,
          bounds.height.isFinite,
          bounds.width >= 10,
          bounds.height >= 10 else {
        throw AOSExactChannelCapturePlanError.invalidWindowBounds
    }

    let displayMatches = displays.filter {
        !$0.mirrored && $0.bounds.contains(bounds)
    }
    guard !displayMatches.isEmpty else {
        throw AOSExactChannelCapturePlanError.displayNotFound
    }
    guard displayMatches.count == 1 else {
        throw AOSExactChannelCapturePlanError.ambiguousDisplay
    }
    let display = displayMatches[0]
    guard display.scaleFactor.isFinite, display.scaleFactor > 0 else {
        throw AOSExactChannelCapturePlanError.invalidDisplayScale
    }

    return AOSExactChannelCapturePlan(
        displayID: display.displayID,
        windowID: windowID,
        ownerPID: ownerPID,
        globalBounds: bounds,
        captureScaleFactor: display.scaleFactor
    )
}

import CoreMedia
import ScreenCaptureKit

func aosDesktopPixelPresentationTimeIsNumeric(_ presentationTime: CMTime) -> Bool {
    let nonNumericFlags: CMTimeFlags = [
        .positiveInfinity,
        .negativeInfinity,
        .indefinite,
    ]
    return presentationTime.flags.contains(.valid)
        && presentationTime.flags.intersection(nonNumericFlags).isEmpty
        && presentationTime.timescale > 0
}

struct AOSDesktopPixelFrameAdvancement {
    static let requiredDistinctFrames: UInt64 = 2

    private(set) var distinctFrameCount: UInt64 = 0
    private var lastPresentationTime: CMTime?

    mutating func observe(presentationTime: CMTime) -> Bool {
        guard aosDesktopPixelPresentationTimeIsNumeric(presentationTime) else {
            return false
        }
        if let lastPresentationTime,
           CMTimeCompare(presentationTime, lastPresentationTime) <= 0 {
            return false
        }
        lastPresentationTime = presentationTime
        if distinctFrameCount < Self.requiredDistinctFrames {
            distinctFrameCount += 1
        }
        return true
    }

    var isReady: Bool {
        distinctFrameCount >= Self.requiredDistinctFrames
    }
}

enum AOSDesktopPixelSampleAdmission: Equatable {
    case frame
    case heartbeat
}

func aosDesktopPixelSampleAdmission(
    statusRawValue: Int?,
    presentationTime: CMTime,
    hasImageBuffer: Bool
) -> AOSDesktopPixelSampleAdmission? {
    guard let statusRawValue,
          let status = SCFrameStatus(rawValue: statusRawValue),
          aosDesktopPixelPresentationTimeIsNumeric(presentationTime) else {
        return nil
    }

    switch status {
    case .complete, .started:
        return hasImageBuffer ? .frame : nil
    case .idle:
        return .heartbeat
    case .blank, .suspended, .stopped:
        return nil
    @unknown default:
        return nil
    }
}

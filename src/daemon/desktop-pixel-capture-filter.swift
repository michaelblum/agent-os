import Darwin
import ScreenCaptureKit

enum AOSDesktopPixelCaptureFilterSelection: Equatable {
    case application(processID: pid_t)
    case windows([Int])
}

func aosDesktopPixelCaptureFilterSelection(
    currentProcessID: pid_t,
    availableApplicationProcessIDs: [pid_t],
    requestedWindowIDs: [Int],
    availableWindowIDs: [Int]
) -> AOSDesktopPixelCaptureFilterSelection? {
    if availableApplicationProcessIDs.contains(currentProcessID) {
        return .application(processID: currentProcessID)
    }
    let requested = Set(requestedWindowIDs)
    guard requested.isSubset(of: Set(availableWindowIDs)) else { return nil }
    return .windows(requested.sorted())
}

@available(macOS 14.0, *)
func aosDesktopPixelCaptureFilter(
    content: SCShareableContent,
    display: SCDisplay,
    excludingWindowIDs: [Int]
) throws -> SCContentFilter {
    let currentProcessID = getpid()
    guard let selection = aosDesktopPixelCaptureFilterSelection(
        currentProcessID: currentProcessID,
        availableApplicationProcessIDs: content.applications.map(\.processID),
        requestedWindowIDs: excludingWindowIDs,
        availableWindowIDs: content.windows.map { Int($0.windowID) }
    ) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }

    switch selection {
    case .application(let processID):
        guard let application = content.applications.first(where: {
            $0.processID == processID
        }) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        return SCContentFilter(
            display: display,
            excludingApplications: [application],
            exceptingWindows: []
        )
    case .windows(let windowIDs):
        let requested = Set(windowIDs)
        let windows = content.windows.filter {
            requested.contains(Int($0.windowID))
        }
        guard windows.count == requested.count else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        return SCContentFilter(display: display, excludingWindows: windows)
    }
}

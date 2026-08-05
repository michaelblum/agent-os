import Darwin
import Foundation

func runDesktopPixelCaptureFilterTests() {
    let processID: pid_t = 4242
    require(
        aosDesktopPixelCaptureFilterSelection(
            policy: .publicExplicitExclusions,
            currentProcessID: processID,
            applicationSelfExclusionEligible: true,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [30],
            availableWindowIDs: [30]
        ) == .windows([30]),
        "public capture hid the AOS process instead of honoring explicit exclusions"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            policy: .publicExplicitExclusions,
            currentProcessID: processID,
            applicationSelfExclusionEligible: true,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [30],
            availableWindowIDs: []
        ) == nil,
        "public capture accepted an unavailable explicit exclusion"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: true,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [30, 10],
            availableWindowIDs: [10]
        ) == .application(processID: processID),
        "native capture did not prefer complete process self-exclusion"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: false,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [30, 10, 30],
            availableWindowIDs: [40, 30, 10]
        ) == .windows([10, 30]),
        "raw native capture did not use exact-window self-exclusion"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: false,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [10, 30],
            availableWindowIDs: [10]
        ) == nil,
        "raw native capture accepted an incomplete exact-window set"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: true,
            availableApplicationProcessIDs: [7],
            requestedWindowIDs: [30, 10, 30],
            availableWindowIDs: [40, 30, 10]
        ) == .windows([10, 30]),
        "native capture did not retain exact-window fallback"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: true,
            availableApplicationProcessIDs: [7],
            requestedWindowIDs: [10, 30],
            availableWindowIDs: [10]
        ) == nil,
        "native capture accepted an incomplete self-exclusion fallback"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            applicationSelfExclusionEligible: false,
            availableApplicationProcessIDs: [],
            requestedWindowIDs: [],
            availableWindowIDs: []
        ) == .windows([]),
        "pre-surface capture rejected its empty exact-window fallback"
    )
    require(
        aosDesktopPixelApplicationSelfExclusionEligible(
            bundleURL: URL(fileURLWithPath: "/Applications/AOS.app"),
            bundleIdentifier: "com.agent-os.aos"
        ),
        "app-hosted capture rejected process self-exclusion"
    )
    require(
        !aosDesktopPixelApplicationSelfExclusionEligible(
            bundleURL: URL(fileURLWithPath: "/repo/agent-os/aos"),
            bundleIdentifier: nil
        ),
        "raw capture accepted application self-exclusion"
    )
}

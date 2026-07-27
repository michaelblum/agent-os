import Darwin

func runDesktopPixelCaptureFilterTests() {
    let processID: pid_t = 4242
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            availableApplicationProcessIDs: [7, processID],
            requestedWindowIDs: [30, 10],
            availableWindowIDs: [10]
        ) == .application(processID: processID),
        "native capture did not prefer complete process self-exclusion"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            availableApplicationProcessIDs: [7],
            requestedWindowIDs: [30, 10, 30],
            availableWindowIDs: [40, 30, 10]
        ) == .windows([10, 30]),
        "native capture did not retain exact-window fallback"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            availableApplicationProcessIDs: [7],
            requestedWindowIDs: [10, 30],
            availableWindowIDs: [10]
        ) == nil,
        "native capture accepted an incomplete self-exclusion fallback"
    )
    require(
        aosDesktopPixelCaptureFilterSelection(
            currentProcessID: processID,
            availableApplicationProcessIDs: [],
            requestedWindowIDs: [],
            availableWindowIDs: []
        ) == .windows([]),
        "pre-surface capture rejected its empty exact-window fallback"
    )
}

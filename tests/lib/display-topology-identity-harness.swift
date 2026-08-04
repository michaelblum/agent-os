import Foundation

private func bounds(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> AOSDisplayTopologyBounds {
    AOSDisplayTopologyBounds(x: x, y: y, width: width, height: height)
}

private func member(
    id: UInt32,
    uuid: String?,
    label: String,
    main: Bool,
    native: AOSDisplayTopologyBounds,
    visible: AOSDisplayTopologyBounds,
    scale: Double = 2,
    rotation: Double = 0
) -> AOSDisplayTopologyObservationMember {
    AOSDisplayTopologyObservationMember(
        runtimeDisplayID: id,
        displayUUID: uuid,
        label: label,
        isMain: main,
        isMirrored: false,
        nativeBounds: native,
        nativeVisibleBounds: visible,
        scaleFactor: scale,
        rotation: rotation
    )
}

private func replacing(
    _ source: AOSDisplayTopologyObservationMember,
    id: UInt32? = nil,
    uuid: String?? = nil,
    label: String? = nil,
    main: Bool? = nil,
    native: AOSDisplayTopologyBounds? = nil,
    visible: AOSDisplayTopologyBounds? = nil,
    scale: Double? = nil,
    rotation: Double? = nil
) -> AOSDisplayTopologyObservationMember {
    member(
        id: id ?? source.runtimeDisplayID,
        uuid: uuid ?? source.displayUUID,
        label: label ?? source.label,
        main: main ?? source.isMain,
        native: native ?? source.nativeBounds,
        visible: visible ?? source.nativeVisibleBounds,
        scale: scale ?? source.scaleFactor,
        rotation: rotation ?? source.rotation
    )
}

private let mainUUID = "11111111-2222-4333-8444-555555555555"
private let leftUUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

private func baseline() -> [AOSDisplayTopologyObservationMember] {
    [
        member(
            id: 101,
            uuid: mainUUID.uppercased(),
            label: "Main label",
            main: true,
            native: bounds(0, 0, 1440, 900),
            visible: bounds(0, 24, 1440, 876)
        ),
        member(
            id: 202,
            uuid: leftUUID,
            label: "Left label",
            main: false,
            native: bounds(-1920, -200, 1920, 1080),
            visible: bounds(-1920, -176, 1920, 1056),
            scale: 1,
            rotation: 90
        )
    ]
}

private func snapshot(
    _ observation: [AOSDisplayTopologyObservationMember],
    separateSpaces: Bool = true
) throws -> AOSDisplayTopologySnapshot {
    try buildAOSDisplayTopologySnapshot(
        observation: observation,
        screensHaveSeparateSpaces: separateSpaces
    )
}

private func providerFact(
    _ display: AOSDisplayTopologyDisplay,
    frame: AOSDisplayTopologyBounds? = nil,
    pointWidth: Int? = nil,
    pointHeight: Int? = nil,
    scaleFactor: Double? = nil
) -> AOSDisplayCaptureProviderFact {
    AOSDisplayCaptureProviderFact(
        runtimeDisplayID: display.runtimeDisplayID,
        nativeFrame: frame ?? display.nativeBounds,
        pointWidth: pointWidth ?? Int(display.nativeBounds.width),
        pointHeight: pointHeight ?? Int(display.nativeBounds.height),
        scaleFactor: scaleFactor ?? display.scaleFactor
    )
}

private func expectIdentityChange(
    _ baselineIdentity: String,
    _ label: String,
    _ observation: [AOSDisplayTopologyObservationMember],
    separateSpaces: Bool = true
) throws {
    let changed = try snapshot(observation, separateSpaces: separateSpaces)
    precondition(changed.identity != baselineIdentity, "\(label) must rotate display topology identity")
}

private func expectFailure(
    _ label: String,
    _ body: () throws -> Void
) {
    do {
        try body()
        preconditionFailure("\(label) must fail closed")
    } catch {
        // Expected.
    }
}

private struct IrrelevantEnvelope: Encodable {
    let timestamp: String
    let cursor: String
    let windows: [String]
    let apps: [String]
    let focus: String
    let labels: [String]
    let displayTopology: AOSDisplayTopologySnapshot
}

@main
struct DisplayTopologyIdentityHarness {
    static func main() throws {
        let originalMembers = baseline()
        let original = try snapshot(originalMembers)
        precondition(original.identity.range(of: #"^sha256:[0-9a-f]{64}$"#, options: .regularExpression) != nil)
        precondition(original.displays.map(\.ordinal) == [1, 2])
        precondition(original.displays[0].isMain)
        precondition(original.displays[0].runtimeDisplayID == 101, "main display must sort first")
        precondition(original.desktopWorldOriginNative == AOSDisplayTopologyPoint(x: -1920, y: -200))
        precondition(original.desktopWorldBounds == bounds(0, 0, 3360, 1100))

        // The live join is exact: every active CG display must have exactly one
        // NSScreen-backed observation, with no inactive source admitted.
        expectFailure("missing live NSScreen source") {
            _ = try buildAOSDisplayTopologySnapshot(
                activeDisplayIDs: [101, 202],
                observation: [originalMembers[0]],
                screensHaveSeparateSpaces: true
            )
        }
        expectFailure("duplicate live NSScreen source") {
            _ = try buildAOSDisplayTopologySnapshot(
                activeDisplayIDs: [101, 202],
                observation: [originalMembers[0], originalMembers[1], originalMembers[1]],
                screensHaveSeparateSpaces: true
            )
        }
        expectFailure("inactive live source") {
            _ = try buildAOSDisplayTopologySnapshot(
                activeDisplayIDs: [101],
                observation: originalMembers,
                screensHaveSeparateSpaces: true
            )
        }

        // ScreenCaptureKit contributes display ID, frame, width/height in
        // points, and the admitted filter's point-to-pixel scale. Output image
        // pixels then prove the configured topology-derived geometry.
        let providerFacts = original.displays.map { providerFact($0) }
        let captureAlignments = try validateAOSDisplayCaptureAlignment(
            topology: original,
            providerFacts: providerFacts,
            selectedDisplayIDs: [101, 202]
        )
        precondition(captureAlignments.map(\.runtimeDisplayID) == [101, 202])
        precondition(captureAlignments[0].expectedPixelWidth == 2880)
        precondition(captureAlignments[0].expectedPixelHeight == 1800)
        precondition(captureAlignments[1].expectedPixelWidth == 1920)
        precondition(captureAlignments[1].expectedPixelHeight == 1080)
        try validateAOSCapturedDisplayPixelGeometry(
            alignment: captureAlignments[0],
            actualWidth: 2880,
            actualHeight: 1800
        )
        expectFailure("duplicate selected provider membership") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: providerFacts,
                selectedDisplayIDs: [101, 101]
            )
        }
        expectFailure("selected display missing from topology") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: providerFacts,
                selectedDisplayIDs: [303]
            )
        }
        expectFailure("selected display missing from provider") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: [providerFacts[0]],
                selectedDisplayIDs: [202]
            )
        }
        expectFailure("duplicate provider display") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: providerFacts + [providerFacts[1]],
                selectedDisplayIDs: [202]
            )
        }
        expectFailure("same-id provider frame drift") {
            var changed = providerFacts
            changed[1] = providerFact(
                original.displays[1],
                frame: bounds(-1919, -200, 1920, 1080)
            )
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: changed,
                selectedDisplayIDs: [202]
            )
        }
        expectFailure("same-id provider point-size drift") {
            var changed = providerFacts
            changed[1] = providerFact(original.displays[1], pointWidth: 1919)
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: changed,
                selectedDisplayIDs: [202]
            )
        }
        expectFailure("same-id provider scale drift when representable") {
            var changed = providerFacts
            changed[1] = providerFact(original.displays[1], scaleFactor: 2)
            _ = try validateAOSDisplayCaptureAlignment(
                topology: original,
                providerFacts: changed,
                selectedDisplayIDs: [202]
            )
        }
        expectFailure("captured full-display pixel width drift") {
            try validateAOSCapturedDisplayPixelGeometry(
                alignment: captureAlignments[0],
                actualWidth: 2879,
                actualHeight: 1800
            )
        }
        expectFailure("captured full-display pixel height drift") {
            try validateAOSCapturedDisplayPixelGeometry(
                alignment: captureAlignments[0],
                actualWidth: 2880,
                actualHeight: 1799
            )
        }

        let interactiveWindow = try aosInteractiveSelectionWindowBounds(
            displayNativeBounds: original.displays[1].nativeBounds,
            mainDisplayHeight: original.displays[0].nativeBounds.height
        )
        precondition(interactiveWindow == bounds(-1920, 20, 1920, 1080))
        let interactiveGlobal = try aosInteractiveSelectionGlobalBounds(
            localSelection: bounds(100, 50, 300, 200),
            displayNativeBounds: original.displays[1].nativeBounds
        )
        precondition(interactiveGlobal == bounds(-1820, -150, 300, 200))
        expectFailure("interactive selection outside frozen display") {
            _ = try aosInteractiveSelectionGlobalBounds(
                localSelection: bounds(1900, 0, 40, 40),
                displayNativeBounds: original.displays[1].nativeBounds
            )
        }

        let fractionalMember = member(
            id: 505,
            uuid: "55555555-5555-4555-8555-555555555555",
            label: "fractional",
            main: true,
            native: bounds(0, 0, 1, 1),
            visible: bounds(0, 0, 1, 1),
            scale: 1.5
        )
        let fractionalSnapshot = try snapshot([fractionalMember])
        expectFailure("fractional expected pixel geometry") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: fractionalSnapshot,
                providerFacts: [AOSDisplayCaptureProviderFact(
                    runtimeDisplayID: 505,
                    nativeFrame: bounds(0, 0, 1, 1),
                    pointWidth: 1,
                    pointHeight: 1,
                    scaleFactor: 1.5
                )],
                selectedDisplayIDs: [505]
            )
        }

        let boundaryWidth = Double(Int.max)
        let boundaryMember = member(
            id: 606,
            uuid: "66666666-6666-4666-8666-666666666666",
            label: "boundary",
            main: true,
            native: bounds(0, 0, boundaryWidth, 1),
            visible: bounds(0, 0, boundaryWidth, 1),
            scale: 1
        )
        let boundarySnapshot = try snapshot([boundaryMember])
        expectFailure("unrepresentable expected pixel geometry") {
            _ = try validateAOSDisplayCaptureAlignment(
                topology: boundarySnapshot,
                providerFacts: [AOSDisplayCaptureProviderFact(
                    runtimeDisplayID: 606,
                    nativeFrame: bounds(0, 0, boundaryWidth, 1),
                    pointWidth: Int.max,
                    pointHeight: 1,
                    scaleFactor: 1
                )],
                selectedDisplayIDs: [606]
            )
        }

        // Raw CoreGraphics enumeration order is irrelevant.
        let permuted = try snapshot(Array(originalMembers.reversed()))
        precondition(permuted.identity == original.identity)
        precondition(permuted.displays.map(\.runtimeDisplayID) == original.displays.map(\.runtimeDisplayID))

        // Main status controls the first member and ordinals are assigned only
        // after canonical ordering.
        var changedMain = originalMembers
        changedMain[0] = replacing(changedMain[0], main: false)
        changedMain[1] = replacing(changedMain[1], main: true)
        let reordered = try snapshot(changedMain)
        precondition(reordered.displays.map(\.runtimeDisplayID) == [202, 101])
        precondition(reordered.displays.map(\.ordinal) == [1, 2])
        precondition(reordered.identity != original.identity)

        // Min-X, then min-Y, then member identity control the non-main order.
        let tieA = member(
            id: 303,
            uuid: "33333333-3333-4333-8333-333333333333",
            label: "tie-a",
            main: false,
            native: bounds(1500, 100, 800, 600),
            visible: bounds(1500, 100, 800, 600),
            scale: 1
        )
        let tieB = member(
            id: 404,
            uuid: "22222222-2222-4222-8222-222222222222",
            label: "tie-b",
            main: false,
            native: bounds(1500, 100, 800, 600),
            visible: bounds(1500, 100, 800, 600),
            scale: 1
        )
        let tied = try snapshot([tieA, originalMembers[0], tieB])
        precondition(tied.displays.map(\.runtimeDisplayID) == [101, 404, 303])

        try expectIdentityChange(original.identity, "hotplug", [originalMembers[0]])

        var changedScale = originalMembers
        changedScale[1] = replacing(changedScale[1], scale: 1.25)
        try expectIdentityChange(original.identity, "scale", changedScale)

        var changedRotation = originalMembers
        changedRotation[1] = replacing(changedRotation[1], rotation: 180)
        try expectIdentityChange(original.identity, "rotation", changedRotation)
        var equivalentRotation = originalMembers
        equivalentRotation[1] = replacing(equivalentRotation[1], rotation: 450)
        let equivalentRotationSnapshot = try snapshot(equivalentRotation)
        precondition(equivalentRotationSnapshot.identity == original.identity)

        let nativeMutations: [(String, (AOSDisplayTopologyBounds) -> AOSDisplayTopologyBounds)] = [
            ("native x/origin", { bounds($0.x - 1, $0.y, $0.width, $0.height) }),
            ("native y/origin", { bounds($0.x, $0.y - 1, $0.width, $0.height) }),
            ("native width", { bounds($0.x, $0.y, $0.width + 1, $0.height) }),
            ("native height", { bounds($0.x, $0.y, $0.width, $0.height + 1) })
        ]
        for (label, mutate) in nativeMutations {
            var changed = originalMembers
            changed[1] = replacing(changed[1], native: mutate(changed[1].nativeBounds))
            try expectIdentityChange(original.identity, label, changed)
        }
        let visibleMutations: [(String, (AOSDisplayTopologyBounds) -> AOSDisplayTopologyBounds)] = [
            ("visible x", { bounds($0.x + 1, $0.y, $0.width, $0.height) }),
            ("visible y", { bounds($0.x, $0.y + 1, $0.width, $0.height) }),
            ("visible width", { bounds($0.x, $0.y, $0.width - 1, $0.height) }),
            ("visible height", { bounds($0.x, $0.y, $0.width, $0.height - 1) })
        ]
        for (label, mutate) in visibleMutations {
            var changed = originalMembers
            changed[1] = replacing(changed[1], visible: mutate(changed[1].nativeVisibleBounds))
            try expectIdentityChange(original.identity, label, changed)
        }
        try expectIdentityChange(original.identity, "separate spaces", originalMembers, separateSpaces: false)

        // Missing UUIDs and every member of a duplicate-UUID set use the
        // explicit runtime-ID fallback.
        var missingUUID = originalMembers
        missingUUID[1] = replacing(missingUUID[1], uuid: .some(nil))
        let fallback = try snapshot(missingUUID)
        precondition(fallback.usesDisplayIDFallback)
        if case .displayIDFallback(202) = fallback.displays[1].memberIdentity {} else {
            preconditionFailure("missing UUID must use display_id_fallback")
        }

        var duplicateUUID = originalMembers
        duplicateUUID[1] = replacing(duplicateUUID[1], uuid: .some(mainUUID))
        let duplicateFallback = try snapshot(duplicateUUID)
        precondition(duplicateFallback.usesDisplayIDFallback)
        precondition(duplicateFallback.displays.allSatisfy {
            if case .displayIDFallback = $0.memberIdentity { return true }
            return false
        })

        var fallbackIDChanged = missingUUID
        fallbackIDChanged[1] = replacing(fallbackIDChanged[1], id: 203)
        try expectIdentityChange(fallback.identity, "fallback id", fallbackIDChanged)

        // Runtime IDs do not participate for UUID-backed members.
        var uuidRuntimeIDChanged = originalMembers
        uuidRuntimeIDChanged[1] = replacing(uuidRuntimeIDChanged[1], id: 909)
        let uuidRuntimeIDChangedSnapshot = try snapshot(uuidRuntimeIDChanged)
        precondition(uuidRuntimeIDChangedSnapshot.identity == original.identity)

        // Every signed zero is canonicalized to positive zero before public
        // encoding and hashing.
        var negativeZero = originalMembers
        negativeZero[0] = replacing(
            negativeZero[0],
            native: bounds(-0.0, -0.0, 1440, 900),
            scale: 2,
            rotation: -0.0
        )
        let negativeZeroSnapshot = try snapshot(negativeZero)
        precondition(negativeZeroSnapshot.identity == original.identity)
        let encoded = try JSONEncoder().encode(negativeZeroSnapshot)
        let encodedText = String(decoding: encoded, as: UTF8.self)
        precondition(!encodedText.contains("-0"))

        expectFailure("non-finite scale") {
            var changed = originalMembers
            changed[0] = replacing(changed[0], scale: .infinity)
            _ = try snapshot(changed)
        }
        expectFailure("non-finite bounds") {
            var changed = originalMembers
            changed[0] = replacing(changed[0], native: bounds(.nan, 0, 1440, 900))
            _ = try snapshot(changed)
        }
        expectFailure("duplicate runtime display ids") {
            var changed = originalMembers
            changed[1] = replacing(changed[1], id: 101)
            _ = try snapshot(changed)
        }
        expectFailure("duplicate main displays") {
            var changed = originalMembers
            changed[1] = replacing(changed[1], main: true)
            _ = try snapshot(changed)
        }

        // Dynamic capture/spatial facts and labels remain outside identity.
        var relabeled = originalMembers
        relabeled[0] = replacing(relabeled[0], label: "Renamed at runtime")
        let relabeledSnapshot = try snapshot(relabeled)
        precondition(relabeledSnapshot.identity == original.identity)
        let firstEnvelope = IrrelevantEnvelope(
            timestamp: "2026-08-04T12:00:00Z",
            cursor: "1,2",
            windows: ["window-a"],
            apps: ["app-a"],
            focus: "focus-a",
            labels: ["old"],
            displayTopology: original
        )
        let secondEnvelope = IrrelevantEnvelope(
            timestamp: "2030-01-01T00:00:00Z",
            cursor: "90,91",
            windows: ["window-b"],
            apps: ["app-b"],
            focus: "focus-b",
            labels: ["new"],
            displayTopology: relabeledSnapshot
        )
        let firstEnvelopeData = try JSONEncoder().encode(firstEnvelope)
        let secondEnvelopeData = try JSONEncoder().encode(secondEnvelope)
        precondition(firstEnvelopeData != secondEnvelopeData)
        precondition(firstEnvelope.displayTopology.identity == secondEnvelope.displayTopology.identity)

        print("fixture_identity=\(original.identity)")
        print("fallback_fixture_identity=\(fallback.identity)")
        print("PASS")
    }
}

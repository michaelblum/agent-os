import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

private struct SemanticTargetFixtureNode {
    let role: String?
    let title: String?
    let label: String?
    let position: CGPoint?
    let size: CGSize?
    let parent: Int?
}

private struct SemanticTargetRead: Equatable {
    let element: Int
    let attribute: AXSemanticTargetAttribute
    let timeout: Float
}

private func semanticTargetRequire(
    _ condition: @autoclosure () -> Bool,
    _ message: String
) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

func runAXSemanticTargetTraversalTests() {
    semanticTargetRequire(
        AXSemanticTargetAttribute.allCases == [
            .role,
            .title,
            .label,
            .position,
            .size,
            .parent,
        ],
        "semantic target traversal expanded beyond its reviewed minimal AX attributes"
    )
    let nodes = [
        1: SemanticTargetFixtureNode(
            role: "AXApplication",
            title: "Fixture App",
            label: nil,
            position: CGPoint(x: 0, y: 0),
            size: CGSize(width: 900, height: 700),
            parent: nil
        ),
        2: SemanticTargetFixtureNode(
            role: "AXWindow",
            title: "Fixture Window",
            label: nil,
            position: CGPoint(x: 20, y: 30),
            size: CGSize(width: 700, height: 500),
            parent: 1
        ),
        3: SemanticTargetFixtureNode(
            role: "AXButton",
            title: "Save",
            label: "Save action",
            position: CGPoint(x: 120, y: 80),
            size: CGSize(width: 80, height: 32),
            parent: 2
        ),
    ]
    var uptime: TimeInterval = 100
    var hitTimeouts: [Float] = []
    var reads: [SemanticTargetRead] = []
    let backend = AXSemanticTargetBackend<Int>(
        makeApplication: { pid in Int(pid) },
        elementAtPosition: { application, _, timeout in
            semanticTargetRequire(application == 4242, "semantic target application PID drifted")
            hitTimeouts.append(timeout)
            uptime += 0.005
            return 3
        },
        read: { element, attribute, timeout in
            reads.append(SemanticTargetRead(
                element: element,
                attribute: attribute,
                timeout: timeout
            ))
            uptime += 0.005
            guard let node = nodes[element] else { return nil }
            switch attribute {
            case .role:
                return node.role.map(AXSemanticTargetValue.string)
            case .title:
                return node.title.map(AXSemanticTargetValue.string)
            case .label:
                return node.label.map(AXSemanticTargetValue.string)
            case .position:
                return node.position.map(AXSemanticTargetValue.point)
            case .size:
                return node.size.map(AXSemanticTargetValue.size)
            case .parent:
                return node.parent.map(AXSemanticTargetValue.element)
            }
        }
    )
    let path = axSemanticTargetPathAtPoint(
        pid: 4242,
        point: CGPoint(x: 130, y: 90),
        maxDepth: 12,
        messagingTimeout: 0.05,
        operationTimeout: 0.5,
        backend: backend,
        now: { uptime }
    )
    semanticTargetRequire(
        path?.map(\.role) == ["AXApplication", "AXWindow", "AXButton"],
        "production semantic target traversal lost root-to-leaf ordering"
    )
    semanticTargetRequire(path?.last?.title == "Save", "semantic target title was not read")
    semanticTargetRequire(path?.last?.label == "Save action", "semantic target label was not read")
    semanticTargetRequire(
        path?.last?.bounds == CGRect(x: 120, y: 80, width: 80, height: 32),
        "semantic target bounds were not composed from position and size"
    )
    semanticTargetRequire(hitTimeouts.count == 1, "semantic target performed multiple hit tests")
    semanticTargetRequire(
        reads.allSatisfy { AXSemanticTargetAttribute.allCases.contains($0.attribute) },
        "semantic target traversal requested an undeclared AX attribute"
    )
    semanticTargetRequire(
        Set(reads.map(\.attribute)) == Set(AXSemanticTargetAttribute.allCases),
        "semantic target traversal did not exercise the complete minimal attribute set"
    )
    semanticTargetRequire(
        (hitTimeouts + reads.map(\.timeout)).allSatisfy { $0 > 0 && $0 <= 0.05 },
        "semantic target AX call timeout escaped its positive 50 ms bound"
    )

    semanticTargetRequire(
        axNativeSemanticTargetAttribute(.role) == kAXRoleAttribute as CFString
            && axNativeSemanticTargetAttribute(.title) == kAXTitleAttribute as CFString
            && axNativeSemanticTargetAttribute(.label) == kAXDescriptionAttribute as CFString
            && axNativeSemanticTargetAttribute(.position) == kAXPositionAttribute as CFString
            && axNativeSemanticTargetAttribute(.size) == kAXSizeAttribute as CFString
            && axNativeSemanticTargetAttribute(.parent) == kAXParentAttribute as CFString,
        "semantic target native AX attribute mapping drifted"
    )

    var deadlineUptime: TimeInterval = 200
    var deadlineReads: [AXSemanticTargetAttribute] = []
    var deadlineTimeouts: [Float] = []
    let deadlineBackend = AXSemanticTargetBackend<Int>(
        makeApplication: { _ in 0 },
        elementAtPosition: { _, _, _ in
            deadlineUptime += 0.04
            return 1
        },
        read: { _, attribute, timeout in
            deadlineReads.append(attribute)
            deadlineTimeouts.append(timeout)
            deadlineUptime += 0.04
            switch attribute {
            case .role:
                return .string("AXButton")
            case .title:
                return .string("Title")
            case .label:
                return .string("Label")
            case .position:
                return .point(.zero)
            case .size:
                return .size(CGSize(width: 10, height: 10))
            case .parent:
                return .element(1)
            }
        }
    )
    let deadlinePath = axSemanticTargetPathAtPoint(
        pid: 1,
        point: .zero,
        maxDepth: 12,
        messagingTimeout: 0.05,
        operationTimeout: 0.11,
        backend: deadlineBackend,
        now: { deadlineUptime }
    )
    semanticTargetRequire(deadlinePath?.count == 1, "deadline discarded bounded partial evidence")
    semanticTargetRequire(
        deadlineReads == [.role, .title],
        "overall operation deadline did not stop subsequent AX attributes"
    )
    semanticTargetRequire(
        deadlineTimeouts.count == 2
            && deadlineTimeouts[1] < deadlineTimeouts[0],
        "remaining operation time did not reduce the per-call AX timeout"
    )

    var cycleReads = 0
    let cycleBackend = AXSemanticTargetBackend<Int>(
        makeApplication: { _ in 0 },
        elementAtPosition: { _, _, _ in 1 },
        read: { _, attribute, _ in
            cycleReads += 1
            switch attribute {
            case .role:
                return .string("AXGroup")
            case .title, .label:
                return nil
            case .position:
                return .point(.zero)
            case .size:
                return .size(CGSize(width: 1, height: 1))
            case .parent:
                return .element(1)
            }
        }
    )
    let cyclePath = axSemanticTargetPathAtPoint(
        pid: 1,
        point: .zero,
        maxDepth: 2,
        messagingTimeout: 0.05,
        operationTimeout: 0.5,
        backend: cycleBackend,
        now: { 300 }
    )
    semanticTargetRequire(cyclePath?.count == 2, "maxDepth did not bound a parent cycle")
    semanticTargetRequire(cycleReads == 12, "bounded cycle performed an unexpected AX read count")

    var missingPositionReads: [AXSemanticTargetAttribute] = []
    let missingPositionBackend = AXSemanticTargetBackend<Int>(
        makeApplication: { _ in 0 },
        elementAtPosition: { _, _, _ in 1 },
        read: { _, attribute, _ in
            missingPositionReads.append(attribute)
            switch attribute {
            case .role:
                return nil
            case .title, .label, .position, .parent:
                return nil
            case .size:
                return .size(CGSize(width: 1, height: 1))
            }
        }
    )
    let missingPositionPath = axSemanticTargetPathAtPoint(
        pid: 1,
        point: .zero,
        maxDepth: 1,
        messagingTimeout: 0.05,
        operationTimeout: 0.5,
        backend: missingPositionBackend,
        now: { 400 }
    )
    semanticTargetRequire(
        missingPositionPath?.first?.role == "AXUnknown"
            && missingPositionPath?.first?.bounds == nil,
        "missing AX evidence did not fall back safely"
    )
    semanticTargetRequire(
        !missingPositionReads.contains(.size),
        "missing position did not short-circuit the size read"
    )

    var failedHitReads = 0
    let failedHitBackend = AXSemanticTargetBackend<Int>(
        makeApplication: { _ in 0 },
        elementAtPosition: { _, _, _ in nil },
        read: { _, _, _ in
            failedHitReads += 1
            return nil
        }
    )
    semanticTargetRequire(
        axSemanticTargetPathAtPoint(
            pid: 1,
            point: .zero,
            maxDepth: 1,
            messagingTimeout: 0.05,
            operationTimeout: 0.5,
            backend: failedHitBackend,
            now: { 500 }
        ) == nil && failedHitReads == 0,
        "failed semantic target hit testing attempted attribute reads"
    )

    var invalidInputApplications = 0
    let invalidInputBackend = AXSemanticTargetBackend<Int>(
        makeApplication: { _ in
            invalidInputApplications += 1
            return 0
        },
        elementAtPosition: { _, _, _ in nil },
        read: { _, _, _ in nil }
    )
    for invalid in [
        (pid_t(0), 1, TimeInterval(0.5)),
        (pid_t(1), 0, TimeInterval(0.5)),
        (pid_t(1), 1, TimeInterval(0)),
    ] {
        semanticTargetRequire(
            axSemanticTargetPathAtPoint(
                pid: invalid.0,
                point: .zero,
                maxDepth: invalid.1,
                messagingTimeout: 0.05,
                operationTimeout: invalid.2,
                backend: invalidInputBackend,
                now: { 600 }
            ) == nil,
            "invalid semantic target traversal input was accepted"
        )
    }
    semanticTargetRequire(
        invalidInputApplications == 0,
        "invalid semantic target traversal input reached the backend"
    )
}

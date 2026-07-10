import AppKit
import Foundation

struct CanvasLifecycleGeneration: Hashable {
    let canvasID: String
    let value: UInt64
}

/// Issues generation leases and retains retired native objects until teardown
/// is safe. CanvasManager's registry remains the sole active lifecycle owner.
final class CanvasLifecycleCoordinator {
    private var nextGeneration: UInt64 = 0
    private var retiring: [CanvasLifecycleGeneration: CanvasLike] = [:]

    func issueGeneration(for canvas: CanvasLike) -> CanvasLifecycleGeneration {
        precondition(Thread.isMainThread, "canvas generation issuance must run on the main thread")
        nextGeneration &+= 1
        let generation = CanvasLifecycleGeneration(canvasID: canvas.id, value: nextGeneration)
        canvas.lifecycleGeneration = generation.value
        return generation
    }

    func matches(_ canvas: CanvasLike, generation: CanvasLifecycleGeneration) -> Bool {
        generation.canvasID == canvas.id && generation.value == canvas.lifecycleGeneration
    }

    var pendingFinalizationCount: Int {
        precondition(Thread.isMainThread, "canvas retirement diagnostics must run on the main thread")
        return retiring.count
    }

    var pendingFinalizationIDs: [String] {
        precondition(Thread.isMainThread, "canvas retirement diagnostics must run on the main thread")
        return retiring.keys.map(\.canvasID).sorted()
    }

    func retainUntilNextRunLoop(
        _ canvas: CanvasLike,
        generation: CanvasLifecycleGeneration
    ) {
        precondition(Thread.isMainThread, "canvas retirement retention must run on the main thread")
        precondition(matches(canvas, generation: generation), "invalid canvas retirement generation")
        precondition(retiring[generation] == nil, "canvas generation is already pending finalization")
        retiring[generation] = canvas
        DispatchQueue.main.async { [self] in
            guard let retained = retiring[generation] else { return }
            autoreleasepool {
                retained.finalizeRetirement()
            }
            retiring.removeValue(forKey: generation)
            // NSApplication.currentEvent can retain a retired window and its
            // tracking graph until AppKit processes another event.
            if let event = NSEvent.otherEvent(
                with: .applicationDefined,
                location: .zero,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: 0,
                context: nil,
                subtype: 0,
                data1: 0,
                data2: 0
            ) {
                NSApp.postEvent(event, atStart: false)
            }
        }
    }
}

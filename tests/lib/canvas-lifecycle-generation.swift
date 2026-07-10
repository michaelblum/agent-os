import AppKit
import Foundation

protocol CanvasLike: CanvasNativeRetirable {
    var id: String { get }
    var lifecycleGeneration: UInt64 { get set }
}

final class TestCanvas: CanvasLike {
    let id: String
    var lifecycleGeneration: UInt64 = 0
    var quiesceCount = 0
    var finalizeCount = 0

    init(id: String) {
        self.id = id
    }

    var nativeRetirementID: String { id }

    func quiesceForRetirement() {
        quiesceCount += 1
    }

    func finalizeRetirement() {
        finalizeCount += 1
    }
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct CanvasLifecycleGenerationTest {
    static func main() {
        _ = NSApplication.shared
        let coordinator = CanvasLifecycleCoordinator()
        let first = TestCanvas(id: "same-id")
        let firstGeneration = coordinator.issueGeneration(for: first)
        let replacement = TestCanvas(id: "same-id")
        let replacementGeneration = coordinator.issueGeneration(for: replacement)
        require(firstGeneration != replacementGeneration, "same-ID canvases reused a generation")

        let completions = CanvasLifecycleCompletionTracker()
        var isolatedResult: Bool?
        completions.await(generations: [firstGeneration], action: "resume") {
            isolatedResult = $0
        }
        completions.receive(replacementGeneration, action: "resume")
        require(isolatedResult == nil, "replacement ACK completed the retired generation")
        completions.receive(firstGeneration, action: "resume")
        require(isolatedResult == true, "matching generation ACK did not complete")

        var abandonedResult: Bool?
        completions.await(
            generations: [firstGeneration, replacementGeneration],
            action: "exit"
        ) {
            abandonedResult = $0
        }
        completions.abandon(firstGeneration)
        completions.receive(replacementGeneration, action: "exit")
        require(abandonedResult == false, "partial generation abandonment synthesized success")
        require(completions.pendingCount == 0, "completed lifecycle waiter remained pending")

        coordinator.retainUntilNextRunLoop(replacement, generation: replacementGeneration)
        require(replacement.quiesceCount == 1, "retirement did not quiesce synchronously")
        require(coordinator.pendingFinalizationCount == 1, "retirement was absent from diagnostics")
        let deadline = Date().addingTimeInterval(1)
        while coordinator.pendingFinalizationCount > 0 && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        require(replacement.finalizeCount == 1, "retirement did not finalize on the main loop")
        require(coordinator.pendingFinalizationCount == 0, "retirement diagnostics did not clear")

        print("PASS canvas lifecycle generation and native retirement")
    }
}

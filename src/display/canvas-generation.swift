import Foundation

struct CanvasLifecycleGeneration: Hashable {
    let canvasID: String
    let value: UInt64

    init(canvasID: String, value: UInt64) {
        precondition(!canvasID.isEmpty, "canvas generation requires a canvas ID")
        precondition(value > 0, "canvas generation must be positive")
        self.canvasID = canvasID
        self.value = value
    }
}

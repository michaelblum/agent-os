import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const controllerSource = path.join(
  repoRoot,
  'src/daemon/desktop-world-scene-framebuffer-proof-controller.swift',
)

test('DesktopWorld framebuffer proof settles every exact segment without returning pixels', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-framebuffer-proof-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'framebuffer-proof')
  try {
    await writeFile(main, `
import Foundation

struct CanvasLifecycleGeneration {
    let canvasID: String
    let value: UInt64
}

struct DesktopWorldSurfaceSegment: Equatable {
    let displayID: UInt32
    let index: Int
}

struct DesktopWorldSceneBarrierTopology: Equatable {
    let canvasGeneration: UInt64
    let generation: UInt64
    let segments: [DesktopWorldSurfaceSegment]
}

final class CanvasManager {
    var posted: [[String: Any]] = []
    var acceptsPost = true

    func postMessageToDesktopWorldSceneStage(
        _ topology: DesktopWorldSceneBarrierTopology,
        canvasID: String,
        payload: Any
    ) -> Bool {
        if let payload = payload as? [String: Any] { posted.append(payload) }
        return acceptsPost
    }
}

let topology = DesktopWorldSceneBarrierTopology(
    canvasGeneration: 3,
    generation: 4,
    segments: [
        DesktopWorldSurfaceSegment(displayID: 7, index: 0),
        DesktopWorldSurfaceSegment(displayID: 9, index: 1),
    ]
)
let manager = CanvasManager()
let controller = AOSDesktopWorldFramebufferProofController(
    canvasManager: manager,
    stageCanvasID: "aos-desktop-world-stage",
    authorize: { owner, resource in
        owner == "example.consumer" && resource == "companion/main" ? topology : nil
    }
)
let request: [String: Any] = [
    "owner": "example.consumer",
    "resource": "companion/main",
    "proof": [
        "contract": "aos.desktop-world.framebuffer-proof.request.v1",
        "minimum_matches": 1,
        "maximum_matches": 2,
        "samples": [
            ["uv": [0.25, 0.25], "rgba_min": [0, 220, 0, 220], "rgba_max": [80, 255, 80, 255]],
            ["uv": [0.75, 0.75], "rgba_min": [0, 220, 0, 220], "rgba_max": [80, 255, 80, 255]],
        ],
    ],
]
var completions: [[String: Any]] = []
let connection = UUID()
controller.start(payload: request, connectionID: connection) { completions.append($0) }
precondition(manager.posted.count == 1)
let message = manager.posted[0]
let envelope = message["payload"] as! [String: Any]
let requestID = envelope["request_id"] as! String

controller.start(payload: request, connectionID: UUID()) { completions.append($0) }
precondition(completions.count == 1)
precondition(completions[0]["code"] as? String == "SCENE_FRAMEBUFFER_PROOF_BUSY")

func segment(_ display: UInt32, _ index: Int, canvas: UInt64 = 3) -> [String: Any] {
    [
        "request_id": requestID,
        "owner": "example.consumer",
        "resource": "companion/main",
        "canvas_generation": canvas,
        "topology_generation": 4,
        "segment_display_id": display,
        "segment_index": index,
        "status": "ok",
        "passed": true,
        "sample_count": 2,
        "matched_count": 1,
        "render_duration_ms": 2.5,
        "pixels_returned": false,
        "pixels_persisted": false,
        "error_code": NSNull(),
    ]
}

controller.handleResult(
    target: CanvasLifecycleGeneration(canvasID: "aos-desktop-world-stage", value: 3),
    payload: segment(7, 0, canvas: 2)
)
precondition(completions.count == 1)
controller.handleResult(
    target: CanvasLifecycleGeneration(canvasID: "aos-desktop-world-stage", value: 3),
    payload: segment(7, 0)
)
controller.handleResult(
    target: CanvasLifecycleGeneration(canvasID: "aos-desktop-world-stage", value: 3),
    payload: segment(7, 0)
)
precondition(completions.count == 1)
controller.handleResult(
    target: CanvasLifecycleGeneration(canvasID: "aos-desktop-world-stage", value: 3),
    payload: segment(9, 1)
)
precondition(completions.count == 2)
let result = completions[1]
precondition(result["status"] as? String == "ok")
precondition(result["segment_count"] as? Int == 2)
precondition(result["sample_count"] as? Int == 4)
precondition(result["matched_count"] as? Int == 2)
precondition(result["pixels_returned"] as? Bool == false)
precondition(result["pixels_persisted"] as? Bool == false)
precondition(result["display_id"] == nil)
let encoded = try! JSONSerialization.data(withJSONObject: result)
let text = String(data: encoded, encoding: .utf8)!
precondition(!text.contains("rgba"))

var invalid: [[String: Any]] = []
controller.start(payload: ["owner": "bad"], connectionID: UUID()) { invalid.append($0) }
precondition(invalid.first?["code"] as? String == "INVALID_SCENE_FRAMEBUFFER_PROOF")

var invalidated: [[String: Any]] = []
controller.start(payload: request, connectionID: connection) { invalidated.append($0) }
controller.stageInvalidated(code: "SCENE_TOPOLOGY_CHANGED")
precondition(invalidated.first?["code"] as? String == "SCENE_TOPOLOGY_CHANGED")
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      controllerSource,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('framebuffer proof failures settle without releasing the mounted scene', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-proof-result-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-proof-result')
  try {
    await writeFile(main, `
import Foundation

func result(_ operationID: String, _ displayID: UInt32, _ index: Int, code: String) -> [String: Any] {
    [
        "operation_id": operationID,
        "barrier_phase": "apply",
        "segment_display_id": displayID,
        "segment_index": index,
        "canvas_generation": 3,
        "topology_generation": 4,
        "status": "error",
        "code": code,
    ]
}

func completion(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> AOSDesktopWorldSceneResultCompletion? {
    for action in actions { if case .complete(let value) = action { return value } }
    return nil
}

func broadcasts(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> Bool {
    actions.contains { if case .broadcast = $0 { return true }; return false }
}

func retires(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> Bool {
    actions.contains { if case .retire = $0 { return true }; return false }
}

let segments: [(displayID: UInt32, index: Int)] = [(7, 0), (9, 1)]
let proof: [String: Any] = [
    "op": "prove",
    "proofId": "capture-overlay-visible",
    "expectedRevision": 2,
    "expectedExtensionDigest": String(repeating: "a", count: 64),
]

for code in [
    "SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED",
    "SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE",
    "SCENE_FRAMEBUFFER_READBACK_FAILED",
] {
    let coordinator = AOSDesktopWorldSceneResultCoordinator()
    let operationID = "proof-" + code.lowercased()
    precondition(coordinator.begin(
        operationID: operationID,
        leaseKey: "owner::main",
        owner: "owner",
        operation: "prove",
        operationPayload: proof,
        resource: "main",
        canvasGeneration: 3,
        topologyGeneration: 4,
        segments: segments
    ) != nil)
    let actions = coordinator.accept(result(operationID, 7, 0, code: code))
    precondition(!broadcasts(actions))
    precondition(!retires(actions))
    precondition(completion(actions)?.payload["code"] as? String == code)
    precondition(coordinator.hasPending(leaseKey: "owner::main") == false)
    precondition(coordinator.begin(
        operationID: operationID + "-next",
        leaseKey: "owner::main",
        owner: "owner",
        operation: "play",
        operationPayload: ["op": "play"],
        resource: "main",
        canvasGeneration: 3,
        topologyGeneration: 4,
        segments: segments
    ) != nil)
}

let timeout = AOSDesktopWorldSceneResultCoordinator()
precondition(timeout.begin(
    operationID: "proof-timeout",
    leaseKey: "owner::main",
    owner: "owner",
    operation: "prove",
    operationPayload: proof,
    resource: "main",
    canvasGeneration: 3,
    topologyGeneration: 4,
    segments: segments
) != nil)
let timeoutActions = timeout.expire(
    operationID: "proof-timeout",
    phase: .apply,
    topologyGeneration: 4
)
precondition(!broadcasts(timeoutActions))
precondition(completion(timeoutActions)?.payload["code"] as? String == "SCENE_SEGMENT_TIMEOUT")
precondition(timeout.hasPending(leaseKey: "owner::main") == false)

let structural = AOSDesktopWorldSceneResultCoordinator()
precondition(structural.begin(
    operationID: "proof-stage-failure",
    leaseKey: "owner::main",
    owner: "owner",
    operation: "prove",
    operationPayload: proof,
    resource: "main",
    canvasGeneration: 3,
    topologyGeneration: 4,
    segments: segments
) != nil)
precondition(broadcasts(structural.accept(result(
    "proof-stage-failure",
    7,
    0,
    code: "SCENE_STAGE_DISPOSED"
))))
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-result-coordinator.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

const program = {
  contract: 'aos.scene.native-effect-program.v1',
  schemaVersion: 1,
  id: 'example.effect.ripple',
  revision: 3,
  durationMs: 900,
  parameters: [],
  nodes: [
    { id: 'zero', op: 'constant', value: [0, 0] },
    { id: 'one', op: 'constant', value: 1 },
  ],
  outputs: { displacement: 'node.zero', opacity: 'node.one' },
}

async function compileAndRun(mainSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-effect-trigger-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-effect-trigger')
  try {
    await writeFile(main, mainSource)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      'src/shared/desktop-world-resource-identity.swift',
      'src/shared/scene-extension-identifier.swift',
      'src/daemon/scene-lease-registry.swift',
      'src/daemon/desktop-world-scene-result-coordinator.swift',
      'src/daemon/desktop-world-scene-stage-readiness.swift',
      'src/daemon/desktop-world-scene-effect-trigger-reservation.swift',
      'src/daemon/desktop-world-native-effect-program.swift',
      'src/daemon/desktop-world-native-effect-contract.swift',
      'src/daemon/desktop-world-scene-authorization.swift',
      'src/daemon/desktop-world-scene-controller.swift',
      'src/daemon/desktop-world-scene-native-effects.swift',
      'src/daemon/desktop-world-scene-effect-trigger.swift',
      'src/daemon/desktop-world-scene-effect-trigger-command.swift',
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    return execFileSync(executable, [], { cwd: repoRoot, encoding: 'utf8' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('semantic scene effect trigger binds exact revision and program without OS input', async () => {
  const programBase64 = Buffer.from(JSON.stringify(program)).toString('base64')
  const output = await compileAndRun(`
import Foundation

func readyController() -> (
    AOSDesktopWorldSceneController,
    AOSDesktopWorldSceneTopologyDescriptor
) {
    let controller = AOSDesktopWorldSceneController()
    let identity = AOSDesktopWorldSceneStageIdentity(
        canvasGeneration: 3,
        topologyGeneration: 4
    )
    let topology = AOSDesktopWorldSceneTopologyDescriptor(
        identity: identity,
        segments: [AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0)]
    )
    precondition(controller.configureInitial(topology))
    for segment in topology.segments {
        precondition(controller.recordReady(
            topology: topology,
            displayID: segment.displayID,
            index: segment.index,
            manifest: ["name": "desktop-world-stage"]
        ))
    }
    return (controller, topology)
}

func broadcast(
    _ action: AOSDesktopWorldSceneBarrierAction
) -> AOSDesktopWorldSceneBarrierBroadcast {
    guard case .broadcast(let value) = action else {
        preconditionFailure("expected scene broadcast")
    }
    return value
}

func settle(
    _ controller: AOSDesktopWorldSceneController,
    _ admitted: AOSDesktopWorldSceneBarrierAction,
    inputGeneration: String
) {
    var pending = [broadcast(admitted)]
    while !pending.isEmpty {
        let current = pending.removeFirst()
        let actions = controller.acceptResult(
            identity: AOSDesktopWorldSceneStageIdentity(
                canvasGeneration: current.canvasGeneration,
                topologyGeneration: current.topologyGeneration
            ),
            payload: [
                "operation_id": current.operationID,
                "barrier_phase": current.phase.rawValue,
                "canvas_generation": current.canvasGeneration,
                "topology_generation": current.topologyGeneration,
                "segment_display_id": 7,
                "segment_index": 0,
                "candidate_fingerprint": "candidate",
                "input_generation": inputGeneration,
                "status": "ok",
            ]
        )
        for action in actions {
            switch action {
            case .broadcast(let next):
                pending.append(next)
            case .complete(let completion):
                precondition(
                    controller.complete(
                        completion,
                        operationID: current.operationID
                    ) != nil
                )
            case .retire:
                preconditionFailure("unexpected retirement")
            }
        }
    }
}

let programData = Data(base64Encoded: "${programBase64}")!
let program = try! JSONSerialization.jsonObject(
    with: programData
) as! [String: Any]
let effects: [[String: Any]] = [
    [
        "implementation": "aos.scene.effect.program",
        "programId": "example.effect.ripple",
        "trigger": ["input": "pointer_down", "button": "left"],
        "parameters": [:],
    ],
    [
        "implementation": "aos.scene.effect.program",
        "programId": "example.effect.ripple",
        "trigger": ["phase": "start"],
        "lifecycle": ["kind": "gesture"],
        "parameters": [:],
    ],
    [
        "implementation": "aos.scene.effect.program",
        "programId": "example.effect.ripple",
        "trigger": ["phase": "end"],
        "parameters": [:],
    ],
]
let interactions: [String: Any] = [
    "contract": "aos.scene.cartridge.interactions.v1",
    "schemaVersion": 1,
    "nativeEffectPrograms": [program],
    "affordances": [],
    "interactions": [[
        "id": "companion-fast-travel",
        "affordanceId": "companion-body",
        "recognizer": [
            "implementation": "aos.scene.gesture.drag",
            "parameters": [:],
        ],
        "response": [
            "implementation": "aos.scene.response.aim_commit",
            "parameters": [:],
        ],
        "nativeEffects": effects,
    ]],
]
let authorization: [String: Any] = [
    "capabilities": [
        "aos.scene.desktop_frame_texture",
        "aos.scene.native_sheet_effect",
    ],
    "digest": String(repeating: "a", count: 64),
    "extensionId": "example.extension",
    "framebufferProofIds": [],
    "ownerId": "example.consumer",
    "resourceRevision": 9,
    "sceneAbi": "aos.scene.projection.v1",
    "threeRevision": "183",
]

let (controller, topology) = readyController()
let connectionID = UUID()
let key = controller.key(
    owner: "example.consumer",
    resource: "companion/main"
)
guard case .accepted(let mount) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions],
    extensionAuthorization: authorization,
    connectionID: connectionID,
    ref: "mount"
) else {
    preconditionFailure("mount rejected")
}
settle(controller, mount, inputGeneration: "generation-9")

let bindings = AOSDesktopWorldNativeEffectContract.parseBindings(interactions)!
let expectedProgram = bindings[0].program!
let payload: [String: Any] = [
    "affordance": "companion-body",
    "current": ["x": 900, "y": 600],
    "dry_run": false,
    "expected_program": [
        "digest": expectedProgram.digest,
        "id": expectedProgram.id,
        "revision": expectedProgram.revision,
    ],
    "expected_revision": 9,
    "interaction": "companion-fast-travel",
    "origin": ["x": 400, "y": 300],
    "owner": "example.consumer",
    "phase": "pointer_down",
    "pointer_session": "proof-1",
    "resource": "companion/main",
    "sequence": 1,
]
guard case .success = AOSDesktopWorldSceneEffectTriggerContract.parse(payload) else {
    preconditionFailure("valid trigger payload was rejected")
}
var unexpectedPayload = payload
unexpectedPayload["unexpected"] = true
guard case .failure =
    AOSDesktopWorldSceneEffectTriggerContract.parse(unexpectedPayload) else {
    preconditionFailure("unknown trigger field was accepted")
}
var booleanSequencePayload = payload
booleanSequencePayload["sequence"] = true
guard case .failure =
    AOSDesktopWorldSceneEffectTriggerContract.parse(booleanSequencePayload) else {
    preconditionFailure("boolean trigger sequence was accepted")
}
var booleanPointPayload = payload
booleanPointPayload["current"] = ["x": true, "y": 600]
guard case .failure =
    AOSDesktopWorldSceneEffectTriggerContract.parse(booleanPointPayload) else {
    preconditionFailure("boolean trigger coordinate was accepted")
}
var oversizedRevisionPayload = payload
oversizedRevisionPayload["expected_revision"] = Int64(Int32.max) + 1
guard case .failure =
    AOSDesktopWorldSceneEffectTriggerContract.parse(oversizedRevisionPayload) else {
    preconditionFailure("oversized trigger revision was accepted")
}
let command = AOSDesktopWorldSceneEffectTriggerCommandController(
    execute: { controller.prepareNativeEffectTrigger($0) }
)
var dryPayload = payload
dryPayload["dry_run"] = true
dryPayload["action"] = "scene-effect-trigger"
dryPayload["__envelope_active"] = true
dryPayload["__envelope_ref"] = "proof-ref"
let dryResponse = command.handle(dryPayload)
precondition(dryResponse["status"] as? String == "ok")
precondition(dryResponse["binding_validated"] as? Bool == true)
precondition(dryResponse["accepted"] as? Bool == false)
precondition(dryResponse["dry_run"] as? Bool == true)
let invalidResponse = command.handle(unexpectedPayload)
precondition(invalidResponse["status"] as? String == "error")
precondition(invalidResponse["code"] as? String == "SCENE_EFFECT_TRIGGER_INVALID")

func input(
    phase: AOSDesktopWorldSceneEffectTriggerPhase,
    revision: Int = 9,
    digest: String? = nil,
    dryRun: Bool = false
) -> AOSDesktopWorldSceneEffectTriggerInput {
    AOSDesktopWorldSceneEffectTriggerInput(
        affordanceID: "companion-body",
        current: CGPoint(x: 900, y: 600),
        dryRun: dryRun,
        expectedProgram: AOSDesktopWorldSceneEffectProgramIdentity(
            digest: digest ?? expectedProgram.digest,
            id: expectedProgram.id,
            revision: expectedProgram.revision
        ),
        expectedRevision: revision,
        interactionID: "companion-fast-travel",
        origin: CGPoint(x: 400, y: 300),
        ownerID: "example.consumer",
        phase: phase,
        pointerSessionID: "proof-1",
        resourceID: "companion/main",
        sequence: 1
    )
}

guard case .success(let pointer) =
    controller.prepareNativeEffectTrigger(input(phase: .pointerDown)),
      case .trigger(let pointerRequest) = pointer.operation else {
    preconditionFailure("pointer trigger was not prepared")
}
precondition(pointerRequest.resourceID == "companion/main")
precondition(pointerRequest.resourceRevision == 9)
precondition(pointerRequest.inputGeneration == "generation-9")
precondition(pointerRequest.inputs.current.x == 900)

let captureContextStarted = DispatchSemaphore(value: 0)
let releaseCaptureContext = DispatchSemaphore(value: 0)
let triggerFinished = DispatchSemaphore(value: 0)
let triggerResultLock = NSLock()
var triggerResult: AOSDesktopWorldSceneEffectTriggerPreparation?
DispatchQueue.global().async {
    let result = controller.executeNativeEffectTrigger(
        input(phase: .pointerDown),
        prepare: { operation in
            captureContextStarted.signal()
            precondition(
                releaseCaptureContext.wait(timeout: .now() + 1) == .success
            )
            return operation
        },
        admit: { _ in true }
    )
    triggerResultLock.lock()
    triggerResult = result
    triggerResultLock.unlock()
    triggerFinished.signal()
}
precondition(captureContextStarted.wait(timeout: .now() + 1) == .success)
guard case .success = controller.prepareNativeEffectTrigger(
    input(phase: .pointerDown)
) else {
    preconditionFailure("capture-context preparation retained the scene lock")
}
guard case .operationPending = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "signal",
    operation: ["op": "signal"],
    connectionID: connectionID,
    ref: "conflicting-operation"
) else {
    preconditionFailure("scene mutation bypassed the effect-trigger reservation")
}
releaseCaptureContext.signal()
precondition(triggerFinished.wait(timeout: .now() + 1) == .success)
triggerResultLock.lock()
guard case .success = triggerResult else {
    preconditionFailure("reserved trigger execution was rejected")
}
triggerResultLock.unlock()

var dryRunExecuted = false
guard case .success = controller.executeNativeEffectTrigger(
    input(phase: .pointerDown, dryRun: true),
    prepare: { operation in
        dryRunExecuted = true
        return operation
    },
    admit: { _ in true }
) else {
    preconditionFailure("dry-run binding validation was rejected")
}
precondition(!dryRunExecuted, "dry run executed the native effect")

guard case .failure(let rejectedCode, _) = controller.executeNativeEffectTrigger(
    input(phase: .pointerDown),
    prepare: { Optional($0) },
    admit: { _ in false }
) else {
    preconditionFailure("rejected effect admission reported success")
}
precondition(rejectedCode == "SCENE_EFFECT_TRIGGER_REJECTED")

guard case .success(let started) =
    controller.prepareNativeEffectTrigger(input(phase: .start)),
      case .trigger = started.operation else {
    preconditionFailure("gesture start was not prepared")
}
guard case .success(let updated) =
    controller.prepareNativeEffectTrigger(input(phase: .update)),
      case .gesture(let updateEvent, replacement: nil) = updated.operation else {
    preconditionFailure("gesture update was not prepared")
}
precondition(updateEvent.request.inputs.totalDelta.x == 500)
guard case .success(let ended) =
    controller.prepareNativeEffectTrigger(input(phase: .end)),
      case .gesture(_, replacement: let replacement) = ended.operation,
      replacement != nil else {
    preconditionFailure("gesture end replacement was not prepared")
}

guard case .failure(let revisionCode, _) =
    controller.prepareNativeEffectTrigger(
        input(phase: .pointerDown, revision: 8)
    ) else {
    preconditionFailure("stale revision was accepted")
}
precondition(revisionCode == "SCENE_EFFECT_TRIGGER_REVISION_CONFLICT")
guard case .failure(let bindingCode, _) =
    controller.prepareNativeEffectTrigger(
        input(phase: .pointerDown, digest: String(repeating: "b", count: 64))
    ) else {
    preconditionFailure("wrong program digest was accepted")
}
precondition(bindingCode == "SCENE_EFFECT_TRIGGER_BINDING_MISMATCH")

let (cancelController, cancelTopology) = readyController()
let cancelKey = cancelController.key(
    owner: "example.consumer",
    resource: "companion/main"
)
guard case .accepted(let cancelMount) = cancelController.admitOperation(
    topology: cancelTopology,
    key: cancelKey,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions],
    extensionAuthorization: authorization,
    connectionID: UUID(),
    ref: "cancel-mount"
) else {
    preconditionFailure("cancellation fixture mount rejected")
}
settle(cancelController, cancelMount, inputGeneration: "generation-9")

let cancelCaptureStarted = DispatchSemaphore(value: 0)
let releaseCancelCapture = DispatchSemaphore(value: 0)
let cancellationFinished = DispatchSemaphore(value: 0)
let canceledTriggerFinished = DispatchSemaphore(value: 0)
let canceledTriggerLock = NSLock()
var canceledTriggerResult: AOSDesktopWorldSceneEffectTriggerPreparation?
var canceledTriggerAdmitted = false
DispatchQueue.global().async {
    let result = cancelController.executeNativeEffectTrigger(
        input(phase: .pointerDown),
        prepare: { operation in
            cancelCaptureStarted.signal()
            precondition(
                releaseCancelCapture.wait(timeout: .now() + 1) == .success
            )
            return operation
        },
        admit: { _ in
            canceledTriggerLock.lock()
            canceledTriggerAdmitted = true
            canceledTriggerLock.unlock()
            return true
        }
    )
    canceledTriggerLock.lock()
    canceledTriggerResult = result
    canceledTriggerLock.unlock()
    canceledTriggerFinished.signal()
}
precondition(cancelCaptureStarted.wait(timeout: .now() + 1) == .success)
DispatchQueue.global().async {
    _ = cancelController.invalidateOwnership(code: "SCENE_TEST_INVALIDATED")
    cancellationFinished.signal()
}
precondition(
    cancellationFinished.wait(timeout: .now() + 0.2) == .success,
    "capture-context preparation deadlocked scene invalidation"
)
releaseCancelCapture.signal()
precondition(canceledTriggerFinished.wait(timeout: .now() + 1) == .success)
canceledTriggerLock.lock()
guard case .failure(let canceledCode, _) = canceledTriggerResult else {
    preconditionFailure("invalidated trigger reported success")
}
precondition(canceledCode == "SCENE_EFFECT_TRIGGER_REJECTED")
precondition(!canceledTriggerAdmitted, "invalidated trigger reached native admission")
canceledTriggerLock.unlock()

print("PASS semantic scene effect trigger")
`)
  assert.match(output, /PASS semantic scene effect trigger/u)

  const source = await Promise.all([
    'src/daemon/desktop-world-scene-effect-trigger.swift',
    'src/daemon/desktop-world-scene-effect-trigger-command.swift',
  ].map((file) => readFile(path.join(repoRoot, file), 'utf8'))).then((values) => values.join('\n'))
  assert.doesNotMatch(source, /CGEvent|CGEventPost|dispatchNativeKey|mouseEvent/u)
})

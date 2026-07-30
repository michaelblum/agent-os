import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function compileAndRun(name, sources, mainSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), `aos-${name}-`))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, name)
  try {
    await writeFile(main, mainSource)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources.map((source) => path.join(repoRoot, source)),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    return execFileSync(executable, [], { cwd: repoRoot, encoding: 'utf8' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const interactionDocument = `
func interactions(
    trigger: [String: Any] = ["phase": "start"],
    amplitude: Any = 18
) -> [String: Any] {
    [
        "contract": "aos.scene.cartridge.interactions.v1",
        "schemaVersion": 1,
        "affordances": [],
        "interactions": [[
            "id": "tap-ripple",
            "affordanceId": "body",
            "recognizer": ["implementation": "aos.scene.gesture.tap", "parameters": [:]],
            "response": ["implementation": "aos.scene.response.drop", "parameters": [:]],
            "nativeEffect": [
                "implementation": "aos.scene.effect.desktop-ripple",
                "trigger": trigger,
                "parameters": ["amplitude": amplitude],
            ],
        ]],
    ]
}
`

const programmableRipple = {
  contract: 'aos.scene.native-effect-program.v1',
  schemaVersion: 1,
  id: 'example.effect.ripple',
  revision: 1,
  durationMs: 1500,
  parameters: [
    { id: 'amplitude', default: 18, min: 0, max: 96 },
    { id: 'alpha_gain', default: 1.5, min: 0.1, max: 4 },
    { id: 'decay', default: 1.1, min: 0, max: 10 },
    { id: 'distance_scale', default: 0.001, min: 0.00001, max: 0.01 },
    { id: 'envelope_width', default: 180, min: 24, max: 400 },
    { id: 'frequency', default: 0.045, min: 0.001, max: 0.25 },
    { id: 'radius', default: 5000, min: 32, max: 5000 },
    { id: 'speed', default: 3400, min: 10, max: 4000 },
  ],
  nodes: [
    { id: 'delta', op: 'subtract', inputs: ['world.position', 'event.current'] },
    { id: 'distance', op: 'length', inputs: ['node.delta'] },
    { id: 'travel', op: 'multiply', inputs: ['clock.elapsed', 'parameter.speed'] },
    { id: 'front', op: 'subtract', inputs: ['node.distance', 'node.travel'] },
    { id: 'front_squared', op: 'multiply', inputs: ['node.front', 'node.front'] },
    { id: 'envelope_squared', op: 'multiply', inputs: ['parameter.envelope_width', 'parameter.envelope_width'] },
    { id: 'packet_ratio', op: 'divide', inputs: ['node.front_squared', 'node.envelope_squared'] },
    { id: 'negative_packet_ratio', op: 'negate', inputs: ['node.packet_ratio'] },
    { id: 'packet', op: 'exponential', inputs: ['node.negative_packet_ratio'] },
    { id: 'distance_decay', op: 'multiply', inputs: ['parameter.decay', 'parameter.distance_scale'] },
    { id: 'distance_scaled', op: 'multiply', inputs: ['node.distance', 'node.distance_decay'] },
    { id: 'one', op: 'constant', value: 1 },
    { id: 'distance_denominator', op: 'add', inputs: ['node.one', 'node.distance_scaled'] },
    { id: 'distance_fade', op: 'divide', inputs: ['node.one', 'node.distance_denominator'] },
    { id: 'time_decay', op: 'multiply', inputs: ['clock.elapsed', 'parameter.decay'] },
    { id: 'negative_time_decay', op: 'negate', inputs: ['node.time_decay'] },
    { id: 'time_fade', op: 'exponential', inputs: ['node.negative_time_decay'] },
    { id: 'radius_start_scale', op: 'constant', value: 0.85 },
    { id: 'radius_start', op: 'multiply', inputs: ['parameter.radius', 'node.radius_start_scale'] },
    { id: 'radius_ramp', op: 'smoothstep', inputs: ['node.radius_start', 'parameter.radius', 'node.distance'] },
    { id: 'radius_fade', op: 'one_minus', inputs: ['node.radius_ramp'] },
    { id: 'phase', op: 'multiply', inputs: ['node.front', 'parameter.frequency'] },
    { id: 'wave', op: 'cosine', inputs: ['node.phase'] },
    { id: 'amplitude_wave', op: 'multiply', inputs: ['parameter.amplitude', 'node.wave'] },
    { id: 'packet_wave', op: 'multiply', inputs: ['node.amplitude_wave', 'node.packet'] },
    { id: 'distance_wave', op: 'multiply', inputs: ['node.packet_wave', 'node.distance_fade'] },
    { id: 'time_wave', op: 'multiply', inputs: ['node.distance_wave', 'node.time_fade'] },
    { id: 'displacement', op: 'multiply', inputs: ['node.time_wave', 'node.radius_fade'] },
    { id: 'direction', op: 'normalize', inputs: ['node.delta'] },
    { id: 'pixel_offset', op: 'multiply', inputs: ['node.direction', 'node.displacement'] },
    { id: 'uv_offset', op: 'divide', inputs: ['node.pixel_offset', 'surface.size'] },
    { id: 'alpha_packet', op: 'multiply', inputs: ['node.packet', 'node.radius_fade'] },
    { id: 'alpha_time', op: 'multiply', inputs: ['node.alpha_packet', 'node.time_fade'] },
    { id: 'alpha_gain', op: 'multiply', inputs: ['node.alpha_time', 'parameter.alpha_gain'] },
    { id: 'opacity', op: 'clamp01', inputs: ['node.alpha_gain'] },
  ],
  outputs: { displacement: 'node.pixel_offset', opacity: 'node.opacity' },
}
const programmableRippleBase64 = Buffer.from(
  JSON.stringify(programmableRipple),
).toString('base64')

test('native ripple Metal program compiles without AOS or live DesktopWorld', async () => {
  const source = await readFile(
    path.join(repoRoot, 'src/display/desktop-world-native-effect-renderer.swift'),
    'utf8',
  )
  const hostSource = await readFile(
    path.join(repoRoot, 'src/daemon/desktop-world-native-feedback-host.swift'),
    'utf8',
  )
  const match = source.match(/private let aosDesktopWorldNativeRippleShader = #"""([\s\S]*?)"""#/u)
  assert.ok(match, 'native ripple shader source marker is missing')
  assert.match(match[1], /input\.worldPosition - uniforms\.origin/u)
  assert.match(match[1], /float effectAlpha = clamp\(/u)
  assert.match(match[1], /discard_fragment\(\)/u)
  assert.match(match[1], /return float4\(color \* effectAlpha, effectAlpha\)/u)
  assert.doesNotMatch(match[1], /return float4\(desktop\.sample\([^\n]+, 1\.0\)/u)
  assert.match(source, /private var uniforms: \[Float\]/u)
  assert.match(source, /uniforms\[plan\.elapsedUniformIndex\] = Float\(elapsed\)/u)
  assert.match(source, /deinit \{\s*dispose\(\)\s*\}/u)
  assert.doesNotMatch(source, /func uniforms\(/u)
  assert.doesNotMatch(source, /let uniforms = plan\./u)
  assert.match(hostSource, /preparationQueue\.async/u)
  assert.doesNotMatch(hostSource, /@MainActor func prepare\(/u)
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-native-ripple-metal-'))
  try {
    const metal = path.join(root, 'desktop-world-native-ripple.metal')
    const compiler = path.join(root, 'compile-metal.swift')
    const executable = path.join(root, 'compile-metal')
    await writeFile(metal, match[1])
    await writeFile(compiler, `
import Foundation
import Metal

let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
guard let device = MTLCreateSystemDefaultDevice() else {
    preconditionFailure("Metal device is unavailable")
}
let library = try device.makeLibrary(source: source, options: nil)
precondition(library.makeFunction(name: "desktopWorldNativeRippleVertex") != nil)
precondition(library.makeFunction(name: "desktopWorldNativeRippleFragment") != nil)
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      compiler,
      '-o', executable,
    ], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    execFileSync(executable, [metal], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native feedback prepares exact-generation segment hosts before admission', async () => {
  const [hostSource, managerSource, sheetSource, surfaceSource, rendererSource] = await Promise.all([
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-native-feedback-host.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-native-projection-manager.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-native-sheet.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-surface.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-native-effect-renderer.swift'), 'utf8'),
  ])
  assert.match(hostSource, /let captureContext = captureContext\(\)/u)
  assert.match(hostSource, /canvasGeneration: captureContext\.canvasGeneration/u)
  assert.match(hostSource, /topologyGeneration: captureContext\.topologyGeneration/u)
  const preparationCall = hostSource.indexOf('prepareDesktopWorldNativeProjectionHosts(')
  const contextPublication = hostSource.indexOf('context = prepared.context')
  assert.ok(preparationCall >= 0 && contextPublication > preparationCall)
  assert.match(
    managerSource,
    /surface\.lifecycleGeneration == canvasGeneration,[\s\S]{0,120}surface\.topologyGeneration == topologyGeneration/u,
  )
  assert.match(surfaceSource, /func prepareNativeProjectionHosts\(device: MTLDevice\) throws/u)
  assert.match(surfaceSource, /created\.forEach \{ segment, host in\s*segment\.removeNativeProjectionHost\(host\)/u)
  assert.match(sheetSource, /segment\.preparedNativeProjectionHost\(device: device\)/u)
  assert.doesNotMatch(sheetSource, /removeNativeProjectionHost/u)
  assert.match(rendererSource, /var retainedViewCount: Int \{\s*renderers\.count\s*\}/u)
  assert.match(hostSource, /func shutdown\(\)[\s\S]{0,160}finalizeDesktopWorldNativeProjectionHosts/u)
})

test('native feedback contract rejects type drift and resolves bounded world coordinates', async () => {
  const output = await compileAndRun('native-feedback-contract', [
    'src/daemon/desktop-world-scene-stage-readiness.swift',
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/daemon/desktop-world-native-effect-contract.swift',
  ], `
import Foundation

${interactionDocument}

guard let binding = AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions()
)?.first else {
    preconditionFailure("valid native feedback did not parse")
}
precondition(binding.affordanceID == "body")
precondition(binding.trigger == .gesture(.start))
guard case .ripple(let ripple) = binding.definition else {
    preconditionFailure("legacy ripple definition changed")
}
precondition(ripple.amplitude == 18)
precondition(ripple.durationMilliseconds == 900)
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(amplitude: true)
) == nil)
for malformedCatalog: Any in [NSNull(), ["not": "an array"]] {
    var malformed = interactions()
    malformed["nativeEffectPrograms"] = malformedCatalog
    precondition(AOSDesktopWorldNativeEffectContract.parseBindings(malformed) == nil)
}

var duplicate = interactions()
var duplicateValues = duplicate["interactions"] as! [[String: Any]]
duplicateValues.append([
    "id": "tap-ripple",
    "affordanceId": "other",
    "recognizer": ["implementation": "aos.scene.gesture.tap", "parameters": [:]],
    "response": ["implementation": "aos.scene.response.drop", "parameters": [:]],
])
duplicate["interactions"] = duplicateValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(duplicate) == nil)

var duplicateTrigger = interactions(trigger: ["input": "pointer_down"])
var duplicateTriggerValues = duplicateTrigger["interactions"] as! [[String: Any]]
var secondTrigger = duplicateTriggerValues[0]
secondTrigger["id"] = "other-ripple"
duplicateTriggerValues.append(secondTrigger)
duplicateTrigger["interactions"] = duplicateTriggerValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(duplicateTrigger) == nil)

var multiple = interactions(trigger: ["input": "pointer_down"])
var multipleValues = multiple["interactions"] as! [[String: Any]]
var multipleValue = multipleValues[0]
let pointerEffect = multipleValue.removeValue(forKey: "nativeEffect") as! [String: Any]
var endEffect = pointerEffect
endEffect["trigger"] = ["phase": "end"]
multipleValue["nativeEffects"] = [pointerEffect, endEffect]
multipleValues[0] = multipleValue
multiple["interactions"] = multipleValues
guard let multipleBindings = AOSDesktopWorldNativeEffectContract.parseBindings(multiple),
      multipleBindings.count == 2,
      multipleBindings[0].trigger == .pointerDown(button: "left"),
      multipleBindings[1].trigger == .gesture(.end) else {
    preconditionFailure("multiple native effect bindings did not parse")
}

var gestureOwned = interactions(trigger: ["phase": "start"])
var gestureOwnedValues = gestureOwned["interactions"] as! [[String: Any]]
var gestureOwnedEffect = gestureOwnedValues[0]["nativeEffect"] as! [String: Any]
gestureOwnedEffect["lifecycle"] = ["kind": "gesture"]
gestureOwnedValues[0]["nativeEffect"] = gestureOwnedEffect
gestureOwned["interactions"] = gestureOwnedValues
guard let gestureBinding = AOSDesktopWorldNativeEffectContract.parseBindings(
    gestureOwned
)?.first,
      gestureBinding.lifecycle == .gesture else {
    preconditionFailure("gesture-owned native effect did not parse")
}
for invalidTrigger: [String: Any] in [
    ["input": "pointer_down"],
    ["phase": "end"],
] {
    var invalidLifecycle = gestureOwned
    var invalidValues = invalidLifecycle["interactions"] as! [[String: Any]]
    var invalidEffect = invalidValues[0]["nativeEffect"] as! [String: Any]
    invalidEffect["trigger"] = invalidTrigger
    invalidValues[0]["nativeEffect"] = invalidEffect
    invalidLifecycle["interactions"] = invalidValues
    precondition(
        AOSDesktopWorldNativeEffectContract.parseBindings(invalidLifecycle) == nil
    )
}

var boundedValues: [[String: Any]] = []
for index in 0..<256 {
    var entry: [String: Any] = [
        "id": "effect-\\(index)",
        "affordanceId": "body-\\(index)",
    ]
    if index == 0 {
        entry["nativeEffects"] = [pointerEffect, endEffect]
    } else if index > 1 {
        entry["nativeEffect"] = pointerEffect
    }
    boundedValues.append(entry)
}
var boundedDocument = interactions()
boundedDocument["interactions"] = boundedValues
let boundedBindingCount = AOSDesktopWorldNativeEffectContract.parseBindings(
    boundedDocument
)?.count
precondition(
    boundedBindingCount == 256,
    "expected 256 mixed bindings, got \(String(describing: boundedBindingCount))"
)
boundedValues[1]["nativeEffect"] = pointerEffect
boundedDocument["interactions"] = boundedValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(boundedDocument) == nil)

var mixedBindings = multiple
var mixedValues = mixedBindings["interactions"] as! [[String: Any]]
mixedValues[0]["nativeEffect"] = pointerEffect
mixedBindings["interactions"] = mixedValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(mixedBindings) == nil)

var emptyBindings = multiple
var emptyValues = emptyBindings["interactions"] as! [[String: Any]]
emptyValues[0]["nativeEffects"] = [[String: Any]]()
emptyBindings["interactions"] = emptyValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(emptyBindings) == nil)

var overflowBindings = multiple
var overflowValues = overflowBindings["interactions"] as! [[String: Any]]
overflowValues[0]["nativeEffects"] = Array(repeating: pointerEffect, count: 9)
overflowBindings["interactions"] = overflowValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(overflowBindings) == nil)

var duplicateArrayTrigger = multiple
var duplicateArrayValues = duplicateArrayTrigger["interactions"] as! [[String: Any]]
duplicateArrayValues[0]["nativeEffects"] = [pointerEffect, pointerEffect]
duplicateArrayTrigger["interactions"] = duplicateArrayValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(duplicateArrayTrigger) == nil)

var fractionalDuration = interactions()
var values = fractionalDuration["interactions"] as! [[String: Any]]
var value = values[0]
var effect = value["nativeEffect"] as! [String: Any]
var parameters = effect["parameters"] as! [String: Any]
parameters["durationMs"] = 900.5
effect["parameters"] = parameters
value["nativeEffect"] = effect
values[0] = value
fractionalDuration["interactions"] = values
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(fractionalDuration) == nil)

let identity = AOSDesktopWorldSceneStageIdentity(
    canvasGeneration: 3,
    topologyGeneration: 4
)
let lifecycleEvent = AOSDesktopWorldNativeEffectContract.gestureLifecycleEvent(
    bindings: [gestureBinding],
    capabilities: [
        AOSDesktopWorldNativeEffectBinding.capability,
        "aos.scene.desktop_frame_texture",
    ],
    ownerID: "example.consumer",
    resourceID: "example/object",
    resourceRevision: 7,
    identity: identity,
    event: [
        "sequence": 2,
        "interactionId": "tap-ripple",
        "gesture": [
            "phase": "update",
            "pointerSessionId": "pointer-1",
        ],
        "coordinates": [
            "current": ["x": 1_950, "y": 650],
            "delta": ["x": 50, "y": 30],
            "origin": ["x": 1_900, "y": 620],
            "totalDelta": ["x": 50, "y": 30],
        ],
    ]
)
precondition(lifecycleEvent?.phase == .update)
precondition(lifecycleEvent?.request.eventSequence == 2)
precondition(lifecycleEvent?.request.pointerSessionID == "pointer-1")
precondition(lifecycleEvent?.request.inputs.current.x == 1_950)
precondition(lifecycleEvent?.request.inputs.origin.y == 620)
precondition(AOSDesktopWorldNativeEffectContract.gestureLifecycleEvent(
    bindings: [gestureBinding],
    capabilities: [AOSDesktopWorldNativeEffectBinding.capability],
    ownerID: "example.consumer",
    resourceID: "example/object",
    resourceRevision: 7,
    identity: identity,
    event: [
        "sequence": 2,
        "interactionId": "tap-ripple",
        "gesture": [
            "phase": "update",
            "pointerSessionId": "pointer-1",
        ],
        "coordinates": ["desktopWorld": ["x": 1_950, "y": 650]],
    ]
) == nil)
let request = AOSDesktopWorldNativeEffectContract.request(
    binding: binding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 7),
    identity: identity,
    event: [
        "sequence": 1,
        "interactionId": "tap-ripple",
        "gesture": [
            "phase": "start",
            "pointerSessionId": "pointer-1",
        ],
        "coordinates": ["desktopWorld": ["x": 1900, "y": 620]],
    ]
)
precondition(request?.desktopWorldOrigin.x == 1900)
precondition(request?.desktopWorldOrigin.y == 620)
precondition(request?.resourceRevision == 7)
precondition(request?.eventSequence == 1)
precondition(request?.pointerSessionID == "pointer-1")
precondition(AOSDesktopWorldNativeEffectContract.request(
    binding: binding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 7),
    identity: identity,
    event: [
        "sequence": 3,
        "interactionId": "tap-ripple",
        "gesture": [
            "phase": "end",
            "pointerSessionId": "pointer-1",
        ],
        "coordinates": ["desktopWorld": ["x": 1900, "y": 620]],
    ]
) == nil)

guard let pointerBinding = AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(trigger: ["input": "pointer_down"])
)?.first else {
    preconditionFailure("valid pointer-down native feedback did not parse")
}
precondition(pointerBinding.trigger == .pointerDown(button: "left"))
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(trigger: ["input": "pointer_down", "button": true])
) == nil)
let pointerRequest = AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "left",
    point: CGPoint(x: 2100, y: 500),
    pointerSessionID: "pointer-1"
)
precondition(pointerRequest?.desktopWorldOrigin.x == 2100)
precondition(pointerRequest?.resourceRevision == 8)
precondition(pointerRequest?.pointerSessionID == "pointer-1")
precondition(AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "left",
    point: CGPoint(x: 2100, y: 500),
    pointerSessionID: ""
) == nil)
precondition(AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "up",
    button: "left",
    point: CGPoint(x: 2100, y: 500),
    pointerSessionID: "pointer-1"
) == nil)
precondition(AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "right",
    point: CGPoint(x: 2100, y: 500),
    pointerSessionID: "pointer-1"
) == nil)

let programData = Data(base64Encoded: "${programmableRippleBase64}")!
let program = try! JSONSerialization.jsonObject(with: programData) as! [String: Any]
var invalidProgramID = program
invalidProgramID["id"] = "example.effect-"
precondition(AOSDesktopWorldNativeEffectProgramContract.parse(
    program: invalidProgramID
) == nil)
for field in ["schemaVersion", "revision", "durationMs"] {
    var booleanInteger = program
    booleanInteger[field] = true
    precondition(AOSDesktopWorldNativeEffectProgramContract.parse(
        program: booleanInteger
    ) == nil)
}
var programInteractions = interactions(trigger: ["input": "pointer_down"])
programInteractions["nativeEffectPrograms"] = [program]
var programValues = programInteractions["interactions"] as! [[String: Any]]
var programValue = programValues[0]
programValue["nativeEffect"] = [
    "implementation": "aos.scene.effect.program",
    "programId": "example.effect.ripple",
    "trigger": ["input": "pointer_down"],
    "parameters": ["amplitude": 24],
]
programValues[0] = programValue
programInteractions["interactions"] = programValues
guard let programBinding = AOSDesktopWorldNativeEffectContract.parseBindings(
    programInteractions
)?.first,
      case .program(let programInstance) = programBinding.definition else {
    preconditionFailure("program binding did not parse")
}
precondition(programBinding.durationMilliseconds == 1500)
precondition(programInstance.parameterValues[0] == 24)
let programRequest = AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: programBinding,
    authorization: (ownerID: "example.consumer", resourceID: "example/object", revision: 9),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "left",
    point: CGPoint(x: 2200, y: 700),
    pointerSessionID: "pointer-2"
)
precondition(programRequest?.inputs.current.x == 2200)
precondition(programRequest?.inputs.origin.x == 2200)
print("PASS native feedback contract")
`)
  assert.match(output, /PASS native feedback contract/u)
})

test('native feedback authorization commits atomically with scene operations', async () => {
  const output = await compileAndRun('native-feedback-authorization', [
    'src/shared/desktop-world-resource-identity.swift',
    'src/shared/scene-extension-identifier.swift',
    'src/daemon/scene-lease-registry.swift',
    'src/daemon/desktop-world-scene-result-coordinator.swift',
    'src/daemon/desktop-world-scene-stage-readiness.swift',
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/daemon/desktop-world-native-effect-contract.swift',
    'src/daemon/desktop-world-scene-controller.swift',
    'src/daemon/desktop-world-scene-native-effects.swift',
    'src/daemon/scene-event.swift',
    'src/daemon/desktop-world-scene-event-router.swift',
  ], `
import Foundation

${interactionDocument}

func readyController() -> (AOSDesktopWorldSceneController, AOSDesktopWorldSceneTopologyDescriptor) {
    let controller = AOSDesktopWorldSceneController()
    let identity = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4)
    let topology = AOSDesktopWorldSceneTopologyDescriptor(
        identity: identity,
        segments: [AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0)]
    )
    precondition(controller.configureInitial(topology))
    precondition(controller.recordReady(
        topology: topology,
        displayID: 7,
        index: 0,
        manifest: ["name": "desktop-world-stage"]
    ))
    return (controller, topology)
}

func broadcast(_ action: AOSDesktopWorldSceneBarrierAction) -> AOSDesktopWorldSceneBarrierBroadcast {
    guard case .broadcast(let broadcast) = action else {
        preconditionFailure("expected scene broadcast")
    }
    return broadcast
}

func result(_ broadcast: AOSDesktopWorldSceneBarrierBroadcast, status: String = "ok") -> [String: Any] {
    var value: [String: Any] = [
        "operation_id": broadcast.operationID,
        "barrier_phase": broadcast.phase.rawValue,
        "canvas_generation": broadcast.canvasGeneration,
        "topology_generation": broadcast.topologyGeneration,
        "segment_display_id": 7,
        "segment_index": 0,
        "status": status,
    ]
    if broadcast.phase == .prepare || broadcast.phase == .commit {
        value["candidate_fingerprint"] = "candidate"
    }
    if status == "error" { value["code"] = "SCENE_EXTENSION_IMPORT_FAILED" }
    return value
}

@discardableResult
func settleSuccess(
    _ controller: AOSDesktopWorldSceneController,
    _ admitted: AOSDesktopWorldSceneBarrierAction
) -> AOSDesktopWorldSceneDelivery {
    var current = broadcast(admitted)
    while true {
        let actions = controller.acceptResult(
            identity: AOSDesktopWorldSceneStageIdentity(
                canvasGeneration: current.canvasGeneration,
                topologyGeneration: current.topologyGeneration
            ),
            payload: result(current)
        )
        if let next = actions.compactMap({ action -> AOSDesktopWorldSceneBarrierBroadcast? in
            if case .broadcast(let value) = action { return value }
            return nil
        }).first {
            current = next
            continue
        }
        guard let completion = actions.compactMap({ action -> AOSDesktopWorldSceneResultCompletion? in
            if case .complete(let value) = action { return value }
            return nil
        }).first,
              let delivery = controller.complete(
                completion,
                operationID: current.operationID
              ) else {
            preconditionFailure("scene operation did not complete")
        }
        return delivery
    }
}

func requestEvent(
    _ phase: String,
    sequence: Int = 1,
    pointerSessionID: String = "pointer-1"
) -> [String: Any] {
    [
        "sequence": sequence,
        "interactionId": "tap-ripple",
        "gesture": [
            "phase": phase,
            "pointerSessionId": pointerSessionID,
        ],
        "coordinates": ["desktopWorld": ["x": 900, "y": 600]],
    ]
}

func gestureInteractions() -> [String: Any] {
    var document = interactions()
    var values = document["interactions"] as! [[String: Any]]
    var effect = values[0]["nativeEffect"] as! [String: Any]
    effect["lifecycle"] = ["kind": "gesture"]
    values[0]["nativeEffect"] = effect
    document["interactions"] = values
    return document
}

let authorization: [String: Any] = [
    "capabilities": [
        "aos.scene.desktop_frame_texture",
        "aos.scene.native_sheet_effect",
    ],
    "digest": String(repeating: "a", count: 64),
    "extensionId": "example.extension",
    "framebufferProofIds": [],
    "ownerId": "example.consumer",
    "resourceRevision": 1,
    "sceneAbi": "aos.scene.projection.v1",
    "threeRevision": "183",
]

let programTemplateData = Data(base64Encoded: "${programmableRippleBase64}")!
let programTemplate = try! JSONSerialization.jsonObject(
    with: programTemplateData
) as! [String: Any]
func programInteractions(_ batch: Int) -> [String: Any] {
    var programs: [[String: Any]] = []
    var values: [[String: Any]] = []
    for index in 0..<8 {
        let id = "example.effect.batch\\(batch).program\\(index)"
        var program = programTemplate
        program["id"] = id
        programs.append(program)
        values.append([
            "id": "interaction-\\(index)",
            "affordanceId": "body-\\(index)",
            "recognizer": [
                "implementation": "aos.scene.gesture.tap",
                "parameters": [:],
            ],
            "response": [
                "implementation": "aos.scene.response.drop",
                "parameters": [:],
            ],
            "nativeEffect": [
                "implementation": "aos.scene.effect.program",
                "programId": id,
                "trigger": ["input": "pointer_down"],
                "parameters": [:],
            ],
        ])
    }
    return [
        "contract": "aos.scene.cartridge.interactions.v1",
        "schemaVersion": 1,
        "nativeEffectPrograms": programs,
        "interactions": values,
    ]
}

func admissionName(_ admission: AOSDesktopWorldSceneOperationAdmission) -> String {
    switch admission {
    case .accepted: return "accepted"
    case .leaseBusy: return "lease_busy"
    case .nativeEffectBudgetExceeded: return "native_effect_budget_exceeded"
    case .operationPending: return "operation_pending"
    case .stageUnavailable: return "stage_unavailable"
    }
}

let (unauthorized, unauthorizedTopology) = readyController()
guard case .stageUnavailable = unauthorized.admitOperation(
    topology: unauthorizedTopology,
    key: unauthorized.key(owner: "example.consumer", resource: "example/object"),
    owner: "example.consumer",
    resource: "example/object",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions()],
    connectionID: UUID(),
    ref: "unauthorized"
) else { preconditionFailure("native feedback mount borrowed missing authority") }

let (controller, topology) = readyController()
let key = controller.key(owner: "example.consumer", resource: "example/object")
let connection = UUID()
guard case .accepted(let mount) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "example/object",
    operationName: "mount",
    operation: ["op": "mount", "interactions": gestureInteractions()],
    extensionAuthorization: authorization,
    connectionID: connection,
    ref: "mount"
) else { preconditionFailure("mount rejected") }
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)
precondition(settleSuccess(controller, mount).payload["status"] as? String == "ok")
let mounted = controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
)
precondition(mounted?.resourceRevision == 1)
precondition(mounted.map(controller.authorizesNativeEffect) == true)
guard case .accepted(let subscribedEvents) = controller.subscribe(
    identity: topology.identity,
    key: key,
    connectionID: connection,
    ref: "events",
    events: ["gesture"]
) else { preconditionFailure("gesture subscription rejected") }
precondition(subscribedEvents == ["gesture"])

let canonicalEvent: [String: Any] = [
    "contract": "aos.scene.event.v1",
    "schemaVersion": 1,
    "type": "gesture",
    "sequence": 1,
    "stageId": "desktop-world/main",
    "ownerId": "example.consumer",
    "resourceId": "example/object",
    "affordanceId": "body",
    "interactionId": "tap-ripple",
    "gesture": [
        "id": "gesture-1",
        "kind": "tap",
        "phase": "start",
        "pointerSessionId": "pointer-1",
        "cancellationReason": NSNull(),
    ],
    "coordinates": [
        "origin": ["x": 900, "y": 600],
        "previous": NSNull(),
        "current": ["x": 900, "y": 600],
        "desktopWorld": ["x": 900, "y": 600],
        "native": ["x": 900, "y": 480],
        "delta": ["x": 0, "y": 0],
        "totalDelta": ["x": 0, "y": 0],
    ],
    "topology": NSNull(),
    "response": [
        "kind": "drop",
        "objectId": "body",
        "point": ["x": 900, "y": 600],
        "applied": true,
        "revision": 1,
    ],
    "at": 1000,
]
var nativeRequests: [AOSDesktopWorldNativeEffectRequest] = []
var nativeGestureEvents: [AOSDesktopWorldNativeEffectGestureEvent] = []
var publicEvents = 0
var deliveryOrder: [String] = []
let router = AOSDesktopWorldSceneEventRouter(
    scene: controller,
    nativeFeedback: {
        deliveryOrder.append("native-start")
        nativeRequests.append($0)
    },
    nativeGestureFeedback: { event, replacement in
        precondition(replacement == nil)
        deliveryOrder.append("native-" + event.phase.rawValue)
        nativeGestureEvents.append(event)
    }
) { _, _, _ in
    publicEvents += 1
    deliveryOrder.append("public-" + String(publicEvents))
    return true
}
router.handle(identity: topology.identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": canonicalEvent,
])
precondition(nativeRequests.count == 1, "native request route")
var updateEvent = canonicalEvent
updateEvent["sequence"] = 2
updateEvent["gesture"] = [
    "id": "gesture-1",
    "kind": "drag",
    "phase": "update",
    "pointerSessionId": "pointer-1",
    "cancellationReason": NSNull(),
]
updateEvent["coordinates"] = [
    "origin": ["x": 900, "y": 600],
    "previous": ["x": 900, "y": 600],
    "current": ["x": 1_100, "y": 720],
    "desktopWorld": ["x": 1_100, "y": 720],
    "native": ["x": 1_100, "y": 360],
    "delta": ["x": 200, "y": 120],
    "totalDelta": ["x": 200, "y": 120],
]
router.handle(identity: topology.identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": updateEvent,
])
precondition(nativeGestureEvents.count == 1, "native gesture route")
precondition(nativeGestureEvents[0].phase == .update, "native gesture phase")
precondition(
    nativeGestureEvents[0].request.inputs.current.x == 1_100,
    "native gesture inputs"
)
precondition(publicEvents == 2, "public gesture delivery count")
precondition(
    deliveryOrder == [
        "native-start",
        "public-1",
        "native-update",
        "public-2",
    ],
    "native admission must precede public event delivery: \\(deliveryOrder)"
)
precondition(
    (router.snapshot()["by_outcome"] as? [String: Int])?["enqueued"] == 2,
    "enqueued route count"
)

guard case .accepted(let transaction) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "example/object",
    operationName: "transact",
    operation: [
        "op": "transact",
        "transaction": ["expectedRevision": 1],
        "interactions": interactions(
            trigger: ["input": "pointer_down"],
            amplitude: 26
        ),
    ],
    connectionID: connection,
    ref: "transact"
) else { preconditionFailure("transaction rejected") }
_ = settleSuccess(controller, transaction)
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)
let transacted = controller.nativePointerEffectRequest(
    ownerID: "example.consumer",
    resourceID: "example/object",
    resourceRevision: 2,
    affordanceID: "body",
    canvasGeneration: topology.identity.canvasGeneration,
    phase: "down",
    button: "left",
    point: CGPoint(x: 900, y: 600),
    pointerSessionID: "pointer-2"
)
precondition(transacted?.resourceRevision == 2)
guard let transacted, case .ripple(let transactedRipple) = transacted.binding.definition else {
    preconditionFailure("transacted legacy ripple definition changed")
}
precondition(transactedRipple.amplitude == 26)
precondition(controller.nativePointerEffectRequest(
    ownerID: "example.consumer",
    resourceID: "example/object",
    resourceRevision: 1,
    affordanceID: "body",
    canvasGeneration: topology.identity.canvasGeneration,
    phase: "down",
    button: "left",
    point: CGPoint(x: 900, y: 600),
    pointerSessionID: "pointer-2"
) == nil)

guard case .stageUnavailable = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "example/object",
    operationName: "transact",
    operation: ["op": "transact", "transaction": ["expectedRevision": 1]],
    connectionID: connection,
    ref: "stale"
) else { preconditionFailure("stale transaction was admitted") }

guard case .accepted(let remove) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "example/object",
    operationName: "remove",
    operation: ["op": "remove"],
    connectionID: connection,
    ref: "remove"
) else { preconditionFailure("remove rejected") }
_ = settleSuccess(controller, remove)
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)

let (failed, failedTopology) = readyController()
let failedKey = failed.key(owner: "example.consumer", resource: "example/object")
guard case .accepted(let failedMountAction) = failed.admitOperation(
    topology: failedTopology,
    key: failedKey,
    owner: "example.consumer",
    resource: "example/object",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions()],
    extensionAuthorization: authorization,
    connectionID: UUID(),
    ref: "failed"
) else { preconditionFailure("failed mount admission rejected") }
let failedMount = broadcast(failedMountAction)
let abortActions = failed.acceptResult(
    identity: failedTopology.identity,
    payload: result(failedMount, status: "error")
)
guard let abort = abortActions.compactMap({ action -> AOSDesktopWorldSceneBarrierBroadcast? in
    if case .broadcast(let value) = action { return value }
    return nil
}).first else { preconditionFailure("abort missing") }
let completionActions = failed.acceptResult(
    identity: failedTopology.identity,
    payload: result(abort)
)
guard let failedCompletion = completionActions.compactMap({ action -> AOSDesktopWorldSceneResultCompletion? in
    if case .complete(let value) = action { return value }
    return nil
}).first else { preconditionFailure("failed completion missing") }
_ = failed.complete(failedCompletion, operationID: abort.operationID)
precondition(failed.nativeEffectRequest(
    identity: failedTopology.identity,
    key: failedKey,
    event: requestEvent("start")
) == nil)

let (budgetController, budgetTopology) = readyController()
let budgetConnection = UUID()
for batch in 0..<4 {
    let resource = "example/budget-\\(batch)"
    let batchInteractions = programInteractions(batch)
    precondition(
        AOSDesktopWorldNativeEffectContract.parseBindings(batchInteractions)?.count == 8,
        "batch \\(batch) fixture did not parse"
    )
    let admission = budgetController.admitOperation(
        topology: budgetTopology,
        key: budgetController.key(owner: "example.consumer", resource: resource),
        owner: "example.consumer",
        resource: resource,
        operationName: "mount",
        operation: ["op": "mount", "interactions": batchInteractions],
        extensionAuthorization: authorization,
        connectionID: budgetConnection,
        ref: "budget-\\(batch)"
    )
    guard case .accepted(let action) = admission else {
        preconditionFailure(
            "bounded program aggregate batch \\(batch) was rejected: \\(admissionName(admission))"
        )
    }
    _ = settleSuccess(budgetController, action)
}
precondition(
    budgetController.nativeEffectPrograms().count ==
        AOSDesktopWorldNativeEffectProgram.maximumPreparedPrograms
)
let overflowResource = "example/budget-overflow"
guard case .nativeEffectBudgetExceeded = budgetController.admitOperation(
    topology: budgetTopology,
    key: budgetController.key(
        owner: "example.consumer",
        resource: overflowResource
    ),
    owner: "example.consumer",
    resource: overflowResource,
    operationName: "mount",
    operation: ["op": "mount", "interactions": programInteractions(4)],
    extensionAuthorization: authorization,
    connectionID: budgetConnection,
    ref: "budget-overflow"
) else { preconditionFailure("aggregate program overflow reached scene dispatch") }
precondition(
    budgetController.nativeEffectPrograms().count ==
        AOSDesktopWorldNativeEffectProgram.maximumPreparedPrograms
)

let (reservationController, reservationTopology) = readyController()
let reservationConnection = UUID()
for batch in 0..<3 {
    let resource = "example/reservation-\\(batch)"
    guard case .accepted(let action) = reservationController.admitOperation(
        topology: reservationTopology,
        key: reservationController.key(owner: "example.consumer", resource: resource),
        owner: "example.consumer",
        resource: resource,
        operationName: "mount",
        operation: ["op": "mount", "interactions": programInteractions(batch)],
        extensionAuthorization: authorization,
        connectionID: reservationConnection,
        ref: "reservation-\\(batch)"
    ) else { preconditionFailure("reservation fixture mount was rejected") }
    _ = settleSuccess(reservationController, action)
}
let pendingResource = "example/reservation-pending"
guard case .accepted(let pendingReservation) = reservationController.admitOperation(
    topology: reservationTopology,
    key: reservationController.key(
        owner: "example.consumer",
        resource: pendingResource
    ),
    owner: "example.consumer",
    resource: pendingResource,
    operationName: "mount",
    operation: ["op": "mount", "interactions": programInteractions(3)],
    extensionAuthorization: authorization,
    connectionID: reservationConnection,
    ref: "reservation-pending"
) else { preconditionFailure("bounded pending reservation was rejected") }
precondition(reservationController.nativeEffectPrograms().count == 24)
let competingResource = "example/reservation-competing"
guard case .operationPending = reservationController.admitOperation(
    topology: reservationTopology,
    key: reservationController.key(
        owner: "example.consumer",
        resource: competingResource
    ),
    owner: "example.consumer",
    resource: competingResource,
    operationName: "mount",
    operation: ["op": "mount", "interactions": programInteractions(4)],
    extensionAuthorization: authorization,
    connectionID: reservationConnection,
    ref: "reservation-competing"
) else { preconditionFailure("program mutation bypassed aggregate serialization") }
_ = settleSuccess(reservationController, pendingReservation)
guard case .nativeEffectBudgetExceeded = reservationController.admitOperation(
    topology: reservationTopology,
    key: reservationController.key(
        owner: "example.consumer",
        resource: competingResource
    ),
    owner: "example.consumer",
    resource: competingResource,
    operationName: "mount",
    operation: ["op": "mount", "interactions": programInteractions(4)],
    extensionAuthorization: authorization,
    connectionID: reservationConnection,
    ref: "reservation-competing-overflow"
) else { preconditionFailure("settled program aggregate exceeded its budget") }

let (replacementController, replacementTopology) = readyController()
let replacementConnection = UUID()
for batch in 0..<4 {
    let resource = "example/replacement-\\(batch)"
    guard case .accepted(let action) = replacementController.admitOperation(
        topology: replacementTopology,
        key: replacementController.key(owner: "example.consumer", resource: resource),
        owner: "example.consumer",
        resource: resource,
        operationName: "mount",
        operation: ["op": "mount", "interactions": programInteractions(batch)],
        extensionAuthorization: authorization,
        connectionID: replacementConnection,
        ref: "replacement-\\(batch)"
    ) else { preconditionFailure("replacement fixture mount was rejected") }
    _ = settleSuccess(replacementController, action)
}
let replacementProgramCount = replacementController.nativeEffectPrograms().count
precondition(
    replacementProgramCount == AOSDesktopWorldNativeEffectProgram.maximumPreparedPrograms,
    "replacement fixture committed \\(replacementProgramCount) programs"
)
func replacePrograms(_ resource: String, batch: Int, ref: String)
    -> AOSDesktopWorldSceneOperationAdmission {
    replacementController.admitOperation(
        topology: replacementTopology,
        key: replacementController.key(owner: "example.consumer", resource: resource),
        owner: "example.consumer",
        resource: resource,
        operationName: "transact",
        operation: [
            "op": "transact",
            "transaction": ["expectedRevision": 1],
            "interactions": programInteractions(batch),
        ],
        connectionID: replacementConnection,
        ref: ref
    )
}
func mountDuplicatePrograms(_ ref: String) -> AOSDesktopWorldSceneOperationAdmission {
    replacementController.admitOperation(
        topology: replacementTopology,
        key: replacementController.key(
            owner: "example.consumer",
            resource: "example/duplicate-owner"
        ),
        owner: "example.consumer",
        resource: "example/duplicate-owner",
        operationName: "mount",
        operation: ["op": "mount", "interactions": programInteractions(0)],
        extensionAuthorization: authorization,
        connectionID: replacementConnection,
        ref: ref
    )
}
let firstReplacementAdmission = replacePrograms(
    "example/replacement-0", batch: 4, ref: "replacement-first"
)
guard case .accepted(let firstReplacement) = firstReplacementAdmission else {
    preconditionFailure(
        "first bounded replacement was rejected: \\(admissionName(firstReplacementAdmission))"
    )
}
guard case .operationPending = mountDuplicatePrograms("duplicate-pending") else {
    preconditionFailure("duplicate program ownership raced a pending replacement")
}
let genericConnection = UUID()
guard case .accepted(let genericMount) = replacementController.admitOperation(
    topology: replacementTopology,
    key: replacementController.key(
        owner: "example.consumer",
        resource: "generic/parallel"
    ),
    owner: "example.consumer",
    resource: "generic/parallel",
    operationName: "mount",
    operation: ["op": "mount"],
    connectionID: genericConnection,
    ref: "generic-parallel"
) else { preconditionFailure("generic scene work was serialized with program catalogs") }
_ = settleSuccess(replacementController, genericMount)
guard case .operationPending = replacePrograms(
    "example/replacement-1", batch: 5, ref: "replacement-queued"
) else { preconditionFailure("concurrent replacement reported false budget overflow") }
_ = settleSuccess(replacementController, firstReplacement)
guard case .nativeEffectBudgetExceeded = mountDuplicatePrograms("duplicate-overflow") else {
    preconditionFailure("settled replacement admitted an oversized duplicate owner")
}
guard case .accepted(let secondReplacement) = replacePrograms(
    "example/replacement-1", batch: 5, ref: "replacement-second"
) else { preconditionFailure("serialized replacement remained blocked") }
_ = settleSuccess(replacementController, secondReplacement)
precondition(
    replacementController.nativeEffectPrograms().count ==
        AOSDesktopWorldNativeEffectProgram.maximumPreparedPrograms
)
let disconnect = replacementController.beginDisconnect(
    connectionID: replacementConnection,
    topology: replacementTopology
)
precondition(disconnect.barrierActions.count == 4)
let postDisconnectAdmission = replacementController.admitOperation(
    topology: replacementTopology,
    key: replacementController.key(owner: "example.consumer", resource: "example/after-close"),
    owner: "example.consumer", resource: "example/after-close",
    operationName: "mount", operation: ["op": "mount", "interactions": programInteractions(6)],
    extensionAuthorization: authorization, connectionID: UUID(), ref: "after-close"
)
guard case .operationPending = postDisconnectAdmission else {
    preconditionFailure(
        "disconnect close did not retain program-catalog ownership: " +
        admissionName(postDisconnectAdmission)
    )
}
print("PASS native feedback authorization")
`)
  assert.match(output, /PASS native feedback authorization/u)
})

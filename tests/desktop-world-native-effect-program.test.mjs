import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { digestSceneNativeEffectProgram } from '../packages/toolkit/scene/authoring.js'

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

const program = {
  contract: 'aos.scene.native-effect-program.v1',
  schemaVersion: 1,
  id: 'example.effect.wave',
  revision: 1,
  durationMs: 900,
  parameters: [{ id: 'amplitude', default: 18, min: 0, max: 96 }],
  nodes: [
    { id: 'delta', op: 'subtract', inputs: ['world.position', 'event.current'] },
    { id: 'direction', op: 'normalize', inputs: ['node.delta'] },
    { id: 'distance', op: 'length', inputs: ['node.delta'] },
    { id: 'phase', op: 'add', inputs: ['node.distance', 'clock.elapsed'] },
    { id: 'wave', op: 'cosine', inputs: ['node.phase'] },
    { id: 'amount', op: 'multiply', inputs: ['node.wave', 'parameter.amplitude'] },
    { id: 'displacement', op: 'multiply', inputs: ['node.direction', 'node.amount'] },
    { id: 'one', op: 'constant', value: 1 },
  ],
  outputs: { displacement: 'node.displacement', opacity: 'node.one' },
}
const programBase64 = Buffer.from(JSON.stringify(program)).toString('base64')
const programDigest = await digestSceneNativeEffectProgram(program)
assert.equal(programDigest, 'fdb45189fb10e8e4eee30d3bfec7cbb4a6cd952667ecb886bdf7f05e3dc91db7')
const v2Program = {
  contract: 'aos.scene.native-effect-program.v2',
  schemaVersion: 2,
  id: 'example.effect.sheet-wave',
  revision: 1,
  durationMs: 1_400,
  parameters: [{ id: 'amplitude', default: 18, min: 0, max: 96 }],
  nodes: [
    { id: 'delta', op: 'subtract', inputs: ['world.position', 'event.current'] },
    { id: 'distance', op: 'length', inputs: ['node.delta'] },
    { id: 'phase', op: 'add', inputs: ['node.distance', 'clock.elapsed'] },
    { id: 'wave', op: 'cosine', inputs: ['node.phase'] },
    { id: 'height', op: 'multiply', inputs: ['node.wave', 'parameter.amplitude'] },
    { id: 'base_z', op: 'component_z', inputs: ['surface.position'] },
    { id: 'adjusted_height', op: 'add', inputs: ['node.height', 'node.base_z'] },
    { id: 'zero', op: 'constant', value: 0 },
    { id: 'position', op: 'compose3', inputs: ['node.zero', 'node.zero', 'node.adjusted_height'] },
    { id: 'texture', op: 'constant', value: [0, 0] },
    { id: 'one', op: 'constant', value: 1 },
  ],
  outputs: {
    positionOffset: 'node.position',
    textureDisplacement: 'node.texture',
    opacity: 'node.one',
  },
  geometry: {
    kind: 'event_point',
    cellSize: 6,
    padding: 96,
    radius: 480,
  },
  material: {
    lighting: 'standard',
    ambient: 0.65,
    diffuse: 0.45,
    fresnel: 0.24,
    lightDirection: [-0.35, -0.45, 0.82],
    normalSampleDistance: 2,
    perspectiveDistance: 2_400,
    refraction: 12,
    roughness: 0.38,
    specular: 0.72,
  },
}
const v2ProgramBase64 = Buffer.from(JSON.stringify(v2Program)).toString('base64')
const v3Program = {
  ...structuredClone(v2Program),
  contract: 'aos.scene.native-effect-program.v3',
  schemaVersion: 3,
  id: 'example.effect.fluid-trail',
  durationMs: 1_800,
  parameters: [
    { id: 'amplitude', default: 72, min: 8, max: 256 },
    { id: 'damping', default: 1.35, min: 0.2, max: 4 },
    { id: 'duration', default: 0.22, min: 0.1, max: 1 },
    { id: 'lead', default: 1, min: 0.2, max: 2 },
    { id: 'pressure', default: 1.15, min: 0.2, max: 3 },
    { id: 'propagation', default: 0.18, min: 0.05, max: 0.35 },
    { id: 'radius', default: 44, min: 12, max: 160 },
    { id: 'surface_tension', default: 0.012, min: 0, max: 0.04 },
  ],
  nodes: [
    { id: 'height', op: 'multiply', inputs: ['state.height', 'parameter.amplitude'] },
    { id: 'zero', op: 'constant', value: 0 },
    { id: 'position', op: 'compose3', inputs: ['node.zero', 'node.zero', 'node.height'] },
    { id: 'texture', op: 'multiply', inputs: ['state.gradient', 'parameter.amplitude'] },
    { id: 'one', op: 'constant', value: 1 },
  ],
  outputs: {
    positionOffset: 'node.position',
    textureDisplacement: 'node.texture',
    opacity: 'node.one',
  },
  geometry: {
    kind: 'event_segment',
    cellSize: 6,
    padding: 192,
    width: 640,
  },
  state: {
    kind: 'damped_height_field',
    maxDimension: 192,
    minDimension: 64,
    fixedStepHz: 60,
    maxSubsteps: 3,
    edgeAbsorptionCells: 8,
    dampingParameter: 'damping',
    propagationParameter: 'propagation',
    surfaceTensionParameter: 'surface_tension',
    emitter: {
      kind: 'swept_brush',
      durationParameter: 'duration',
      pressureParameter: 'pressure',
      radiusParameter: 'radius',
      leadParameter: 'lead',
      spacingRadiusScale: 0.38,
      speedReference: 1_400,
      speedScaleMin: 0.3,
      speedScaleMax: 1.65,
      trajectoryEasing: 'ease_out_quart',
      lobes: [
        { offsetRadiusScale: 1, radiusScale: 1, strengthScale: 1 },
        { offsetRadiusScale: -0.42, radiusScale: 0.82, strengthScale: -0.72 },
      ],
    },
  },
}
const v3ProgramBase64 = Buffer.from(JSON.stringify(v3Program)).toString('base64')
const v3ProgramDigest = await digestSceneNativeEffectProgram(v3Program)

test('consumer-authored native effect program validates and compiles to Metal', async () => {
  const output = await compileAndRun('native-effect-program-metal', [
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/display/desktop-world-native-effect-program-compiler.swift',
  ], `
import Foundation
import Metal
import CoreGraphics

let data = Data(base64Encoded: "${programBase64}")!
let object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
var invalidV1 = object
var invalidV1Nodes = invalidV1["nodes"] as! [[String: Any]]
invalidV1Nodes.append([
    "id": "composed",
    "op": "compose2",
    "inputs": ["node.one", "node.one"],
])
invalidV1["nodes"] = invalidV1Nodes
precondition(
    AOSDesktopWorldNativeEffectProgramContract.parse(program: invalidV1) == nil,
    "V2 composition leaked into V1"
)
guard let instance = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: object,
    parameters: ["amplitude": 24]
), let source = AOSDesktopWorldNativeEffectProgramCompiler.source(
    for: instance.program
) else { preconditionFailure("program did not validate and compile") }
precondition(instance.parameterValues == [24], "parameter override")
precondition(instance.program.digest == "${programDigest}", "digest parity")
precondition(!source.contains("example.effect.wave"), "consumer identity leaked")
precondition(source.contains("all(isfinite(displacement))"), "displacement guard")
precondition(source.contains("isfinite(rawOpacity)"), "opacity guard")
precondition(source.contains("safeScalarDenominator"), "safe division")
let v1Uniforms = AOSDesktopWorldNativeEffectProgramCompiler.uniformStorage(
    for: instance,
    eventCurrent: CGPoint(x: 4, y: 5),
    eventDelta: CGPoint(x: 1, y: 2),
    eventOrigin: CGPoint(x: 3, y: 4),
    eventTotalDelta: CGPoint(x: 5, y: 6),
    globalBounds: CGRect(x: -100, y: 0, width: 3000, height: 1200),
    segmentBounds: CGRect(x: 0, y: 0, width: 1440, height: 900)
)
precondition(v1Uniforms.count == 12)
precondition(v1Uniforms[11] == 24)
guard let device = MTLCreateSystemDefaultDevice() else {
    preconditionFailure("Metal device is unavailable")
}
let library = try! device.makeLibrary(source: source, options: nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramVertex") != nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramFragment") != nil)
print("PASS native effect program Metal")
`)
  assert.match(output, /PASS native effect program Metal/u)
})

test('v2 native effect program compiles bounded 3D deformation and material lighting', async () => {
  const output = await compileAndRun('native-effect-program-v2-metal', [
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/daemon/desktop-world-native-effect-geometry.swift',
    'src/display/desktop-world-native-effect-program-compiler.swift',
    'src/display/desktop-world-native-sheet-geometry.swift',
  ], `
import Foundation
import Metal
import CoreGraphics

let data = Data(base64Encoded: "${v2ProgramBase64}")!
let object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
guard let instance = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: object,
    parameters: [:]
), let source = AOSDesktopWorldNativeEffectProgramCompiler.source(
    for: instance.program
) else { preconditionFailure("v2 program did not validate and compile") }
precondition(instance.program.version == .v2)
precondition(instance.program.positionOffsetOutput == "node.position")
precondition(instance.program.geometry?.kind == .eventPoint)
precondition(!source.contains("example.effect.sheet-wave"))
precondition(source.contains("deformedPosition"))
precondition(source.contains("cross(tangentX, tangentY)"))
precondition(source.contains("perspectiveScale"))
precondition(source.contains("float shininess = mix"))
precondition(source.contains("float fresnelTerm"))
precondition(source.contains("safeNormalize(input.normal).xy"))
let positionStart = source.range(of: "float3 evaluateNativePositionOffset")!.lowerBound
let fragmentStart = source.range(of: "NativeEffectFragmentEvaluation evaluateNativeFragment")!.lowerBound
let deformationStart = source.range(of: "float3 deformedPosition")!.lowerBound
let positionSource = String(source[positionStart..<fragmentStart])
let fragmentSource = String(source[fragmentStart..<deformationStart])
precondition(positionSource.contains("cos("), "position dependency graph missing")
precondition(!fragmentSource.contains("cos("), "fragment compiled unused position graph")
var unlitObject = object
var unlitMaterial = unlitObject["material"] as! [String: Any]
unlitMaterial["lighting"] = "unlit"
for key in ["fresnel", "refraction", "roughness", "specular"] {
    unlitMaterial.removeValue(forKey: key)
}
unlitObject["material"] = unlitMaterial
guard let unlitProgram = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: unlitObject
), let unlitSource = AOSDesktopWorldNativeEffectProgramCompiler.source(
    for: unlitProgram
) else { preconditionFailure("unlit program did not compile") }
precondition(!unlitSource.contains("float3 tangentX"), "unlit material sampled normals")
var invalidGeometry = object
var invalidGeometryValue = invalidGeometry["geometry"] as! [String: Any]
invalidGeometryValue["cellSize"] = 1
invalidGeometry["geometry"] = invalidGeometryValue
precondition(
    AOSDesktopWorldNativeEffectProgramContract.parse(program: invalidGeometry) == nil,
    "invalid geometry silently fell back to the full surface"
)
let uniforms = AOSDesktopWorldNativeEffectProgramCompiler.uniformStorage(
    for: instance,
    eventCurrent: CGPoint(x: 40, y: 50),
    eventDelta: CGPoint(x: 10, y: 20),
    eventOrigin: CGPoint(x: 30, y: 40),
    eventTotalDelta: CGPoint(x: 50, y: 60),
    globalBounds: CGRect(x: -1440, y: -120, width: 4000, height: 1560),
    segmentBounds: CGRect(x: 0, y: 0, width: 2560, height: 1440)
)
precondition(uniforms.count == 18)
precondition(Array(uniforms[11...16]) == [0, 0, -1440, -120, 4000, 1560])
precondition(uniforms[17] == 18)
let geometryRequest = AOSDesktopWorldNativeEffectGeometryResolver.request(
    program: instance.program,
    origin: CGPoint(x: 1_200, y: 450),
    current: CGPoint(x: 1_500, y: 450)
)
let leftPlan = try! geometryRequest.plan(
    segmentBounds: CGRect(x: 0, y: 0, width: 1_440, height: 900)
)
let rightPlan = try! geometryRequest.plan(
    segmentBounds: CGRect(x: 1_440, y: 0, width: 2_560, height: 1_440)
)
precondition(leftPlan != nil && rightPlan != nil, "event geometry did not cross displays")
precondition(leftPlan!.patches[0].bounds.maxX == 1_440)
precondition(rightPlan!.patches[0].bounds.minX == 1_440)
guard let device = MTLCreateSystemDefaultDevice() else {
    preconditionFailure("Metal device is unavailable")
}
let library = try! device.makeLibrary(source: source, options: nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramVertex") != nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramFragment") != nil)
print("PASS native effect program V2 Metal")
`)
  assert.match(output, /PASS native effect program V2 Metal/u)
})

test('v3 native effect program shares one bounded persistent height field', async () => {
  const output = await compileAndRun('native-effect-program-v3-metal', [
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/display/desktop-world-native-effect-program-compiler.swift',
    'src/display/desktop-world-native-effect-height-field.swift',
  ], `
import CoreGraphics
import Foundation
import Metal

enum DesktopWorldNativeSheetFailure: Error {
    case geometryBudgetExceeded
    case invalidGeometry
    case textureUnavailable
}

struct AOSDesktopWorldNativeEffectInputs {
    let current: CGPoint
    let delta: CGPoint
    let origin: CGPoint
    let totalDelta: CGPoint
}

let data = Data(base64Encoded: "${v3ProgramBase64}")!
let object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
guard let instance = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: object,
    parameters: [:]
), let source = AOSDesktopWorldNativeEffectProgramCompiler.source(
    for: instance.program
) else { preconditionFailure("v3 program did not validate and compile") }
precondition(instance.program.version == .v3)
precondition(instance.program.digest == "${v3ProgramDigest}", "v3 digest parity")
precondition(instance.program.heightFieldState?.emitter.lobes.count == 2)
precondition(
    instance.program.heightFieldState?.emitter.trajectoryEasing == .easeOutQuart
)
var compatibleObject = object
var compatibleState = compatibleObject["state"] as! [String: Any]
var compatibleEmitter = compatibleState["emitter"] as! [String: Any]
compatibleEmitter.removeValue(forKey: "trajectoryEasing")
compatibleState["emitter"] = compatibleEmitter
compatibleObject["state"] = compatibleState
precondition(
    AOSDesktopWorldNativeEffectProgramContract.parse(
        program: compatibleObject,
        parameters: [:]
    )?.program.heightFieldState?.emitter.trajectoryEasing == .linear,
    "missing emitter easing did not preserve linear compatibility"
)
compatibleEmitter["trajectoryEasing"] = "linear"
compatibleState["emitter"] = compatibleEmitter
compatibleObject["state"] = compatibleState
precondition(
    AOSDesktopWorldNativeEffectProgramContract.parse(
        program: compatibleObject,
        parameters: [:]
    )?.program.heightFieldState?.emitter.trajectoryEasing == .linear,
    "explicit linear emitter easing was rejected"
)
for malformed in [NSNull(), 1, true, "bounce"] as [Any] {
    var invalidObject = object
    var invalidState = invalidObject["state"] as! [String: Any]
    var invalidEmitter = invalidState["emitter"] as! [String: Any]
    invalidEmitter["trajectoryEasing"] = malformed
    invalidState["emitter"] = invalidEmitter
    invalidObject["state"] = invalidState
    precondition(
        AOSDesktopWorldNativeEffectProgramContract.parse(
            program: invalidObject,
            parameters: [:]
        ) == nil,
        "malformed emitter easing was accepted"
    )
}
precondition(
    abs(AOSDesktopWorldNativeEffectEmitterTrajectory.progress(0.25, easing: .linear) - 0.25)
        < 0.000_001
)
precondition(
    abs(
        AOSDesktopWorldNativeEffectEmitterTrajectory.progress(
            0.25,
            easing: .easeOutQuart
        ) - 0.683_593_75
    ) < 0.000_001,
    "emitter trajectory drifted from route easing"
)
precondition(source.contains("texture2d<float> stateTexture"))
precondition(source.contains("sampleNativeEffectStateHeight"))
precondition(source.contains("sampleNativeEffectStateGradient"))
precondition(source.contains("surfaceSize / dimensions"), "state gradient lacks world units")
precondition(source.contains("/ (2.0 * worldTexel)"), "state gradient scale drifted")
guard let device = MTLCreateSystemDefaultDevice() else {
    preconditionFailure("Metal device is unavailable")
}
let library = try! device.makeLibrary(source: source, options: nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramVertex") != nil)
precondition(library.makeFunction(name: "desktopWorldNativeProgramFragment") != nil)
let inputs = AOSDesktopWorldNativeEffectInputs(
    current: CGPoint(x: 2_300, y: 600),
    delta: CGPoint(x: 1_800, y: 0),
    origin: CGPoint(x: 500, y: 600),
    totalDelta: CGPoint(x: 1_800, y: 0)
)
MainActor.assumeIsolated {
let field = try! AOSDesktopWorldNativeEffectHeightField(
    device: device,
    instance: instance,
    inputs: inputs,
    bounds: CGRect(x: 0, y: 0, width: 3_000, height: 1_200),
    displayIDs: [1, 2]
)
precondition(field.retainedTextureCount == 3)
precondition(field.stateCellCount <= 65_536)
let firstLeft = field.acquireTexture(displayID: 1, elapsed: 0.05)!
let firstRight = field.acquireTexture(displayID: 2, elapsed: 0.20)!
precondition(firstLeft.generation == firstRight.generation, "segments diverged")
precondition(firstLeft.texture === firstRight.texture, "segments sampled different textures")
let secondLeft = field.acquireTexture(displayID: 1, elapsed: 0.20)!
let secondRight = field.acquireTexture(displayID: 2, elapsed: 0.21)!
precondition(secondLeft.generation == secondRight.generation, "second epoch diverged")
precondition(secondLeft.generation > firstLeft.generation, "state did not advance")
let thirdLeft = field.acquireTexture(displayID: 1, elapsed: 0.35)!
let thirdRight = field.acquireTexture(displayID: 2, elapsed: 0.36)!
let blocked = field.acquireTexture(displayID: 1, elapsed: 0.50)!
precondition(
    blocked.generation == thirdLeft.generation,
    "an in-flight texture slot was overwritten"
)
field.complete(firstLeft)
field.complete(firstRight)
let resumedLeft = field.acquireTexture(displayID: 1, elapsed: 0.50)!
let resumedRight = field.acquireTexture(displayID: 2, elapsed: 0.51)!
precondition(resumedLeft.generation > thirdLeft.generation, "free slot did not resume state")
precondition(resumedLeft.generation == resumedRight.generation, "resumed epoch diverged")
var values = Array(
    repeating: Float(0),
    count: resumedRight.texture.width * resumedRight.texture.height
)
resumedRight.texture.getBytes(
    &values,
    bytesPerRow: resumedRight.texture.width * MemoryLayout<Float>.stride,
    from: MTLRegionMake2D(
        0,
        0,
        resumedRight.texture.width,
        resumedRight.texture.height
    ),
    mipmapLevel: 0
)
precondition(values.contains(where: { abs($0) > 0.000_001 }), "swept brush emitted no state")
let seamColumn = Int(round(
    1_440.0 / 3_000.0 * Double(resumedRight.texture.width - 1)
))
var leftEnergy: Float = 0
var rightEnergy: Float = 0
for y in 0..<resumedRight.texture.height {
    for x in 0..<resumedRight.texture.width {
        let energy = abs(values[y * resumedRight.texture.width + x])
        if x < seamColumn { leftEnergy += energy } else { rightEnergy += energy }
    }
}
precondition(leftEnergy > 0 && rightEnergy > 0, "global field did not cross the display seam")
for lease in [
    secondLeft, secondRight, thirdLeft, thirdRight, blocked,
    resumedLeft, resumedRight,
] {
    field.complete(lease)
}
field.dispose()
precondition(field.retainedTextureCount == 0)
precondition(field.stateCellCount == 0)

let catchUp = try! AOSDesktopWorldNativeEffectHeightField(
    device: device,
    instance: instance,
    inputs: inputs,
    bounds: CGRect(x: 0, y: 0, width: 3_000, height: 1_200),
    displayIDs: [1, 2]
)
let lateLeft = catchUp.acquireTexture(displayID: 1, elapsed: 12.0)!
let lateRight = catchUp.acquireTexture(displayID: 2, elapsed: 12.0)!
precondition(lateLeft.generation == lateRight.generation, "late segments diverged")
catchUp.complete(lateLeft)
catchUp.complete(lateRight)
let reversedInputs = AOSDesktopWorldNativeEffectInputs(
    current: CGPoint(x: 500, y: 600),
    delta: CGPoint(x: -1_800, y: 0),
    origin: CGPoint(x: 2_300, y: 600),
    totalDelta: CGPoint(x: -1_800, y: 0)
)
precondition(catchUp.update(inputs: reversedInputs), "bounded reversal was rejected")
let reversedLeft = catchUp.acquireTexture(displayID: 1, elapsed: 12.05)!
let reversedRight = catchUp.acquireTexture(displayID: 2, elapsed: 12.05)!
precondition(
    reversedLeft.generation > lateLeft.generation,
    "reversal did not advance after skipped ticks"
)
precondition(
    reversedLeft.generation == reversedRight.generation,
    "reversal segments diverged"
)
catchUp.complete(reversedLeft)
catchUp.complete(reversedRight)
catchUp.dispose()

let diagonalInputs = AOSDesktopWorldNativeEffectInputs(
    current: CGPoint(x: 1_920, y: 1_080),
    delta: CGPoint(x: 1_920, y: 1_080),
    origin: CGPoint(x: 0, y: 0),
    totalDelta: CGPoint(x: 1_920, y: 1_080)
)
let diagonal = try! AOSDesktopWorldNativeEffectHeightField(
    device: device,
    instance: instance,
    inputs: diagonalInputs,
    bounds: CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
    displayIDs: [1]
)
let diagonalLease = diagonal.acquireTexture(displayID: 1, elapsed: 0.05)!
diagonal.complete(diagonalLease)
diagonal.dispose()

for _ in 0..<100 {
    let cycle = try! AOSDesktopWorldNativeEffectHeightField(
        device: device,
        instance: instance,
        inputs: inputs,
        bounds: CGRect(x: 0, y: 0, width: 3_000, height: 1_200),
        displayIDs: [1, 2]
    )
    let left = cycle.acquireTexture(displayID: 1, elapsed: 0.20)!
    let right = cycle.acquireTexture(displayID: 2, elapsed: 0.20)!
    cycle.complete(left)
    cycle.complete(right)
    cycle.dispose()
    precondition(cycle.retainedTextureCount == 0)
    precondition(cycle.stateCellCount == 0)
}

let gradientProbeSource = source + #"""
kernel void desktopWorldNativeStateGradientProbe(
    texture2d<float, access::sample> stateTexture [[texture(0)]],
    device float2 *result [[buffer(0)]]
) {
    result[0] = sampleNativeEffectStateGradient(
        float2(0.5, 0.5),
        stateTexture,
        float2(30.0, 60.0)
    );
}
"""#
let gradientLibrary = try! device.makeLibrary(source: gradientProbeSource, options: nil)
let gradientFunction = gradientLibrary.makeFunction(
    name: "desktopWorldNativeStateGradientProbe"
)!
let gradientPipeline = try! device.makeComputePipelineState(function: gradientFunction)
let gradientTextureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
    pixelFormat: .r32Float,
    width: 3,
    height: 3,
    mipmapped: false
)
gradientTextureDescriptor.storageMode = .shared
gradientTextureDescriptor.usage = [.shaderRead]
let gradientTexture = device.makeTexture(descriptor: gradientTextureDescriptor)!
var gradientValues: [Float] = [
    0, 3, 0,
    1, 0, 4,
    0, 7, 0,
]
gradientValues.withUnsafeBytes { bytes in
    gradientTexture.replace(
        region: MTLRegionMake2D(0, 0, 3, 3),
        mipmapLevel: 0,
        withBytes: bytes.baseAddress!,
        bytesPerRow: 3 * MemoryLayout<Float>.stride
    )
}
let gradientResult = device.makeBuffer(
    length: MemoryLayout<SIMD2<Float>>.stride,
    options: .storageModeShared
)!
let gradientQueue = device.makeCommandQueue()!
let gradientCommand = gradientQueue.makeCommandBuffer()!
let gradientEncoder = gradientCommand.makeComputeCommandEncoder()!
gradientEncoder.setComputePipelineState(gradientPipeline)
gradientEncoder.setTexture(gradientTexture, index: 0)
gradientEncoder.setBuffer(gradientResult, offset: 0, index: 0)
gradientEncoder.dispatchThreads(
    MTLSize(width: 1, height: 1, depth: 1),
    threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1)
)
gradientEncoder.endEncoding()
gradientCommand.commit()
gradientCommand.waitUntilCompleted()
precondition(gradientCommand.status == .completed, "gradient probe failed")
let gradient = gradientResult.contents().bindMemory(
    to: SIMD2<Float>.self,
    capacity: 1
).pointee
precondition(abs(gradient.x - 0.15) < 0.000_001, "Metal gradient X units drifted")
precondition(abs(gradient.y - 0.10) < 0.000_001, "Metal gradient Y units drifted")

var overloadedObject = object
var overloadedParameters = overloadedObject["parameters"] as! [[String: Any]]
for index in overloadedParameters.indices {
    switch overloadedParameters[index]["id"] as! String {
    case "duration":
        overloadedParameters[index]["default"] = 0.05
        overloadedParameters[index]["min"] = 0.05
    case "radius":
        overloadedParameters[index]["default"] = 512
        overloadedParameters[index]["max"] = 512
    default: break
    }
}
overloadedObject["parameters"] = overloadedParameters
var overloadedState = overloadedObject["state"] as! [String: Any]
overloadedState["maxDimension"] = 256
overloadedState["maxSubsteps"] = 4
var overloadedEmitter = overloadedState["emitter"] as! [String: Any]
overloadedEmitter["spacingRadiusScale"] = 0.05
overloadedEmitter["lobes"] = Array(repeating: [
    "offsetRadiusScale": 0,
    "radiusScale": 4,
    "strengthScale": 1,
], count: 4)
overloadedState["emitter"] = overloadedEmitter
overloadedObject["state"] = overloadedState
let overloaded = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: overloadedObject,
    parameters: [:]
)!
do {
    _ = try AOSDesktopWorldNativeEffectHeightField(
        device: device,
        instance: overloaded,
        inputs: inputs,
        bounds: CGRect(x: 0, y: 0, width: 3_000, height: 1_200),
        displayIDs: [1, 2]
    )
    preconditionFailure("aggregate height-field work exceeded admission")
} catch DesktopWorldNativeSheetFailure.geometryBudgetExceeded {}
catch {
    preconditionFailure("unexpected aggregate-work rejection: \(error)")
}
}
print("PASS native effect program V3 shared height field")
`)
  assert.match(output, /PASS native effect program V3 shared height field/u)
})

test('native effect pipeline cache reconciles atomically and prunes retired programs', async () => {
  const output = await compileAndRun('native-effect-program-cache', [
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/display/desktop-world-native-effect-pipeline-cache.swift',
  ], `
import Foundation

enum ExpectedFailure: Error { case compile }
let data = Data(base64Encoded: "${programBase64}")!
let template = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
func program(_ id: String) -> AOSDesktopWorldNativeEffectProgram {
    var value = template
    value["id"] = id
    return AOSDesktopWorldNativeEffectProgramContract.parse(program: value)!
}
let first = program("example.effect.first")
let second = program("example.effect.second")
let third = program("example.effect.third")
var cache = AOSDesktopWorldNativeEffectPipelineCache<String>(maximumCount: 2)
try! cache.reconcile(programs: [first, second]) { "pipeline-" + $0.id }
precondition(cache.count == 2)
precondition(cache.pipeline(for: first.digest) == "pipeline-example.effect.first")
do {
    try cache.reconcile(programs: [second, third]) { candidate in
        if candidate.id == third.id { throw ExpectedFailure.compile }
        return "pipeline-" + candidate.id
    }
    preconditionFailure("failed candidate preparation committed")
} catch ExpectedFailure.compile {}
precondition(cache.pipeline(for: first.digest) != nil)
precondition(cache.pipeline(for: second.digest) != nil)
precondition(cache.pipeline(for: third.digest) == nil)
try! cache.reconcile(programs: [second, third]) { "pipeline-" + $0.id }
precondition(cache.count == 2)
precondition(cache.pipeline(for: first.digest) == nil)
precondition(cache.pipeline(for: third.digest) != nil)
do {
    try cache.reconcile(programs: [first, second, third]) { "pipeline-" + $0.id }
    preconditionFailure("cache limit was not enforced")
} catch AOSDesktopWorldNativeEffectPipelineCacheFailure.limitExceeded {}
precondition(cache.pipeline(for: second.digest) != nil)
precondition(cache.pipeline(for: third.digest) != nil)
print("PASS native effect program cache")
`)
  assert.match(output, /PASS native effect program cache/u)
})

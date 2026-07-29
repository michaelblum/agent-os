import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  material: {
    lighting: 'lambert',
    ambient: 0.65,
    diffuse: 0.45,
    lightDirection: [-0.35, -0.45, 0.82],
    normalSampleDistance: 2,
    perspectiveDistance: 2_400,
  },
}
const v2ProgramBase64 = Buffer.from(JSON.stringify(v2Program)).toString('base64')

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
precondition(instance.program.digest.count == 64, "digest")
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
    'src/display/desktop-world-native-effect-program-compiler.swift',
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
precondition(!source.contains("example.effect.sheet-wave"))
precondition(source.contains("deformedPosition"))
precondition(source.contains("cross(tangentX, tangentY)"))
precondition(source.contains("perspectiveScale"))
precondition(source.contains("float light = clamp"))
let positionStart = source.range(of: "float3 evaluateNativePositionOffset")!.lowerBound
let fragmentStart = source.range(of: "NativeEffectFragmentEvaluation evaluateNativeFragment")!.lowerBound
let deformationStart = source.range(of: "float3 deformedPosition")!.lowerBound
let positionSource = String(source[positionStart..<fragmentStart])
let fragmentSource = String(source[fragmentStart..<deformationStart])
precondition(positionSource.contains("cos("), "position dependency graph missing")
precondition(!fragmentSource.contains("cos("), "fragment compiled unused position graph")
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

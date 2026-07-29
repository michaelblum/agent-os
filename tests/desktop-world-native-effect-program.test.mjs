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

test('consumer-authored native effect program validates and compiles to Metal', async () => {
  const output = await compileAndRun('native-effect-program-metal', [
    'src/daemon/desktop-world-native-effect-program.swift',
    'src/display/desktop-world-native-effect-program-compiler.swift',
  ], `
import Foundation
import Metal

let data = Data(base64Encoded: "${programBase64}")!
let object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
guard let instance = AOSDesktopWorldNativeEffectProgramContract.parse(
    program: object,
    parameters: ["amplitude": 24]
), let source = AOSDesktopWorldNativeEffectProgramCompiler.source(
    for: instance.program
) else { preconditionFailure("program did not validate and compile") }
precondition(instance.parameterValues == [24])
precondition(instance.program.digest.count == 64)
precondition(!source.contains("example.effect.wave"))
precondition(source.contains("all(isfinite(displacement))"))
precondition(source.contains("isfinite(rawOpacity)"))
precondition(source.contains("safeScalarDenominator"))
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

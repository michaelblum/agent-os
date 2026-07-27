import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('DesktopWorld stage readiness requires every exact-generation segment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-stage-readiness-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-readiness-proof')
  const readinessSource = path.join(repoRoot, 'src/daemon/desktop-world-scene-stage-readiness.swift')
  try {
    await writeFile(main, `
import Foundation

let readiness = AOSDesktopWorldSceneStageReadiness()
let first = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4)
let second = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 5)
let segments = [
    AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0),
    AOSDesktopWorldSceneStageSegment(displayID: 9, index: 1),
]
let manifest: [String: Any] = ["name": "desktop-world-stage", "surface": "desktop-world"]
precondition(readiness.configure(identity: first, segments: segments))
precondition(readiness.record(identity: first, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.isReady(for: first) == false)
precondition(readiness.record(identity: first, displayID: 9, index: 1, manifest: manifest))
precondition(readiness.isReady(for: first))
precondition(readiness.record(identity: first, displayID: 9, index: 0, manifest: manifest) == false)
precondition(readiness.configure(identity: second, segments: segments))
precondition(readiness.isReady(for: first) == false)
precondition(readiness.isReady(for: second) == false)
precondition(readiness.record(identity: first, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.record(identity: second, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.invalidateIfCurrent(second))
precondition(readiness.invalidateIfCurrent(second) == false)
precondition(readiness.record(identity: second, displayID: 9, index: 1, manifest: manifest) == false)
precondition(readiness.isReady(for: second) == false)
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      readinessSource,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('legacy Sigil content-root retirement is exact and preserves user roots', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aos-legacy-sigil-root-'))
  const mainPath = path.join(root, 'main.swift')
  const binaryPath = path.join(root, 'retirement-test')
  const moduleCachePath = path.join(root, 'module-cache')
  mkdirSync(moduleCachePath)
  writeFileSync(mainPath, `
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data((message + "\\n").utf8))
        exit(1)
    }
}

let repo = "/tmp/agent-os"
let preserved = [
    "repo": "/tmp/agent-os",
    "toolkit": "/tmp/agent-os/packages/toolkit",
]

for legacyPath in ["apps/sigil", "./apps/sigil", "/tmp/agent-os/apps/sigil", "/tmp/agent-os/apps/other/../sigil"] {
    let result = retireLegacySigilContentRoot(preserved.merging(["sigil": legacyPath]) { _, right in right }, repoRoot: repo)
    require(result.retired, "expected legacy path to retire: \\(legacyPath)")
    require(result.roots == preserved, "migration changed unrelated roots")
}

for userPath in ["/tmp/external-sigil", "apps/sigil-copy", "/tmp/agent-os/apps/sigil-copy"] {
    let roots = preserved.merging(["sigil": userPath]) { _, right in right }
    let result = retireLegacySigilContentRoot(roots, repoRoot: repo)
    require(!result.retired, "unexpected retirement: \\(userPath)")
    require(result.roots == roots, "non-legacy roots changed")
}

let absent = retireLegacySigilContentRoot(preserved, repoRoot: repo)
require(!absent.retired && absent.roots == preserved, "absent legacy root should be a no-op")
`)

  try {
    const compile = spawnSync('swiftc', [
      path.join(repoRoot, 'src/shared/legacy-content-root-retirement.swift'),
      mainPath,
      '-o',
      binaryPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: moduleCachePath,
        SWIFT_MODULE_CACHE_PATH: moduleCachePath,
      },
    })
    assert.equal(compile.status, 0, compile.stderr)
    const run = spawnSync(binaryPath, [], { cwd: repoRoot, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('AOS config load persists the exact retirement before daemon startup', () => {
  const source = readFileSync(path.join(repoRoot, 'src/shared/config.swift'), 'utf8')
  assert.match(source, /if let roots = config\.content\?\.roots, let repoRoot = aosCurrentRepoRoot\(\)/u)
  assert.match(source, /retireLegacySigilContentRoot\(roots, repoRoot: repoRoot\)/u)
  assert.match(source, /if retirement\.retired \{[\s\S]*config\.content\?\.roots = retirement\.roots[\s\S]*saveConfig\(config\)/u)
})

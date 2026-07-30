import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('daemon admission waits for a queued AppKit turn after launch', () => {
  const serve = readFileSync(path.join(repoRoot, 'src/commands/serve.swift'), 'utf8')
  const daemon = readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  assert.match(
    serve,
    /let lifecycle = AOSDaemonApplicationLifecycle \{\s*daemon\.start\(\)\s*\}/u,
  )
  assert.match(serve, /application\.delegate = lifecycle/u)
  assert.match(
    serve,
    /withExtendedLifetime\(lifecycle\) \{\s*application\.run\(\)\s*\}/u,
  )
  assert.match(daemon, /private let idleShutdownTimer = AOSDaemonIdleTimer\(\)/u)
  assert.doesNotMatch(daemon, /var idleTimer: DispatchSourceTimer\?/u)

  const root = mkdtempSync(path.join(os.tmpdir(), 'aos-appkit-readiness-'))
  const executable = path.join(root, 'appkit-readiness')
  const moduleCache = path.join(root, 'module-cache')
  mkdirSync(moduleCache, { mode: 0o700 })

  try {
    execFileSync('/usr/bin/xcrun', [
      'swiftc',
      '-parse-as-library',
      path.join(repoRoot, 'src/commands/daemon-application-lifecycle.swift'),
      path.join(repoRoot, 'src/daemon/daemon-idle-timer.swift'),
      path.join(repoRoot, 'tests/lib/daemon-appkit-readiness-tests.swift'),
      '-o',
      executable,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: moduleCache,
        SWIFT_MODULECACHE_PATH: moduleCache,
      },
      stdio: 'pipe',
    })
    const output = execFileSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(output, 'daemon AppKit readiness harness passed\n')
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

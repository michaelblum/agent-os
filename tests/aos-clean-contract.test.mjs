import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('clean dry-run completes after retired experience-drift cleanup was removed', (t) => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-clean-contract-'))
  t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }))
  const stdout = execFileSync('node', ['scripts/aos-clean.mjs', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AOS_PATH: '/usr/bin/false',
      AOS_RUNTIME_MODE: 'repo',
      AOS_STATE_ROOT: stateRoot,
    },
  })
  const report = JSON.parse(stdout)
  assert.ok(['clean', 'dirty'].includes(report.status), JSON.stringify(report))
  assert.ok(Array.isArray(report.stale_daemons))
  assert.ok(Array.isArray(report.canvases))
})

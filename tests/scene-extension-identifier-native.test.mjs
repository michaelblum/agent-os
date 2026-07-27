import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('native extension identifiers follow the shared framebuffer proof corpus', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-extension-identifier-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'identifier-proof')
  const corpus = path.join(
    repoRoot,
    'tests/fixtures/desktop-world-framebuffer-proof-identifiers.json',
  )
  try {
    await writeFile(main, `
import Foundation

let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let corpus = try JSONSerialization.jsonObject(with: data) as! [String: [String]]
precondition(corpus["valid"]!.allSatisfy(aosSceneExtensionIdentifierIsCanonical))
precondition(corpus["invalid"]!.allSatisfy { !aosSceneExtensionIdentifierIsCanonical($0) })
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/shared/scene-extension-identifier.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    assert.doesNotThrow(() => execFileSync(executable, [corpus], { cwd: repoRoot, stdio: 'pipe' }))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

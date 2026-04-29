import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const schemaSpecs = [
  ['run-control', 'shared/schemas/run-control.schema.json'],
  ['agent-action', 'shared/schemas/agent-action.schema.json'],
  ['intent-event', 'shared/schemas/intent-event.schema.json'],
  ['human-mark', 'shared/schemas/human-mark.schema.json'],
  ['evidence-item', 'shared/schemas/evidence-item.schema.json'],
  ['source-pack', 'shared/schemas/source-pack.schema.json'],
]

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort()
}

function runJsonschema(schemaPath, fixturePath) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      path.join(repoRoot, schemaPath),
      fixturePath,
    ],
    { encoding: 'utf8' },
  )
}

for (const [name, schemaPath] of schemaSpecs) {
  test(`${name} positive fixtures match schema`, async () => {
    const fixtures = await jsonFiles(path.join(repoRoot, 'shared/schemas/fixtures', name, 'valid'))
    assert.ok(fixtures.length >= 1, `expected valid ${name} fixtures`)
    for (const fixture of fixtures) {
      const result = runJsonschema(schemaPath, fixture)
      assert.equal(
        result.status,
        0,
        `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
      )
    }
  })

  test(`${name} negative fixtures are rejected`, async () => {
    const fixtures = await jsonFiles(path.join(repoRoot, 'shared/schemas/fixtures', name, 'invalid'))
    assert.ok(fixtures.length >= 1, `expected invalid ${name} fixtures`)
    for (const fixture of fixtures) {
      const result = runJsonschema(schemaPath, fixture)
      assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`)
    }
  })
}

test('browser mark fixtures include locator candidates with mark-time validation', async () => {
  const fixturePath = path.join(repoRoot, 'shared/schemas/fixtures/intent-event/valid/browser-element.json')
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
  const candidates = fixture.anchors.replay.locator_candidates

  assert.ok(candidates.length >= 3)
  assert.deepEqual(candidates.map((candidate) => candidate.id), ['role_name', 'text', 'css'])
  assert.ok(candidates.every((candidate) => candidate.validated_at_mark_time === true))
  assert.equal(fixture.anchors.replay.selected_locator, 'role_name')
})

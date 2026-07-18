import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const schemaPath = path.join(repoRoot, 'shared/schemas/scene-event-v1.schema.json')
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/scene-event-v1')

async function fixtures(kind) {
  const directory = path.join(fixtureRoot, kind)
  return (await fs.readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(directory, name))
}

function validate(fixture) {
  return spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = list(Draft202012Validator(schema).iter_errors(instance))
if errors:
    print(errors[0].message)
    sys.exit(1)
`, schemaPath, fixture], { encoding: 'utf8' })
}

test('valid scene events match the bounded public contract', async () => {
  for (const fixture of await fixtures('valid')) {
    const result = validate(fixture)
    assert.equal(result.status, 0, `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`)
  }
})

test('scene events reject undeclared product payloads', async () => {
  for (const fixture of await fixtures('invalid')) {
    assert.notEqual(validate(fixture).status, 0, `${path.relative(repoRoot, fixture)} should fail`)
  }
})

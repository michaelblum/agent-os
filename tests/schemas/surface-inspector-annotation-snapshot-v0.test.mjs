import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const schemaPath = path.join(repoRoot, 'shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json')
const validFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/valid/annotated.json')
const invalidBase64KeyFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/invalid/embedded-image-base64.json')
const invalidDataUrlValueFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/invalid/embedded-image-data-url-value.json')

function validateFixture(fixturePath) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=FormatChecker())
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:12]:
        print('/'.join(str(p) for p in error.path), error.message)
    sys.exit(1)
`,
      schemaPath,
      fixturePath,
    ],
    { encoding: 'utf8' },
  )
}

test('Surface Inspector annotation snapshot valid fixture matches the canonical schema', () => {
  const result = validateFixture(validFixturePath)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('Surface Inspector annotation snapshot schema rejects embedded image payload keys', () => {
  const result = validateFixture(invalidBase64KeyFixturePath)
  assert.notEqual(result.status, 0, 'invalid fixture unexpectedly passed')
  assert.match(`${result.stdout}${result.stderr}`, /capture_image_base64|property name/)
})

test('Surface Inspector annotation snapshot schema rejects embedded image data URL asset values', () => {
  const result = validateFixture(invalidDataUrlValueFixturePath)
  assert.notEqual(result.status, 0, 'invalid fixture unexpectedly passed')
  assert.match(`${result.stdout}${result.stderr}`, /capture_image|not valid/)
})

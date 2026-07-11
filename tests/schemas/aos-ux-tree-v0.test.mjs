import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveUxTree } from '../../packages/toolkit/runtime/ux-tree.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-ux-tree-v0.schema.json')
const validFixture = 'shared/schemas/fixtures/aos-ux-tree-v0/valid/example-control.json'
const invalidSchemaFixtures = [
  'shared/schemas/fixtures/aos-ux-tree-v0/invalid/executable-command.json',
  'shared/schemas/fixtures/aos-ux-tree-v0/invalid/embedded-resource.json',
]

function validateFixture(fixturePath) {
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
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      path.join(repoRoot, fixturePath),
    ],
    { encoding: 'utf8' },
  )
}

function validateInstance(instance) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
    ],
    { encoding: 'utf8', input: JSON.stringify(instance) },
  )
}

test('valid example control UX tree fixture matches the canonical schema', () => {
  const result = validateFixture(validFixture)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

for (const fixturePath of invalidSchemaFixtures) {
  test(`${fixturePath} is rejected by the canonical schema`, () => {
    const result = validateFixture(fixturePath)
    assert.notEqual(result.status, 0, 'fixture unexpectedly passed schema validation')
  })
}

test('canonical schema rejects embedded source refs case-insensitively', async () => {
  const fixture = JSON.parse(await readFile(path.join(repoRoot, validFixture), 'utf8'))
  const cases = [
    {
      label: 'lowercase data source ref',
      ref: 'data:text/plain;base64,SGk=',
      mutate(candidate, ref) {
        candidate.source_refs[0].ref = ref
      },
    },
    {
      label: 'mixed-case Data source ref',
      ref: 'Data:text/plain;base64,SGk=',
      mutate(candidate, ref) {
        candidate.source_refs[0].ref = ref
      },
    },
    {
      label: 'lowercase blob source ref',
      ref: 'blob:https://example.test/resource',
      mutate(candidate, ref) {
        candidate.source_refs[0].ref = ref
      },
    },
    {
      label: 'mixed-case blob node resource ref',
      ref: 'bLoB:https://example.test/resource',
      mutate(candidate, ref) {
        candidate.nodes[0].resource_refs = [{ id: 'embedded', kind: 'asset', ref }]
      },
    },
  ]

  for (const { label, ref, mutate } of cases) {
    const candidate = JSON.parse(JSON.stringify(fixture))
    mutate(candidate, ref)
    const result = validateInstance(candidate)
    assert.notEqual(result.status, 0, `${label} unexpectedly passed schema validation`)
  }
})

test('runtime resolver rejects invalid executable-command and embedded-resource fixtures', async () => {
  const cases = [
    {
      fixturePath: 'shared/schemas/fixtures/aos-ux-tree-v0/invalid/executable-command.json',
      code: 'command.handler_ref.type',
      strictPattern: /handler_ref must be a string/,
    },
    {
      fixturePath: 'shared/schemas/fixtures/aos-ux-tree-v0/invalid/embedded-resource.json',
      code: 'source.binary',
      strictPattern: /source refs must not embed data\/blob payloads/,
    },
  ]

  for (const { fixturePath, code, strictPattern } of cases) {
    const fixture = JSON.parse(await readFile(path.join(repoRoot, fixturePath), 'utf8'))
    const resolved = resolveUxTree(fixture)
    assert.equal(resolved.validation.ok, false, `${fixturePath} unexpectedly passed runtime validation`)
    assert.ok(
      resolved.validation.errors.some((error) => error.code === code),
      `${fixturePath} did not report ${code}`,
    )
    assert.throws(() => resolveUxTree(fixture, { strict: true }), strictPattern)
  }
})

test('runtime resolver reports binding references unknown to the schema alone', async () => {
  const fixture = JSON.parse(await readFile(
    path.join(repoRoot, 'shared/schemas/fixtures/aos-ux-tree-v0/invalid/unknown-binding-ref.json'),
    'utf8',
  ))
  const schemaResult = validateFixture('shared/schemas/fixtures/aos-ux-tree-v0/invalid/unknown-binding-ref.json')
  assert.equal(schemaResult.status, 0, `${schemaResult.stdout}${schemaResult.stderr}`)

  const resolved = resolveUxTree(fixture)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'binding.command_ref'))
})

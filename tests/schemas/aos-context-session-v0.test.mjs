import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-context-session-v0.schema.json')
const leafActiveFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/valid/leaf-active.json')
const ancestorActiveFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/valid/ancestor-active.json')
const multiArtifactKeyframeFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/valid/multi-artifact-keyframe.json')
const recordingFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/valid/recording.json')
const missingPathFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/missing-ordered-path.json')
const embeddedImageAssetFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/embedded-image-asset.json')
const embeddedImageRecordingAssetFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/embedded-image-recording-asset.json')
const blobKeyframeAssetFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/blob-keyframe-asset.json')
const leadingWhitespaceDataKeyframeAssetFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/leading-whitespace-data-keyframe-asset.json')
const blobRecordingAssetUriFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/blob-recording-asset-uri.json')
const leadingWhitespaceDataRecordingAssetUriFixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-context-session-v0/invalid/leading-whitespace-data-recording-asset-uri.json')

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
    for error in errors[:16]:
        print('/'.join(str(p) for p in error.path), error.message)
    sys.exit(1)
`,
      schemaPath,
      fixturePath,
    ],
    { encoding: 'utf8' },
  )
}

test('AOS context session schema accepts active leaf fixture', () => {
  const result = validateFixture(leafActiveFixturePath)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('AOS context session schema accepts ancestor active target fixture', () => {
  const result = validateFixture(ancestorActiveFixturePath)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('AOS context session schema accepts multi-artifact keyframe fixture', () => {
  const result = validateFixture(multiArtifactKeyframeFixturePath)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('AOS context session schema accepts context recording fixture', () => {
  const result = validateFixture(recordingFixturePath)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('AOS context session schema rejects artifacts without ordered path and active target', () => {
  const result = validateFixture(missingPathFixturePath)
  assert.notEqual(result.status, 0, 'invalid fixture unexpectedly passed')
  assert.match(`${result.stdout}${result.stderr}`, /path|active_target_node_id/)
})

test('AOS context session schema rejects embedded image data URL assets', () => {
  const result = validateFixture(embeddedImageAssetFixturePath)
  assert.notEqual(result.status, 0, 'invalid fixture unexpectedly passed')
  assert.match(`${result.stdout}${result.stderr}`, /capture_image|not valid/)
})

test('AOS context session schema rejects embedded image data URL recording assets', () => {
  const result = validateFixture(embeddedImageRecordingAssetFixturePath)
  assert.notEqual(result.status, 0, 'invalid fixture unexpectedly passed')
  assert.match(`${result.stdout}${result.stderr}`, /capture_image|not valid/)
})

test('AOS context session schema rejects blob and leading-whitespace data asset refs', () => {
  for (const fixturePath of [
    blobKeyframeAssetFixturePath,
    leadingWhitespaceDataKeyframeAssetFixturePath,
    blobRecordingAssetUriFixturePath,
    leadingWhitespaceDataRecordingAssetUriFixturePath,
  ]) {
    const result = validateFixture(fixturePath)
    assert.notEqual(result.status, 0, `${fixturePath} unexpectedly passed`)
    assert.match(`${result.stdout}${result.stderr}`, /asset_refs|not valid/)
  }
})

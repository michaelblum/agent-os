import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const schema = JSON.parse(await readFile(
  path.join(repoRoot, 'shared/schemas/aos-screen-recording-v1.schema.json'),
  'utf8',
))
const topologySchema = JSON.parse(await readFile(
  path.join(repoRoot, 'shared/schemas/display-topology-v1.schema.json'),
  'utf8',
))
const topology = JSON.parse(await readFile(
  path.join(repoRoot, 'shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json'),
  'utf8',
))
const SHA = 'a'.repeat(64)

const validate = (definition, instance) => {
  const script = String.raw`
import json, sys
from jsonschema import Draft202012Validator, RefResolver
p=json.load(sys.stdin)
root={"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":p["schema"]["$id"]+"#/$defs/"+p["definition"]}
store={p["schema"]["$id"]:p["schema"],p["topology_schema"]["$id"]:p["topology_schema"]}
Draft202012Validator.check_schema(p["schema"])
errors=list(Draft202012Validator(root,resolver=RefResolver.from_schema(root,store=store)).iter_errors(p["instance"]))
json.dump([e.message for e in errors],sys.stdout)
`
  const result = spawnSync('python3', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify({ schema, topology_schema: topologySchema, definition, instance }),
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const base = {
  schema_version: 'aos.screen-recording.request.v1',
  request_id: 'request-1',
  canonical_parameter_digest: SHA,
  topology,
  target: { kind: 'display', display_ordinal: 1 },
  duration_ms: 300_000,
  frame_rate: 60,
  max_pixel_count: 33_177_600,
  max_queue_frames: 8,
  max_output_bytes: 1_073_741_824,
  tracks: { video: true, system_audio: false, microphone: false },
  codec: 'h264',
  container: 'quicktime',
}

test('screen-recording schema accepts only the exact video-only fixed success shape', () => {
  assert.deepEqual(validate('request', base), [])
  const admission = {
    schema_version: 'aos.screen-recording.admission-result.v1',
    operation: { operation_id: 'operation-1', operation_generation: 1 },
    stream: { stream_id: 'stream-1', stream_generation: 2 },
    artifact: { artifact_id: 'artifact-1', artifact_generation: 3 },
    daemon_generation: 4,
    geometry_binding_digest: SHA,
    tracks: base.tracks,
    codec: 'h264',
    container: 'quicktime',
  }
  assert.deepEqual(validate('admission_result', admission), [])
})

test('screen-recording schema rejects audio, follow-like extras, and every upper-bound breach', () => {
  const invalid = [
    { ...base, tracks: { ...base.tracks, system_audio: true } },
    { ...base, tracks: { ...base.tracks, microphone: true } },
    { ...base, follow: true },
    { ...base, duration_ms: 300_001 },
    { ...base, frame_rate: 61 },
    { ...base, max_pixel_count: 33_177_601 },
    { ...base, max_queue_frames: 9 },
    { ...base, max_output_bytes: 1_073_741_825 },
  ]
  for (const value of invalid) assert.ok(validate('request', value).length > 0)
})

test('display, window, and single-display global region are the complete target set', () => {
  const targets = [
    { kind: 'display', display_ordinal: 1 },
    { kind: 'window', display_ordinal: 1, window_id: 7, owner_pid: 9, global_bounds: { x: 1, y: 2, width: 4, height: 6 } },
    { kind: 'region', display_ordinal: 1, global_bounds: { x: 1, y: 2, width: 4, height: 6 } },
  ]
  for (const target of targets) assert.deepEqual(validate('target', target), [])
  assert.ok(validate('target', { kind: 'browser-element', display_ordinal: 1 }).length > 0)
})

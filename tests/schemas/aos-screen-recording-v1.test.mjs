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

const trackTruth = (selected, overrides = {}) => ({
  selected,
  admitted: selected,
  available: false,
  first_sample_present: false,
  sample_count: 0,
  sample_byte_count: 0,
  failure_code: null,
  drained: !selected,
  finalized: !selected,
  ...overrides,
})

const trackSummary = (systemAudio, overrides = {}) => ({
  selected_tracks: systemAudio ? ['video', 'system_audio'] : ['video'],
  finalized_tracks: [],
  common_media_epoch_ns: null,
  video: trackTruth(true),
  system_audio: trackTruth(systemAudio),
  ...overrides,
})

const successfulTrackSummary = (systemAudio) => trackSummary(systemAudio, {
  finalized_tracks: systemAudio ? ['video', 'system_audio'] : ['video'],
  common_media_epoch_ns: 1_000_000,
  video: trackTruth(true, {
    available: true, first_sample_present: true, sample_count: 3,
    sample_byte_count: 300, drained: true, finalized: true,
  }),
  system_audio: trackTruth(systemAudio, systemAudio ? {
    available: true, first_sample_present: true, sample_count: 5,
    sample_byte_count: 500, drained: true, finalized: true,
  } : {}),
})

test('screen-recording schema accepts exact fixed video-only and optional-system-audio shapes', () => {
  assert.deepEqual(validate('request', base), [])
  assert.deepEqual(validate('request', {
    ...base,
    tracks: { ...base.tracks, system_audio: true },
  }), [])
  const admission = {
    schema_version: 'aos.screen-recording.admission-result.v1',
    operation: { operation_id: 'operation-1', operation_generation: 1 },
    stream: { stream_id: 'stream-1', stream_generation: 2 },
    artifact: { artifact_id: 'artifact-1', artifact_generation: 3 },
    daemon_generation: 4,
    geometry_binding_digest: SHA,
    tracks: base.tracks,
    track_summary: trackSummary(false),
    codec: 'h264',
    container: 'quicktime',
  }
  assert.deepEqual(validate('admission_result', admission), [])
  assert.ok(validate('admission_result', {
    ...admission,
    tracks: { ...base.tracks, system_audio: true },
  }).length > 0)
})

test('screen-recording schema rejects microphone, implicit or malformed tracks, follow extras, and bounds breaches', () => {
  const invalid = [
    { ...base, tracks: { ...base.tracks, microphone: true } },
    { ...base, tracks: { video: true, microphone: false } },
    { ...base, tracks: { ...base.tracks, system_audio: 'yes' } },
    { ...base, tracks: { ...base.tracks, video: false } },
    { ...base, follow: true },
    { ...base, duration_ms: 300_001 },
    { ...base, frame_rate: 61 },
    { ...base, max_pixel_count: 33_177_601 },
    { ...base, max_queue_frames: 9 },
    { ...base, max_output_bytes: 1_073_741_825 },
    { ...base, request_id: 'bad id' },
    { ...base, duration_ms: true },
    { ...base, frame_rate: 1.5 },
    { ...base, target: { kind: 'display', display_ordinal: true } },
    { ...base, target: { kind: 'window', display_ordinal: 1, window_id: 1.5, owner_pid: 9, global_bounds: { x: 1, y: 2, width: 4, height: 6 } } },
  ]
  for (const value of invalid) assert.ok(validate('request', value).length > 0)
})

test('track summaries are closed and independently bind selection, samples, failures, drain, and finalization', () => {
  assert.deepEqual(validate('track_summary', trackSummary(false)), [])
  assert.deepEqual(validate('track_summary', trackSummary(true, {
    video: trackTruth(true, {
      available: true, first_sample_present: true,
      sample_count: 1, sample_byte_count: 100,
    }),
  })), [])
  assert.deepEqual(validate('track_summary', trackSummary(true, {
    finalized_tracks: ['video', 'system_audio'],
    common_media_epoch_ns: 1_000_000,
    video: trackTruth(true, {
      available: true, first_sample_present: true, sample_count: 3,
      sample_byte_count: 300, drained: true, finalized: true,
    }),
    system_audio: trackTruth(true, {
      available: true, first_sample_present: true, sample_count: 5,
      sample_byte_count: 500, drained: true, finalized: true,
    }),
  })), [])
  const invalid = [
    { ...trackSummary(true), selected_tracks: [] },
    { ...trackSummary(true), selected_tracks: ['system_audio', 'video'] },
    { ...trackSummary(true), finalized_tracks: ['system_audio'] },
    { ...trackSummary(true), source_name: 'private' },
    { ...trackSummary(true), video: { ...trackTruth(true), sample_count: -1 } },
    { ...trackSummary(true), video: { ...trackTruth(true), first_sample_present: true } },
    {
      ...trackSummary(true),
      video: {
        ...trackTruth(true), available: true, first_sample_present: true,
        sample_count: 0, sample_byte_count: 100,
      },
    },
    {
      ...trackSummary(true),
      video: {
        ...trackTruth(true), available: true, first_sample_present: true,
        sample_count: 1, sample_byte_count: 0,
      },
    },
    { ...trackSummary(true), video: { ...trackTruth(true), finalized: true, drained: false } },
    { ...trackSummary(true), video: { ...trackTruth(true), finalized: true } },
    { ...trackSummary(true, { finalized_tracks: ['video'] }), video: trackTruth(true) },
    {
      ...trackSummary(true),
      system_audio: { ...trackTruth(true), selected: false, admitted: false, finalized: true },
    },
    {
      ...trackSummary(false),
      system_audio: { ...trackTruth(false), available: true },
    },
    { ...trackSummary(true), system_audio: { ...trackTruth(true), failure_code: 'private detail' } },
  ]
  for (const value of invalid) assert.ok(validate('track_summary', value).length > 0)
})

test('successful results bind request tracks, nonempty finalized truth, and artifact presence', () => {
  const completion = {
    schema_version: 'aos.screen-recording.result.v1',
    operation: { operation_id: 'operation-1', operation_generation: 1 },
    artifact: { artifact_id: 'artifact-1', artifact_generation: 2 },
    outcome: 'succeeded',
    frame_count: 3,
    byte_count: 800,
    duration_ms: 1_000,
    tracks: base.tracks,
    track_summary: successfulTrackSummary(false),
    codec: 'h264',
    container: 'quicktime',
    cleanup_result: 'zero_residuals',
  }
  assert.deepEqual(validate('completion_result', completion), [])
  const invalid = [
    { ...completion, artifact: null },
    {
      ...completion,
      tracks: { ...base.tracks, system_audio: true },
    },
    {
      ...completion,
      track_summary: {
        ...successfulTrackSummary(false),
        video: {
          ...successfulTrackSummary(false).video,
          sample_byte_count: 0,
        },
      },
    },
    {
      ...completion,
      tracks: { ...base.tracks, system_audio: true },
      track_summary: {
        ...successfulTrackSummary(true),
        system_audio: {
          ...successfulTrackSummary(true).system_audio,
          sample_byte_count: 0,
        },
      },
    },
  ]
  for (const value of invalid) assert.ok(validate('completion_result', value).length > 0)
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

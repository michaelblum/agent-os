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
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
p=json.load(sys.stdin)
root={"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":p["schema"]["$id"]+"#/$defs/"+p["definition"]}
registry=Registry()
for schema in [p["schema"],p["topology_schema"]]:
    registry=registry.with_resource(schema["$id"],Resource.from_contents(schema))
Draft202012Validator.check_schema(p["schema"])
errors=list(Draft202012Validator(root,registry=registry).iter_errors(p["instance"]))
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
  geometry: { mode: 'fixed' },
  duration_ms: 300_000,
  frame_rate: 60,
  max_pixel_count: 33_177_600,
  max_queue_frames: 8,
  max_output_bytes: 1_073_741_824,
  tracks: { video: true, system_audio: false, microphone: false },
  codec: 'h264',
  container: 'quicktime',
}

const fixedGeometryTruth = {
  mode: 'fixed',
  geometry_generation: 1,
  binding_digest: SHA,
  source_rect: { x: 0, y: 0, width: 100, height: 80 },
  pixel_width: 200,
  pixel_height: 160,
  update_interval_ms: null,
  update_deadline_ms: null,
  last_accepted_observation_generation: null,
  last_accepted_state_generation: null,
  pending_update: false,
  next_deadline: {
    state: 'not_applicable',
    not_before_monotonic_ns: null,
    deadline_monotonic_ns: null,
  },
}

const bindingIdentity = (id, generation) => ({ id, generation })
const followBinding = (observation = 1, state = 1) => ({
  target: bindingIdentity('target', 1),
  observation: bindingIdentity('observation', observation),
  state: bindingIdentity('state', state),
  session: bindingIdentity('session', 1),
  navigation: bindingIdentity('navigation', 1),
  frame: bindingIdentity('frame', 1),
  source_window: { window_id: 77, owner_pid: 700 },
})

const followedGeometryTruth = {
  ...fixedGeometryTruth,
  mode: 'caller_followed',
  update_interval_ms: 100,
  update_deadline_ms: 500,
  last_accepted_observation_generation: 2,
  last_accepted_state_generation: 2,
  next_deadline: {
    state: 'armed',
    not_before_monotonic_ns: 1_100_000_000,
    deadline_monotonic_ns: 1_500_000_000,
  },
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

const selectedTrackNames = (systemAudio, microphone) => [
  'video',
  ...(systemAudio ? ['system_audio'] : []),
  ...(microphone ? ['microphone'] : []),
]

const trackSummary = (systemAudio, microphone, overrides = {}) => ({
  selected_tracks: selectedTrackNames(systemAudio, microphone),
  finalized_tracks: [],
  common_media_epoch_ns: null,
  video: trackTruth(true),
  system_audio: trackTruth(systemAudio),
  microphone: trackTruth(microphone),
  ...overrides,
})

const successfulTrackSummary = (systemAudio, microphone) => trackSummary(systemAudio, microphone, {
  finalized_tracks: selectedTrackNames(systemAudio, microphone),
  common_media_epoch_ns: 1_000_000,
  video: trackTruth(true, {
    available: true, first_sample_present: true, sample_count: 3,
    sample_byte_count: 300, drained: true, finalized: true,
  }),
  system_audio: trackTruth(systemAudio, systemAudio ? {
    available: true, first_sample_present: true, sample_count: 5,
    sample_byte_count: 500, drained: true, finalized: true,
  } : {}),
  microphone: trackTruth(microphone, microphone ? {
    available: true, first_sample_present: true, sample_count: 7,
    sample_byte_count: 700, drained: true, finalized: true,
  } : {}),
})

test('screen-recording schema accepts all four exact video, system-audio, and microphone selections', () => {
  assert.deepEqual(validate('request', base), [])
  for (const [system_audio, microphone] of [[true, false], [false, true], [true, true]]) {
    assert.deepEqual(validate('request', {
      ...base,
      tracks: { ...base.tracks, system_audio, microphone },
    }), [])
  }
  const admission = {
    schema_version: 'aos.screen-recording.admission-result.v1',
    operation: { operation_id: 'operation-1', operation_generation: 1 },
    stream: { stream_id: 'stream-1', stream_generation: 2 },
    artifact: { artifact_id: 'artifact-1', artifact_generation: 3 },
    daemon_generation: 4,
    geometry: fixedGeometryTruth,
    tracks: base.tracks,
    track_summary: trackSummary(false, false),
    codec: 'h264',
    container: 'quicktime',
  }
  assert.deepEqual(validate('admission_result', admission), [])
  assert.ok(validate('admission_result', {
    ...admission,
    tracks: { ...base.tracks, system_audio: true },
  }).length > 0)
})

test('screen-recording schema rejects implicit or malformed tracks, follow extras, and bounds breaches', () => {
  const invalid = [
    { ...base, tracks: { video: true, microphone: false } },
    { ...base, geometry: undefined },
    { ...base, tracks: { ...base.tracks, system_audio: 'yes' } },
    { ...base, tracks: { ...base.tracks, microphone: 'yes' } },
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

test('caller-followed request, update, and accepted truth are closed and region-only', () => {
  const followed = {
    ...base,
    target: { kind: 'region', display_ordinal: 1, global_bounds: { x: 1, y: 2, width: 40, height: 30 } },
    geometry: {
      mode: 'caller_followed',
      binding: followBinding(),
      update_interval_ms: 100,
      update_deadline_ms: 500,
    },
  }
  assert.deepEqual(validate('request', followed), [])
  const update = {
    request_id: 'update-1',
    canonical_parameter_digest: SHA,
    selector: { operation_id: 'operation-1', operation_generation: 1 },
    expected_geometry_generation: 1,
    topology,
    target: { kind: 'region', display_ordinal: 1, global_bounds: { x: 2, y: 2, width: 40, height: 30 } },
    binding: followBinding(2, 2),
  }
  assert.deepEqual(validate('follow_update_request', update), [])
  assert.deepEqual(validate('follow_update_result', {
    schema_version: 'aos.screen-recording.follow-update-result.v1',
    operation: update.selector,
    geometry: followedGeometryTruth,
  }), [])
  const impossibleTruth = [
    { ...fixedGeometryTruth, update_interval_ms: 100 },
    { ...fixedGeometryTruth, update_deadline_ms: 500 },
    { ...fixedGeometryTruth, last_accepted_observation_generation: 1 },
    { ...fixedGeometryTruth, last_accepted_state_generation: 1 },
    { ...fixedGeometryTruth, next_deadline: {
      ...fixedGeometryTruth.next_deadline,
      not_before_monotonic_ns: 1,
    } },
    { ...fixedGeometryTruth, next_deadline: {
      ...fixedGeometryTruth.next_deadline,
      deadline_monotonic_ns: 1,
    } },
    { ...followedGeometryTruth, update_interval_ms: null },
    { ...followedGeometryTruth, update_deadline_ms: null },
    { ...followedGeometryTruth, last_accepted_observation_generation: null },
    { ...followedGeometryTruth, last_accepted_state_generation: null },
    { ...followedGeometryTruth, next_deadline: {
      state: 'not_applicable',
      not_before_monotonic_ns: null,
      deadline_monotonic_ns: null,
    } },
    { ...followedGeometryTruth, next_deadline: {
      state: 'armed',
      not_before_monotonic_ns: null,
      deadline_monotonic_ns: null,
    } },
    { ...followedGeometryTruth, next_deadline: {
      state: 'stopped',
      not_before_monotonic_ns: 1,
      deadline_monotonic_ns: 2,
    } },
  ]
  for (const truth of impossibleTruth) {
    assert.ok(validate('geometry_truth', truth).length > 0)
  }
  for (const invalid of [
    { ...followed, target: base.target },
    { ...followed, geometry: { ...followed.geometry, update_interval_ms: true } },
    { ...followed, geometry: { ...followed.geometry, extra: true } },
    { ...update, target: base.target },
    { ...update, expected_geometry_generation: 1.5 },
    { ...update, file: '/tmp/private' },
  ]) {
    const definition = 'schema_version' in invalid ? 'request' : 'follow_update_request'
    assert.ok(validate(definition, invalid).length > 0)
  }
})

test('track summaries are closed and independently bind selection, samples, failures, drain, and finalization', () => {
  assert.deepEqual(validate('track_summary', trackSummary(false, false)), [])
  assert.deepEqual(validate('track_summary', trackSummary(true, true, {
    video: trackTruth(true, {
      available: true, first_sample_present: true,
      sample_count: 1, sample_byte_count: 100,
    }),
  })), [])
  assert.deepEqual(validate('track_summary', trackSummary(true, true, {
    finalized_tracks: ['video', 'system_audio', 'microphone'],
    common_media_epoch_ns: 1_000_000,
    video: trackTruth(true, {
      available: true, first_sample_present: true, sample_count: 3,
      sample_byte_count: 300, drained: true, finalized: true,
    }),
    system_audio: trackTruth(true, {
      available: true, first_sample_present: true, sample_count: 5,
      sample_byte_count: 500, drained: true, finalized: true,
    }),
    microphone: trackTruth(true, {
      available: true, first_sample_present: true, sample_count: 7,
      sample_byte_count: 700, drained: true, finalized: true,
    }),
  })), [])
  const invalid = [
    { ...trackSummary(true, true), selected_tracks: [] },
    { ...trackSummary(true, true), selected_tracks: ['system_audio', 'video', 'microphone'] },
    { ...trackSummary(true, true), finalized_tracks: ['microphone'] },
    { ...trackSummary(true, true), source_name: 'private' },
    { ...trackSummary(true, true), video: { ...trackTruth(true), sample_count: -1 } },
    { ...trackSummary(true, true), video: { ...trackTruth(true), first_sample_present: true } },
    {
      ...trackSummary(true, true),
      video: {
        ...trackTruth(true), available: true, first_sample_present: true,
        sample_count: 0, sample_byte_count: 100,
      },
    },
    {
      ...trackSummary(true, true),
      video: {
        ...trackTruth(true), available: true, first_sample_present: true,
        sample_count: 1, sample_byte_count: 0,
      },
    },
    { ...trackSummary(true, true), video: { ...trackTruth(true), finalized: true, drained: false } },
    { ...trackSummary(true, true), video: { ...trackTruth(true), finalized: true } },
    { ...trackSummary(true, true, { finalized_tracks: ['video'] }), video: trackTruth(true) },
    {
      ...trackSummary(true, true),
      system_audio: { ...trackTruth(true), selected: false, admitted: false, finalized: true },
    },
    {
      ...trackSummary(false, false),
      system_audio: { ...trackTruth(false), available: true },
    },
    {
      ...trackSummary(true, true),
      microphone: { ...trackTruth(true), selected: false, admitted: false, finalized: true },
    },
    {
      ...trackSummary(false, false),
      microphone: { ...trackTruth(false), available: true },
    },
    { ...trackSummary(true, true), microphone: { ...trackTruth(true), failure_code: 'private detail' } },
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
    track_summary: successfulTrackSummary(false, false),
    geometry: fixedGeometryTruth,
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
        ...successfulTrackSummary(false, false),
        video: {
          ...successfulTrackSummary(false, false).video,
          sample_byte_count: 0,
        },
      },
    },
    {
      ...completion,
      tracks: { ...base.tracks, system_audio: true },
      track_summary: {
        ...successfulTrackSummary(true, false),
        system_audio: {
          ...successfulTrackSummary(true, false).system_audio,
          sample_byte_count: 0,
        },
      },
    },
    {
      ...completion,
      tracks: { ...base.tracks, microphone: true },
      track_summary: {
        ...successfulTrackSummary(false, true),
        microphone: {
          ...successfulTrackSummary(false, true).microphone,
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

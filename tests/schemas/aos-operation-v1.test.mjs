import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const schemaDirectory = path.join(repoRoot, 'shared', 'schemas');
const schemaNames = [
  'aos-operation-v1.schema.json',
  'aos-operation-event-v1.schema.json',
  'aos-operation-lineage-v1.schema.json',
  'aos-stream-v1.schema.json',
  'aos-operation-tap-v1.schema.json',
  'aos-artifact-v1.schema.json',
  'aos-host-stop-barrier-v1.schema.json',
  'aos-operation-recovery-v1.schema.json',
];
const schemas = Object.fromEntries(schemaNames.map((name) => {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, name), 'utf8'));
  return [schema.$id, schema];
}));
const recordingSchema = JSON.parse(fs.readFileSync(
  path.join(schemaDirectory, 'aos-screen-recording-v1.schema.json'),
  'utf8',
));
const ids = Object.keys(schemas);
const byName = Object.fromEntries(schemaNames.map((name) => [
  name,
  schemas[ids.find((id) => id.endsWith(`/${name}`))],
]));
const daemonResponseSchema = JSON.parse(
  fs.readFileSync(path.join(schemaDirectory, 'daemon-response.schema.json'), 'utf8'),
);
const daemonResponseID = daemonResponseSchema.$id;

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const TIMESTAMP = '2026-08-16T12:00:00.000Z';
const LINEAGE_ID = byName['aos-operation-lineage-v1.schema.json'].$id;
const OPERATION_ID = byName['aos-operation-v1.schema.json'].$id;
const TAP_ID = byName['aos-operation-tap-v1.schema.json'].$id;
const ARTIFACT_ID = byName['aos-artifact-v1.schema.json'].$id;
const BARRIER_ID = byName['aos-host-stop-barrier-v1.schema.json'].$id;
const RECOVERY_ID = byName['aos-operation-recovery-v1.schema.json'].$id;
const EVENT_ID = byName['aos-operation-event-v1.schema.json'].$id;
const STREAM_ID = byName['aos-stream-v1.schema.json'].$id;

const pythonValidator = String.raw`
import json, sys
from jsonschema import Draft202012Validator, FormatChecker, RefResolver

payload = json.load(sys.stdin)
store = {schema["$id"]: schema for schema in payload["schemas"]}
for schema in store.values():
    Draft202012Validator.check_schema(schema)

results = []
for case in payload["cases"]:
    target = store[case["schema_id"]]
    if case.get("definition"):
        target = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$ref": case["schema_id"] + "#/$defs/" + case["definition"],
        }
    resolver = RefResolver.from_schema(target, store=store)
    validator = Draft202012Validator(target, resolver=resolver, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(case["instance"]), key=lambda error: list(error.path))
    results.append({
        "valid": not errors,
        "errors": [error.message for error in errors[:8]],
    })
json.dump(results, sys.stdout)
`;

function validateCases(cases) {
  const result = spawnSync('python3', ['-c', pythonValidator], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify({ schemas: [...Object.values(schemas), recordingSchema], cases }),
    timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertValidation(cases) {
  const results = validateCases(cases);
  cases.forEach((entry, index) => {
    assert.equal(
      results[index].valid,
      entry.expected,
      `${entry.label}: expected ${entry.expected ? 'valid' : 'invalid'}; ${results[index].errors.join('; ')}`,
    );
  });
}

function target(schemaId, definition, instance, expected, label) {
  return { schema_id: schemaId, definition, instance, expected, label };
}

const peerEvidence = {
  audit_token: SHA_A,
  effective_uid: 501,
  pid: 111,
  pid_generation: 7,
};

const operationLineage = {
  schema_version: 'aos.operation-lineage.v1',
  operation_id: 'operation-1',
  operation_generation: 1,
  owner_root: {
    capture_phase: 'local_socket_accept',
    resolver_outcome: 'direct_non_aos_peer',
    immediate_peer: peerEvidence,
    selected_boundary: {
      effective_uid: 501,
      pid: 111,
      pid_generation: 7,
      executable_identity_digest: SHA_B,
      executable_file_digest: SHA_C,
    },
    ancestor_edges: [],
    adapter_skip_proofs: [],
    captured_at: TIMESTAMP,
  },
  parent_operation: null,
  mechanically_bound_scopes: [],
  asserted_attribution: {
    client_id: 'sigil',
    agent_id: 'agent-1',
    task_id: 'task-1',
    project_id: 'project-1',
    run_id: 'run-1',
    skill_id: 'skill-1',
    target_id: 'target-1',
    capability_label: 'microphone',
  },
};

const zeroCleanup = {
  result: 'zero_residuals',
  residual: { classification: 'none', count: 0, digest: SHA_A },
  completed_at: TIMESTAMP,
};

const operation = {
  schema_version: 'aos.operation.v1',
  operation_id: 'operation-1',
  operation_generation: 1,
  daemon_generation: 2,
  adapter_registry_revision: 1,
  adapter_registration: {
    adapter_registration_id: 'microphone-capture-adapter',
    adapter_registration_revision: 1,
  },
  capability_id: 'microphone.capture',
  status_indicator_class: 'recording',
  state: 'prepared',
  lineage: operationLineage,
  requested_bounds: { max_duration_ms: 60_000 },
  progress: { items: 0, bytes: 0, duration_ms: 0, last_event_sequence: 0 },
  claim_set_transactions: [],
  resource_claims: [],
  multiplex_brokers: [],
  streams: [],
  taps: [],
  artifacts: [],
  cleanup: {
    result: 'not_started',
    residual: { classification: 'none', count: 0, digest: SHA_A },
    completed_at: null,
  },
  terminal: null,
  prepared_at: TIMESTAMP,
  started_at: null,
  updated_at: TIMESTAMP,
};

const stream = {
  schema_version: 'aos.stream.v1',
  stream_id: 'stream-1',
  stream_generation: 1,
  operation_id: 'operation-1',
  operation_generation: 1,
  daemon_generation: 2,
  state: 'prepared',
  source: { source_kind: 'microphone', source_generation: 1, source_identity_digest: SHA_A },
  transport: { transport_kind: 'ipc', transport_generation: 1, transport_identity_digest: SHA_B },
  bounds: { max_duration_ms: 60_000, max_bytes: 1_048_576, max_queue_items: 64 },
  counters: {
    last_sequence: 0,
    source_items: 0,
    enqueued_items: 0,
    delivered_items: 0,
    enqueued_bytes: 0,
    delivered_bytes: 0,
    lost_items: 0,
    queue_high_water_items: 0,
  },
  frontier: { state: 'open', next_sequence: 1, reason: 'active' },
  taps: [],
  transient_data_retention: 'none',
  cleanup: { result: 'not_started', residual_count: 0, residual_digest: SHA_A, completed_at: null },
  terminal: null,
  prepared_at: TIMESTAMP,
  activated_at: null,
  updated_at: TIMESTAMP,
};

const tapBounds = {
  rate_items_per_second: 30,
  sample_every: 1,
  max_queue_items: 64,
  max_items: 1000,
  max_bytes: 1_048_576,
  idle_timeout_milliseconds: 30_000,
  duration_milliseconds: 60_000,
};

const tapCounters = {
  source_seen: 10,
  sample_skipped: 0,
  rate_skipped: 0,
  enqueued_items: 10,
  enqueued_bytes: 100,
  delivered_items: 10,
  delivered_bytes: 100,
  queue_high_water: 2,
  overflow_rejected_count: 0,
};

const tap = {
  schema_version: 'aos.operation-tap.v1',
  tap_id: 'tap-1',
  tap_generation: 1,
  operation_id: 'operation-1',
  operation_generation: 1,
  source_id: 'stream-1',
  source_generation: 1,
  daemon_generation: 2,
  state: 'active',
  channel: 'metadata',
  bounds: tapBounds,
  follow: false,
  observation_only: true,
  raw_data_retention: 'none',
  counters: tapCounters,
  terminal_bound_reason: null,
  cleanup: { result: 'not_started', residual_count: 0, residual_digest: SHA_A, completed_at: null },
  prepared_at: TIMESTAMP,
  activated_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const videoTrackSummary = {
  selected_tracks: ['video'],
  finalized_tracks: ['video'],
  common_media_epoch_ns: 1,
  video: {
    selected: true, admitted: true, available: true, first_sample_present: true,
    sample_count: 1, sample_byte_count: 100, failure_code: null,
    drained: true, finalized: true,
  },
  system_audio: {
    selected: false, admitted: false, available: false, first_sample_present: false,
    sample_count: 0, sample_byte_count: 0, failure_code: null,
    drained: true, finalized: true,
  },
  microphone: {
    selected: false, admitted: false, available: false, first_sample_present: false,
    sample_count: 0, sample_byte_count: 0, failure_code: null,
    drained: true, finalized: true,
  },
};

const audioTrackSummary = {
  selected_tracks: ['video', 'system_audio'],
  finalized_tracks: ['video', 'system_audio'],
  common_media_epoch_ns: 1,
  video: videoTrackSummary.video,
  system_audio: {
    selected: true, admitted: true, available: true, first_sample_present: true,
    sample_count: 1, sample_byte_count: 100, failure_code: null,
    drained: true, finalized: true,
  },
  microphone: videoTrackSummary.microphone,
};

const microphoneTrackSummary = {
  selected_tracks: ['video', 'microphone'],
  finalized_tracks: ['video', 'microphone'],
  common_media_epoch_ns: 1,
  video: videoTrackSummary.video,
  system_audio: videoTrackSummary.system_audio,
  microphone: {
    selected: true, admitted: true, available: true, first_sample_present: true,
    sample_count: 1, sample_byte_count: 100, failure_code: null,
    drained: true, finalized: true,
  },
};

const fixedGeometryTruth = {
  mode: 'fixed',
  geometry_generation: 1,
  binding_digest: SHA_A,
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
};

const followedGeometryTruth = {
  mode: 'caller_followed',
  geometry_generation: 2,
  binding_digest: SHA_B,
  source_rect: { x: 20, y: 10, width: 100, height: 80 },
  pixel_width: 200,
  pixel_height: 160,
  update_interval_ms: 100,
  update_deadline_ms: 500,
  last_accepted_observation_generation: 2,
  last_accepted_state_generation: 2,
  pending_update: false,
  next_deadline: {
    state: 'armed',
    not_before_monotonic_ns: 1_500_000_000,
    deadline_monotonic_ns: 1_600_000_000,
  },
};

const artifactIdentity = {
  containment_root_digest: SHA_A,
  relative_locator_digest: SHA_B,
  device: 1,
  inode: 2,
  size_bytes: 100,
  content_digest: SHA_C,
  media_type: 'video/quicktime; codecs=avc1',
  track_summary: videoTrackSummary,
};

const artifact = {
  schema_version: 'aos.artifact.v1',
  artifact_id: 'artifact-1',
  artifact_generation: 1,
  operation_id: 'operation-1',
  operation_generation: 1,
  daemon_generation: 2,
  state: 'offered',
  identity: artifactIdentity,
  original_custody_state: null,
  recovery_disposition: null,
  custody_receipt: null,
  cleanup_obligation: true,
  cleanup: { result: 'pending', residual_count: 0, residual_digest: SHA_A, completed_at: null },
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const recovery = {
  schema_version: 'aos.operation-recovery.v1',
  recovery_id: 'recovery-1',
  recovery_generation: 1,
  daemon_generation: 2,
  store_generation: 3,
  state: 'idle',
  integrity: { record_version: 1, record_checksum: SHA_A },
  exclusive_lock: {
    lock_id: 'recovery-lock-1',
    lock_generation: 1,
    holder_daemon_generation: 2,
    identity_digest: SHA_B,
  },
  scan_cursor: null,
  target: null,
  retry: { attempt: 0, maximum_attempts: 10, backoff_ms: 0, not_before_monotonic_ms: 0 },
  corruption: null,
  residual: { count: 0, digest: SHA_A },
  result: null,
  blame: 'unknown',
  operator_acknowledgement_count: 0,
  started_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  completed_at: null,
};

const immutableBarrierSnapshot = {
  barrier_generation: 2,
  stop_operation_id: 'stop-operation-1',
  stop_operation_generation: 1,
  adapter_registry_revision: 1,
  registered_operation_set_count: 1,
  registered_operation_set_digest: SHA_A,
  selected_operation_count: 1,
  selected_operation_digest: SHA_B,
  barrier_snapshot_digest: SHA_C,
};

const openBarrier = {
  schema_version: 'aos.host-stop-barrier.record.v1',
  daemon_generation: 2,
  barrier_generation: 1,
  state: 'open',
  admission_open: true,
  immutable_stop_snapshot: null,
  open_snapshot: {
    barrier_generation: 1,
    adapter_registry_revision: 1,
    registered_operation_set_count: 1,
    registered_operation_set_digest: SHA_A,
    open_snapshot_digest: SHA_B,
  },
  progress: {
    residual_count: 0,
    residual_digest: SHA_A,
    cleanup_result: 'zero_residuals',
    reconciliation_state: 'complete',
  },
  updated_at: TIMESTAMP,
};

const stopReceipt = {
  schema_version: 'aos.host-stop-barrier.stop-all-receipt.v1',
  request_id: 'request-1',
  canonical_parameter_digest: SHA_A,
  expected_barrier_generation: 1,
  daemon_generation: 2,
  stop_operation_id: 'stop-operation-1',
  stop_operation_generation: 1,
  caller_origin: 'live_transport_peer',
  caller_origin_evidence: peerEvidence,
  scope: 'registered_operation_plane_at_adapter_registry_revision',
  prior_barrier_state: 'open',
  prior_barrier_generation: 1,
  resulting_barrier_state: 'closing',
  resulting_barrier_generation: 2,
  adapter_registry_revision: 1,
  registered_operation_set_count: 1,
  registered_operation_set_digest: SHA_A,
  selected_operation_count: 1,
  selected_operation_digest: SHA_B,
  barrier_snapshot_digest: SHA_C,
  outcome: 'closing_started',
  residual_count: 1,
  residual_digest: SHA_A,
  cleanup_result: 'pending',
};

const event = {
  schema_version: 'aos.operation-event.v1',
  event_id: 'event-1',
  daemon_generation: 2,
  operation_id: 'operation-1',
  operation_generation: 1,
  sequence: 1,
  occurred_at: TIMESTAMP,
  event_digest: SHA_A,
  detail: {
    kind: 'lifecycle',
    machine: 'operation',
    from: 'prepared',
    event: 'authorize',
    to: 'starting',
    transition_kind: 'authority_acquisition',
    guard_id: 'peer_owner_adapter_valid',
    trigger: 'authority_authorized',
    terminal_outcome: null,
  },
};

test('all eight M2 schemas are uniquely identified Draft 2020-12 contracts with the expected top shapes', () => {
  assert.equal(new Set(ids).size, 8);
  for (const schema of Object.values(schemas)) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^https:\/\/github\.com\/michaelblum\/agent-os\/shared\/schemas\/aos-/u);
  }
  assert.equal(byName['aos-operation-v1.schema.json'].$ref, '#/$defs/operation_snapshot');
  assert.equal(byName['aos-operation-event-v1.schema.json'].$ref, '#/$defs/operation_event');
  assert.equal(byName['aos-operation-lineage-v1.schema.json'].$ref, '#/$defs/operation_lineage');
  assert.equal(byName['aos-stream-v1.schema.json'].$ref, '#/$defs/stream_snapshot');
  assert.equal(byName['aos-operation-tap-v1.schema.json'].$ref, '#/$defs/tap_unavailable_result');
  assert.equal(byName['aos-artifact-v1.schema.json'].oneOf.length, 5);
  assert.equal(byName['aos-operation-recovery-v1.schema.json'].$ref, '#/$defs/recovery_record');
  assert.equal(byName['aos-host-stop-barrier-v1.schema.json'].oneOf.length, 7);
  assertValidation([target(OPERATION_ID, 'operation_snapshot', operation, true, 'operation schema compiles')]);
});

test('operation, lineage, stream, target tap/artifact, recovery, event, and barrier snapshots validate', () => {
  assertValidation([
    target(LINEAGE_ID, 'operation_lineage', operationLineage, true, 'lineage'),
    target(OPERATION_ID, 'operation_snapshot', operation, true, 'operation'),
    target(STREAM_ID, 'stream_snapshot', stream, true, 'stream'),
    target(TAP_ID, 'tap_snapshot', tap, true, 'tap'),
    target(ARTIFACT_ID, 'artifact_snapshot', artifact, true, 'artifact'),
    target(RECOVERY_ID, 'recovery_record', recovery, true, 'recovery'),
    target(EVENT_ID, 'operation_event', event, true, 'event'),
    target(BARRIER_ID, 'barrier_record', openBarrier, true, 'barrier'),
    target(BARRIER_ID, 'stop_all_receipt', stopReceipt, true, 'stop receipt'),
  ]);
});

test('screen-recording operations require progress and terminal track truth plus success artifact and failure truth', () => {
  const screenBase = {
    ...operation,
    adapter_registration: {
      adapter_registration_id: 'screen-recording-adapter',
      adapter_registration_revision: 2,
    },
    capability_id: 'screen-recording.video',
    geometry: fixedGeometryTruth,
    state: 'terminal',
    progress: {
      items: 1,
      bytes: 100,
      duration_ms: 20,
      last_event_sequence: 1,
      track_summary: videoTrackSummary,
      geometry: fixedGeometryTruth,
    },
    artifacts: [{ id: 'artifact-1', generation: 1 }],
    cleanup: zeroCleanup,
    terminal: {
      outcome: 'succeeded',
      trigger: 'adapter_complete',
      blame: 'adapter',
      duration_ms: 20,
      completed_at: TIMESTAMP,
      failure_code: null,
      track_summary: videoTrackSummary,
      geometry: fixedGeometryTruth,
    },
    started_at: TIMESTAMP,
  };
  const failedTrackSummary = {
    selected_tracks: ['video'],
    finalized_tracks: [],
    common_media_epoch_ns: null,
    video: {
      selected: true, admitted: true, available: true, first_sample_present: false,
      sample_count: 0, sample_byte_count: 0,
      failure_code: 'SCREEN_RECORDING_NO_VIDEO_FRAMES', drained: false, finalized: false,
    },
    system_audio: videoTrackSummary.system_audio,
    microphone: videoTrackSummary.microphone,
  };
  const failed = {
    ...screenBase,
    progress: { ...screenBase.progress, items: 0, bytes: 0, track_summary: failedTrackSummary },
    artifacts: [],
    terminal: {
      ...screenBase.terminal,
      outcome: 'failed',
      trigger: 'adapter_failure',
      failure_code: 'SCREEN_RECORDING_NO_VIDEO_FRAMES',
      track_summary: failedTrackSummary,
    },
  };
  const withoutProgressSummary = structuredClone(screenBase);
  delete withoutProgressSummary.progress.track_summary;
  const withoutTerminalSummary = structuredClone(failed);
  delete withoutTerminalSummary.terminal.track_summary;
  const withoutTerminalFailure = structuredClone(failed);
  delete withoutTerminalFailure.terminal.failure_code;
  const withoutGeometry = structuredClone(screenBase);
  delete withoutGeometry.geometry;
  const microphoneSuccess = {
    ...screenBase,
    progress: { ...screenBase.progress, bytes: 200, track_summary: microphoneTrackSummary },
    terminal: { ...screenBase.terminal, track_summary: microphoneTrackSummary },
  };
  const followedActive = {
    ...screenBase,
    geometry: followedGeometryTruth,
    state: 'active',
    progress: { ...screenBase.progress, geometry: followedGeometryTruth },
    artifacts: [],
    cleanup: {
      result: 'not_started',
      residual: { classification: 'none', count: 0, digest: SHA_A },
      completed_at: null,
    },
    terminal: null,
  };
  const followedEvent = {
    ...event,
    detail: { kind: 'screen_recording_geometry', geometry: followedGeometryTruth },
  };
  assertValidation([
    target(OPERATION_ID, 'operation_snapshot', screenBase, true, 'screen success'),
    target(OPERATION_ID, 'operation_snapshot', microphoneSuccess, true, 'screen microphone success'),
    target(OPERATION_ID, 'operation_snapshot', failed, true, 'screen failure'),
    target(OPERATION_ID, 'operation_snapshot', followedActive, true, 'followed screen active'),
    target(EVENT_ID, 'operation_event', followedEvent, true, 'followed geometry event'),
    target(EVENT_ID, 'operation_event', {
      ...followedEvent,
      detail: { ...followedEvent.detail, geometry: { ...followedGeometryTruth, pending_update: 'yes' } },
    }, false, 'followed geometry event remains schema exact'),
    target(OPERATION_ID, 'operation_snapshot', withoutProgressSummary, false, 'screen progress summary required'),
    target(OPERATION_ID, 'operation_snapshot', withoutTerminalSummary, false, 'screen terminal summary required'),
    target(OPERATION_ID, 'operation_snapshot', withoutTerminalFailure, false, 'screen terminal failure required'),
    target(OPERATION_ID, 'operation_snapshot', withoutGeometry, false, 'screen geometry required'),
    target(OPERATION_ID, 'operation_snapshot', { ...screenBase, artifacts: [] }, false, 'screen success artifact required'),
    target(OPERATION_ID, 'operation_snapshot', {
      ...screenBase,
      terminal: { ...screenBase.terminal, failure_code: 'SCREEN_RECORDING_ENCODER_FAILED' },
    }, false, 'screen success cannot carry failure'),
    target(OPERATION_ID, 'operation_snapshot', {
      ...failed,
      terminal: { ...failed.terminal, failure_code: null },
    }, false, 'screen failure must be typed'),
  ]);
});

test('tap remains unavailable while artifact roots expose producer custody and typed failures', () => {
  const tapUnavailable = {
    v: 1,
    status: 'error',
    error: 'OPERATION_TAP_UNAVAILABLE',
    code: 'OPERATION_TAP_UNAVAILABLE',
    ref: 'tap-request-1',
  };
  const artifactUnavailable = {
    v: 1,
    status: 'error',
    error: 'OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE',
    code: 'OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE',
    ref: 'artifact-request-1',
  };
  const artifactRequest = {
    schema_version: 'aos.operation.artifact-request.v1',
    operation: 'artifact',
    action: 'reveal',
    selector: { artifact_id: 'artifact-1', artifact_generation: 1 },
  };
  const artifactResult = {
    schema_version: 'aos.artifact.custody-result.v1',
    action: 'reveal',
    artifact: { artifact_id: 'artifact-1', artifact_generation: 1 },
    state: 'offered',
    byte_count: 100,
    content_digest: SHA_A,
    media_type: 'video/quicktime; codecs=avc1',
    track_summary: videoTrackSummary,
    path: '/private/tmp/artifact.mov',
  };
  const removedArtifactResult = {
    ...artifactResult,
    action: 'remove',
    state: 'removed',
  };
  delete removedArtifactResult.path;
  const releasedArtifactResult = {
    ...artifactResult,
    action: 'release',
    state: 'released',
    path: '/private/tmp/released.mov',
  };
  assertValidation([
    target(TAP_ID, null, tapUnavailable, true, 'tap unavailable root'),
    target(TAP_ID, null, tap, false, 'tap success is not the current root'),
    target(TAP_ID, null, { ...tapUnavailable, code: 'OPERATION_RECORD_INVALID' }, false, 'tap code is exact'),
    target(ARTIFACT_ID, null, artifactUnavailable, true, 'artifact custody unavailable root'),
    target(ARTIFACT_ID, null, artifactRequest, true, 'artifact exact request root'),
    target(ARTIFACT_ID, null, artifactResult, true, 'producer custody result root'),
    target(ARTIFACT_ID, null, removedArtifactResult, true, 'removed custody result root'),
    target(ARTIFACT_ID, null, releasedArtifactResult, true, 'released custody result root'),
    target(ARTIFACT_ID, null, artifact, true, 'artifact snapshot root'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...removedArtifactResult, state: 'offered' }, false, 'remove cannot report offered'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...removedArtifactResult, path: '/private/tmp/removed.mov' }, false, 'remove cannot disclose a path'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...releasedArtifactResult, state: 'removed' }, false, 'release must report released'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...artifactResult, path: undefined }, false, 'reveal requires a path'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...artifactResult, media_type: 'video/quicktime; codecs=vp09' }, false, 'custody media type and codec are exact'),
    target(ARTIFACT_ID, 'artifact_custody_result', { ...artifactResult, track_summary: audioTrackSummary }, false, 'AAC summary requires the exact AAC media identity'),
    target(ARTIFACT_ID, 'artifact_snapshot', { ...artifact, identity: { ...artifactIdentity, media_type: 'video/quicktime' } }, false, 'snapshot media type requires the exact avc1 parameter'),
    target(ARTIFACT_ID, 'artifact_snapshot', { ...artifact, identity: { ...artifactIdentity, track_summary: audioTrackSummary } }, false, 'AAC artifact identity requires the exact AAC media identity'),
    target(
      ARTIFACT_ID,
      null,
      { ...artifactUnavailable, error: 'OPERATION_NOT_FOUND' },
      false,
      'artifact error is exact',
    ),
  ]);
  const daemonErrorCodes = daemonResponseSchema.oneOf[1].properties.code.enum;
  assert.ok(daemonErrorCodes.includes('OPERATION_TAP_UNAVAILABLE'));
  assert.ok(daemonErrorCodes.includes('OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE'));
  assert.ok(daemonErrorCodes.includes('OPERATION_ARTIFACT_RETAIN_UNAVAILABLE'));
});

test('daemon response closes over every maintained operation and screen failure code', () => {
  const operationStateSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'daemon', 'operation-state.swift'),
    'utf8',
  );
  const maintainedCodes = [...operationStateSource.matchAll(
    /return "((?:OPERATION|SCREEN_RECORDING|MICROPHONE)_[A-Z0-9_]+)"/gu,
  )].map((match) => match[1]);
  assert.equal(new Set(maintainedCodes).size, maintainedCodes.length);
  const responseSchemas = { ...schemas, [daemonResponseID]: daemonResponseSchema };
  const result = spawnSync('python3', ['-c', pythonValidator], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify({
      schemas: [...Object.values(responseSchemas), recordingSchema],
      cases: [
        ...maintainedCodes.map((code) => ({
          schema_id: daemonResponseID,
          instance: { v: 1, status: 'error', error: code, code, ref: 'operation-request' },
        })),
        {
          schema_id: daemonResponseID,
          instance: {
            v: 1,
            status: 'error',
            error: 'SCREEN_RECORDING_UNKNOWN',
            code: 'SCREEN_RECORDING_UNKNOWN',
          },
        },
      ],
    }),
    timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const validation = JSON.parse(result.stdout);
  assert.ok(validation.slice(0, -1).every((entry) => entry.valid));
  assert.equal(validation.at(-1).valid, false);
  assert.deepEqual(
    daemonResponseSchema.oneOf[1].properties.code.enum.filter((code) => (
      code.startsWith('OPERATION_')
        || code.startsWith('SCREEN_RECORDING_')
        || code.startsWith('MICROPHONE_')
    )),
    maintainedCodes,
  );
});

test('mechanical lineage and the four server origin variants are exact and closed', () => {
  const originCases = [
    {
      caller_origin: 'live_transport_peer',
      caller_origin_evidence: peerEvidence,
    },
    {
      caller_origin: 'ordinary_canvas_captured_peer',
      caller_origin_evidence: {
        canvas_instance_id: 'canvas-1', canvas_generation: 1, capture_id: 'capture-1',
        captured_connection_epoch: 1, ...peerEvidence,
      },
    },
    {
      caller_origin: 'status_item_host',
      caller_origin_evidence: {
        status_host_id: 'status-host-1', status_host_generation: 1, daemon_generation: 2, effective_uid: 501,
      },
    },
    {
      caller_origin: 'status_opened_canvas_host',
      caller_origin_evidence: {
        canvas_instance_id: 'canvas-1', canvas_generation: 1, parent_status_host_id: 'status-host-1',
        parent_status_host_generation: 1, daemon_generation: 2, effective_uid: 501,
      },
    },
  ];
  assertValidation([
    ...originCases.map((instance, index) => target(LINEAGE_ID, 'caller_origin_context', instance, true, `origin ${index}`)),
    target(LINEAGE_ID, 'caller_origin_context', {
      caller_origin: 'status_item_host',
      caller_origin_evidence: peerEvidence,
    }, false, 'origin/evidence mismatch'),
    target(LINEAGE_ID, 'operation_lineage', {
      ...operationLineage,
      asserted_attribution: { ...operationLineage.asserted_attribution, human_initiated: true },
    }, false, 'human intent cannot become lineage'),
    target(LINEAGE_ID, 'operation_lineage', {
      ...operationLineage,
      owner_root: { ...operationLineage.owner_root, argv: ['node'] },
    }, false, 'argv is not owner evidence'),
  ]);
});

test('operation terminal and resource records are generation-bound and fail closed', () => {
  const terminal = {
    ...operation,
    state: 'terminal',
    cleanup: zeroCleanup,
    terminal: {
      outcome: 'succeeded', trigger: 'adapter_complete', blame: 'adapter', duration_ms: 10, completed_at: TIMESTAMP,
    },
  };
  const exclusiveDeclaration = {
    adapter_registration_id: 'microphone-capture-adapter',
    adapter_registration_revision: 1,
    resource_key: 'voice_io_native_session',
    admission_mode: 'exclusive',
    declaration_digest: SHA_A,
  };
  const multiplexDeclaration = {
    ...exclusiveDeclaration,
    resource_key: 'shared-resource',
    admission_mode: 'multiplexable',
    fanout_bound: 4,
  };
  assertValidation([
    target(OPERATION_ID, 'operation_snapshot', terminal, true, 'clean terminal'),
    target(OPERATION_ID, 'operation_snapshot', { ...terminal, cleanup: operation.cleanup }, false, 'terminal cleanup pending'),
    target(OPERATION_ID, 'operation_snapshot', { ...operation, state: 'terminal' }, false, 'terminal facts missing'),
    target(OPERATION_ID, 'resource_declaration', exclusiveDeclaration, true, 'exclusive declaration'),
    target(OPERATION_ID, 'resource_declaration', { ...exclusiveDeclaration, fanout_bound: 2 }, false, 'exclusive fanout forbidden'),
    target(OPERATION_ID, 'resource_declaration', multiplexDeclaration, true, 'multiplex declaration'),
    target(OPERATION_ID, 'resource_declaration', { ...multiplexDeclaration, fanout_bound: undefined }, false, 'multiplex fanout required'),
    target(OPERATION_ID, 'operation_snapshot', { ...operation, authorization: 'granted' }, false, 'operation has no authorization field'),
  ].map((entry) => ({
    ...entry,
    instance: JSON.parse(JSON.stringify(entry.instance)),
  })));
});

test('target tap state retains exact seven bounds and bounded queue-full facts', () => {
  const boundsSchema = byName['aos-operation-tap-v1.schema.json'].$defs.tap_bounds.properties;
  assert.deepEqual(Object.keys(boundsSchema), [
    'rate_items_per_second',
    'sample_every',
    'max_queue_items',
    'max_items',
    'max_bytes',
    'idle_timeout_milliseconds',
    'duration_milliseconds',
  ]);
  assert.deepEqual([boundsSchema.rate_items_per_second.minimum, boundsSchema.rate_items_per_second.maximum], [1, 60]);
  assert.deepEqual([boundsSchema.max_items.minimum, boundsSchema.max_items.maximum], [1, 10000]);
  assert.deepEqual([boundsSchema.max_bytes.minimum, boundsSchema.max_bytes.maximum], [1, 10485760]);
  assert.deepEqual([boundsSchema.max_queue_items.minimum, boundsSchema.max_queue_items.maximum], [1, 1024]);
  assert.deepEqual([boundsSchema.sample_every.minimum, boundsSchema.sample_every.maximum], [1, 10000]);
  assert.deepEqual([boundsSchema.idle_timeout_milliseconds.minimum, boundsSchema.idle_timeout_milliseconds.maximum], [1, 300000]);
  assert.deepEqual([boundsSchema.duration_milliseconds.minimum, boundsSchema.duration_milliseconds.maximum], [1, 300000]);

  const missingBoundCases = Object.keys(tapBounds).map((key) => {
    const changed = structuredClone(tap);
    delete changed.bounds[key];
    return target(TAP_ID, 'tap_snapshot', changed, false, `missing tap bound ${key}`);
  });
  const queueFull = {
    ...tap,
    state: 'expired',
    terminal_bound_reason: 'queue_full',
    counters: { ...tapCounters, overflow_rejected_count: 1 },
  };
  assertValidation([
    ...missingBoundCases,
    target(TAP_ID, 'tap_snapshot', { ...tap, bounds: { ...tapBounds, rate_items_per_second: 61 } }, false, 'rate maximum'),
    target(TAP_ID, 'tap_snapshot', { ...tap, bounds: { ...tapBounds, rate_items_per_second: 1.5 } }, false, 'rate integer'),
    target(TAP_ID, 'tap_snapshot', queueFull, true, 'queue full exact one rejection'),
    target(TAP_ID, 'tap_snapshot', {
      ...queueFull, counters: { ...queueFull.counters, overflow_rejected_count: 0 },
    }, false, 'queue full missing rejection'),
    target(TAP_ID, 'tap_snapshot', { ...tap, state: 'expired' }, false, 'expired needs bound reason'),
    target(TAP_ID, 'tap_request_parameters', { channel: 'data', bounds: tapBounds, follow: true }, true, 'tap request parameters'),
    target(TAP_ID, 'tap_request_parameters', {
      channel: 'data', bounds: { ...tapBounds, duration_milliseconds: undefined }, follow: true,
    }, false, 'follow never removes duration'),
  ].map((entry) => ({
    ...entry,
    instance: JSON.parse(JSON.stringify(entry.instance)),
  })));
});

test('target artifact state keeps release, retention, and removal recovery dispositions distinct', () => {
  const releaseReceipt = {
    kind: 'released', recipient_identity_digest: SHA_A, receipt_digest: SHA_B, completed_at: TIMESTAMP,
  };
  const terminalReleased = {
    ...artifact,
    state: 'terminal',
    custody_receipt: releaseReceipt,
    cleanup_obligation: false,
    cleanup: { result: 'zero_residuals', residual_count: 0, residual_digest: SHA_A, completed_at: TIMESTAMP },
  };
  const releasedRecovery = {
    ...artifact,
    state: 'cleanup_required',
    original_custody_state: 'released',
    recovery_disposition: 'release_verification',
    custody_receipt: releaseReceipt,
    cleanup_obligation: true,
    cleanup: { result: 'residuals_present', residual_count: 1, residual_digest: SHA_A, completed_at: null },
  };
  assertValidation([
    target(ARTIFACT_ID, 'artifact_snapshot', terminalReleased, true, 'released artifact terminal'),
    target(ARTIFACT_ID, 'artifact_snapshot', releasedRecovery, true, 'release verification'),
    target(ARTIFACT_ID, 'artifact_snapshot', {
      ...releasedRecovery, recovery_disposition: 'removal_verification',
    }, false, 'release cannot collapse to removal'),
    target(ARTIFACT_ID, 'artifact_snapshot', {
      ...releasedRecovery, original_custody_state: null,
    }, false, 'cleanup records original custody'),
    target(ARTIFACT_ID, 'artifact_snapshot', { ...artifact, path: '/tmp/raw.mp4' }, false, 'durable artifact path forbidden'),
  ]);
});

test('host barrier requests and receipts bind immutable snapshots and exact caller origins', () => {
  const statusReceipt = {
    schema_version: 'aos.host-stop-barrier.status-receipt.v1',
    request_id: 'request-2',
    canonical_parameter_digest: SHA_A,
    daemon_generation: 2,
    caller_origin: 'live_transport_peer',
    caller_origin_evidence: peerEvidence,
    barrier_generation: 1,
    barrier_state: 'open',
    admission_open: true,
    stop_operation_id: null,
    stop_operation_generation: null,
    adapter_registry_revision: 1,
    registered_operation_set_count: 1,
    registered_operation_set_digest: SHA_A,
    selected_operation_count: 0,
    selected_operation_digest: SHA_B,
    barrier_snapshot_digest: null,
    residual_count: 0,
    residual_digest: SHA_C,
    reconciliation_state: 'complete',
  };
  const reopenReceipt = {
    schema_version: 'aos.host-stop-barrier.reopen-receipt.v1',
    request_id: 'request-3',
    canonical_parameter_digest: SHA_A,
    expected_barrier_generation: 2,
    caller_origin: 'live_transport_peer',
    caller_origin_evidence: peerEvidence,
    prior_barrier_state: 'closed',
    prior_barrier_generation: 2,
    prior_stop_operation_id: 'stop-operation-1',
    prior_stop_operation_generation: 1,
    prior_adapter_registry_revision: 1,
    prior_registered_operation_set_count: 1,
    prior_registered_operation_set_digest: SHA_A,
    prior_selected_operation_count: 1,
    prior_selected_operation_digest: SHA_B,
    prior_barrier_snapshot_digest: SHA_C,
    prior_residual_count: 0,
    prior_residual_digest: SHA_A,
    resulting_barrier_state: 'open',
    resulting_barrier_generation: 3,
    daemon_generation: 2,
    resulting_adapter_registry_revision: 1,
    resulting_registered_operation_set_count: 1,
    resulting_registered_operation_set_digest: SHA_A,
    resulting_open_snapshot_digest: SHA_B,
    outcome: 'reopened',
    cleanup_result: 'zero_residuals',
    reconciliation_state: 'complete',
  };
  assertValidation([
    target(BARRIER_ID, 'stop_all_request', {
      schema_version: 'aos.host-stop-barrier.stop-all-request.v1', request_id: 'request-1', action: 'stop_all',
      canonical_parameter_digest: SHA_A, expected_barrier_generation: 1,
    }, true, 'stop request'),
    target(BARRIER_ID, 'stop_all_request', {
      schema_version: 'aos.host-stop-barrier.stop-all-request.v1', request_id: 'request-1', action: 'stop_all',
      canonical_parameter_digest: SHA_A, expected_barrier_generation: 1, caller_origin: 'status_item_host',
    }, false, 'caller origin is server attached'),
    target(BARRIER_ID, 'stop_all_receipt', stopReceipt, true, 'live stop'),
    target(BARRIER_ID, 'stop_all_receipt', {
      ...stopReceipt,
      caller_origin: 'ordinary_canvas_captured_peer',
      caller_origin_evidence: {
        canvas_instance_id: 'canvas-1', canvas_generation: 1, capture_id: 'capture-1',
        captured_connection_epoch: 1, ...peerEvidence,
      },
    }, false, 'ordinary canvas cannot host stop'),
    target(BARRIER_ID, 'barrier_status_receipt', statusReceipt, true, 'passive status'),
    target(BARRIER_ID, 'barrier_status_receipt', {
      ...statusReceipt,
      caller_origin: 'status_item_host',
      caller_origin_evidence: {
        status_host_id: 'status-host-1', status_host_generation: 1, daemon_generation: 2, effective_uid: 501,
      },
    }, false, 'status host cannot call barrier status'),
    target(BARRIER_ID, 'reopen_receipt', reopenReceipt, true, 'reopen receipt'),
    target(BARRIER_ID, 'reopen_receipt', {
      ...reopenReceipt,
      caller_origin: 'status_item_host',
      caller_origin_evidence: {
        status_host_id: 'status-host-1', status_host_generation: 1,
        daemon_generation: 2, effective_uid: 501,
      },
    }, true, 'status item host may reopen'),
    target(BARRIER_ID, 'reopen_receipt', {
      ...reopenReceipt,
      caller_origin: 'status_opened_canvas_host',
      caller_origin_evidence: {
        canvas_instance_id: 'canvas-1', canvas_generation: 1,
        parent_status_host_id: 'status-host-1', parent_status_host_generation: 1,
        daemon_generation: 2, effective_uid: 501,
      },
    }, false, 'status-opened canvas remains stop-only'),
    target(BARRIER_ID, 'reopen_receipt', { ...reopenReceipt, prior_barrier_snapshot_digest: undefined }, false, 'reopen keeps prior snapshot'),
  ].map((entry) => ({
    ...entry,
    instance: JSON.parse(JSON.stringify(entry.instance)),
  })));
});

test('recovery remains nonterminal while unresolved and operation events remain content-free', () => {
  const blocked = {
    ...recovery,
    state: 'blocked_unresolved',
    target: { kind: 'artifact', id: 'artifact-1', generation: 1 },
    residual: { count: 1, digest: SHA_A },
    result: 'blocked_unresolved',
    operator_acknowledgement_count: 1,
  };
  const terminal = {
    ...recovery,
    state: 'terminal',
    result: 'recovered',
    completed_at: TIMESTAMP,
  };
  assertValidation([
    target(RECOVERY_ID, 'recovery_record', blocked, true, 'blocked recovery'),
    target(RECOVERY_ID, 'recovery_record', { ...blocked, residual: { count: 0, digest: SHA_A } }, false, 'blocked still has residual'),
    target(RECOVERY_ID, 'recovery_record', { ...blocked, state: 'terminal' }, false, 'acknowledgement is not cleanup'),
    target(RECOVERY_ID, 'recovery_record', terminal, true, 'mechanically recovered terminal'),
    target(EVENT_ID, 'operation_event', event, true, 'lifecycle event'),
    target(EVENT_ID, 'operation_event', { ...event, raw_payload: 'secret' }, false, 'event has no raw payload'),
    target(EVENT_ID, 'operation_event', { ...event, detail: { kind: 'unknown' } }, false, 'event detail closed'),
  ]);
});

test('schemas declare no policy or human-intent authority fields', () => {
  const forbidden = new Set([
    'authority',
    'authorization',
    'authorized',
    'human_initiated',
    'approval',
    'allowlist',
    'role',
    'principal',
    'privileged',
  ]);
  const violations = [];
  function visit(value, schemaName) {
    if (!value || typeof value !== 'object') return;
    if (value.properties && typeof value.properties === 'object') {
      for (const key of Object.keys(value.properties)) {
        if (forbidden.has(key)) violations.push(`${schemaName}:${key}`);
      }
    }
    for (const child of Object.values(value)) visit(child, schemaName);
  }
  for (const [name, schema] of Object.entries(byName)) visit(schema, name);
  assert.deepEqual(violations, []);
});

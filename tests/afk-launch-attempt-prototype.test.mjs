import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  buildAttemptContext,
  buildLiveProviderPrompt,
  LIVE_INPUT_TIMING_PROFILE,
  providerObservationFromBridgeSnapshot,
  submitLiveProviderPrompt,
  typeCharacters,
} from '../scripts/afk-launch-attempt-prototype.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scriptPath = join(repoRoot, 'scripts', 'afk-launch-attempt-prototype.mjs');
const fixedTimestamp = '2026-05-22T02:00:00.000Z';
const operatorLaunchObservedAt = '2026-05-22T12:58:00.000Z';

function runPrototype(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function writePacket(packet) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-packet-'));
  const packetPath = join(dir, 'packet.json');
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return packetPath;
}

async function writeCatalogFixture(fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-catalog-'));
  const fixturePath = join(dir, 'catalog.json');
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return fixturePath;
}

async function writeBridgeVisibilityFixture(fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-bridge-'));
  const fixturePath = join(dir, 'bridge-visibility.json');
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return fixturePath;
}

async function createCodexHomeFixture(sessions) {
  const codexHome = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-codex-home-'));
  await writeFile(
    join(codexHome, '.codex-global-state.json'),
    `${JSON.stringify({
      'thread-titles': {
        titles: Object.fromEntries(sessions.map((session) => [session.id, session.title ?? `Fixture ${session.id}`])),
        order: sessions.map((session) => session.id),
      },
    }, null, 2)}\n`,
    'utf8',
  );
  for (const session of sessions) {
    await writeCodexSession(codexHome, session);
  }
  return codexHome;
}

async function writeCodexSession(codexHome, session) {
  const timestamp = session.timestamp;
  const file = join(
    codexHome,
    'sessions',
    timestamp.slice(0, 4),
    timestamp.slice(5, 7),
    timestamp.slice(8, 10),
    `rollout-${timestamp.slice(0, 19).replaceAll(':', '-')}-${session.id}.jsonl`,
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `${[
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: session.id,
          cwd: session.cwd,
          timestamp,
        },
      },
      {
        timestamp: new Date(Date.parse(timestamp) + 1000).toISOString(),
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: session.content ?? 'body text must not be read' },
      },
    ].map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
}

function validPacket(overrides = {}) {
  return {
    packet_id: 'manual-afk-launch-attempt-test',
    source_artifact: 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md',
    requested_recipient: 'gdi',
    cwd: repoRoot,
    worktree: repoRoot,
    branch_policy: 'keep local-only',
    required_start_ref: 'docs/durable-agent-cognition-v0',
    provider_hint: 'codex',
    result_route: [
      {
        kind: 'local_artifact_path',
        ref: 'stdout',
      },
    ],
    external_publication_policy: 'local-only',
    timeout_or_lease: {
      lease: 'current launch-attempt prototype invocation',
      heartbeat: 'not_applicable',
    },
    goal: 'create no-provider launch attempt with bridge substrate proof',
    ...overrides,
  };
}

test('creates a no-provider launch-attempt record with process bridge substrate facts', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.record_type, 'aos.afk_launch_attempt');
  assert.equal(record.schema_status, 'not_a_schema');
  assert.equal(record.created_at, fixedTimestamp);
  assert.equal(record.lifecycle_state, 'provider_acceptance_unobserved');
  assert.match(record.launch_attempt_id, /^launch-attempt-[a-f0-9]{16}$/);
  assert.match(record.scheduler_run_id, /^prototype-scheduler-[a-f0-9]{16}$/);
  assert.match(record.dispatch_attempt_id, /^prototype-dispatch-[a-f0-9]{16}$/);
  assert.match(record.idempotence_key, /^[a-f0-9]{32}$/);
  assert.equal(record.transfer.packet_id_or_ref, 'manual-afk-launch-attempt-test');
  assert.equal(record.transfer.source_event_or_artifact, 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md');
  assert.equal(record.transfer.required_start_ref, 'docs/durable-agent-cognition-v0');
  assert.match(record.transfer.start_ref_sha, /^[a-f0-9]{40}$/);
  assert.equal(record.transfer.external_publication_policy, 'local-only');
  assert.deepEqual(record.selection, {
    selected_provider: 'codex',
    provider_selection_source: 'explicit_option',
    selected_dock: 'gdi',
    dock_role_kind: 'gdi',
    dock_profile_ref: '.docks/gdi/dock.json',
    launch_root: '.docks/gdi',
  });
  assert.equal(record.launch_intent.action, 'start');
  assert.equal(record.launch_intent.intended_worktree, repoRoot);
  assert.equal(record.launch_intent.intended_launch_cwd, join(repoRoot, '.docks/gdi'));
  assert.equal(record.launch_intent.launch_requested, true);
  assert.equal(record.launch_intent.launch_performed, true);
  assert.equal(record.launch_intent.provider_launch_performed, false);
  assert.doesNotMatch(record.launch_intent.command, /\b(codex|claude|gemini)\b/i);
  assert.deepEqual(record.launch_intent.command_argv, [
    'node',
    '-e',
    '<harmless marker command>',
  ]);
  assert.equal(record.terminal_substrate.status, 'observed');
  assert.equal(record.terminal_substrate.driver, 'process');
  assert.match(record.terminal_substrate.session_handle, /^afk-launch-[a-f0-9]{12}$/);
  assert.equal(record.terminal_substrate.cwd, join(repoRoot, '.docks/gdi'));
  assert.equal(record.terminal_substrate.command, record.launch_intent.command);
  assert.equal(record.terminal_substrate.snapshot_ref, 'inline:terminal_substrate.snapshot_summary');
  assert.equal(record.terminal_substrate.snapshot_summary.includes_marker, true);
  assert.match(record.terminal_substrate.snapshot_summary.text_excerpt, /afk-launch-attempt-marker/);
  assert.equal(record.terminal_substrate.bridge_health.driver, 'process');
  assert.equal(record.provider_acceptance.status, 'not_applicable: no-provider-launch');
  assert.equal(record.provider_acceptance.provider_session_id, 'not_applicable: no-provider-launch');
  assert.equal(record.catalog.status, 'not_observed');
  assert.equal(record.catalog.catalog_record_refs, 'not_observed');
  assert.equal(record.telemetry.status, 'not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.equal(record.result_route.status, 'not_attempted');
  assert.deepEqual(record.mismatches, []);
  assert.deepEqual(record.evidence.observed_refs, ['inline:terminal_substrate.snapshot_summary']);
  assert.equal(record.duplicate_handling.bridge_session_started, true);
  assert.ok(record.validations.every((validation) => validation.status === 'passed'));
});

test('represents accepted supervised live Codex bridge pass from deterministic fixtures', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const providerSessionId = '019e5107-5456-7f22-b08b-b977df1b35f4';
  const responseMarker = 'live-codex-transcript-materialization-pty-rerun';
  const launchObservedAt = '2026-05-22T18:51:34.000Z';
  const codexHome = await createCodexHomeFixture([
    {
      id: providerSessionId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T18:51:35.420Z',
      title: 'Live bridge transcript materialization',
      content: responseMarker,
    },
  ]);
  const bridgePath = await writeBridgeVisibilityFixture({
    response_marker: responseMarker,
    bridge: {
      supervised_live: true,
      health: {
        ok: true,
        defaultSession: 'afk-codex-transcript-materialization-pty-rerun',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
        terminal: { cols: 80, rows: 24 },
      },
      ensure: {
        ok: true,
        session: 'afk-codex-transcript-materialization-pty-rerun',
        cwd: intendedLaunchCwd,
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      resize: {
        cols: 100,
        rows: 31,
        resize_accepted: true,
        terminal: { cols: 100, rows: 31 },
      },
      input: {
        driver: 'process',
        session_exists: true,
        text_bytes: 172,
        text_accepted: true,
        enter_sent: true,
        enter_bytes: 1,
        enter_accepted: true,
      },
      key: {
        key: 'Enter',
        key_bytes: 1,
        key_accepted: true,
      },
      typed_observed: true,
      submitted_observed: true,
      snapshot: {
        session: 'afk-codex-transcript-materialization-pty-rerun',
        driver: 'process',
        command: 'codex --no-alt-screen',
        terminal: { cols: 100, rows: 31 },
        text: [
          'Codex CLI 0.133.0',
          `provider_session_id: ${providerSessionId}`,
          'cwd /Users/Michael/Code/agent-os/.docks/gdi',
          'branch gdi/afk-launch-attempt-live-codex-record-v0',
          'model gpt-5.5',
          'head 4814cdcf',
          responseMarker,
        ].join('\n'),
      },
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    '2026-05-22T18:52:00.000Z',
    '--launch-observed-at',
    launchObservedAt,
    '--bridge-visibility-fixture',
    bridgePath,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.launch_intent.provider_launch_performed, true);
  assert.equal(record.lifecycle_state, 'provider_session_observed');
  assert.equal(record.terminal_substrate.geometry.cols, 100);
  assert.equal(record.terminal_substrate.geometry.rows, 31);
  assert.deepEqual(record.terminal_substrate.resize, {
    status: 'accepted',
    cols: 100,
    rows: 31,
    resize_accepted: true,
  });
  assert.equal(record.terminal_substrate.input_submission.text_accepted, true);
  assert.equal(record.terminal_substrate.input_submission.enter_accepted, false);
  assert.equal(record.terminal_substrate.input_submission.extra_enter_needed, true);
  assert.equal(record.terminal_substrate.input_submission.key_accepted, true);
  assert.equal(record.terminal_substrate.input_submission.prompt_transport, 'file_pointer');
  assert.equal(record.terminal_substrate.input_submission.startup_settle_ms, 2000);
  assert.equal(record.terminal_substrate.input_submission.char_delay_ms, 10);
  assert.equal(record.terminal_substrate.input_submission.pre_submit_delay_ms, 300);
  assert.equal(record.terminal_substrate.input_submission.submit_key_separate_write, true);
  assert.equal(record.terminal_substrate.input_submission.provider_execution_observed, true);
  assert.equal(record.terminal_substrate.input_submission.response_marker, responseMarker);
  assert.equal(record.terminal_substrate.input_submission.response_marker_observed, true);
  assert.equal(record.provider_acceptance.status, 'provider_session_observed');
  assert.equal(record.provider_acceptance.provider_session_id, providerSessionId);
  assert.equal(record.codex_adapter.status, 'observed');
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_provider_session_id');
  assert.equal(record.codex_adapter.confidence, 'exact');
  assert.equal(record.codex_adapter.matched_thread_id, providerSessionId);
  assert.equal(record.codex_adapter.matched_cwd_basis, 'intended_launch_cwd');
  assert.ok(record.evidence.observed_refs.includes(`codex://threads/${providerSessionId}`));
  assert.ok(record.evidence.observed_refs.includes(`codex-thread:${providerSessionId}`));
  assert.equal(record.catalog.status, 'not_observed');
  assert.equal(record.telemetry.status, 'not_observed');
  assert.equal(record.result_route.status, 'not_attempted');
  assert.deepEqual(record.mismatches, []);
});

test('promotes live terminal snapshot provider session text to observed provider acceptance', () => {
  const providerSessionId = '019e5107-5456-7f22-b08b-b977df1b35f4';
  const observation = providerObservationFromBridgeSnapshot({
    session: 'afk-live-provider-observation',
    driver: 'process',
    command: 'codex --no-alt-screen',
    text: [
      'Codex CLI 0.133.0',
      `provider_session_id: ${providerSessionId}`,
      'cwd /Users/Michael/Code/agent-os/.docks/gdi',
      'branch gdi/afk-dev-session-trigger-supervised-bridge-launch-v0',
      'model gpt-5.5',
      'head a38d0da6',
      'live-codex-session-trigger-supervised-bridge-launch',
    ].join('\n'),
  });

  assert.equal(observation.provider_acceptance.status, 'provider_session_observed');
  assert.equal(observation.provider_acceptance.provider_session_id, providerSessionId);
  assert.equal(observation.provider_acceptance.provider_reported_cwd, '/Users/Michael/Code/agent-os/.docks/gdi');
  assert.equal(observation.provider_acceptance.provider_reported_branch, 'gdi/afk-dev-session-trigger-supervised-bridge-launch-v0');
  assert.equal(observation.provider_acceptance.provider_reported_head, 'a38d0da6');
  assert.equal(observation.provider_acceptance.provider_version, '0.133.0');
  assert.equal(observation.provider_acceptance.model, 'gpt-5.5');
  assert.equal(observation.snapshot_ref, 'inline:terminal_substrate.snapshot_summary');
  assert.match(observation.snapshot_summary.text_excerpt, /provider_session_id/);
  assert.equal(observation.mismatch, null);
});

test('keeps live terminal snapshot provider acceptance unobserved when no provider session id is parseable', () => {
  const observation = providerObservationFromBridgeSnapshot({
    session: 'afk-live-provider-unobserved',
    driver: 'process',
    command: 'codex --no-alt-screen',
    text: [
      'Codex CLI 0.133.0',
      'cwd /Users/Michael/Code/agent-os/.docks/gdi',
      'branch gdi/afk-dev-session-trigger-supervised-bridge-launch-v0',
      'model gpt-5.5',
      'head a38d0da6',
    ].join('\n'),
  });

  assert.equal(observation.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(observation.provider_acceptance.provider_session_id, 'not_observed');
  assert.equal(observation.provider_acceptance.provider_reported_cwd, '/Users/Michael/Code/agent-os/.docks/gdi');
  assert.equal(observation.provider_acceptance.provider_reported_branch, 'gdi/afk-dev-session-trigger-supervised-bridge-launch-v0');
  assert.equal(observation.provider_acceptance.provider_reported_head, 'a38d0da6');
  assert.equal(observation.provider_acceptance.provider_version, '0.133.0');
  assert.equal(observation.provider_acceptance.model, 'gpt-5.5');
  assert.equal(observation.mismatch.code, 'provider_session_id_not_observed');
  assert.equal(observation.mismatch.effect, 'not_observed');
});

test('builds bounded file-backed live provider pointer prompt from source artifact', () => {
  const prompt = buildLiveProviderPrompt({
    packet: validPacket({
      packet_id: 'packet-live-prompt',
      source_artifact: 'docs/design/work-cards/live-prompt.md',
      required_start_ref: 'foreman/live-prompt',
      goal: 'submit this transfer packet goal to the launched provider without reading transcripts',
    }),
    packetId: 'packet-live-prompt',
    sourceArtifact: 'docs/design/work-cards/live-prompt.md',
    requiredStartRef: 'foreman/live-prompt',
    worktree: repoRoot,
    selectedProvider: 'operator',
    selectedDock: 'operator',
  });

  assert.equal(prompt, 'Your work card is at docs/design/work-cards/live-prompt.md. Read it first, then begin.');
  assert.ok(Buffer.byteLength(prompt) < 400);
  assert.match(prompt, /docs\/design\/work-cards\/live-prompt\.md/);
  assert.doesNotMatch(prompt, /Goal:/);
  assert.doesNotMatch(prompt, /Packet:/);
  assert.doesNotMatch(prompt, /Required start ref:/);
  assert.doesNotMatch(prompt, /submit this transfer packet goal/);
  assert.doesNotMatch(prompt, /body text must not be read/);
});

test('builds Codex GDI live provider prompt with provider-owned goal prefix', () => {
  const prompt = buildLiveProviderPrompt({
    packet: validPacket({
      packet_id: 'packet-live-prompt',
      source_artifact: 'docs/design/work-cards/live-prompt.md',
      provider_hint: 'codex',
      requested_recipient: 'gdi',
    }),
    packetId: 'packet-live-prompt',
    sourceArtifact: 'docs/design/work-cards/live-prompt.md',
    selectedProvider: 'codex',
    selectedDock: 'gdi',
  });

  assert.equal(prompt, '/goal Your work card is at docs/design/work-cards/live-prompt.md. Read it first, then begin.');
  assert.ok(Buffer.byteLength(prompt) < 400);
});

test('types every live provider prompt character through one input path', async () => {
  const requests = [];
  const delays = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          text_accepted: true,
        };
      },
    };
  };

  const result = await typeCharacters({
    port: 48123,
    session: 'afk-live-prompt-test',
    text: 'ABC',
    fetchImpl,
    charDelayMs: 10,
    sleepImpl: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(result.text_accepted, true);
  assert.equal(result.typed_character_count, 3);
  assert.deepEqual(delays, [10, 10, 10]);
  assert.deepEqual(requests.map((request) => request.body), [
    { session: 'afk-live-prompt-test', text: 'A', enter: false },
    { session: 'afk-live-prompt-test', text: 'B', enter: false },
    { session: 'afk-live-prompt-test', text: 'C', enter: false },
  ]);
  assert.ok(requests.every((request) => /\/input$/.test(request.url)));
});

test('types slash-prefixed live provider prompt through the same character path', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          text_accepted: true,
        };
      },
    };
  };

  const result = await typeCharacters({
    port: 48123,
    session: 'afk-live-prompt-test',
    text: '/goal X',
    fetchImpl,
    charDelayMs: 0,
  });

  assert.equal(result.text_accepted, true);
  assert.deepEqual(requests.map((request) => request.body.text), ['/', 'g', 'o', 'a', 'l', ' ', 'X']);
  assert.ok(requests.every((request) => /\/input$/.test(request.url)));
});

test('submits live provider pointer prompt with startup settle and isolated Enter key', async () => {
  const requests = [];
  const delays = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    return {
      ok: true,
      async json() {
        if (/\/key$/.test(url)) {
          return {
            ok: true,
            key: body.key,
            key_accepted: true,
          };
        }
        return {
          ok: true,
          driver: 'process',
          session_exists: true,
          text_bytes: Buffer.byteLength(body.text ?? ''),
          text_accepted: true,
          enter_sent: false,
          enter_accepted: false,
        };
      },
    };
  };

  const prompt = '/goal Your work card is at docs/design/work-cards/live-prompt.md. Read it first, then begin.';
  const submission = await submitLiveProviderPrompt({
    port: 48123,
    session: 'afk-live-prompt-test',
    prompt,
    promptSource: {
      packetId: 'packet-live-prompt',
      sourceArtifact: 'docs/design/work-cards/live-prompt.md',
      goal: 'deterministic prompt submission',
      selectedProvider: 'codex',
      selectedDock: 'gdi',
    },
    fetchImpl,
    sleepImpl: async (ms) => {
      delays.push(ms);
    },
  });

  assert.deepEqual(LIVE_INPUT_TIMING_PROFILE, {
    startupSettleMs: 2000,
    charDelayMs: 10,
    preSubmitDelayMs: 300,
  });
  assert.equal(requests.length, [...prompt].length + 1);
  assert.deepEqual(delays, [2000, ...Array.from({ length: [...prompt].length }, () => 10), 300]);
  assert.deepEqual(requests[0].body, {
    session: 'afk-live-prompt-test',
    text: '/',
    enter: false,
  });
  assert.deepEqual(requests.at(-1), {
    url: 'http://127.0.0.1:48123/key',
    body: {
      session: 'afk-live-prompt-test',
      key: 'Enter',
    },
  });
  assert.equal(submission.status, 'submitted');
  assert.equal(submission.prompt_transport, 'file_pointer');
  assert.equal(submission.prompt_ref, 'docs/design/work-cards/live-prompt.md');
  assert.equal(submission.provider_prompt_mode, 'codex_goal');
  assert.equal(submission.provider_prompt_prefix, '/goal ');
  assert.equal(submission.pointer_prompt_bytes, Buffer.byteLength(prompt));
  assert.equal(submission.startup_settle_ms, 2000);
  assert.equal(submission.char_delay_ms, 10);
  assert.equal(submission.typed_character_count, [...prompt].length);
  assert.equal(submission.pre_submit_delay_ms, 300);
  assert.equal(submission.submit_key_separate_write, true);
  assert.equal(submission.text_accepted, true);
  assert.equal(submission.enter_sent, false);
  assert.equal(submission.enter_accepted, false);
  assert.equal(submission.key_accepted, true);
  assert.equal(submission.provider_execution_observed, false);
  assert.equal(submission.prompt_summary.packet_id_or_ref, 'packet-live-prompt');
  assert.equal(submission.prompt_summary.source_artifact, 'docs/design/work-cards/live-prompt.md');
  assert.match(submission.prompt_summary.prompt_sha256, /^[a-f0-9]{64}$/);
  assert.equal(submission.prompt_summary.prompt_bytes, Buffer.byteLength(prompt));
});

test('actual live provider prompt source carries Codex GDI prompt profile into submission receipt', async () => {
  const packetPath = await writePacket(validPacket({
    packet_id: 'packet-live-prompt-source-boundary',
    source_artifact: 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md',
    provider_hint: 'codex',
    requested_recipient: 'gdi',
  }));
  const context = await buildAttemptContext({
    packet: packetPath,
    provider: 'codex',
    dock: 'gdi',
    launchMode: 'supervised-provider',
    providerLaunchDryRun: true,
  });

  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    return {
      ok: true,
      async json() {
        return /\/key$/.test(url)
          ? { ok: true, key: body.key, key_accepted: true }
          : { ok: true, text_accepted: true, enter_sent: false, enter_accepted: false };
      },
    };
  };

  assert.equal(
    context.liveProviderPrompt,
    '/goal Your work card is at docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md. Read it first, then begin.',
  );
  assert.deepEqual(
    {
      selectedProvider: context.liveProviderPromptSource.selectedProvider,
      selectedDock: context.liveProviderPromptSource.selectedDock,
    },
    {
      selectedProvider: 'codex',
      selectedDock: 'gdi',
    },
  );

  const submission = await submitLiveProviderPrompt({
    port: 48123,
    session: 'afk-live-prompt-source-boundary',
    prompt: context.liveProviderPrompt,
    promptSource: context.liveProviderPromptSource,
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(requests[0].body.text, '/');
  assert.equal(submission.status, 'submitted');
  assert.equal(submission.provider_prompt_mode, 'codex_goal');
  assert.equal(submission.provider_prompt_prefix, '/goal ');
  assert.equal(submission.prompt_ref, 'docs/design/work-cards/afk-launch-attempt-prototype-no-provider-v0.md');
});

test('keeps bridge byte delivery separate from provider execution observation', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const bridgePath = await writeBridgeVisibilityFixture({
    response_marker: 'prompt-visible-but-not-executed',
    bridge: {
      supervised_live: true,
      health: {
        ok: true,
        defaultSession: 'afk-provider-execution-unobserved',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-provider-execution-unobserved',
        cwd: intendedLaunchCwd,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      input: {
        prompt_transport: 'file_pointer',
        prompt_ref: 'docs/design/work-cards/live-prompt.md',
        pointer_prompt_bytes: 88,
        typed_character_count: 88,
        text_accepted: true,
      },
      key: {
        key: 'Enter',
        key_accepted: true,
      },
      typed_observed: true,
      submitted_observed: true,
      snapshot: {
        session: 'afk-provider-execution-unobserved',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: [
          'Codex CLI 0.133.0',
          'cwd /Users/Michael/Code/agent-os/.docks/gdi',
          'Your work card is at docs/design/work-cards/live-prompt.md. Read it first, then begin.',
        ].join('\n'),
      },
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--launch-mode',
    'supervised-provider',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.terminal_substrate.input_submission.status, 'submitted');
  assert.equal(record.terminal_substrate.input_submission.text_accepted, true);
  assert.equal(record.terminal_substrate.input_submission.key_accepted, true);
  assert.equal(record.terminal_substrate.input_submission.provider_execution_observed, false);
  assert.equal(record.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(record.provider_acceptance.provider_session_id, 'not_observed');
  assert.ok(record.mismatches.some((mismatch) => mismatch.code === 'provider_execution_unobserved'));
  assert.equal(record.lifecycle_state, 'provider_acceptance_unobserved');
});

test('reuses the in-process attempt for a duplicate idempotence key', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--duplicate-in-process',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.type, 'aos.afk_launch_attempt.prototype_duplicate_check');
  assert.equal(bundle.bridge_sessions_started, 1);
  assert.equal(bundle.first.idempotence_key, bundle.duplicate.idempotence_key);
  assert.equal(bundle.first.launch_attempt_id, bundle.duplicate.launch_attempt_id);
  assert.equal(bundle.first.duplicate_handling.duplicate, false);
  assert.equal(bundle.first.duplicate_handling.bridge_session_started, true);
  assert.equal(bundle.duplicate.duplicate_handling.duplicate, true);
  assert.equal(bundle.duplicate.duplicate_handling.bridge_session_started, false);
  assert.equal(bundle.duplicate.duplicate_handling.reused_launch_attempt_id, bundle.first.launch_attempt_id);
  assert.equal(bundle.duplicate.lifecycle_state, 'provider_acceptance_unobserved');
});

test('rejects unsupported provider before terminal substrate work', async () => {
  const packetPath = await writePacket(validPacket());
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'unsupported-provider',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const record = JSON.parse(result.stdout);
  assert.equal(record.lifecycle_state, 'rejected');
  assert.equal(record.selection.selected_provider, 'unsupported-provider');
  assert.equal(record.terminal_substrate.status, 'not_observed');
  assert.equal(record.launch_intent.launch_performed, false);
  assert.equal(record.launch_intent.provider_launch_performed, false);
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['unsupported_provider']);
  assert.equal(
    record.validations.find((validation) => validation.name === 'selected_provider_supported').status,
    'failed',
  );
});

test('rejects missing packet facts and current-state mismatches before bridge start', async () => {
  const missingPath = join(tmpdir(), 'aos-afk-launch-missing-worktree-never-exists');
  const packetPath = await writePacket(validPacket({
    packet_id: undefined,
    source_artifact: 'docs/design/work-cards/missing-launch-attempt-card.md',
    cwd: missingPath,
    worktree: missingPath,
    required_start_ref: 'missing/ref/for-launch-attempt-test',
  }));
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
  ]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const record = JSON.parse(result.stdout);
  assert.equal(record.lifecycle_state, 'rejected');
  assert.equal(record.terminal_substrate.status, 'not_observed');
  assert.equal(record.duplicate_handling.bridge_session_started, false);
  assert.equal(
    record.validations.find((validation) => validation.name === 'packet_id_or_ref_present').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'source_artifact_exists_when_repo_path').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'cwd_resolves_to_repo_root').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'worktree_exists').status,
    'failed',
  );
  assert.equal(
    record.validations.find((validation) => validation.name === 'required_start_ref_resolves').status,
    'failed',
  );
});

test('writes an explicit local output path without creating committed artifacts', async () => {
  const packetPath = await writePacket(validPacket());
  const dir = await mkdtemp(join(tmpdir(), 'afk-launch-attempt-output-'));
  const outPath = join(dir, 'launch-attempt.json');
  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--out',
    outPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outPath), true);
  const fromStdout = JSON.parse(result.stdout);
  const fromFile = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(fromFile, fromStdout);
});

test('classifies stale catalog session as current launch not observed', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: '019e4e49-9d18-7531-9859-3b834f034d14',
        cwd: launchCwd,
        updated_at: '2026-05-22T06:11:41.000Z',
        source_file: '/tmp/stale-codex-session.jsonl',
        resume_command: 'codex resume 019e4e49-9d18-7531-9859-3b834f034d14',
        telemetry_observed: true,
        telemetry_event_refs: ['inline:stale-telemetry-must-not-bind'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_current_launch_not_observed');
  assert.deepEqual(record.catalog.catalog_record_refs, ['codex:019e4e49-9d18-7531-9859-3b834f034d14']);
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.equal(record.catalog.launch_observed_at, operatorLaunchObservedAt);
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['catalog_current_launch_not_observed']);
});

test('preserves unrelated all-cwd current candidate without binding it as launch session', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const unrelatedOperatorCwd = join(repoRoot, '.docks/operator');
  const unrelatedSessionId = '019e5062-42f2-7340-beda-e2295ebf7f41';
  const catalogPath = await writeCatalogFixture({
    sessions: [],
    all_cwd_sessions: [
      {
        provider: 'codex',
        session_id: unrelatedSessionId,
        cwd: unrelatedOperatorCwd,
        updated_at: '2026-05-22T15:54:01.463Z',
        source_file: '/tmp/operator-codex-session.jsonl',
        resume_command: `codex resume ${unrelatedSessionId}`,
        telemetry_observed: true,
        telemetry_event_refs: ['inline:operator-telemetry-must-not-bind'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    '2026-05-22T15:52:38Z',
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.launch_intent.intended_launch_cwd, intendedLaunchCwd);
  assert.equal(record.provider_acceptance.status, 'not_applicable: no-provider-launch');
  assert.equal(record.provider_acceptance.provider_session_id, 'not_applicable: no-provider-launch');
  assert.equal(record.catalog.status, 'catalog_current_launch_not_observed');
  assert.equal(record.catalog.catalog_record_refs, 'not_observed');
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.equal(record.catalog.launch_observed_at, '2026-05-22T15:52:38Z');
  assert.deepEqual(record.catalog.unrelated_current_session_refs, [
    {
      provider_session_id: unrelatedSessionId,
      catalog_record_ref: `codex:${unrelatedSessionId}`,
      cwd: unrelatedOperatorCwd,
      updated_at: '2026-05-22T15:54:01.463Z',
    },
  ]);
  assert.equal(record.catalog.provider_session_mismatch, 'not_observed');
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['catalog_current_launch_not_observed']);
});

test('classifies provider-shaped bridge visibility with no provider session id', async () => {
  const packetPath = await writePacket(validPacket({ provider_hint: undefined }));
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const unrelatedOperatorCwd = join(repoRoot, '.docks/operator');
  const unrelatedSessionId = '019e5062-42f2-7340-beda-e2295ebf7f41';
  const bridgePath = await writeBridgeVisibilityFixture({
    bridge: {
      health: {
        ok: true,
        defaultSession: 'afk-bridge-all-cwd-proof',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-bridge-all-cwd-proof',
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      snapshot: {
        session: 'afk-bridge-all-cwd-proof',
        driver: 'process',
        command: 'codex --no-alt-screen',
        title: 'Codex CLI 0.133.0 | cwd .docks/gdi | branch gdi/afk-launch | model gpt-5.5 | head 81af5f0e',
        text: [
          'Codex CLI 0.133.0',
          'cwd .docks/gdi',
          'branch gdi/afk-launch',
          'model gpt-5.5',
          'head 81af5f0e',
        ].join('\n'),
      },
    },
    catalog: {
      requested_cwd_sessions: [],
      all_cwd_sessions: [
        {
          provider: 'codex',
          session_id: unrelatedSessionId,
          cwd: unrelatedOperatorCwd,
          updated_at: '2026-05-22T15:54:01.463Z',
          telemetry_observed: true,
          telemetry_event_refs: ['inline:operator-telemetry-must-not-bind'],
        },
      ],
      launch_observed_at: '2026-05-22T15:52:38Z',
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.selection.selected_provider, 'codex');
  assert.equal(record.selection.provider_selection_source, 'bridge_command');
  assert.equal(record.launch_intent.provider_launch_performed, false);
  assert.equal(record.terminal_substrate.status, 'observed');
  assert.equal(record.terminal_substrate.driver, 'process');
  assert.equal(record.terminal_substrate.session_handle, 'afk-bridge-all-cwd-proof');
  assert.equal(record.terminal_substrate.cwd, intendedLaunchCwd);
  assert.equal(record.terminal_substrate.command, 'codex --no-alt-screen');
  assert.equal(record.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(record.provider_acceptance.provider_session_id, 'not_observed');
  assert.equal(record.provider_acceptance.provider_reported_cwd, '.docks/gdi');
  assert.equal(record.provider_acceptance.provider_reported_branch, 'gdi/afk-launch');
  assert.equal(record.provider_acceptance.provider_reported_head, '81af5f0e');
  assert.equal(record.provider_acceptance.provider_version, '0.133.0');
  assert.equal(record.provider_acceptance.model, 'gpt-5.5');
  assert.equal(record.catalog.status, 'catalog_current_launch_not_observed');
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.deepEqual(record.catalog.unrelated_current_session_refs, [
    {
      provider_session_id: unrelatedSessionId,
      catalog_record_ref: `codex:${unrelatedSessionId}`,
      cwd: unrelatedOperatorCwd,
      updated_at: '2026-05-22T15:54:01.463Z',
    },
  ]);
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(
    record.mismatches.map((mismatch) => mismatch.code),
    ['catalog_current_launch_not_observed', 'provider_session_id_not_observed'],
  );
});

test('binds synthetic bridge-observed provider session id to requested-cwd catalog match', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const providerSessionId = '019e5062-aaaa-7340-beda-e2295ebf7f41';
  const bridgePath = await writeBridgeVisibilityFixture({
    bridge: {
      health: {
        ok: true,
        defaultSession: 'afk-bridge-all-cwd-proof',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-bridge-all-cwd-proof',
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      snapshot: {
        session: 'afk-bridge-all-cwd-proof',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: [
          'Codex CLI 0.133.0',
          `provider_session_id: ${providerSessionId}`,
          'cwd .docks/gdi',
          'branch gdi/afk-launch',
          'model gpt-5.5',
          'head 81af5f0e',
        ].join('\n'),
      },
    },
    catalog: {
      requested_cwd_sessions: [
        {
          provider: 'codex',
          session_id: providerSessionId,
          cwd: intendedLaunchCwd,
          updated_at: '2026-05-22T15:53:01.000Z',
          source_file: '/tmp/synthetic-current-codex-session.jsonl',
          resume_command: `codex resume ${providerSessionId}`,
          telemetry_observed: true,
          telemetry_event_refs: ['inline:synthetic-current-session:tokens'],
        },
      ],
      all_cwd_sessions: [],
      launch_observed_at: '2026-05-22T15:52:38Z',
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.terminal_substrate.status, 'observed');
  assert.equal(record.terminal_substrate.command, 'codex --no-alt-screen');
  assert.equal(record.provider_acceptance.status, 'provider_session_observed');
  assert.equal(record.provider_acceptance.provider_session_id, providerSessionId);
  assert.equal(record.provider_acceptance.provider_reported_cwd, '.docks/gdi');
  assert.equal(record.catalog.status, 'catalog_matched');
  assert.equal(record.catalog.matched_session_id, providerSessionId);
  assert.equal(record.catalog.source_file, '/tmp/synthetic-current-codex-session.jsonl');
  assert.equal(record.telemetry.status, 'telemetry_observed');
  assert.deepEqual(record.telemetry.telemetry_event_refs, ['inline:synthetic-current-session:tokens']);
  assert.deepEqual(record.mismatches, []);
});

test('records source-owned cleanup proof from synthetic provider bridge evidence', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const providerSessionId = '019e7000-5555-7222-8333-444444444444';
  const bridgePath = await writeBridgeVisibilityFixture({
    bridge: {
      health: {
        ok: true,
        defaultSession: 'afk-bridge-cleanup-proof',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-bridge-cleanup-proof',
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      snapshot: {
        session: 'afk-bridge-cleanup-proof',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: [
          'Codex CLI 0.133.0',
          `provider_session_id: ${providerSessionId}`,
          'cwd .docks/gdi',
        ].join('\n'),
      },
    },
    cleanup: {
      status: 'verified',
      proof: [
        {
          kind: 'owned_bridge_process_exit',
          session: 'afk-bridge-cleanup-proof',
          exit_observed: true,
        },
        {
          kind: 'owned_bridge_health_unreachable_after_teardown',
          port: 48123,
          unreachable: true,
        },
        {
          kind: 'owned_process_driver_child_exit',
          session: 'afk-bridge-cleanup-proof',
          exit_observed: true,
        },
        {
          kind: 'owned_provider_command_child_exit',
          session: 'afk-bridge-cleanup-proof',
          exit_observed: true,
        },
      ],
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.terminal_substrate.status, 'observed');
  assert.equal(record.provider_acceptance.status, 'provider_session_observed');
  assert.equal(record.cleanup.owner, 'afk-launch-attempt-prototype');
  assert.equal(record.cleanup.status, 'verified');
  assert.equal(record.cleanup.scope.owned_bridge_session, 'afk-bridge-cleanup-proof');
  assert.equal(record.cleanup.scope.owned_command, 'codex --no-alt-screen');
  assert.deepEqual(record.cleanup.proof.map((item) => item.kind), [
    'owned_bridge_process_exit',
    'owned_bridge_health_unreachable_after_teardown',
    'owned_process_driver_child_exit',
    'owned_provider_command_child_exit',
  ]);
});

test('records failed source-owned cleanup proof without classifying unrelated provider processes', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const bridgePath = await writeBridgeVisibilityFixture({
    bridge: {
      health: {
        ok: true,
        defaultSession: 'afk-bridge-cleanup-failed',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-bridge-cleanup-failed',
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      snapshot: {
        session: 'afk-bridge-cleanup-failed',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: 'Codex CLI 0.133.0\ncwd .docks/gdi',
      },
    },
    cleanup: {
      status: 'cleanup_unverified',
      reason: 'owned bridge health endpoint still responded',
      proof: [
        {
          kind: 'owned_bridge_health_unreachable_after_teardown',
          port: 48124,
          unreachable: false,
        },
      ],
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(record.cleanup.status, 'cleanup_unverified');
  assert.equal(record.cleanup.reason, 'owned bridge health endpoint still responded');
  assert.equal(record.cleanup.scope.unrelated_provider_processes, 'not_classified');
});

test('does not verify fake-provider cleanup while the helper-owned provider command child remains observable', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const bridgePath = await writeBridgeVisibilityFixture({
    bridge: {
      health: {
        ok: true,
        defaultSession: 'afk-fake-provider-retained',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
      },
      ensure: {
        ok: true,
        session: 'afk-fake-provider-retained',
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      snapshot: {
        session: 'afk-fake-provider-retained',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: 'fake codex ready\ncwd .docks/gdi',
      },
    },
    cleanup: {
      status: 'verified',
      reason: 'owned provider command child still observable after bridge teardown',
      proof: [
        { kind: 'owned_bridge_process_exit', exit_observed: true },
        { kind: 'owned_bridge_health_unreachable_after_teardown', unreachable: true },
        { kind: 'owned_process_driver_child_exit', exit_observed: true },
        { kind: 'owned_provider_command_child_exit', exit_observed: false },
      ],
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--bridge-visibility-fixture',
    bridgePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.status, 'provider_acceptance_unobserved');
  assert.equal(record.cleanup.status, 'cleanup_unverified');
  assert.equal(record.cleanup.reason, 'owned provider command child still observable after bridge teardown');
  assert.equal(record.cleanup.scope.unrelated_provider_processes, 'not_classified');
  assert.ok(record.cleanup.proof.some((item) => (
    item.kind === 'owned_provider_command_child_exit' && item.exit_observed === false
  )));
});

test('adds Codex adapter refs for observed provider session id and matching thread cwd', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const providerSessionId = '019e7000-1111-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: providerSessionId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Matching launch thread',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    '2026-05-22T16:00:00.000Z',
    '--provider-session-id',
    providerSessionId,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.codex_adapter.status, 'observed');
  assert.equal(record.codex_adapter.codex_home_ref, `fixture:${codexHome}`);
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_provider_session_id');
  assert.equal(record.codex_adapter.confidence, 'exact');
  assert.equal(record.codex_adapter.matched_thread_id, providerSessionId);
  assert.equal(record.codex_adapter.matched_thread_ref, `codex-thread:${providerSessionId}`);
  assert.equal(record.codex_adapter.matched_deeplink, `codex://threads/${providerSessionId}`);
  assert.equal(record.codex_adapter.matched_cwd_basis, 'intended_launch_cwd');
  assert.deepEqual(record.codex_adapter.candidate_thread_ids, [providerSessionId]);
  assert.ok(record.codex_adapter.evidence_refs.some((ref) => ref.ref.startsWith(codexHome)));
  assert.ok(record.evidence.observed_refs.includes(`codex://threads/${providerSessionId}`));
  assert.ok(record.evidence.observed_refs.includes(`codex-thread:${providerSessionId}`));
});

test('records Codex adapter wrong-cwd mismatch without matched thread refs', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const wrongCwd = join(repoRoot, '.docks/operator');
  const providerSessionId = '019e7000-aaaa-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: providerSessionId,
      cwd: wrongCwd,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Wrong cwd launch thread',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    '2026-05-22T16:00:00.000Z',
    '--provider-session-id',
    providerSessionId,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.launch_intent.intended_launch_cwd, intendedLaunchCwd);
  assert.equal(record.codex_adapter.correlation_status, 'wrong_cwd');
  assert.equal(record.codex_adapter.matched_thread_id, 'not_observed');
  assert.deepEqual(record.codex_adapter.candidate_thread_ids, [providerSessionId]);
  assert.equal(record.codex_adapter.matched_thread_ref, 'not_observed');
  assert.equal(record.codex_adapter.matched_deeplink, 'not_observed');
  assert.equal(record.codex_adapter.matched_cwd_basis, 'not_observed');
  assert.ok(!record.evidence.observed_refs.includes(`codex://threads/${providerSessionId}`));
  assert.ok(record.mismatches.some((mismatch) => mismatch.source === 'codex_adapter' && mismatch.code === 'wrong_cwd'));
});

test('matches Codex adapter thread whose metadata cwd is the packet worktree root', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const providerSessionId = '019e7000-dddd-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: providerSessionId,
      cwd: repoRoot,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Workspace root launch thread',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    '2026-05-22T16:02:00.000Z',
    '--launch-observed-at',
    '2026-05-22T16:00:00.000Z',
    '--provider-session-id',
    providerSessionId,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.launch_intent.intended_launch_cwd, intendedLaunchCwd);
  assert.equal(record.launch_intent.intended_worktree, repoRoot);
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_provider_session_id');
  assert.equal(record.codex_adapter.matched_thread_id, providerSessionId);
  assert.equal(record.codex_adapter.matched_cwd_basis, 'workspace_root');
  assert.deepEqual(record.codex_adapter.candidate_thread_ids, [providerSessionId]);
  assert.ok(record.evidence.observed_refs.includes(`codex://threads/${providerSessionId}`));
  assert.ok(record.evidence.observed_refs.includes(`codex-thread:${providerSessionId}`));
});

test('matches workspace-root Codex adapter thread by launch window without provider id', async () => {
  const packetPath = await writePacket(validPacket());
  const threadId = '019e7000-eeee-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: threadId,
      cwd: repoRoot,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Workspace root fallback thread',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    '2026-05-22T16:02:00.000Z',
    '--launch-observed-at',
    '2026-05-22T16:00:00.000Z',
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.provider_session_id, 'not_applicable: no-provider-launch');
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_cwd_time_window');
  assert.equal(record.codex_adapter.matched_thread_id, threadId);
  assert.equal(record.codex_adapter.matched_cwd_basis, 'workspace_root');
  assert.ok(record.mismatches.some((mismatch) => mismatch.source === 'codex_adapter' && mismatch.code === 'provider_session_id_not_observed'));
});

test('uses Codex adapter cwd/time fallback for one current same-cwd thread when provider id is absent', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const threadId = '019e7000-bbbb-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: threadId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Fallback launch thread',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    '2026-05-22T16:02:00.000Z',
    '--launch-observed-at',
    '2026-05-22T16:00:00.000Z',
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_cwd_time_window');
  assert.equal(record.codex_adapter.confidence, 'strong');
  assert.equal(record.codex_adapter.matched_thread_id, threadId);
  assert.equal(record.codex_adapter.matched_cwd_basis, 'intended_launch_cwd');
  assert.deepEqual(record.codex_adapter.time_window, {
    after: '2026-05-22T16:00:00.000Z',
    before: '2026-05-22T16:02:00.000Z',
  });
  assert.ok(record.mismatches.some((mismatch) => mismatch.source === 'codex_adapter' && mismatch.code === 'provider_session_id_not_observed'));
});

test('promotes metadata-backed Codex cwd/time match after supervised prompt submission', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const threadId = '019e7000-dddd-7222-8333-444444444444';
  const launchObservedAt = '2026-05-22T16:00:00.000Z';
  const codexHome = await createCodexHomeFixture([
    {
      id: threadId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'Prompt accepted metadata match',
    },
  ]);
  const bridgePath = await writeBridgeVisibilityFixture({
    response_marker: 'metadata-backed-provider-acceptance',
    bridge: {
      supervised_live: true,
      health: {
        ok: true,
        defaultSession: 'afk-metadata-promotion',
        defaultCwd: intendedLaunchCwd,
        driver: 'process',
        terminal: { cols: 80, rows: 24 },
      },
      ensure: {
        ok: true,
        session: 'afk-metadata-promotion',
        cwd: intendedLaunchCwd,
        created: true,
        driver: 'process',
      },
      command: 'codex --no-alt-screen',
      input: {
        driver: 'process',
        session_exists: true,
        text_bytes: 172,
        text_accepted: true,
        enter_sent: true,
        enter_bytes: 1,
        enter_accepted: true,
      },
      typed_observed: true,
      submitted_observed: true,
      snapshot: {
        session: 'afk-metadata-promotion',
        driver: 'process',
        command: 'codex --no-alt-screen',
        text: [
          'Codex CLI 0.133.0',
          'cwd /Users/Michael/Code/agent-os/.docks/gdi',
          'branch gdi/afk-launch',
          'model gpt-5.5',
          'head 81af5f0e',
          'metadata-backed-provider-acceptance',
        ].join('\n'),
      },
    },
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--launch-mode',
    'supervised-provider',
    '--json',
    '--timestamp',
    '2026-05-22T16:02:00.000Z',
    '--launch-observed-at',
    launchObservedAt,
    '--bridge-visibility-fixture',
    bridgePath,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.status, 'provider_session_observed');
  assert.equal(record.provider_acceptance.provider_session_id, threadId);
  assert.equal(record.provider_acceptance.provider_reported_cwd, intendedLaunchCwd);
  assert.equal(record.provider_acceptance.provider_reported_branch, 'gdi/afk-launch');
  assert.equal(record.provider_acceptance.provider_reported_head, '81af5f0e');
  assert.equal(record.provider_acceptance.provider_version, '0.133.0');
  assert.equal(record.provider_acceptance.model, 'gpt-5.5');
  assert.equal(record.provider_acceptance.observation_source, 'codex_adapter_metadata');
  assert.deepEqual(record.provider_acceptance.evidence_refs.slice(0, 2), [
    `codex-thread:${threadId}`,
    `codex://threads/${threadId}`,
  ]);
  assert.equal(record.lifecycle_state, 'provider_session_observed');
  assert.equal(record.codex_adapter.correlation_status, 'matched_by_cwd_time_window');
  assert.equal(record.codex_adapter.matched_thread_id, threadId);
  assert.equal(record.mismatches.some((mismatch) => mismatch.code === 'provider_session_id_not_observed'), false);
  assert.equal(record.mismatches.some((mismatch) => mismatch.code === 'provider_acceptance_unobserved'), false);
});

test('does not bind same-cwd Codex adapter thread without usable launch time window', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const threadId = '019e7000-cccc-7222-8333-444444444444';
  const codexHome = await createCodexHomeFixture([
    {
      id: threadId,
      cwd: intendedLaunchCwd,
      timestamp: '2026-05-22T16:01:00.000Z',
      title: 'No time window must not bind',
    },
  ]);

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--codex-home-fixture',
    codexHome,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.codex_adapter.correlation_status, 'not_observed');
  assert.equal(record.codex_adapter.confidence, 'none');
  assert.equal(record.codex_adapter.matched_thread_id, 'not_observed');
  assert.deepEqual(record.codex_adapter.candidate_thread_ids, []);
  assert.equal(record.codex_adapter.time_window, 'not_observed');
  assert.ok(!record.evidence.observed_refs.includes(`codex://threads/${threadId}`));
});

test('classifies observed provider session with wrong cwd as structured mismatch', async () => {
  const packetPath = await writePacket(validPacket());
  const intendedLaunchCwd = join(repoRoot, '.docks/gdi');
  const observedWrongCwd = join(repoRoot, '.docks/operator');
  const providerSessionId = '019e4fdc-7236-7db0-9f77-29f8f4108b3f';
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: providerSessionId,
        cwd: observedWrongCwd,
        updated_at: '2026-05-22T13:26:14.000Z',
        source_file: '/tmp/wrong-cwd-codex-session.jsonl',
        resume_command: `codex resume ${providerSessionId}`,
        telemetry_observed: true,
        telemetry_event_refs: ['inline:wrong-cwd-telemetry-must-not-bind'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    '2026-05-22T13:26:14.000Z',
    '--provider-session-id',
    providerSessionId,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.status, 'provider_session_wrong_cwd');
  assert.equal(record.provider_acceptance.provider_session_id, providerSessionId);
  assert.equal(record.provider_acceptance.provider_reported_cwd, observedWrongCwd);
  assert.equal(record.catalog.status, 'catalog_provider_session_wrong_cwd');
  assert.deepEqual(record.catalog.catalog_record_refs, [`codex:${providerSessionId}`]);
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.deepEqual(record.catalog.provider_session_mismatch, {
    code: 'provider_session_wrong_cwd',
    expected_cwd: intendedLaunchCwd,
    observed_cwd: observedWrongCwd,
    provider_session_id: providerSessionId,
    catalog_record_ref: `codex:${providerSessionId}`,
    lifecycle_state: 'failed',
  });
  assert.equal(record.telemetry.status, 'telemetry_not_attempted_wrong_cwd');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, [
    {
      observed_at: fixedTimestamp,
      code: 'provider_session_wrong_cwd',
      severity: 'error',
      source: 'catalog',
      expected: {
        provider_session_id: providerSessionId,
        cwd: intendedLaunchCwd,
      },
      observed: {
        provider_session_id: providerSessionId,
        cwd: observedWrongCwd,
        catalog_record_ref: `codex:${providerSessionId}`,
      },
      effect: 'failed',
      evidence_ref: 'inline:catalog.provider_session_mismatch',
    },
  ]);
});

test('keeps observed provider session with missing cwd as not observed', async () => {
  const packetPath = await writePacket(validPacket());
  const providerSessionId = 'observed-session-without-cwd';
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: providerSessionId,
        updated_at: '2026-05-22T13:26:14.000Z',
        source_file: '/tmp/missing-cwd-codex-session.jsonl',
        resume_command: `codex resume ${providerSessionId}`,
        telemetry_observed: true,
        telemetry_event_refs: ['inline:missing-cwd-telemetry-must-not-bind'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    '2026-05-22T13:26:14.000Z',
    '--provider-session-id',
    providerSessionId,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.provider_acceptance.status, 'provider_session_observed');
  assert.equal(record.provider_acceptance.provider_session_id, providerSessionId);
  assert.equal(record.provider_acceptance.provider_reported_cwd, 'not_observed');
  assert.equal(record.catalog.status, 'catalog_not_observed');
  assert.equal(record.catalog.provider_session_mismatch, 'not_observed');
  assert.equal(record.telemetry.status, 'telemetry_not_attempted_no_catalog_match');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, []);
});

test('classifies empty provider cwd catalog as not observed with telemetry not attempted', async () => {
  const packetPath = await writePacket(validPacket());
  const catalogPath = await writeCatalogFixture({ sessions: [] });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_not_observed');
  assert.equal(record.catalog.catalog_record_refs, 'not_observed');
  assert.equal(record.catalog.match_count, 0);
  assert.equal(record.telemetry.status, 'telemetry_not_attempted_no_catalog_match');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, []);
});

test('classifies one current catalog candidate without known provider session id', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'candidate-current-session',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:58:30.000Z',
        telemetry_observed: false,
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_candidate_current_launch_observed');
  assert.equal(record.catalog.match_count, 1);
  assert.equal(record.catalog.matched_session_id, 'candidate-current-session');
  assert.equal(record.telemetry.status, 'telemetry_not_observed');
  assert.equal(record.telemetry.telemetry_event_refs, 'not_observed');
  assert.deepEqual(record.mismatches, []);
});

test('classifies exact catalog match with telemetry when provider session id is known', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'current-known-session',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:59:00.000Z',
        source_file: '/tmp/current-known-session.jsonl',
        resume_command: 'codex resume current-known-session',
        telemetry_observed: true,
        telemetry_event_refs: ['inline:current-known-session:tokens'],
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--provider-session-id',
    'current-known-session',
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'catalog_matched');
  assert.equal(record.catalog.match_count, 1);
  assert.equal(record.catalog.matched_session_id, 'current-known-session');
  assert.equal(record.catalog.source_file, '/tmp/current-known-session.jsonl');
  assert.equal(record.telemetry.status, 'telemetry_observed');
  assert.deepEqual(record.telemetry.telemetry_event_refs, ['inline:current-known-session:tokens']);
  assert.deepEqual(record.mismatches, []);
});

test('classifies multiple current catalog candidates as ambiguous', async () => {
  const packetPath = await writePacket(validPacket());
  const launchCwd = join(repoRoot, '.docks/gdi');
  const catalogPath = await writeCatalogFixture({
    sessions: [
      {
        provider: 'codex',
        session_id: 'candidate-one',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:58:30.000Z',
      },
      {
        provider: 'codex',
        session_id: 'candidate-two',
        cwd: launchCwd,
        updated_at: '2026-05-22T12:59:00.000Z',
      },
    ],
  });

  const result = runPrototype([
    '--packet',
    packetPath,
    '--provider',
    'codex',
    '--dock',
    'gdi',
    '--json',
    '--timestamp',
    fixedTimestamp,
    '--launch-observed-at',
    operatorLaunchObservedAt,
    '--catalog-fixture',
    catalogPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.catalog.status, 'multiple_catalog_candidates');
  assert.equal(record.catalog.match_count, 2);
  assert.equal(record.catalog.matched_session_id, 'not_observed');
  assert.equal(record.telemetry.status, 'telemetry_current_launch_not_observed');
  assert.deepEqual(record.mismatches.map((mismatch) => mismatch.code), ['multiple_catalog_candidates']);
});

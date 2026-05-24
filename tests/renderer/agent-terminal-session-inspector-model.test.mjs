import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  collectDiagnostics,
  createContextMetricRows,
  createLifecycleEventRows,
  createSessionInspectorModel,
  createSessionSummaryRows,
  createTokenCounterRows,
  formatMetricNumber,
  formatMetricRatio,
  metricDisplay,
  metricSourceDisplay,
  selectInspectorSourceSession,
} from '../../packages/toolkit/components/agent-terminal/session-inspector-model.js'

const metric = (value, unit = 'tokens', source = {}) => ({
  value,
  unit,
  source: {
    stability: 'provider-local',
    precision: 'exact',
    kind: 'context_window',
    provider_version: '1.2.3',
    provider_surface: 'transcript',
    ...source,
  },
})

test('formats numeric metrics, ratios, and source metadata with existing display semantics', () => {
  assert.equal(formatMetricNumber(1234567), '1,234,567')
  assert.equal(formatMetricNumber(Number.NaN), 'unknown')
  assert.equal(formatMetricRatio(0.1234), '12.3%')
  assert.equal(formatMetricRatio(Infinity), 'unknown')
  assert.equal(metricDisplay(metric(42000)), '42,000 tokens')
  assert.equal(metricDisplay(metric(0.456, 'ratio')), '45.6%')
  assert.equal(metricDisplay({ value: 7 }), '7')
  assert.equal(metricDisplay(null), 'unknown')
  assert.equal(metricSourceDisplay(metric(1)), 'provider-local / exact / context_window / 1.2.3')
})

test('selects payload session before selected rail record for session summary rows', () => {
  const selectedRecord = {
    provider: 'codex',
    session_id: 'selected-session',
    cwd: '/old',
    branch: 'main',
    source_file: '/old/source.jsonl',
  }
  const payload = {
    session: {
      provider: 'claude-code',
      session_id: 'payload-session',
      cwd: '/new',
      branch: 'feature',
      source_file: '/new/source.jsonl',
    },
    telemetry: {
      model: { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
    },
  }

  assert.equal(selectInspectorSourceSession(selectedRecord, payload), payload.session)
  assert.deepEqual(createSessionSummaryRows(selectedRecord, payload), [
    { kind: 'row', key: 'provider', value: 'Claude' },
    { kind: 'row', key: 'id', value: 'payload-session' },
    { kind: 'row', key: 'cwd', value: '/new', title: '/new' },
    { kind: 'row', key: 'branch', value: 'feature' },
    { kind: 'row', key: 'source', value: '/new/source.jsonl', title: '/new/source.jsonl' },
    { kind: 'row', key: 'model', value: 'Claude Opus 4.7' },
  ])
})

test('models context rows and unknown context empty state', () => {
  const context = {
    window_tokens: metric(258400),
    used_tokens: metric(12400),
    remaining_tokens: metric(246000),
    used_ratio: metric(0.047987, 'ratio'),
    remaining_ratio: metric(0.952013, 'ratio'),
  }

  assert.deepEqual(
    createContextMetricRows(context).map((row) => [row.key, row.value, row.source, row.title]),
    [
      ['window', '258,400 tokens', 'provider-local / exact / context_window / 1.2.3', 'transcript'],
      ['used', '12,400 tokens', 'provider-local / exact / context_window / 1.2.3', 'transcript'],
      ['remaining', '246,000 tokens', 'provider-local / exact / context_window / 1.2.3', 'transcript'],
      ['used ratio', '4.8%', 'provider-local / exact / context_window / 1.2.3', 'transcript'],
      ['remaining ratio', '95.2%', 'provider-local / exact / context_window / 1.2.3', 'transcript'],
    ],
  )

  const model = createSessionInspectorModel({ provider: 'codex', session_id: 's' }, { telemetry: null })
  assert.equal(model.contextRows, null)
  assert.equal(model.contextEmpty, 'Unknown')
})

test('models token counter rows in sorted display order', () => {
  const rows = createTokenCounterRows({
    tokens: {
      output_tokens: metric(200),
      cached_input_tokens: metric(100),
      input_tokens: metric(300),
    },
  })

  assert.deepEqual(rows.map((row) => [row.key, row.value]), [
    ['cached input tokens', '100 tokens'],
    ['input tokens', '300 tokens'],
    ['output tokens', '200 tokens'],
  ])
})

test('models only the last three lifecycle events with metric rows', () => {
  const payload = {
    lifecycle_events: [
      { event: 'created', observed_at: '2026-05-23T12:00:00Z' },
      { event: 'started', trigger: 'launch' },
      { event: 'compacted', trigger: 'auto', pre_tokens: metric(90000), post_tokens: metric(45000) },
      { event: 'resumed', observed_at: '2026-05-23T12:10:00Z', post_tokens: metric(46000) },
    ],
  }

  assert.deepEqual(createLifecycleEventRows(payload), [
    { heading: { kind: 'row', key: 'started', value: 'launch' }, pre: null, post: null },
    {
      heading: { kind: 'row', key: 'compacted', value: 'auto' },
      pre: {
        kind: 'metric',
        key: 'pre',
        value: '90,000 tokens',
        title: 'transcript',
        source: 'provider-local / exact / context_window / 1.2.3',
        sourceTitle: 'transcript',
      },
      post: {
        kind: 'metric',
        key: 'post',
        value: '45,000 tokens',
        title: 'transcript',
        source: 'provider-local / exact / context_window / 1.2.3',
        sourceTitle: 'transcript',
      },
    },
    {
      heading: { kind: 'row', key: 'resumed', value: '2026-05-23T12:10:00Z' },
      pre: null,
      post: {
        kind: 'metric',
        key: 'post',
        value: '46,000 tokens',
        title: 'transcript',
        source: 'provider-local / exact / context_window / 1.2.3',
        sourceTitle: 'transcript',
      },
    },
  ])
})

test('deduplicates diagnostics across payload and telemetry by code, surface, and fallback', () => {
  const first = {
    code: 'codex_token_count_missing_info',
    severity: 'warn',
    provider_surface: 'agent-terminal.session-inspector',
    fallback: 'context_unavailable',
  }
  const duplicate = { ...first, severity: 'error' }
  const differentFallback = { ...first, fallback: 'partial_context' }
  const noCode = { severity: 'warn', provider_surface: 'adapter' }

  assert.deepEqual(collectDiagnostics({
    diagnostics: [first, differentFallback],
    telemetry: { diagnostics: [duplicate, noCode] },
  }), [
    {
      code: 'codex_token_count_missing_info',
      severity: 'warn',
      source: 'warn / agent-terminal.session-inspector / fallback: context_unavailable',
    },
    {
      code: 'codex_token_count_missing_info',
      severity: 'warn',
      source: 'warn / agent-terminal.session-inspector / fallback: partial_context',
    },
    {
      code: 'diagnostic',
      severity: 'warn',
      source: 'warn / adapter',
    },
  ])
})

test('creates full inspector model section data and no-diagnostics empty state', () => {
  const model = createSessionInspectorModel(
    { provider: 'codex', session_id: 'record-session', cwd: '/repo' },
    {
      telemetry: {
        context: {
          window_tokens: metric(1000),
          used_tokens: metric(250),
          remaining_tokens: metric(750),
          used_ratio: metric(0.25, 'ratio'),
          remaining_ratio: metric(0.75, 'ratio'),
          tokens: { input_tokens: metric(125) },
        },
      },
      lifecycle_events: [{ event: 'resume', trigger: 'user' }],
      diagnostics: [],
    },
  )

  assert.equal(model.sessionRows[0].value, 'Codex')
  assert.equal(model.contextRows.length, 5)
  assert.deepEqual(model.tokenRows.map((row) => row.key), ['input tokens'])
  assert.deepEqual(model.lifecycleRows.map((row) => row.heading.key), ['resume'])
  assert.deepEqual(model.diagnosticRows, [])
  assert.equal(model.diagnosticsEmpty, 'No diagnostics')
})

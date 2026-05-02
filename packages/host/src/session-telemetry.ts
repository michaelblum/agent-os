export type AgentSessionProvider = 'codex' | 'claude-code';

export type TelemetrySourceKind =
  | 'provider_statusline'
  | 'provider_hook'
  | 'provider_transcript'
  | 'provider_app_server'
  | 'model_catalog'
  | 'derived'
  | 'aos_adapter';

export type TelemetrySourceStability =
  | 'documented'
  | 'provider-local'
  | 'inferred'
  | 'aos-contract';

export type TelemetryPrecision = 'exact' | 'derived' | 'estimated' | 'unknown';

export type TelemetryMetricUnit = 'tokens' | 'ratio' | 'percent' | 'milliseconds' | 'count';

export interface TelemetrySource {
  kind: TelemetrySourceKind;
  provider_surface: string;
  stability: TelemetrySourceStability;
  precision: TelemetryPrecision;
  provider_version?: string;
}

export interface NumericTelemetryMetric {
  value: number;
  unit: TelemetryMetricUnit;
  source: TelemetrySource;
}

export interface AgentSessionIdentity {
  provider: AgentSessionProvider;
  session_id: string;
  cwd?: string;
  source_file?: string;
}

export interface AgentSessionModel {
  id?: string;
  display_name?: string;
}

export interface AgentSessionContextTelemetry {
  window_tokens?: NumericTelemetryMetric;
  used_tokens?: NumericTelemetryMetric;
  remaining_tokens?: NumericTelemetryMetric;
  used_ratio?: NumericTelemetryMetric;
  remaining_ratio?: NumericTelemetryMetric;
  tokens?: Record<string, NumericTelemetryMetric>;
}

export interface AgentSessionTelemetrySnapshot {
  type: 'agent.session.telemetry';
  schema_version: '2026-05-02';
  observed_at: string;
  session: AgentSessionIdentity;
  model?: AgentSessionModel;
  context?: AgentSessionContextTelemetry;
  diagnostics?: AgentSessionTelemetryMismatch[];
}

export interface AgentSessionLifecycleEvent {
  type: 'agent.session.lifecycle';
  schema_version: '2026-05-02';
  observed_at: string;
  session: AgentSessionIdentity;
  event:
    | 'session_started'
    | 'session_resumed'
    | 'context_compaction_started'
    | 'context_compacted'
    | 'handoff_started'
    | 'handoff_completed'
    | 'session_ended';
  trigger?: 'manual' | 'automatic' | 'provider' | 'handoff' | 'unknown';
  pre_tokens?: NumericTelemetryMetric;
  post_tokens?: NumericTelemetryMetric;
  duration_ms?: NumericTelemetryMetric;
  source: TelemetrySource;
}

export interface AgentSessionCapability {
  id: 'check_in' | 'compact' | 'handoff' | 'resume';
  supported: boolean;
  source: TelemetrySource;
  command?: string[];
}

export interface AgentSessionCapabilitiesSnapshot {
  type: 'agent.session.capabilities';
  schema_version: '2026-05-02';
  observed_at: string;
  session: AgentSessionIdentity;
  capabilities: AgentSessionCapability[];
}

export interface AgentSessionTelemetryMismatch {
  type: 'agent.session.telemetry_mismatch';
  schema_version: '2026-05-02';
  observed_at: string;
  provider: AgentSessionProvider;
  session_id?: string;
  provider_version?: string;
  source: TelemetrySourceKind;
  provider_surface: string;
  code: string;
  expected: string[];
  fallback?: string;
  severity: 'info' | 'warn' | 'error';
}

export interface TelemetryExtractionResult {
  snapshot?: AgentSessionTelemetrySnapshot;
  lifecycle_events: AgentSessionLifecycleEvent[];
  diagnostics: AgentSessionTelemetryMismatch[];
}

export interface TelemetryExtractionOptions {
  observedAt?: string;
  sessionId?: string;
  cwd?: string;
  sourceFile?: string;
  providerVersion?: string;
  logger?: (diagnostic: AgentSessionTelemetryMismatch) => void;
}

export const AGENT_SESSION_TELEMETRY_SCHEMA_VERSION = '2026-05-02' as const;

const CLAUDE_STATUSLINE_SOURCE: Omit<TelemetrySource, 'precision' | 'provider_version'> = {
  kind: 'provider_statusline',
  provider_surface: 'claude.statusline.context_window',
  stability: 'documented',
};

const CLAUDE_TRANSCRIPT_SOURCE: Omit<TelemetrySource, 'precision' | 'provider_version'> = {
  kind: 'provider_transcript',
  provider_surface: 'claude.transcript.message.usage',
  stability: 'provider-local',
};

const CODEX_TRANSCRIPT_SOURCE: Omit<TelemetrySource, 'precision' | 'provider_version'> = {
  kind: 'provider_transcript',
  provider_surface: 'codex.transcript.event_msg.token_count',
  stability: 'provider-local',
};

export function extractCodexTelemetryFromJsonlLines(
  lines: string[],
  options: TelemetryExtractionOptions = {},
): TelemetryExtractionResult {
  const diagnostics: AgentSessionTelemetryMismatch[] = [];
  let sessionId = options.sessionId ?? sessionIdFromCodexRolloutPath(options.sourceFile);
  let cwd = options.cwd;
  let observedAt = options.observedAt;
  let modelId: string | undefined;
  let tokenInfo: Record<string, unknown> | undefined;
  let fallbackWindowTokens: number | undefined;

  for (const line of lines) {
    const record = parseJsonObject(line);
    if (!record) continue;
    observedAt = observedAt ?? coerceTimestamp(record.timestamp);

    if (record.type === 'session_meta') {
      const payload = objectValue(record.payload);
      sessionId = stringValue(payload?.id) ?? sessionId;
      cwd = stringValue(payload?.cwd) ?? cwd;
      continue;
    }

    const payload = objectValue(record.payload);
    if (!payload) continue;
    modelId = stringValue(payload.model) ?? modelId;
    fallbackWindowTokens = integerValue(payload.model_context_window) ?? fallbackWindowTokens;

    if (payload.type === 'token_count') {
      const info = objectValue(payload.info);
      if (!info) {
        pushDiagnostic(diagnostics, options, {
          provider: 'codex',
          sessionId,
          source: 'provider_transcript',
          providerSurface: 'codex.transcript.event_msg.token_count',
          code: 'codex_token_count_missing_info',
          expected: ['payload.info'],
          fallback: fallbackWindowTokens == null ? 'context_unavailable' : 'window_tokens_only',
          severity: 'warn',
        });
        continue;
      }
      tokenInfo = info;
      fallbackWindowTokens = integerValue(info.model_context_window) ?? fallbackWindowTokens;
    }
  }

  if (!sessionId) {
    pushDiagnostic(diagnostics, options, {
      provider: 'codex',
      source: 'provider_transcript',
      providerSurface: 'codex.transcript',
      code: 'missing_session_identity',
      expected: ['session_meta.payload.id', 'rollout filename session id'],
      fallback: 'drop_snapshot',
      severity: 'warn',
    });
    return { lifecycle_events: [], diagnostics };
  }

  const source = sourceFrom(CODEX_TRANSCRIPT_SOURCE, options, 'exact');
  const context: AgentSessionContextTelemetry = {};
  const totalUsage = objectValue(tokenInfo?.total_token_usage);
  const windowTokens = integerValue(tokenInfo?.model_context_window) ?? fallbackWindowTokens;
  const usedTokens = integerValue(totalUsage?.total_tokens);

  if (windowTokens != null) {
    context.window_tokens = metric(windowTokens, 'tokens', sourceFrom(CODEX_TRANSCRIPT_SOURCE, options, 'exact'));
  }
  if (usedTokens != null) {
    context.used_tokens = metric(usedTokens, 'tokens', source);
    context.tokens = tokenMetrics(totalUsage, source);
  } else if (tokenInfo) {
    pushDiagnostic(diagnostics, options, {
      provider: 'codex',
      sessionId,
      source: 'provider_transcript',
      providerSurface: 'codex.transcript.event_msg.token_count',
      code: 'codex_total_tokens_missing',
      expected: ['payload.info.total_token_usage.total_tokens'],
      fallback: windowTokens == null ? 'context_unavailable' : 'window_tokens_only',
      severity: 'warn',
    });
  }

  addDerivedContextMetrics(context, options, 'codex');

  if (!hasContextMetrics(context)) {
    pushDiagnostic(diagnostics, options, {
      provider: 'codex',
      sessionId,
      source: 'provider_transcript',
      providerSurface: 'codex.transcript',
      code: 'codex_context_usage_unavailable',
      expected: [
        'payload.type=token_count',
        'payload.info.total_token_usage.total_tokens',
        'payload.info.model_context_window',
      ],
      fallback: 'context_unknown',
      severity: 'info',
    });
  }

  const snapshot: AgentSessionTelemetrySnapshot = {
    type: 'agent.session.telemetry',
    schema_version: AGENT_SESSION_TELEMETRY_SCHEMA_VERSION,
    observed_at: observedAt ?? new Date().toISOString(),
    session: {
      provider: 'codex',
      session_id: sessionId,
    },
  };
  if (cwd) snapshot.session.cwd = cwd;
  if (options.sourceFile) snapshot.session.source_file = options.sourceFile;
  if (modelId) snapshot.model = { id: modelId };
  if (hasContextMetrics(context)) snapshot.context = context;
  if (diagnostics.length > 0) snapshot.diagnostics = diagnostics;

  return { snapshot, lifecycle_events: [], diagnostics };
}

export function extractClaudeStatuslineTelemetry(
  input: unknown,
  options: TelemetryExtractionOptions = {},
): TelemetryExtractionResult {
  const diagnostics: AgentSessionTelemetryMismatch[] = [];
  const record = objectValue(input);
  if (!record) {
    pushDiagnostic(diagnostics, options, {
      provider: 'claude-code',
      source: 'provider_statusline',
      providerSurface: 'claude.statusline',
      code: 'claude_statusline_invalid_json',
      expected: ['object statusline payload'],
      fallback: 'drop_snapshot',
      severity: 'warn',
    });
    return { lifecycle_events: [], diagnostics };
  }

  const sessionId = options.sessionId ?? stringValue(record.session_id);
  if (!sessionId) {
    pushDiagnostic(diagnostics, options, {
      provider: 'claude-code',
      source: 'provider_statusline',
      providerSurface: 'claude.statusline',
      code: 'missing_session_identity',
      expected: ['session_id'],
      fallback: 'drop_snapshot',
      severity: 'warn',
    });
    return { lifecycle_events: [], diagnostics };
  }

  const providerVersion = stringValue(record.version) ?? options.providerVersion;
  const contextWindow = objectValue(record.context_window);
  const context: AgentSessionContextTelemetry = {};
  const baseSource = { ...CLAUDE_STATUSLINE_SOURCE };
  const exactStatuslineSource = sourceFrom(baseSource, { ...options, providerVersion }, 'exact');

  if (!contextWindow) {
    pushDiagnostic(diagnostics, { ...options, providerVersion }, {
      provider: 'claude-code',
      sessionId,
      source: 'provider_statusline',
      providerSurface: 'claude.statusline',
      code: 'claude_statusline_missing_context_window',
      expected: ['context_window'],
      fallback: 'context_unknown',
      severity: 'warn',
    });
  } else {
    const windowTokens = integerValue(contextWindow.context_window_size);
    if (windowTokens != null) {
      context.window_tokens = metric(windowTokens, 'tokens', {
        ...exactStatuslineSource,
        provider_surface: 'claude.statusline.context_window.context_window_size',
      });
    } else {
      pushDiagnostic(diagnostics, { ...options, providerVersion }, {
        provider: 'claude-code',
        sessionId,
        source: 'provider_statusline',
        providerSurface: 'claude.statusline.context_window',
        code: 'claude_context_window_size_missing',
        expected: ['context_window.context_window_size'],
        fallback: 'usage_or_percentage_only',
        severity: 'warn',
      });
    }

    const currentUsage = objectValue(contextWindow.current_usage);
    if (currentUsage) {
      const usageSource = {
        ...exactStatuslineSource,
        provider_surface: 'claude.statusline.context_window.current_usage',
      };
      context.tokens = tokenMetrics(currentUsage, usageSource);
      const usedTokens = claudeInputSideTokens(currentUsage);
      if (usedTokens != null) {
        context.used_tokens = metric(usedTokens, 'tokens', {
          ...usageSource,
          precision: 'derived',
        });
      } else {
        pushDiagnostic(diagnostics, { ...options, providerVersion }, {
          provider: 'claude-code',
          sessionId,
          source: 'provider_statusline',
          providerSurface: 'claude.statusline.context_window.current_usage',
          code: 'claude_current_usage_token_fields_missing',
          expected: [
            'input_tokens',
            'cache_creation_input_tokens',
            'cache_read_input_tokens',
          ],
          fallback: 'percentage_only',
          severity: 'warn',
        });
      }
    } else if (contextWindow.current_usage === null) {
      pushDiagnostic(diagnostics, { ...options, providerVersion }, {
        provider: 'claude-code',
        sessionId,
        source: 'provider_statusline',
        providerSurface: 'claude.statusline.context_window.current_usage',
        code: 'claude_current_usage_not_ready',
        expected: ['context_window.current_usage'],
        fallback: 'percentage_or_window_only',
        severity: 'info',
      });
    }

    const usedPercentage = numberValue(contextWindow.used_percentage);
    if (usedPercentage != null) {
      context.used_ratio = metric(clampRatio(usedPercentage / 100), 'ratio', {
        ...exactStatuslineSource,
        provider_surface: 'claude.statusline.context_window.used_percentage',
      });
    }
    const remainingPercentage = numberValue(contextWindow.remaining_percentage);
    if (remainingPercentage != null) {
      context.remaining_ratio = metric(clampRatio(remainingPercentage / 100), 'ratio', {
        ...exactStatuslineSource,
        provider_surface: 'claude.statusline.context_window.remaining_percentage',
      });
    }
    if (usedPercentage == null && remainingPercentage == null && !currentUsage) {
      pushDiagnostic(diagnostics, { ...options, providerVersion }, {
        provider: 'claude-code',
        sessionId,
        source: 'provider_statusline',
        providerSurface: 'claude.statusline.context_window',
        code: 'claude_context_usage_fields_missing',
        expected: [
          'context_window.current_usage',
          'context_window.used_percentage',
          'context_window.remaining_percentage',
        ],
        fallback: windowTokens == null ? 'context_unknown' : 'window_tokens_only',
        severity: 'warn',
      });
    }
  }

  addDerivedContextMetrics(context, { ...options, providerVersion }, 'claude-code');

  const workspace = objectValue(record.workspace);
  const model = objectValue(record.model);
  const snapshot: AgentSessionTelemetrySnapshot = {
    type: 'agent.session.telemetry',
    schema_version: AGENT_SESSION_TELEMETRY_SCHEMA_VERSION,
    observed_at: options.observedAt ?? new Date().toISOString(),
    session: {
      provider: 'claude-code',
      session_id: sessionId,
    },
  };
  const cwd = options.cwd ?? stringValue(workspace?.current_dir) ?? stringValue(record.cwd);
  if (cwd) snapshot.session.cwd = cwd;
  const transcriptPath = stringValue(record.transcript_path) ?? options.sourceFile;
  if (transcriptPath) snapshot.session.source_file = transcriptPath;
  const modelId = stringValue(model?.id) ?? stringValue(model?.name);
  const displayName = stringValue(model?.display_name);
  if (modelId || displayName) {
    snapshot.model = {};
    if (modelId) snapshot.model.id = modelId;
    if (displayName) snapshot.model.display_name = displayName;
  }
  if (hasContextMetrics(context)) snapshot.context = context;
  if (diagnostics.length > 0) snapshot.diagnostics = diagnostics;

  return { snapshot, lifecycle_events: [], diagnostics };
}

export function extractClaudeTranscriptTelemetryFromJsonlLines(
  lines: string[],
  options: TelemetryExtractionOptions = {},
): TelemetryExtractionResult {
  const diagnostics: AgentSessionTelemetryMismatch[] = [];
  const lifecycleEvents: AgentSessionLifecycleEvent[] = [];
  let sessionId = options.sessionId;
  let cwd = options.cwd;
  let observedAt = options.observedAt;
  let modelId: string | undefined;
  let latestUsage: Record<string, unknown> | undefined;

  for (const line of lines) {
    const record = parseJsonObject(line);
    if (!record) continue;
    sessionId = stringValue(record.sessionId) ?? stringValue(record.session_id) ?? sessionId;
    cwd = stringValue(record.cwd) ?? cwd;
    observedAt = observedAt ?? coerceTimestamp(record.timestamp);

    const message = objectValue(record.message);
    modelId = stringValue(message?.model) ?? modelId;
    const usage = objectValue(message?.usage);
    if (usage) {
      latestUsage = usage;
      if (claudeInputSideTokens(usage) == null) {
        pushDiagnostic(diagnostics, options, {
          provider: 'claude-code',
          sessionId,
          source: 'provider_transcript',
          providerSurface: 'claude.transcript.message.usage',
          code: 'claude_transcript_usage_token_fields_missing',
          expected: [
            'message.usage.input_tokens',
            'message.usage.cache_creation_input_tokens',
            'message.usage.cache_read_input_tokens',
          ],
          fallback: 'usage_counters_only',
          severity: 'warn',
        });
      }
    }

    const compactMetadata = objectValue(record.compactMetadata);
    if (compactMetadata) {
      const compactSessionId = stringValue(record.sessionId) ?? sessionId;
      if (!compactSessionId) continue;
      const source = sourceFrom({
        kind: 'provider_transcript',
        provider_surface: 'claude.transcript.compactMetadata',
        stability: 'provider-local',
      }, options, 'exact');
      const lifecycleEvent: AgentSessionLifecycleEvent = {
        type: 'agent.session.lifecycle',
        schema_version: AGENT_SESSION_TELEMETRY_SCHEMA_VERSION,
        observed_at: coerceTimestamp(record.timestamp) ?? observedAt ?? new Date().toISOString(),
        session: {
          provider: 'claude-code',
          session_id: compactSessionId,
        },
        event: 'context_compacted',
        source,
      };
      const compactCwd = stringValue(record.cwd) ?? cwd;
      if (compactCwd) lifecycleEvent.session.cwd = compactCwd;
      if (options.sourceFile) lifecycleEvent.session.source_file = options.sourceFile;
      const trigger = normalizeCompactTrigger(stringValue(compactMetadata.trigger));
      if (trigger) lifecycleEvent.trigger = trigger;
      const preTokens = integerValue(compactMetadata.preTokens);
      if (preTokens != null) lifecycleEvent.pre_tokens = metric(preTokens, 'tokens', source);
      const postTokens = integerValue(compactMetadata.postTokens);
      if (postTokens != null) lifecycleEvent.post_tokens = metric(postTokens, 'tokens', source);
      const durationMs = integerValue(compactMetadata.durationMs);
      if (durationMs != null) lifecycleEvent.duration_ms = metric(durationMs, 'milliseconds', source);
      lifecycleEvents.push(lifecycleEvent);
    }
  }

  if (!sessionId) {
    pushDiagnostic(diagnostics, options, {
      provider: 'claude-code',
      source: 'provider_transcript',
      providerSurface: 'claude.transcript',
      code: 'missing_session_identity',
      expected: ['sessionId', 'session_id'],
      fallback: 'drop_snapshot',
      severity: 'warn',
    });
    return { lifecycle_events: lifecycleEvents, diagnostics };
  }

  const context: AgentSessionContextTelemetry = {};
  const transcriptSource = sourceFrom(CLAUDE_TRANSCRIPT_SOURCE, options, 'exact');
  if (latestUsage) {
    context.tokens = tokenMetrics(latestUsage, transcriptSource);
    const usedTokens = claudeInputSideTokens(latestUsage);
    if (usedTokens != null) {
      context.used_tokens = metric(usedTokens, 'tokens', {
        ...transcriptSource,
        precision: 'derived',
      });
    }
  }

  const snapshot: AgentSessionTelemetrySnapshot = {
    type: 'agent.session.telemetry',
    schema_version: AGENT_SESSION_TELEMETRY_SCHEMA_VERSION,
    observed_at: observedAt ?? new Date().toISOString(),
    session: {
      provider: 'claude-code',
      session_id: sessionId,
    },
  };
  if (cwd) snapshot.session.cwd = cwd;
  if (options.sourceFile) snapshot.session.source_file = options.sourceFile;
  if (modelId) snapshot.model = { id: modelId };
  if (hasContextMetrics(context)) snapshot.context = context;
  if (diagnostics.length > 0) snapshot.diagnostics = diagnostics;

  return { snapshot, lifecycle_events: lifecycleEvents, diagnostics };
}

function addDerivedContextMetrics(
  context: AgentSessionContextTelemetry,
  options: TelemetryExtractionOptions,
  provider: AgentSessionProvider,
): void {
  const windowTokens = context.window_tokens?.value;
  const usedTokens = context.used_tokens?.value;
  if (windowTokens != null && usedTokens != null) {
    if (!context.remaining_tokens) {
      context.remaining_tokens = metric(Math.max(0, windowTokens - usedTokens), 'tokens', derivedSource(options, provider, [
        'context.window_tokens',
        'context.used_tokens',
      ]));
    }
    if (!context.used_ratio && windowTokens > 0) {
      context.used_ratio = metric(clampRatio(usedTokens / windowTokens), 'ratio', derivedSource(options, provider, [
        'context.used_tokens',
        'context.window_tokens',
      ]));
    }
    if (!context.remaining_ratio && windowTokens > 0) {
      context.remaining_ratio = metric(clampRatio((windowTokens - usedTokens) / windowTokens), 'ratio', derivedSource(options, provider, [
        'context.remaining_tokens',
        'context.window_tokens',
      ]));
    }
  } else if (!context.used_ratio && context.remaining_ratio) {
    context.used_ratio = metric(1 - context.remaining_ratio.value, 'ratio', derivedSource(options, provider, [
      'context.remaining_ratio',
    ]));
  } else if (!context.remaining_ratio && context.used_ratio) {
    context.remaining_ratio = metric(1 - context.used_ratio.value, 'ratio', derivedSource(options, provider, [
      'context.used_ratio',
    ]));
  }
}

function tokenMetrics(
  usage: Record<string, unknown> | undefined,
  source: TelemetrySource,
): Record<string, NumericTelemetryMetric> | undefined {
  if (!usage) return undefined;
  const result: Record<string, NumericTelemetryMetric> = {};
  for (const key of [
    'input_tokens',
    'cached_input_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
    'total_tokens',
  ]) {
    const value = integerValue(usage[key]);
    if (value != null) result[key] = metric(value, 'tokens', source);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function claudeInputSideTokens(usage: Record<string, unknown>): number | undefined {
  const inputTokens = integerValue(usage.input_tokens);
  const cacheCreationTokens = integerValue(usage.cache_creation_input_tokens) ?? 0;
  const cacheReadTokens = integerValue(usage.cache_read_input_tokens) ?? 0;
  if (inputTokens == null && integerValue(usage.cache_creation_input_tokens) == null && integerValue(usage.cache_read_input_tokens) == null) {
    return undefined;
  }
  return (inputTokens ?? 0) + cacheCreationTokens + cacheReadTokens;
}

function hasContextMetrics(context: AgentSessionContextTelemetry): boolean {
  return Boolean(
    context.window_tokens
      || context.used_tokens
      || context.remaining_tokens
      || context.used_ratio
      || context.remaining_ratio
      || (context.tokens && Object.keys(context.tokens).length > 0),
  );
}

function metric(value: number, unit: TelemetryMetricUnit, source: TelemetrySource): NumericTelemetryMetric {
  return { value, unit, source };
}

function sourceFrom(
  source: Omit<TelemetrySource, 'precision' | 'provider_version'>,
  options: TelemetryExtractionOptions,
  precision: TelemetryPrecision,
): TelemetrySource {
  const result: TelemetrySource = {
    ...source,
    precision,
  };
  if (options.providerVersion) result.provider_version = options.providerVersion;
  return result;
}

function derivedSource(
  options: TelemetryExtractionOptions,
  provider: AgentSessionProvider,
  inputs: string[],
): TelemetrySource {
  return sourceFrom({
    kind: 'derived',
    provider_surface: `${provider}.derived(${inputs.join(',')})`,
    stability: 'aos-contract',
  }, options, 'derived');
}

function pushDiagnostic(
  diagnostics: AgentSessionTelemetryMismatch[],
  options: TelemetryExtractionOptions,
  input: {
    provider: AgentSessionProvider;
    sessionId?: string;
    source: TelemetrySourceKind;
    providerSurface: string;
    code: string;
    expected: string[];
    fallback?: string;
    severity: 'info' | 'warn' | 'error';
  },
): void {
  const diagnostic: AgentSessionTelemetryMismatch = {
    type: 'agent.session.telemetry_mismatch',
    schema_version: AGENT_SESSION_TELEMETRY_SCHEMA_VERSION,
    observed_at: options.observedAt ?? new Date().toISOString(),
    provider: input.provider,
    source: input.source,
    provider_surface: input.providerSurface,
    code: input.code,
    expected: input.expected,
    severity: input.severity,
  };
  const sessionId = input.sessionId ?? options.sessionId;
  if (sessionId) diagnostic.session_id = sessionId;
  if (options.providerVersion) diagnostic.provider_version = options.providerVersion;
  if (input.fallback) diagnostic.fallback = input.fallback;
  diagnostics.push(diagnostic);
  options.logger?.(diagnostic);
}

function normalizeCompactTrigger(value: string | undefined): AgentSessionLifecycleEvent['trigger'] | undefined {
  if (value === 'manual') return 'manual';
  if (value === 'auto' || value === 'automatic') return 'automatic';
  if (value) return 'unknown';
  return undefined;
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    return objectValue(JSON.parse(line) as unknown);
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function coerceTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

function sessionIdFromCodexRolloutPath(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const match = file.match(/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  return match?.[1];
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

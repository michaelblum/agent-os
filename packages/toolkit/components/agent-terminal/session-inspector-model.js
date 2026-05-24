import { providerLabel } from './session-rail-model.js';

export function formatMetricNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return new Intl.NumberFormat().format(value);
}

export function formatMetricRatio(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value * 1000) / 10}%`;
}

export function metricDisplay(metric) {
  if (!metric || typeof metric !== 'object') return 'unknown';
  if (metric.unit === 'ratio') return formatMetricRatio(metric.value);
  return `${formatMetricNumber(metric.value)} ${metric.unit || ''}`.trim();
}

export function metricSourceDisplay(metric) {
  const source = metric?.source;
  if (!source) return '';
  return [source.stability, source.precision, source.kind, source.provider_version]
    .filter(Boolean)
    .join(' / ');
}

export function createMetricRow(key, metric) {
  return {
    kind: 'metric',
    key,
    value: metricDisplay(metric),
    title: metric?.source?.provider_surface || '',
    source: metricSourceDisplay(metric),
    sourceTitle: metric?.source?.provider_surface || '',
  };
}

export function selectInspectorSourceSession(record, payload) {
  return payload?.session || record || {};
}

export function createSessionSummaryRows(record, payload) {
  const sourceSession = selectInspectorSourceSession(record, payload);
  const telemetry = payload?.telemetry || null;
  const rows = [
    { kind: 'row', key: 'provider', value: providerLabel(sourceSession.provider) },
    { kind: 'row', key: 'id', value: sourceSession.session_id },
    { kind: 'row', key: 'cwd', value: sourceSession.cwd, title: sourceSession.cwd },
    { kind: 'row', key: 'branch', value: sourceSession.branch || 'unknown' },
    {
      kind: 'row',
      key: 'source',
      value: sourceSession.source_file || 'unknown',
      title: sourceSession.source_file,
    },
  ];
  if (telemetry?.model?.id || telemetry?.model?.display_name) {
    rows.push({
      kind: 'row',
      key: 'model',
      value: telemetry.model.display_name || telemetry.model.id,
    });
  }
  return rows;
}

export function createContextMetricRows(context) {
  if (!context) return null;
  return [
    createMetricRow('window', context.window_tokens),
    createMetricRow('used', context.used_tokens),
    createMetricRow('remaining', context.remaining_tokens),
    createMetricRow('used ratio', context.used_ratio),
    createMetricRow('remaining ratio', context.remaining_ratio),
  ];
}

export function createTokenCounterRows(context) {
  if (!context?.tokens) return [];
  return Object.keys(context.tokens)
    .sort()
    .map((key) => createMetricRow(key.replace(/_/g, ' '), context.tokens[key]));
}

export function createLifecycleEventRows(payload) {
  const lifecycleEvents = Array.isArray(payload?.lifecycle_events) ? payload.lifecycle_events : [];
  return lifecycleEvents.slice(-3).map((event) => ({
    heading: { kind: 'row', key: event.event, value: event.trigger || event.observed_at },
    pre: event.pre_tokens ? createMetricRow('pre', event.pre_tokens) : null,
    post: event.post_tokens ? createMetricRow('post', event.post_tokens) : null,
  }));
}

export function collectDiagnostics(payload) {
  const telemetry = payload?.telemetry || null;
  const diagnostics = [
    ...(Array.isArray(payload?.diagnostics) ? payload.diagnostics : []),
    ...(Array.isArray(telemetry?.diagnostics) ? telemetry.diagnostics : []),
  ];
  const seen = new Set();
  const rows = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.provider_surface}:${diagnostic.fallback || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      code: diagnostic.code || 'diagnostic',
      severity: diagnostic.severity || '',
      source: [
        diagnostic.severity,
        diagnostic.provider_surface,
        diagnostic.fallback ? `fallback: ${diagnostic.fallback}` : '',
      ].filter(Boolean).join(' / '),
    });
  }
  return rows;
}

export function createSessionInspectorModel(record, payload) {
  const telemetry = payload?.telemetry || null;
  const context = telemetry?.context || null;
  const contextRows = createContextMetricRows(context);
  const tokenRows = createTokenCounterRows(context);
  const lifecycleRows = createLifecycleEventRows(payload);
  const diagnosticRows = collectDiagnostics(payload);

  return {
    sessionRows: createSessionSummaryRows(record, payload),
    contextRows,
    contextEmpty: context ? '' : 'Unknown',
    tokenRows,
    lifecycleRows,
    diagnosticRows,
    diagnosticsEmpty: diagnosticRows.length ? '' : 'No diagnostics',
  };
}

# Agent Session Telemetry

The agent session telemetry contract is the provider-neutral envelope that AOS
uses for live session observability. It is intentionally not a visual state
machine. Consumers receive raw metrics, lifecycle events, action capabilities,
and provider-shape diagnostics, then decide locally how to render or act on
them.

The JSON Schema source of truth is
[`agent-session-telemetry.schema.json`](agent-session-telemetry.schema.json).

## Event Types

All records carry `schema_version`, `observed_at`, and provider/session
identity. The current schema version is `2026-05-02`.

`agent.session.telemetry` carries context-window metrics. Metrics are objects,
not bare numbers:

```json
{
  "window_tokens": {
    "value": 258400,
    "unit": "tokens",
    "source": {
      "kind": "provider_transcript",
      "provider_surface": "codex.transcript.event_msg.token_count",
      "stability": "provider-local",
      "precision": "exact",
      "provider_version": "codex-cli 0.125.0"
    }
  }
}
```

`agent.session.lifecycle` carries raw lifecycle observations such as
`context_compacted`, with optional `pre_tokens`, `post_tokens`, `duration_ms`,
and `trigger`. These are event records, not renderer phases.

`agent.session.capabilities` carries available actions such as `resume`,
`compact`, `handoff`, and `check_in`. Capabilities are not context pressure
signals. They tell consumers what can be invoked without requiring provider
branching.

`agent.session.telemetry_mismatch` is emitted when an adapter sees a provider
surface but expected fields are missing, renamed, null at an unexpected time, or
otherwise unusable. Mismatches are structured so logs and channels can alert AOS
maintainers when provider versions drift.

## Source And Precision

Every metric has a `source` block:

- `kind` says where the value came from, such as `provider_statusline`,
  `provider_hook`, `provider_transcript`, `model_catalog`, or `derived`.
- `provider_surface` names the concrete provider shape or AOS derivation.
- `stability` distinguishes `documented`, `provider-local`, `inferred`, and
  `aos-contract` sources.
- `precision` distinguishes `exact`, `derived`, `estimated`, and `unknown`.
- `provider_version` should be included when the adapter can observe it.

Consumers must not infer confidence from provider name alone. For example,
Claude Code statusline context fields are documented provider telemetry, while
Claude transcript `message.usage` is provider-local fallback data.

## Context Metrics

The shared contract exposes raw metrics only:

- `context.window_tokens`
- `context.used_tokens`
- `context.remaining_tokens`
- `context.used_ratio`
- `context.remaining_ratio`
- `context.tokens.*` provider token counters

No shared `phase` field exists. Terms such as healthy, warm, strained,
critical, refreshed, or refreshing are app policy and should be derived by the
consumer from raw telemetry if needed.

`used_ratio` and `remaining_ratio` are numeric ratios from `0` to `1`. When a
provider reports percentages, adapters convert them to ratios and preserve the
provider surface in the metric source. When AOS derives a ratio from token
counts, the metric source uses `kind: "derived"` and `stability:
"aos-contract"`.

## Provider Observability

Codex currently exposes useful local usage data in transcript token-count
events. AOS treats these as provider-local surfaces and prefers per-session
`model_context_window` values over model catalog defaults. If a token-count event
is present but expected fields such as
`payload.info.total_token_usage.total_tokens` are unavailable, the adapter emits
a mismatch and falls back to whatever partial metrics remain.

Claude Code should prefer documented statusline JSON for active sessions:
`context_window.context_window_size`, `context_window.current_usage`,
`context_window.used_percentage`, and `context_window.remaining_percentage`.
Statusline updates are event-driven and can also be configured with a
`refreshInterval`. Claude hooks are useful for session lifecycle and transcript
path discovery; they are not the primary context-usage source. Claude transcript
`message.usage` and `compactMetadata` remain provider-local fallback inputs.

Inactive sessions should not be tailed continuously by default. The catalog or
terminal surface can scan on open, refresh, filter changes, or a slow visible
interval. Active AOS-managed sessions can use provider statusline/hook surfaces
when configured and provider transcript tails with debounce when no documented
live feed is available.

## Drift And Fallbacks

Provider-local shapes can change without notice. Adapters must fail per metric
or per event, not per session. A session remains visible when telemetry is
partial or unknown.

Mismatch records should include:

- provider and provider version when available
- source kind and provider surface
- stable diagnostic code
- expected paths
- fallback behavior
- severity

Example:

```json
{
  "type": "agent.session.telemetry_mismatch",
  "schema_version": "2026-05-02",
  "observed_at": "2026-05-02T12:00:00.000Z",
  "provider": "claude-code",
  "provider_version": "2.1.126",
  "source": "provider_statusline",
  "provider_surface": "claude.statusline.context_window",
  "code": "claude_context_window_size_missing",
  "expected": ["context_window.context_window_size"],
  "fallback": "usage_or_percentage_only",
  "severity": "warn"
}
```

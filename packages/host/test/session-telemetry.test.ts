import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClaudeStatuslineTelemetry,
  extractClaudeTranscriptTelemetryFromJsonlLines,
  extractCodexTelemetryFromJsonlLines,
  type AgentSessionTelemetryMismatch,
} from '../src/session-telemetry.ts';

const OBSERVED_AT = '2026-05-02T12:00:00.000Z';

describe('agent session telemetry', () => {
  it('extracts Codex context metrics from token_count transcript events', () => {
    const result = extractCodexTelemetryFromJsonlLines([
      JSON.stringify({
        timestamp: '2026-05-02T11:59:00.000Z',
        type: 'session_meta',
        payload: {
          id: '019de3a9-2b0b-79f2-bb17-79dfb2c7a706',
          cwd: '/Users/Michael/Code/agent-os',
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-02T11:59:20.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 33053,
              cached_input_tokens: 3456,
              output_tokens: 528,
              reasoning_output_tokens: 300,
              total_tokens: 33581,
            },
            model_context_window: 258400,
          },
        },
      }),
    ], {
      observedAt: OBSERVED_AT,
      providerVersion: 'codex-cli 0.125.0',
      sourceFile: '/Users/Michael/.codex/sessions/rollout-test.jsonl',
    });

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.snapshot?.session.provider, 'codex');
    assert.equal(result.snapshot?.session.session_id, '019de3a9-2b0b-79f2-bb17-79dfb2c7a706');
    assert.equal(result.snapshot?.context?.window_tokens?.value, 258400);
    assert.equal(result.snapshot?.context?.used_tokens?.value, 33581);
    assert.equal(result.snapshot?.context?.remaining_tokens?.value, 224819);
    assert.equal(result.snapshot?.context?.used_ratio?.value, 33581 / 258400);
    assert.equal(result.snapshot?.context?.tokens?.input_tokens.value, 33053);
    assert.equal(result.snapshot?.context?.used_tokens?.source.stability, 'provider-local');
    assert.equal(result.snapshot?.context?.remaining_tokens?.source.kind, 'derived');
  });

  it('extracts Claude Code exact context metrics from documented statusline JSON', () => {
    const result = extractClaudeStatuslineTelemetry({
      session_id: 'fe9076b7-449c-46fd-8572-0ca0f79bf07a',
      version: '2.1.126',
      transcript_path: '/Users/Michael/.claude/projects/agent-os/session.jsonl',
      workspace: { current_dir: '/Users/Michael/Code/agent-os' },
      model: { id: 'claude-opus-4-7', display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        used_percentage: 25,
        remaining_percentage: 75,
        current_usage: {
          input_tokens: 30000,
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 15000,
          output_tokens: 100,
        },
      },
    }, {
      observedAt: OBSERVED_AT,
    });

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.snapshot?.session.provider, 'claude-code');
    assert.equal(result.snapshot?.session.cwd, '/Users/Michael/Code/agent-os');
    assert.equal(result.snapshot?.model?.id, 'claude-opus-4-7');
    assert.equal(result.snapshot?.context?.window_tokens?.value, 200000);
    assert.equal(result.snapshot?.context?.used_tokens?.value, 50000);
    assert.equal(result.snapshot?.context?.remaining_tokens?.value, 150000);
    assert.equal(result.snapshot?.context?.used_ratio?.value, 0.25);
    assert.equal(result.snapshot?.context?.remaining_ratio?.value, 0.75);
    assert.equal(result.snapshot?.context?.used_ratio?.source.stability, 'documented');
    assert.equal(result.snapshot?.context?.used_tokens?.source.provider_version, '2.1.126');
  });

  it('keeps Claude statusline telemetry partial and logs shape drift when expected fields disappear', () => {
    const logged: AgentSessionTelemetryMismatch[] = [];
    const result = extractClaudeStatuslineTelemetry({
      session_id: 'fe9076b7-449c-46fd-8572-0ca0f79bf07a',
      version: '2.1.126',
      context_window: {
        current_usage: {
          input_tokens: 12,
        },
      },
    }, {
      observedAt: OBSERVED_AT,
      logger: (diagnostic) => logged.push(diagnostic),
    });

    assert.equal(result.snapshot?.context?.used_tokens?.value, 12);
    assert.equal(result.snapshot?.context?.window_tokens, undefined);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, 'claude_context_window_size_missing');
    assert.equal(result.diagnostics[0].fallback, 'usage_or_percentage_only');
    assert.deepEqual(logged, result.diagnostics);
  });

  it('uses Claude transcript usage as provider-local fallback and emits compact lifecycle events', () => {
    const result = extractClaudeTranscriptTelemetryFromJsonlLines([
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-02T11:55:00.000Z',
        sessionId: 'fe9076b7-449c-46fd-8572-0ca0f79bf07a',
        cwd: '/Users/Michael/Code/agent-os',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 6,
            cache_creation_input_tokens: 11000,
            cache_read_input_tokens: 16256,
            output_tokens: 209,
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-02T11:56:00.000Z',
        sessionId: 'fe9076b7-449c-46fd-8572-0ca0f79bf07a',
        cwd: '/Users/Michael/Code/agent-os',
        compactMetadata: {
          trigger: 'manual',
          preTokens: 165246,
          postTokens: 23229,
          durationMs: 97699,
        },
      }),
    ], {
      observedAt: OBSERVED_AT,
      sourceFile: '/Users/Michael/.claude/projects/agent-os/session.jsonl',
    });

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.snapshot?.context?.used_tokens?.value, 27262);
    assert.equal(result.snapshot?.context?.used_tokens?.source.stability, 'provider-local');
    assert.equal(result.snapshot?.context?.used_tokens?.source.precision, 'derived');
    assert.equal(result.lifecycle_events.length, 1);
    assert.equal(result.lifecycle_events[0].event, 'context_compacted');
    assert.equal(result.lifecycle_events[0].trigger, 'manual');
    assert.equal(result.lifecycle_events[0].pre_tokens?.value, 165246);
    assert.equal(result.lifecycle_events[0].post_tokens?.value, 23229);
    assert.equal(result.lifecycle_events[0].duration_ms?.value, 97699);
  });

  it('logs transcript usage drift without dropping the session snapshot', () => {
    const logged: AgentSessionTelemetryMismatch[] = [];
    const result = extractClaudeTranscriptTelemetryFromJsonlLines([
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-02T11:55:00.000Z',
        sessionId: 'fe9076b7-449c-46fd-8572-0ca0f79bf07a',
        message: {
          role: 'assistant',
          usage: {
            tokens_in_new_shape: 100,
          },
        },
      }),
    ], {
      observedAt: OBSERVED_AT,
      logger: (diagnostic) => logged.push(diagnostic),
    });

    assert.equal(result.snapshot?.session.session_id, 'fe9076b7-449c-46fd-8572-0ca0f79bf07a');
    assert.equal(result.snapshot?.context, undefined);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, 'claude_transcript_usage_token_fields_missing');
    assert.equal(result.diagnostics[0].severity, 'warn');
    assert.deepEqual(logged, result.diagnostics);
  });
});

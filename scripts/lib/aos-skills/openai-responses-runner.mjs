import { mkdir } from 'node:fs/promises';

import { buildPromptPackets } from './eval.mjs';
import { assertCapturedRunFileAvailable, writeCapturedRunFile } from './captured-runs.mjs';
import { AosSkillsError, isObject } from './shared.mjs';

export const EVAL_OPENAI_RUN_SCHEMA_VERSION = 'aos.skills.agentic-efficacy.openai-run.v0';
export const OPENAI_RESPONSES_ADAPTER_ID = 'openai-responses';
export const OPENAI_RESPONSES_MAX_OUTPUT_TOKENS_MIN = 16;

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const OPENAI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'case_id',
    'selected_skills',
    'selected_commands',
    'decision',
    'stop_condition',
    'notes',
  ],
  properties: {
    case_id: { type: 'string' },
    selected_skills: {
      type: 'array',
      items: { type: 'string' },
    },
    selected_commands: {
      type: 'array',
      items: { type: 'string' },
    },
    decision: { type: 'string' },
    stop_condition: { type: 'string' },
    notes: { type: 'string' },
  },
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveOpenAIApiKey(options) {
  if (Object.hasOwn(options, 'apiKey')) return options.apiKey;
  return process.env.AOS_AGENT_PROVIDER_API_KEY || process.env.OPENAI_API_KEY;
}

function openAIResponsesUrl(baseUrl) {
  if (!baseUrl) return OPENAI_RESPONSES_URL;
  return `${String(baseUrl).replace(/\/+$/, '')}/responses`;
}

function timestampSessionId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeSessionId(value) {
  const sessionId = String(value || timestampSessionId()).trim();
  if (!sessionId) {
    throw new AosSkillsError('--session-id must not be empty', 'INVALID_ARG', {
      flag: '--session-id',
    });
  }
  return sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function normalizeMaxOutputTokens(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < OPENAI_RESPONSES_MAX_OUTPUT_TOKENS_MIN) {
    throw new AosSkillsError(
      `--max-output-tokens must be an integer >= ${OPENAI_RESPONSES_MAX_OUTPUT_TOKENS_MIN}`,
      'INVALID_ARG',
      {
        flag: '--max-output-tokens',
        min: OPENAI_RESPONSES_MAX_OUTPUT_TOKENS_MIN,
      },
    );
  }
  return parsed;
}

function runIdForPacket(packet, sessionId) {
  return `${packet.matrix_id}__${OPENAI_RESPONSES_ADAPTER_ID}__${sessionId}`;
}

function normalizeOpenAIResponsesOptions(options) {
  const apiKey = resolveOpenAIApiKey(options);
  if (!apiKey) {
    throw new AosSkillsError(
      'OPENAI_API_KEY or AOS_AGENT_PROVIDER_API_KEY is required for OpenAI live eval runs',
      'MISSING_OPENAI_API_KEY',
    );
  }
  return {
    ...options,
    apiKey,
    maxOutputTokens: normalizeMaxOutputTokens(options.maxOutputTokens),
    replace: Boolean(options.replace),
    sessionId: normalizeSessionId(options.sessionId),
  };
}

function assertOpenAIAdapterPackets(packets) {
  const unsupported = packets
    .filter((packet) => packet.adapter !== OPENAI_RESPONSES_ADAPTER_ID)
    .map((packet) => ({
      matrix_id: packet.matrix_id,
      adapter: packet.adapter ?? null,
      provider: packet.provider ?? null,
    }));
  if (unsupported.length) {
    throw new AosSkillsError(
      'OpenAI live eval runner requires matrix rows with adapter openai-responses',
      'UNSUPPORTED_EVAL_MATRIX_ADAPTER',
      {
        adapter: OPENAI_RESPONSES_ADAPTER_ID,
        unsupported,
      },
    );
  }
}

export function buildOpenAIResponsesRequest(packet, options = {}) {
  const maxOutputTokens = normalizeMaxOutputTokens(options.maxOutputTokens);
  const request = {
    model: packet.model,
    instructions: packet.system_prompt,
    input: [
      packet.user_prompt,
      '',
      `Response contract: ${JSON.stringify(packet.response_contract)}`,
    ].join('\n'),
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'aos_skill_eval_response',
        strict: true,
        schema: OPENAI_RESPONSE_JSON_SCHEMA,
      },
    },
  };
  if (packet.reasoning_effort) {
    request.reasoning = { effort: packet.reasoning_effort };
  }
  if (maxOutputTokens) request.max_output_tokens = maxOutputTokens;
  return request;
}

export function extractOpenAIOutputText(responsePayload) {
  if (typeof responsePayload?.output_text === 'string') return responsePayload.output_text;
  for (const output of asArray(responsePayload?.output)) {
    for (const content of asArray(output?.content)) {
      if (typeof content?.text === 'string') return content.text;
      if (typeof content?.output_text === 'string') return content.output_text;
    }
  }
  throw new AosSkillsError('OpenAI response did not contain output text', 'OPENAI_RESPONSE_MISSING_TEXT', {
    response_id: responsePayload?.id ?? null,
  });
}

async function callOpenAIResponses(packet, options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new AosSkillsError('fetch is required for OpenAI live eval runs', 'FETCH_UNAVAILABLE');
  }
  const request = buildOpenAIResponsesRequest(packet, options);
  const startedAt = Date.now();
  const response = await fetchImpl(openAIResponsesUrl(options.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    throw new AosSkillsError('OpenAI Responses API request failed', 'OPENAI_RESPONSE_FAILED', {
      case_id: packet.case_id,
      matrix_id: packet.matrix_id,
      status: response.status,
      body,
    });
  }
  const payload = await response.json();
  const text = extractOpenAIOutputText(payload);
  let captured;
  try {
    captured = JSON.parse(text);
  } catch (error) {
    throw new AosSkillsError('OpenAI output text was not valid JSON', 'OPENAI_OUTPUT_INVALID_JSON', {
      case_id: packet.case_id,
      matrix_id: packet.matrix_id,
      error: error.message,
    });
  }
  if (!isObject(captured)) {
    throw new AosSkillsError('OpenAI output JSON was not an object', 'OPENAI_OUTPUT_NOT_OBJECT', {
      case_id: packet.case_id,
      matrix_id: packet.matrix_id,
    });
  }
  return {
    response: captured,
    metadata: {
      response_id: payload.id ?? null,
      status: payload.status ?? null,
      usage: payload.usage ?? null,
      latency_ms: latencyMs,
    },
  };
}

export async function runOpenAIResponsesEval(fixture, outputDir, options = {}) {
  if (!outputDir) {
    throw new AosSkillsError('--output-dir is required for OpenAI live eval runs', 'MISSING_ARG', {
      flag: '--output-dir',
    });
  }
  const packets = buildPromptPackets(fixture, {
    caseIds: options.caseIds,
    matrixIds: options.matrixIds,
  });
  if (!packets.length) {
    throw new AosSkillsError(
      'OpenAI live eval selected zero prompt packets',
      'EMPTY_EVAL_PACKET_SET',
      {
        case_ids: asArray(options.caseIds),
        matrix_ids: asArray(options.matrixIds),
      },
    );
  }
  assertOpenAIAdapterPackets(packets);
  const runnerOptions = normalizeOpenAIResponsesOptions(options);
  await mkdir(outputDir, { recursive: true });
  const matrixIds = [...new Set(packets.map((packet) => packet.matrix_id))];
  for (const matrixId of matrixIds) {
    await assertCapturedRunFileAvailable(
      outputDir,
      `${matrixId}__${OPENAI_RESPONSES_ADAPTER_ID}__${runnerOptions.sessionId}`,
      { replace: runnerOptions.replace },
    );
  }
  const runsByMatrix = new Map();
  const errors = [];

  for (const packet of packets) {
    const runId = runIdForPacket(packet, runnerOptions.sessionId);
    if (!runsByMatrix.has(packet.matrix_id)) {
      runsByMatrix.set(packet.matrix_id, {
        id: runId,
        provider: OPENAI_RESPONSES_ADAPTER_ID,
        model: packet.model,
        reasoning_effort: packet.reasoning_effort,
        mode: 'live_openai_responses_capture',
        case_responses: [],
        metadata: {
          adapter: OPENAI_RESPONSES_ADAPTER_ID,
          matrix_id: packet.matrix_id,
          session_id: runnerOptions.sessionId,
          prompt_schema_version: packet.schema_version,
          response_schema_version: EVAL_OPENAI_RUN_SCHEMA_VERSION,
          cases_requested: [],
          errors: [],
        },
      });
    }
    const run = runsByMatrix.get(packet.matrix_id);
    run.metadata.cases_requested.push(packet.case_id);
    try {
      const result = await callOpenAIResponses(packet, runnerOptions);
      run.case_responses.push({
        ...result.response,
        provider_metadata: result.metadata,
      });
    } catch (error) {
      const payload = error instanceof AosSkillsError
        ? error.toJSON()
        : { code: 'OPENAI_RESPONSE_ERROR', error: error.message };
      run.metadata.errors.push(payload);
      errors.push(payload);
    }
  }

  const runs = [...runsByMatrix.values()];
  const files = [];
  for (const run of runs) {
    files.push(await writeCapturedRunFile(outputDir, run, {
      replace: runnerOptions.replace,
    }));
  }

  return {
    schema_version: EVAL_OPENAI_RUN_SCHEMA_VERSION,
    status: errors.length ? 'completed_with_errors' : 'success',
    output_dir: outputDir,
    session_id: runnerOptions.sessionId,
    packets_requested: packets.length,
    runs_written: runs.length,
    errors,
    files,
    runs: runs.map((run) => ({
      id: run.id,
      provider: run.provider,
      model: run.model,
      reasoning_effort: run.reasoning_effort,
      session_id: run.metadata.session_id,
      cases_requested: run.metadata.cases_requested.length,
      cases_captured: run.case_responses.length,
      errors: run.metadata.errors.length,
    })),
  };
}

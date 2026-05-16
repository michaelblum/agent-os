import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_ERROR_CODES, createGateError } from '../../../shared/gate/errors.mjs';
import {
  DEFAULT_GATE_TIMEOUT_MS,
  GATE_PRESET_SET,
  GATE_SCHEMA_VERSION,
  expandGatePresetFields,
  stripUiFields,
} from '../../../shared/gate/presets.mjs';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOL_DIR, '..', '..', '..');
const PROCESS_GRACE_MS = 1000;

export const userSignalSurfaceTool = {
  name: 'user_signal_surface',
  description:
    'Request a bounded structured human decision via a transient AOS surface. ' +
    'Returns the resolved value or a no-answer envelope; operational failures are tool errors.',
  inputSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      schema_version: { const: 'aos.gate.request.v1' },
      title: { type: 'string' },
      message: { type: 'string' },
      preset: {
        type: 'string',
        enum: ['yes_no_with_escape', 'approve_deny', 'single_choice', 'multi_choice', 'freetext'],
      },
      choices: { type: 'array', items: { type: 'object' } },
      timeout_seconds: { type: 'number', minimum: 0 },
      request: { type: 'object', additionalProperties: true },
      id: { type: 'string' },
      prompt: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: ['string', 'null'] },
        },
        required: ['title'],
      },
      response_schema: { type: 'object' },
      fields: { $ref: '#/$defs/fields' },
      ui: {
        type: 'object',
        additionalProperties: true,
        properties: {
          variant: {
            type: ['string', 'null'],
            enum: ['yes_no_with_escape', 'approve_deny', 'single_choice', 'multi_choice', 'freetext', null],
          },
          fields: { $ref: '#/$defs/fields' },
          timer: { type: 'object', additionalProperties: true },
        },
      },
      timeout_ms: { type: 'number', minimum: 0 },
      source: {
        type: 'object',
        additionalProperties: true,
        properties: {
          surface: { type: 'string' },
          session_id: { type: ['string', 'null'] },
          agent: { type: ['string', 'null'] },
        },
      },
    },
    $defs: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['id', 'kind'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: {
              type: 'string',
              enum: ['boolean', 'exclusive_choice', 'multi_choice', 'text', 'number'],
            },
            label: { type: 'string' },
            style: { type: 'string' },
            placeholder: { type: 'string' },
            options: { type: 'array', items: { type: 'object' } },
            visible_when: { type: 'object' },
          },
        },
      },
    },
  },
};

export async function userSignalSurface(args = {}, options = {}) {
  const request = normalizeRequest(args);
  const requestDir = await mkdtemp(join(tmpdir(), 'aos-gate-request-'));
  const requestPath = join(requestDir, 'request.json');
  const execFileFn = options.execFile ?? execFile;
  const timeout = options.timeoutMs ?? request.timeout_ms + PROCESS_GRACE_MS;
  const cwd = options.cwd ?? REPO_ROOT;
  const command = options.command ?? './aos';

  try {
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, 'utf8');
    const stdout = await execAosGateAsk(execFileFn, command, requestPath, { cwd, timeout });
    return parseGateStdout(stdout);
  } finally {
    await rm(requestDir, { recursive: true, force: true });
  }
}

function normalizeRequest(args) {
  const raw = args.request && typeof args.request === 'object' && !Array.isArray(args.request)
    ? args.request
    : args;
  const request = raw.prompt
    ? { ...raw }
    : {
      schema_version: GATE_SCHEMA_VERSION,
      prompt: { title: raw.title, body: raw.message ?? null },
      ui: { variant: raw.preset || 'yes_no_with_escape' },
      choices: raw.choices,
      timeout_ms: Number.isFinite(raw.timeout_seconds) ? raw.timeout_seconds * 1000 : raw.timeout_ms,
    };

  if (!request.prompt?.title) {
    throw createGateError(GATE_ERROR_CODES.invalidRequest, 'prompt.title or title is required');
  }

  const uiFields = Array.isArray(request.ui?.fields) ? request.ui.fields : null;
  request.schema_version = request.schema_version ?? GATE_SCHEMA_VERSION;
  request.timeout_ms = Number.isFinite(request.timeout_ms) ? request.timeout_ms : DEFAULT_GATE_TIMEOUT_MS;
  request.ui = stripUiFields(request.ui);
  if (!Array.isArray(request.fields) && uiFields) {
    request.fields = uiFields;
  }
  if (!Array.isArray(request.fields)) {
    const variant = request.ui.variant ?? 'freetext';
    if (variant !== null && variant !== undefined && !GATE_PRESET_SET.has(variant)) {
      throw createGateError(GATE_ERROR_CODES.invalidRequest, `unsupported ui.variant: ${variant}`);
    }
    request.fields = expandGatePresetFields(variant || 'freetext', request);
  }
  request.source = {
    surface: 'aos-gateway-mcp',
    ...(request.source ?? {}),
  };
  return request;
}

function execAosGateAsk(execFileFn, command, requestPath, options) {
  return new Promise((resolve, reject) => {
    execFileFn(
      command,
      ['gate', 'ask', '--request', requestPath],
      options,
      (error, stdout, stderr) => {
        if (error) {
          reject(errorFromSubprocess(error, stderr));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseGateStdout(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) throw createGateError(GATE_ERROR_CODES.emptyStdout, 'aos gate ask returned empty stdout');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw createGateError(GATE_ERROR_CODES.malformedStdout, `aos gate ask returned malformed JSON: ${error.message}`, { cause: error });
  }
}

function errorFromSubprocess(error, stderr) {
  const text = stderr?.trim() || error.message || 'aos gate ask failed';
  const match = text.match(/^aos gate ask:\s+([A-Z0-9_]+):\s+([\s\S]+)$/);
  const code = match?.[1] || (error.killed ? GATE_ERROR_CODES.processTimeout : GATE_ERROR_CODES.processFailed);
  const message = match?.[2] || text;
  return createGateError(code, message, { cause: error });
}

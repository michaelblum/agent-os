import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOL_DIR, '..', '..', '..');
const DEFAULT_TIMEOUT_MS = 20000;
const PROCESS_GRACE_MS = 1000;

export const userSignalSurfaceTool = {
  name: 'user_signal_surface',
  description:
    'Request a bounded structured human decision via a transient AOS surface. ' +
    'Returns the resolved value or null.',
  inputSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      schema_version: { const: 'aos.gate.request.v1' },
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
    required: ['prompt'],
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
  const request = { ...args };
  request.schema_version = request.schema_version ?? 'aos.gate.request.v1';
  request.timeout_ms = Number.isFinite(request.timeout_ms) ? request.timeout_ms : DEFAULT_TIMEOUT_MS;
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
          const message = stderr?.trim() || error.message || 'aos gate ask failed';
          reject(new Error(message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseGateStdout(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) throw new Error('aos gate ask returned empty stdout');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`aos gate ask returned malformed JSON: ${error.message}`);
  }
}

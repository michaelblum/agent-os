import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

import { loadSkillCatalog } from './catalog.mjs';
import { AosSkillsError, isObject, sha256Text } from './shared.mjs';

export const EVAL_SCHEMA_VERSION = 'aos.skills.agentic-efficacy-eval.v0';
export const EVAL_REPORT_SCHEMA_VERSION = 'aos.skills.agentic-efficacy-report.v0';
export const EVAL_PROMPT_PACKET_SCHEMA_VERSION = 'aos.skills.agentic-efficacy-prompt.v0';
export const EVAL_OPENAI_RUN_SCHEMA_VERSION = 'aos.skills.agentic-efficacy.openai-run.v0';

const DEFAULT_PASS_SCORE = 80;
const DEFAULT_WEIGHTS = {
  response_shape: 10,
  skill_selection: 15,
  command_manifest: 25,
  required_commands: 20,
  stop_and_decision: 20,
  boundary_avoidance: 10,
};

const directAosCommand = /^\.\/aos(?:\s|$)/;
const projectWrapperPattern = /\b(?:pnpm|npm|yarn|bun)\b|\bnode\s+scripts\/|\.\/scripts\/|raw daemon HTTP|curl\s+http:\/\/127\.0\.0\.1/;
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

export function commandTokens(command) {
  return [...String(command ?? '').matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((match) => match[0]);
}

function usagePrefix(form) {
  const tokens = commandTokens(form.usage ?? '');
  if (tokens[0] !== 'aos') return [];
  const prefix = [];
  for (const token of tokens.slice(1)) {
    if (
      token.startsWith('<')
      || token.startsWith('[')
      || token.startsWith('(')
      || token.startsWith('--')
      || token.includes('|')
    ) break;
    prefix.push(token);
  }
  return prefix;
}

function formFlagTokens(form) {
  return new Set((form.args ?? [])
    .filter((arg) => arg.kind === 'flag' && arg.token)
    .map((arg) => arg.token));
}

export function manifestForms(manifest) {
  const forms = [];
  for (const command of manifest.commands ?? []) {
    for (const form of command.forms ?? []) {
      forms.push({
        command,
        form,
        prefix: usagePrefix(form),
        flags: formFlagTokens(form),
      });
    }
  }
  return forms;
}

function matchingManifestForm(command, forms) {
  const tokens = commandTokens(command);
  if (tokens[0] !== './aos') return null;
  const body = tokens.slice(1);
  const matches = forms
    .filter(({ prefix }) => prefix.length > 0 && prefix.every((token, index) => body[index] === token))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return matches[0] ?? null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveOpenAIApiKey(options) {
  if (Object.hasOwn(options, 'apiKey')) return options.apiKey;
  return process.env.AOS_AGENT_PROVIDER_API_KEY || process.env.OPENAI_API_KEY;
}

function openAIResponsesUrl(baseUrl) {
  if (!baseUrl) return OPENAI_RESPONSES_URL;
  return `${String(baseUrl).replace(/\/+$/, '')}/responses`;
}

function responseFileName(runId) {
  return `${String(runId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
}

function regexpFromSpec(spec) {
  if (typeof spec === 'string') return new RegExp(spec);
  if (isObject(spec) && typeof spec.pattern === 'string') return new RegExp(spec.pattern);
  throw new AosSkillsError('Invalid eval regex spec', 'INVALID_EVAL_FIXTURE', { spec });
}

function check(ok, id, message, points, max, details = {}) {
  return {
    id,
    ok: Boolean(ok),
    points: ok ? points : 0,
    max,
    message,
    ...details,
  };
}

function textCorpus(response) {
  return [
    ...asArray(response?.selected_skills),
    ...asArray(response?.selected_commands),
    response?.decision,
    response?.stop_condition,
    response?.notes,
  ].filter(Boolean).join('\n');
}

function commandManifestChecks(commands, forms) {
  const findings = [];
  for (const command of commands) {
    if (!directAosCommand.test(command)) {
      findings.push({
        command,
        code: projectWrapperPattern.test(command) ? 'PROJECT_WRAPPER_COMMAND' : 'NON_DIRECT_AOS_COMMAND',
        message: 'command is not a direct ./aos command',
      });
      continue;
    }
    const match = matchingManifestForm(command, forms);
    if (!match) {
      findings.push({
        command,
        code: 'UNKNOWN_AOS_COMMAND',
        message: 'command does not match any current AOS command manifest form',
      });
      continue;
    }
    const flags = commandTokens(command).filter((token) => token.startsWith('--'));
    for (const flag of flags) {
      if (!match.flags.has(flag)) {
        findings.push({
          command,
          flag,
          form_id: match.form.id,
          code: 'UNSUPPORTED_FLAG',
          message: `flag ${flag} is not supported by ${match.form.id}`,
        });
      }
    }
    if (match.form.id === 'focus-create') {
      const tokens = commandTokens(command);
      const targetIndex = tokens.indexOf('--target');
      if (targetIndex !== -1 && !['browser://attach', 'browser://new'].includes(tokens[targetIndex + 1])) {
        findings.push({
          command,
          target: tokens[targetIndex + 1],
          code: 'UNSUPPORTED_FOCUS_TARGET',
          message: 'focus create target is not a documented browser target',
        });
      }
    }
  }
  return findings;
}

function evaluateCase(testCase, response, context) {
  const weights = { ...DEFAULT_WEIGHTS, ...(testCase.weights ?? {}) };
  const selectedSkills = asArray(response?.selected_skills);
  const selectedCommands = asArray(response?.selected_commands);
  const corpus = textCorpus(response);
  const checks = [];

  checks.push(check(
    isObject(response)
      && selectedSkills.every((skill) => typeof skill === 'string' && skill.length > 0)
      && selectedCommands.every((command) => typeof command === 'string' && command.length > 0)
      && typeof response?.decision === 'string'
      && typeof response?.stop_condition === 'string',
    'response_shape',
    'response has selected_skills, selected_commands, decision, and stop_condition',
    weights.response_shape,
    weights.response_shape,
  ));

  const missingSkills = asArray(testCase.expected_skills).filter((skill) => !selectedSkills.includes(skill));
  const retiredSkills = selectedSkills.filter((skill) => context.retiredSkills.has(skill));
  checks.push(check(
    missingSkills.length === 0 && retiredSkills.length === 0,
    'skill_selection',
    'selected skills include required current skills and avoid retired skills',
    weights.skill_selection,
    weights.skill_selection,
    { missing_skills: missingSkills, retired_skills: retiredSkills },
  ));

  const commandFindings = commandManifestChecks(selectedCommands, context.forms);
  checks.push(check(
    selectedCommands.length > 0 && commandFindings.length === 0,
    'command_manifest',
    'selected commands are direct ./aos commands backed by current manifests',
    weights.command_manifest,
    weights.command_manifest,
    { findings: commandFindings },
  ));

  const missingRequiredCommands = asArray(testCase.required_commands)
    .filter((spec) => !selectedCommands.some((command) => regexpFromSpec(spec).test(command)))
    .map((spec) => (typeof spec === 'string' ? spec : spec.pattern));
  checks.push(check(
    missingRequiredCommands.length === 0,
    'required_commands',
    'selected commands cover required behavior checkpoints',
    weights.required_commands,
    weights.required_commands,
    { missing_patterns: missingRequiredCommands },
  ));

  const missingDecisionTerms = asArray(testCase.expected_decision_terms)
    .filter((term) => !new RegExp(term, 'i').test(corpus));
  const missingStopTerms = asArray(testCase.expected_stop_terms)
    .filter((term) => !new RegExp(term, 'i').test(corpus));
  checks.push(check(
    missingDecisionTerms.length === 0 && missingStopTerms.length === 0,
    'stop_and_decision',
    'decision and stop condition preserve the expected operating judgment',
    weights.stop_and_decision,
    weights.stop_and_decision,
    { missing_decision_terms: missingDecisionTerms, missing_stop_terms: missingStopTerms },
  ));

  const forbiddenHits = asArray(testCase.forbidden_patterns)
    .map((spec) => ({ pattern: typeof spec === 'string' ? spec : spec.pattern, regex: regexpFromSpec(spec) }))
    .filter(({ regex }) => regex.test(corpus))
    .map(({ pattern }) => pattern);
  checks.push(check(
    forbiddenHits.length === 0,
    'boundary_avoidance',
    'response avoids forbidden wrappers, unsupported commands, and unsafe shortcuts',
    weights.boundary_avoidance,
    weights.boundary_avoidance,
    { forbidden_hits: forbiddenHits },
  ));

  const points = checks.reduce((sum, item) => sum + item.points, 0);
  const max = checks.reduce((sum, item) => sum + item.max, 0);
  const score = max ? Math.round((points / max) * 1000) / 10 : 0;
  const passScore = testCase.pass_score ?? context.passScore;
  return {
    case_id: testCase.id,
    score,
    pass_score: passScore,
    passed: score >= passScore && checks.every((item) => item.ok),
    checks,
  };
}

function responseForCase(run, caseId) {
  const responses = asArray(run.case_responses);
  return responses.find((response) => response.case_id === caseId) ?? null;
}

function summarizeRuns(runs) {
  const evaluated = runs.length;
  const failed = runs.filter((run) => !run.passed).length;
  return {
    evaluated,
    passed: evaluated - failed,
    failed,
    average_score: evaluated
      ? Math.round((runs.reduce((sum, run) => sum + run.average_score, 0) / evaluated) * 10) / 10
      : null,
  };
}

export async function loadEvalFixture(fixturePath) {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

export async function loadResponseRuns(responseDir) {
  if (!responseDir) return [];
  const entries = await readdir(responseDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const payload = JSON.parse(await readFile(path.join(responseDir, entry.name), 'utf8'));
    if (Array.isArray(payload.runs)) runs.push(...payload.runs);
    else if (isObject(payload.run)) runs.push(payload.run);
    else if (isObject(payload) && payload.id && Array.isArray(payload.case_responses)) runs.push(payload);
    else throw new AosSkillsError('Response file does not contain an eval run', 'INVALID_EVAL_RESPONSE', {
      path: path.join(responseDir, entry.name),
    });
  }
  return runs;
}

export async function evaluateSkillEfficacy(fixture, options = {}) {
  if (fixture.schema_version !== EVAL_SCHEMA_VERSION) {
    throw new AosSkillsError('Unsupported AOS skills eval fixture schema', 'UNSUPPORTED_EVAL_SCHEMA', {
      schema_version: fixture.schema_version,
    });
  }
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const manifestPath = options.commandManifestPath
    ? path.resolve(options.commandManifestPath)
    : path.join(repoRoot, 'manifests/commands/aos-commands.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const catalog = await loadSkillCatalog({ repoRoot });
  const retiredSkills = new Set((catalog.registry.skills ?? [])
    .filter((skill) => skill.status === 'retired')
    .map((skill) => skill.name));
  const cases = asArray(fixture.cases);
  const selectedCaseIds = new Set(asArray(options.caseIds));
  const selectedRunIds = new Set(asArray(options.runIds));
  const activeCases = selectedCaseIds.size ? cases.filter((item) => selectedCaseIds.has(item.id)) : cases;
  const responseRuns = [
    ...asArray(fixture.runs),
    ...asArray(options.extraRuns),
  ];
  const activeRuns = selectedRunIds.size ? responseRuns.filter((run) => selectedRunIds.has(run.id)) : responseRuns;
  const context = {
    forms: manifestForms(manifest),
    passScore: options.passScore ?? fixture.pass_score ?? DEFAULT_PASS_SCORE,
    retiredSkills,
  };

  const runs = activeRuns.map((run) => {
    const caseResults = activeCases.map((testCase) => {
      const response = responseForCase(run, testCase.id);
      if (!response) {
        return {
          case_id: testCase.id,
          score: 0,
          pass_score: testCase.pass_score ?? context.passScore,
          passed: false,
          checks: [
            check(false, 'response_present', 'run contains a response for the case', 0, 100),
          ],
        };
      }
      return evaluateCase(testCase, response, context);
    });
    const averageScore = caseResults.length
      ? Math.round((caseResults.reduce((sum, item) => sum + item.score, 0) / caseResults.length) * 10) / 10
      : 0;
    return {
      id: run.id,
      provider: run.provider,
      model: run.model,
      reasoning_effort: run.reasoning_effort ?? null,
      mode: run.mode ?? 'offline_fixture',
      average_score: averageScore,
      passed: caseResults.length > 0 && caseResults.every((item) => item.passed),
      cases: caseResults,
    };
  });

  return {
    schema_version: EVAL_REPORT_SCHEMA_VERSION,
    status: runs.length ? 'evaluated' : 'planned',
    fixture_id: fixture.id,
    fixture_digest: sha256Text(JSON.stringify(fixture)),
    pass_score: context.passScore,
    matrix: asArray(fixture.matrix),
    cases: activeCases.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      expected_skills: asArray(item.expected_skills),
    })),
    summary: summarizeRuns(runs),
    runs,
  };
}

export function buildPromptPackets(fixture, options = {}) {
  const cases = asArray(fixture.cases);
  const matrix = asArray(fixture.matrix);
  const selectedCaseIds = new Set(asArray(options.caseIds));
  const selectedMatrixIds = new Set(asArray(options.matrixIds));
  const activeCases = selectedCaseIds.size ? cases.filter((item) => selectedCaseIds.has(item.id)) : cases;
  const activeMatrix = selectedMatrixIds.size ? matrix.filter((item) => selectedMatrixIds.has(item.id)) : matrix;

  return activeMatrix.flatMap((entry) => activeCases.map((testCase) => ({
    schema_version: EVAL_PROMPT_PACKET_SCHEMA_VERSION,
    id: `${entry.id}__${testCase.id}`,
    matrix_id: entry.id,
    case_id: testCase.id,
    provider: entry.provider,
    model: entry.model,
    reasoning_effort: entry.reasoning_effort ?? null,
    skill_target: fixture.skill_target,
    system_prompt: [
      'You are a fresh coding agent evaluating AOS installable skills.',
      'Use only direct ./aos commands unless the task explicitly asks for an external companion escape hatch.',
      'Do not assume repo internals; discover command forms through help and installed skills.',
      'Return only JSON matching the response_contract.',
    ].join(' '),
    user_prompt: testCase.prompt,
    response_contract: {
      case_id: testCase.id,
      selected_skills: ['skill-name'],
      selected_commands: ['./aos ...'],
      decision: 'short rationale for the route',
      stop_condition: 'when the agent must stop instead of guessing',
      notes: 'optional extra detail, or an empty string',
    },
  })));
}

export function buildOpenAIResponsesRequest(packet, options = {}) {
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
  const maxOutputTokens = asPositiveInteger(options.maxOutputTokens);
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
  const captured = JSON.parse(text);
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
  const apiKey = resolveOpenAIApiKey(options);
  if (!apiKey) {
    throw new AosSkillsError(
      'OPENAI_API_KEY or AOS_AGENT_PROVIDER_API_KEY is required for OpenAI live eval runs',
      'MISSING_OPENAI_API_KEY',
    );
  }
  const packets = buildPromptPackets(fixture, {
    caseIds: options.caseIds,
    matrixIds: options.matrixIds,
  });
  await mkdir(outputDir, { recursive: true });
  const runsByMatrix = new Map();
  const errors = [];

  for (const packet of packets) {
    const runId = `${packet.matrix_id}__openai-responses`;
    if (!runsByMatrix.has(packet.matrix_id)) {
      runsByMatrix.set(packet.matrix_id, {
        id: runId,
        provider: 'openai-responses',
        model: packet.model,
        reasoning_effort: packet.reasoning_effort,
        mode: 'live_openai_responses_capture',
        case_responses: [],
        metadata: {
          matrix_id: packet.matrix_id,
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
      const result = await callOpenAIResponses(packet, {
        ...options,
        apiKey,
      });
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
  for (const run of runs) {
    await writeFile(
      path.join(outputDir, responseFileName(run.id)),
      `${JSON.stringify({ run }, null, 2)}\n`,
    );
  }

  return {
    schema_version: EVAL_OPENAI_RUN_SCHEMA_VERSION,
    status: errors.length ? 'completed_with_errors' : 'success',
    output_dir: outputDir,
    packets_requested: packets.length,
    runs_written: runs.length,
    errors,
    runs: runs.map((run) => ({
      id: run.id,
      provider: run.provider,
      model: run.model,
      reasoning_effort: run.reasoning_effort,
      cases_requested: run.metadata.cases_requested.length,
      cases_captured: run.case_responses.length,
      errors: run.metadata.errors.length,
    })),
  };
}

export async function writePromptPackets(fixture, outputDir, options = {}) {
  const packets = buildPromptPackets(fixture, options);
  await mkdir(outputDir, { recursive: true });
  for (const packet of packets) {
    await writeFile(
      path.join(outputDir, `${packet.id}.json`),
      `${JSON.stringify(packet, null, 2)}\n`,
    );
  }
  return {
    schema_version: 'aos.skills.agentic-efficacy-prompt-write.v0',
    status: 'success',
    output_dir: outputDir,
    packets_written: packets.length,
    packets: packets.map((packet) => ({
      id: packet.id,
      provider: packet.provider,
      model: packet.model,
      reasoning_effort: packet.reasoning_effort,
      case_id: packet.case_id,
    })),
  };
}

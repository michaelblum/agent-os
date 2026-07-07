import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildPromptPackets,
  evaluateSkillEfficacy,
  loadEvalFixture,
  loadResponseRuns,
  writePromptPackets,
} from '../scripts/lib/aos-skills/eval.mjs';
import {
  buildOpenAIResponsesRequest,
  runOpenAIResponsesEval,
} from '../scripts/lib/aos-skills/openai-responses-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json');

test('AOS skills efficacy fixture scores strong and weak model captures differently', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const report = await evaluateSkillEfficacy(fixture, { repoRoot });

  assert.equal(report.schema_version, 'aos.skills.agentic-efficacy-report.v0');
  assert.equal(report.status, 'evaluated');
  assert.equal(report.summary.evaluated, 2);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.failed, 1);

  const strong = report.runs.find((run) => run.id === 'fixture-strong-high');
  const weak = report.runs.find((run) => run.id === 'fixture-weak-low');
  assert.ok(strong.passed);
  assert.ok(strong.average_score >= 95);
  assert.equal(weak.passed, false);
  assert.ok(weak.average_score < 70);
});

test('AOS skills efficacy scorer catches unsupported flags and retired skill use', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const report = await evaluateSkillEfficacy(fixture, {
    repoRoot,
    runIds: ['fixture-weak-low'],
    caseIds: ['desktop-window-control-inventory'],
  });

  const result = report.runs[0].cases[0];
  assert.equal(result.passed, false);
  const commandCheck = result.checks.find((item) => item.id === 'command_manifest');
  const boundaryCheck = result.checks.find((item) => item.id === 'boundary_avoidance');
  assert.equal(commandCheck.ok, false);
  assert.ok(commandCheck.findings.some((finding) => finding.code === 'UNSUPPORTED_FLAG'));
  assert.equal(boundaryCheck.ok, false);
  assert.ok(boundaryCheck.forbidden_hits.some((pattern) => pattern.includes('graph windows --json')));
});

test('AOS skills efficacy prompt packets cover model reasoning matrix without leaking answers', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const packets = buildPromptPackets(fixture, {
    caseIds: ['browser-boundary'],
    matrixIds: ['codex-gpt-5.4-mini-low', 'codex-gpt-5.4-mini-high'],
  });

  assert.equal(packets.length, 2);
  assert.deepEqual(
    packets.map((packet) => [packet.model, packet.reasoning_effort]),
    [
      ['gpt-5.4-mini', 'low'],
      ['gpt-5.4-mini', 'high'],
    ],
  );
  for (const packet of packets) {
    assert.equal(packet.schema_version, 'aos.skills.agentic-efficacy-prompt.v0');
    assert.equal(packet.case_id, 'browser-boundary');
    assert.match(packet.system_prompt, /Return only JSON/);
    assert.doesNotMatch(packet.user_prompt, /required_commands/);
    assert.doesNotMatch(packet.user_prompt, /expected_decision_terms/);
  }
});

test('AOS skills efficacy prompt writer creates stable packet files', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-eval-prompts-'));
  try {
    const result = await writePromptPackets(fixture, tempRoot, {
      caseIds: ['readiness-route'],
      matrixIds: ['codex-gpt-5.4-mini-medium'],
    });
    assert.equal(result.status, 'success');
    assert.equal(result.packets_written, 1);
    const packetPath = path.join(tempRoot, 'codex-gpt-5.4-mini-medium__readiness-route.json');
    const packet = JSON.parse(await readFile(packetPath, 'utf8'));
    assert.equal(packet.provider, 'codex');
    assert.equal(packet.adapter, 'openai-responses');
    assert.equal(packet.reasoning_effort, 'medium');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('AOS skills OpenAI request uses reasoning effort and structured output schema', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const packet = buildPromptPackets(fixture, {
    caseIds: ['readiness-route'],
    matrixIds: ['codex-gpt-5.4-mini-high'],
  })[0];
  const request = buildOpenAIResponsesRequest(packet, { maxOutputTokens: 500 });

  assert.equal(request.model, 'gpt-5.4-mini');
  assert.deepEqual(request.reasoning, { effort: 'high' });
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 500);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.ok(request.text.format.schema.required.includes('selected_commands'));
  assert.match(request.input, /Response contract/);
});

test('AOS skills OpenAI request rejects output token limits below provider minimum', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const packet = buildPromptPackets(fixture, {
    caseIds: ['readiness-route'],
    matrixIds: ['codex-gpt-5.4-mini-high'],
  })[0];

  assert.throws(
    () => buildOpenAIResponsesRequest(packet, { maxOutputTokens: 15 }),
    /--max-output-tokens must be an integer >= 16/,
  );
});

test('AOS skills OpenAI live runner captures response JSON for later scoring', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-eval-openai-'));
  const calls = [];
  const runOptions = {
    apiKey: 'test-key',
    caseIds: ['readiness-route'],
    matrixIds: ['codex-gpt-5.4-mini-low'],
    sessionId: 'unit-session',
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'resp_test',
          status: 'completed',
          usage: { total_tokens: 123 },
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    case_id: 'readiness-route',
                    selected_skills: [
                      'aos-core-orientation',
                      'aos-runtime-readiness',
                    ],
                    selected_commands: [
                      './aos help ready --json',
                      './aos ready --json',
                      './aos status --json',
                    ],
                    decision: 'Use ready and status before desktop work.',
                    stop_condition: 'Stop before raw daemon internals or state-file inspection.',
                    notes: '',
                  }),
                },
              ],
            },
          ],
        }),
      };
    },
  };
  try {
    const result = await runOpenAIResponsesEval(fixture, tempRoot, runOptions);

    assert.equal(result.status, 'success');
    assert.equal(result.session_id, 'unit-session');
    assert.equal(result.packets_requested, 1);
    assert.equal(result.runs_written, 1);
    assert.equal(result.files.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(calls[0].body.reasoning, { effort: 'low' });

    const runs = await loadResponseRuns(tempRoot);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].provider, 'openai-responses');
    assert.match(runs[0].id, /unit-session$/);
    assert.equal(runs[0].case_responses[0].provider_metadata.response_id, 'resp_test');

    const callsBeforeDuplicate = calls.length;
    await assert.rejects(
      runOpenAIResponsesEval(fixture, tempRoot, runOptions),
      /Captured eval run file already exists/,
    );
    assert.equal(calls.length, callsBeforeDuplicate);

    const replaced = await runOpenAIResponsesEval(fixture, tempRoot, {
      ...runOptions,
      replace: true,
    });
    assert.equal(replaced.status, 'success');

    const report = await evaluateSkillEfficacy(fixture, {
      repoRoot,
      caseIds: ['readiness-route'],
      extraRuns: runs,
      runIds: [runs[0].id],
    });
    assert.equal(report.summary.passed, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('AOS skills OpenAI live runner rejects matrix rows without OpenAI adapter', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const invalidFixture = {
    ...fixture,
    matrix: [
      {
        ...fixture.matrix[0],
        adapter: 'other-provider',
      },
    ],
  };

  await assert.rejects(
    runOpenAIResponsesEval(invalidFixture, '/tmp/aos-skills-eval-unused', {
      apiKey: 'test-key',
      caseIds: ['readiness-route'],
      fetch: async () => assert.fail('fetch should not run for an unsupported adapter'),
    }),
    /requires matrix rows with adapter openai-responses/,
  );
});

test('AOS skills OpenAI live runner fails closed without API key', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-eval-openai-key-'));
  try {
    await assert.rejects(
      runOpenAIResponsesEval(fixture, tempRoot, {
        apiKey: '',
        caseIds: ['readiness-route'],
        matrixIds: ['codex-gpt-5.4-mini-low'],
        fetch: async () => assert.fail('fetch should not run without an API key'),
      }),
      /OPENAI_API_KEY or AOS_AGENT_PROVIDER_API_KEY/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('AOS skills efficacy CLI emits JSON report and supports threshold exit mode', () => {
  const cli = path.join(repoRoot, 'scripts/aos-skills-eval.mjs');
  const normal = spawnSync(process.execPath, [cli, '--fixture', fixturePath, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(normal.status, 0, normal.stderr);
  const payload = JSON.parse(normal.stdout);
  assert.equal(payload.summary.failed, 1);

  const threshold = spawnSync(process.execPath, [cli, '--fixture', fixturePath, '--json', '--fail-on-threshold'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(threshold.status, 1);
  assert.equal(JSON.parse(threshold.stdout).summary.failed, 1);
});

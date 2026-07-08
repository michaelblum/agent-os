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

test('AOS skills efficacy scorer catches malformed manifest-backed command shapes', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const run = {
    id: 'fixture-bad-command-shape',
    provider: 'fixture',
    model: 'shape-regression',
    mode: 'offline_fixture',
    case_responses: [
      {
        case_id: 'desktop-window-control-inventory',
        selected_skills: ['aos-desktop'],
        selected_commands: [
          './aos do raise',
          './aos focus create --id browser-proof',
          './aos focus create --id browser-proof --window 123 --target browser://new',
        ],
        decision: 'Use raise and stop on unsupported fullscreen, menu, or Space verbs.',
        stop_condition: 'Stop on unsupported fullscreen, menu invocation, or Space switching.',
      },
    ],
  };
  const report = await evaluateSkillEfficacy({
    ...fixture,
    runs: [],
  }, {
    repoRoot,
    extraRuns: [run],
    runIds: [run.id],
    caseIds: ['desktop-window-control-inventory'],
  });

  const result = report.runs[0].cases[0];
  assert.equal(result.passed, false);
  const commandCheck = result.checks.find((item) => item.id === 'command_manifest');
  assert.equal(commandCheck.ok, false);
  assert.ok(commandCheck.findings.some((finding) => (
    finding.code === 'MISSING_REQUIRED_FLAG'
    && finding.form_id === 'do-raise'
    && finding.flag === '--pid'
  )));
  assert.ok(commandCheck.findings.some((finding) => (
    finding.code === 'MISSING_ONE_OF'
    && finding.form_id === 'focus-create'
  )));
  assert.ok(commandCheck.findings.some((finding) => (
    finding.code === 'CONFLICTING_ARGS'
    && finding.form_id === 'focus-create'
  )));
});

test('AOS skills efficacy selectors fail closed on unknown ids', async () => {
  const fixture = await loadEvalFixture(fixturePath);

  await assert.rejects(
    evaluateSkillEfficacy(fixture, { repoRoot, caseIds: ['missing-case'] }),
    (error) => {
      assert.equal(error.code, 'UNKNOWN_EVAL_CASE');
      assert.deepEqual(error.details.unknown, ['missing-case']);
      return true;
    },
  );
  await assert.rejects(
    evaluateSkillEfficacy(fixture, { repoRoot, runIds: ['missing-run'] }),
    (error) => {
      assert.equal(error.code, 'UNKNOWN_EVAL_RUN');
      assert.deepEqual(error.details.unknown, ['missing-run']);
      return true;
    },
  );
  assert.throws(
    () => buildPromptPackets(fixture, { matrixIds: ['missing-matrix'] }),
    (error) => {
      assert.equal(error.code, 'UNKNOWN_EVAL_MATRIX');
      assert.deepEqual(error.details.unknown, ['missing-matrix']);
      return true;
    },
  );
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

test('AOS skills OpenAI live runner requires explicit allow-partial before writing packet failures', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-eval-partial-'));
  const runOptions = {
    apiKey: 'test-key',
    caseIds: ['readiness-route'],
    matrixIds: ['codex-gpt-5.4-mini-low'],
    sessionId: 'partial-session',
    fetch: async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }),
  };
  try {
    await assert.rejects(
      runOpenAIResponsesEval(fixture, tempRoot, runOptions),
      (error) => {
        assert.equal(error.code, 'OPENAI_EVAL_PARTIAL_CAPTURE');
        assert.equal(error.details.packets_requested, 1);
        assert.equal(error.details.errors.length, 1);
        return true;
      },
    );
    assert.equal((await loadResponseRuns(tempRoot)).length, 0);

    const allowed = await runOpenAIResponsesEval(fixture, tempRoot, {
      ...runOptions,
      allowPartial: true,
    });
    assert.equal(allowed.status, 'completed_with_errors');
    assert.equal(allowed.runs_written, 1);
    assert.equal(allowed.errors.length, 1);
    const runs = await loadResponseRuns(tempRoot);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].case_responses.length, 0);
    assert.equal(runs[0].metadata.errors.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('AOS skills OpenAI live runner fails closed on empty packet selection', async () => {
  const fixture = await loadEvalFixture(fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aos-skills-eval-empty-'));
  try {
    await assert.rejects(
      runOpenAIResponsesEval({
        ...fixture,
        cases: [],
      }, tempRoot, {
        apiKey: 'test-key',
        matrixIds: ['codex-gpt-5.4-mini-low'],
        fetch: async () => assert.fail('fetch should not run for an empty packet set'),
      }),
      (error) => {
        assert.equal(error.code, 'EMPTY_EVAL_PACKET_SET');
        return true;
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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
      /OPENAI_API_KEY is required for OpenAI live eval runs/,
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

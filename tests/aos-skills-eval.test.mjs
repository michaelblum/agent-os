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
  writePromptPackets,
} from '../scripts/lib/aos-skills/eval.mjs';

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
    assert.equal(packet.reasoning_effort, 'medium');
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

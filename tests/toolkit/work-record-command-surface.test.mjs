import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workRecordSupersessionWriteRecommendation } from '../../packages/toolkit/workbench/work-record-command-recommendation.js';
import { attemptPlan } from '../lib/work-record-v1-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts/aos-work-record.mjs');
const source = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v1/valid/repairable-stale-saved-ref.json');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, expectedStatus, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim() || result.stderr.trim());
}

test('direct Work Record command adapter exposes neutral V1 report and planning forms', () => {
  const sourceBefore = digest(source);
  const profiles = run(['profiles', '--json']);
  assert.deepEqual(profiles.profiles, ['aos.verifier.work-record.v1.report-only']);
  const read = run(['read', source, '--json']);
  assert.equal(read.status, 'success');
  assert.equal(read.record.schema_version, '2026-08-work-record-v1');
  const plan = run(['plan-attempt', source, '--json']);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.executes_actions, false);
  assert.equal(plan.mutates_source, false);
  assert.equal(digest(source), sourceBefore);
});

test('deleted Gate bridge, authority flag, and repair executor are absent from command dispatch', () => {
  const gateCheck = run(['gate-check', source, '--json'], 1);
  assert.equal(gateCheck.code, 'UNKNOWN_COMMAND');
  const authorityFlag = run(['plan-attempt', source, '--authorization', 'answer.json', '--json'], 1);
  assert.equal(authorityFlag.code, 'UNKNOWN_FLAG');
  const execute = run(['repair', 'execute', '--json'], 1);
  assert.equal(execute.code, 'UNKNOWN_COMMAND');
});

test('unsupported verifier profiles return schema-shaped plans and exit nonzero', () => {
  const repair = run(['plan-repair', source, '--profile', 'unknown-profile', '--json'], 1);
  assert.equal(repair.status, 'unsupported');
  assert.deepEqual(repair.plan_steps, []);
  assert.deepEqual(repair.candidate_patches, []);
  assert.deepEqual(repair.recommended_commands, []);
  assert.deepEqual(repair.evidence_refs, []);

  const attempt = run(['plan-attempt', source, '--profile', 'unknown-profile', '--json'], 1);
  assert.equal(attempt.status, 'unsupported');
});

test('artifact and proposal build commands exit nonzero for unusable payloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-build-failure-cli-v1-'));
  const emptyInput = path.join(root, 'empty-input.json');
  const falseSuccessInput = path.join(root, 'false-success-input.json');
  const planPath = path.join(root, 'attempt-plan.json');
  const artifactPath = path.join(root, 'attempt-artifact.json');
  fs.writeFileSync(emptyInput, '{}\n');
  fs.writeFileSync(falseSuccessInput, '{"status":"succeeded"}\n');
  fs.writeFileSync(planPath, `${JSON.stringify(attemptPlan(), null, 2)}\n`);
  fs.writeFileSync(artifactPath, '{}\n');

  const artifact = run(['attempt-artifact', 'build', '--input', emptyInput, '--json'], 1);
  assert.equal(artifact.status, 'unsupported');
  const falseSuccess = run(['attempt-artifact', 'build', '--input', falseSuccessInput, '--json'], 1);
  assert.equal(falseSuccess.status, 'succeeded');

  const proposal = run([
    'replacement-proposal',
    'build',
    '--source', source,
    '--attempt-plan', planPath,
    '--attempt-artifact', artifactPath,
    '--json',
  ], 1);
  assert.equal(proposal.status, 'mismatch');
});

test('each command form rejects parsed flags outside its manifest contract', () => {
  for (const args of [
    ['read', source, '--dry-run', '--json'],
    ['read', source, '--output-root', '/tmp/ignored', '--json'],
    ['verify', source, '--bundle-parent', '/tmp/ignored', '--json'],
    ['plan-attempt', source, '--replacement-root', '/tmp/ignored', '--json'],
    ['repair', 'bundle', 'inspect', '/tmp/missing', '--dry-run', '--json'],
    ['attempt-artifact', 'validate', '/tmp/missing.json', '--output-root', '/tmp/ignored', '--json'],
  ]) {
    assert.equal(run(args, 1).code, 'UNKNOWN_FLAG');
  }
});

test('supersession write requires exact Replacement Writer provenance input', () => {
  const result = run([
    'supersession',
    'write',
    '--source', source,
    '--replacement', source,
    '--index-root', '/tmp/aos-work-record-command-contract-index',
    '--json',
  ], 1);
  assert.equal(result.code, 'MISSING_ARG');
  assert.match(result.error, /--writer-result/);
  assert.deepEqual(workRecordSupersessionWriteRecommendation({
    source,
    replacement: source,
    indexRoot: '/tmp/index',
    replacementRoot: '/tmp/records',
  }).argv, []);
  const recommendation = workRecordSupersessionWriteRecommendation({
    source,
    replacement: source,
    indexRoot: '/tmp/index',
    replacementRoot: '/tmp/records',
    writerResult: '/tmp/writer-result.json',
  });
  const writerResultIndex = recommendation.argv.indexOf('--writer-result');
  assert.equal(recommendation.argv[writerResultIndex + 1], '/tmp/writer-result.json');
});

test('supersession lookup exits nonzero for a malformed index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-malformed-index-cli-v1-'));
  const entryDir = path.join(root, 'source-supersession', 'v1', 'malformed');
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, 'active.json'), '{');
  const result = run([
    'supersession',
    'lookup',
    '--source', source,
    '--index-root', root,
    '--json',
  ], 1);
  assert.equal(result.status, 'malformed_index');
  assert.ok(result.diagnostics.length > 0);
});

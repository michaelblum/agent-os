import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  commandManifestChecks,
  directAosCommand,
  manifestForms,
  projectWrapperPattern,
} from '../scripts/lib/aos-skills/command-shape.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests/fixtures/aos-skills/cold-agent-forward-proof-v0.json');
const commandManifestPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');

async function fixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

async function commandManifest() {
  return JSON.parse(await readFile(commandManifestPath, 'utf8'));
}

const requiredScenarioIds = [
  'readiness-route',
  'desktop-window-control-inventory',
  'saved-workspace-observe-act-recapture',
  'canvas-vision-fallback',
  'focus-session-lifecycle',
  'browser-aos-vs-playwright-escape',
  'verification-assertion-loop',
  'pending-annotation-safe-action',
  'work-record-report-only-recovery',
  'recipe-explain-dry-run',
];

function selectedCommandGroups(proof) {
  return [
    ['preflight', proof.preflight.selected_commands],
    ...proof.scenarios.map((scenario) => [scenario.id, scenario.selected_commands]),
  ];
}

test('cold-agent forward proof covers all required M7 scenarios', async () => {
  const proof = await fixture();
  assert.equal(proof.schema_version, 'aos.skills.cold-agent-forward-proof.v0');
  assert.equal(proof.user_skill_tree_mutation, false);
  assert.equal(proof.live_ui_or_browser_mutation, false);
  assert.equal(proof.temp_install_target.target, 'path');
  assert.equal(proof.temp_install_target.required, true);

  const scenarioIds = proof.scenarios.map((scenario) => scenario.id).sort();
  assert.deepEqual(scenarioIds, [...requiredScenarioIds].sort());
});

test('cold-agent forward proof uses direct AOS commands and no project-local wrapper facades', async () => {
  const proof = await fixture();
  for (const [, commands] of selectedCommandGroups(proof)) {
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.match(command, directAosCommand);
      assert.doesNotMatch(command, /(^|\s)\.\/aos\s+ops(?:\s|$)/);
      assert.doesNotMatch(command, projectWrapperPattern);
    }
  }
});

test('cold-agent forward proof commands are backed by current AOS command manifests', async () => {
  const proof = await fixture();
  const forms = manifestForms(await commandManifest());

  for (const [group, commands] of selectedCommandGroups(proof)) {
    const findings = commandManifestChecks(commands, forms);
    assert.deepEqual(findings, [], `${group}: fixture commands must match current manifests`);
  }
});

test('cold-agent forward proof preserves the AOS browser and Playwright CLI boundary', async () => {
  const proof = await fixture();
  const browser = proof.scenarios.find((scenario) => scenario.id === 'browser-aos-vs-playwright-escape');
  assert.ok(browser);
  assert.ok(browser.selected_commands.some((command) => command.includes('see capture browser:')));
  assert.ok(browser.selected_commands.some((command) => command.includes('do click ref:')));
  assert.ok(browser.playwright_cli_escape_hatch_commands.length > 0);

  for (const command of browser.playwright_cli_escape_hatch_commands) {
    assert.match(command, /^playwright-cli(?:\s|$)/);
    assert.doesNotMatch(command, projectWrapperPattern);
  }

  assert.match(browser.captured_output.decision, /Use AOS for durable browser refs/);
  assert.match(browser.captured_output.decision, /upstream Playwright CLI skills/);
});

test('cold-agent forward proof records prompts, decisions, and stop conditions', async () => {
  const proof = await fixture();
  for (const scenario of [proof.preflight, ...proof.scenarios]) {
    assert.equal(typeof scenario.prompt, 'string');
    assert.ok(scenario.prompt.length > 20);
    assert.equal(typeof scenario.captured_output.decision, 'string');
    assert.ok(scenario.captured_output.decision.length > 20);
    assert.ok(Array.isArray(scenario.selected_skills));
    assert.ok(scenario.selected_skills.length > 0);
  }

  for (const scenario of proof.scenarios) {
    assert.equal(typeof scenario.captured_output.stop_condition, 'string');
    assert.ok(scenario.captured_output.stop_condition.length > 20);
  }
});

test('cold-agent forward proof exercises the desktop Playwright skill pack', async () => {
  const proof = await fixture();
  const selected = new Set([
    ...proof.preflight.selected_skills,
    ...proof.scenarios.flatMap((scenario) => scenario.selected_skills),
  ]);

  for (const skill of [
    'aos-core-orientation',
    'aos-runtime-readiness',
    'aos-desktop',
    'aos-saved-workspace',
    'aos-canvas-vision',
    'aos-focus-sessions',
    'aos-browser',
    'aos-verification',
    'aos-operator-annotations',
    'aos-work-records',
    'aos-recipes',
    'aos-command-surface-maintenance',
  ]) {
    assert.ok(selected.has(skill), `proof missing skill: ${skill}`);
  }
});

test('cold-agent forward proof avoids retired broad skill surfaces', async () => {
  const proof = await fixture();
  const selected = [
    ...proof.preflight.selected_skills,
    ...proof.scenarios.flatMap((scenario) => scenario.selected_skills),
  ];

  assert.equal(selected.includes('aos-agent-workspace'), false);
  assert.equal(selected.includes('browser-adapter'), false);
});

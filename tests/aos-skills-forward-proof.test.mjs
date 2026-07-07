import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

const directAosCommand = /^\.\/aos(?:\s|$)/;
const projectWrapperPattern = /\b(?:pnpm|npm|yarn|bun)\b|\bnode\s+scripts\/|\.\/scripts\/|raw daemon HTTP|curl\s+http:\/\/127\.0\.0\.1/;

function commandTokens(command) {
  return [...command.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((match) => match[0]);
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

function manifestForms(manifest) {
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

function matchingForm(command, forms) {
  const tokens = commandTokens(command);
  assert.equal(tokens[0], './aos', `not a direct local AOS command: ${command}`);
  const body = tokens.slice(1);
  const matches = forms
    .filter(({ prefix }) => prefix.length > 0 && prefix.every((token, index) => body[index] === token))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  assert.ok(matches.length > 0, `no AOS command manifest form matches fixture command: ${command}`);
  return matches[0];
}

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
    for (const command of commands) {
      const match = matchingForm(command, forms);
      const tokens = commandTokens(command);
      const flags = tokens.filter((token) => token.startsWith('--'));
      for (const flag of flags) {
        assert.ok(
          match.flags.has(flag),
          `${group}: fixture command uses unsupported flag ${flag} for ${match.form.id}: ${command}`,
        );
      }
      if (match.form.id === 'focus-create') {
        const targetIndex = tokens.indexOf('--target');
        if (targetIndex !== -1) {
          const target = tokens[targetIndex + 1];
          assert.ok(
            ['browser://attach', 'browser://new'].includes(target),
            `${group}: focus create target must be a documented browser target, got ${target}`,
          );
        }
      }
    }
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

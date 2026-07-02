#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  AGENT_WORKSPACE_SCHEMA_VERSION,
  CAPTURE_MODE_VALUES,
  SAVED_REF_BACKENDS,
  SAVED_REF_CONFIDENCE_VALUES,
  SAVED_REF_RESOLUTION_CLASSES,
  SAVED_REF_V0_ACTION_MATRIX,
  SAVED_REF_V0_ACTIONS_BY_BACKEND,
  savedRefBackendSupportsRealMutation,
} from './scripts/lib/agent-workspace/contracts.mjs';

const schema = JSON.parse(fs.readFileSync('shared/schemas/aos-agent-workspace-v0.schema.json', 'utf8'));
const defs = schema.$defs;
assert.equal(defs.schema_version.const, AGENT_WORKSPACE_SCHEMA_VERSION);
assert.deepEqual(defs.capture_mode.enum, CAPTURE_MODE_VALUES);
assert.deepEqual(defs.backend.enum, SAVED_REF_BACKENDS);
assert.deepEqual(defs.resolution_class.enum, SAVED_REF_RESOLUTION_CLASSES);
assert.deepEqual(defs.confidence.enum, SAVED_REF_CONFIDENCE_VALUES);

for (const [backend, actions] of Object.entries(SAVED_REF_V0_ACTIONS_BY_BACKEND)) {
  for (const action of actions) {
    assert.ok(SAVED_REF_V0_ACTION_MATRIX[action]?.supported_backends?.[backend], `${backend} ${action} must be matrix-owned`);
  }
}
assert.ok(SAVED_REF_V0_ACTIONS_BY_BACKEND.aos_canvas.includes('click'));
assert.ok(SAVED_REF_V0_ACTIONS_BY_BACKEND.aos_canvas.includes('set-value'));
assert.ok(SAVED_REF_V0_ACTIONS_BY_BACKEND.native_ax.length === 0);
for (const action of SAVED_REF_V0_ACTIONS_BY_BACKEND.browser) {
  assert.ok(savedRefBackendSupportsRealMutation('browser', action), `browser ${action} must allow real mutation after validation`);
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('success'), `browser ${action} must document success status`);
}

const requiredActions = ['click', 'set-value', 'fill', 'hover', 'scroll', 'drag', 'focus', 'press', 'type', 'key'];
for (const action of requiredActions) {
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action], `missing matrix action ${action}`);
}

for (const [action, contract] of Object.entries(SAVED_REF_V0_ACTION_MATRIX)) {
  assert.equal(typeof contract.dry_run, 'boolean', `${action} dry_run`);
  assert.ok(Array.isArray(contract.required_args), `${action} required_args`);
  assert.ok(Array.isArray(contract.optional_args), `${action} optional_args`);
  assert.ok(Array.isArray(contract.statuses), `${action} statuses`);
  for (const backend of Object.keys(contract.supported_backends)) {
    assert.ok(SAVED_REF_BACKENDS.includes(backend), `${action} unsupported backend ${backend}`);
    for (const resolutionClass of contract.supported_backends[backend]) {
      assert.ok(SAVED_REF_RESOLUTION_CLASSES.includes(resolutionClass), `${action} unsupported resolution ${resolutionClass}`);
    }
  }
}

const schemaDoc = fs.readFileSync('shared/schemas/aos-agent-workspace-v0.md', 'utf8');
const apiDoc = fs.readFileSync('docs/api/aos.md', 'utf8');
const skill = fs.readFileSync('skills/aos-agent-workspace/SKILL.md', 'utf8');
const manifest = fs.readFileSync('manifests/commands/aos-commands.json', 'utf8');

for (const action of requiredActions) {
  assert.ok(schemaDoc.includes(`\`${action}\``) || (action === 'key' && schemaDoc.includes('`type`, `key`')), `schema doc missing ${action}`);
}

for (const text of [schemaDoc, apiDoc, skill]) {
  assert.ok(text.includes('REF_REVALIDATION_REQUIRED'), 'docs/skill must mention REF_REVALIDATION_REQUIRED');
  assert.ok(/page,\s+frame,\s+navigation/.test(text), 'docs/skill must explain browser page/frame/navigation validation');
  assert.ok(text.includes('Dry-run') || text.includes('dry-run'), 'docs/skill must describe browser dry-run validation');
  assert.ok(text.includes('reacquired'), 'docs/skill must describe reacquired dry-run status');
  assert.ok(!/advisory-only|remains dry-run advisory|no real browser|real mutation fails closed/.test(text), 'docs/skill must not describe browser refs as advisory-only');
}

for (const text of [schemaDoc, apiDoc]) {
  assert.ok(text.includes('committed.json'), 'storage docs must mention committed marker');
  assert.ok(text.includes('snapshots/.staging/'), 'storage docs must mention staging directory');
  assert.ok(text.includes('index.json') && /rebuild/.test(text), 'storage docs must describe index rebuild');
}

const browserActionSlashList = SAVED_REF_V0_ACTIONS_BY_BACKEND.browser.join('/');
assert.ok(manifest.includes(`validated browser ${browserActionSlashList} mutation`), 'manifest save summary must advertise validated browser real mutation from matrix actions');
assert.ok(!manifest.includes('remains dry-run advisory'), 'manifest save summary must not describe browser refs as advisory-only');
JS

echo "PASS contract drift"

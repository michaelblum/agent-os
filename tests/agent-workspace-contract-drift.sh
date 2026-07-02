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
} from './scripts/lib/agent-workspace/contracts.mjs';

const schema = JSON.parse(fs.readFileSync('shared/schemas/aos-agent-workspace-v0.schema.json', 'utf8'));
const defs = schema.$defs;
assert.equal(defs.schema_version.const, AGENT_WORKSPACE_SCHEMA_VERSION);
assert.deepEqual(defs.capture_mode.enum, CAPTURE_MODE_VALUES);
assert.deepEqual(defs.backend.enum, SAVED_REF_BACKENDS);
assert.deepEqual(defs.resolution_class.enum, SAVED_REF_RESOLUTION_CLASSES);
assert.deepEqual(defs.confidence.enum, SAVED_REF_CONFIDENCE_VALUES);

assert.deepEqual(SAVED_REF_V0_ACTIONS_BY_BACKEND.aos_canvas, ['click', 'set-value']);
assert.deepEqual(SAVED_REF_V0_ACTIONS_BY_BACKEND.browser, ['click', 'fill', 'hover', 'scroll', 'drag']);
assert.deepEqual(SAVED_REF_V0_ACTIONS_BY_BACKEND.native_ax, []);

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
  assert.ok(/page,\s+frame,\s+and\s+navigation\s+identity/.test(text), 'docs/skill must explain browser identity blocker');
  assert.ok(text.includes('dry-run') && text.includes('advisory'), 'docs/skill must describe browser dry-run advisory validation');
}

for (const text of [schemaDoc, apiDoc]) {
  assert.ok(text.includes('committed.json'), 'storage docs must mention committed marker');
  assert.ok(text.includes('snapshots/.staging/'), 'storage docs must mention staging directory');
  assert.ok(text.includes('index.json') && /rebuild/.test(text), 'storage docs must describe index rebuild');
}

assert.ok(manifest.includes('browser click/fill/hover/scroll/drag remains dry-run advisory'), 'manifest save summary must not advertise browser real mutation');
JS

echo "PASS contract drift"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --input-type=module - <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { AGENT_WORKSPACE_SCHEMA_VERSION } from './scripts/lib/agent-workspace/contracts.mjs'

const text = (file) => fs.readFileSync(file, 'utf8')
const json = (file) => JSON.parse(text(file))

assert.equal(AGENT_WORKSPACE_SCHEMA_VERSION, 'aos.agent-workspace.v1')
assert.equal(json('shared/schemas/aos-agent-workspace-v1.schema.json').$defs.schema_version.const, AGENT_WORKSPACE_SCHEMA_VERSION)
assert.equal(json('shared/schemas/aos-agent-workspace-v0.schema.json').$defs.schema_version.const, 'aos.agent-workspace.v0')

const target = json('shared/schemas/aos-target-handle-v1.schema.json')
assert.deepEqual(target.oneOf.map((entry) => entry.$ref), [
  '#/$defs/browser_observation_ref',
  '#/$defs/canvas_locator',
  '#/$defs/native_ax_locator',
])

for (const file of [
  'scripts/lib/agent-workspace/actions.mjs',
  'scripts/lib/agent-workspace/refs.mjs',
  'scripts/lib/agent-workspace/ref-action-execution.mjs',
  'scripts/lib/agent-workspace/ref-action-resolution.mjs',
  'scripts/lib/pending-annotations-model.mjs',
  'scripts/lib/pending-annotations-projection.mjs',
  'packages/gateway/src/aos-proxy.ts',
  'packages/gateway/src/sdk-socket.ts',
  'packages/gateway/sdk/aos-sdk.js',
  'packages/gateway/sdk/aos-sdk.d.ts',
]) {
  const value = text(file)
  assert.doesNotMatch(value, /\breacquired\b/, file)
  assert.doesNotMatch(value, /\bclickElement\b/, file)
  assert.doesNotMatch(value, /\bresolution_class\b/, file)
}

assert.equal(fs.existsSync('scripts/lib/agent-workspace/browser-ref-validation.mjs'), false)
assert.equal(fs.existsSync('tests/agent-workspace-cross-backend-proof.sh'), false)
assert.equal(fs.existsSync('tests/manual/cross-backend-saved-ref-regression-proof.sh'), false)
assert.equal(fs.existsSync('tests/manual/native-ax-saved-ref-live-proof.sh'), false)
assert.match(text('scripts/lib/agent-workspace/ref-action-args.mjs'), /ref:<snapshot-id>:<ref-id>/)
assert.doesNotMatch(text('scripts/lib/agent-workspace/ref-action-args.mjs'), /parts\.length === 1/)
assert.match(text('scripts/aos-do-native.mjs'), /TARGET_STATE_UNSUPPORTED/)
assert.match(text('scripts/aos-do-canvas.mjs'), /TARGET_STATE_UNSUPPORTED/)
assert.doesNotMatch(text('tests/aos-canvas-ref-click.sh'), /--state-id/)
assert.doesNotMatch(text('scripts/lib/agent-workspace/actions.mjs'), /record\.supported_actions|record\.hint_facts/)
assert.match(text('src/act/targeting.swift'), /TARGET_AMBIGUOUS|ambiguousResult/)
assert.doesNotMatch(text('src/act/targeting.swift'), /Fallback: first match/)
assert.ok(
  text('src/act/canvas-ref-targeting.swift').includes('matches.slice(0, \\(maxCanvasLocatorCandidateFacts)).map'),
  'canvas ambiguity facts use the Swift-owned candidate bound',
)
assert.match(text('src/act/act-cli.swift'), /setValueLocatorRequest\(req\)/)
assert.match(text('src/act/actions.swift'), /func setValueLocatorRequest[\s\S]*window_id: req\.window_id[\s\S]*let searchReq = setValueLocatorRequest\(req\)/)

for (const file of [
  'skills/aos-saved-workspace/SKILL.md',
  'docs/api/aos.md',
  'docs/api/aos-capabilities.md',
  'scripts/lib/agent-workspace/AGENTS.md',
]) {
  const value = text(file)
  assert.match(value, /aos-agent-workspace-v1|Target Handle V1|target handle/i, file)
}

const generated = json('manifests/commands/aos-commands.json')
assert.ok(generated.commands, 'generated command manifest must parse')
console.log('agent workspace V1 contract drift: ok')
NODE

node scripts/generate-command-manifests.mjs --check

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
  NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS,
  NATIVE_AX_LIVE_PROOF_APPROVAL_GATES,
  nativeAxSavedRefBlockedKnownLimitReasons,
  nativeAxSavedRefHasBlockingKnownLimit,
  nativeAxSavedRefMissingIdentityFacts,
  nativeEnabledStatePresent,
  nativeFocusCursorSpaceBaselinePresent,
  nativePermissionStateGranted,
  nativeSavedRefEvidenceActionable,
  SAVED_REF_BACKENDS,
  SAVED_REF_CONFIDENCE_VALUES,
  SAVED_REF_RESOLUTION_CLASSES,
  SAVED_REF_V0_ACTION_MATRIX,
  SAVED_REF_V0_ACTION_MATRIX_ROWS,
  SAVED_REF_V0_ACTIONS_BY_BACKEND,
  savedRefBackendSupportsRealMutation,
} from './scripts/lib/agent-workspace/contracts.mjs';
import { parseCaptureArgs } from './scripts/lib/agent-workspace/capture.mjs';
import { recommendedRefreshCommand } from './scripts/lib/agent-workspace/ref-action-resolution.mjs';
import { workspaceID } from './scripts/lib/agent-workspace/core.mjs';

const schema = JSON.parse(fs.readFileSync('shared/schemas/aos-agent-workspace-v0.schema.json', 'utf8'));
const defs = schema.$defs;
assert.equal(defs.schema_version.const, AGENT_WORKSPACE_SCHEMA_VERSION);
assert.deepEqual(defs.capture_mode.enum, CAPTURE_MODE_VALUES);
assert.deepEqual(defs.backend.enum, SAVED_REF_BACKENDS);
assert.deepEqual(defs.resolution_class.enum, SAVED_REF_RESOLUTION_CLASSES);
assert.deepEqual(defs.confidence.enum, SAVED_REF_CONFIDENCE_VALUES);
assert.ok(SAVED_REF_RESOLUTION_CLASSES.includes('coordinate_fallback'), 'resolution classes must include diagnostic coordinate_fallback');
assert.ok(defs.ref_summary.required.includes('conformance'), 'ref summaries must include conformance');
assert.ok(defs.conformance.required.includes('proof'), 'conformance must include proof story');
assert.ok(defs.conformance.required.includes('no_foreground'), 'conformance must include no_foreground fields');
assert.ok(defs.conformance.required.includes('target_uncertainty'), 'conformance must include target_uncertainty fields');
assert.deepEqual(defs.conformance.properties.proof.required, ['level', 'status', 'evidence', 'approval_gates']);
assert.ok(defs.no_foreground_conformance.required.includes('focus_preservation'), 'no_foreground conformance must report focus preservation');
assert.ok(defs.no_foreground_conformance.required.includes('cursor_preservation'), 'no_foreground conformance must report cursor preservation');
assert.ok(defs.no_foreground_conformance.required.includes('space_preservation'), 'no_foreground conformance must report Space preservation');
const workspaceIndexSnapshotRequired = defs.workspace_index.properties.snapshots.items.required;
assert.ok(workspaceIndexSnapshotRequired.includes('capture_target'), 'workspace index snapshots must expose compact capture target readback');
assert.ok(workspaceIndexSnapshotRequired.includes('query'), 'workspace index snapshots must expose compact saved query readback');
assert.ok(defs.snapshot_record.required.includes('query'), 'snapshot records must persist nullable saved query readback');
assert.ok(defs.capture_source, 'schema must describe durable saved capture source argv');
assert.deepEqual(defs.capture_source.properties.kind.enum, ['default_target', 'target', 'source_flags'], 'schema must not publish a target-plus-source hybrid capture_source kind');
assert.ok(defs.ref_summary.properties.capture_source, 'ref summaries must allow compact capture source readback');
assert.ok(defs.summary.properties.capture_source, 'saved capture summaries must allow compact capture source readback');
assert.ok(defs.snapshot_record.properties.capture_source, 'snapshot records must allow compact capture source readback');
assert.ok(defs.workspace_index.properties.snapshots.items.properties.capture_source, 'workspace index snapshots must allow compact capture source readback');
assert.equal(workspaceID(null, {}), 'default', 'workspace fallback must be command-local default');
assert.equal(workspaceID(undefined, { AOS_AGENT_WORKSPACE: 'env-ws' }), 'env-ws', 'AOS_AGENT_WORKSPACE must supply command-local workspace default');
assert.equal(workspaceID('flag-ws', { AOS_AGENT_WORKSPACE: 'env-ws' }), 'flag-ws', '--workspace must override AOS_AGENT_WORKSPACE');
assert.throws(
  () => workspaceID(null, { AOS_AGENT_WORKSPACE: 'bad/id' }),
  { name: 'AgentWorkspaceError', code: 'INVALID_ID' },
  'AOS_AGENT_WORKSPACE default must stay validated like an explicit workspace id',
);

for (const [backend, actions] of Object.entries(SAVED_REF_V0_ACTIONS_BY_BACKEND)) {
  for (const action of actions) {
    assert.ok(SAVED_REF_V0_ACTION_MATRIX[action]?.supported_backends?.[backend], `${backend} ${action} must be matrix-owned`);
  }
}
assert.ok(SAVED_REF_V0_ACTIONS_BY_BACKEND.aos_canvas.includes('click'));
assert.ok(SAVED_REF_V0_ACTIONS_BY_BACKEND.aos_canvas.includes('set-value'));
assert.deepEqual(
  [...SAVED_REF_V0_ACTIONS_BY_BACKEND.native_ax].sort(),
  ['focus', 'press', 'set-value'],
  'native AX saved refs must expose only durable direct-AX bridge actions',
);
assert.deepEqual(
  NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS,
  [
    'app_pid',
    'window_id',
    'ax_identifier',
    'enabled',
    'action_names',
    'permission_state',
    'focus_cursor_space_baseline',
    'native_saved_ref_evidence',
  ],
  'native AX saved refs must keep a concrete durable-identity and producer-verdict prerequisite list',
);
assert.equal(nativeFocusCursorSpaceBaselinePresent({ captured: true }), true);
assert.equal(nativeFocusCursorSpaceBaselinePresent({ status: 'captured' }), true);
assert.equal(nativeFocusCursorSpaceBaselinePresent({ focus: 'not_changed', cursor: 'not_changed', space: 'not_changed' }), false);
assert.equal(nativeSavedRefEvidenceActionable({
  status: 'actionable',
  actionability: 'direct_ax_saved_ref_mutation',
  known_limit_facts_complete: true,
}), true);
assert.equal(nativeSavedRefEvidenceActionable({
  status: 'inspection_only',
  actionability: 'inspection_only',
  known_limit_facts_complete: false,
}), false);
assert.equal(nativePermissionStateGranted('granted'), true);
assert.equal(nativePermissionStateGranted('denied'), false);
assert.equal(nativeEnabledStatePresent(true), true);
assert.equal(nativeEnabledStatePresent(false), false);
assert.deepEqual(nativeAxSavedRefMissingIdentityFacts({
  app_pid: 4242,
  window_id: 5150,
  ax_identifier: 'install-button',
  enabled: true,
  action_names: ['AXPress'],
  permission_state: 'denied',
  focus_cursor_space_baseline: { captured: true },
  native_saved_ref_evidence: { status: 'actionable', actionability: 'direct_ax_saved_ref_mutation', known_limit_facts_complete: true },
}), ['permission_state']);
assert.deepEqual(nativeAxSavedRefMissingIdentityFacts({
  app_pid: 4242,
  window_id: 5150,
  ax_identifier: 'install-button',
  enabled: false,
  action_names: ['AXPress'],
  permission_state: 'granted',
  focus_cursor_space_baseline: { captured: true },
  native_saved_ref_evidence: { status: 'actionable', actionability: 'direct_ax_saved_ref_mutation', known_limit_facts_complete: true },
}), ['enabled']);
assert.deepEqual(nativeAxSavedRefMissingIdentityFacts({
  app_pid: 4242,
  window_id: 5150,
  stable_path: 'AXWindow[0]/AXButton[2]',
  ax_identifier_or_stable_path: 'AXWindow[0]/AXButton[2]',
  enabled: true,
  action_names: ['AXPress'],
  permission_state: 'granted',
  focus_cursor_space_baseline: { captured: true },
  native_saved_ref_evidence: { status: 'actionable', actionability: 'direct_ax_saved_ref_mutation', known_limit_facts_complete: true },
}), ['ax_identifier'], 'path-only native evidence must not satisfy the v0 direct AX identifier selector requirement');
assert.deepEqual(nativeAxSavedRefMissingIdentityFacts({
  app_pid: 4242,
  window_id: 5150,
  ax_identifier: 'install-button',
  enabled: true,
  action_names: ['AXPress'],
  permission_state: 'granted',
  focus_cursor_space_baseline: { captured: true },
}), ['native_saved_ref_evidence'], 'synthetic native baseline facts alone must not satisfy the producer verdict boundary');
assert.equal(nativeAxSavedRefHasBlockingKnownLimit({
  app_pid: 4242,
  window_id: 5150,
  ax_identifier: 'install-button',
  enabled: true,
  action_names: ['AXPress'],
  permission_state: 'granted',
  focus_cursor_space_baseline: { captured: true },
  native_saved_ref_evidence: { status: 'actionable', actionability: 'direct_ax_saved_ref_mutation', known_limit_facts_complete: true },
}), false, 'ordinary durable native identity should not be known-limit blocked');
assert.deepEqual(nativeAxSavedRefBlockedKnownLimitReasons({
  space_state: 'off_space',
  minimized: true,
  control_kind: 'custom_control',
  surface_kind: 'game_canvas',
  focus_cursor_space_baseline: { captured: true, focus: 'changed' },
}).map((reason) => reason.replace(/\s+/g, ' ')), [
  'native AX target was captured off-Space; saved-ref mutation is blocked until Space preservation is live-proven',
  'native AX target was captured in a minimized window; saved-ref mutation is blocked until minimized-window behavior is live-proven',
  'native AX target is a custom control; saved-ref mutation is blocked until control-specific AX action behavior is proven',
  'native AX target belongs to a canvas/game surface; use AOS canvas semantic targets or fresh perception instead of native label/bounds mutation',
  'native AX focus baseline reports mismatch; saved-ref mutation cannot claim focus preservation',
], 'native known-limit blockers must be explicit and stable');
assert.deepEqual(
  NATIVE_AX_LIVE_PROOF_APPROVAL_GATES,
  [
    'HITL live smoke',
    'TCC/manual runtime flow',
    'native repo-mode artifact rebuild',
    'explicit no-foreground/focus/cursor/Space baseline verification',
  ],
  'native AX live proof must keep explicit approval gates',
);
for (const action of SAVED_REF_V0_ACTIONS_BY_BACKEND.browser) {
  assert.ok(savedRefBackendSupportsRealMutation('browser', action), `browser ${action} must allow real mutation after validation`);
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('success'), `browser ${action} must document success status`);
}

const actionMatrixRows = SAVED_REF_V0_ACTION_MATRIX_ROWS;
const requiredActions = actionMatrixRows.map((row) => row.action);
assert.deepEqual(requiredActions, Object.keys(SAVED_REF_V0_ACTION_MATRIX), 'structured action rows must be generated from the canonical matrix order');
for (const action of requiredActions) {
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action], `missing matrix action ${action}`);
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('REF_NOT_FOUND'), `${action} must document resolver REF_NOT_FOUND`);
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('REF_AMBIGUOUS'), `${action} must document resolver REF_AMBIGUOUS`);
}
for (const action of ['fill', 'hover', 'scroll']) {
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('REF_UNSUPPORTED'), `${action} must document unsupported saved-ref targets`);
}
for (const action of ['click', 'fill', 'hover', 'scroll', 'drag', 'set-value', 'focus', 'press']) {
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('UNKNOWN_ARG'), `${action} must document saved-ref grammar UNKNOWN_ARG`);
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('UNKNOWN_FLAG'), `${action} must document saved-ref grammar UNKNOWN_FLAG`);
}
for (const action of ['set-value', 'scroll']) {
  assert.ok(SAVED_REF_V0_ACTION_MATRIX[action].statuses.includes('INVALID_ARG'), `${action} must document saved-ref grammar INVALID_ARG`);
}

for (const { action, ...contract } of actionMatrixRows) {
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
const externalManifestJSON = JSON.parse(fs.readFileSync('manifests/commands/aos-external-commands.json', 'utf8'));
const nativeDoWrapper = fs.readFileSync('scripts/aos-do-native.mjs', 'utf8');
const manifestJSON = JSON.parse(manifest);
const swiftAXModel = fs.readFileSync('src/perceive/models.swift', 'utf8');
const swiftAXTraversal = fs.readFileSync('src/perceive/ax.swift', 'utf8');

for (const [label, text] of Object.entries({ schemaDoc, apiDoc, skill })) {
  const prose = text.replace(/\s+/g, ' ');
  assert.ok(prose.includes('Workspace selection is command-scoped'), `${label} must describe command-scoped workspace selection`);
  assert.ok(text.includes('AOS_AGENT_WORKSPACE'), `${label} must describe the environment workspace default`);
  assert.ok(prose.includes('`--workspace <id>`') && prose.includes('AOS uses `default`'), `${label} must document flag/env/default precedence`);
  assert.ok(prose.includes('No daemon-held current workspace exists'), `${label} must reject daemon-held current workspace state`);
  assert.ok(prose.includes('`aos see workspace use <id>` is not a current command'), `${label} must reject workspace use command as current contract`);
  assert.ok(/parallel agents|parallel-session/.test(prose), `${label} must tie workspace selection to multi-agent safety`);
  assert.ok(prose.includes('Current wait/diff/assertion boundary'), `${label} must describe saved wait/diff/assertion boundary`);
  for (const unsupported of ['aos see capture --wait-for-change', 'aos see capture --until-stable', 'aos see refs --diff', 'aos see assert']) {
    assert.ok(text.includes(unsupported), `${label} must name unsupported saved workspace command ${unsupported}`);
  }
  assert.ok(text.includes('recommended_next_command'), `${label} must point re-perception to recommended_next_command`);
  assert.ok(text.includes('aos show wait'), `${label} must keep show wait scoped to canvas readiness`);
  assert.ok(prose.includes('Work Record postconditions'), `${label} must route durable evidence checks to Work Record postconditions`);
}

function skillFrontmatter(text) {
  assert.ok(text.startsWith('---\n'), 'skill must start with YAML frontmatter');
  const end = text.indexOf('\n---', 4);
  assert.ok(end > 4, 'skill frontmatter must be closed');
  const entries = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

const aosSkillFrontmatter = skillFrontmatter(skill);
assert.equal(aosSkillFrontmatter.name, 'aos-agent-workspace', 'AOS workspace skill must keep its installable name');
assert.ok(
  /saved AOS perception workspaces/.test(aosSkillFrontmatter.description)
  && /aos see capture --save/.test(aosSkillFrontmatter.description)
  && /aos see snapshots/.test(aosSkillFrontmatter.description)
  && /aos see refs/.test(aosSkillFrontmatter.description)
  && /aos do \.\.\. ref:<snapshot-id>:<ref>/.test(aosSkillFrontmatter.description),
  'AOS workspace skill description must trigger on saved capture/ref loops',
);
assert.ok(skill.split(/\r?\n/).length < 500, 'AOS workspace skill should stay within single-file skill body budget');
const skillReferencePaths = [...skill.matchAll(/^- [^:]+: `([^`]+)`$/gm)].map((match) => match[1]);
assert.deepEqual(
  skillReferencePaths,
  ['docs/api/aos.md', 'shared/schemas/aos-agent-workspace-v0.md', 'tests/agent-workspace-saved-ref.sh'],
  'AOS workspace skill references must stay explicit and minimal',
);
for (const referencePath of skillReferencePaths) {
  assert.ok(fs.existsSync(referencePath), `AOS workspace skill reference does not exist: ${referencePath}`);
}

const fixtureShim = fs.readFileSync('tests/lib/agent-workspace-fixtures.sh', 'utf8');
assert.ok(fixtureShim.split(/\r?\n/).length < 40, 'agent workspace fixture shim must stay source-only and small');
const fixtureDomains = {
  'common.sh': ['agent_workspace_test_setup', 'assert_no_heavy_capture_payloads'],
  'native-file.sh': ['write_failing_capture_aos', 'write_native_file_capture_aos'],
  'browser.sh': ['write_fake_form_aos', 'write_non_click_ref_literal_aos'],
  'native-ax.sh': ['write_fake_native_aos', 'native_saved_ref_evidence'],
  'canvas.sh': ['write_fake_canvas_aos'],
  'mixed.sh': ['write_fake_mixed_support_aos'],
};
for (const [fileName, needles] of Object.entries(fixtureDomains)) {
  const fixturePath = `tests/lib/agent-workspace-fixtures/${fileName}`;
  assert.ok(fs.existsSync(fixturePath), `missing split agent workspace fixture helper ${fixturePath}`);
  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  assert.ok(fixtureText.split(/\r?\n/).length < 700, `${fixturePath} should stay below monolith size`);
  for (const needle of needles) {
    assert.ok(fixtureText.includes(needle), `${fixturePath} missing expected ownership marker ${needle}`);
  }
}

for (const action of requiredActions) {
  assert.ok(schemaDoc.includes(`\`${action}\``) || (action === 'key' && schemaDoc.includes('`type`, `key`')), `schema doc missing ${action}`);
}
function schemaDocActionRow(action) {
  if (action === 'key') {
    return schemaDoc.split(/\r?\n/).find((line) => line.startsWith('| `type`, `key`'));
  }
  return schemaDoc.split(/\r?\n/).find((line) => line.startsWith(`| \`${action}\``));
}

for (const { action, ...contract } of actionMatrixRows) {
  const row = schemaDocActionRow(action);
  assert.ok(row, `schema doc missing action matrix row for ${action}`);
  for (const status of contract.statuses) {
    assert.ok(row.includes(status), `schema doc ${action} row missing status ${status}`);
  }
  if (Object.values(contract.real_mutation).some(Boolean)) {
    assert.ok(row.includes('recommended_next_command'), `schema doc ${action} row missing post-action recommended_next_command`);
  }
}
assert.ok(schemaDoc.includes('current_target_not_found'), 'schema doc must name browser missing-current-target reason');
assert.ok(schemaDoc.includes('current_target_ambiguous'), 'schema doc must name browser ambiguous-current-target reason');

for (const text of [schemaDoc, apiDoc, skill]) {
  const prose = text.replace(/\s+/g, ' ');
  assert.ok(text.includes('REF_REVALIDATION_REQUIRED'), 'docs/skill must mention REF_REVALIDATION_REQUIRED');
  assert.ok(text.includes('REF_NOT_FOUND'), 'docs/skill must mention resolver REF_NOT_FOUND');
  assert.ok(text.includes('UNKNOWN_ARG'), 'docs/skill must mention saved-ref grammar UNKNOWN_ARG');
  assert.ok(text.includes('UNKNOWN_FLAG'), 'docs/skill must mention saved-ref grammar UNKNOWN_FLAG');
  assert.ok(/page,\s+frame,\s+navigation/.test(text), 'docs/skill must explain browser page/frame/navigation validation');
  assert.ok(text.includes('Dry-run') || text.includes('dry-run'), 'docs/skill must describe browser dry-run validation');
  assert.ok(text.includes('reacquired'), 'docs/skill must describe reacquired dry-run status');
  assert.ok(
    prose.includes('dispatch by rerunning the exact saved-ref command without `--dry-run`'),
    'docs/skill must explain how to turn a safe dry-run into real dispatch',
  );
  assert.ok(prose.includes('saved-ref execution envelope'), 'docs/skill must describe real saved-ref execution envelope');
  assert.ok(text.includes('underlying_result'), 'docs/skill must describe nested underlying action result');
  assert.ok(text.includes('recommended_next_command'), 'docs/skill must describe post-action refresh recommendation');
  assert.ok(text.includes('conformance'), 'docs/skill must describe saved-ref conformance fields');
  assert.ok(text.includes('proof'), 'docs/skill must describe saved-ref proof fields');
  assert.ok(text.includes('approval_gated_live_proof_not_run'), 'docs/skill must name approval-gated live proof status');
  assert.ok(text.includes('deterministic_contract_tests_passed'), 'docs/skill must name deterministic proof status');
  assert.ok(text.includes('deterministic_contract_tests'), 'docs/skill must name deterministic proof level');
  assert.ok(text.includes('native_saved_ref_contract_tests_plus_approval_gates'), 'docs/skill must name stable native saved-ref proof level');
  assert.ok(text.includes('native_primitive_response_plus_wrapper_contract'), 'docs/skill must name direct AX wrapper proof level');
  assert.ok(text.includes('known_limit_refusal_tested'), 'docs/skill must name coordinate fallback refusal proof status');
  assert.ok(text.includes('no_foreground'), 'docs/skill must describe native no_foreground conformance fields');
  assert.ok(text.includes('fallback_used'), 'docs/skill must describe native fallback_used conformance');
  assert.ok(text.includes('foreground_fallback_required'), 'docs/skill must describe native foreground_fallback_required conformance');
  assert.ok(
    prose.includes('Stable native saved-ref dispatch preserves `fallback_used` and `foreground_fallback_required`'),
    'docs/skill must explain stable native saved-ref fallback reporting',
  );
  assert.ok(text.includes('target_uncertainty'), 'docs/skill must describe target uncertainty fields');
  assert.ok(text.includes('confidence'), 'docs/skill must describe saved-ref confidence');
  assert.ok(text.includes('confidence: low'), 'docs/skill must describe low-confidence saved refs');
  assert.ok(text.includes('low_confidence_target'), 'docs/skill must name low-confidence refusal reason');
  assert.ok(text.includes('capture_target'), 'docs/skill must describe compact snapshot capture_target readback');
  assert.ok(text.includes('capture_source'), 'docs/skill must describe compact capture_source readback');
  assert.ok(text.includes('query'), 'docs/skill must describe compact saved query readback');
  assert.ok(text.includes('blocked_missing_native_identity'), 'docs/skill must name the native missing-identity blocker');
  assert.ok(text.includes('blocked_unsupported_native_action'), 'docs/skill must name the native unsupported-action blocker');
  assert.ok(text.includes('blocked_native_known_limit'), 'docs/skill must name the native known-limit blocker');
  assert.ok(text.includes('native_action_matrix_unsupported'), 'docs/skill must name unsupported native action validation');
  assert.ok(text.includes('native_known_limit_blocked'), 'docs/skill must name native known-limit validation');
  for (const term of ['off-Space', 'minimized', 'custom control', 'canvas/game', 'focus mismatch']) {
    assert.ok(text.includes(term), `docs/skill missing native known-limit term ${term}`);
  }
  for (const fact of ['space_state', 'off_space', 'window_state', 'minimized', 'control_kind', 'custom_control', 'surface_kind', 'canvas_surface', 'focus_state']) {
    assert.ok(text.includes(fact), `docs/skill missing native known-limit fact ${fact}`);
  }
  assert.ok(text.includes('captured baseline'), 'docs/skill must require a captured native baseline');
  assert.ok(text.includes('native_saved_ref_evidence'), 'docs/skill must require native saved-ref producer evidence');
  assert.ok(text.includes('producer verdict'), 'docs/skill must describe native saved-ref producer verdicts');
  assert.ok(text.includes('stable'), 'docs/skill must describe stable native AX saved refs');
  assert.ok(text.includes('aos do press ref:<snapshot-id>'), 'docs/skill must include stable native press saved-ref example');
  assert.ok(text.includes('aos do focus ref:<snapshot-id>'), 'docs/skill must include stable native focus saved-ref example');
  assert.ok(text.includes('direct_ax_ready'), 'docs/skill must describe native direct AX saved-ref dry-run status');
  assert.ok(text.includes('requires_direct_ax_current_matching'), 'docs/skill must describe native saved-ref current matching status');
  assert.ok(text.includes('app_hint'), 'docs/skill must describe native app hint evidence');
  assert.ok(text.includes('window_hint'), 'docs/skill must describe native window hint evidence');
  assert.ok(text.includes('enabled'), 'docs/skill must describe captured native enabled evidence');
  assert.ok(text.includes('inspection'), 'docs/skill must keep captured native hints inspection-scoped');
  assert.ok(text.includes('direct_ax_current_matching'), 'docs/skill must describe direct AX current matching uncertainty');
  assert.ok(text.includes('direct_ax_current_matching_semantics'), 'docs/skill must describe direct AX matching validation semantics');
  for (const fact of NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS) {
    assert.ok(text.includes(fact), `docs/skill missing native required fact ${fact}`);
  }
  assert.ok(text.includes('coordinate_fallback'), 'docs/skill must document diagnostic coordinate_fallback');
  assert.ok(/diagnostic\/fallback-only|diagnostic\/fallback only/.test(text), 'docs/skill must mark coordinate_fallback as diagnostic/fallback-only');
  assert.ok(/does not complete native|not completion of the full native/.test(prose), 'docs/skill must keep native saved-ref completion as continuation-only');
  assert.ok(!/does not complete native saved-ref mutation|no native saved-ref mutation is attempted|non-browser native AX refs are inspection-first in this slice/.test(prose), 'docs/skill must not deny stable native saved-ref mutation support');
  assert.ok(!/advisory-only|remains dry-run advisory|no real browser|real mutation fails closed/.test(text), 'docs/skill must not describe browser refs as advisory-only');
}

assert.ok(
  apiDoc.replace(/\s+/g, ' ').includes('browser, AOS canvas, and native saved-ref tests'),
  'API doc must name backend-wide coordinate fallback refusal evidence',
);

for (const field of ['app_pid', 'app_name', 'window_id', 'identifier', 'enabled', 'action_names', 'permission_state', 'focus_cursor_space_baseline', 'native_saved_ref_evidence', 'window_state', 'space_state', 'control_kind', 'surface_kind', 'focus_state', 'minimized', 'off_space', 'custom_control', 'canvas_surface']) {
  assert.ok(swiftAXModel.includes(field), `native AX element JSON model must expose ${field}`);
}
for (const needle of ['nativeAXSavedActionNames', 'nativeAXSavedRefEvidence', 'native_saved_ref_evidence: nativeAXSavedRefEvidence()', 'AXUIElementCopyActionNames', 'AXSetValue', 'AXFocus', 'axWindowID', 'AXIsProcessTrusted() ? "granted" : "unknown"', 'contextPath: ["app:\\(appName)"]']) {
  assert.ok(swiftAXTraversal.includes(needle), `native AX traversal must preserve ${needle}`);
}

assert.ok(
  apiDoc.indexOf('aos see capture browser:work --save') >= 0
  && apiDoc.indexOf('aos see capture main --base64') > apiDoc.indexOf('aos see capture browser:work --save'),
  'API doc must lead with saved capture before base64/pixel fallback examples',
);
assert.ok(
  apiDoc.includes('Saved capture uses the same capture-source contract as ordinary capture')
  && apiDoc.includes('defaults to `main`')
  && apiDoc.includes('source forms are')
  && apiDoc.includes('`--region <rect>`, `--canvas <id>`, or `--channel <id>`')
  && skill.includes('A saved capture source can be a positional target')
  && skill.includes('capture defaults to')
  && skill.includes('source forms are mutually exclusive')
  && schemaDoc.includes('or the default `main` target when no')
  && schemaDoc.includes('Positional target and source-flag forms')
  && schemaDoc.includes('exclusive')
  && skill.includes('`--region <rect>`, `--canvas <id>`, or `--channel <id>`'),
  'API doc, schema doc, and workspace skill must describe saved capture source alternatives and default main behavior',
);
assert.ok(
  skill.indexOf('aos do click ref:<snapshot-id>:r2 --workspace default --dry-run') >= 0
  && skill.indexOf('aos do click ref:<snapshot-id>:r2 --workspace default\n') > skill.indexOf('aos do click ref:<snapshot-id>:r2 --workspace default --dry-run')
  && skill.indexOf('aos see capture <capture_source> --save --mode <capture_mode> --workspace default') > skill.indexOf('aos do click ref:<snapshot-id>:r2 --workspace default\n'),
  'AOS workspace skill quick-start must show dry-run, real action, and post-action saved capture refresh',
);
assert.ok(
  skill.indexOf('aos see capture --canvas surface-inspector --save --mode som --workspace default') > skill.indexOf('aos see capture <capture_source> --save --mode <capture_mode> --workspace default'),
  'AOS workspace skill quick-start must include a saved source-flag capture example',
);

for (const text of [schemaDoc, apiDoc]) {
  assert.ok(text.includes('committed.json'), 'storage docs must mention committed marker');
  assert.ok(text.includes('snapshots/.staging/'), 'storage docs must mention staging directory');
  assert.ok(text.includes('index.json') && /rebuild/.test(text), 'storage docs must describe index rebuild');
}

const browserActionSlashList = SAVED_REF_V0_ACTIONS_BY_BACKEND.browser.join('/');
assert.ok(manifest.includes(`validated browser ${browserActionSlashList} mutation`), 'manifest save summary must advertise validated browser real mutation from matrix actions');
const nativeActionSlashList = ['press', 'focus', 'set-value'].join('/');
assert.ok(manifest.includes(`stable native AX ${nativeActionSlashList}`), 'manifest save summary must advertise stable native AX saved-ref actions');
assert.ok(!manifest.includes('remains dry-run advisory'), 'manifest save summary must not describe browser refs as advisory-only');

const doCommand = manifestJSON.commands.find((command) => JSON.stringify(command.path) === JSON.stringify(['do']));
assert.ok(doCommand, 'manifest missing do command');
const doDragForm = doCommand.forms.find((form) => form.id === 'do-drag');
const doCanvasDragForm = doCommand.forms.find((form) => form.id === 'do-drag-canvas');
const doNativeDragForm = doCommand.forms.find((form) => form.id === 'do-drag-native');
assert.ok(doDragForm, 'manifest missing saved-ref/browser do-drag form');
assert.ok(doCanvasDragForm, 'manifest missing direct canvas do-drag form');
assert.ok(doNativeDragForm, 'manifest missing native coordinate do-drag form');
assert.ok(apiDoc.includes('| `click` | click coordinates, saved refs, direct browser targets, or AOS canvas semantic refs |'), 'API do table must name saved refs and direct browser targets for click');
assert.ok(apiDoc.includes('| `hover` | saved/browser hover or coordinate hover |'), 'API do table must name saved/browser and coordinate hover tiers');
assert.ok(apiDoc.includes('| `drag` | saved/browser two-endpoint drag, direct canvas semantic drag (`--by` / `--to-value`), or native coordinate drag |'), 'API do table must split drag grammar tiers');
assert.ok(!apiDoc.includes('| `drag` | drag between coordinates, browser refs, or AOS canvas semantic refs |'), 'API do table must not collapse drag grammar tiers');
assert.ok(apiDoc.includes('| `scroll` | saved/browser scroll with `dx,dy`, or coordinate scroll with `--dx` / `--dy` |'), 'API do table must split saved/browser and coordinate scroll tiers');
assert.ok(apiDoc.includes('| `type` | literal native text input or direct browser target text; no saved-ref action |'), 'API do table must keep type out of saved-ref actions while naming the direct browser route');
assert.ok(apiDoc.includes('| `key` | literal native key combo or direct browser target key press; no saved-ref action |'), 'API do table must keep key out of saved-ref actions while naming the direct browser route');
assert.ok(apiDoc.includes('| `press` | saved native AX press or direct `--pid` / `--role` AX press |'), 'API do table must split saved native AX and direct AX press');
assert.ok(apiDoc.includes('| `set-value` | saved refs, direct AX, or AOS canvas semantic set-value |'), 'API do table must name saved refs, direct AX, and canvas set-value');
assert.ok(apiDoc.includes('| `focus` | saved native AX focus or direct `--pid` / `--role` AX focus |'), 'API do table must split saved native AX and direct AX focus');
assert.ok(!doDragForm.usage.includes('--speed'), 'saved-ref drag usage must not advertise native-only --speed');
assert.ok(!doDragForm.args.some((arg) => arg.token === '--speed'), 'saved-ref drag args must not advertise native-only --speed');
assert.ok(!doDragForm.usage.includes('--by'), 'saved-ref drag usage must not advertise direct-canvas --by');
assert.ok(!doDragForm.usage.includes('--to-value'), 'saved-ref drag usage must not advertise direct-canvas --to-value');
assert.ok(doCanvasDragForm.usage.includes('canvas:<canvas-id>/<ref>'), 'direct canvas drag usage must advertise canvas target dialect');
assert.ok(doCanvasDragForm.usage.includes('--by'), 'direct canvas drag usage must advertise --by');
assert.ok(doCanvasDragForm.usage.includes('--to-value'), 'direct canvas drag usage must advertise --to-value');
assert.ok(!doCanvasDragForm.usage.includes('ref:<snapshot-id>'), 'direct canvas drag usage must not advertise saved refs');
assert.ok(!doCanvasDragForm.usage.includes('--speed'), 'direct canvas drag usage must not advertise native-only --speed');
assert.ok(doNativeDragForm.usage.includes('--speed'), 'native coordinate drag usage must advertise --speed');
assert.ok(doNativeDragForm.args.some((arg) => arg.token === '--speed'), 'native coordinate drag args must keep --speed');
assert.ok(!doNativeDragForm.usage.includes('ref:<snapshot-id>'), 'native coordinate drag usage must not advertise saved refs');
assert.ok(!doNativeDragForm.usage.includes('canvas:<canvas-id>'), 'native coordinate drag usage must not advertise canvas targets');
const canvasDragRoute = externalManifestJSON.commands.find((command) => command.argv_prefix?.join(' ') === 'node scripts/aos-do-canvas-drag.mjs');
assert.equal(canvasDragRoute?.when?.prefix, 'canvas:', 'direct canvas drag must route through a dedicated canvas parser');
const nativeDragRoute = externalManifestJSON.commands.find((command) => command.argv_prefix?.join(' ') === 'node scripts/aos-do-native.mjs drag');
assert.deepEqual(nativeDragRoute?.when?.excluded_prefixes, ['browser:', 'ref:', 'canvas:'], 'native drag route must not catch canvas targets');
assert.ok(!nativeDoWrapper.includes("'--by'"), 'native wrapper must not globally own direct-canvas --by');
assert.ok(!nativeDoWrapper.includes("'--to-value'"), 'native wrapper must not globally own direct-canvas --to-value');
assert.ok(!nativeDoWrapper.includes("'--playback'"), 'native wrapper must not globally own direct-canvas --playback');

const seeCommand = manifestJSON.commands.find((command) => JSON.stringify(command.path) === JSON.stringify(['see']));
assert.ok(seeCommand, 'manifest missing see command');
const workspaceUseForms = manifestJSON.commands.flatMap((command) => (command.forms ?? []).filter((form) => (
  form.id === 'see-workspace-use'
  || /\bworkspace use\b/.test(form.usage ?? '')
)));
assert.deepEqual(workspaceUseForms, [], 'manifest must not advertise a daemon-held workspace use command');
const unsupportedSavedWorkspaceSeeForms = seeCommand.forms.filter((form) => (
  /see-(refs-)?diff|see-assert|wait-for-change|until-stable/.test(form.id)
  || /--wait-for-change|--until-stable|\bsee refs\b.*--diff|\bsee assert\b/.test(form.usage ?? '')
  || (form.args ?? []).some((arg) => ['--wait-for-change', '--until-stable', '--diff'].includes(arg.token))
));
assert.deepEqual(
  unsupportedSavedWorkspaceSeeForms.map((form) => form.id),
  [],
  'manifest must not advertise saved workspace wait/diff/assert commands before parser and schema support',
);
const captureForm = seeCommand.forms.find((form) => form.id === 'see-capture');
const captureSaveForm = seeCommand.forms.find((form) => form.id === 'see-capture-save');
assert.ok(captureForm, 'manifest missing see-capture form');
assert.ok(captureSaveForm, 'manifest missing see-capture-save form');
assert.equal(captureForm.execution.mutates_state, false, 'ordinary capture form must not broadly mutate');
assert.deepEqual(captureForm.execution.mutates_when_flags, ['--save']);
assert.equal(captureForm.execution.read_only, true, 'ordinary capture form must remain read-style');
assert.equal(captureForm.output.default_mode, 'json', 'ordinary capture form must declare JSON output');
assert.equal(captureForm.output.conditional_modes, undefined, 'ordinary capture form must not describe --save as a different output mode');
assert.equal(captureSaveForm.execution.mutates_state, true, 'saved capture form must be mutating');
assert.equal(captureSaveForm.execution.read_only, false, 'saved capture form must not be read-only');
assert.deepEqual(captureForm.constraints?.required_groups, undefined, 'ordinary capture form must not require a source because the parser defaults to main');
assert.deepEqual(captureSaveForm.constraints?.required_groups, undefined, 'saved capture form must not require a source because the parser defaults to main');
assert.equal(captureForm.args.find((arg) => arg.id === 'target')?.required, false, 'ordinary capture target must not be unconditionally required');
assert.equal(captureSaveForm.args.find((arg) => arg.id === 'target')?.required, false, 'saved capture target must not be unconditionally required');
assert.equal(captureForm.args.find((arg) => arg.id === 'target')?.default_value, 'main', 'ordinary capture target must document the parser default');
assert.equal(captureSaveForm.args.find((arg) => arg.id === 'target')?.default_value, 'main', 'saved capture target must document the parser default');
assert.equal(parseCaptureArgs([]).target, 'main', 'capture parser must keep no-source default aligned with help metadata');
assert.equal(parseCaptureArgs(['--save']).target, 'main', 'saved capture parser must keep no-source default aligned with help metadata');
assert.deepEqual(parseCaptureArgs([]).capture_source, {
  kind: 'default_target',
  argv: ['main'],
  display: 'main',
}, 'capture parser must expose reconstructable default source argv');
const parsedCanvasSave = parseCaptureArgs(['--canvas', 'surface-inspector', '--save', '--mode', 'som', '--workspace', 'default']);
assert.equal(parsedCanvasSave.target, 'main', 'source-flag capture keeps legacy target fallback for compatibility');
assert.deepEqual(parsedCanvasSave.capture_source, {
  kind: 'source_flags',
  argv: ['--canvas', 'surface-inspector'],
  display: '--canvas surface-inspector',
}, 'source-flag capture must persist reconstructable source argv');
const parsedHybridSource = parseCaptureArgs(['main', '--canvas', 'surface-inspector']);
assert.equal(parsedHybridSource.errors[0]?.code, 'INVALID_ARG', 'capture parser must reject target plus source-flag hybrids');
assert.match(parsedHybridSource.errors[0]?.error ?? '', /exactly one source/, 'capture parser must explain source alternatives');
assert.equal(parsedHybridSource.capture_source, null, 'invalid target/source hybrids must not synthesize durable capture_source');
const parsedMultipleSources = parseCaptureArgs(['--region', '0,0,10,10', '--canvas', 'surface-inspector']);
assert.equal(parsedMultipleSources.errors[0]?.code, 'INVALID_ARG', 'capture parser must reject multiple source-flag forms');
assert.match(parsedMultipleSources.errors[0]?.error ?? '', /exactly one source/, 'capture parser must explain source-flag exclusivity');
assert.equal(parsedMultipleSources.capture_source, null, 'invalid multiple-source forms must not synthesize combined capture_source');
assert.equal(
  recommendedRefreshCommand('default', {
    capture_target: 'main',
    capture_source: parsedCanvasSave.capture_source,
    capture_mode: 'som',
  }),
  'aos see capture --canvas surface-inspector --save --workspace default --mode som',
  'refresh recommendations must reconstruct source-flag captures from capture_source.argv',
);
assert.equal(
  recommendedRefreshCommand('default', {
    capture_target: 'browser:todo',
    capture_mode: 'ax',
    query: 'Save button',
  }),
  "aos see capture browser:todo --save --workspace default --mode ax --query 'Save button'",
  'legacy records without capture_source must still fall back to capture_target',
);
assert.ok(captureSaveForm.usage.includes('--region <rect>'), 'saved capture usage must advertise region source');
assert.ok(captureSaveForm.usage.includes('--canvas <id>'), 'saved capture usage must advertise canvas source');
assert.ok(captureSaveForm.usage.includes('--channel <id>'), 'saved capture usage must advertise channel source');
JS

echo "PASS contract drift"

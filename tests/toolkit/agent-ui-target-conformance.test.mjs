import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  actionList,
  compactObject,
  extensionSource,
  normalizeSemanticTarget,
  normalizeSemanticTargets,
} from '../../packages/toolkit/runtime/semantic-targets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = resolve(__dirname, '../../docs/design/fixtures/agent-ui-target-conformance-v0')

const PRODUCER_IDENTITY_DRIFT_KEYS = [
  'id',
  'aosRef',
  'ref',
  'aos_ref',
  'data_aos_ref',
  'target_id',
  'subject_id',
  'semantic_target_id',
  'do_target',
]

const NON_CANONICAL_IDENTITY_KEYS = PRODUCER_IDENTITY_DRIFT_KEYS.filter((key) => key !== 'ref')

const PRODUCER_FORBIDDEN_PROJECTION_KEYS = [
  'current_render_status',
  'display_space_rect',
  'refreshed_at',
  'blocker_reason',
  'blocker_reasons',
]

const TOP_LEVEL_SNAKE_CASE = /^[a-z][a-z0-9_]*$/

async function readJson(name) {
  return JSON.parse(await readFile(resolve(fixtureDir, name), 'utf8'))
}

function currentRecordsByShape(sourceFixture) {
  return new Map(sourceFixture.records.map((entry) => [entry.shape, entry.record]))
}

function canonicalRecordsByShape(candidateFixture) {
  return new Map(candidateFixture.records.map((entry) => [entry.shape, entry.agent_ui_target]))
}

function mapCurrentRecordToCandidate(shape, record) {
  if (record?.state && record?.extension && record?.provenance && record.ref) {
    return compactObject(record)
  }

  const ref = record.ref || record.aosRef || record.data_aos_ref || record.aos_ref
  assert.ok(ref, `${shape} must have a mappable current identity`)

  const common = {
    ref,
    surface: record.surface || (ref.includes(':') ? ref.split(':')[0] : ''),
    role: record.role || 'document_region',
    name: record.name || record.accessible_label || record.label || record.target_id || record.id,
    kind: record.kind || 'semantic_target',
    enabled: record.enabled ?? true,
    state: {
      value: record.value ?? null,
      current: record.current ?? null,
      pressed: record.pressed ?? null,
      selected: record.selected ?? null,
      checked: record.checked ?? null,
      expanded: record.expanded ?? null,
    },
    actions: actionList(record),
    extension: {
      source: extensionSource(record),
    },
    provenance: {
      source_payload_id: record.id || record.target_id || record.ref || ref,
      legacy_identity_keys: PRODUCER_IDENTITY_DRIFT_KEYS.filter((key) => Object.hasOwn(record, key)),
    },
  }

  if (record.metadata !== undefined) common.provenance.metadata = compactObject(record.metadata)
  if (record.frame !== undefined) common.provenance.frame = compactObject(record.frame)
  if (record.parent_canvas_id !== undefined) common.provenance.parent_canvas_id = record.parent_canvas_id
  if (record.parentCanvasId !== undefined) common.provenance.parent_canvas_id = record.parentCanvasId
  if (record.selector) common.provenance.selector = record.selector

  if (shape === 'html_workbench_source_line_target') {
    return {
      ...common,
      surface: 'html-workbench-expression',
      role: 'document_region',
      actions: [],
      extension: {
        annotation_eligible: record.annotation_eligible,
        reveal_eligible: record.reveal_eligible,
        source: extensionSource(record),
      },
    }
  }

  if (record.descriptor_id !== undefined) common.extension.descriptor_id = record.descriptor_id
  if (record.field_id !== undefined) common.extension.field_id = record.field_id
  if (record.options !== undefined) common.extension.options = compactObject(record.options)
  if (record.hidden !== undefined) common.extension.hidden = record.hidden
  if (record.tab !== undefined) common.extension.tab = compactObject(record.tab)
  if (record.section !== undefined) common.extension.section = compactObject(record.section)
  if (record.label !== undefined) common.extension.label = record.label

  return common
}

function walkKeys(value, visit) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, visit))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, value)
    walkKeys(child, visit)
  }
}

function assertCanonicalProducerGates(target) {
  const topLevelKeys = Object.keys(target)
  assert.equal(topLevelKeys.filter((key) => key === 'ref').length, 1)
  assert.equal(topLevelKeys.filter((key) => NON_CANONICAL_IDENTITY_KEYS.includes(key)).length, 0)
  for (const key of topLevelKeys) {
    assert.match(key, TOP_LEVEL_SNAKE_CASE, `canonical producer key must be snake_case: ${key}`)
    assert.ok(!PRODUCER_FORBIDDEN_PROJECTION_KEYS.includes(key), `projection key leaked into producer: ${key}`)
  }

  walkKeys(target, (key) => {
    assert.ok(!PRODUCER_FORBIDDEN_PROJECTION_KEYS.includes(key), `projection key leaked into producer tree: ${key}`)
  })

  if (target.surface === 'html-workbench-expression') {
    assert.equal(Object.hasOwn(target.extension || {}, 'dom_id'), false, `${target.ref} must not duplicate DOM id under extension`)
    assert.equal(Object.hasOwn(target.provenance || {}, 'dom_id'), true, `${target.ref} must keep the single DOM reveal hint under provenance`)
    assert.equal(Object.hasOwn(target.provenance || {}, 'source_payload_id'), false, `${target.ref} must not duplicate source_payload_id`)
    for (const key of ['source_path', 'source_line_start', 'source_line_end']) {
      assert.equal(Object.hasOwn(target.provenance || {}, key), false, `${target.ref} must keep source data only under extension.source`)
    }
    const nestedDomSlots = [
      target.extension?.dom_id,
      target.provenance?.dom_id,
      target.provenance?.source_payload_id,
    ].filter((value) => value === target.provenance?.dom_id)
    assert.ok(nestedDomSlots.length <= 1, `${target.ref} duplicated DOM slug across nested fields`)
    assert.ok(target.extension?.source?.path, `${target.ref} must include extension.source.path`)
    assert.ok(target.extension?.source?.line_start, `${target.ref} must include extension.source.line_start`)
    assert.ok(target.extension?.source?.line_end, `${target.ref} must include extension.source.line_end`)
  }
}

test('current producer fixtures map losslessly to candidate agent_ui_target records', async () => {
  const sourceFixture = await readJson('current-source-records.json')
  const candidateFixture = await readJson('candidate-agent-ui-targets.json')
  const sources = currentRecordsByShape(sourceFixture)
  const candidates = canonicalRecordsByShape(candidateFixture)

  assert.deepEqual([...sources.keys()].sort(), [
    'html_workbench_source_line_target',
    'native_perceive_canvas_semantic_target',
    'sigil_compact_surface_control',
    'sigil_compact_surface_tab',
    'toolkit_panel_form_control',
    'toolkit_runtime_semantic_target',
  ])
  assert.deepEqual([...candidates.keys()].sort(), [...sources.keys()].sort())

  for (const [shape, record] of sources) {
    const mapped = mapCurrentRecordToCandidate(shape, record)
    const canonical = candidates.get(shape)
    assertCanonicalProducerGates(canonical)
    assert.deepEqual(canonical, mapped, `${shape} mapping drifted`)
  }
})

test('projection fixtures stay separate and key cardinality by adapter_id plus ref', async () => {
  const projectionFixture = await readJson('candidate-agent-ui-target-projections.json')
  const producerFixture = await readJson('candidate-agent-ui-targets.json')
  const producerRefs = new Set(producerFixture.records.map((entry) => entry.agent_ui_target.ref))
  const projections = projectionFixture.records

  assert.ok(projections.length >= 3)

  const pairKeys = new Set()
  const refsByAdapter = new Map()
  for (const projection of projections) {
    assert.ok(producerRefs.has(projection.ref), `projection must join to producer ref: ${projection.ref}`)
    assert.ok(projection.adapter_id)
    const pairKey = `${projection.adapter_id}\u0000${projection.ref}`
    assert.ok(!pairKeys.has(pairKey), `duplicate projection pair: ${projection.adapter_id}/${projection.ref}`)
    pairKeys.add(pairKey)

    const adapters = refsByAdapter.get(projection.ref) || new Set()
    adapters.add(projection.adapter_id)
    refsByAdapter.set(projection.ref, adapters)
  }

  assert.ok(
    [...refsByAdapter.values()].some((adapters) => adapters.size >= 2),
    'at least one canonical ref must have multiple adapter projections',
  )
})

test('blocked projection fixtures preserve explicit blockers instead of selector fallback identity', async () => {
  const projectionFixture = await readJson('candidate-agent-ui-target-projections.json')
  const blocked = projectionFixture.records.find((record) => record.current_render_status === 'unsupported')

  assert.ok(blocked)
  assert.deepEqual(blocked.blocker_reasons, ['semantic_target_no_structured_bounds_or_reveal_handler'])
  assert.equal(blocked.ref, 'html-workbench-expression:decision-17')
  assert.notEqual(blocked.ref, blocked.source_tree_node_metadata.selector)
})

test('projection fixtures do not preserve legacy producer identity spellings', async () => {
  const projectionFixture = await readJson('candidate-agent-ui-target-projections.json')
  for (const projection of projectionFixture.records) {
    walkKeys(projection.source_tree_node_metadata || {}, (key) => {
      assert.ok(!['target_id', 'semantic_target_id', 'data_aos_ref', 'aos_ref'].includes(key), `legacy producer key remained in projection fixture: ${key}`)
    })
  }
})

test('current semantic target core still requires ids and does not invent action defaults', () => {
  assert.throws(
    () => normalizeSemanticTargets([{ label: '' }]),
    /semantic target requires id/,
  )

  const target = normalizeSemanticTarget({ id: 'plain-target', name: 'Plain Target' })
  assert.equal(target.action, '')
  assert.equal(target.ref, 'plain-target')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  normalizeSemanticTarget,
  refForTarget,
} from '../../packages/toolkit/runtime/semantic-targets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = resolve(__dirname, '../../docs/design/fixtures/aos-target-descriptor-v0')

async function readJson(name) {
  return JSON.parse(await readFile(resolve(fixtureDir, name), 'utf8'))
}

function namespaceKey(namespace = {}) {
  return JSON.stringify({
    app_id: namespace.app_id,
    canvas_id: namespace.canvas_id,
    surface_id: namespace.surface_id,
    component_family: namespace.component_family,
    structural_owner: namespace.structural_owner,
  })
}

function durableIdentityKey(descriptor = {}) {
  return `${namespaceKey(descriptor.target?.owner_namespace)}\u0000${descriptor.target?.target_id}`
}

function walk(value, visit, path = []) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, [...path, String(index)]))
    return
  }
  visit(value, path)
  for (const [key, child] of Object.entries(value)) {
    walk(child, visit, [...path, key])
  }
}

function assertDescriptorShape(descriptor) {
  assert.ok(descriptor.ref, 'descriptor requires state-scoped ref')
  assert.ok(descriptor.state_id, `${descriptor.ref} requires state_id`)
  assert.ok(descriptor.target?.target_id, `${descriptor.ref} requires target.target_id`)
  assert.ok(descriptor.target?.owner_namespace?.app_id, `${descriptor.ref} requires owner namespace app_id`)
  assert.ok(descriptor.target?.owner_namespace?.canvas_id, `${descriptor.ref} requires owner namespace canvas_id`)
  assert.ok(Array.isArray(descriptor.actions), `${descriptor.ref} requires actions`)
  assert.ok(descriptor.state && typeof descriptor.state === 'object', `${descriptor.ref} requires state object`)
  assert.ok(descriptor.provenance?.canvas_id, `${descriptor.ref} requires provenance canvas_id`)
  assert.ok(descriptor.reacquisition?.machine_fingerprint, `${descriptor.ref} requires machine reacquisition fingerprint`)
  assert.ok(descriptor.reacquisition?.hint_fingerprint, `${descriptor.ref} requires hint reacquisition fingerprint`)
}

function assertNoLabelIdentity(descriptor) {
  const identityText = JSON.stringify({
    target_id: descriptor.target?.target_id,
    owner_namespace: descriptor.target?.owner_namespace,
  })
  const label = descriptor.name || descriptor.label
  assert.ok(label, `${descriptor.ref} needs a label for this fixture`)
  assert.notEqual(identityText, label)
  assert.ok(!identityText.includes(`"${label}"`), `${descriptor.ref} must not embed display label in durable identity`)
}

test('fixture manifest lists the descriptor contract cases', async () => {
  const manifest = await readJson('manifest.json')

  assert.deepEqual(manifest.fixtures.sort(), [
    'ambiguous-reacquisition.json',
    'reacquisition-success.json',
    'same-label-namespaces.json',
    'stale-ref.json',
  ])
})

test('same-label controls stay distinct through owner namespace plus target id', async () => {
  const fixture = await readJson('same-label-namespaces.json')
  const targets = fixture.semantic_targets

  assert.equal(targets.length, 2)
  targets.forEach(assertDescriptorShape)
  targets.forEach(assertNoLabelIdentity)
  assert.equal(targets[0].name, targets[1].name)
  assert.equal(targets[0].target.target_id, targets[1].target.target_id)
  assert.notEqual(namespaceKey(targets[0].target.owner_namespace), namespaceKey(targets[1].target.owner_namespace))
  assert.notEqual(durableIdentityKey(targets[0]), durableIdentityKey(targets[1]))
  assert.equal(fixture.expectation.status, 'distinct_targets')
})

test('stale state-scoped refs reject instead of silently acting', async () => {
  const fixture = await readJson('stale-ref.json')

  assert.equal(fixture.resolution.status, 'stale_ref')
  assert.equal(fixture.resolution.action_blocked, true)
  assert.equal(fixture.resolution.supplied_state_id, fixture.action.state_id)
  assert.notEqual(fixture.resolution.supplied_state_id, fixture.resolution.current_state_id)
  assert.equal(fixture.resolution.reacquisition.available, true)
  assert.equal(fixture.resolution.reacquisition.requires_explicit_retry, true)
})

test('descriptor reacquisition uses machine facts first and labels only as hints', async () => {
  const fixture = await readJson('reacquisition-success.json')
  const selected = fixture.candidates.find((candidate) => candidate.ref === fixture.resolution.selected_ref)

  assert.equal(fixture.resolution.status, 'reacquired')
  assert.ok(selected)
  assert.equal(durableIdentityKey(selected), durableIdentityKey(fixture.previous))
  assert.deepEqual(fixture.resolution.matched_by, [
    'owner_namespace',
    'target_id',
    'role',
    'structural_path',
    'capabilities',
    'range_shape',
  ])
  assert.equal(fixture.resolution.labels_used_as_hints_only, true)
  assert.ok(fixture.previous.reacquisition.hint_fingerprint.label_hints.includes(selected.name))
})

test('ambiguous same-label reacquisition remains blocked', async () => {
  const fixture = await readJson('ambiguous-reacquisition.json')

  assert.equal(fixture.resolution.status, 'ambiguous')
  assert.equal(fixture.resolution.action_blocked, true)
  assert.equal(fixture.resolution.selected_ref, null)
  assert.equal(fixture.resolution.candidate_refs.length, 2)
  assert.deepEqual(
    fixture.candidates.map((candidate) => candidate.name),
    ['Open', 'Open'],
  )
  assert.equal(fixture.resolution.labels_used_as_hints_only, true)
})

test('runtime helpers reject label/name-only machine identity', () => {
  assert.throws(
    () => normalizeSemanticTarget({ name: 'Opacity', label: 'Opacity' }),
    /semantic target requires id/,
  )
  assert.throws(
    () => refForTarget({ name: 'Opacity', surface: 'settings' }),
    /semantic target ref requires id or explicit ref/,
  )
})

test('fixture identity fields do not depend on provenance geometry', async () => {
  const fixture = await readJson('same-label-namespaces.json')

  for (const target of fixture.semantic_targets) {
    const identityText = JSON.stringify(target.target)
    walk(target.provenance, (node, path) => {
      if (path.includes('bounds') || path.includes('frame') || path.includes('center')) {
        assert.equal(identityText.includes(JSON.stringify(node)), false, `${target.ref} copied geometry into identity`)
      }
    })
  }
})

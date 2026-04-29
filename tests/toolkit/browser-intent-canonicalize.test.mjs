import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildLocatorCandidates,
  canonicalizeBrowserAnnotation,
  canonicalizeBrowserMark,
  selectLocatorCandidate,
} from '../../packages/toolkit/browser-intent-sensor/canonicalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

test('canonicalizeBrowserMark emits browser element marks with locator candidates', async () => {
  const mark = await canonicalizeBrowserMark({
    session_id: 'steerable-demo',
    browser_session: 'demo',
    event_id: 'evt_mark_001',
    mark_id: 'mark_001',
    kind: 'element',
    url: 'https://example.test/careers',
    title: 'Careers',
    descriptor: {
      ref: 'e17',
      role: 'link',
      name: 'Benefits',
      text: 'Benefits',
      selector: 'a[href*="benefits"]',
      rect: { x: 120, y: 340, width: 180, height: 44 },
    },
    screenshot_path: 'artifacts/screenshots/mark_001.png',
    crop_path: 'artifacts/crops/mark_001.png',
    at: '2026-04-28T12:00:04Z',
  })

  assert.equal(mark.type, 'human.mark')
  assert.equal(mark.target.target_id, 'browser:demo/e17')
  assert.equal(mark.anchors.replay.selected_locator, 'role_name')
  assert.deepEqual(
    mark.anchors.replay.locator_candidates.map((candidate) => candidate.id),
    ['role_name', 'text', 'css', 'ref', 'rect'],
  )
  assert.ok(mark.anchors.replay.locator_candidates.every((candidate) => candidate.validated_at_mark_time))
  await assertValidHumanMark(mark)
})

test('canonicalizeBrowserMark falls back to the first validated locator candidate', async () => {
  const candidates = await buildLocatorCandidates(
    {
      role: 'link',
      name: 'Benefits',
      text: 'Benefits',
      selector: '#benefits-link',
    },
    {
      validateCandidate(candidate) {
        return candidate.id === 'css'
      },
    },
  )

  assert.equal(selectLocatorCandidate(candidates), 'css')
})

test('canonicalizeBrowserMark emits region marks with contained elements', async () => {
  const mark = await canonicalizeBrowserMark({
    session_id: 'steerable-demo',
    browser_session: 'demo',
    event_id: 'evt_mark_002',
    mark_id: 'mark_002',
    kind: 'region',
    url: 'https://example.test/careers',
    rect: { x: 80, y: 420, width: 420, height: 220 },
    contained_elements: [
      {
        descriptor_id: 'e21',
        role: 'heading',
        name: 'Employee voice',
        selector: '#employee-voice',
        text: 'Employee voice',
      },
    ],
    at: '2026-04-28T12:00:05Z',
  })

  assert.equal(mark.kind, 'region')
  assert.equal(mark.anchors.replay.selected_locator, 'rect')
  assert.equal(mark.anchors.semantic.contained_elements[0].descriptor_id, 'e21')
  await assertValidHumanMark(mark)
})

test('canonicalizeBrowserAnnotation attaches comments to prior marks', () => {
  const annotation = canonicalizeBrowserAnnotation({
    session_id: 'steerable-demo',
    event_id: 'evt_anno_001',
    annotation_id: 'anno_001',
    mark_id: 'mark_001',
    note: 'This claim needs proof.',
    at: '2026-04-28T12:00:06Z',
  })

  assert.deepEqual(annotation, {
    type: 'human.annotation',
    event_id: 'evt_anno_001',
    session_id: 'steerable-demo',
    annotation_id: 'anno_001',
    mark_id: 'mark_001',
    note: 'This claim needs proof.',
    at: '2026-04-28T12:00:06Z',
  })
})

async function assertValidHumanMark(mark) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-human-mark-'))
  const fixturePath = path.join(tmp, 'mark.json')
  await fs.writeFile(fixturePath, JSON.stringify(mark))
  try {
    const result = spawnSync(
      'python3',
      [
        '-c',
        `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
        path.join(repoRoot, 'shared/schemas/human-mark.schema.json'),
        fixturePath,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

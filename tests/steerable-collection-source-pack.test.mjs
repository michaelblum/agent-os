import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createSourcePack,
  runDeterministicDemo,
  sanitizeSessionId,
  sourcePackPath,
} from '../src/sessions/steerable-collection/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const sampleRoot = path.join(repoRoot, 'docs/superpowers/artifacts/v0-demo/source-pack')

test('source pack writer uses mode-scoped paths and sanitizes session ids', () => {
  assert.equal(sanitizeSessionId('browser:demo/e17'), 'browser-demo-e17')
  assert.equal(
    sourcePackPath({
      stateRoot: '/tmp/aos-state',
      runtimeMode: 'repo',
      sessionId: 'browser:demo/e17',
    }),
    '/tmp/aos-state/repo/source-packs/browser-demo-e17',
  )
})

test('source pack writer emits JSONL streams and manifest', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-source-pack-'))
  try {
    const writer = await createSourcePack({
      sessionId: 'unit-demo',
      rootDir: path.join(tmp, 'pack'),
      runtimeMode: 'test',
      goal: 'Unit test source pack.',
      clock: () => '2026-04-28T12:00:00Z',
    })

    await writer.appendTimeline({
      type: 'human.intent',
      event_id: 'evt_intent_001',
      session_id: 'unit-demo',
      text: 'Collect proof.',
      at: '2026-04-28T12:00:00Z',
    })
    await writer.writeObservationArtifact('obs_001', { ok: true })
    const manifest = await writer.finalize('completed')

    assert.equal(manifest.final_state, 'completed')
    assert.equal(manifest.counts.timeline_events, 1)
    assert.equal(manifest.counts.observations, 1)
    assert.match(await fs.readFile(path.join(tmp, 'pack/collection-session.jsonl'), 'utf8'), /human.intent/)
    await validateJsonFile('shared/schemas/source-pack.schema.json', path.join(tmp, 'pack/source-pack.json'))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('deterministic demo matches checked-in sample source pack', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-demo-pack-'))
  try {
    const generatedRoot = path.join(tmp, 'source-pack')
    await runDeterministicDemo({ rootDir: generatedRoot })
    const generated = await readFiles(generatedRoot)
    const sample = await readFiles(sampleRoot)
    assert.deepEqual(generated, sample)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('checked-in sample source pack validates core JSON streams', async () => {
  await validateJsonFile('shared/schemas/source-pack.schema.json', path.join(sampleRoot, 'source-pack.json'))
  await validateJsonLines('shared/schemas/human-mark.schema.json', path.join(sampleRoot, 'marks/human-marks.jsonl'))
  await validateJsonLines('shared/schemas/evidence-item.schema.json', path.join(sampleRoot, 'evidence/evidence-items.jsonl'))

  const timeline = await readJsonLines(path.join(sampleRoot, 'collection-session.jsonl'))
  assert.ok(timeline.some((event) => event.type === 'agent.observation'))
  assert.ok(timeline.some((event) => event.type === 'agent.mark.acknowledged'))
  assert.ok(timeline.some((event) => event.type === 'run.control' && event.command === 'step'))
})

async function readFiles(root) {
  const out = {}
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        out[path.relative(root, full)] = await fs.readFile(full, 'utf8')
      }
    }
  }
  await walk(root)
  return out
}

async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function validateJsonLines(schemaPath, filePath) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-jsonl-'))
  try {
    const lines = await readJsonLines(filePath)
    assert.ok(lines.length >= 1, `${path.relative(repoRoot, filePath)} should not be empty`)
    for (let index = 0; index < lines.length; index += 1) {
      const one = path.join(tmp, `${index}.json`)
      await fs.writeFile(one, JSON.stringify(lines[index]))
      await validateJsonFile(schemaPath, one)
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function validateJsonFile(schemaPath, filePath) {
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
      path.join(repoRoot, schemaPath),
      filePath,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `${path.relative(repoRoot, filePath)} should validate\n${result.stdout}${result.stderr}`)
}

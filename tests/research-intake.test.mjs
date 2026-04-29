import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ingestMeetingTranscript,
  parseTranscriptText,
  parseWebVtt,
  researchIntakePath,
  sanitizeIntakeId,
} from '../src/sessions/research-intake/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const sampleVtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Michael: We need the HITL test console to reuse source-pack evidence.

00:00:05.000 --> 00:00:08.000
Agent: Decision is to keep raw transcript as artifact and write wiki nodes.
`

test('research intake paths are mode-scoped and sanitized', () => {
  assert.equal(sanitizeIntakeId('meeting:2026/04/29'), 'meeting-2026-04-29')
  assert.equal(
    researchIntakePath({
      stateRoot: '/tmp/aos-state',
      runtimeMode: 'repo',
      intakeId: 'meeting:2026/04/29',
    }),
    '/tmp/aos-state/repo/research-intake/meeting-2026-04-29',
  )
})

test('VTT parser extracts timed transcript segments', () => {
  const segments = parseWebVtt(sampleVtt)
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0], {
    segment_id: 'seg_0001',
    start: '00:00:01.000',
    end: '00:00:04.000',
    text: 'Michael: We need the HITL test console to reuse source-pack evidence.',
  })
})

test('plain transcript parser keeps paragraph segments when no VTT timings exist', () => {
  const segments = parseTranscriptText('Michael: First point.\n\nAgent: Second point.')
  assert.deepEqual(segments, [
    {
      segment_id: 'seg_0001',
      start: null,
      end: null,
      text: 'Michael: First point.',
    },
    {
      segment_id: 'seg_0002',
      start: null,
      end: null,
      text: 'Agent: Second point.',
    },
  ])
})

test('meeting transcript intake writes raw artifacts, extracted segments, and wiki candidates', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-research-intake-'))
  try {
    const result = await ingestMeetingTranscript({
      intakeId: 'meeting:hitl-source-pack',
      rootDir: path.join(tmp, 'pack'),
      runtimeMode: 'test',
      title: 'HITL Source Pack Meeting',
      sourceUri: 'file:///tmp/hitl.vtt',
      transcriptText: sampleVtt,
      artifactName: 'hitl.vtt',
      createdAt: '2026-04-29T16:00:00Z',
      clock: fixedClock([
        '2026-04-29T16:00:00Z',
        '2026-04-29T16:00:01Z',
        '2026-04-29T16:00:02Z',
      ]),
    })

    assert.equal(result.manifest.final_state, 'completed')
    assert.equal(result.manifest.counts.transcript_segments, 2)
    assert.equal(result.manifest.counts.source_cards, 1)
    assert.equal(result.manifest.counts.wiki_pages, 1)
    assert.equal(result.wikiPages[0].path, 'personal/meetings/meeting-hitl-source-pack.md')
    assert.match(result.wikiPages[0].markdown, /Raw artifact: `artifacts\/raw\/hitl.vtt`/)

    const raw = await fs.readFile(path.join(tmp, 'pack/artifacts/raw/hitl.vtt'), 'utf8')
    assert.match(raw, /WEBVTT/)
    const extracted = JSON.parse(await fs.readFile(path.join(tmp, 'pack/artifacts/extracted/transcript-segments.json'), 'utf8'))
    assert.equal(extracted.segments.length, 2)

    await validateJsonFile('shared/schemas/research-intake-pack.schema.json', path.join(tmp, 'pack/research-intake.json'))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('meeting transcript intake script writes a pack from a file', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-research-intake-script-'))
  try {
    const transcriptPath = path.join(tmp, 'planning.vtt')
    await fs.writeFile(transcriptPath, sampleVtt)
    const result = spawnSync(
      'node',
      [
        'scripts/research-intake-meeting.mjs',
        '--file',
        transcriptPath,
        '--title',
        'Planning Meeting',
        '--id',
        'planning-meeting',
        '--json',
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AOS_RUNTIME_MODE: 'test',
          AOS_STATE_ROOT: tmp,
        },
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    const output = JSON.parse(result.stdout)
    assert.equal(output.ok, true)
    assert.equal(output.intake_id, 'planning-meeting')
    assert.equal(output.transcript_segments, 2)
    assert.equal(output.wiki_candidates[0], 'personal/meetings/planning-meeting.md')
    assert.equal(output.root_dir, path.join(tmp, 'test/research-intake/planning-meeting'))
    await validateJsonFile('shared/schemas/research-intake-pack.schema.json', output.manifest)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('research intake schema accepts valid fixture and rejects invalid fixture', async () => {
  await validateJsonFile(
    'shared/schemas/research-intake-pack.schema.json',
    path.join(repoRoot, 'shared/schemas/fixtures/research-intake-pack/valid/minimal.json'),
  )
  const invalid = validateJsonFileResult(
    'shared/schemas/research-intake-pack.schema.json',
    path.join(repoRoot, 'shared/schemas/fixtures/research-intake-pack/invalid/missing-source.json'),
  )
  assert.notEqual(invalid.status, 0)
})

function fixedClock(values) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

async function validateJsonFile(schemaPath, filePath) {
  const result = validateJsonFileResult(schemaPath, filePath)
  assert.equal(result.status, 0, `${path.relative(repoRoot, filePath)} should validate\n${result.stdout}${result.stderr}`)
}

function validateJsonFileResult(schemaPath, filePath) {
  return spawnSync(
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
}

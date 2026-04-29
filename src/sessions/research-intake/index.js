import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const RESEARCH_INTAKE_FORMAT_VERSION = '0.1.0'

export function runtimeMode(env = process.env) {
  const mode = (env.AOS_RUNTIME_MODE || 'repo').toLowerCase()
  return mode === 'installed' ? 'installed' : mode === 'test' ? 'test' : 'repo'
}

export function stateRoot(env = process.env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'))
}

export function stateDir(options = {}) {
  return path.join(options.stateRoot ?? stateRoot(options.env), options.runtimeMode ?? runtimeMode(options.env))
}

export function sanitizeIntakeId(intakeId) {
  return String(intakeId || 'intake')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'intake'
}

export function researchIntakePath(options = {}) {
  const intakeId = sanitizeIntakeId(options.intakeId)
  return options.rootDir ?? path.join(stateDir(options), 'research-intake', intakeId)
}

const RELATIVE_PATHS = Object.freeze({
  timeline: 'intake-timeline.jsonl',
  source_cards: 'sources/source-cards.jsonl',
  evidence_items: 'evidence/evidence-items.jsonl',
  wiki_pages: 'wiki/wiki-pages.jsonl',
  summary: 'summary.md',
})

const ARTIFACT_DIRS = Object.freeze({
  raw: 'artifacts/raw',
  extracted: 'artifacts/extracted',
})

export class ResearchIntakeWriter {
  constructor(options = {}) {
    if (!options.intakeId) throw new Error('ResearchIntakeWriter requires intakeId')
    this.intakeId = sanitizeIntakeId(options.intakeId)
    this.rootDir = researchIntakePath({ ...options, intakeId: this.intakeId })
    this.runtimeMode = options.runtimeMode ?? runtimeMode(options.env)
    this.title = options.title ?? ''
    this.source = options.source ?? { type: 'manual' }
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.createdAt = options.createdAt ?? this.clock()
    this.counts = {
      timeline_events: 0,
      source_cards: 0,
      evidence_items: 0,
      wiki_pages: 0,
      transcript_segments: 0,
      decisions: 0,
      action_items: 0,
      topics: 0,
    }
  }

  pathFor(relativePath) {
    return path.join(this.rootDir, relativePath)
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true })
    await Promise.all([
      ...Object.values(ARTIFACT_DIRS).map((dir) => fs.mkdir(this.pathFor(dir), { recursive: true })),
      fs.mkdir(this.pathFor('sources'), { recursive: true }),
      fs.mkdir(this.pathFor('evidence'), { recursive: true }),
      fs.mkdir(this.pathFor('wiki'), { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(this.pathFor(RELATIVE_PATHS.timeline), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.source_cards), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.evidence_items), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.wiki_pages), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.summary), summaryStub(this.title, this.intakeId)),
    ])
    await this.writeManifest({ final_state: 'running' })
    return this
  }

  async appendTimeline(event) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.timeline), event)
    this.counts.timeline_events += 1
    return event
  }

  async appendSourceCard(sourceCard) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.source_cards), sourceCard)
    this.counts.source_cards += 1
    return sourceCard
  }

  async appendEvidenceItem(item) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.evidence_items), item)
    this.counts.evidence_items += 1
    return item
  }

  async appendWikiPage(page) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.wiki_pages), page)
    this.counts.wiki_pages += 1
    return page
  }

  async writeRawArtifact(name, body) {
    return this.writeTextArtifact(path.join(ARTIFACT_DIRS.raw, sanitizeArtifactName(name)), body)
  }

  async writeExtractedJson(name, value) {
    const relativePath = path.join(ARTIFACT_DIRS.extracted, sanitizeArtifactName(name))
    await writeJson(this.pathFor(relativePath), value)
    return relativePath
  }

  async writeTextArtifact(relativePath, body) {
    const fullPath = this.pathFor(relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, body)
    return relativePath
  }

  async writeSummary(markdown) {
    await fs.writeFile(this.pathFor(RELATIVE_PATHS.summary), markdown)
    return RELATIVE_PATHS.summary
  }

  async finalize(finalState = 'completed') {
    return this.writeManifest({
      final_state: finalState,
      completed_at: this.clock(),
    })
  }

  async writeManifest(patch = {}) {
    const manifest = {
      research_intake_format_version: RESEARCH_INTAKE_FORMAT_VERSION,
      intake_id: this.intakeId,
      runtime_mode: this.runtimeMode,
      created_at: this.createdAt,
      final_state: patch.final_state ?? 'running',
      ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
      ...(this.title ? { title: this.title } : {}),
      source: this.source,
      paths: RELATIVE_PATHS,
      artifact_directories: ARTIFACT_DIRS,
      counts: this.counts,
    }
    await writeJson(this.pathFor('research-intake.json'), manifest)
    return manifest
  }
}

export async function createResearchIntake(options = {}) {
  const writer = new ResearchIntakeWriter(options)
  return writer.init()
}

export function parseWebVtt(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const segments = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length || lines[0] === 'WEBVTT') continue
    const timeIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeIndex === -1) continue
    const [startRaw, endRaw] = lines[timeIndex].split('-->').map((part) => part.trim().split(/\s+/)[0])
    const body = lines.slice(timeIndex + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!body) continue
    segments.push({
      segment_id: `seg_${String(segments.length + 1).padStart(4, '0')}`,
      start: startRaw,
      end: endRaw,
      text: body,
    })
  }
  return segments
}

export function meetingWikiPage({ intakeId, title, artifactPath, segmentsPath, sourceUri, createdAt }) {
  const safeTitle = title || 'Meeting Intake'
  const description = `Processed meeting knowledge from research intake ${intakeId}.`
  const sourceLines = [
    `- Intake ID: \`${intakeId}\``,
    `- Raw artifact: \`${artifactPath}\``,
    `- Transcript segments: \`${segmentsPath}\``,
    ...(sourceUri ? [`- Source URI: ${sourceUri}`] : []),
  ].join('\n')
  const markdown = `---\ntype: concept\nname: ${escapeFrontmatterValue(safeTitle)}\ndescription: ${escapeFrontmatterValue(description)}\ntags: [meeting, personal, research-intake]\n---\n\n# ${safeTitle}\n\n## Summary\n\nDraft summary pending human or agent synthesis.\n\n## Decisions\n\n- None extracted yet.\n\n## Action Items\n\n- None extracted yet.\n\n## Topics\n\n- None extracted yet.\n\n## Source References\n\n${sourceLines}\n\n## Related\n\n`
  return {
    path: `personal/meetings/${sanitizeIntakeId(intakeId)}.md`,
    title: safeTitle,
    type: 'concept',
    status: 'draft',
    source_intake_id: intakeId,
    created_at: createdAt,
    markdown,
  }
}

export async function ingestMeetingTranscript(options = {}) {
  if (!options.intakeId) throw new Error('ingestMeetingTranscript requires intakeId')
  if (!options.transcriptText) throw new Error('ingestMeetingTranscript requires transcriptText')

  const sourceTitle = options.title ?? 'Meeting Transcript'
  const sourceType = options.sourceType ?? 'meeting-transcript'
  const sourceUri = options.sourceUri ?? ''
  const writer = await createResearchIntake({
    ...options,
    title: sourceTitle,
    source: {
      type: sourceType,
      ...(sourceUri ? { uri: sourceUri } : {}),
      title: sourceTitle,
    },
  })

  await writer.appendTimeline({
    type: 'research.intake.started',
    event_id: 'evt_intake_started',
    intake_id: writer.intakeId,
    at: writer.createdAt,
    source_type: sourceType,
  })

  const artifactName = options.artifactName ?? 'meeting.vtt'
  const rawArtifactPath = await writer.writeRawArtifact(artifactName, options.transcriptText)
  const segments = parseWebVtt(options.transcriptText)
  writer.counts.transcript_segments = segments.length
  const segmentsPath = await writer.writeExtractedJson('transcript-segments.json', { segments })

  await writer.appendSourceCard({
    source_id: 'src_001',
    intake_id: writer.intakeId,
    type: sourceType,
    title: sourceTitle,
    ...(sourceUri ? { uri: sourceUri } : {}),
    raw_artifacts: [rawArtifactPath],
    extracted_artifacts: [segmentsPath],
    captured_at: writer.createdAt,
  })

  const page = meetingWikiPage({
    intakeId: writer.intakeId,
    title: sourceTitle,
    artifactPath: rawArtifactPath,
    segmentsPath,
    sourceUri,
    createdAt: writer.createdAt,
  })
  await writer.appendWikiPage(page)
  await writer.writeSummary(`# Research Intake Summary\n\nIntake: ${writer.intakeId}\n\nTitle: ${sourceTitle}\n\nRaw artifact: \`${rawArtifactPath}\`\n\nTranscript segments: ${segments.length}\n\nWiki candidate: \`${page.path}\`\n`)

  await writer.appendTimeline({
    type: 'research.intake.completed',
    event_id: 'evt_intake_completed',
    intake_id: writer.intakeId,
    at: writer.clock(),
    source_cards: 1,
    wiki_pages: 1,
    transcript_segments: segments.length,
  })

  const manifest = await writer.finalize('completed')
  return {
    rootDir: writer.rootDir,
    manifest,
    segments,
    wikiPages: [page],
  }
}

function sanitizeArtifactName(name) {
  const cleaned = String(name || 'artifact')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'artifact'
}

async function appendJsonLine(filePath, value) {
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`)
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function summaryStub(title, intakeId) {
  return `# Research Intake Summary\n\nIntake: ${intakeId}\n\nTitle: ${title || 'Not provided'}\n\nThis V0 summary is a placeholder. The raw artifacts and extracted records are canonical.\n`
}

function escapeFrontmatterValue(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1)
}

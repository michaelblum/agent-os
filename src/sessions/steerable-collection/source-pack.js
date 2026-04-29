import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const SOURCE_PACK_FORMAT_VERSION = '0.1.0'

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

export function sanitizeSessionId(sessionId) {
  return String(sessionId || 'session')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'session'
}

export function sourcePackPath(options = {}) {
  const sessionId = sanitizeSessionId(options.sessionId)
  return options.rootDir ?? path.join(stateDir(options), 'source-packs', sessionId)
}

const RELATIVE_PATHS = Object.freeze({
  timeline: 'collection-session.jsonl',
  human_marks: 'marks/human-marks.jsonl',
  evidence_items: 'evidence/evidence-items.jsonl',
  narrative: 'narrative.md',
  playwright_replay: 'playwright-replay.spec.ts',
})

const ARTIFACT_DIRS = Object.freeze({
  screenshots: 'artifacts/screenshots',
  page_text: 'artifacts/page-text',
  selected_regions: 'artifacts/selected-regions',
  crops: 'artifacts/crops',
  observations: 'artifacts/observations',
})

export class SourcePackWriter {
  constructor(options = {}) {
    if (!options.sessionId) throw new Error('SourcePackWriter requires sessionId')
    this.sessionId = options.sessionId
    this.rootDir = sourcePackPath(options)
    this.runtimeMode = options.runtimeMode ?? runtimeMode(options.env)
    this.goal = options.goal ?? ''
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.createdAt = options.createdAt ?? this.clock()
    this.counts = {
      timeline_events: 0,
      human_marks: 0,
      evidence_items: 0,
      observations: 0,
    }
  }

  pathFor(relativePath) {
    return path.join(this.rootDir, relativePath)
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true })
    await Promise.all([
      ...Object.values(ARTIFACT_DIRS).map((dir) => fs.mkdir(this.pathFor(dir), { recursive: true })),
      fs.mkdir(this.pathFor('marks'), { recursive: true }),
      fs.mkdir(this.pathFor('evidence'), { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(this.pathFor(RELATIVE_PATHS.timeline), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.human_marks), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.evidence_items), ''),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.narrative), narrativeStub(this.goal, this.sessionId)),
      fs.writeFile(this.pathFor(RELATIVE_PATHS.playwright_replay), replayStub()),
    ])
    await this.writeManifest({ final_state: 'running' })
    return this
  }

  async appendTimeline(event) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.timeline), event)
    this.counts.timeline_events += 1
    if (event?.type === 'human.mark') await this.appendHumanMark(event)
    return event
  }

  async appendHumanMark(mark) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.human_marks), mark)
    this.counts.human_marks += 1
    return mark
  }

  async appendEvidenceItem(item) {
    await appendJsonLine(this.pathFor(RELATIVE_PATHS.evidence_items), item)
    this.counts.evidence_items += 1
    return item
  }

  async writeObservationArtifact(observationId, observation) {
    const relativePath = path.join(ARTIFACT_DIRS.observations, `${observationId}.json`)
    await writeJson(this.pathFor(relativePath), observation)
    this.counts.observations += 1
    return relativePath
  }

  async writeTextArtifact(relativePath, body) {
    const fullPath = this.pathFor(relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, body)
    return relativePath
  }

  async finalize(finalState = 'completed') {
    return this.writeManifest({
      final_state: finalState,
      completed_at: this.clock(),
    })
  }

  async writeManifest(patch = {}) {
    const manifest = {
      source_pack_format_version: SOURCE_PACK_FORMAT_VERSION,
      session_id: this.sessionId,
      runtime_mode: this.runtimeMode,
      created_at: this.createdAt,
      final_state: patch.final_state ?? 'running',
      ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
      ...(this.goal ? { goal: this.goal } : {}),
      paths: RELATIVE_PATHS,
      artifact_directories: ARTIFACT_DIRS,
      counts: this.counts,
    }
    await writeJson(this.pathFor('source-pack.json'), manifest)
    return manifest
  }
}

export async function createSourcePack(options = {}) {
  const writer = new SourcePackWriter(options)
  return writer.init()
}

async function appendJsonLine(filePath, value) {
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`)
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function narrativeStub(goal, sessionId) {
  return `# Steerable Collection Narrative\n\nSession: ${sessionId}\n\nGoal: ${goal || 'Not provided'}\n\nThis V0 narrative is a stub generated from the canonical timeline. Full narrative synthesis is deferred to a downstream workflow.\n`
}

function replayStub() {
  return `// Playwright replay codegen is deferred for Steerable Collection V0.\n// This file is intentionally a stub; use the canonical timeline and locator candidates as source material for the replay-codegen follow-up.\n`
}

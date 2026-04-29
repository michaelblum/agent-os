#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ingestMeetingTranscript,
  sanitizeIntakeId,
} from '../src/sessions/research-intake/index.js'

const USAGE = `Usage:
  node scripts/research-intake-meeting.mjs --file <transcript.vtt|txt> [options]

Options:
  --title <title>        Human-readable meeting title.
  --id <intake-id>      Stable intake id. Defaults to <date>-<file-name>.
  --source-uri <uri>    Source URI. Defaults to file:// URI for --file.
  --root-dir <path>     Override output pack directory.
  --json                Emit machine-readable output.
  --help, -h            Show this help.
`

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(USAGE)
    return
  }
  if (!options.file) {
    throw new UsageError('missing required --file <transcript.vtt|txt>')
  }

  const transcriptPath = path.resolve(options.file)
  const transcriptText = await fs.readFile(transcriptPath, 'utf8')
  const artifactName = path.basename(transcriptPath)
  const title = options.title ?? defaultTitle(artifactName)
  const intakeId = sanitizeIntakeId(options.intakeId ?? defaultIntakeId(title, artifactName))
  const sourceUri = options.sourceUri ?? pathToFileURL(transcriptPath).href

  const result = await ingestMeetingTranscript({
    intakeId,
    ...(options.rootDir ? { rootDir: path.resolve(options.rootDir) } : {}),
    title,
    sourceUri,
    transcriptText,
    artifactName,
  })
  const sourceCards = await readJsonLines(path.join(result.rootDir, result.manifest.paths.source_cards))

  const output = {
    ok: true,
    intake_id: result.manifest.intake_id,
    root_dir: result.rootDir,
    summary: path.join(result.rootDir, result.manifest.paths.summary),
    manifest: path.join(result.rootDir, 'research-intake.json'),
    raw_artifacts: sourceCards.flatMap((card) => card.raw_artifacts ?? []).map((artifact) => path.join(result.rootDir, artifact)),
    transcript_segments: result.segments.length,
    wiki_candidates: result.wikiPages.map((page) => page.path),
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }

  process.stdout.write([
    'Research intake created',
    `intake_id: ${output.intake_id}`,
    `root_dir: ${output.root_dir}`,
    `segments: ${output.transcript_segments}`,
    `wiki_candidate: ${output.wiki_candidates.join(', ') || 'none'}`,
    `summary: ${output.summary}`,
    '',
  ].join('\n'))
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const equalIndex = arg.startsWith('--') ? arg.indexOf('=') : -1
    const flag = equalIndex === -1 ? arg : arg.slice(0, equalIndex)
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1)
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue
      index += 1
      const next = args[index]
      if (!next || next.startsWith('--')) {
        throw new UsageError(`${flag} requires a value`)
      }
      return next
    }

    switch (flag) {
      case '--file':
        options.file = readValue()
        break
      case '--title':
        options.title = readValue()
        break
      case '--id':
        options.intakeId = readValue()
        break
      case '--source-uri':
        options.sourceUri = readValue()
        break
      case '--root-dir':
        options.rootDir = readValue()
        break
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new UsageError(`unknown argument: ${arg}`)
    }
  }
  return options
}

function defaultTitle(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    || 'Meeting Transcript'
}

function defaultIntakeId(title, fileName) {
  const date = new Date().toISOString().slice(0, 10)
  return `${date}-${title || fileName || 'meeting'}`
}

async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, 'utf8')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

class UsageError extends Error {}

main().catch((error) => {
  const message = error instanceof UsageError ? `${error.message}\n\n${USAGE}` : error.stack || String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})

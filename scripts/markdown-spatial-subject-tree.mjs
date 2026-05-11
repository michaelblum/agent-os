#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadMarkdownSpatialSubjectTree,
  validateMarkdownSpatialSubjectTree,
} from '../packages/toolkit/workbench/markdown-spatial-subject-tree.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const DEFAULT_INPUT = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md'
const DEFAULT_OUTPUT = 'docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json'
const DEFAULT_CREATED_AT = '2026-05-09T12:00:00.000Z'

function argValue(name, fallback = null) {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const input = argValue('input', DEFAULT_INPUT)
const output = argValue('output', DEFAULT_OUTPUT)
const createdAt = argValue('created-at', DEFAULT_CREATED_AT)
const stdout = process.argv.includes('--stdout')
const inputPath = path.resolve(repoRoot, input)
const outputPath = path.resolve(repoRoot, output)

const tree = loadMarkdownSpatialSubjectTree({
  filePath: inputPath,
  sourcePath: input,
  createdAt,
})

validateMarkdownSpatialSubjectTree(tree)

const json = `${JSON.stringify(tree, null, 2)}\n`
if (stdout) {
  process.stdout.write(json)
} else {
  writeFileSync(outputPath, json)
  process.stdout.write(`${output}\n`)
}

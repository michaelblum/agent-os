import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  assertSpatialSubjectTreeShape,
  normalizeSpatialSubjectTree,
} from './spatial-subject-tree.js'

export const MARKDOWN_SPATIAL_TREE_ADAPTER_ID = 'markdown-spatial-subject-tree'
export const MARKDOWN_DOCUMENT_COORDINATE_SPACE = 'markdown_line_document_v0'

const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z'
const DEFAULT_SOURCE_PATH = 'document.md'
const DEFAULT_GEOMETRY = {
  line_height: 20,
  char_width: 8,
  margin_x: 32,
  margin_y: 24,
  document_width: 960,
  min_target_height: 24,
}

const REQUIRED_DECISION_TARGETS = [
  {
    id: 'current-assumptions-0-accepted-live-captures',
    label: 'Current assumptions / 0 accepted live captures',
    role: 'decision_target',
    start_line: 5,
    end_line: 14,
    match: /accepted live captures remain at 0/,
  },
  {
    id: 'company-and-competitor-set',
    label: 'Company and competitor set',
    role: 'decision_target',
    start_line: 41,
    end_line: 49,
    match: /^## Companies And Competitor Set$/,
  },
  {
    id: 'desired-evidence-elements-4-visibility-adjusted-slots',
    label: 'Desired evidence elements and 4 visibility-adjusted executable slots',
    role: 'decision_target',
    start_line: 57,
    end_line: 73,
    match: /4 executable slots and 0 accepted captures/,
  },
  {
    id: 'what-not-to-collect',
    label: 'What not to collect',
    role: 'decision_target',
    start_line: 75,
    end_line: 77,
    match: /^## What Not To Collect$/,
  },
  {
    id: 'kilos-interpretation-table',
    label: 'KILOS interpretation table',
    role: 'decision_target',
    start_line: 79,
    end_line: 87,
    match: /^## KILOS Interpretation$/,
  },
  {
    id: 'linkedin-source-unavailable-policy',
    label: 'LinkedIn/source-unavailable policy',
    role: 'decision_target',
    start_line: 89,
    end_line: 93,
    match: /inaccessible LinkedIn context/,
  },
  {
    id: 'report-tone-and-direction',
    label: 'Report tone and direction',
    role: 'decision_target',
    start_line: 99,
    end_line: 103,
    match: /^## Report Tone And Direction$/,
  },
  {
    id: 'explicit-human-decision-table',
    label: 'Explicit human decision table',
    role: 'decision_target',
    start_line: 105,
    end_line: 115,
    match: /^## Explicit Human Decision Points$/,
  },
]

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function slugify(value, fallback = 'item') {
  const slug = text(value)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function lineId(line) {
  return String(line).padStart(3, '0')
}

function excerpt(lines, startLine, endLine) {
  return lines
    .slice(startLine - 1, endLine)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function lineBounds(startLine, endLine, geometry = DEFAULT_GEOMETRY) {
  const lineCount = Math.max(1, endLine - startLine + 1)
  return {
    x: geometry.margin_x,
    y: geometry.margin_y + ((startLine - 1) * geometry.line_height),
    width: geometry.document_width - (geometry.margin_x * 2),
    height: Math.max(geometry.min_target_height, lineCount * geometry.line_height),
  }
}

function sourceFor({ sourcePath, surfaceId, canvasId, id, startLine, endLine, kind }) {
  return {
    file_path: sourcePath,
    canvas_id: canvasId,
    surface_id: surfaceId,
    subject_id: id,
    adapter_subject_id: `${sourcePath}:L${startLine}-L${endLine}`,
    line_start: startLine,
    line_end: endLine,
    markdown_kind: kind,
  }
}

function markdownAdapter({ confidence = 0.92, childDiscovery = 'complete' } = {}) {
  return {
    id: MARKDOWN_SPATIAL_TREE_ADAPTER_ID,
    type: 'markdown_workbench',
    confidence,
    freshness: 'snapshot',
    child_discovery: childDiscovery,
    reason: 'Deterministic Markdown fixture/builder; not a live browser, AX tree, screenshot, or rendered-pixel oracle.',
  }
}

function markdownCapabilities(overrides = {}) {
  return {
    hit_test: true,
    annotate: true,
    project_annotation: true,
    action: false,
    capture: false,
    inspect_children: true,
    ...overrides,
  }
}

function node({
  id,
  parent_id,
  kind,
  label,
  source = {},
  bounds = {},
  state = 'visible',
  adapter = markdownAdapter(),
  capabilities = markdownCapabilities(),
  sibling_order = null,
  metadata = {},
}) {
  return {
    id,
    parent_id,
    kind,
    label,
    source,
    bounds,
    state,
    adapter,
    capabilities,
    sibling_order,
    metadata,
  }
}

function findTables(lines) {
  const tables = []
  let start = null
  for (let index = 0; index < lines.length; index += 1) {
    const isTable = /^\s*\|/.test(lines[index])
    if (isTable && start == null) start = index + 1
    if ((!isTable || index === lines.length - 1) && start != null) {
      const end = isTable && index === lines.length - 1 ? index + 1 : index
      tables.push({ start_line: start, end_line: end })
      start = null
    }
  }
  return tables
}

function findMermaidBlocks(lines) {
  const blocks = []
  let start = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (start == null && /^```mermaid\s*$/.test(line)) {
      start = index + 1
    } else if (start != null && /^```\s*$/.test(line)) {
      blocks.push({ start_line: start, end_line: index + 1 })
      start = null
    }
  }
  return blocks
}

function headingBlocks(lines) {
  const headings = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index])
    if (!match) continue
    headings.push({
      level: match[1].length,
      title: match[2],
      start_line: index + 1,
      end_line: lines.length,
    })
  }
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index]
    const next = headings.slice(index + 1).find((heading) => heading.level <= current.level)
    current.end_line = next ? next.start_line - 1 : lines.length
  }
  return headings
}

function decisionTargets(lines) {
  return REQUIRED_DECISION_TARGETS.map((target) => {
    const matchIndex = lines.findIndex((line) => target.match.test(line))
    const startLine = matchIndex >= 0 ? Math.min(target.start_line, matchIndex + 1) : target.start_line
    return {
      ...target,
      start_line: startLine,
      end_line: target.end_line,
    }
  })
}

export function buildMarkdownSpatialSubjectTree({
  markdown,
  sourcePath = DEFAULT_SOURCE_PATH,
  createdAt = DEFAULT_CREATED_AT,
  ids = {},
  geometry = {},
} = {}) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const mergedGeometry = { ...DEFAULT_GEOMETRY, ...geometry }
  const documentHeight = mergedGeometry.margin_y * 2 + (lines.length * mergedGeometry.line_height)
  const displayId = String(ids.displayId ?? '1')
  const windowId = String(ids.windowId ?? 'markdown-alignment-pack')
  const canvasId = String(ids.canvasId ?? 'markdown-alignment-pack')
  const surfaceId = String(ids.surfaceId ?? 'employer-brand-human-alignment-pack')
  const docId = `document:${slugify(path.basename(sourcePath), 'markdown-document')}`
  const surfaceNodeId = `surface:${surfaceId}`
  const canvasNodeId = `canvas:${canvasId}`
  const windowNodeId = `window:${windowId}`
  const displayNodeId = `display:${displayId}`

  const sharedSource = { file_path: sourcePath, canvas_id: canvasId, surface_id: surfaceId }
  const nodes = [
    node({
      id: 'desktop-world',
      parent_id: null,
      kind: 'desktop_world',
      label: 'DesktopWorld',
      source: {},
      bounds: { desktop_world: { x: 0, y: 0, width: 1200, height: Math.max(900, documentHeight + 160) } },
      adapter: { id: 'markdown-fixture-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: markdownCapabilities({ annotate: false, project_annotation: false }),
    }),
    node({
      id: displayNodeId,
      parent_id: 'desktop-world',
      kind: 'display',
      label: 'Deterministic Markdown Display',
      source: { display_id: displayId },
      bounds: { parent_local: { x: 0, y: 0, width: 1200, height: Math.max(900, documentHeight + 160) } },
      sibling_order: 0,
      adapter: { id: 'markdown-fixture-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: markdownCapabilities({ annotate: false, project_annotation: false }),
    }),
    node({
      id: windowNodeId,
      parent_id: displayNodeId,
      kind: 'window',
      label: 'Markdown Alignment Pack',
      source: { window_id: windowId, app_bundle_id: 'dev.agent-os.fixture' },
      bounds: { parent_local: { x: 80, y: 60, width: 1040, height: documentHeight + 80 } },
      sibling_order: 0,
      adapter: { id: 'markdown-fixture-topology', type: 'spatial_topology', confidence: 0.95, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: markdownCapabilities({ annotate: false, project_annotation: false }),
    }),
    node({
      id: canvasNodeId,
      parent_id: windowNodeId,
      kind: 'canvas',
      label: 'Markdown Workbench Canvas',
      source: { canvas_id: canvasId, window_id: windowId },
      bounds: { parent_local: { x: 0, y: 0, width: 1040, height: documentHeight + 80 } },
      sibling_order: 0,
      adapter: { id: 'markdown-workbench-canvas-fixture', type: 'aos_canvas', confidence: 0.9, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: markdownCapabilities({ project_annotation: false }),
    }),
    node({
      id: surfaceNodeId,
      parent_id: canvasNodeId,
      kind: 'surface',
      label: 'Employer Brand Human Alignment Pack Markdown',
      source: { ...sharedSource, subject_id: 'employer-brand-human-alignment-pack' },
      bounds: { parent_local: { x: 24, y: 24, width: mergedGeometry.document_width, height: documentHeight } },
      sibling_order: 0,
      adapter: markdownAdapter({ confidence: 0.9 }),
      capabilities: markdownCapabilities(),
      metadata: {
        source_type: 'markdown_document',
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
        coordinate_oracle: 'synthetic_line_based_not_rendered_pixels',
        line_count: lines.length,
        geometry: mergedGeometry,
      },
    }),
    node({
      id: docId,
      parent_id: surfaceNodeId,
      kind: 'document',
      label: path.basename(sourcePath),
      source: { ...sharedSource, subject_id: docId, adapter_subject_id: sourcePath },
      bounds: {
        parent_local: {
          x: mergedGeometry.margin_x,
          y: mergedGeometry.margin_y,
          width: mergedGeometry.document_width - (mergedGeometry.margin_x * 2),
          height: lines.length * mergedGeometry.line_height,
        },
      },
      sibling_order: 0,
      adapter: markdownAdapter({ confidence: 0.96 }),
      capabilities: markdownCapabilities(),
      metadata: {
        role: 'markdown_document',
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
        coordinate_oracle: 'synthetic_line_based_not_rendered_pixels',
        line_range: { start_line: 1, end_line: lines.length },
      },
    }),
  ]

  let sibling = 1
  for (const heading of headingBlocks(lines)) {
    const id = `text:line-${lineId(heading.start_line)}-${slugify(heading.title)}`
    nodes.push(node({
      id,
      parent_id: surfaceNodeId,
      kind: 'text_range',
      label: heading.title,
      source: sourceFor({ sourcePath, surfaceId, canvasId, id, startLine: heading.start_line, endLine: heading.end_line, kind: 'heading' }),
      bounds: { parent_local: lineBounds(heading.start_line, heading.end_line, mergedGeometry) },
      sibling_order: sibling,
      adapter: markdownAdapter(),
      capabilities: markdownCapabilities({ inspect_children: false }),
      metadata: {
        role: 'heading',
        heading_level: heading.level,
        line_range: { start_line: heading.start_line, end_line: heading.end_line },
        text_excerpt: excerpt(lines, heading.start_line, Math.min(heading.start_line + 1, heading.end_line)),
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
      },
    }))
    sibling += 1
  }

  for (const block of findMermaidBlocks(lines)) {
    const id = `region:line-${lineId(block.start_line)}-mermaid-evidence-flow`
    nodes.push(node({
      id,
      parent_id: surfaceNodeId,
      kind: 'region',
      label: 'Evidence Flow Mermaid block',
      source: sourceFor({ sourcePath, surfaceId, canvasId, id, startLine: block.start_line, endLine: block.end_line, kind: 'mermaid_block' }),
      bounds: { parent_local: lineBounds(block.start_line, block.end_line, mergedGeometry) },
      sibling_order: sibling,
      adapter: markdownAdapter(),
      capabilities: markdownCapabilities({ inspect_children: false }),
      metadata: {
        role: 'mermaid_block',
        line_range: { start_line: block.start_line, end_line: block.end_line },
        text_excerpt: excerpt(lines, block.start_line, block.end_line),
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
      },
    }))
    sibling += 1
  }

  for (const table of findTables(lines)) {
    const label = table.start_line === 29 ? 'Fallback evidence-flow table'
      : table.start_line === 81 ? 'KILOS interpretation table'
        : table.start_line === 107 ? 'Explicit human decision table'
          : `Markdown table lines ${table.start_line}-${table.end_line}`
    const id = `region:line-${lineId(table.start_line)}-${slugify(label)}`
    nodes.push(node({
      id,
      parent_id: surfaceNodeId,
      kind: 'region',
      label,
      source: sourceFor({ sourcePath, surfaceId, canvasId, id, startLine: table.start_line, endLine: table.end_line, kind: 'table' }),
      bounds: { parent_local: lineBounds(table.start_line, table.end_line, mergedGeometry) },
      sibling_order: sibling,
      adapter: markdownAdapter(),
      capabilities: markdownCapabilities({ inspect_children: false }),
      metadata: {
        role: 'markdown_table',
        line_range: { start_line: table.start_line, end_line: table.end_line },
        text_excerpt: excerpt(lines, table.start_line, table.end_line),
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
      },
    }))
    sibling += 1
  }

  for (const target of decisionTargets(lines)) {
    const id = `target:line-${lineId(target.start_line)}-${target.id}`
    nodes.push(node({
      id,
      parent_id: surfaceNodeId,
      kind: 'semantic_target',
      label: target.label,
      source: sourceFor({ sourcePath, surfaceId, canvasId, id, startLine: target.start_line, endLine: target.end_line, kind: 'decision_target' }),
      bounds: { parent_local: lineBounds(target.start_line, target.end_line, mergedGeometry) },
      sibling_order: sibling,
      adapter: markdownAdapter({ confidence: 0.98 }),
      capabilities: markdownCapabilities({ inspect_children: false }),
      metadata: {
        role: target.role,
        line_range: { start_line: target.start_line, end_line: target.end_line },
        text_excerpt: excerpt(lines, target.start_line, target.end_line),
        coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
        required_alignment_target: true,
      },
    }))
    sibling += 1
  }

  return normalizeSpatialSubjectTree({
    version: '0.1.0',
    created_at: createdAt,
    root: 'desktop-world',
    nodes,
    metadata: {
      builder: MARKDOWN_SPATIAL_TREE_ADAPTER_ID,
      source_path: sourcePath,
      source_type: 'markdown',
      coordinate_space: MARKDOWN_DOCUMENT_COORDINATE_SPACE,
      coordinate_oracle: 'synthetic_line_based_not_rendered_pixels',
      adapter_fixture_only: true,
      hard_boundaries: {
        live_capture: false,
        url_opening: false,
        screenshot_pixel_oracle: false,
        ax_harvest: false,
      },
    },
  })
}

export function loadMarkdownSpatialSubjectTree({
  filePath,
  sourcePath = filePath,
  createdAt = DEFAULT_CREATED_AT,
  ids,
  geometry,
} = {}) {
  const markdown = readFileSync(filePath, 'utf8')
  return buildMarkdownSpatialSubjectTree({ markdown, sourcePath, createdAt, ids, geometry })
}

export function validateMarkdownSpatialSubjectTree(tree) {
  return assertSpatialSubjectTreeShape(tree)
}

export function requiredMarkdownDecisionTargets() {
  return REQUIRED_DECISION_TARGETS.map((target) => ({ ...target }))
}

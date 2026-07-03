import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  escHtml,
  renderMarkdown,
} from '../markdown/render.js';
import {
  normalizeAgentUiTarget,
} from '../runtime/semantic-targets.js';
import {
  buildWorkbenchCheckpointResume,
  buildWorkbenchHumanCheckpoint,
  hashWorkbenchContent,
} from './human-checkpoint.js';

export const HTML_WORKBENCH_EXPRESSION_SCHEMA = 'aos_html_workbench_expression';
export const HTML_WORKBENCH_EXPRESSION_VERSION = '0.1.0';
export const HTML_WORKBENCH_EXPRESSION_SURFACE = 'html-workbench-expression';
export const HTML_WORKBENCH_CHECKPOINT_ADAPTER = 'html-workbench-expression';

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';
const DEFAULT_SOURCE_PATH = 'docs/design/work-cards/work-card.md';
const ARTIFACT_KINDS = new Set(['work_card', 'human_alignment_pack']);
const TARGET_KINDS = new Set([
  'document',
  'section',
  'heading',
  'decision',
  'checklist_item',
  'mermaid_block',
  'code_block',
  'non_goal',
  'verification',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function slugify(value, fallback = 'target') {
  const slug = text(value)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function uniqueId(base, seen) {
  const root = slugify(base);
  if (!seen.has(root)) {
    seen.add(root);
    return root;
  }
  let index = 2;
  while (seen.has(`${root}-${index}`)) index += 1;
  const id = `${root}-${index}`;
  seen.add(id);
  return id;
}

function sourceHash(markdown) {
  return hashWorkbenchContent(markdown);
}

function shortHash(markdown) {
  return crypto.createHash('sha256').update(String(markdown ?? '')).digest('hex').slice(0, 12);
}

function normalizeLine(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function headingBlocks(lines) {
  const headings = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```\s*([a-zA-Z0-9_-]+)?\s*$/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      title: match[2],
      start_line: index + 1,
      end_line: lines.length,
    });
  }
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    current.end_line = next ? next.start_line - 1 : lines.length;
  }
  return headings;
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function codeBlocks(lines) {
  const blocks = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const start = /^```\s*([a-zA-Z0-9_-]+)?\s*$/.exec(line);
    if (open == null && start) {
      open = { start_line: index + 1, language: text(start[1]).toLowerCase() };
      continue;
    }
    if (open && /^```\s*$/.test(line)) {
      blocks.push({
        ...open,
        end_line: index + 1,
        source: lines.slice(open.start_line, index).join('\n'),
      });
      open = null;
    }
  }
  return blocks;
}

function checklistItems(lines) {
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    items.push({
      line: index + 1,
      checked: match[1].toLowerCase() === 'x',
      label: match[2],
    });
  }
  return items;
}

function sectionKind(title) {
  const normalized = text(title).toLowerCase();
  if (/decision/.test(normalized)) return 'decision';
  if (/non[- ]?goals?/.test(normalized)) return 'non_goal';
  if (/verification|test|acceptance/.test(normalized)) return 'verification';
  return 'section';
}

function targetDomId(target = {}) {
  const ref = text(target.ref);
  return text(target.provenance?.dom_id || ref.split(':').pop() || ref);
}

function targetSource(target = {}) {
  return target.extension?.source || {};
}

function targetSelector(target = {}) {
  return text(target.provenance?.selector, `[data-semantic-target-id="${targetDomId(target)}"]`);
}

function targetAttributes(target) {
  const source = targetSource(target);
  const domId = targetDomId(target);
  return [
    `data-aos-ref="${escHtml(target.ref)}"`,
    `data-aos-surface="${HTML_WORKBENCH_EXPRESSION_SURFACE}"`,
    `data-semantic-target-id="${escHtml(domId)}"`,
    `data-source-path="${escHtml(source.path)}"`,
    `data-source-line-start="${source.line_start}"`,
    `data-source-line-end="${source.line_end}"`,
    `data-target-kind="${escHtml(target.kind)}"`,
  ].join(' ');
}

function workbenchAgentUiTarget({
  id,
  kind,
  label,
  sourcePath,
  startLine,
  endLine,
  selector,
  eligible = true,
}) {
  const targetId = text(id);
  const normalizedKind = TARGET_KINDS.has(kind) ? kind : 'section';
  const lineStart = normalizeLine(startLine);
  const lineEnd = Math.max(lineStart, normalizeLine(endLine, lineStart));
  const source = {
    path: text(sourcePath, DEFAULT_SOURCE_PATH),
    line_start: lineStart,
    line_end: lineEnd,
  };
  return normalizeAgentUiTarget({
    id: targetId,
    ref: `${HTML_WORKBENCH_EXPRESSION_SURFACE}:${targetId}`,
    surface: HTML_WORKBENCH_EXPRESSION_SURFACE,
    role: 'document_region',
    name: text(label, targetId),
    kind: normalizedKind,
    selector: text(selector, `[data-semantic-target-id="${targetId}"]`),
  }, {
    kind: normalizedKind,
    actions: [],
    extension: {
      annotation_eligible: Boolean(eligible),
      reveal_eligible: Boolean(eligible),
      source,
    },
    provenance: {
      dom_id: targetId,
      selector: text(selector, `[data-semantic-target-id="${targetId}"]`),
    },
    suppressSourcePayloadId: true,
  });
}

function injectLineTarget(html, target) {
  const attrs = targetAttributes(target);
  const line = targetSource(target).line_start;
  if (target.kind === 'mermaid_block') {
    return html.replace(
      new RegExp(`<figure data-source-line="${line}" class="aos-markdown-mermaid"`),
      `<figure data-source-line="${line}" ${attrs} class="aos-markdown-mermaid"`,
    );
  }
  if (target.kind === 'code_block') {
    return html.replace(
      new RegExp(`<pre data-source-line="${line}"`),
      `<pre data-source-line="${line}" ${attrs}`,
    );
  }
  if (target.kind === 'checklist_item') {
    return html.replace(
      new RegExp(`<li data-source-line="${line}"`),
      `<li data-source-line="${line}" ${attrs}`,
    );
  }
  return html;
}

function shiftSourceLines(html, offset) {
  if (!offset) return html;
  return html.replace(/data-source-line="(\d+)"/g, (_, line) => `data-source-line="${Number(line) + offset}"`);
}

function sourceMapEntry(target) {
  const source = targetSource(target);
  return {
    ref: target.ref,
    source_path: source.path,
    source_line_start: source.line_start,
    source_line_end: source.line_end,
    selector: targetSelector(target),
  };
}

function mermaidEntry(target, block) {
  const source = targetSource(target);
  return {
    ref: target.ref,
    source_path: source.path,
    source_line_start: source.line_start,
    source_line_end: source.line_end,
    selector: targetSelector(target),
    source_hash: sourceHash(block.source),
  };
}

export function buildMarkdownWorkCardHtmlExpression({
  markdown = '',
  sourcePath = DEFAULT_SOURCE_PATH,
  generatedAt = DEFAULT_GENERATED_AT,
  expressionId,
  htmlPath = null,
  artifactKind = 'work_card',
} = {}) {
  const source = String(markdown ?? '');
  if (!ARTIFACT_KINDS.has(artifactKind)) {
    throw new TypeError(`unsupported HTML Workbench Expression artifact kind: ${artifactKind}`);
  }
  const lines = source.split(/\r?\n/);
  const headings = headingBlocks(lines);
  const blocks = codeBlocks(lines);
  const checklists = checklistItems(lines);
  const seen = new Set();
  const normalizedSourcePath = text(sourcePath, DEFAULT_SOURCE_PATH);
  const id = text(expressionId, `html-workbench-expression-${slugify(path.basename(normalizedSourcePath, path.extname(normalizedSourcePath)))}-${shortHash(source)}`);
  const semanticTargets = [];
  const sourceMap = [];
  const mermaidBlocks = [];

  const documentTarget = workbenchAgentUiTarget({
    id: uniqueId('document', seen),
    kind: 'document',
    label: headings[0]?.title || path.basename(normalizedSourcePath),
    sourcePath: normalizedSourcePath,
    startLine: 1,
    endLine: Math.max(1, lines.length),
    selector: '[data-aos-ref="html-workbench-expression:document"]',
  });
  semanticTargets.push(documentTarget);
  sourceMap.push(sourceMapEntry(documentTarget));

  const sectionTargets = headings.map((heading) => {
    const baseId = uniqueId(heading.title, seen);
    const kind = sectionKind(heading.title);
    const target = workbenchAgentUiTarget({
      id: baseId,
      kind,
      label: heading.title,
      sourcePath: normalizedSourcePath,
      startLine: heading.start_line,
      endLine: heading.end_line,
      selector: `#${baseId}`,
    });
    semanticTargets.push(target);
    sourceMap.push(sourceMapEntry(target));
    return { ...heading, target };
  });

  const blockTargets = blocks.map((block, index) => {
    const kind = block.language === 'mermaid' ? 'mermaid_block' : 'code_block';
    const target = workbenchAgentUiTarget({
      id: uniqueId(`${kind}-${index + 1}`, seen),
      kind,
      label: block.language === 'mermaid' ? `Mermaid block ${index + 1}` : `${block.language || 'code'} block ${index + 1}`,
      sourcePath: normalizedSourcePath,
      startLine: block.start_line,
      endLine: block.end_line,
      selector: `[data-semantic-target-id="${slugify(`${kind}-${index + 1}`)}"]`,
    });
    semanticTargets.push(target);
    sourceMap.push(sourceMapEntry(target));
    if (kind === 'mermaid_block') mermaidBlocks.push(mermaidEntry(target, block));
    return { ...block, target };
  });

  const checklistTargets = checklists.map((item, index) => {
    const target = workbenchAgentUiTarget({
      id: uniqueId(`checklist-${item.label || index + 1}`, seen),
      kind: 'checklist_item',
      label: item.label,
      sourcePath: normalizedSourcePath,
      startLine: item.line,
      endLine: item.line,
      selector: `[data-semantic-target-id="${slugify(`checklist-${item.label || index + 1}`)}"]`,
    });
    semanticTargets.push(target);
    sourceMap.push(sourceMapEntry(target));
    return { ...item, target };
  });

  let bodyHtml = '';
  if (sectionTargets.length === 0) {
    bodyHtml = renderMarkdown(source);
    for (const target of [...blockTargets, ...checklistTargets].map((item) => item.target)) {
      bodyHtml = injectLineTarget(bodyHtml, target);
    }
  } else {
    for (let index = 0; index < sectionTargets.length; index += 1) {
      const section = sectionTargets[index];
      const sectionMarkdown = lines.slice(section.start_line - 1, section.end_line).join('\n');
      let sectionHtml = shiftSourceLines(renderMarkdown(sectionMarkdown), section.start_line - 1);
      sectionHtml = sectionHtml.replace(
        new RegExp(`<h${section.level} data-source-line="${section.start_line}"`),
        `<h${section.level} data-source-line="${section.start_line}" ${targetAttributes(section.target)}`,
      );
      for (const item of blockTargets) {
        if (item.start_line >= section.start_line && item.start_line <= section.end_line) {
          sectionHtml = injectLineTarget(sectionHtml, item.target);
        }
      }
      for (const item of checklistTargets) {
        if (item.line >= section.start_line && item.line <= section.end_line) {
          sectionHtml = injectLineTarget(sectionHtml, item.target);
        }
      }
      bodyHtml += `<section id="${escHtml(targetDomId(section.target))}" ${targetAttributes(section.target)} class="aos-html-expression-section aos-html-expression-section--${escHtml(section.target.kind)}">${sectionHtml}</section>`;
    }
  }

  const outline = sectionTargets.map((section) => ({
    ref: section.target.ref,
    label: section.target.name,
    level: section.level,
    selector: targetSelector(section.target),
  }));
  const title = documentTarget.name;
  const navHtml = outline.length
    ? `<nav class="aos-html-expression-outline" aria-label="Work-card outline"><ol>${outline.map((item) => `<li data-level="${item.level}"><a href="${escHtml(item.selector)}">${escHtml(item.label)}</a></li>`).join('')}</ol></nav>`
    : '';
  const metadata = {
    schema: HTML_WORKBENCH_EXPRESSION_SCHEMA,
    version: HTML_WORKBENCH_EXPRESSION_VERSION,
    expression_id: id,
    source: {
      kind: 'markdown',
      path: normalizedSourcePath,
      content_hash: sourceHash(source),
    },
    generated_at: new Date(generatedAt).toISOString(),
    artifact_kind: artifactKind,
    html: {
      path: htmlPath,
      inline_fixture_path: htmlPath,
    },
    semantic_targets: semanticTargets,
    source_map: sourceMap,
    mermaid_blocks: mermaidBlocks,
    capabilities: {
      annotation: true,
      checkpoint: true,
      resume: true,
      export_sidecar: true,
      proposed_markdown_patch: true,
      source_mutation: false,
    },
    security: {
      markdown_html_escaped: true,
      unsafe_links_stripped: true,
      source_authored_script_execution: false,
      source_authored_inline_event_handlers: false,
      sandbox: 'repo_owned_static_shell_no_source_script_execution',
    },
    export_resume: {
      automatic_source_mutation: false,
      supported_outputs: ['annotation_sidecar', 'decision_sidecar', 'proposed_markdown_patch', 'noop_approval'],
    },
    outline,
  };

  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escHtml(title)}</title>`,
    '<link rel="stylesheet" href="../../packages/toolkit/markdown/preview.css">',
    '<style>',
    'body{margin:0;background:#f6f7f4;color:#18201d;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    '.aos-html-expression-shell{display:grid;grid-template-columns:minmax(180px,280px) minmax(0,1fr);gap:24px;max-width:1280px;margin:0 auto;padding:24px;}',
    '.aos-html-expression-outline{position:sticky;top:16px;align-self:start;border-right:1px solid #d9ded7;padding-right:16px;max-height:calc(100vh - 32px);overflow:auto;}',
    '.aos-html-expression-outline ol{list-style:none;margin:0;padding:0;}',
    '.aos-html-expression-outline li{margin:0 0 6px;padding-left:calc((var(--level,1) - 1) * 12px);}',
    '.aos-html-expression-outline li[data-level="2"]{padding-left:12px}.aos-html-expression-outline li[data-level="3"]{padding-left:24px}.aos-html-expression-outline a{color:#24565a;text-decoration:none;}',
    '.aos-html-expression-source{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;color:#4d5a54;font-size:12px;}',
    '.aos-html-expression-source code{background:#e7ece7;border:1px solid #ced8d0;border-radius:5px;padding:2px 6px;}',
    '.aos-html-expression-document{background:#fff;border:1px solid #dfe5dd;border-radius:8px;padding:28px;box-shadow:0 1px 2px rgba(14,24,19,.06);}',
    '.aos-html-expression-section{scroll-margin-top:20px;border-top:1px solid #e5eae4;padding-top:10px;margin-top:18px;}',
    '.aos-html-expression-section:first-child{border-top:0;margin-top:0;padding-top:0;}',
    '.aos-html-expression-section--decision,.aos-html-expression-section--verification{border-left:3px solid #2f7d75;padding-left:14px;}',
    '.aos-html-expression-section--non_goal{border-left:3px solid #8b5d41;padding-left:14px;}',
    '@media (max-width: 820px){.aos-html-expression-shell{display:block;padding:16px}.aos-html-expression-outline{position:static;border-right:0;border-bottom:1px solid #d9ded7;margin-bottom:16px;padding:0 0 12px}.aos-html-expression-document{padding:18px}}',
    '</style>',
    '</head>',
    '<body>',
    `<main class="aos-html-expression-shell" data-expression-id="${escHtml(id)}">`,
    navHtml,
    `<article class="aos-html-expression-document markdown-preview" ${targetAttributes(documentTarget)} aria-label="${escHtml(title)}">`,
    `<p class="aos-html-expression-source"><span>Source</span><code>${escHtml(normalizedSourcePath)}</code><span>Revision</span><code>${escHtml(metadata.source.content_hash)}</code></p>`,
    bodyHtml,
    '</article>',
    '</main>',
    `<script type="application/json" id="aos-html-workbench-expression-metadata">${scriptJson(metadata)}</script>`,
    '</body>',
    '</html>',
  ].join('\n');

  return {
    metadata,
    html,
  };
}

export function loadMarkdownWorkCardHtmlExpression({
  filePath,
  sourcePath = filePath,
  generatedAt,
  expressionId,
  htmlPath = null,
} = {}) {
  const markdown = readFileSync(filePath, 'utf8');
  return buildMarkdownWorkCardHtmlExpression({
    markdown,
    sourcePath,
    generatedAt,
    expressionId,
    htmlPath,
  });
}

export function buildHtmlWorkbenchExpressionCheckpoint({
  expression,
  canvasId = HTML_WORKBENCH_EXPRESSION_SURFACE,
  launchStatus = 'launched',
  readiness = { status: 'ready', command: './aos ready' },
  checkpointId,
  createdBy = 'agent',
  metadata = {},
} = {}) {
  const expressionMetadata = expression?.metadata || expression;
  if (!expressionMetadata?.expression_id) throw new TypeError('expression metadata is required');
  return buildWorkbenchHumanCheckpoint({
    checkpointId,
    status: launchStatus === 'attached' ? 'attached' : 'launched',
    subject: {
      type: 'html_workbench_expression',
      subject_type: 'html_workbench_expression',
      path: expressionMetadata.source?.path || expressionMetadata.expression_id,
      source: {
        kind: 'html_workbench_expression',
        expression_id: expressionMetadata.expression_id,
        source_kind: expressionMetadata.source?.kind || 'markdown',
        path: expressionMetadata.source?.path || '',
      },
      label: expressionMetadata.semantic_targets?.[0]?.name || expressionMetadata.expression_id,
    },
    canvasId,
    launchStatus,
    initialContent: JSON.stringify(expressionMetadata, null, 2),
    initialDiagnostics: {
      expression_id: expressionMetadata.expression_id,
      semantic_target_count: expressionMetadata.semantic_targets?.length || 0,
      mermaid_block_count: expressionMetadata.mermaid_blocks?.length || 0,
    },
    readiness,
    expectedHumanAction: 'Review the opened HTML Workbench Expression, add annotations or decisions, then reply when done.',
    resumeCondition: 'Human completes review of the rendered HTML expression.',
    createdBy,
    metadata: {
      adapter: HTML_WORKBENCH_CHECKPOINT_ADAPTER,
      expression_id: expressionMetadata.expression_id,
      source_hash: expressionMetadata.source?.content_hash,
      ...metadata,
    },
  });
}

export function buildHtmlWorkbenchExpressionResumePayload({
  checkpoint,
  expression,
  outputKind = 'noop_approval',
  annotations = [],
  decisions = [],
  proposedMarkdownPatch = '',
  resumedBy = 'agent',
  metadata = {},
} = {}) {
  const expressionMetadata = expression?.metadata || expression;
  const payload = {
    schema: 'aos_html_workbench_expression_resume',
    version: HTML_WORKBENCH_EXPRESSION_VERSION,
    expression_id: expressionMetadata?.expression_id || checkpoint?.metadata?.expression_id || '',
    output_kind: outputKind,
    source_path: expressionMetadata?.source?.path || checkpoint?.subject?.path || '',
    source_hash: expressionMetadata?.source?.content_hash || checkpoint?.metadata?.source_hash || '',
    annotations,
    decisions,
    proposed_markdown_patch: text(proposedMarkdownPatch),
    automatic_source_mutation: false,
    resumed_by: text(resumedBy, 'agent'),
    metadata,
  };
  const resumed = buildWorkbenchCheckpointResume({
    checkpoint,
    currentContent: JSON.stringify(payload, null, 2),
    currentDiagnostics: {
      output_kind: outputKind,
      annotation_count: annotations.length,
      decision_count: decisions.length,
      proposed_patch: Boolean(text(proposedMarkdownPatch)),
    },
    saveBehavior: 'draft',
    resumedBy,
    metadata: {
      adapter: HTML_WORKBENCH_CHECKPOINT_ADAPTER,
      resume_payload: payload,
    },
  });
  return {
    checkpoint: resumed,
    resume: payload,
  };
}

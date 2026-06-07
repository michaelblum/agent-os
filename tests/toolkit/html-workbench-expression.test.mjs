import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHtmlWorkbenchExpressionCheckpoint,
  buildHtmlWorkbenchExpressionResumePayload,
  buildMarkdownWorkCardHtmlExpression,
} from '../../packages/toolkit/workbench/html-workbench-expression.js';
import {
  HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE,
  buildHtmlWorkbenchSemanticTargetsPayload,
  createHtmlWorkbenchExpressionState,
  default as HtmlWorkbenchExpression,
  htmlWorkbenchExpressionSnapshot,
  openHtmlWorkbenchExpression,
  revealHtmlWorkbenchSemanticTarget,
} from '../../packages/toolkit/components/html-workbench-expression/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const sampleWorkCard = `# Sample Work Card

## Decision Points

- [ ] Approve the expression contract.
- [x] Keep Markdown canonical.

\`\`\`mermaid
graph TD
  A[<script>alert(1)</script>]-->B
\`\`\`

## Non-Goals

- Do not mutate source Markdown automatically.

## Verification

\`\`\`bash
node --test tests/toolkit/html-workbench-expression.test.mjs
\`\`\`

[bad](javascript:alert(1))
`;

test('Markdown work-card adapter emits safe HTML, metadata, semantic targets, and source maps', () => {
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown: sampleWorkCard,
    sourcePath: 'docs/design/work-cards/sample.md',
    generatedAt: '2026-05-10T00:00:00.000Z',
    expressionId: 'sample-expression',
    htmlPath: 'docs/design/fixtures/aos-html-workbench-expression-v0/sample.html',
  });

  assert.equal(expression.metadata.schema, 'aos_html_workbench_expression');
  assert.equal(expression.metadata.source.kind, 'markdown');
  assert.equal(expression.metadata.artifact_kind, 'work_card');
  assert.equal(expression.metadata.capabilities.source_mutation, false);
  assert.equal(expression.metadata.export_resume.automatic_source_mutation, false);
  assert.match(expression.metadata.source.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(expression.html, /data-aos-surface="html-workbench-expression"/);
  assert.match(expression.html, /data-semantic-target-id="decision-points"/);
  assert.match(expression.html, /data-semantic-target-id="checklist-approve-the-expression-contract"/);
  assert.match(expression.html, /data-semantic-target-id="mermaid-block-1"/);
  assert.match(expression.html, /data-semantic-target-id="code-block-2"/);
  assert.match(expression.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(expression.html, /javascript:alert/);

  const kinds = new Set(expression.metadata.semantic_targets.map((target) => target.kind));
  assert.equal(kinds.has('document'), true);
  assert.equal(kinds.has('decision'), true);
  assert.equal(kinds.has('checklist_item'), true);
  assert.equal(kinds.has('mermaid_block'), true);
  assert.equal(kinds.has('code_block'), true);
  assert.equal(kinds.has('non_goal'), true);
  assert.equal(kinds.has('verification'), true);

  const mermaid = expression.metadata.mermaid_blocks[0];
  assert.equal(mermaid.source_line_start, 8);
  assert.equal(mermaid.source_line_end, 11);
  assert.match(mermaid.source_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    expression.metadata.source_map.some((entry) => entry.ref === 'html-workbench-expression:checklist-keep-markdown-canonical'),
    true,
  );
});

test('Markdown adapter narrowly supports human alignment pack expressions', () => {
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown: sampleWorkCard,
    sourcePath: 'docs/design/fixtures/aos-artifacts/example/human-alignment-pack.md',
    artifactKind: 'human_alignment_pack',
  });

  assert.equal(expression.metadata.source.kind, 'markdown');
  assert.equal(expression.metadata.artifact_kind, 'human_alignment_pack');
  assert.throws(
    () => buildMarkdownWorkCardHtmlExpression({
      markdown: sampleWorkCard,
      artifactKind: 'generic_markdown',
    }),
    /unsupported HTML Workbench Expression artifact kind/,
  );
});

test('checkpoint and resume payloads refer to expression targets without source mutation', () => {
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown: sampleWorkCard,
    sourcePath: 'docs/design/work-cards/sample.md',
    generatedAt: '2026-05-10T00:00:00.000Z',
    expressionId: 'sample-expression',
  });
  const checkpoint = buildHtmlWorkbenchExpressionCheckpoint({
    expression,
    canvasId: 'html-expression-test',
    checkpointId: 'checkpoint-html-expression-test',
    createdBy: 'test',
  });
  assert.equal(checkpoint.subject.type, 'html_workbench_expression');
  assert.equal(checkpoint.metadata.adapter, 'html-workbench-expression');
  assert.equal(checkpoint.metadata.expression_id, 'sample-expression');
  assert.equal(checkpoint.initial.diagnostics.semantic_target_count, expression.metadata.semantic_targets.length);

  const target = expression.metadata.semantic_targets.find((item) => item.kind === 'decision');
  const resume = buildHtmlWorkbenchExpressionResumePayload({
    checkpoint,
    expression,
    outputKind: 'decision_sidecar',
    decisions: [{
      ref: target.ref,
      decision: 'approved',
      source_path: target.extension.source.path,
      source_line_start: target.extension.source.line_start,
      source_line_end: target.extension.source.line_end,
    }],
    resumedBy: 'test',
  });

  assert.equal(resume.resume.output_kind, 'decision_sidecar');
  assert.equal(resume.resume.automatic_source_mutation, false);
  assert.equal(resume.resume.decisions[0].ref, target.ref);
  assert.equal(resume.checkpoint.resume.metadata.resume_payload.output_kind, 'decision_sidecar');
});

test('HTML expression workbench surface accepts an expression payload and snapshots stable state', () => {
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown: sampleWorkCard,
    sourcePath: 'docs/design/work-cards/sample.md',
    expressionId: 'sample-expression',
  });
  const state = createHtmlWorkbenchExpressionState();
  const result = openHtmlWorkbenchExpression(state, {
    type: 'html_workbench_expression.open',
    metadata: expression.metadata,
    html: expression.html,
  });

  assert.equal(result.status, 'opened');
  assert.equal(result.semantic_target_count, expression.metadata.semantic_targets.length);
  assert.deepEqual(htmlWorkbenchExpressionSnapshot(state), {
    surface: 'html-workbench-expression',
    expression_id: 'sample-expression',
    source_path: 'docs/design/work-cards/sample.md',
    semantic_target_count: expression.metadata.semantic_targets.length,
    last_result: result,
  });
});

test('HTML expression surface payload exposes revealable live semantic targets', () => {
  const state = createHtmlWorkbenchExpressionState({
    metadata: {
      expression_id: 'sample-expression',
      semantic_targets: [{
        ref: 'html-workbench-expression:goal',
        surface: 'html-workbench-expression',
        role: 'document_region',
        name: 'Goal',
        kind: 'section',
        enabled: true,
        state: { value: null, current: null, pressed: null, selected: null, checked: null, expanded: null },
        actions: [],
        extension: { reveal_eligible: true },
        provenance: { selector: '[data-semantic-target-id="goal"]', dom_id: 'goal' },
      }],
    },
  });
  const goalElement = {
    getBoundingClientRect: () => ({ x: 20, y: 40, width: 300, height: 60 }),
  };
  const document_ = {
    querySelector(selector) {
      if (selector === '.html-expression-content-wrap') return {
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      };
      if (selector === '[data-semantic-target-id="goal"]') return goalElement;
      return null;
    },
  };

  const payload = buildHtmlWorkbenchSemanticTargetsPayload(state, {
    document_,
    now: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(payload.type, 'canvas_inspector.semantic_targets');
  assert.equal(payload.canvas_id, 'html-workbench-expression');
  assert.equal(payload.semantic_targets[0].ref, 'html-workbench-expression:goal');
  assert.equal(payload.semantic_targets[0].current_render_status, 'visible');
  assert.equal(payload.semantic_targets[0].can_reveal, true);
  assert.deepEqual(payload.semantic_targets[0].display_space_rect, { x: 20, y: 40, w: 300, h: 60 });
});

test('HTML expression surface keeps offscreen semantic targets revealable without display overlay geometry', () => {
  const state = createHtmlWorkbenchExpressionState({
    metadata: {
      expression_id: 'sample-expression',
      semantic_targets: [{
        ref: 'html-workbench-expression:suggested-verification',
        surface: 'html-workbench-expression',
        role: 'document_region',
        name: 'Suggested Verification',
        kind: 'verification',
        enabled: true,
        state: { value: null, current: null, pressed: null, selected: null, checked: null, expanded: null },
        actions: [],
        extension: { reveal_eligible: true },
        provenance: { selector: '[data-semantic-target-id="suggested-verification"]', dom_id: 'suggested-verification' },
      }],
    },
  });
  const document_ = {
    querySelector(selector) {
      if (selector === '.html-expression-content-wrap') return {
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 200 }),
      };
      if (selector === '[data-semantic-target-id="suggested-verification"]') return {
        getBoundingClientRect: () => ({ x: 20, y: 900, width: 300, height: 60 }),
      };
      return null;
    },
  };

  const payload = buildHtmlWorkbenchSemanticTargetsPayload(state, { document_ });

  assert.equal(payload.semantic_targets[0].current_render_status, 'offscreen_scrollable');
  assert.equal(payload.semantic_targets[0].can_reveal, true);
  assert.equal(payload.semantic_targets[0].display_space_rect, null);
});

test('HTML expression reveal hook scrolls an offscreen semantic target and returns refreshed visible projection', () => {
  const state = createHtmlWorkbenchExpressionState({
    metadata: {
      expression_id: 'sample-expression',
      semantic_targets: [{
        ref: 'html-workbench-expression:suggested-verification',
        surface: 'html-workbench-expression',
        role: 'document_region',
        name: 'Suggested Verification',
        kind: 'verification',
        enabled: true,
        state: { value: null, current: null, pressed: null, selected: null, checked: null, expanded: null },
        actions: [],
        extension: { reveal_eligible: true },
        provenance: { selector: '[data-semantic-target-id="suggested-verification"]', dom_id: 'suggested-verification' },
      }],
    },
  });
  let refreshed = false;
  const targetElement = {
    tagName: 'SECTION',
    tabIndex: -1,
    rect: { x: 20, y: 900, width: 300, height: 60 },
    getBoundingClientRect() {
      return this.rect;
    },
    scrollIntoView() {
      this.rect = { x: 20, y: 90, width: 300, height: 60 };
    },
  };
  const document_ = {
    querySelector(selector) {
      if (selector === '.html-expression-content-wrap') return {
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 200 }),
      };
      if (selector === '[data-semantic-target-id="suggested-verification"]') return targetElement;
      return null;
    },
  };

  const result = revealHtmlWorkbenchSemanticTarget(state, {
    subject_id: 'suggested-verification',
    source_tree_node_metadata: {
      selector: '[data-semantic-target-id="suggested-verification"]',
    },
  }, {
    document_,
    now: '2026-05-10T00:00:00.000Z',
    scheduleRefresh: () => { refreshed = true; },
  });

  assert.equal(result.status, 'revealed');
  assert.equal(result.adapter_id, 'aos-toolkit-semantic-target');
  assert.equal(result.projection.current_render_status, 'visible');
  assert.equal(result.projection.can_project_display_overlay, true);
  assert.deepEqual(result.projection.display_space_rect, { x: 20, y: 90, w: 300, h: 60 });
  assert.equal(refreshed, true);

  const refreshedPayload = buildHtmlWorkbenchSemanticTargetsPayload(state, {
    document_,
    now: '2026-05-10T00:00:01.000Z',
  });
  assert.equal(refreshedPayload.semantic_targets[0].current_render_status, 'visible');
  assert.deepEqual(refreshedPayload.semantic_targets[0].display_space_rect, { x: 20, y: 90, w: 300, h: 60 });
});

test('HTML expression surface replays current semantic targets when Surface Inspector attaches late', () => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const sent = [];
  globalThis.window = {
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            sent.push(message);
          },
        },
      },
    },
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '.html-expression-content-wrap') return {
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      };
      if (selector === '[data-semantic-target-id="goal"]') return {
        getBoundingClientRect: () => ({ x: 20, y: 40, width: 300, height: 60 }),
      };
      return null;
    },
  };
  try {
    const surface = HtmlWorkbenchExpression({
      metadata: {
        expression_id: 'sample-expression',
        semantic_targets: [{
          ref: 'html-workbench-expression:goal',
          surface: 'html-workbench-expression',
          role: 'document_region',
          name: 'Goal',
          kind: 'section',
          enabled: true,
          state: { value: null, current: null, pressed: null, selected: null, checked: null, expanded: null },
          actions: [],
          extension: { reveal_eligible: true },
          provenance: { selector: '[data-semantic-target-id="goal"]', dom_id: 'goal' },
        }],
      },
    });

    assert.ok(surface.manifest.accepts.includes(HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE));
    surface.onMessage({
      type: HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE,
      requester_canvas_id: 'surface-inspector',
      reply_to: 'surface-inspector',
      reason: 'surface_inspector_bootstrap',
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'canvas.send');
    assert.equal(sent[0].payload.target, 'surface-inspector');
    assert.equal(sent[0].payload.message.type, 'canvas_inspector.semantic_targets');
    assert.equal(sent[0].payload.message.replay_reason, 'surface_inspector_bootstrap');
    assert.equal(sent[0].payload.message.semantic_targets[0].ref, 'html-workbench-expression:goal');
    assert.equal(sent[0].payload.message.semantic_targets[0].can_reveal, true);
    assert.deepEqual(sent[0].payload.message.semantic_targets[0].display_space_rect, { x: 20, y: 40, w: 300, h: 60 });
  } finally {
    globalThis.window = priorWindow;
    globalThis.document = priorDocument;
  }
});

test('generated fixture is deterministic for the checked-in work-card', async () => {
  const markdown = await fs.readFile(path.join(repoRoot, 'docs/design/work-cards/aos-html-workbench-expression-v0.md'), 'utf8');
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown,
    sourcePath: 'docs/design/work-cards/aos-html-workbench-expression-v0.md',
    generatedAt: '2026-05-10T00:00:00.000Z',
    htmlPath: 'docs/design/fixtures/aos-html-workbench-expression-v0/expression.html',
  });
  const fixture = JSON.parse(await fs.readFile(path.join(repoRoot, 'docs/design/fixtures/aos-html-workbench-expression-v0/expression.json'), 'utf8'));

  assert.deepEqual(fixture, expression.metadata);
});

test('generated workbench semantic targets single-source identity and source data', () => {
  const expression = buildMarkdownWorkCardHtmlExpression({
    markdown: sampleWorkCard,
    sourcePath: 'docs/design/work-cards/sample.md',
    generatedAt: '2026-05-10T00:00:00.000Z',
    expressionId: 'sample-expression',
  });

  for (const target of expression.metadata.semantic_targets) {
    assert.equal(Object.hasOwn(target, 'ref'), true);
    for (const key of ['id', 'target_id', 'data_aos_ref', 'aos_ref', 'accessible_label', 'semantic_target_id', 'subject_id', 'do_target']) {
      assert.equal(Object.hasOwn(target, key), false, `${target.ref} leaked top-level ${key}`);
    }
    assert.equal(Object.hasOwn(target.extension, 'dom_id'), false, `${target.ref} duplicated dom_id under extension`);
    assert.equal(Object.hasOwn(target.provenance, 'dom_id'), true, `${target.ref} missing provenance.dom_id`);
    assert.equal(Object.hasOwn(target.provenance, 'source_payload_id'), false, `${target.ref} duplicated source_payload_id`);
    for (const key of ['source_path', 'source_line_start', 'source_line_end']) {
      assert.equal(Object.hasOwn(target.provenance, key), false, `${target.ref} duplicated ${key} under provenance`);
    }
    assert.equal(target.extension.source.path, 'docs/design/work-cards/sample.md');
    assert.equal(Number.isInteger(target.extension.source.line_start), true);
    assert.equal(Number.isInteger(target.extension.source.line_end), true);
  }
});

test('resume fixture maps annotation and decision sidecars back to expression source lines', async () => {
  const metadata = JSON.parse(await fs.readFile(path.join(repoRoot, 'docs/design/fixtures/aos-html-workbench-expression-v0/expression.json'), 'utf8'));
  const resume = JSON.parse(await fs.readFile(path.join(repoRoot, 'docs/design/fixtures/aos-html-workbench-expression-v0/resume-decision-sidecar.json'), 'utf8'));
  const targets = new Map(metadata.semantic_targets.map((target) => [target.ref, target]));

  assert.equal(resume.schema, 'aos_html_workbench_expression_resume');
  assert.equal(resume.expression_id, metadata.expression_id);
  assert.equal(resume.source_hash, metadata.source.content_hash);
  assert.equal(resume.automatic_source_mutation, false);

  for (const record of [...resume.annotations, ...resume.decisions]) {
    const target = targets.get(record.ref);
    assert.ok(target, `missing target ${record.ref}`);
    assert.equal(record.source_path, target.extension.source.path);
    assert.equal(record.source_line_start, target.extension.source.line_start);
    assert.equal(record.source_line_end, target.extension.source.line_end);
  }
});

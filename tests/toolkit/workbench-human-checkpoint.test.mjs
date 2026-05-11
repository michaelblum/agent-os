import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildLaunchAttemptRecord,
  buildSuccessfulLaunchMetadata,
} from '../../scripts/workbench-human-checkpoint-start.mjs';
import {
  buildAnnotationPushEvent,
} from '../../scripts/workbench-human-checkpoint-annotations-push.mjs';
import {
  addMarkdownWorkbenchAnnotation,
  buildMarkdownLaunchFailedCheckpoint,
  buildMarkdownReadinessBlockedCheckpoint,
  buildMarkdownWorkbenchCheckpoint,
  clearMarkdownWorkbenchAnnotations,
  commitMarkdownWorkbenchAnnotations,
  recoverMarkdownWorkbenchAnnotations,
  resolveMarkdownWorkbenchAnnotation,
  resumeMarkdownWorkbenchCheckpoint,
} from '../../packages/toolkit/components/markdown-workbench/checkpoint.js';
import { markdownDiagnostics } from '../../packages/toolkit/components/markdown-workbench/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/workbench-human-checkpoint-v0.schema.json');
const annotationSchemaPath = path.join(repoRoot, 'shared/schemas/annotation.schema.json');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/workbench-human-checkpoint-v0');

function validationResult(instance, schema = schemaPath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.argv[2])
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schema,
      JSON.stringify(instance),
    ],
    { encoding: 'utf8' },
  );
  return result;
}

function validate(instance, schema = schemaPath) {
  const result = validationResult(instance, schema);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

function validateFails(instance, schema = schemaPath) {
  const result = validationResult(instance, schema);
  assert.notEqual(result.status, 0, 'expected schema validation to fail');
}

async function readFixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name), 'utf8'));
}

function startCheckpoint() {
  const content = '# Draft\n\nInitial text.\n';
  return buildMarkdownWorkbenchCheckpoint({
    checkpointId: 'checkpoint-test-start',
    state: {
      path: 'docs/example.md',
      source: { kind: 'file', path: 'docs/example.md' },
      content,
      diagnostics: markdownDiagnostics(content),
    },
    canvasId: 'markdown-workbench-test',
    readiness: {
      status: 'ready',
      command: './aos ready',
      exit_code: 0,
      diagnostics: { ready: true },
      repair_instructions: [],
    },
    createdBy: 'test',
  });
}

test('schema validates start, blocked, resumed, saved, draft, and annotated checkpoint examples', async () => {
  validate(await readFixture('start.json'));
  validate(await readFixture('blocked-readiness.json'));
  validate(await readFixture('resumed-with-annotations.json'));
  for (const name of [
    'point-comment-annotation.json',
    'region-comment-annotation.json',
    'element-selection-annotation.json',
    'resolved-annotation.json',
  ]) {
    validate({
      schema: 'annotations',
      version: '0.2.0',
      annotations: [await readFixture(name)],
    }, annotationSchemaPath);
  }

  const start = startCheckpoint();
  const changed = '# Draft\n\nInitial text.\n\n## Human note\n\nAccepted.\n';
  const draft = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: { path: 'docs/example.md', content: changed, diagnostics: markdownDiagnostics(changed), dirty: true },
    saveBehavior: 'draft',
    resumedBy: 'test',
  });
  const saved = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: { path: 'docs/example.md', content: changed, diagnostics: markdownDiagnostics(changed), dirty: true },
    saveBehavior: 'save',
    saveResult: { type: 'markdown_document.save.result', status: 'saved', path: 'docs/example.md' },
    resumedBy: 'test',
  });
  const resumed = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: { path: 'docs/example.md', content: changed, diagnostics: markdownDiagnostics(changed), dirty: true },
    saveBehavior: 'save',
    saveResult: { type: 'markdown_document.save.result', status: 'rejected', path: 'docs/example.md' },
    resumedBy: 'test',
  });
  const annotated = addMarkdownWorkbenchAnnotation(start, {
    id: 'annotation-test-1',
    actor: { role: 'human', id: 'operator' },
    kind: 'selection_comment',
    coordinate_space: 'document',
    text_range: { start_line: 3, end_line: 3 },
    note: 'Tighten this sentence.',
  });

  validate(draft);
  validate(saved);
  validate(resumed);
  validate(annotated);
  assert.equal(draft.status, 'draft');
  assert.equal(saved.status, 'saved');
  assert.equal(resumed.status, 'resumed');
  assert.equal(annotated.annotations.length, 1);
  assert.equal(annotated.annotations[0].ordinal, 1);
  assert.equal(annotated.annotations[0].status, 'committed');
});

test('Markdown adapter creates start records and readiness-blocked results', () => {
  const start = startCheckpoint();
  assert.equal(start.status, 'launched');
  assert.equal(start.canvas_id, 'markdown-workbench-test');
  assert.equal(start.subject.path, 'docs/example.md');
  assert.equal(start.initial.content_hash.startsWith('sha256:'), true);
  assert.equal(start.readiness.status, 'ready');
  assert.match(start.handoff.instructions, /Edit the opened Markdown Workbench surface/);

  const attached = buildMarkdownWorkbenchCheckpoint({
    state: { path: 'docs/example.md', content: '# Attached', diagnostics: markdownDiagnostics('# Attached') },
    canvasId: 'markdown-workbench-test',
    launchStatus: 'attached',
    readiness: start.readiness,
  });
  assert.equal(attached.status, 'attached');
  assert.equal(attached.launch_status, 'attached');

  const blocked = buildMarkdownReadinessBlockedCheckpoint({
    target: 'docs/example.md',
    readiness: {
      status: 'blocked',
      command: './aos ready',
      exit_code: 1,
      diagnostics: { output: 'permission missing' },
      repair_instructions: ['Re-add permission.'],
    },
  });
  assert.equal(blocked.status, 'blocked_readiness');
  assert.equal(blocked.canvas_id, null);
  assert.equal(blocked.launch_status, 'not_launched');
  assert.match(blocked.handoff.instructions, /Repair AOS readiness/);

  const launchFailed = buildMarkdownLaunchFailedCheckpoint({
    target: 'docs/example.md',
    readiness: start.readiness,
    launchStatus: 'launch_verify_failed',
    metadata: {
      launch_attempts: [{ step: 'verify_canvas_state', status: 'failed' }],
    },
  });
  validate(launchFailed);
  assert.equal(launchFailed.status, 'aborted');
  assert.equal(launchFailed.canvas_id, null);
  assert.equal(launchFailed.launch_status, 'launch_verify_failed');
  assert.equal(launchFailed.metadata.launch_failed, true);
  assert.match(launchFailed.handoff.instructions, /launch failure/);
});

test('Markdown resume reports unchanged and changed workbench states', () => {
  const start = startCheckpoint();
  const unchanged = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: {
      path: 'docs/example.md',
      content: start.initial.content,
      diagnostics: start.initial.diagnostics,
      dirty: false,
    },
    saveBehavior: 'draft',
  });
  assert.equal(unchanged.resume.diff_summary.changed, false);
  assert.equal(unchanged.resume.diff_summary.line_count_delta, 0);

  const changedContent = '# Draft\n\nInitial text.\n\n## Human note\n\nAccepted.\n';
  const changed = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: {
      path: 'docs/example.md',
      content: changedContent,
      diagnostics: markdownDiagnostics(changedContent),
      dirty: true,
    },
    saveBehavior: 'draft',
  });
  assert.equal(changed.resume.diff_summary.changed, true);
  assert.equal(changed.resume.diff_summary.line_count_delta, 4);
  assert.deepEqual(changed.resume.diff_summary.heading_delta.added, ['Human note']);
  assert.match(changed.resume.diff_summary.unified_diff_snippet, /\+## Human note/);
});

test('Markdown resume preserves save versus draft behavior', () => {
  const start = startCheckpoint();
  const content = `${start.initial.content}\nSaved.\n`;
  const draft = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: { path: 'docs/example.md', content, diagnostics: markdownDiagnostics(content), dirty: true },
    saveBehavior: 'draft',
  });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.resume.save_result, null);

  const saved = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: start,
    state: { path: 'docs/example.md', content, diagnostics: markdownDiagnostics(content), dirty: true },
    saveBehavior: 'save',
    saveResult: { type: 'markdown_document.save.result', status: 'saved', path: 'docs/example.md' },
  });
  assert.equal(saved.status, 'saved');
  assert.equal(saved.resume.save_result.status, 'saved');
});

test('Markdown annotations support point, region, and element intent records with durable ordinals', () => {
  const start = startCheckpoint();
  const withPoint = addMarkdownWorkbenchAnnotation(start, {
    id: 'annotation-point',
    kind: 'point_comment',
    point: { x: 48, y: 64 },
    note: 'Check this exact spot.',
    actor: { role: 'human', id: 'operator' },
  });
  const withRegion = addMarkdownWorkbenchAnnotation(withPoint, {
    id: 'annotation-region',
    kind: 'region_comment',
    bounds: { x: 80, y: 120, width: 240, height: 90 },
    viewport_bounds: { x: 80, y: 120, width: 240, height: 90 },
    page_bounds: { x: 80, y: 360, width: 240, height: 90 },
    text_excerpt: 'Initial text.',
    note: 'Revise opening.',
    actor: { role: 'human', id: 'operator' },
  });
  const withElement = addMarkdownWorkbenchAnnotation(withRegion, {
    id: 'annotation-element',
    kind: 'element_selection',
    selector_candidates: ['textarea.markdown-workbench-editor', '[aria-label="Markdown source"]'],
    bounds: { x: 12, y: 40, width: 520, height: 320 },
    role: 'textbox',
    label: 'Markdown source editor',
    text_excerpt: '# Draft',
    ancestor_chain: ['textarea.markdown-workbench-editor', 'section.source-pane'],
    note: 'Keep this selected heading stable.',
    actor: { role: 'operator', id: 'gdi' },
  });

  assert.deepEqual(withElement.annotations.map((annotation) => annotation.ordinal), [1, 2, 3]);
  assert.equal(withElement.annotations[0].kind, 'point_comment');
  assert.equal(withElement.annotations[1].kind, 'region_comment');
  assert.equal(withElement.annotations[2].kind, 'element_selection');
  assert.equal(withElement.annotations[2].source_path, 'docs/example.md');
  assert.deepEqual(withElement.annotations[2].selector_candidates, [
    'textarea.markdown-workbench-editor',
    '[aria-label="Markdown source"]',
  ]);
});

test('annotation schemas require non-empty source identity for structured records', async () => {
  const point = await readFixture('point-comment-annotation.json');
  validate({
    schema: 'annotations',
    version: '0.2.0',
    annotations: [{ ...point, source_path: 'docs/example.md', source_url: null }],
  }, annotationSchemaPath);
  validate({
    schema: 'annotations',
    version: '0.2.0',
    annotations: [{ ...point, source_path: null, source_url: 'aos://markdown-workbench/example' }],
  }, annotationSchemaPath);
  validateFails({
    schema: 'annotations',
    version: '0.2.0',
    annotations: [{ ...point, source_path: null, source_url: null }],
  }, annotationSchemaPath);
  validateFails({
    schema: 'annotations',
    version: '0.2.0',
    annotations: [{ ...point, source_path: '', source_url: null }],
  }, annotationSchemaPath);
  validate({
    schema: 'annotations',
    version: '0.1.0',
    annotations: [{ bounds: { x: 1, y: 2, width: 3, height: 4 }, label: 'Legacy region' }],
  }, annotationSchemaPath);

  const start = startCheckpoint();
  validate({
    ...start,
    annotations: [{ ...point, source_path: 'docs/example.md', source_url: null }],
  });
  validate({
    ...start,
    annotations: [{ ...point, source_path: null, source_url: 'aos://markdown-workbench/example' }],
  });
  validateFails({
    ...start,
    annotations: [{ ...point, source_path: null, source_url: null }],
  });
});

test('successful launch metadata preserves attempts, verification, refresh signals, and final result', () => {
  const launchAttempt = buildLaunchAttemptRecord({
    step: 'launch',
    command: 'packages/toolkit/components/markdown-workbench/launch.sh docs/example.md',
    exitCode: 0,
    stdout: 'content-root refresh triggered; restarting markdown workbench canvas',
    stderr: '',
    status: 'completed',
  });
  const verifyAttempt = buildLaunchAttemptRecord({
    step: 'verify_canvas_state',
    command: './aos show eval --id markdown-workbench-test --js JSON.stringify(window.__markdownWorkbenchState || null)',
    exitCode: 0,
    status: 'usable',
    canvasId: 'markdown-workbench-test',
  });
  const start = buildMarkdownWorkbenchCheckpoint({
    state: { path: 'docs/example.md', content: '# Draft', diagnostics: markdownDiagnostics('# Draft') },
    canvasId: 'markdown-workbench-test',
    launchStatus: 'launched',
    readiness: startCheckpoint().readiness,
    metadata: buildSuccessfulLaunchMetadata({
      canvasId: 'markdown-workbench-test',
      launchAttempts: [launchAttempt, verifyAttempt],
      finalLaunchResult: 'launched',
    }),
  });

  validate(start);
  assert.equal(start.status, 'launched');
  assert.equal(start.metadata.launch_attempts.length, 2);
  assert.equal(start.metadata.launch_attempts[0].command, 'packages/toolkit/components/markdown-workbench/launch.sh docs/example.md');
  assert.equal(start.metadata.launch_attempts[0].exit_code, 0);
  assert.match(start.metadata.launch_attempts[0].stdout_snippet, /content-root refresh/);
  assert.equal(start.metadata.launch_attempts[0].content_root_refresh_restart_detected, true);
  assert.equal(start.metadata.launch_attempts[1].status, 'usable');
  assert.equal(start.metadata.launch_attempts[1].canvas_id, 'markdown-workbench-test');
  assert.equal(start.metadata.launch_result.status, 'launched');
  assert.equal(start.metadata.launch_result.content_root_refresh_restart_detected, true);
});

test('launch failure checkpoint remains aborted with null canvas', () => {
  const launchFailed = buildMarkdownLaunchFailedCheckpoint({
    target: 'docs/example.md',
    readiness: startCheckpoint().readiness,
    launchStatus: 'launch_command_failed',
    metadata: {
      launch_attempts: [
        buildLaunchAttemptRecord({
          step: 'launch',
          command: 'packages/toolkit/components/markdown-workbench/launch.sh docs/example.md',
          exitCode: 1,
          stdout: '',
          stderr: 'launch failed',
          status: 'failed',
        }),
      ],
    },
  });

  validate(launchFailed);
  assert.equal(launchFailed.status, 'aborted');
  assert.equal(launchFailed.canvas_id, null);
  assert.equal(launchFailed.launch_status, 'launch_command_failed');
});

test('Markdown annotations support commit, resolve, reject, clear, and recover lifecycle', () => {
  const start = startCheckpoint();
  const draft = addMarkdownWorkbenchAnnotation(start, {
    id: 'annotation-draft',
    kind: 'point_comment',
    status: 'draft',
    point: { x: 20, y: 20 },
    note: 'Draft note.',
  });
  assert.equal(draft.annotations[0].status, 'draft');

  const committed = commitMarkdownWorkbenchAnnotations(draft);
  assert.equal(committed.annotations[0].status, 'committed');
  assert.match(committed.annotations[0].lifecycle.committed_at, /^20/);

  const resolved = resolveMarkdownWorkbenchAnnotation(committed, 'annotation-draft');
  assert.equal(resolved.annotations[0].status, 'resolved');
  assert.match(resolved.annotations[0].lifecycle.resolved_at, /^20/);

  const rejected = resolveMarkdownWorkbenchAnnotation(committed, 'annotation-draft', 'rejected');
  assert.equal(rejected.annotations[0].status, 'rejected');
  assert.match(rejected.annotations[0].lifecycle.rejected_at, /^20/);

  const cleared = clearMarkdownWorkbenchAnnotations(committed, { actor: 'test', reason: 'smoke reset' });
  assert.equal(cleared.annotations.length, 0);
  assert.equal(cleared.metadata.annotation_clear.count, 1);

  const recovered = recoverMarkdownWorkbenchAnnotations(cleared, committed.annotations);
  assert.equal(recovered.annotations.length, 1);
  assert.equal(recovered.annotations[0].lifecycle.recovered_from, start.checkpoint_id);
});

test('annotation push helper builds Markdown Workbench replace and clear events', () => {
  const start = startCheckpoint();
  const annotated = addMarkdownWorkbenchAnnotation(start, {
    id: 'annotation-push-1',
    actor: { role: 'human', id: 'operator' },
    kind: 'selection_comment',
    coordinate_space: 'document',
    text_range: { start_line: 3, end_line: 3 },
    note: 'Visible in workbench.',
  });
  const event = buildAnnotationPushEvent(annotated);
  assert.equal(event.type, 'markdown_workbench.annotations.replace');
  assert.equal(event.payload.checkpoint_id, 'checkpoint-test-start');
  assert.equal(event.payload.annotations.length, 1);
  assert.equal(event.payload.annotations[0].ordinal, 1);
  assert.equal(event.payload.annotations[0].note, 'Visible in workbench.');

  const clear = buildAnnotationPushEvent(annotated, { clear: true });
  assert.equal(clear.type, 'markdown_workbench.annotations.clear');
});

test('Markdown resume preserves committed annotations through draft and save payloads', () => {
  const start = startCheckpoint();
  const annotated = addMarkdownWorkbenchAnnotation(start, {
    id: 'annotation-committed',
    kind: 'region_comment',
    bounds: { x: 40, y: 80, width: 200, height: 100 },
    note: 'Carry this comment into resume.',
    actor: { role: 'human', id: 'operator' },
  });
  const content = `${start.initial.content}\nSaved.\n`;
  const draft = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: annotated,
    state: { path: 'docs/example.md', content, diagnostics: markdownDiagnostics(content), dirty: true },
    saveBehavior: 'draft',
  });
  const saved = resumeMarkdownWorkbenchCheckpoint({
    checkpoint: annotated,
    state: { path: 'docs/example.md', content, diagnostics: markdownDiagnostics(content), dirty: true },
    saveBehavior: 'save',
    saveResult: { type: 'markdown_document.save.result', status: 'saved', path: 'docs/example.md' },
  });

  assert.equal(draft.annotations.length, 1);
  assert.equal(draft.resume.annotations.length, 1);
  assert.equal(draft.resume.metadata.committed_annotation_count, 1);
  assert.equal(saved.resume.annotations[0].id, 'annotation-committed');
});

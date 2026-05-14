import {
  addWorkbenchCheckpointAnnotation,
  buildReadinessBlockedCheckpoint,
  buildWorkbenchCheckpointResume,
  buildWorkbenchHumanCheckpoint,
  clearWorkbenchCheckpointAnnotations,
  commitWorkbenchCheckpointAnnotations,
  hashWorkbenchContent,
  recoverWorkbenchCheckpointAnnotations,
  resolveWorkbenchCheckpointAnnotation,
} from '../../workbench/human-checkpoint.js';
import { markdownDiagnostics } from './model.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function subjectFromMarkdownState(state = {}) {
  const source = state.source && typeof state.source === 'object'
    ? state.source
    : { kind: 'file', path: state.path };
  return {
    type: source.kind === 'wiki' ? 'wiki.page' : 'markdown.document',
    subject_type: source.kind === 'wiki' ? 'wiki.page' : 'markdown.document',
    path: text(source.path || state.path, 'untitled.md'),
    source,
    label: text(state.subject?.label || state.path, 'Markdown document'),
  };
}

export function buildMarkdownWorkbenchCheckpoint({
  state,
  canvasId = 'markdown-workbench',
  launchStatus = 'launched',
  readiness = { status: 'ready', command: './aos ready' },
  checkpointId,
  expectedHumanAction = 'Edit the opened Markdown Workbench surface, then reply when done.',
  resumeCondition = 'Human replies that Markdown edits are complete.',
  createdBy = 'agent',
  metadata = {},
} = {}) {
  const content = String(state?.content ?? '');
  return buildWorkbenchHumanCheckpoint({
    checkpointId,
    status: launchStatus === 'attached' ? 'attached' : 'launched',
    subject: subjectFromMarkdownState(state),
    canvasId,
    launchStatus,
    initialContent: content,
    initialDiagnostics: state?.diagnostics || markdownDiagnostics(content),
    readiness,
    expectedHumanAction,
    resumeCondition,
    createdBy,
    metadata: {
      adapter: 'markdown-workbench',
      initial_hash: hashWorkbenchContent(content),
      ...metadata,
    },
  });
}

export function buildMarkdownReadinessBlockedCheckpoint({
  target,
  readiness,
  createdBy = 'agent',
  metadata = {},
} = {}) {
  return buildReadinessBlockedCheckpoint({
    subject: {
      type: String(target || '').startsWith('wiki:') ? 'wiki.page' : 'markdown.document',
      subject_type: String(target || '').startsWith('wiki:') ? 'wiki.page' : 'markdown.document',
      path: String(target || 'untitled.md').replace(/^wiki:/, ''),
      source: String(target || '').startsWith('wiki:')
        ? { kind: 'wiki', path: String(target).replace(/^wiki:/, '') }
        : { kind: 'file', path: String(target || 'untitled.md') },
    },
    readiness,
    createdBy,
    metadata: {
      adapter: 'markdown-workbench',
      ...metadata,
    },
  });
}

export function buildMarkdownLaunchFailedCheckpoint({
  target,
  readiness = { status: 'ready', command: './aos ready' },
  launchStatus = 'failed',
  initialContent = '',
  initialDiagnostics = {},
  createdBy = 'agent',
  metadata = {},
} = {}) {
  const targetText = String(target || 'untitled.md');
  const wiki = targetText.startsWith('wiki:');
  const subjectPath = targetText.replace(/^wiki:/, '');
  return buildWorkbenchHumanCheckpoint({
    status: 'aborted',
    launchStatus,
    subject: {
      type: wiki ? 'wiki.page' : 'markdown.document',
      subject_type: wiki ? 'wiki.page' : 'markdown.document',
      path: subjectPath,
      source: wiki ? { kind: 'wiki', path: subjectPath } : { kind: 'file', path: subjectPath },
      label: text(subjectPath.split('/').pop(), subjectPath),
    },
    canvasId: null,
    initialContent,
    initialDiagnostics,
    readiness,
    expectedHumanAction: 'Review the launch failure and rerun checkpoint start after repair.',
    resumeCondition: 'Markdown Workbench launch succeeds.',
    createdBy,
    metadata: {
      adapter: 'markdown-workbench',
      launch_failed: true,
      ...metadata,
    },
  });
}

export function resumeMarkdownWorkbenchCheckpoint({
  checkpoint,
  state,
  saveBehavior = 'draft',
  saveResult = null,
  resumedBy = 'agent',
  metadata = {},
} = {}) {
  const content = String(state?.content ?? '');
  return buildWorkbenchCheckpointResume({
    checkpoint,
    currentContent: content,
    currentDiagnostics: state?.diagnostics || markdownDiagnostics(content),
    saveBehavior,
    saveResult,
    resumedBy,
    metadata: {
      adapter: 'markdown-workbench',
      dirty: Boolean(state?.dirty),
      path: state?.path || checkpoint?.subject?.path,
      ...metadata,
    },
  });
}

export function addMarkdownWorkbenchAnnotation(checkpoint, annotation) {
  return addWorkbenchCheckpointAnnotation(checkpoint, annotation);
}

export function commitMarkdownWorkbenchAnnotations(checkpoint) {
  return commitWorkbenchCheckpointAnnotations(checkpoint);
}

export function clearMarkdownWorkbenchAnnotations(checkpoint, options) {
  return clearWorkbenchCheckpointAnnotations(checkpoint, options);
}

export function recoverMarkdownWorkbenchAnnotations(checkpoint, annotations) {
  return recoverWorkbenchCheckpointAnnotations(checkpoint, annotations);
}

export function resolveMarkdownWorkbenchAnnotation(checkpoint, annotationId, status = 'resolved') {
  return resolveWorkbenchCheckpointAnnotation(checkpoint, annotationId, status);
}

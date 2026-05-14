import crypto from 'node:crypto';

export const WORKBENCH_HUMAN_CHECKPOINT_SCHEMA_VERSION = '2026-05-09';
export const WORKBENCH_HUMAN_CHECKPOINT_TYPE = 'aos.workbench_human_checkpoint';

const CHECKPOINT_STATUSES = new Set([
  'blocked_readiness',
  'launched',
  'attached',
  'resumed',
  'saved',
  'draft',
  'aborted',
]);

const SAVE_BEHAVIORS = new Set(['save', 'draft', 'abort']);
const ANNOTATION_KINDS = new Set([
  'point_comment',
  'region_comment',
  'element_selection',
  'selection_comment',
]);
const ANNOTATION_STATUSES = new Set(['draft', 'committed', 'resolved', 'rejected']);
const COORDINATE_SPACES = new Set(['viewport', 'page', 'document', 'lcs', 'desktop_world', 'unknown']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function nowIso(value = undefined) {
  if (value) return new Date(value).toISOString();
  return new Date().toISOString();
}

function stableId(prefix = 'checkpoint') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizePoint(point = undefined) {
  if (!point || typeof point !== 'object') return null;
  const x = numberOrUndefined(point.x);
  const y = numberOrUndefined(point.y);
  if (x === undefined || y === undefined) return null;
  return { x, y };
}

function normalizeBounds(bounds = undefined) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = numberOrUndefined(bounds.x);
  const y = numberOrUndefined(bounds.y);
  const width = numberOrUndefined(bounds.width);
  const height = numberOrUndefined(bounds.height);
  if ([x, y, width, height].some((value) => value === undefined)) return null;
  return { x, y, width, height };
}

function stringArray(value = undefined) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

export function hashWorkbenchContent(content = '') {
  return `sha256:${crypto.createHash('sha256').update(String(content ?? '')).digest('hex')}`;
}

function lineCount(content = '') {
  const source = String(content ?? '');
  return source ? source.split('\n').length : 0;
}

function headingTexts(diagnostics = {}) {
  return Array.isArray(diagnostics.headings)
    ? diagnostics.headings.map((heading) => text(heading.text)).filter(Boolean)
    : [];
}

function normalizeSubject(subject = {}) {
  const path = text(subject.path || subject.source?.path || subject.id);
  const subjectType = text(subject.subject_type || subject.type, 'markdown.document');
  if (!path) throw new TypeError('checkpoint subject requires a path or id');
  return {
    type: text(subject.type, subjectType),
    subject_type: subjectType,
    path,
    source: subject.source ? cloneJson(subject.source) : { kind: 'file', path },
    label: text(subject.label, path.split('/').pop() || path),
  };
}

function normalizeReadiness(readiness = {}) {
  const status = readiness.status === 'ready' ? 'ready' : readiness.status === 'skipped_explicit' ? 'skipped_explicit' : 'blocked';
  return {
    status,
    command: text(readiness.command),
    exit_code: Number.isInteger(readiness.exit_code) ? readiness.exit_code : null,
    diagnostics: readiness.diagnostics ? cloneJson(readiness.diagnostics) : {},
    repair_instructions: Array.isArray(readiness.repair_instructions)
      ? readiness.repair_instructions.map((item) => text(item)).filter(Boolean)
      : [],
  };
}

function legacyAnchorToIntent(annotation = {}, subjectPath = '') {
  if (!annotation.anchor_type) return annotation;
  const anchorType = annotation.anchor_type;
  const anchorValue = annotation.anchor_value;
  const next = {
    ...annotation,
    kind: anchorType === 'line' || anchorType === 'line_range' ? 'selection_comment' : 'element_selection',
    source_path: text(annotation.subject_path || annotation.path || subjectPath),
    surface_id: text(annotation.surface_id, 'markdown-workbench'),
    coordinate_space: 'document',
    actor: annotation.actor || annotation.author || {
      role: text(annotation.author_role, 'agent'),
      id: text(annotation.author_id, 'unknown'),
    },
    status: annotation.status === 'open' ? 'committed' : annotation.status,
    text_excerpt: text(annotation.text_excerpt || annotation.excerpt),
  };
  if (anchorType === 'line') {
    next.text_range = { start_line: integer(anchorValue, 1), end_line: integer(anchorValue, 1) };
  } else if (anchorType === 'line_range' && anchorValue && typeof anchorValue === 'object') {
    next.text_range = {
      start_line: integer(anchorValue.start_line ?? anchorValue.start, 1),
      end_line: integer(anchorValue.end_line ?? anchorValue.end, integer(anchorValue.start_line ?? anchorValue.start, 1)),
    };
  } else if (anchorType === 'selection') {
    next.text_range = anchorValue && typeof anchorValue === 'object' ? cloneJson(anchorValue) : null;
  }
  return next;
}

export function normalizeWorkbenchAnnotation(annotation = {}, context = {}) {
  const subjectPath = text(context.subjectPath || context.subject_path);
  const surfaceId = text(context.surfaceId || context.surface_id || annotation.surface_id, 'markdown-workbench');
  const input = legacyAnchorToIntent(annotation, subjectPath);
  const status = ANNOTATION_STATUSES.has(input.status) ? input.status : 'committed';
  const kind = ANNOTATION_KINDS.has(input.kind) ? input.kind : (
    normalizeBounds(input.bounds || input.viewport_bounds || input.page_bounds) ? 'region_comment' : 'point_comment'
  );
  const note = text(input.note || input.comment);
  const now = nowIso(input.updated_at || input.created_at);
  const sourcePath = text(input.source_path || input.subject_path || input.path || subjectPath);
  const sourceUrl = text(input.source_url || input.url);
  if (!sourcePath && !sourceUrl) throw new TypeError('checkpoint annotation requires source_path or source_url');
  if (!note && !text(input.label)) throw new TypeError('checkpoint annotation requires a note or label');

  const point = normalizePoint(input.point || input.anchor_point);
  const viewportBounds = normalizeBounds(input.viewport_bounds || input.viewport);
  const pageBounds = normalizeBounds(input.page_bounds || input.page);
  const bounds = normalizeBounds(input.bounds || viewportBounds || pageBounds);

  return {
    id: text(input.id, stableId('annotation')),
    ordinal: Math.max(1, integer(input.ordinal ?? input.index, context.nextOrdinal || 1)),
    kind,
    surface_id: surfaceId,
    source_url: sourceUrl || null,
    source_path: sourcePath || null,
    coordinate_space: COORDINATE_SPACES.has(input.coordinate_space) ? input.coordinate_space : 'viewport',
    point,
    bounds,
    viewport_bounds: viewportBounds,
    page_bounds: pageBounds,
    selector_candidates: stringArray(input.selector_candidates || input.selectors || (input.selector ? [input.selector] : [])),
    text_excerpt: text(input.text_excerpt || input.excerpt),
    text_range: input.text_range === undefined ? null : cloneJson(input.text_range),
    role: text(input.role),
    label: text(input.label),
    ancestor_chain: stringArray(input.ancestor_chain || input.ancestorChain),
    note,
    actor: {
      role: text(input.actor?.role || input.actor?.type || input.author?.role || input.author_role, 'agent'),
      id: text(input.actor?.id || input.author?.id || input.author_id, 'unknown'),
    },
    status,
    lifecycle: {
      clearable: input.lifecycle?.clearable !== false,
      committed_at: status === 'committed' || status === 'resolved' || status === 'rejected'
        ? nowIso(input.lifecycle?.committed_at || input.committed_at || input.created_at)
        : null,
      resolved_at: status === 'resolved' ? nowIso(input.lifecycle?.resolved_at || input.resolved_at || input.updated_at || input.created_at) : null,
      rejected_at: status === 'rejected' ? nowIso(input.lifecycle?.rejected_at || input.rejected_at || input.updated_at || input.created_at) : null,
      recovered_from: text(input.lifecycle?.recovered_from || input.recovered_from) || null,
    },
    capture: {
      prepare: input.capture?.prepare ? cloneJson(input.capture.prepare) : {
        hide_annotation_controls: true,
        keep_target_evidence_visible: true,
      },
      restore: input.capture?.restore ? cloneJson(input.capture.restore) : {
        restore_annotation_controls: true,
      },
    },
    created_at: nowIso(input.created_at),
    updated_at: now,
    metadata: input.metadata ? cloneJson(input.metadata) : {},
  };
}

export const normalizeWorkbenchAnnotationIntent = normalizeWorkbenchAnnotation;

function normalizeWorkbenchAnnotations(annotations = [], context = {}) {
  let nextOrdinal = 1;
  return (Array.isArray(annotations) ? annotations : []).map((annotation) => {
    const normalized = normalizeWorkbenchAnnotation(annotation, {
      ...context,
      nextOrdinal,
    });
    nextOrdinal = Math.max(nextOrdinal + 1, normalized.ordinal + 1);
    return normalized;
  });
}

export function addWorkbenchCheckpointAnnotation(checkpoint = {}, annotation = {}) {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  const nextOrdinal = normalized.annotations.reduce((max, item) => Math.max(max, integer(item.ordinal, 0)), 0) + 1;
  return {
    ...normalized,
    annotations: [
      ...normalized.annotations,
      normalizeWorkbenchAnnotation({
        source_path: normalized.subject.path,
        surface_id: normalized.canvas_id || 'markdown-workbench',
        ...annotation,
      }, {
        subjectPath: normalized.subject.path,
        surfaceId: normalized.canvas_id || 'markdown-workbench',
        nextOrdinal,
      }),
    ],
  };
}

export function resolveWorkbenchCheckpointAnnotation(checkpoint = {}, annotationId = '', status = 'resolved') {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  const nextStatus = ANNOTATION_STATUSES.has(status) ? status : 'resolved';
  const updatedAt = nowIso();
  return {
    ...normalized,
    annotations: normalized.annotations.map((annotation) => (
      annotation.id === annotationId
        ? normalizeWorkbenchAnnotation({
          ...annotation,
          status: nextStatus,
          updated_at: updatedAt,
        }, {
          subjectPath: normalized.subject.path,
          surfaceId: normalized.canvas_id || annotation.surface_id,
          nextOrdinal: annotation.ordinal,
        })
        : annotation
    )),
  };
}

export function commitWorkbenchCheckpointAnnotations(checkpoint = {}) {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  return {
    ...normalized,
    annotations: normalized.annotations.map((annotation) => (
      annotation.status === 'draft'
        ? normalizeWorkbenchAnnotation({ ...annotation, status: 'committed', updated_at: nowIso() }, {
          subjectPath: normalized.subject.path,
          surfaceId: normalized.canvas_id || annotation.surface_id,
          nextOrdinal: annotation.ordinal,
        })
        : annotation
    )),
  };
}

export function clearWorkbenchCheckpointAnnotations(checkpoint = {}, { actor = 'agent', reason = '' } = {}) {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  return {
    ...normalized,
    annotations: [],
    metadata: {
      ...normalized.metadata,
      annotation_clear: {
        actor: text(actor, 'agent'),
        reason: text(reason),
        cleared_at: nowIso(),
        count: normalized.annotations.length,
      },
    },
  };
}

export function recoverWorkbenchCheckpointAnnotations(checkpoint = {}, annotations = []) {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  const recovered = normalizeWorkbenchAnnotations(annotations, {
    subjectPath: normalized.subject.path,
    surfaceId: normalized.canvas_id || 'markdown-workbench',
  }).map((annotation) => normalizeWorkbenchAnnotation({
    ...annotation,
    lifecycle: {
      ...annotation.lifecycle,
      recovered_from: normalized.checkpoint_id,
    },
  }, {
    subjectPath: normalized.subject.path,
    surfaceId: normalized.canvas_id || annotation.surface_id,
    nextOrdinal: annotation.ordinal,
  }));
  return {
    ...normalized,
    annotations: recovered,
  };
}

export function buildWorkbenchHumanCheckpoint({
  checkpointId,
  status = 'launched',
  subject,
  canvasId = 'markdown-workbench',
  launchStatus = status,
  initialContent = '',
  initialDiagnostics = {},
  readiness = { status: 'ready', command: './aos ready' },
  expectedHumanAction = 'Edit the opened workbench surface, then reply when done.',
  resumeCondition = 'Human replies that editing is complete.',
  createdAt,
  createdBy = 'agent',
  annotations = [],
  metadata = {},
} = {}) {
  if (!CHECKPOINT_STATUSES.has(status)) throw new TypeError(`unsupported checkpoint status: ${status}`);
  const normalizedSubject = normalizeSubject(subject);
  const content = String(initialContent ?? '');
  return normalizeWorkbenchHumanCheckpoint({
    type: WORKBENCH_HUMAN_CHECKPOINT_TYPE,
    schema_version: WORKBENCH_HUMAN_CHECKPOINT_SCHEMA_VERSION,
    checkpoint_id: text(checkpointId, stableId('workbench-checkpoint')),
    status,
    subject: normalizedSubject,
    canvas_id: status === 'blocked_readiness' || canvasId === null ? null : text(canvasId, 'markdown-workbench'),
    launch_status: text(launchStatus, status),
    readiness: normalizeReadiness(readiness),
    initial: {
      content_hash: hashWorkbenchContent(content),
      content,
      diagnostics: cloneJson(initialDiagnostics) || {},
    },
    handoff: {
      expected_human_action: text(expectedHumanAction),
      resume_condition: text(resumeCondition),
      instructions: `${text(expectedHumanAction)} Resume condition: ${text(resumeCondition)} Checkpoint: ${text(checkpointId, '') || 'recorded'}.`,
    },
    resume: null,
    annotations: normalizeWorkbenchAnnotations(annotations, {
      subjectPath: normalizedSubject.path,
      surfaceId: status === 'blocked_readiness' ? 'markdown-workbench' : text(canvasId, 'markdown-workbench'),
    }),
    created_at: nowIso(createdAt),
    created_by: text(createdBy, 'agent'),
    metadata: cloneJson(metadata) || {},
  });
}

export function buildReadinessBlockedCheckpoint({
  subject,
  readiness,
  expectedHumanAction = 'Repair AOS readiness, then rerun the checkpoint start command.',
  resumeCondition = 'AOS readiness passes.',
  createdBy = 'agent',
  metadata = {},
} = {}) {
  return buildWorkbenchHumanCheckpoint({
    status: 'blocked_readiness',
    launchStatus: 'not_launched',
    subject,
    canvasId: null,
    initialContent: '',
    initialDiagnostics: {},
    readiness,
    expectedHumanAction,
    resumeCondition,
    createdBy,
    metadata,
  });
}

export function normalizeWorkbenchHumanCheckpoint(checkpoint = {}) {
  if (checkpoint.type !== WORKBENCH_HUMAN_CHECKPOINT_TYPE) {
    throw new TypeError(`checkpoint type must be ${WORKBENCH_HUMAN_CHECKPOINT_TYPE}`);
  }
  if (checkpoint.schema_version !== WORKBENCH_HUMAN_CHECKPOINT_SCHEMA_VERSION) {
    throw new TypeError(`checkpoint schema_version must be ${WORKBENCH_HUMAN_CHECKPOINT_SCHEMA_VERSION}`);
  }
  if (!CHECKPOINT_STATUSES.has(checkpoint.status)) {
    throw new TypeError(`unsupported checkpoint status: ${checkpoint.status}`);
  }
  const subject = normalizeSubject(checkpoint.subject);
  const annotations = Array.isArray(checkpoint.annotations)
    ? normalizeWorkbenchAnnotations(checkpoint.annotations, {
      subjectPath: subject.path,
      surfaceId: checkpoint.canvas_id || 'markdown-workbench',
    })
    : [];
  return {
    ...cloneJson(checkpoint),
    checkpoint_id: text(checkpoint.checkpoint_id, stableId('workbench-checkpoint')),
    subject,
    canvas_id: checkpoint.canvas_id === null ? null : text(checkpoint.canvas_id, 'markdown-workbench'),
    launch_status: text(checkpoint.launch_status, checkpoint.status),
    readiness: normalizeReadiness(checkpoint.readiness),
    initial: {
      content_hash: text(checkpoint.initial?.content_hash),
      content: String(checkpoint.initial?.content ?? ''),
      diagnostics: checkpoint.initial?.diagnostics ? cloneJson(checkpoint.initial.diagnostics) : {},
    },
    handoff: {
      expected_human_action: text(checkpoint.handoff?.expected_human_action),
      resume_condition: text(checkpoint.handoff?.resume_condition),
      instructions: text(checkpoint.handoff?.instructions),
    },
    resume: checkpoint.resume ? cloneJson(checkpoint.resume) : null,
    annotations,
    created_at: nowIso(checkpoint.created_at),
    created_by: text(checkpoint.created_by, 'agent'),
    metadata: checkpoint.metadata ? cloneJson(checkpoint.metadata) : {},
  };
}

export function validateWorkbenchHumanCheckpoint(checkpoint = {}) {
  normalizeWorkbenchHumanCheckpoint(checkpoint);
  return true;
}

function unifiedSnippet(before = '', after = '', context = 3) {
  const oldLines = String(before ?? '').split('\n');
  const newLines = String(after ?? '').split('\n');
  if (String(before ?? '') === String(after ?? '')) return '';
  const max = Math.max(oldLines.length, newLines.length);
  let first = 0;
  while (first < max && oldLines[first] === newLines[first]) first += 1;
  let lastOld = oldLines.length - 1;
  let lastNew = newLines.length - 1;
  while (lastOld >= first && lastNew >= first && oldLines[lastOld] === newLines[lastNew]) {
    lastOld -= 1;
    lastNew -= 1;
  }
  const start = Math.max(0, first - context);
  const endOld = Math.min(oldLines.length - 1, lastOld + context);
  const endNew = Math.min(newLines.length - 1, lastNew + context);
  const lines = [`@@ -${start + 1},${Math.max(0, endOld - start + 1)} +${start + 1},${Math.max(0, endNew - start + 1)} @@`];
  for (let i = start; i <= Math.max(endOld, endNew); i += 1) {
    if (i <= endOld && i <= endNew && oldLines[i] === newLines[i]) {
      lines.push(` ${oldLines[i]}`);
    } else {
      if (i <= endOld) lines.push(`-${oldLines[i] ?? ''}`);
      if (i <= endNew) lines.push(`+${newLines[i] ?? ''}`);
    }
  }
  return lines.slice(0, 80).join('\n');
}

export function summarizeWorkbenchDiff({
  beforeContent = '',
  afterContent = '',
  beforeDiagnostics = {},
  afterDiagnostics = {},
  includeUnifiedDiff = true,
} = {}) {
  const beforeHash = hashWorkbenchContent(beforeContent);
  const afterHash = hashWorkbenchContent(afterContent);
  const beforeHeadings = headingTexts(beforeDiagnostics);
  const afterHeadings = headingTexts(afterDiagnostics);
  const changed = beforeHash !== afterHash;
  return {
    changed,
    before_hash: beforeHash,
    after_hash: afterHash,
    line_count_delta: lineCount(afterContent) - lineCount(beforeContent),
    heading_count_delta: afterHeadings.length - beforeHeadings.length,
    heading_delta: {
      added: afterHeadings.filter((heading) => !beforeHeadings.includes(heading)),
      removed: beforeHeadings.filter((heading) => !afterHeadings.includes(heading)),
    },
    diagnostic_delta: {
      line_count: Number(afterDiagnostics.line_count ?? lineCount(afterContent)) - Number(beforeDiagnostics.line_count ?? lineCount(beforeContent)),
      word_count: Number(afterDiagnostics.word_count ?? 0) - Number(beforeDiagnostics.word_count ?? 0),
      heading_count: Number(afterDiagnostics.heading_count ?? afterHeadings.length) - Number(beforeDiagnostics.heading_count ?? beforeHeadings.length),
      mermaid_block_count: (afterDiagnostics.mermaid_blocks || []).length - (beforeDiagnostics.mermaid_blocks || []).length,
      unclosed_fence_changed: Boolean(afterDiagnostics.unclosed_fence) !== Boolean(beforeDiagnostics.unclosed_fence),
    },
    unified_diff_snippet: includeUnifiedDiff && changed ? unifiedSnippet(beforeContent, afterContent) : '',
  };
}

export function buildWorkbenchCheckpointResume({
  checkpoint,
  currentContent = '',
  currentDiagnostics = {},
  saveBehavior = 'draft',
  saveResult = null,
  resumedAt,
  resumedBy = 'agent',
  metadata = {},
} = {}) {
  const normalized = normalizeWorkbenchHumanCheckpoint(checkpoint);
  const behavior = SAVE_BEHAVIORS.has(saveBehavior) ? saveBehavior : 'draft';
  const diff = summarizeWorkbenchDiff({
    beforeContent: normalized.initial.content,
    afterContent: currentContent,
    beforeDiagnostics: normalized.initial.diagnostics,
    afterDiagnostics: currentDiagnostics,
  });
  const status = behavior === 'save'
    ? (saveResult?.status === 'saved' ? 'saved' : 'resumed')
    : behavior === 'abort'
      ? 'aborted'
      : 'draft';
  const committedAnnotations = normalized.annotations.filter((annotation) => (
    annotation.status === 'committed' || annotation.status === 'resolved' || annotation.status === 'rejected'
  ));
  return normalizeWorkbenchHumanCheckpoint({
    ...normalized,
    status,
    resume: {
      behavior,
      resumed_at: nowIso(resumedAt),
      resumed_by: text(resumedBy, 'agent'),
      current_content_hash: hashWorkbenchContent(currentContent),
      current_diagnostics: cloneJson(currentDiagnostics) || {},
      diff_summary: diff,
      save_result: saveResult ? cloneJson(saveResult) : null,
      annotations: cloneJson(committedAnnotations),
      metadata: {
        committed_annotation_count: committedAnnotations.length,
        ...cloneJson(metadata),
      },
    },
  });
}

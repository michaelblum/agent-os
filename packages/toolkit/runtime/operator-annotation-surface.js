export const OPERATOR_ANNOTATION_SURFACE_STATES = Object.freeze([
  'idle',
  'selecting',
  'committing',
  'committed',
  'cancelled',
  'failed',
])

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function normalizeTarget(input = {}) {
  const target = input.target && typeof input.target === 'object' ? input.target : {}
  const kind = text(target.kind || input.kind || input.target_kind)
  const summary = text(target.summary || input.summary || input.target_summary)
  const savedRef = target.saved_ref || input.saved_ref || null
  if (!kind && !summary && !savedRef) return null
  if (!kind || !summary) return null
  return { kind, summary, saved_ref: savedRef }
}

function fallbackTarget(fallbackEvidence = [], sourceCapture = null) {
  const explicit = fallbackEvidence.find((item) => item && typeof item === 'object')
  if (explicit) {
    const kind = text(explicit.kind)
    const summary = text(explicit.summary)
    if (kind && summary) return { kind, summary, saved_ref: null }
  }
  if (sourceCapture && typeof sourceCapture === 'object') {
    const kind = text(sourceCapture.target_kind || sourceCapture.kind, 'source_capture')
    const summary = text(sourceCapture.target_summary || sourceCapture.summary || sourceCapture.capture_target)
    if (kind && summary) return { kind, summary, saved_ref: null }
  }
  return null
}

function annotationInputFromState(state, options = {}) {
  const fallbackEvidence = Array.isArray(options.fallback_evidence)
    ? options.fallback_evidence
    : (Array.isArray(state.fallback_evidence) ? state.fallback_evidence : [])
  const sourceCapture = options.source_capture || state.source_capture || null
  const targetInput = options.target || state.target || options || state || {}
  const target = normalizeTarget(targetInput)
    || fallbackTarget(fallbackEvidence, sourceCapture)
  if (!target) return null
  return {
    source: 'operator_annotation_surface',
    comment: text(options.comment, state.comment) || null,
    target_kind: target?.kind,
    target_summary: target?.summary,
    saved_ref: target?.saved_ref || null,
    capability: options.capability || state.capability || undefined,
    fallback_evidence: fallbackEvidence,
    artifact_refs: Array.isArray(options.artifact_refs) ? options.artifact_refs : (state.artifact_refs || []),
    recommended_next: Array.isArray(options.recommended_next) ? options.recommended_next : (state.recommended_next || undefined),
    source_capture: sourceCapture,
  }
}

export function createOperatorAnnotationSurface(options = {}) {
  const createPendingAnnotation = options.createPendingAnnotation
  let state = {
    status: 'idle',
    started_at: null,
    updated_at: null,
    comment: '',
    target: null,
    capability: null,
    fallback_evidence: [],
    artifact_refs: [],
    recommended_next: null,
    source_capture: null,
    result: null,
    error: null,
  }

  const now = () => (typeof options.now === 'function' ? options.now() : new Date().toISOString())
  const update = (patch) => {
    state = {
      ...state,
      ...patch,
      updated_at: now(),
    }
    return snapshot()
  }
  const snapshot = () => clone(state)

  function start(input = {}) {
    return update({
      status: 'selecting',
      started_at: now(),
      comment: text(input.comment),
      target: normalizeTarget(input),
      capability: input.capability || null,
      fallback_evidence: Array.isArray(input.fallback_evidence) ? input.fallback_evidence : [],
      artifact_refs: Array.isArray(input.artifact_refs) ? input.artifact_refs : [],
      recommended_next: Array.isArray(input.recommended_next) ? input.recommended_next : null,
      source_capture: input.source_capture || null,
      result: null,
      error: null,
    })
  }

  function updateComment(comment) {
    if (state.status !== 'selecting') return snapshot()
    return update({ comment: text(comment) })
  }

  async function commit(input = {}) {
    if (state.status !== 'selecting') {
      return update({
        status: 'failed',
        error: {
          code: 'OPERATOR_ANNOTATION_NOT_SELECTING',
          message: 'Operator annotation surface is not selecting.',
        },
      })
    }
    if (typeof createPendingAnnotation !== 'function') {
      return update({
        status: 'failed',
        error: {
          code: 'OPERATOR_ANNOTATION_CREATE_MISSING',
          message: 'No pending annotation create adapter is installed.',
        },
      })
    }
    update({ status: 'committing', error: null })
    try {
      const annotationInput = annotationInputFromState(state, input)
      if (!annotationInput) {
        return update({
          status: 'failed',
          error: {
            code: 'OPERATOR_ANNOTATION_TARGET_REQUIRED',
            message: 'Operator annotation target evidence is required before commit.',
          },
        })
      }
      const result = await createPendingAnnotation(annotationInput)
      return update({
        status: 'committed',
        result: {
          id: result?.annotation?.id || result?.id || null,
          path: result?.annotation?.path || result?.path || null,
          raw: result || null,
        },
      })
    } catch (error) {
      return update({
        status: 'failed',
        error: {
          code: error?.code || 'OPERATOR_ANNOTATION_CREATE_FAILED',
          message: error?.message || String(error),
        },
      })
    }
  }

  function cancel(reason = 'operator_cancelled') {
    return update({
      status: 'cancelled',
      error: null,
      result: {
        reason: text(reason, 'operator_cancelled'),
      },
    })
  }

  function handleMessage(message = {}) {
    if (message?.type === 'aos.operator_annotation.start') {
      return start(message)
    }
    if (message?.type === 'aos.operator_annotation.cancel') {
      return cancel(message.reason)
    }
    return snapshot()
  }

  return {
    start,
    updateComment,
    commit,
    cancel,
    handleMessage,
    snapshot,
  }
}

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

function array(value) {
  return Array.isArray(value) ? value : []
}

function normalizeTarget(input = {}) {
  const target = input.target && typeof input.target === 'object' ? input.target : {}
  const kind = text(target.kind || input.kind || input.targetKind)
  const summary = text(target.summary || input.summary || input.targetSummary)
  const savedRef = target.savedRef || input.savedRef || null
  if (!kind && !summary && !savedRef) return null
  if (!kind || !summary) return null
  return { kind, summary, savedRef }
}

function normalizeEvidence(input = {}) {
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {}
  return {
    fallback: array(evidence.fallback || input.fallback),
    artifacts: array(evidence.artifacts || input.artifacts),
    next: array(evidence.next || input.next),
    sourceCapture: evidence.sourceCapture || input.sourceCapture || null,
  }
}

function targetFromEvidence(evidence) {
  const fallback = evidence.fallback.find((item) => item && typeof item === 'object')
  if (fallback) {
    const kind = text(fallback.kind)
    const summary = text(fallback.summary)
    if (kind && summary) return { kind, summary, savedRef: null }
  }
  if (evidence.sourceCapture && typeof evidence.sourceCapture === 'object') {
    const kind = text(evidence.sourceCapture.targetKind || evidence.sourceCapture.kind, 'capture')
    const summary = text(evidence.sourceCapture.targetSummary || evidence.sourceCapture.summary || evidence.sourceCapture.captureTarget)
    if (kind && summary) return { kind, summary, savedRef: null }
  }
  return null
}

function selectionFromState(state, options = {}) {
  const optionEvidence = options.evidence && typeof options.evidence === 'object' ? options.evidence : {}
  const evidence = normalizeEvidence({
    evidence: {
      fallback: optionEvidence.fallback ?? options.fallback ?? state.evidence.fallback,
      artifacts: optionEvidence.artifacts ?? options.artifacts ?? state.evidence.artifacts,
      next: optionEvidence.next ?? options.next ?? state.evidence.next,
      sourceCapture: optionEvidence.sourceCapture ?? options.sourceCapture ?? state.evidence.sourceCapture,
    },
  })
  const target = normalizeTarget(options) || state.target || targetFromEvidence(evidence)
  if (!target) return null
  return {
    origin: 'operator_annotation_surface',
    comment: text(options.comment, state.comment) || null,
    target,
    readiness: options.readiness || state.readiness || null,
    evidence,
  }
}

export function createOperatorAnnotationSurface(options = {}) {
  const createAnnotation = options.createAnnotation
  let state = {
    status: 'idle',
    started_at: null,
    updated_at: null,
    comment: '',
    target: null,
    readiness: null,
    evidence: {
      fallback: [],
      artifacts: [],
      next: [],
      sourceCapture: null,
    },
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
      readiness: input.readiness || null,
      evidence: normalizeEvidence(input),
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
    if (typeof createAnnotation !== 'function') {
      return update({
        status: 'failed',
        error: {
          code: 'OPERATOR_ANNOTATION_CREATE_MISSING',
          message: 'No operator annotation create adapter is installed.',
        },
      })
    }
    update({ status: 'committing', error: null })
    try {
      const selection = selectionFromState(state, input)
      if (!selection) {
        return update({
          status: 'failed',
          error: {
            code: 'OPERATOR_ANNOTATION_TARGET_REQUIRED',
            message: 'Operator annotation target evidence is required before commit.',
          },
        })
      }
      const result = await createAnnotation(selection)
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

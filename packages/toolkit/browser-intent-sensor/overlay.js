import { canonicalizeBrowserMark, canonicalizeBrowserAnnotation } from './canonicalize.js'
import { containedDescriptors, descriptorFromElement } from './dom-crawl.js'

export function createBrowserIntentSensor(options = {}) {
  const doc = options.document ?? globalThis.document
  if (!doc) throw new Error('browser intent sensor requires a document')

  const state = {
    mode: 'select',
    marks: [],
    onEvent: options.onEvent ?? (() => {}),
    session_id: options.session_id ?? 'unknown',
    browser_session: options.browser_session ?? options.session_id ?? 'unknown',
  }

  async function emitMark(rawMark) {
    const mark = await canonicalizeBrowserMark({
      session_id: state.session_id,
      browser_session: state.browser_session,
      url: doc.location?.href ?? 'about:blank',
      title: doc.title ?? '',
      ...rawMark,
    }, options)
    state.marks.push(mark)
    state.onEvent(mark)
    return mark
  }

  return {
    setMode(mode) {
      if (!['select', 'region', 'comment'].includes(mode)) throw new Error(`unsupported intent mode: ${mode}`)
      state.mode = mode
      return state.mode
    },
    mode() {
      return state.mode
    },
    async markElement(element, extra = {}) {
      const descriptor = descriptorFromElement(element, options)
      return emitMark({
        kind: 'element',
        descriptor,
        rect: descriptor?.rect,
        ...extra,
      })
    },
    async markRegion(rect, extra = {}) {
      return emitMark({
        kind: 'region',
        rect,
        descriptor: { rect },
        contained_elements: containedDescriptors(doc, rect, options),
        ...extra,
      })
    },
    async comment(markId, note, extra = {}) {
      const annotation = canonicalizeBrowserAnnotation({
        session_id: state.session_id,
        mark_id: markId,
        note,
        ...extra,
      }, options)
      state.onEvent(annotation)
      return annotation
    },
    snapshot() {
      return { mode: state.mode, marks: [...state.marks] }
    },
    uninstall() {
      state.marks = []
      return true
    },
  }
}

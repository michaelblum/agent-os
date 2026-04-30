import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js'

const SURFACE = 'wiki-kb'

function refPart(part) {
  return String(part || 'unknown').replace(/\s+/g, '-')
}

export function wikiKBAosRef(...parts) {
  return [SURFACE, ...parts].map(refPart).join(':')
}

export function applyWikiKBSemanticTarget(element, target = {}, options = {}) {
  if (!element) return null

  const preserveContent = options.preserveContent ?? !options.visibleLabel
  const canPreserveNodes = preserveContent &&
    typeof element.replaceChildren === 'function' &&
    element.childNodes
  const preservedNodes = canPreserveNodes ? [...element.childNodes] : null
  const preservedText = preserveContent && !preservedNodes ? element.textContent : null
  const normalized = applySemanticTargetAttributes(element, {
    role: 'AXButton',
    ...target,
    surface: SURFACE,
    aosRef: target.aosRef || wikiKBAosRef(target.id),
  }, {
    idPrefix: null,
    ...options,
    visibleLabel: options.visibleLabel ?? false,
  })

  if (preservedNodes) element.replaceChildren(...preservedNodes)
  else if (preserveContent) element.textContent = preservedText
  return normalized
}

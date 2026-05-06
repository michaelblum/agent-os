import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js';
import { WIKI_SUBJECT_BROWSER_SURFACE } from './model.js';

function refPart(part) {
  return String(part || 'unknown').replace(/\s+/g, '-');
}

export function wikiSubjectBrowserAosRef(...parts) {
  return [WIKI_SUBJECT_BROWSER_SURFACE, ...parts].map(refPart).join(':');
}

export function applyWikiSubjectBrowserSemanticTarget(element, target = {}) {
  if (!element) return null;
  return applySemanticTargetAttributes(element, {
    role: 'AXGroup',
    surface: WIKI_SUBJECT_BROWSER_SURFACE,
    aosRef: target.aosRef || wikiSubjectBrowserAosRef(target.id),
    ...target,
  }, {
    idPrefix: null,
  });
}

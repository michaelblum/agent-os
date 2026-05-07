export const SUBJECT_ENTRY_HANDLE_TYPE = 'aos.subject_entry_handle';
export const SUBJECT_ENTRY_HANDLE_SCHEMA_VERSION = '2026-05-07-subject-entry-handle-v0';

const FACET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function partsFromInput(facetOrParts = {}, subjectId = '') {
  if (typeof facetOrParts === 'string') {
    return {
      facet_key: text(facetOrParts),
      subject_id: text(subjectId),
    };
  }
  const value = objectValue(facetOrParts);
  return {
    facet_key: text(value.facet_key || value.facetKey || value.key),
    subject_id: text(value.subject_id || value.subjectId || value.id),
  };
}

export function parseSubjectEntryHandle(handle = '') {
  const normalized = text(handle);
  if (!normalized) return null;

  const separator = normalized.indexOf(':');
  if (separator <= 0 || separator >= normalized.length - 1) return null;

  const facetKey = normalized.slice(0, separator);
  const subjectId = normalized.slice(separator + 1).trim();
  if (!FACET_KEY_PATTERN.test(facetKey) || !subjectId) return null;

  return {
    type: SUBJECT_ENTRY_HANDLE_TYPE,
    schema_version: SUBJECT_ENTRY_HANDLE_SCHEMA_VERSION,
    handle: `${facetKey}:${subjectId}`,
    facet_key: facetKey,
    subject_id: subjectId,
  };
}

export function isSubjectEntryHandle(handle = '') {
  return parseSubjectEntryHandle(handle) !== null;
}

export function normalizeSubjectEntryHandle(handle = '') {
  return parseSubjectEntryHandle(handle)?.handle || '';
}

export function subjectEntryHandleFacetKey(handle = '') {
  return parseSubjectEntryHandle(handle)?.facet_key || '';
}

export function subjectEntryHandleSubjectId(handle = '') {
  return parseSubjectEntryHandle(handle)?.subject_id || '';
}

export function formatSubjectEntryHandle(facetOrParts = {}, subjectId = '') {
  const parts = partsFromInput(facetOrParts, subjectId);
  if (!parts.facet_key || !parts.subject_id) return '';
  return normalizeSubjectEntryHandle(`${parts.facet_key}:${parts.subject_id}`);
}

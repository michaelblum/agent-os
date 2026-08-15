import { executeManagedSessionOperation } from '../browser-companion/session-lifecycle.mjs';

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeBrowserIdentity(value, session) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pageUrl = nullableText(value.page_url);
  const frameUrl = nullableText(value.frame_url ?? pageUrl);
  const topFrameUrl = nullableText(value.top_frame_url ?? pageUrl);
  return {
    session,
    page_url: pageUrl,
    frame_url: frameUrl,
    top_frame_url: topFrameUrl,
    document_title: nullableText(value.document_title),
  };
}

export async function queryBrowserPageIdentity(session, env = process.env, options = {}) {
  try {
    const response = await executeManagedSessionOperation(session, 'page_identity', {}, { ...options, env });
    const identity = normalizeBrowserIdentity(response.worker.result, session);
    return identity ? { status: 'available', ...identity } : { status: 'unavailable', reason: 'identity_shape_invalid', session };
  } catch (error) {
    return { status: 'unavailable', reason: error?.code ?? 'managed_browser_query_failed', session };
  }
}

export function browserIdentityComparable(identity) {
  if (!identity || identity.status === 'unavailable') return null;
  return {
    session: nullableText(identity.session),
    page_url: nullableText(identity.page_url),
    frame_url: nullableText(identity.frame_url),
    top_frame_url: nullableText(identity.top_frame_url),
    document_title: nullableText(identity.document_title),
  };
}

export function browserIdentityComplete(identity) {
  const comparable = browserIdentityComparable(identity);
  return Boolean(comparable?.session && comparable.page_url && comparable.frame_url && comparable.top_frame_url);
}

import { spawnSync } from 'node:child_process';

const BROWSER_IDENTITY_SCRIPT = `() => {
  const href = String(window.location && window.location.href || '');
  let topFrameUrl = href;
  try {
    topFrameUrl = String(window.top && window.top.location && window.top.location.href || href);
  } catch {
    topFrameUrl = null;
  }
  return {
    schema: 'aos.agent-workspace.browser-identity.v0',
    marker: '__aos_agent_workspace_browser_identity',
    page_url: href || null,
    frame_url: href || null,
    top_frame_url: topFrameUrl || null,
    document_title: String(document.title || '') || null
  };
}`;

function detectPlaywrightErrorMarker(stdout) {
  const index = String(stdout || '').indexOf('### Error');
  if (index < 0) return null;
  const after = String(stdout || '').slice(index + '### Error'.length).trim();
  const next = after.indexOf('\n### ');
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function parsePlaywrightResultBody(stdout) {
  if (detectPlaywrightErrorMarker(stdout)) return null;
  const trimmed = String(stdout || '').trim();
  const index = trimmed.indexOf('### Result');
  if (index < 0) return trimmed;
  const after = trimmed.slice(index + '### Result'.length).trim();
  const next = after.indexOf('\n### ');
  return next >= 0 ? after.slice(0, next) : after;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeBrowserIdentity(value, session) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pageUrl = nullableText(value.page_url ?? value.url ?? value.active_url ?? value.source_url);
  const frameUrl = nullableText(value.frame_url ?? value.current_frame_url ?? pageUrl);
  const topFrameUrl = nullableText(value.top_frame_url ?? value.top_url ?? pageUrl);
  return {
    session,
    page_url: pageUrl,
    frame_url: frameUrl,
    top_frame_url: topFrameUrl,
    document_title: nullableText(value.document_title ?? value.title),
  };
}

export function queryBrowserPageIdentity(session, env = process.env) {
  const result = spawnSync('/usr/bin/env', ['playwright-cli', `-s=${session}`, 'eval', BROWSER_IDENTITY_SCRIPT], {
    encoding: 'utf8',
    env,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return {
      status: 'unavailable',
      reason: 'playwright_eval_failed',
      session,
      stderr: result.stderr || null,
    };
  }
  const body = parsePlaywrightResultBody(result.stdout || '');
  if (body === null) {
    return {
      status: 'unavailable',
      reason: 'playwright_eval_error',
      session,
      stderr: result.stderr || null,
    };
  }
  try {
    const parsed = JSON.parse(body);
    const identity = normalizeBrowserIdentity(parsed, session);
    if (!identity) {
      return { status: 'unavailable', reason: 'identity_shape_invalid', session };
    }
    return { status: 'available', ...identity };
  } catch {
    return { status: 'unavailable', reason: 'identity_json_invalid', session };
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
  return Boolean(
    comparable?.session
    && comparable.page_url
    && comparable.frame_url
    && comparable.top_frame_url,
  );
}

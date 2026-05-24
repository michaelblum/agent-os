import { listProviderSessions } from '../../../host/src/session-catalog.ts';
import { buildSessionInspector } from './session-inspector-server.mjs';

const ACCEPTED_PROVIDERS = new Set(['codex', 'claude-code']);

function envValue(env, name, fallback) {
  const value = env[name];
  if (value !== undefined && value !== '') return value;
  return fallback;
}

function acceptedProviders(searchParams) {
  const providers = searchParams
    .getAll('provider')
    .filter((provider) => ACCEPTED_PROVIDERS.has(provider));
  return providers.length ? providers : undefined;
}

function catalogQueryForUrl(url, options = {}) {
  const env = options.env || process.env;
  const explicitCwd = url.searchParams.get('cwd');
  const allCwd = url.searchParams.get('all_cwd') === 'true';
  const cwd = allCwd ? undefined : (explicitCwd || options.defaultCwd);
  return {
    catalogOptions: {
      homeDir: envValue(env, 'AGENT_TERMINAL_CATALOG_HOME', undefined),
      codexRoot: envValue(env, 'AGENT_TERMINAL_CODEX_ROOT', undefined),
      claudeRoot: envValue(env, 'AGENT_TERMINAL_CLAUDE_ROOT', undefined),
      cwd,
      providers: acceptedProviders(url.searchParams),
    },
    scope: allCwd ? 'all_cwd' : 'cwd',
    cwd_filter: cwd ?? null,
  };
}

export function providerSessionsResponseForUrl(url, options = {}) {
  const query = catalogQueryForUrl(url, options);
  return {
    sessions: listProviderSessions(query.catalogOptions),
    scope: query.scope,
    cwd_filter: query.cwd_filter,
  };
}

export function providerSessionRecordsForUrl(url, options = {}) {
  return providerSessionsResponseForUrl(url, options).sessions;
}

export function sessionInspectorResponseForUrl(url, options = {}) {
  const provider = url.searchParams.get('provider');
  const sessionId = url.searchParams.get('session_id');
  if (!provider || !sessionId) {
    return {
      status: 400,
      contentType: 'text',
      body: 'provider and session_id are required',
    };
  }

  const record = providerSessionRecordsForUrl(url, options).find((candidate) => (
    candidate.provider === provider && candidate.session_id === sessionId
  ));
  if (!record) {
    return {
      status: 404,
      contentType: 'text',
      body: `session not found: ${provider}:${sessionId}`,
    };
  }

  return {
    status: 200,
    contentType: 'json',
    body: buildSessionInspector(record),
  };
}

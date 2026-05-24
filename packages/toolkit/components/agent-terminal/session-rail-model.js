export function providerLabel(provider) {
  return provider === 'claude-code' ? 'Claude' : 'Codex';
}

export function workspaceBasename(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath || 'workspace';
}

export function shortSessionId(id) {
  return String(id || '').slice(0, 8);
}

export function sessionSortTimestamp(record, sortMode = 'last-message') {
  if (sortMode === 'created') {
    return record?.created_at || record?.updated_at || record?.last_message_at;
  }
  return record?.last_message_at || record?.updated_at || record?.created_at;
}

export function sessionsMatch(a, b) {
  return Boolean(a && b && a.provider === b.provider && a.session_id === b.session_id);
}

export function compareSessionsForRail(a, b, { sortMode = 'last-message' } = {}) {
  const at = Date.parse(sessionSortTimestamp(a, sortMode) || '') || 0;
  const bt = Date.parse(sessionSortTimestamp(b, sortMode) || '') || 0;
  const recency = bt - at;
  if (recency !== 0) return recency;
  const provider = String(a?.provider || '').localeCompare(String(b?.provider || ''));
  if (provider !== 0) return provider;
  return String(a?.session_id || '').localeCompare(String(b?.session_id || ''));
}

export function sortSessionsForRail(records, { sortMode = 'last-message' } = {}) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => (
    compareSessionsForRail(a, b, { sortMode })
  ));
}

export function findMatchingSession(records, selectedSession) {
  if (!selectedSession) return null;
  return (Array.isArray(records) ? records : []).find((record) => (
    sessionsMatch(record, selectedSession)
  )) || null;
}

export function createSessionRailRowModel(record, {
  selectedSession = null,
  sortMode = 'last-message',
  formatTime = defaultFormatTime,
} = {}) {
  const provider = record?.provider || '';
  const providerText = providerLabel(provider);
  const workspaceLabel = workspaceBasename(record?.cwd);
  const timestamp = sessionSortTimestamp(record, sortMode);
  const timeText = formatTime(timestamp);
  const metadataText = [record?.branch, timeText].filter(Boolean).join(' / ');
  const sessionId = record?.session_id || '';

  return {
    record,
    provider,
    providerLabel: providerText,
    workspaceLabel,
    metadataText,
    shortId: shortSessionId(sessionId),
    ariaLabel: `Resume ${providerText} session ${sessionId} in ${record?.cwd || ''}`,
    selected: sessionsMatch(record, selectedSession),
    resumeLabel: `${providerText} ${workspaceLabel}`,
    sortTimestamp: timestamp || '',
  };
}

export function createSessionRailModel(records, {
  selectedSession = null,
  sortMode = 'last-message',
  formatTime = defaultFormatTime,
} = {}) {
  return sortSessionsForRail(records, { sortMode }).map((record) => (
    createSessionRailRowModel(record, { selectedSession, sortMode, formatTime })
  ));
}

function defaultFormatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

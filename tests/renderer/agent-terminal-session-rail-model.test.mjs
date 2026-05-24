import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  compareSessionsForRail,
  createSessionRailModel,
  createSessionRailRowModel,
  findMatchingSession,
  providerLabel,
  sessionSortTimestamp,
  sessionsMatch,
  shortSessionId,
  sortSessionsForRail,
  workspaceBasename,
} from '../../packages/toolkit/components/agent-terminal/session-rail-model.js'

const time = (minute) => `2026-05-23T12:${String(minute).padStart(2, '0')}:00.000Z`

test('formats provider labels, workspace basenames, and short session ids', () => {
  assert.equal(providerLabel('codex'), 'Codex')
  assert.equal(providerLabel('claude-code'), 'Claude')
  assert.equal(providerLabel('unknown-provider'), 'Codex')
  assert.equal(workspaceBasename('/Users/Michael/Code/agent-os'), 'agent-os')
  assert.equal(workspaceBasename('/tmp/project/'), 'project')
  assert.equal(workspaceBasename(''), 'workspace')
  assert.equal(shortSessionId('abcdef123456'), 'abcdef12')
})

test('selects sort timestamps with existing last-message and created semantics', () => {
  const record = {
    created_at: time(1),
    updated_at: time(2),
    last_message_at: time(3),
  }
  assert.equal(sessionSortTimestamp(record, 'last-message'), time(3))
  assert.equal(sessionSortTimestamp(record, 'created'), time(1))
  assert.equal(
    sessionSortTimestamp({ updated_at: time(4), created_at: time(1) }, 'last-message'),
    time(4),
  )
  assert.equal(
    sessionSortTimestamp({ updated_at: time(4), last_message_at: time(5) }, 'created'),
    time(4),
  )
})

test('sorts sessions by selected timestamp, then provider, then session id', () => {
  const records = [
    { provider: 'codex', session_id: 'b', cwd: '/repo/b', last_message_at: time(1), created_at: time(9) },
    { provider: 'claude-code', session_id: 'c', cwd: '/repo/c', last_message_at: time(3), created_at: time(7) },
    { provider: 'codex', session_id: 'a', cwd: '/repo/a', last_message_at: time(3), created_at: time(8) },
    { provider: 'codex', session_id: 'd', cwd: '/repo/d', last_message_at: time(3), created_at: time(6) },
  ]

  assert.deepEqual(
    sortSessionsForRail(records, { sortMode: 'last-message' }).map((record) => record.session_id),
    ['c', 'a', 'd', 'b'],
  )
  assert.deepEqual(
    sortSessionsForRail(records, { sortMode: 'created' }).map((record) => record.session_id),
    ['b', 'a', 'c', 'd'],
  )
  assert.equal(compareSessionsForRail(records[2], records[3], { sortMode: 'last-message' }) < 0, true)
})

test('matches selected sessions by provider and session id only', () => {
  const selected = { provider: 'codex', session_id: 'abc', cwd: '/old' }
  const replacement = { provider: 'codex', session_id: 'abc', cwd: '/new' }
  const differentProvider = { provider: 'claude-code', session_id: 'abc', cwd: '/new' }
  assert.equal(sessionsMatch(replacement, selected), true)
  assert.equal(sessionsMatch(differentProvider, selected), false)
  assert.equal(findMatchingSession([differentProvider, replacement], selected), replacement)
  assert.equal(findMatchingSession([differentProvider], selected), null)
})

test('creates row view models needed by the DOM renderer', () => {
  const record = {
    provider: 'claude-code',
    session_id: 'claude-session-123',
    cwd: '/Users/Michael/Code/agent-os',
    branch: 'main',
    created_at: time(1),
    last_message_at: time(8),
  }

  const row = createSessionRailRowModel(record, {
    selectedSession: { provider: 'claude-code', session_id: 'claude-session-123' },
    sortMode: 'last-message',
    formatTime: (value) => `formatted ${value}`,
  })

  assert.deepEqual(row, {
    record,
    provider: 'claude-code',
    providerLabel: 'Claude',
    workspaceLabel: 'agent-os',
    metadataText: `main / formatted ${time(8)}`,
    shortId: 'claude-s',
    ariaLabel: 'Resume Claude session claude-session-123 in /Users/Michael/Code/agent-os',
    selected: true,
    resumeLabel: 'Claude agent-os',
    sortTimestamp: time(8),
  })
})

test('creates ordered row models for the session rail', () => {
  const rows = createSessionRailModel([
    { provider: 'codex', session_id: 'older', cwd: '/repo/older', last_message_at: time(1) },
    { provider: 'codex', session_id: 'newer', cwd: '/repo/newer', last_message_at: time(2) },
  ], {
    selectedSession: { provider: 'codex', session_id: 'newer' },
    formatTime: () => '',
  })

  assert.deepEqual(rows.map((row) => row.shortId), ['newer', 'older'])
  assert.deepEqual(rows.map((row) => row.selected), [true, false])
})

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listProviderSessions,
  scanClaudeCodeSessions,
  scanCodexSessions,
} from '../src/session-catalog.ts';

const CODEX_SESSION_ID = '019de3a9-2b0b-79f2-bb17-79dfb2c7a706';
const CLAUDE_SESSION_ID = 'fe9076b7-449c-46fd-8572-0ca0f79bf07a';

describe('provider session catalog', () => {
  let root: string;
  let homeDir: string;
  let repoCwd: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-session-catalog-'));
    homeDir = path.join(root, 'home');
    repoCwd = path.join(root, 'work', 'agent-os');
    fs.mkdirSync(repoCwd, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers Codex rollout and archived sessions from configurable roots', () => {
    const activeFile = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '05',
      '01',
      `rollout-2026-05-01T09-10-08-${CODEX_SESSION_ID}.jsonl`,
    );
    writeJsonl(activeFile, [
      {
        timestamp: '2026-05-01T13:10:37.580Z',
        type: 'session_meta',
        payload: {
          id: CODEX_SESSION_ID,
          cwd: repoCwd,
          git: { branch: 'codex/provider-session-catalog' },
        },
      },
      {
        timestamp: '2026-05-01T13:10:38.000Z',
        type: 'response_item',
        payload: { type: 'message', content: 'not catalog metadata' },
      },
    ]);
    touch(activeFile, '2026-05-01T14:00:00.000Z');

    const archivedId = '019d0e9b-f2e0-7101-94ff-007f14573560';
    const archivedFile = path.join(
      homeDir,
      '.codex',
      'archived_sessions',
      `rollout-2026-03-21T00-16-34-${archivedId}.jsonl`,
    );
    writeJsonl(archivedFile, [
      {
        timestamp: '2026-03-21T04:16:52.954Z',
        type: 'session_meta',
        payload: { id: archivedId, cwd: repoCwd, git: { branch: 'main' } },
      },
    ]);
    touch(archivedFile, '2026-03-21T05:00:00.000Z');

    const sessions = scanCodexSessions({ homeDir });

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].session_id, CODEX_SESSION_ID);
    assert.deepEqual(sessions[0], {
      provider: 'codex',
      session_id: CODEX_SESSION_ID,
      cwd: repoCwd,
      branch: 'codex/provider-session-catalog',
      created_at: '2026-05-01T13:10:37.580Z',
      last_message_at: '2026-05-01T13:10:38.000Z',
      updated_at: '2026-05-01T13:10:38.000Z',
      source_file: activeFile,
      resume_command: ['codex', '--no-alt-screen', 'resume', CODEX_SESSION_ID],
    });
    assert.equal(sessions[1].session_id, archivedId);
  });

  it('discovers Claude Code project JSONL and live metadata sessions', () => {
    const projectFile = path.join(
      homeDir,
      '.claude',
      'projects',
      '-tmp-work-agent-os',
      `${CLAUDE_SESSION_ID}.jsonl`,
    );
    writeJsonl(projectFile, [
      { type: 'permission-mode', sessionId: CLAUDE_SESSION_ID },
      {
        type: 'user',
        uuid: '241f991d-1195-43ff-893f-948307bef527',
        timestamp: '2026-04-13T16:58:34.648Z',
        sessionId: CLAUDE_SESSION_ID,
        cwd: repoCwd,
        gitBranch: 'main',
        message: { role: 'user', content: 'not catalog metadata' },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-13T16:59:02.000Z',
        sessionId: CLAUDE_SESSION_ID,
        cwd: repoCwd,
        gitBranch: 'main',
        message: { role: 'assistant', content: 'not catalog metadata' },
      },
    ]);
    touch(projectFile, '2026-04-13T17:00:00.000Z');

    const liveId = 'beaf34fd-c714-4cd5-97f6-b41909d032f3';
    const liveFile = path.join(homeDir, '.claude', 'sessions', '16990.json');
    writeJson(liveFile, {
      pid: 16990,
      sessionId: liveId,
      cwd: repoCwd,
      status: 'running',
      startedAt: Date.parse('2026-05-01T21:40:00.000Z'),
      updatedAt: Date.parse('2026-05-01T21:43:46.057Z'),
    });

    const sessions = scanClaudeCodeSessions({ homeDir });

    assert.deepEqual(
      sessions.map((session) => session.session_id),
      [liveId, CLAUDE_SESSION_ID],
    );
    assert.deepEqual(sessions[0], {
      provider: 'claude-code',
      session_id: liveId,
      cwd: repoCwd,
      created_at: '2026-05-01T21:40:00.000Z',
      last_message_at: '2026-05-01T21:43:46.057Z',
      updated_at: '2026-05-01T21:43:46.057Z',
      source_file: liveFile,
      resume_command: ['claude', '--resume', liveId],
    });
    assert.deepEqual(sessions[1], {
      provider: 'claude-code',
      session_id: CLAUDE_SESSION_ID,
      cwd: repoCwd,
      branch: 'main',
      created_at: '2026-04-13T16:58:34.648Z',
      last_message_at: '2026-04-13T16:59:02.000Z',
      updated_at: '2026-04-13T16:59:02.000Z',
      source_file: projectFile,
      resume_command: ['claude', '--resume', CLAUDE_SESSION_ID],
    });
  });

  it('filters sessions to the requested workspace and sorts by recency', () => {
    const otherCwd = path.join(root, 'work', 'other');
    fs.mkdirSync(otherCwd, { recursive: true });

    writeCodexFixture(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', `rollout-2026-05-01T10-00-00-${CODEX_SESSION_ID}.jsonl`),
      CODEX_SESSION_ID,
      repoCwd,
      '2026-05-01T20:00:00.000Z',
    );
    writeCodexFixture(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', 'rollout-2026-05-01T11-00-00-other-codex.jsonl'),
      'other-codex',
      otherCwd,
      '2026-05-01T21:00:00.000Z',
    );

    const childCwd = path.join(repoCwd, 'packages', 'host');
    fs.mkdirSync(childCwd, { recursive: true });
    writeJsonl(
      path.join(homeDir, '.claude', 'projects', '-tmp-work-agent-os-packages-host', `${CLAUDE_SESSION_ID}.jsonl`),
      [{ type: 'user', sessionId: CLAUDE_SESSION_ID, cwd: childCwd, gitBranch: 'main' }],
    );

    const claudeFile = path.join(homeDir, '.claude', 'projects', '-tmp-work-agent-os-packages-host', `${CLAUDE_SESSION_ID}.jsonl`);
    touch(claudeFile, '2026-05-01T22:00:00.000Z');

    const sessions = listProviderSessions({ homeDir, cwd: repoCwd });

    assert.deepEqual(
      sessions.map((session) => `${session.provider}:${session.session_id}`),
      [`claude-code:${CLAUDE_SESSION_ID}`, `codex:${CODEX_SESSION_ID}`],
    );
  });

  it('treats provider format drift as a soft per-record failure', () => {
    writeText(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', 'rollout-2026-05-01T12-00-00-bad.jsonl'),
      '{"timestamp":"2026-05-01T12:00:00Z","type":"session_meta","payload":',
    );
    writeText(
      path.join(homeDir, '.claude', 'projects', '-tmp-work-agent-os', 'bad.jsonl'),
      '{"type":"user","sessionId":',
    );
    writeText(
      path.join(homeDir, '.claude', 'sessions', 'bad.json'),
      '{"sessionId":',
    );

    assert.deepEqual(listProviderSessions({ homeDir }), []);
  });
});

function writeCodexFixture(file: string, sessionId: string, cwd: string, mtime: string): void {
  writeJsonl(file, [
    {
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd,
        git: { branch: 'main' },
      },
    },
  ]);
  touch(file, mtime);
}

function writeJsonl(file: string, records: unknown[]): void {
  writeText(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function writeJson(file: string, value: unknown): void {
  writeText(file, JSON.stringify(value));
}

function writeText(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

function touch(file: string, iso: string): void {
  const date = new Date(iso);
  fs.utimesSync(file, date, date);
}

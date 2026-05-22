import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  correlateLaunch,
  emitThreadReference,
  getThreadInfo,
  listCandidateThreads,
  resolveProviderSessionId,
} from '../src/codex-thread-adapter.ts';

const SESSION_ID = '019e6000-0000-7000-8000-000000000001';
const PREFIX_MATCH_ID = '019e6000-0000-7000-8000-000000000002';
const PREFIX_AMBIGUOUS_ID = '019e6000-0000-7000-8000-000000000003';

describe('Codex thread adapter', () => {
  let root: string;
  let codexHome: string;
  let repoCwd: string;
  let childCwd: string;
  let otherCwd: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-codex-thread-adapter-'));
    codexHome = path.join(root, 'fixture-codex-home');
    repoCwd = path.join(root, 'work', 'agent-os');
    childCwd = path.join(repoCwd, 'packages', 'host');
    otherCwd = path.join(root, 'work', 'other');
    fs.mkdirSync(childCwd, { recursive: true });
    fs.mkdirSync(otherCwd, { recursive: true });
    writeJson(path.join(codexHome, '.codex-global-state.json'), {
      'thread-titles': {
        titles: {
          [SESSION_ID]: 'Adapter implementation',
          [PREFIX_MATCH_ID]: 'Nested host work',
          [PREFIX_AMBIGUOUS_ID]: 'Ambiguous prefix sibling',
        },
        order: [],
      },
      'pinned-thread-ids': [],
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves an exact provider session id to a Codex thread', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');

    const result = resolveProviderSessionId({ codexHome, providerSessionId: SESSION_ID });

    assert.equal(result.status, 'ok');
    assert.equal(result.provider_session_id, SESSION_ID);
    assert.equal(result.thread?.thread_id, SESSION_ID);
    assert.equal(result.thread?.cwd, repoCwd);
    assert.equal(result.thread?.deeplink, `codex://threads/${SESSION_ID}`);
    assert.ok(result.evidence_refs.some((ref) => ref.kind === 'codex_session_meta'));
  });

  it('resolves a unique prefix and returns ambiguous for ambiguous prefixes', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');
    writeCodexSession(codexHome, PREFIX_MATCH_ID, repoCwd, '2026-05-22T14:01:00.000Z');
    writeCodexSession(codexHome, PREFIX_AMBIGUOUS_ID, repoCwd, '2026-05-22T14:02:00.000Z');

    const unique = getThreadInfo({ codexHome, threadIdOrPrefix: `${SESSION_ID.slice(0, -1)}1` });
    const ambiguous = getThreadInfo({ codexHome, threadIdOrPrefix: '019e6000-0000-7000-8000' });

    assert.equal(unique.status, 'ok');
    assert.equal(unique.thread?.thread_id, SESSION_ID);
    assert.equal(ambiguous.status, 'ambiguous');
    assert.equal(ambiguous.matches?.length, 3);
  });

  it('lists project/cwd candidates with normalized descendant matching and deterministic recency sorting', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');
    writeCodexSession(codexHome, PREFIX_MATCH_ID, childCwd, '2026-05-22T14:10:00.000Z');
    writeCodexSession(codexHome, '019e6000-0000-7000-8000-000000000099', otherCwd, '2026-05-22T14:20:00.000Z');

    const result = listCandidateThreads({ codexHome, projectPath: `${repoCwd}${path.sep}` });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.threads.map((thread) => thread.thread_id), [PREFIX_MATCH_ID, SESSION_ID]);
    assert.deepEqual(result.threads.map((thread) => thread.normalized_cwd), [childCwd, repoCwd]);
  });

  it('filters cwd candidates by launch time window', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');
    writeCodexSession(codexHome, PREFIX_MATCH_ID, repoCwd, '2026-05-22T14:10:00.000Z');

    const result = listCandidateThreads({
      codexHome,
      cwd: repoCwd,
      timeWindow: {
        after: '2026-05-22T14:05:00.000Z',
        before: '2026-05-22T14:15:00.000Z',
      },
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.threads.map((thread) => thread.thread_id), [PREFIX_MATCH_ID]);
  });

  it('correlates an exact provider session id only when cwd matches', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: SESSION_ID,
      intendedCwd: repoCwd,
      bridgeVisibility: {
        command_argv: ['codex', '--no-alt-screen'],
        terminal_substrate: { driver: 'process', session_handle: 'fixture-session' },
      },
    });

    assert.equal(result.status, 'matched_by_provider_session_id');
    assert.equal(result.confidence, 'exact');
    assert.equal(result.thread?.thread_id, SESSION_ID);
    assert.equal(result.mismatches.length, 0);
  });

  it('returns wrong_cwd when an observed provider session id resolves outside the intended cwd', () => {
    writeCodexSession(codexHome, SESSION_ID, otherCwd, '2026-05-22T14:00:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: SESSION_ID,
      intendedCwd: repoCwd,
    });

    assert.equal(result.status, 'wrong_cwd');
    assert.equal(result.confidence, 'none');
    assert.equal(result.mismatches[0].code, 'wrong_cwd');
    assert.equal(result.mismatches[0].expected, repoCwd);
    assert.equal(result.mismatches[0].observed, otherCwd);
  });

  it('matches an observed provider session id when Codex reports the explicit workspace root', () => {
    const dockCwd = path.join(repoCwd, '.docks', 'gdi');
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: SESSION_ID,
      intendedCwd: dockCwd,
      workspaceRoot: repoCwd,
    });

    assert.equal(result.status, 'matched_by_provider_session_id');
    assert.equal(result.cwd_match_basis, 'workspace_root');
    assert.equal(result.thread?.thread_id, SESSION_ID);
    assert.deepEqual(result.mismatches, []);
  });

  it('keeps wrong_cwd protection when a thread is outside intended cwd and workspace root', () => {
    const dockCwd = path.join(repoCwd, '.docks', 'gdi');
    writeCodexSession(codexHome, SESSION_ID, otherCwd, '2026-05-22T14:00:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: SESSION_ID,
      intendedCwd: dockCwd,
      workspaceRoot: repoCwd,
    });

    assert.equal(result.status, 'wrong_cwd');
    assert.equal(result.cwd_match_basis, 'not_observed');
    assert.match(result.mismatches[0].expected ?? '', /intended_launch_cwd:/);
    assert.match(result.mismatches[0].expected ?? '', /workspace_root:/);
  });

  it('keeps wrong_cwd protection when only workspace root is supplied for provider id correlation', () => {
    writeCodexSession(codexHome, SESSION_ID, otherCwd, '2026-05-22T14:00:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: SESSION_ID,
      workspaceRoot: repoCwd,
    });

    assert.equal(result.status, 'wrong_cwd');
    assert.equal(result.confidence, 'none');
    assert.equal(result.cwd_match_basis, 'not_observed');
    assert.equal(result.thread?.thread_id, SESSION_ID);
    assert.equal(result.mismatches[0].code, 'wrong_cwd');
    assert.equal(result.mismatches[0].expected, repoCwd);
    assert.equal(result.mismatches[0].observed, otherCwd);
  });

  it('preserves provider_session_id_not_observed when terminal substrate exists without a provider id', () => {
    const result = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: repoCwd,
      bridgeVisibility: {
        command_argv: ['codex', '--no-alt-screen'],
        terminal_substrate: { driver: 'process', session_handle: 'afk-bridge-fixture' },
      },
      timeWindow: {
        after: '2026-05-22T14:00:00.000Z',
        before: '2026-05-22T14:05:00.000Z',
      },
    });

    assert.equal(result.status, 'not_observed');
    assert.equal(result.mismatches[0].code, 'provider_session_id_not_observed');
    assert.ok(result.evidence_refs.some((ref) => ref.ref === 'bridge-session:afk-bridge-fixture'));
  });

  it('correlates one cwd/time candidate and reports multiple candidates when the window is ambiguous', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:01:00.000Z');
    writeCodexSession(codexHome, PREFIX_MATCH_ID, repoCwd, '2026-05-22T14:03:00.000Z');

    const one = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: repoCwd,
      timeWindow: {
        after: '2026-05-22T14:00:00.000Z',
        before: '2026-05-22T14:02:00.000Z',
      },
    });
    const multiple = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: repoCwd,
      timeWindow: {
        after: '2026-05-22T14:00:00.000Z',
        before: '2026-05-22T14:05:00.000Z',
      },
    });

    assert.equal(one.status, 'matched_by_cwd_time_window');
    assert.equal(one.confidence, 'strong');
    assert.equal(one.thread?.thread_id, SESSION_ID);
    assert.equal(multiple.status, 'multiple_candidates');
    assert.deepEqual(multiple.candidate_threads.map((thread) => thread.thread_id), [PREFIX_MATCH_ID, SESSION_ID]);
  });

  it('uses explicit workspace root for cwd/time fallback without binding cwd alone', () => {
    const dockCwd = path.join(repoCwd, '.docks', 'gdi');
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:01:00.000Z');

    const matched = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: dockCwd,
      workspaceRoot: repoCwd,
      timeWindow: {
        after: '2026-05-22T14:00:00.000Z',
        before: '2026-05-22T14:02:00.000Z',
      },
    });
    const noWindow = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: dockCwd,
      workspaceRoot: repoCwd,
    });

    assert.equal(matched.status, 'matched_by_cwd_time_window');
    assert.equal(matched.cwd_match_basis, 'workspace_root');
    assert.equal(matched.thread?.thread_id, SESSION_ID);
    assert.equal(noWindow.status, 'not_observed');
    assert.equal(noWindow.thread, undefined);
  });

  it('does not bind a single same-cwd thread when provider id is not observed and no time window exists', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:01:00.000Z');

    const result = correlateLaunch({
      codexHome,
      providerSessionId: 'not_observed',
      intendedCwd: repoCwd,
      bridgeVisibility: {
        command_argv: ['codex', '--no-alt-screen'],
        terminal_substrate: { driver: 'process', session_handle: 'afk-bridge-fixture' },
      },
    });

    assert.equal(result.status, 'not_observed');
    assert.equal(result.confidence, 'none');
    assert.equal(result.thread, undefined);
    assert.equal(result.candidate_threads.length, 0);
    assert.equal(result.mismatches[0].code, 'provider_session_id_not_observed');
  });

  it('emits stable Codex deeplink and local evidence refs', () => {
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:00:00.000Z');

    const result = emitThreadReference({ codexHome, threadIdOrPrefix: SESSION_ID, format: 'json' });

    assert.equal(result.status, 'ok');
    assert.equal(result.thread_id, SESSION_ID);
    assert.equal(result.deeplink, `codex://threads/${SESSION_ID}`);
    assert.equal(result.local_ref, `codex-thread:${SESSION_ID}`);
    assert.ok(result.evidence_refs.some((ref) => ref.kind === 'codex_deeplink'));
  });

  it('treats missing and malformed metadata as soft failures with diagnostics', () => {
    writeText(
      path.join(codexHome, 'sessions', '2026', '05', '22', 'rollout-2026-05-22T14-00-00-bad.jsonl'),
      '{"timestamp":"2026-05-22T14:00:00.000Z","type":"session_meta","payload":',
    );
    writeCodexSession(codexHome, SESSION_ID, repoCwd, '2026-05-22T14:01:00.000Z');

    const result = listCandidateThreads({ codexHome, cwd: repoCwd });

    assert.equal(result.status, 'partial_index');
    assert.deepEqual(result.threads.map((thread) => thread.thread_id), [SESSION_ID]);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'codex_session_meta_incomplete'));
  });

  it('uses an explicit fixture codexHome and reports missing explicit roots without reading real home state', () => {
    const missingCodexHome = path.join(root, 'missing-codex-home');

    const result = listCandidateThreads({ codexHome: missingCodexHome, cwd: repoCwd });

    assert.equal(result.status, 'codex_home_not_found');
    assert.equal(result.threads.length, 0);
    assert.equal(result.diagnostics[0].source_ref, undefined);
    assert.match(result.diagnostics[0].message, /missing-codex-home/);
  });
});

function writeCodexSession(codexHome: string, sessionId: string, cwd: string, timestamp: string): string {
  const file = path.join(
    codexHome,
    'sessions',
    '2026',
    '05',
    '22',
    `rollout-${timestamp.slice(0, 19).replaceAll(':', '-')}-${sessionId}.jsonl`,
  );
  writeJsonl(file, [
    {
      timestamp,
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd,
        timestamp,
        git: { branch: 'main' },
      },
    },
    {
      timestamp: new Date(Date.parse(timestamp) + 1000).toISOString(),
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: 'body text must not be needed' },
    },
  ]);
  touch(file, timestamp);
  return file;
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

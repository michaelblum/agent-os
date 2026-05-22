import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CodexThreadEvidenceKind =
  | 'codex_global_state'
  | 'codex_session_meta'
  | 'codex_rollout_file'
  | 'codex_deeplink'
  | 'bridge_visibility'
  | 'catalog_record'
  | 'fixture';

export interface CodexAdapterEvidenceRef {
  kind: CodexThreadEvidenceKind;
  ref: string;
  observed_at?: string;
}

export interface CodexThreadRef {
  provider: 'codex';
  thread_id: string;
  cwd: string;
  normalized_cwd: string;
  title: string | 'not_observed';
  timestamp: string;
  archived: boolean;
  source_ref: string;
  deeplink: string;
}

export interface CodexAdapterDiagnostic {
  code: string;
  message: string;
  source_ref?: string;
}

export interface CodexThreadAdapterInput {
  codexHome?: string;
  includeArchived?: boolean;
  maxJsonlMetadataLines?: number;
  maxJsonlMetadataBytes?: number;
}

export interface CodexTimeWindow {
  after?: string;
  before?: string;
}

export interface ListCandidateThreadsInput extends CodexThreadAdapterInput {
  projectPath?: string;
  cwd?: string;
  timeWindow?: CodexTimeWindow;
  limit?: number;
}

export interface ListCandidateThreadsResult {
  status: 'ok' | 'codex_home_not_found' | 'project_path_invalid' | 'metadata_unreadable' | 'partial_index';
  threads: CodexThreadRef[];
  evidence_refs: CodexAdapterEvidenceRef[];
  diagnostics: CodexAdapterDiagnostic[];
}

export interface GetThreadInfoInput extends CodexThreadAdapterInput {
  threadIdOrPrefix: string;
}

export interface GetThreadInfoResult {
  status: 'ok' | 'not_found' | 'ambiguous' | 'metadata_unreadable';
  thread?: CodexThreadRef;
  matches?: CodexThreadRef[];
  evidence_refs: CodexAdapterEvidenceRef[];
  diagnostics: CodexAdapterDiagnostic[];
}

export interface ResolveProviderSessionIdInput extends CodexThreadAdapterInput {
  providerSessionId: string;
}

export interface ResolveProviderSessionIdResult {
  status: 'ok' | 'not_found' | 'ambiguous' | 'metadata_unreadable';
  provider_session_id: string;
  thread?: CodexThreadRef;
  matches?: CodexThreadRef[];
  evidence_refs: CodexAdapterEvidenceRef[];
  diagnostics: CodexAdapterDiagnostic[];
}

export interface CodexBridgeVisibilityInput {
  selected_provider?: string;
  command_argv?: string[];
  terminal_substrate?: {
    driver?: string;
    session_handle?: string;
  };
  provider_acceptance?: {
    provider_session_id?: string;
    provider_reported_cwd?: string;
    provider_reported_branch?: string;
    provider_reported_head?: string;
    provider_version?: string;
    model?: string;
  };
}

export interface CodexLaunchMismatch {
  code:
    | 'provider_session_id_not_observed'
    | 'catalog_record_not_observed'
    | 'wrong_cwd'
    | 'outside_time_window';
  expected?: string;
  observed?: string;
  evidence_refs?: CodexAdapterEvidenceRef[];
}

export interface CorrelateLaunchInput extends CodexThreadAdapterInput {
  providerSessionId?: string | 'not_observed';
  projectPath?: string;
  intendedCwd?: string;
  timeWindow?: CodexTimeWindow;
  bridgeVisibility?: CodexBridgeVisibilityInput;
  catalogRecordRefs?: CodexAdapterEvidenceRef[];
}

export interface CorrelateLaunchResult {
  status:
    | 'matched_by_provider_session_id'
    | 'matched_by_cwd_time_window'
    | 'multiple_candidates'
    | 'not_observed'
    | 'wrong_cwd'
    | 'metadata_unreadable';
  thread?: CodexThreadRef;
  candidate_threads: CodexThreadRef[];
  confidence: 'exact' | 'strong' | 'weak' | 'none';
  evidence_refs: CodexAdapterEvidenceRef[];
  mismatches: CodexLaunchMismatch[];
  diagnostics: CodexAdapterDiagnostic[];
}

export interface EmitThreadReferenceInput extends CodexThreadAdapterInput {
  threadIdOrPrefix: string;
  format?: 'deeplink' | 'local-ref' | 'json';
}

export interface EmitThreadReferenceResult {
  status: 'ok' | 'not_found' | 'ambiguous';
  thread_id?: string;
  deeplink?: string;
  local_ref?: string;
  thread?: CodexThreadRef;
  matches?: CodexThreadRef[];
  evidence_refs: CodexAdapterEvidenceRef[];
  diagnostics: CodexAdapterDiagnostic[];
}

interface CodexThreadIndex {
  status: 'ok' | 'codex_home_not_found' | 'metadata_unreadable' | 'partial_index';
  threads: CodexThreadRef[];
  evidence_refs: CodexAdapterEvidenceRef[];
  diagnostics: CodexAdapterDiagnostic[];
}

interface GlobalStateMetadata {
  titles: Map<string, string>;
  pinned: Set<string>;
  order: Map<string, number>;
}

interface PartialThread {
  thread_id?: string;
  cwd?: string;
  timestamp?: string;
  archived: boolean;
  source_file: string;
}

const DEFAULT_JSONL_METADATA_LINES = 80;
const DEFAULT_JSONL_METADATA_BYTES = 1024 * 1024;
const DEEPLINK_PREFIX = 'codex://threads/';

export function listCandidateThreads(input: ListCandidateThreadsInput): ListCandidateThreadsResult {
  const index = buildCodexThreadIndex(input);
  if (index.status === 'codex_home_not_found' || index.status === 'metadata_unreadable') {
    return { ...index, status: index.status, threads: [] };
  }

  const cwd = input.projectPath ?? input.cwd;
  if (!cwd || !cwd.trim()) {
    return {
      status: 'project_path_invalid',
      threads: [],
      evidence_refs: index.evidence_refs,
      diagnostics: [
        ...index.diagnostics,
        { code: 'project_path_invalid', message: 'Expected projectPath or cwd.' },
      ],
    };
  }

  const normalizedCwd = normalizeComparablePath(cwd);
  let threads = index.threads.filter((thread) => isSameOrDescendant(thread.normalized_cwd, normalizedCwd));
  if (input.timeWindow) {
    threads = threads.filter((thread) => isInsideTimeWindow(thread.timestamp, input.timeWindow!));
  }
  if (input.limit != null) {
    threads = threads.slice(0, Math.max(0, input.limit));
  }

  return {
    status: index.status === 'partial_index' ? 'partial_index' : 'ok',
    threads,
    evidence_refs: index.evidence_refs,
    diagnostics: index.diagnostics,
  };
}

export function getThreadInfo(input: GetThreadInfoInput): GetThreadInfoResult {
  const index = buildCodexThreadIndex(input);
  if (index.status === 'codex_home_not_found' || index.status === 'metadata_unreadable') {
    return {
      status: 'metadata_unreadable',
      evidence_refs: index.evidence_refs,
      diagnostics: index.diagnostics,
    };
  }
  const matches = resolveThreadMatches(input.threadIdOrPrefix, index.threads);
  if (matches.length === 0) {
    return { status: 'not_found', evidence_refs: index.evidence_refs, diagnostics: index.diagnostics };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', matches, evidence_refs: index.evidence_refs, diagnostics: index.diagnostics };
  }
  return { status: 'ok', thread: matches[0], evidence_refs: index.evidence_refs, diagnostics: index.diagnostics };
}

export function resolveProviderSessionId(input: ResolveProviderSessionIdInput): ResolveProviderSessionIdResult {
  const info = getThreadInfo({ ...input, threadIdOrPrefix: input.providerSessionId });
  return {
    status: info.status,
    provider_session_id: input.providerSessionId,
    thread: info.thread,
    matches: info.matches,
    evidence_refs: info.evidence_refs,
    diagnostics: info.diagnostics,
  };
}

export function correlateLaunch(input: CorrelateLaunchInput): CorrelateLaunchResult {
  const intendedCwd = input.intendedCwd ?? input.projectPath;
  const providerSessionId = observedProviderSessionId(input);
  const bridgeEvidence = bridgeEvidenceRefs(input.bridgeVisibility);
  const baseEvidence = [...bridgeEvidence, ...(input.catalogRecordRefs ?? [])];

  if (providerSessionId && providerSessionId !== 'not_observed') {
    const resolved = resolveProviderSessionId({ ...input, providerSessionId });
    const evidence_refs = [...baseEvidence, ...resolved.evidence_refs];
    if (resolved.status === 'metadata_unreadable') {
      return emptyCorrelation('metadata_unreadable', evidence_refs, resolved.diagnostics);
    }
    if (resolved.status !== 'ok' || !resolved.thread) {
      return emptyCorrelation('not_observed', evidence_refs, resolved.diagnostics);
    }
    if (intendedCwd && !isSameOrDescendant(resolved.thread.normalized_cwd, normalizeComparablePath(intendedCwd))) {
      return {
        status: 'wrong_cwd',
        thread: resolved.thread,
        candidate_threads: [resolved.thread],
        confidence: 'none',
        evidence_refs,
        mismatches: [{
          code: 'wrong_cwd',
          expected: normalizeComparablePath(intendedCwd),
          observed: resolved.thread.normalized_cwd,
          evidence_refs: resolved.evidence_refs,
        }],
        diagnostics: resolved.diagnostics,
      };
    }
    if (input.timeWindow && !isInsideTimeWindow(resolved.thread.timestamp, input.timeWindow)) {
      return {
        status: 'not_observed',
        candidate_threads: [resolved.thread],
        confidence: 'none',
        evidence_refs,
        mismatches: [{ code: 'outside_time_window', observed: resolved.thread.timestamp }],
        diagnostics: resolved.diagnostics,
      };
    }
    return {
      status: 'matched_by_provider_session_id',
      thread: resolved.thread,
      candidate_threads: [resolved.thread],
      confidence: 'exact',
      evidence_refs,
      mismatches: [],
      diagnostics: resolved.diagnostics,
    };
  }

  const missingProviderId = hasTerminalSubstrate(input.bridgeVisibility)
    ? [{ code: 'provider_session_id_not_observed' as const, evidence_refs: bridgeEvidence }]
    : [];
  const candidates = intendedCwd && hasUsableTimeWindow(input.timeWindow)
    ? listCandidateThreads({
        ...input,
        projectPath: input.projectPath,
        cwd: input.intendedCwd ?? input.projectPath,
        timeWindow: input.timeWindow,
      })
    : undefined;
  if (!candidates) {
    return {
      status: 'not_observed',
      candidate_threads: [],
      confidence: 'none',
      evidence_refs: baseEvidence,
      mismatches: missingProviderId,
      diagnostics: [],
    };
  }
  const evidence_refs = [...baseEvidence, ...candidates.evidence_refs];
  if (candidates.status === 'metadata_unreadable' || candidates.status === 'codex_home_not_found') {
    return {
      status: 'metadata_unreadable',
      candidate_threads: [],
      confidence: 'none',
      evidence_refs,
      mismatches: missingProviderId,
      diagnostics: candidates.diagnostics,
    };
  }
  if (candidates.threads.length === 1) {
    return {
      status: 'matched_by_cwd_time_window',
      thread: candidates.threads[0],
      candidate_threads: candidates.threads,
      confidence: 'strong',
      evidence_refs,
      mismatches: missingProviderId,
      diagnostics: candidates.diagnostics,
    };
  }
  return {
    status: candidates.threads.length > 1 ? 'multiple_candidates' : 'not_observed',
    candidate_threads: candidates.threads,
    confidence: 'none',
    evidence_refs,
    mismatches: missingProviderId,
    diagnostics: candidates.diagnostics,
  };
}

export function emitThreadReference(input: EmitThreadReferenceInput): EmitThreadReferenceResult {
  const info = getThreadInfo(input);
  if (info.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      matches: info.matches,
      evidence_refs: info.evidence_refs,
      diagnostics: info.diagnostics,
    };
  }
  if (info.status !== 'ok' || !info.thread) {
    return { status: 'not_found', evidence_refs: info.evidence_refs, diagnostics: info.diagnostics };
  }
  return {
    status: 'ok',
    thread_id: info.thread.thread_id,
    deeplink: info.thread.deeplink,
    local_ref: `codex-thread:${info.thread.thread_id}`,
    thread: info.thread,
    evidence_refs: [
      ...info.evidence_refs,
      { kind: 'codex_deeplink', ref: info.thread.deeplink },
      { kind: 'codex_rollout_file', ref: info.thread.source_ref },
    ],
    diagnostics: info.diagnostics,
  };
}

function buildCodexThreadIndex(input: CodexThreadAdapterInput): CodexThreadIndex {
  const codexHome = input.codexHome ?? path.join(os.homedir(), '.codex');
  const diagnostics: CodexAdapterDiagnostic[] = [];
  const evidence_refs: CodexAdapterEvidenceRef[] = [];
  const stat = statPath(codexHome);
  if (!stat) {
    return {
      status: 'codex_home_not_found',
      threads: [],
      evidence_refs,
      diagnostics: [{ code: 'codex_home_not_found', message: `Codex home not found: ${codexHome}` }],
    };
  }
  if (!stat.isDirectory()) {
    return {
      status: 'metadata_unreadable',
      threads: [],
      evidence_refs,
      diagnostics: [{ code: 'codex_home_not_directory', message: `Codex home is not a directory: ${codexHome}` }],
    };
  }

  const globalState = readGlobalState(path.join(codexHome, '.codex-global-state.json'), diagnostics, evidence_refs);
  const includeArchived = input.includeArchived ?? true;
  const roots = [
    { root: path.join(codexHome, 'sessions'), archived: false },
    ...(includeArchived ? [{ root: path.join(codexHome, 'archived_sessions'), archived: true }] : []),
  ];
  const records = new Map<string, PartialThread>();

  for (const root of roots) {
    for (const file of walkFiles(root.root, (candidate) => path.basename(candidate).startsWith('rollout-') && candidate.endsWith('.jsonl'))) {
      evidence_refs.push({ kind: 'codex_rollout_file', ref: file });
      const partial = parseCodexRolloutMetadata(file, root.archived, input, diagnostics, evidence_refs);
      if (!partial.thread_id || !partial.cwd || !partial.timestamp) {
        diagnostics.push({
          code: 'codex_session_meta_incomplete',
          message: 'Skipped Codex rollout without complete thread id, cwd, and timestamp metadata.',
          source_ref: file,
        });
        continue;
      }
      const current = records.get(partial.thread_id);
      if (!current || Date.parse(partial.timestamp) >= Date.parse(current.timestamp ?? '')) {
        records.set(partial.thread_id, partial);
      }
    }
  }

  const threads = [...records.values()]
    .map((record) => toThreadRef(record, globalState))
    .sort((a, b) => compareThreads(a, b, globalState));
  return {
    status: diagnostics.some((diagnostic) => diagnostic.code.startsWith('codex_')) ? 'partial_index' : 'ok',
    threads,
    evidence_refs: dedupeEvidence(evidence_refs),
    diagnostics,
  };
}

function readGlobalState(
  file: string,
  diagnostics: CodexAdapterDiagnostic[],
  evidence_refs: CodexAdapterEvidenceRef[],
): GlobalStateMetadata {
  const metadata: GlobalStateMetadata = { titles: new Map(), pinned: new Set(), order: new Map() };
  if (!fs.existsSync(file)) return metadata;
  evidence_refs.push({ kind: 'codex_global_state', ref: file });
  const raw = readSmallTextFile(file, DEFAULT_JSONL_METADATA_BYTES);
  if (raw == null) {
    diagnostics.push({ code: 'codex_global_state_unreadable', message: 'Could not read Codex global state.', source_ref: file });
    return metadata;
  }
  try {
    const state = objectValue(JSON.parse(raw) as unknown);
    const threadTitles = objectValue(state?.['thread-titles']);
    const titles = objectValue(threadTitles?.titles);
    if (titles) {
      for (const [key, value] of Object.entries(titles)) {
        if (typeof value === 'string' && value.trim()) metadata.titles.set(key, value);
      }
    }
    const pinned = arrayValue(state?.['pinned-thread-ids']);
    for (const value of pinned ?? []) {
      if (typeof value === 'string' && value.trim()) metadata.pinned.add(value);
    }
    const order = arrayValue(threadTitles?.order);
    order?.forEach((value, index) => {
      if (typeof value === 'string' && value.trim()) metadata.order.set(value, index);
    });
  } catch {
    diagnostics.push({ code: 'codex_global_state_malformed', message: 'Codex global state JSON is malformed.', source_ref: file });
  }
  return metadata;
}

function parseCodexRolloutMetadata(
  file: string,
  archived: boolean,
  input: CodexThreadAdapterInput,
  diagnostics: CodexAdapterDiagnostic[],
  evidence_refs: CodexAdapterEvidenceRef[],
): PartialThread {
  const stat = statPath(file);
  const fallbackId = codexSessionIdFromFilename(file);
  const fallbackTimestamp = stat ? new Date(stat.mtimeMs).toISOString() : undefined;
  const lines = readJsonlHeadLines(file, input);
  for (const line of lines) {
    if (!line.includes('"session_meta"')) continue;
    const record = parseJsonObject(line);
    if (!record) {
      diagnostics.push({ code: 'codex_session_meta_malformed', message: 'Malformed JSONL metadata line.', source_ref: file });
      continue;
    }
    const payload = objectValue(record.payload);
    if (record.type !== 'session_meta' || !payload) continue;
    const threadId = stringValue(payload.id) ?? fallbackId;
    const timestamp = coerceTimestamp(payload.timestamp) ?? coerceTimestamp(record.timestamp) ?? fallbackTimestamp;
    const cwd = stringValue(payload.cwd);
    evidence_refs.push({ kind: 'codex_session_meta', ref: file, observed_at: timestamp });
    return { thread_id: threadId, cwd, timestamp, archived, source_file: file };
  }
  return { thread_id: fallbackId, timestamp: fallbackTimestamp, archived, source_file: file };
}

function toThreadRef(record: PartialThread, globalState: GlobalStateMetadata): CodexThreadRef {
  const thread_id = record.thread_id!;
  return {
    provider: 'codex',
    thread_id,
    cwd: record.cwd!,
    normalized_cwd: normalizeComparablePath(record.cwd!),
    title: globalState.titles.get(thread_id) ?? 'not_observed',
    timestamp: record.timestamp!,
    archived: record.archived,
    source_ref: record.source_file,
    deeplink: `${DEEPLINK_PREFIX}${thread_id}`,
  };
}

function compareThreads(a: CodexThreadRef, b: CodexThreadRef, globalState: GlobalStateMetadata): number {
  const aPinned = globalState.pinned.has(a.thread_id) ? 0 : 1;
  const bPinned = globalState.pinned.has(b.thread_id) ? 0 : 1;
  if (aPinned !== bPinned) return aPinned - bPinned;
  const aOrder = globalState.order.get(a.thread_id) ?? Number.MAX_SAFE_INTEGER;
  const bOrder = globalState.order.get(b.thread_id) ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const recency = Date.parse(b.timestamp) - Date.parse(a.timestamp);
  if (recency !== 0) return recency;
  return a.thread_id.localeCompare(b.thread_id);
}

function resolveThreadMatches(token: string, threads: CodexThreadRef[]): CodexThreadRef[] {
  const normalized = token.trim().toLowerCase();
  const exact = threads.filter((thread) => thread.thread_id.toLowerCase() === normalized);
  if (exact.length > 0) return exact;
  return threads.filter((thread) => thread.thread_id.toLowerCase().startsWith(normalized));
}

function observedProviderSessionId(input: CorrelateLaunchInput): string | undefined {
  const direct = input.providerSessionId;
  if (direct && direct !== 'not_observed') return direct;
  const bridge = input.bridgeVisibility?.provider_acceptance?.provider_session_id;
  return bridge && bridge !== 'not_observed' ? bridge : direct;
}

function emptyCorrelation(
  status: CorrelateLaunchResult['status'],
  evidence_refs: CodexAdapterEvidenceRef[],
  diagnostics: CodexAdapterDiagnostic[],
): CorrelateLaunchResult {
  return {
    status,
    candidate_threads: [],
    confidence: 'none',
    evidence_refs,
    mismatches: [],
    diagnostics,
  };
}

function bridgeEvidenceRefs(bridgeVisibility: CodexBridgeVisibilityInput | undefined): CodexAdapterEvidenceRef[] {
  if (!bridgeVisibility) return [];
  const refs: CodexAdapterEvidenceRef[] = [];
  const handle = bridgeVisibility.terminal_substrate?.session_handle;
  if (handle) refs.push({ kind: 'bridge_visibility', ref: `bridge-session:${handle}` });
  const command = bridgeVisibility.command_argv?.join(' ');
  if (command) refs.push({ kind: 'bridge_visibility', ref: `bridge-command:${command}` });
  return refs;
}

function hasTerminalSubstrate(bridgeVisibility: CodexBridgeVisibilityInput | undefined): boolean {
  return Boolean(
    bridgeVisibility?.terminal_substrate?.driver
      || bridgeVisibility?.terminal_substrate?.session_handle
      || bridgeVisibility?.command_argv?.length,
  );
}

function hasUsableTimeWindow(timeWindow: CodexTimeWindow | undefined): boolean {
  return Boolean(
    timeWindow
      && (isUsableTimeBoundary(timeWindow.after) || isUsableTimeBoundary(timeWindow.before)),
  );
}

function isUsableTimeBoundary(value: string | undefined): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function isInsideTimeWindow(timestamp: string, timeWindow: CodexTimeWindow): boolean {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  if (timeWindow.after && parsed < Date.parse(timeWindow.after)) return false;
  if (timeWindow.before && parsed > Date.parse(timeWindow.before)) return false;
  return true;
}

function isSameOrDescendant(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeComparablePath(candidate);
  const normalizedRoot = normalizeComparablePath(root);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(new RegExp(`${escapeRegExp(path.sep)}+$`), '');
}

function walkFiles(root: string, matches: (file: string) => boolean): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && matches(entryPath)) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function readJsonlHeadLines(file: string, input: CodexThreadAdapterInput): string[] {
  const maxLines = input.maxJsonlMetadataLines ?? DEFAULT_JSONL_METADATA_LINES;
  const text = readSmallTextFile(file, input.maxJsonlMetadataBytes ?? DEFAULT_JSONL_METADATA_BYTES);
  return text?.split(/\r?\n/).filter((line) => line.trim()).slice(0, maxLines) ?? [];
}

function readSmallTextFile(file: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const bytesToRead = Math.min(maxBytes, fs.fstatSync(fd).size);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = bytesToRead > 0 ? fs.readSync(fd, buffer, 0, bytesToRead, 0) : 0;
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort read-only metadata scanning.
      }
    }
  }
}

function statPath(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

function codexSessionIdFromFilename(file: string): string | undefined {
  const match = path.basename(file).match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  return match?.[1];
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    return objectValue(JSON.parse(line) as unknown);
  } catch {
    return undefined;
  }
}

function coerceTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

function dedupeEvidence(refs: CodexAdapterEvidenceRef[]): CodexAdapterEvidenceRef[] {
  const seen = new Set<string>();
  const deduped: CodexAdapterEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}:${ref.observed_at ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

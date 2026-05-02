import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProviderSessionProvider = 'codex' | 'claude-code';

export interface ProviderSessionRecord {
  provider: ProviderSessionProvider;
  session_id: string;
  cwd: string;
  branch?: string;
  created_at?: string;
  last_message_at?: string;
  updated_at: string;
  source_file: string;
  resume_command: string[];
}

export interface SessionCatalogOptions {
  homeDir?: string;
  codexRoot?: string;
  claudeRoot?: string;
  providers?: ProviderSessionProvider[];
  cwd?: string;
  includeArchivedCodex?: boolean;
  maxJsonlMetadataLines?: number;
  maxJsonlMetadataBytes?: number;
}

interface PartialRecord {
  provider: ProviderSessionProvider;
  session_id?: string;
  cwd?: string;
  branch?: string;
  created_at?: string;
  last_message_at?: string;
  updated_at?: string;
  source_file: string;
  resume_command?: string[];
}

const DEFAULT_JSONL_METADATA_LINES = 80;
const DEFAULT_JSONL_METADATA_BYTES = 1024 * 1024;

export function listProviderSessions(options: SessionCatalogOptions = {}): ProviderSessionRecord[] {
  const providers = new Set(options.providers ?? ['codex', 'claude-code']);
  const records: ProviderSessionRecord[] = [];

  if (providers.has('codex')) {
    records.push(...scanCodexSessions(options));
  }
  if (providers.has('claude-code')) {
    records.push(...scanClaudeCodeSessions(options));
  }

  const filtered = options.cwd
    ? records.filter((record) => isSameOrDescendant(record.cwd, options.cwd!))
    : records;

  return filtered.sort(compareRecordsByRecency);
}

export function scanCodexSessions(options: SessionCatalogOptions = {}): ProviderSessionRecord[] {
  const homeDir = options.homeDir ?? os.homedir();
  const codexRoot = options.codexRoot ?? path.join(homeDir, '.codex');
  const includeArchived = options.includeArchivedCodex ?? true;
  const roots = [
    path.join(codexRoot, 'sessions'),
    ...(includeArchived ? [path.join(codexRoot, 'archived_sessions')] : []),
  ];

  return roots
    .flatMap((root) => walkFiles(root, (file) => path.basename(file).startsWith('rollout-') && file.endsWith('.jsonl')))
    .map((file) => parseCodexRolloutFile(file, options))
    .filter(isProviderSessionRecord)
    .sort(compareRecordsByRecency);
}

export function scanClaudeCodeSessions(options: SessionCatalogOptions = {}): ProviderSessionRecord[] {
  const homeDir = options.homeDir ?? os.homedir();
  const claudeRoot = options.claudeRoot ?? path.join(homeDir, '.claude');
  const projectRecords = walkFiles(
    path.join(claudeRoot, 'projects'),
    (file) => file.endsWith('.jsonl'),
  ).map((file) => parseClaudeProjectFile(file, options));

  const liveRecords = walkFiles(
    path.join(claudeRoot, 'sessions'),
    (file) => file.endsWith('.json'),
  ).map((file) => parseClaudeLiveSessionFile(file));

  const merged = new Map<string, ProviderSessionRecord>();
  for (const record of [...projectRecords, ...liveRecords]) {
    if (!isProviderSessionRecord(record)) continue;
    mergeRecord(merged, record);
  }
  return [...merged.values()].sort(compareRecordsByRecency);
}

function parseCodexRolloutFile(file: string, options: SessionCatalogOptions): ProviderSessionRecord | undefined {
  const stat = statFile(file);
  if (!stat) return undefined;

  const lines = readJsonlHeadLines(file, options);
  let sessionId = codexSessionIdFromFilename(file);
  let cwd: string | undefined;
  let branch: string | undefined;
  let createdAt: string | undefined;

  for (const line of lines) {
    if (!line.includes('"session_meta"')) continue;
    const record = parseJsonObject(line);
    if (!record) continue;
    const payload = objectValue(record.payload);
    if (record.type === 'session_meta' && payload) {
      sessionId = stringValue(payload.id) ?? sessionId;
      cwd = stringValue(payload.cwd) ?? cwd;
      branch = stringValue(objectValue(payload.git)?.branch) ?? branch;
      createdAt = coerceTimestamp(payload.timestamp) ?? coerceTimestamp(record.timestamp) ?? createdAt;
      break;
    }
  }
  const lastMessageAt = latestTimestampFromLines(
    readJsonlTailLines(file, options),
    codexMetadataPrefix,
  ) ?? new Date(stat.mtimeMs).toISOString();

  return finalizeRecord({
    provider: 'codex',
    session_id: sessionId,
    cwd,
    branch,
    created_at: createdAt,
    last_message_at: lastMessageAt,
    updated_at: lastMessageAt,
    source_file: file,
    resume_command: sessionId ? ['codex', '--no-alt-screen', 'resume', sessionId] : undefined,
  });
}

function parseClaudeProjectFile(file: string, options: SessionCatalogOptions): ProviderSessionRecord | undefined {
  const stat = statFile(file);
  if (!stat) return undefined;

  const lines = readJsonlHeadLines(file, options);
  let sessionId = path.basename(file, '.jsonl') || undefined;
  let cwd: string | undefined;
  let branch: string | undefined;
  let createdAt: string | undefined;

  for (const line of lines) {
    const metadata = metadataPrefix(line);
    sessionId = extractJsonStringField(metadata, 'sessionId') ?? sessionId;
    cwd = extractJsonStringField(metadata, 'cwd') ?? cwd;
    branch = extractJsonStringField(metadata, 'gitBranch')
      ?? extractJsonStringField(metadata, 'branch')
      ?? branch;
    createdAt = createdAt ?? firstTimestampFromLines([line]);
    if (sessionId && cwd) break;
  }
  const lastMessageAt = latestTimestampFromLines(readJsonlTailLines(file, options))
    ?? new Date(stat.mtimeMs).toISOString();

  return finalizeRecord({
    provider: 'claude-code',
    session_id: sessionId,
    cwd,
    branch,
    created_at: createdAt,
    last_message_at: lastMessageAt,
    updated_at: lastMessageAt,
    source_file: file,
    resume_command: sessionId ? ['claude', '--resume', sessionId] : undefined,
  });
}

function parseClaudeLiveSessionFile(file: string): ProviderSessionRecord | undefined {
  const raw = readSmallTextFile(file, DEFAULT_JSONL_METADATA_BYTES);
  if (raw == null) return undefined;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const record = objectValue(data);
  if (!record) return undefined;

  const sessionId = stringValue(record.sessionId) ?? stringValue(record.id);
  const createdAt = coerceTimestamp(record.startedAt)
    ?? coerceTimestamp(record.createdAt)
    ?? coerceTimestamp(record.created_at);
  const lastMessageAt = coerceTimestamp(record.updatedAt)
    ?? coerceTimestamp(record.updated_at)
    ?? coerceTimestamp(record.lastActivity)
    ?? fileUpdatedAt(file);
  return finalizeRecord({
    provider: 'claude-code',
    session_id: sessionId,
    cwd: stringValue(record.cwd),
    branch: stringValue(record.gitBranch) ?? stringValue(record.branch),
    created_at: createdAt,
    last_message_at: lastMessageAt,
    updated_at: lastMessageAt,
    source_file: file,
    resume_command: sessionId ? ['claude', '--resume', sessionId] : undefined,
  });
}

function finalizeRecord(record: PartialRecord): ProviderSessionRecord | undefined {
  if (!record.session_id || !record.cwd || !record.updated_at || !record.resume_command) {
    return undefined;
  }
  const finalized: ProviderSessionRecord = {
    provider: record.provider,
    session_id: record.session_id,
    cwd: record.cwd,
    updated_at: record.updated_at,
    source_file: record.source_file,
    resume_command: record.resume_command,
  };
  if (record.branch) finalized.branch = record.branch;
  if (record.created_at) finalized.created_at = record.created_at;
  if (record.last_message_at) finalized.last_message_at = record.last_message_at;
  return finalized;
}

function mergeRecord(records: Map<string, ProviderSessionRecord>, next: ProviderSessionRecord): void {
  const key = `${next.provider}:${next.session_id}`;
  const current = records.get(key);
  if (!current) {
    records.set(key, next);
    return;
  }

  const nextIsNewer = Date.parse(next.updated_at) >= Date.parse(current.updated_at);
  const newer = nextIsNewer ? next : current;
  const older = nextIsNewer ? current : next;
  records.set(key, {
    ...newer,
    cwd: newer.cwd || older.cwd,
    branch: newer.branch ?? older.branch,
    created_at: earliestTimestamp(newer.created_at, older.created_at),
    last_message_at: latestTimestamp(newer.last_message_at, older.last_message_at),
    updated_at: latestTimestamp(newer.updated_at, older.updated_at) ?? newer.updated_at,
  });
}

function compareRecordsByRecency(a: ProviderSessionRecord, b: ProviderSessionRecord): number {
  const recency = Date.parse(b.updated_at) - Date.parse(a.updated_at);
  if (recency !== 0) return recency;
  const provider = a.provider.localeCompare(b.provider);
  if (provider !== 0) return provider;
  return a.session_id.localeCompare(b.session_id);
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

  return files;
}

function readJsonlHeadLines(file: string, options: SessionCatalogOptions): string[] {
  const maxLines = options.maxJsonlMetadataLines ?? DEFAULT_JSONL_METADATA_LINES;
  const text = readSmallTextFile(file, options.maxJsonlMetadataBytes ?? DEFAULT_JSONL_METADATA_BYTES);
  return text?.split(/\r?\n/).filter((line) => line.trim()).slice(0, maxLines) ?? [];
}

function readJsonlTailLines(file: string, options: SessionCatalogOptions): string[] {
  const maxLines = options.maxJsonlMetadataLines ?? DEFAULT_JSONL_METADATA_LINES;
  const maxBytes = options.maxJsonlMetadataBytes ?? DEFAULT_JSONL_METADATA_BYTES;
  const text = readTailTextFile(file, maxBytes);
  return text?.split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines) ?? [];
}

function readTailTextFile(file: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const bytesToRead = Math.min(maxBytes, size);
    const start = Math.max(0, size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = bytesToRead > 0 ? fs.readSync(fd, buffer, 0, bytesToRead, start) : 0;
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures; the scanner is best-effort and read-only.
      }
    }
  }
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
        // Ignore close failures; the scanner is best-effort and read-only.
      }
    }
  }
}

function statFile(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

function fileUpdatedAt(file: string): string | undefined {
  const stat = statFile(file);
  return stat ? new Date(stat.mtimeMs).toISOString() : undefined;
}

function codexSessionIdFromFilename(file: string): string | undefined {
  const match = path.basename(file).match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  return match?.[1];
}

function metadataPrefix(line: string): string {
  return prefixBeforeMarkers(line, ['"message"', '"snapshot"']);
}

function codexMetadataPrefix(line: string): string {
  return prefixBeforeMarkers(line, ['"payload"']);
}

function prefixBeforeMarkers(line: string, bodyMarkers: string[]): string {
  const firstBodyMarker = bodyMarkers
    .map((marker) => line.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return firstBodyMarker == null ? line : line.slice(0, firstBodyMarker);
}

function firstTimestampFromLines(
  lines: string[],
  linePrefix: (line: string) => string = (line) => line,
): string | undefined {
  for (const line of lines) {
    const timestamps = extractJsonTimestampFields(linePrefix(line), 'timestamp');
    if (timestamps[0]) return timestamps[0];
  }
  return undefined;
}

function latestTimestampFromLines(
  lines: string[],
  linePrefix: (line: string) => string = (line) => line,
): string | undefined {
  let latest: string | undefined;
  for (const line of lines) {
    for (const timestamp of extractJsonTimestampFields(linePrefix(line), 'timestamp')) {
      latest = latestTimestamp(latest, timestamp);
    }
  }
  return latest;
}

function extractJsonStringField(line: string, field: string): string | undefined {
  const escapedField = escapeRegExp(field);
  const pattern = new RegExp(`"${escapedField}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'g');
  let extracted: string | undefined;
  for (const match of line.matchAll(pattern)) {
    if (!match[1]) continue;
    try {
      const value = JSON.parse(match[1]) as unknown;
      extracted = stringValue(value) ?? extracted;
    } catch {
      continue;
    }
  }
  return extracted;
}

function extractJsonTimestampFields(line: string, field: string): string[] {
  const escapedField = escapeRegExp(field);
  const pattern = new RegExp(`"${escapedField}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?)`, 'g');
  const timestamps: string[] = [];
  for (const match of line.matchAll(pattern)) {
    if (!match[1]) continue;
    try {
      const raw = match[1].startsWith('"') ? JSON.parse(match[1]) as unknown : Number(match[1]);
      const timestamp = coerceTimestamp(raw);
      if (timestamp) timestamps.push(timestamp);
    } catch {
      continue;
    }
  }
  return timestamps;
}

function earliestTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function latestTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
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

function isSameOrDescendant(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeComparablePath(candidate);
  const normalizedRoot = normalizeComparablePath(root);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(new RegExp(`${escapeRegExp(path.sep)}+$`), '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isProviderSessionRecord(record: ProviderSessionRecord | undefined): record is ProviderSessionRecord {
  return Boolean(record);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

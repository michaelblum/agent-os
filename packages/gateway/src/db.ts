/**
 * CoordinationDB — SQLite-backed store for sessions, shared state, and messages.
 *
 * Dependencies: better-sqlite3, ulid
 */

import Database from 'better-sqlite3';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  name: string;
  role: string;
  harness: string;
  capabilities: string[];
  status: string;
  registeredAt: string;
  lastHeartbeat: string;
}

export interface StateEntry {
  key: string;
  value: unknown;
  version: number;
  owner?: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface StateResult {
  ok: boolean;
  version?: number;
  key?: string;
  reason?: string;
  currentOwner?: string;
  currentVersion?: number;
}

export interface SetStateOptions {
  mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
  expectedVersion?: number;
  owner?: string;
  ttl?: number; // seconds
}

export interface Message {
  id: string;
  channel: string;
  from: string;
  payload: unknown;
  createdAt: string;
}

export interface ReadStreamOptions {
  since?: string;
  limit?: number;
}

export type IntegrationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface IntegrationJob {
  id: string;
  provider: string;
  workflowId?: string;
  workflowTitle?: string;
  surface?: string;
  requester?: string;
  channel?: string;
  thread?: string;
  commandText: string;
  status: IntegrationJobStatus;
  summary?: string;
  resultText?: string;
  resultJson?: unknown;
  errorText?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateIntegrationJobInput {
  provider: string;
  workflowId?: string;
  workflowTitle?: string;
  surface?: string;
  requester?: string;
  channel?: string;
  thread?: string;
  commandText: string;
  status?: IntegrationJobStatus;
  summary?: string;
  resultText?: string;
  resultJson?: unknown;
  errorText?: string;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
}

export interface UpdateIntegrationJobInput {
  status?: IntegrationJobStatus;
  summary?: string | null;
  resultText?: string | null;
  resultJson?: unknown;
  errorText?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ListIntegrationJobsOptions {
  limit?: number;
  status?: IntegrationJobStatus;
  provider?: string;
}

// ---------------------------------------------------------------------------
// Internal row shapes (raw SQLite rows)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  name: string;
  role: string;
  harness: string;
  capabilities: string; // JSON
  status: string;
  registered_at: string;
  last_heartbeat: string;
}

interface StateRow {
  key: string;
  value: string; // JSON
  version: number;
  owner: string | null;
  updated_at: number; // unix ms
  expires_at: number | null;
}

interface MessageRow {
  id: string;
  channel: string;
  from_session: string;
  payload: string; // JSON
  created_at: number; // unix ms
}

interface IntegrationJobRow {
  id: string;
  provider: string;
  workflow_id: string | null;
  workflow_title: string | null;
  surface: string | null;
  requester: string | null;
  channel: string | null;
  thread: string | null;
  command_text: string;
  status: IntegrationJobStatus;
  summary: string | null;
  result_text: string | null;
  result_json: string | null;
  error_text: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

// ---------------------------------------------------------------------------
// CoordinationDB
// ---------------------------------------------------------------------------

export class CoordinationDB {
  private db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    // Bounded wait on SQLITE_BUSY so a peer WAL holder can't hang us forever.
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id             TEXT PRIMARY KEY,
        name           TEXT UNIQUE NOT NULL,
        role           TEXT NOT NULL,
        harness        TEXT NOT NULL,
        capabilities   TEXT NOT NULL DEFAULT '[]',
        registered_at  TEXT NOT NULL,
        last_heartbeat TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'online'
      );

      CREATE TABLE IF NOT EXISTS state (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        version    INTEGER NOT NULL DEFAULT 1,
        owner      TEXT,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS messages (
        id           TEXT PRIMARY KEY,
        channel      TEXT NOT NULL,
        from_session TEXT NOT NULL,
        payload      TEXT NOT NULL,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel_id
        ON messages (channel, id);

      CREATE TABLE IF NOT EXISTS integration_jobs (
        id             TEXT PRIMARY KEY,
        provider       TEXT NOT NULL,
        workflow_id    TEXT,
        workflow_title TEXT,
        surface        TEXT,
        requester      TEXT,
        channel        TEXT,
        thread         TEXT,
        command_text   TEXT NOT NULL,
        status         TEXT NOT NULL,
        summary        TEXT,
        result_text    TEXT,
        result_json    TEXT,
        error_text     TEXT,
        metadata       TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        started_at     INTEGER,
        completed_at   INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_integration_jobs_updated
        ON integration_jobs (updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_integration_jobs_provider_status
        ON integration_jobs (provider, status, updated_at DESC);
    `);
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async registerSession(
    name: string,
    role: string,
    harness: string,
    capabilities: string[] = [],
  ): Promise<Session> {
    const now = new Date().toISOString();
    const id = ulid();
    const capJson = JSON.stringify(capabilities);

    // Try insert first; on conflict (name) update mutable fields.
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, role, harness, capabilities, registered_at, last_heartbeat, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'online')
         ON CONFLICT(name) DO UPDATE SET
           role           = excluded.role,
           harness        = excluded.harness,
           capabilities   = excluded.capabilities,
           last_heartbeat = excluded.last_heartbeat,
           status         = 'online'`,
      )
      .run(id, name, role, harness, capJson, now, now);

    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE name = ?`)
      .get(name) as SessionRow;

    return rowToSession(row);
  }

  async whoIsOnline(): Promise<Session[]> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE status = 'online' AND last_heartbeat > ?`,
      )
      .all(cutoff) as SessionRow[];

    return rows.map(rowToSession);
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  async setState(
    key: string,
    value: unknown,
    opts: SetStateOptions = {},
  ): Promise<StateResult> {
    const { mode = 'set', expectedVersion, owner, ttl } = opts;
    const now = Date.now();
    const expiresAt = ttl != null ? now + ttl * 1000 : null;

    switch (mode) {
      case 'set':
        return this._modeSet(key, value, now, expiresAt, owner);

      case 'cas':
        return this._modeCas(key, value, expectedVersion, now, expiresAt, owner);

      case 'acquire_lock':
        return this._modeAcquireLock(key, value, owner, now, expiresAt);

      case 'release_lock':
        return this._modeReleaseLock(key, owner, now);

      default:
        return { ok: false, reason: 'unknown_mode' };
    }
  }

  private _modeSet(
    key: string,
    value: unknown,
    now: number,
    expiresAt: number | null,
    owner?: string,
  ): StateResult {
    if (value === null) {
      this.db.prepare(`DELETE FROM state WHERE key = ?`).run(key);
      return { ok: true, key };
    }

    const valueJson = JSON.stringify(value);

    const row = this.db
      .prepare(
        `INSERT INTO state (key, value, version, owner, updated_at, expires_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           version    = state.version + 1,
           owner      = excluded.owner,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at
         RETURNING version`,
      )
      .get(key, valueJson, owner ?? null, now, expiresAt) as { version: number };

    return { ok: true, version: row.version, key };
  }

  private _modeCas(
    key: string,
    value: unknown,
    expectedVersion: number | undefined,
    now: number,
    expiresAt: number | null,
    owner?: string,
  ): StateResult {
    const existing = this.db
      .prepare(`SELECT version FROM state WHERE key = ?`)
      .get(key) as { version: number } | undefined;

    const currentVersion = existing?.version ?? 0;

    if (currentVersion !== (expectedVersion ?? 0)) {
      return {
        ok: false,
        reason: 'version_mismatch',
        currentVersion,
      };
    }

    if (value === null) {
      this.db.prepare(`DELETE FROM state WHERE key = ?`).run(key);
      return { ok: true, key };
    }

    const valueJson = JSON.stringify(value);

    const row = this.db
      .prepare(
        `INSERT INTO state (key, value, version, owner, updated_at, expires_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           version    = state.version + 1,
           owner      = excluded.owner,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at
         RETURNING version`,
      )
      .get(key, valueJson, owner ?? null, now, expiresAt) as { version: number };

    return { ok: true, version: row.version, key };
  }

  private _modeAcquireLock(
    key: string,
    value: unknown,
    owner: string | undefined,
    now: number,
    expiresAt: number | null,
  ): StateResult {
    if (!owner) {
      return { ok: false, reason: 'owner_required' };
    }

    const existing = this.db
      .prepare(`SELECT version, owner, expires_at FROM state WHERE key = ?`)
      .get(key) as Pick<StateRow, 'version' | 'owner' | 'expires_at'> | undefined;

    if (existing) {
      const isExpired = existing.expires_at != null && existing.expires_at < now;
      const isSameOwner = existing.owner === owner;

      if (!isExpired && existing.owner != null && !isSameOwner) {
        return {
          ok: false,
          reason: 'owned_by_other',
          currentOwner: existing.owner,
        };
      }
    }

    const valueJson = JSON.stringify(value);

    const row = this.db
      .prepare(
        `INSERT INTO state (key, value, version, owner, updated_at, expires_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           version    = state.version + 1,
           owner      = excluded.owner,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at
         RETURNING version`,
      )
      .get(key, valueJson, owner, now, expiresAt) as { version: number };

    return { ok: true, version: row.version, key };
  }

  private _modeReleaseLock(
    key: string,
    owner: string | undefined,
    now: number,
  ): StateResult {
    if (!owner) {
      return { ok: false, reason: 'owner_required' };
    }

    const existing = this.db
      .prepare(`SELECT version, owner FROM state WHERE key = ?`)
      .get(key) as Pick<StateRow, 'version' | 'owner'> | undefined;

    if (!existing) {
      // Key doesn't exist — nothing to release
      return { ok: true, key };
    }

    if (existing.owner !== owner) {
      return {
        ok: false,
        reason: 'not_owner',
        currentOwner: existing.owner ?? undefined,
      };
    }

    // Clear ownership; bump version so CAS can detect lock/release cycles
    const row = this.db
      .prepare(
        `UPDATE state SET owner = NULL, version = version + 1, updated_at = ?
         WHERE key = ?
         RETURNING version`,
      )
      .get(now, key) as { version: number };

    return { ok: true, version: row.version, key };
  }

  async getState(keyOrPattern: string): Promise<StateEntry[]> {
    const now = Date.now();
    let rows: StateRow[];

    if (keyOrPattern.includes('*')) {
      const likePattern = keyOrPattern
        .replace(/[%_\\]/g, '\\$&')  // escape LIKE metacharacters first
        .replace(/\*/g, '%');          // then convert glob * to SQL %
      rows = this.db
        .prepare(
          `SELECT * FROM state
           WHERE key LIKE ? ESCAPE '\\'
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .all(likePattern, now) as StateRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM state
           WHERE key = ?
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .all(keyOrPattern, now) as StateRow[];
    }

    return rows.map(rowToStateEntry);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async postMessage(channel: string, payload: unknown, from: string): Promise<string> {
    const id = ulid();
    const now = Date.now();
    const payloadJson = JSON.stringify(payload);

    this.db
      .prepare(
        `INSERT INTO messages (id, channel, from_session, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, channel, from, payloadJson, now);

    return id;
  }

  async readStream(channel: string, opts: ReadStreamOptions = {}): Promise<Message[]> {
    const { since, limit = 50 } = opts;

    let rows: MessageRow[];

    if (since) {
      rows = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE channel = ? AND id > ?
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(channel, since, limit) as MessageRow[];
    } else {
      // Return latest N messages in ascending order
      const inner = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE channel = ?
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(channel, limit) as MessageRow[];
      rows = inner.reverse();
    }

    return rows.map(rowToMessage);
  }

  // -------------------------------------------------------------------------
  // Integration jobs
  // -------------------------------------------------------------------------

  async createIntegrationJob(input: CreateIntegrationJobInput): Promise<IntegrationJob> {
    const id = ulid();
    const now = Date.now();
    const status = input.status ?? 'queued';
    const startedAtMs = input.startedAt ? Date.parse(input.startedAt) : (status === 'running' ? now : null);
    const completedAtMs = input.completedAt ? Date.parse(input.completedAt) : (
      status === 'succeeded' || status === 'failed' ? now : null
    );

    this.db
      .prepare(
        `INSERT INTO integration_jobs (
           id, provider, workflow_id, workflow_title, surface, requester, channel, thread,
           command_text, status, summary, result_text, result_json, error_text, metadata,
           created_at, updated_at, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.workflowId ?? null,
        input.workflowTitle ?? null,
        input.surface ?? null,
        input.requester ?? null,
        input.channel ?? null,
        input.thread ?? null,
        input.commandText,
        status,
        input.summary ?? null,
        input.resultText ?? null,
        input.resultJson === undefined ? null : JSON.stringify(input.resultJson),
        input.errorText ?? null,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        now,
        now,
        startedAtMs,
        completedAtMs,
      );

    const created = await this.getIntegrationJob(id);
    if (!created) throw new Error(`Integration job "${id}" was not persisted`);
    return created;
  }

  async getIntegrationJob(id: string): Promise<IntegrationJob | null> {
    const row = this.db
      .prepare(`SELECT * FROM integration_jobs WHERE id = ?`)
      .get(id) as IntegrationJobRow | undefined;
    return row ? rowToIntegrationJob(row) : null;
  }

  async updateIntegrationJob(id: string, patch: UpdateIntegrationJobInput): Promise<IntegrationJob> {
    const current = await this.getIntegrationJob(id);
    if (!current) throw new Error(`Integration job "${id}" not found`);

    const nextStatus = patch.status ?? current.status;
    const now = Date.now();
    const startedAt = patch.startedAt === undefined
      ? current.startedAt
      : (patch.startedAt ? patch.startedAt : undefined);
    const completedAt = patch.completedAt === undefined
      ? current.completedAt
      : (patch.completedAt ? patch.completedAt : undefined);
    const normalizedStartedAt = startedAt ?? (
      nextStatus === 'running' && !current.startedAt ? new Date(now).toISOString() : undefined
    );
    const normalizedCompletedAt = completedAt ?? (
      (nextStatus === 'succeeded' || nextStatus === 'failed') ? new Date(now).toISOString() : undefined
    );

    const resultJson = patch.resultJson === undefined ? current.resultJson : patch.resultJson;
    const metadata = patch.metadata === undefined ? current.metadata : (patch.metadata ?? undefined);
    const summary = patch.summary === undefined ? current.summary : (patch.summary ?? undefined);
    const resultText = patch.resultText === undefined ? current.resultText : (patch.resultText ?? undefined);
    const errorText = patch.errorText === undefined ? current.errorText : (patch.errorText ?? undefined);

    this.db
      .prepare(
        `UPDATE integration_jobs
         SET status = ?,
             summary = ?,
             result_text = ?,
             result_json = ?,
             error_text = ?,
             metadata = ?,
             updated_at = ?,
             started_at = ?,
             completed_at = ?
         WHERE id = ?`,
      )
      .run(
        nextStatus,
        summary ?? null,
        resultText ?? null,
        resultJson === undefined ? null : JSON.stringify(resultJson),
        errorText ?? null,
        metadata === undefined ? null : JSON.stringify(metadata),
        now,
        normalizedStartedAt ? Date.parse(normalizedStartedAt) : null,
        normalizedCompletedAt ? Date.parse(normalizedCompletedAt) : null,
        id,
      );

    return (await this.getIntegrationJob(id)) as IntegrationJob;
  }

  async listIntegrationJobs(opts: ListIntegrationJobsOptions = {}): Promise<IntegrationJob[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (opts.status) {
      clauses.push(`status = ?`);
      values.push(opts.status);
    }
    if (opts.provider) {
      clauses.push(`provider = ?`);
      values.push(opts.provider);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
    values.push(limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM integration_jobs
         ${where}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(...values) as IntegrationJobRow[];

    return rows.map(rowToIntegrationJob);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row → domain object converters
// ---------------------------------------------------------------------------

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    harness: row.harness,
    capabilities: JSON.parse(row.capabilities) as string[],
    status: row.status,
    registeredAt: row.registered_at,
    lastHeartbeat: row.last_heartbeat,
  };
}

function rowToStateEntry(row: StateRow): StateEntry {
  const entry: StateEntry = {
    key: row.key,
    value: JSON.parse(row.value),
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (row.owner != null) entry.owner = row.owner;
  if (row.expires_at != null) entry.expiresAt = new Date(row.expires_at).toISOString();
  return entry;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channel: row.channel,
    from: row.from_session,
    payload: JSON.parse(row.payload),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToIntegrationJob(row: IntegrationJobRow): IntegrationJob {
  const job: IntegrationJob = {
    id: row.id,
    provider: row.provider,
    commandText: row.command_text,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (row.workflow_id) job.workflowId = row.workflow_id;
  if (row.workflow_title) job.workflowTitle = row.workflow_title;
  if (row.surface) job.surface = row.surface;
  if (row.requester) job.requester = row.requester;
  if (row.channel) job.channel = row.channel;
  if (row.thread) job.thread = row.thread;
  if (row.summary) job.summary = row.summary;
  if (row.result_text) job.resultText = row.result_text;
  if (row.result_json) job.resultJson = JSON.parse(row.result_json);
  if (row.error_text) job.errorText = row.error_text;
  if (row.metadata) job.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  if (row.started_at != null) job.startedAt = new Date(row.started_at).toISOString();
  if (row.completed_at != null) job.completedAt = new Date(row.completed_at).toISOString();
  return job;
}

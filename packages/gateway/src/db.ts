/**
 * GatewayStore — SQLite-backed store for integration jobs and broker-local UI state.
 *
 * The daemon owns agent/session communication. Keep this store scoped to
 * provider adapters, workflow launches, and broker-local presentation state.
 *
 * Dependencies: better-sqlite3, ulid
 */

import Database from 'better-sqlite3';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateEntry {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
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

interface StateRow {
  key: string;
  value: string; // JSON
  version: number;
  updated_at: number; // unix ms
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
// GatewayStore
// ---------------------------------------------------------------------------

export class GatewayStore {
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
      CREATE TABLE IF NOT EXISTS state (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

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
  // Broker-local state
  // -------------------------------------------------------------------------

  async setState(key: string, value: unknown): Promise<StateEntry | null> {
    const now = Date.now();
    if (value === null) {
      this.db.prepare(`DELETE FROM state WHERE key = ?`).run(key);
      return null;
    }

    const valueJson = JSON.stringify(value);

    const row = this.db
      .prepare(
        `INSERT INTO state (key, value, version, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           version    = state.version + 1,
           updated_at = excluded.updated_at
         RETURNING key, value, version, updated_at`,
      )
      .get(key, valueJson, now) as StateRow;

    return rowToStateEntry(row);
  }

  async getState(keyOrPattern: string): Promise<StateEntry[]> {
    let rows: StateRow[];

    if (keyOrPattern.includes('*')) {
      const likePattern = keyOrPattern
        .replace(/[%_\\]/g, '\\$&')  // escape LIKE metacharacters first
        .replace(/\*/g, '%');          // then convert glob * to SQL %
      rows = this.db
        .prepare(
          `SELECT key, value, version, updated_at FROM state
           WHERE key LIKE ? ESCAPE '\\'`,
        )
        .all(likePattern) as StateRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT key, value, version, updated_at FROM state
           WHERE key = ?`,
        )
        .all(keyOrPattern) as StateRow[];
    }

    return rows.map(rowToStateEntry);
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

function rowToStateEntry(row: StateRow): StateEntry {
  return {
    key: row.key,
    value: JSON.parse(row.value),
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
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

// packages/host/src/session-store.ts
import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Session, SessionConfig, StoredMessage } from './types.ts';

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'anthropic',
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
        system TEXT,
        tool_profile TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_count INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, created_at);
    `);
  }

  createSession(config: SessionConfig): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: ulid(),
      provider: config.provider ?? 'anthropic',
      model: config.model ?? 'claude-sonnet-4-20250514',
      system: config.system,
      toolProfile: config.toolProfile,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO sessions (id, provider, model, system, tool_profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, session.provider, session.model, session.system ?? null,
           session.toolProfile ?? null, session.createdAt, session.updatedAt);

    return session;
  }

  getSession(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      provider: row.provider,
      model: row.model,
      system: row.system ?? undefined,
      toolProfile: row.tool_profile ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSessions(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      system: row.system ?? undefined,
      toolProfile: row.tool_profile ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: unknown[],
    tokenCount?: number
  ): StoredMessage {
    const now = new Date().toISOString();
    const msg: StoredMessage = {
      id: ulid(),
      sessionId,
      role,
      content: JSON.stringify(content),
      createdAt: now,
      tokenCount,
    };

    const txn = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at, token_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(msg.id, msg.sessionId, msg.role, msg.content, msg.createdAt,
             msg.tokenCount ?? null);

      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
        .run(now, sessionId);
    });
    txn();

    return msg;
  }

  getMessages(sessionId: string): StoredMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      tokenCount: row.token_count ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}

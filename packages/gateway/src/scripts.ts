import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SavedScript {
  name: string; description: string; intent: string;
  portable: boolean; version: number;
  parameters?: Record<string, unknown>;
  createdBy?: string; createdAt?: string;
}

export interface ScriptMeta {
  description: string; intent: string;
  portable?: boolean; parameters?: Record<string, unknown>;
  note?: string;
}

export class ScriptRegistry {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(name: string, script: string, meta: ScriptMeta, overwrite = false, sessionId?: string) {
    const scriptPath = join(this.dir, `${name}.ts`);
    const metaPath = join(this.dir, `${name}.meta.json`);

    if (existsSync(scriptPath) && !overwrite) {
      throw new Error(`Script "${name}" already exists. Use overwrite: true to update.`);
    }

    let version = 1;
    let changelog: any[] = [];
    let createdAt = new Date().toISOString();
    let createdBy = sessionId;

    if (existsSync(metaPath) && overwrite) {
      const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
      version = (existing.version ?? 0) + 1;
      changelog = existing.changelog ?? [];
      createdAt = existing.createdAt ?? createdAt;
      createdBy = existing.createdBy ?? createdBy;
      renameSync(scriptPath, join(this.dir, `${name}.prev.ts`));
    }

    const now = new Date().toISOString();
    changelog.push({
      version, at: now, by: sessionId ?? 'unknown',
      note: meta.note ?? (overwrite ? `Updated by ${sessionId ?? 'unknown'}` : 'Initial version'),
    });
    if (changelog.length > 20) changelog = changelog.slice(-20);

    const metaJson = {
      name, description: meta.description, intent: meta.intent,
      portable: meta.portable ?? true, version,
      parameters: meta.parameters,
      createdBy, createdAt,
      updatedBy: sessionId, updatedAt: now,
      changelog,
    };

    writeFileSync(scriptPath, script, 'utf-8');
    writeFileSync(metaPath, JSON.stringify(metaJson, null, 2), 'utf-8');
  }

  load(name: string): string {
    const p = join(this.dir, `${name}.ts`);
    if (!existsSync(p)) throw new Error(`Script "${name}" not found.`);
    return readFileSync(p, 'utf-8');
  }

  list(filter?: { intent?: string; query?: string }): SavedScript[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.meta.json'));
    let results: SavedScript[] = files.map(f => {
      const raw = JSON.parse(readFileSync(join(this.dir, f), 'utf-8'));
      return {
        name: raw.name, description: raw.description, intent: raw.intent,
        portable: raw.portable ?? true, version: raw.version ?? 1,
        parameters: raw.parameters, createdBy: raw.createdBy, createdAt: raw.createdAt,
      };
    });
    if (filter?.intent) results = results.filter(s => s.intent === filter.intent);
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      results = results.filter(s => s.name.includes(q) || s.description.toLowerCase().includes(q));
    }
    return results;
  }
}

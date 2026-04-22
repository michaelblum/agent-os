# Gateway Hardening — Design

**Date:** 2026-04-22
**Session:** gateway-hardening
**Status:** Draft for review
**Supersedes follow-on list from:** GH #102, commit 64d5a34

## Context

Issue #102 surfaced a class of gateway failures rooted in shared `~/.config/aos-gateway/` state: two gateways racing on the sqlite WAL + sdk.sock caused silent MCP hangs. Commit 64d5a34 landed the minimal fix — pidfile lock, fail-loud startup, `busy_timeout`, signal handlers — and deferred four improvements for a follow-up pass. This spec addresses all four together because they reinforce one another and each is small.

Scope: resilience + observability hardening for `packages/gateway/`. No tool surface changes to existing MCP tools. One new CLI subcommand: `./aos doctor gateway`.

## Goals

1. Eliminate state collisions between repo-mode (`npm run dev`) and installed-mode (MCP-spawned) gateways by isolating state per runtime mode.
2. Make gateway failures diagnosable after the fact — persistent rotated log file, readable without the gateway process running.
3. Provide a CLI-first health check (`./aos doctor gateway`) that both humans and agents can use to introspect live and post-mortem gateway state.
4. Prevent developer-convenience code paths (dist watcher) from killing the MCP server when they fail.

## Non-Goals

- No new MCP tools. CLI-first philosophy for local agent dev work (AGENTS.md). Agents call `./aos doctor gateway` via Bash, same as humans.
- No changes to coordination tool semantics (register_session, set_state, etc.).
- No migration of aos daemon state — only gateway state moves.
- No log aggregation, no structured tracing, no metrics. Just a rotated log file.

## Design

### 1. Mode-scoped state directories

State relocates from flat `~/.config/aos-gateway/` to mode-isolated paths under the existing `~/.config/aos/{mode}/` tree established by the `./aos` binary:

```
~/.config/aos/
  repo/
    gateway/
      gateway.db (+ -shm, -wal)
      sdk.sock
      scripts/
      gateway.pid
      gateway.log (+ .1, .2, .3 rotated)
  installed/
    gateway/
      <same layout>
```

This aligns with AGENTS.md's "new resource types inherit runtime mode isolation" rule. Gateway becomes a peer consumer under the same mode root as the daemon.

**Mode detection** happens at startup in a new `src/mode.ts`:

```ts
export function detectMode(scriptPath: string): 'repo' | 'installed';
```

Heuristic priority:

1. `AOS_MODE=repo|installed` env var — explicit override, wins if set and valid.
2. Git-ancestor check — walk upward from `scriptPath`; if any ancestor contains a `.git/` directory AND the nearest `package.json` names this package `aos-gateway`, return `'repo'`.
3. App-bundle / `~/.local/share/aos` path check — if `scriptPath` is inside a `.app` bundle or under a known installed-mode prefix, return `'installed'`.
4. Fallback: `'installed'` with a stderr warning noting the heuristic failed. Installed is the safe default because it isolates from dev work.

**Path derivation** centralizes in `src/paths.ts`:

```ts
export interface GatewayPaths {
  stateDir: string;
  dbPath: string;
  socketPath: string;
  scriptsDir: string;
  pidPath: string;
  logPath: string;
}

export function gatewayPaths(mode: 'repo' | 'installed'): GatewayPaths;
```

`src/index.ts` stops hardcoding `STATE_DIR`; it calls `detectMode()` + `gatewayPaths()` at startup.

### 2. One-shot migration of legacy state

New `src/migrate.ts`. Runs **after** logger creation but **before** pidfile lock acquisition, so migration events land in the log file AND any migration error surfaces cleanly without a half-initialized process.

**Startup order** in `src/index.ts`:

1. `detectMode(scriptPath)` → mode.
2. `gatewayPaths(mode)` → paths.
3. `mkdirSync(paths.stateDir, { recursive: true })`.
4. `createLogger({ logPath: paths.logPath, ... })` → logger.
5. `migrate({ legacyDir, target: paths.stateDir, logger })`.
6. `acquirePidLock(paths.pidPath)`.
7. `new CoordinationDB(paths.dbPath)`, `startSDKSocket({ socketPath: paths.socketPath, db })`.
8. Register tools, connect MCP transport, start dist watcher (repo mode only).

Logic:

```
LEGACY = ~/.config/aos-gateway
TARGET = gatewayPaths(mode).stateDir

if !exists(LEGACY):           no-op, return
if exists(TARGET) && hasSubstantiveFiles(TARGET):
    # hasSubstantiveFiles: any of gateway.db, sdk.sock, gateway.pid,
    # gateway.log, or non-empty scripts/ directory.
    # An empty TARGET dir created by a previous mkdirSync is not blocking.
    logger.error("legacy state at LEGACY but TARGET has existing state; manual resolution needed", { LEGACY, TARGET })
    process.exit(1)           (safety: never clobber fresh state)
if !exists(TARGET):
    mkdir -p TARGET
mv LEGACY/* TARGET/           (rename, not copy — same fs, atomic-ish)
rmdir LEGACY
log to stderr + log file: "migrated legacy state LEGACY → TARGET"
```

**Edge cases:**

- Legacy has stale pidfile pointing at dead process: carries over; singleton lock in new dir reclaims it identically to current behavior.
- Legacy DB open by a live old-version gateway: `mv` succeeds on macOS (inode kept alive via open fd); new gateway opens fresh handle in new dir, old one keeps writing to an unlinked inode until it dies. Documented, not blocker.
- Partial migration failure: no retry. User left in recoverable state with clear stderr. Re-running will attempt again.

**First-start-per-mode wins** the migration. If user runs repo mode first, legacy state lands at `aos/repo/gateway/`. Installed first → `aos/installed/gateway/`. Loud stderr names the destination so a wrong-mode migration can be corrected with one manual `mv`.

### 3. Logger + rotation

New `src/logger.ts`:

```ts
export function createLogger(opts: {
  logPath: string;
  maxBytes?: number;   // default 5 * 1024 * 1024
  keep?: number;        // default 3
  alsoStderr?: boolean; // default true
}): Logger;

export interface Logger {
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
  close(): void;
}
```

**Line format:** JSON Lines.

```json
{"ts":"2026-04-22T14:03:11.204Z","level":"error","msg":"init failed","meta":{"error":"..."}}
```

- First field always `ts` (ISO-8601) for eyeball sort and `jq` friendliness.
- `meta` is free-form object, omitted if absent.
- No ANSI colors in file output. Stderr output mirrors same JSON (simpler than two formatters; MCP client doesn't care).

**Rotation** on every write: stat the file, if `size >= maxBytes`, rotate synchronously before writing:

```
if exists(gateway.log.{keep}): unlink
for i in (keep-1) .. 1:
    if exists(gateway.log.{i}): rename → gateway.log.{i+1}
rename gateway.log → gateway.log.1
create new empty gateway.log
```

Synchronous rotation is acceptable because gateway log volume is low (startup, errors, tool-call failures). If volume ever rises, revisit with `pino` + `pino-roll`.

**Integration:** replace 8 existing `console.error(...)` sites in `src/index.ts` with `logger.info/warn/error`. Singleton errors, migration messages, init failures, dist-watcher warnings all flow through logger. Logger created after paths resolved but before pidfile lock, so pidfile errors ARE logged to file (best-effort; if file creation itself fails, stderr is always-on fallback).

### 4. `./aos doctor gateway` — CLI health tool

CLI-first for local agents (AGENTS.md). Agents reach it via Bash tool. No MCP surface.

**Swift side** (`src/aos/Commands/Doctor/GatewayCommand.swift`):

```
./aos doctor gateway [--quick] [--json | --pretty] [--tail N]
```

Responsibilities:
1. Resolve mode via existing `./aos` path-selection logic (the Swift binary already knows its mode).
2. Locate the node reporter: `<repo>/packages/gateway/dist/doctor.js` in repo mode; bundled path in installed mode.
3. Spawn `node <reporter> --mode <mode> <forwarded flags>`, pipe stdout + stderr back, exit with reporter exit code.
4. Register in `./aos doctor` parent command so `./aos doctor --help` lists `gateway` as a target.
5. `./aos --help` shows `doctor` subcommand with one-line description.
6. `./aos doctor gateway --help` enumerates flags and prints state dir + log path so agents can `cat` them on failure.

Estimated ~50 LoC Swift.

**Node side** (`packages/gateway/src/doctor.ts` + `packages/gateway/bin/doctor.ts` as entry):

Entry accepts `--mode`, `--quick`, `--json`, `--pretty`, `--tail N`. Default format: auto-detect `process.stdout.isTTY` — JSON if non-TTY (agent invocation), pretty text if TTY (human).

**Report shape:**

```ts
interface DoctorReport {
  mode: 'repo' | 'installed';
  state_dir: string;
  pidfile: { path: string; pid: number | null; alive: boolean | null };
  socket:   { path: string; exists: boolean; stat?: { mtime: string; size: number } };
  db:       {
    path: string;
    size_bytes: number;
    row_counts?: { sessions: number; messages: number; locks: number };
    integrity?: 'ok' | string;
  };
  log:      {
    path: string;
    size_bytes: number;
    rotations: number;            // count of gateway.log.{1..keep} present
    tail?: string[];              // raw log lines
  };
  sessions?: Array<{ name: string; role: string; harness: string; last_seen: string }>;
  lock_holders?: Array<{ key: string; owner: string; acquired: string; ttl: number | null }>;
  warnings: string[];
}
```

**Flags:**

- `--quick`: skip db open. Omits `row_counts`, `integrity`, `sessions`, `lock_holders`. For the "gateway won't start, is the db the problem?" case.
- `--json`: force JSON output even on TTY.
- `--pretty`: force text output even on non-TTY.
- `--tail N`: include last N log lines (across rotation boundaries if needed).

**Exit codes:**

- `0`: healthy. No warnings, no errors.
- `1`: warnings only (stale pidfile, missing socket, etc.). Agents can branch on this.
- `2`: hard errors (db corrupt, state dir unreadable).

**Liveness checks:**

- Pidfile alive: read pid, `kill(pid, 0)` — EPERM or success = alive, ESRCH = dead.
- Socket exists + stat succeeds: no handshake attempt (would require holding a live connection; out of scope).
- DB opened read-only, `PRAGMA integrity_check` only if `--quick` not set.

Estimated ~150 LoC Node.

### 5. Non-fatal dist watcher

Current `src/index.ts:136`:

```ts
watch(distDir, { recursive: true }, (_event, filename) => {
  if (notified || !filename?.endsWith('.js')) return;
  notified = true;
  console.error(`aos-gateway: dist changed (${filename}) — restart session to load new code`);
});
```

`watch()` can throw synchronously (EMFILE, ENOSPC, unsupported fs) or emit async `error` events (directory removed mid-session). Neither is currently handled — any failure crashes MCP.

Replacement:

```ts
if (mode === 'repo') {
  try {
    const watcher = watch(distDir, { recursive: true }, (_event, filename) => {
      if (notified || !filename?.endsWith('.js')) return;
      notified = true;
      logger.info('dist changed — restart session to load new code', { filename });
    });
    watcher.on('error', (err) => {
      logger.warn('dist watcher error (non-fatal)', { error: err.message });
      try { watcher.close(); } catch {}
    });
  } catch (err: any) {
    logger.warn('dist watcher unavailable (non-fatal)', { error: err.message });
  }
}
```

Also gated on `mode === 'repo'` — installed mode never rebuilds, watcher is pointless noise there.

## Testing

New test files under `packages/gateway/test/`, run via existing `npm test` (node --test).

### `test/mode.test.ts`

- Repo path (script under git checkout with `aos-gateway` package.json) → `'repo'`.
- Installed path (fake `.app` bundle in tmpdir) → `'installed'`.
- `AOS_MODE=repo` env set, installed-looking path → `'repo'` (env wins).
- Unknown path, no env → `'installed'` + warning captured.

### `test/paths.test.ts`

- `gatewayPaths('repo')` returns expected structure rooted at `~/.config/aos/repo/gateway/`.
- `gatewayPaths('installed')` returns equivalent rooted at `installed/`.
- All keys present, all paths absolute.

### `test/migrate.test.ts`

Tmpdir fixtures with injected `legacyDir` + `targetDir`:

- Legacy exists, target missing → mv succeeds, legacy gone, target populated with all files.
- Legacy exists, target has substantive state (e.g., existing gateway.db) → exits 1 with clear log error, legacy untouched.
- Legacy exists, target exists but empty (just a mkdir) → mv proceeds normally.
- Legacy exists, target contains only an empty scripts/ subdir → mv proceeds (scripts/ merged or replaced as appropriate).
- Legacy missing → no-op, returns cleanly.

### `test/logger.test.ts`

- Write past `maxBytes` (tiny override, e.g., 100 bytes) → rotation: `.log.1` appears, `.log` is new empty.
- Write past threshold twice → `.log.1` and `.log.2` present.
- Write past threshold `keep+1` times → `.log.{keep}` never exceeded.
- Write below threshold → no rotation.
- JSON line format: each line parses, has `ts` + `level` + `msg`.
- `close()` releases fd (attempt unlink on Linux/macOS; stat handle count on platforms that support it).

### `test/doctor.test.ts`

Tmpdir fake state dir, populated per case:

- Healthy (all files present, pidfile matches `process.pid`) → exit 0, all fields populated.
- Stale pidfile (pid doesn't exist) → `pidfile.alive=false`, warning, exit 1.
- Missing socket → warning, exit 1.
- Corrupt db (zero bytes written at db path) → integrity check fails, exit 2.
- `--quick` → `row_counts`, `integrity`, `sessions`, `lock_holders` absent.
- `--tail 5` → `log.tail.length <= 5`.
- `process.stdout.isTTY=false` stub → output parses as JSON.
- `process.stdout.isTTY=true` stub → output is text (contains known header strings).

### Swift-side shell test (`tests/doctor-gateway.sh`)

Runs `./aos doctor gateway --json` against a temp state dir, asserts exit code and that stdout parses as JSON with expected top-level keys. Requires `./aos` rebuild since this touches `src/`.

## Rollout

Single PR. Changes are self-contained:

- `packages/gateway/src/` — new files (`mode.ts`, `paths.ts`, `migrate.ts`, `logger.ts`, `doctor.ts`), edits to `index.ts`.
- `packages/gateway/bin/doctor.ts` — new entry point.
- `packages/gateway/test/` — five new test files.
- `src/aos/Commands/Doctor/GatewayCommand.swift` (or wherever existing doctor commands live — verify during implementation).
- `tests/doctor-gateway.sh` — integration test.

Migration is automatic on first gateway start after deploy. User running `npm run dev` first in repo mode will see legacy state migrate to `aos/repo/gateway/`; MCP-spawned installed gateway on next launch will find legacy already gone and proceed fresh in `aos/installed/gateway/`.

No breaking changes to MCP tool contracts. External consumers (other MCP clients) see identical tool behavior.

## Out of Scope (filed in `memory/scratchpad/gateway-hardening-followups.md`)

- Doc/help audit for recent changes (gateway singleton fix, issue-hygiene skill, etc.) — separate sweep.
- Meta-work on agent instructions to make CLI-first philosophy unmissable at design time.

# Gateway Hardening — Design

**Date:** 2026-04-22
**Session:** gateway-hardening
**Status:** Draft for review
**Supersedes follow-on list from:** GH #102, commit 64d5a34

## Context

Issue #102 surfaced a class of gateway failures rooted in shared `~/.config/aos-gateway/` state: two gateways racing on the sqlite WAL + sdk.sock caused silent MCP hangs. Commit 64d5a34 landed the minimal fix — pidfile lock, fail-loud startup, `busy_timeout`, signal handlers — and deferred four improvements for a follow-up pass. This spec addresses all four together because they reinforce one another and each is small.

Scope: resilience + observability hardening for `packages/gateway/`. **Both** package entry points — `src/index.ts` (MCP server) and `src/broker.ts` (integration HTTP broker) — move onto shared path/mode resolution and the new logger, so they can't drift into split-brain state. No tool surface changes to existing MCP tools. One new CLI subcommand form: `./aos doctor gateway`, added alongside the unchanged bare `./aos doctor`.

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

State relocates from flat `~/.config/aos-gateway/` to mode-isolated paths under the existing `${AOS_STATE_ROOT or ~/.config/aos}/{mode}/` tree established by the `./aos` binary:

```
${AOS_STATE_ROOT or ~/.config/aos}/
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

**Runtime env contract — canonical alignment.** Gateway MUST honor the same two env overrides as `./aos` (defined in `shared/swift/ipc/runtime-paths.swift`):

- `AOS_RUNTIME_MODE` (`repo` | `installed`) — explicit mode override. Wins over path inference.
- `AOS_STATE_ROOT` — absolute path override replacing `~/.config/aos` as the state root. Used by harness/test setups to sandbox state under a tmp root.

The gateway intentionally does NOT invent a separate `AOS_MODE` or state-root variable. Harness tests that set `AOS_STATE_ROOT=/tmp/test-root AOS_RUNTIME_MODE=repo` get both the daemon AND gateway landing under the same sandboxed tree, and `./aos doctor gateway` (which inherits the env) can inspect it.

**Mode detection** happens at startup in a new `src/mode.ts`:

```ts
export function detectMode(scriptPath: string, env: NodeJS.ProcessEnv = process.env): 'repo' | 'installed';
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string;  // respects AOS_STATE_ROOT, else ~/.config/aos
```

`detectMode` heuristic priority:

1. `AOS_RUNTIME_MODE=repo|installed` env var — explicit override, wins if set and valid.
2. Git-ancestor check — walk upward from `scriptPath`; if any ancestor contains a `.git/` directory AND the nearest `package.json` names this package `@agent-os/gateway`, return `'repo'`.
3. App-bundle / installed-prefix check — if `scriptPath` contains `.app/Contents/` or sits under `AOS_INSTALL_PATH`, return `'installed'`.
4. Fallback: `'installed'` with a stderr warning noting the heuristic failed. Installed is the safe default because it isolates from dev work.

(Mirrors `aosCurrentRuntimeMode` in `runtime-paths.swift:79` — env first, then path, then default.)

**Two entrypoints run concurrently.** Per ARCHITECTURE.md:207 and `docs/api/integration-broker.md:27`, the gateway package ships two peer processes that must be able to run at the same time:

- `src/index.ts` — MCP stdio server ("mcp" role).
- `src/broker.ts` — local integration HTTP server on port 47231 ("broker" role).

They **share** coordination state (the same SQLite db, scripts dir, state dir) because that's the whole point of coordination. They **do not share** process identity (pidfile, log file, and the MCP-only `sdk.sock`). This spec preserves concurrent-operation semantics — no one-process-per-mode change.

**Path derivation** centralizes in `src/paths.ts`:

```ts
// Shared across both roles. Identical resolution for mcp and broker.
export interface GatewayCommonPaths {
  stateDir: string;     // ${stateRoot(env)}/{mode}/gateway
  dbPath: string;       // ${stateDir}/gateway.db
  scriptsDir: string;   // ${stateDir}/scripts
}

// MCP server identity.
export interface McpPaths extends GatewayCommonPaths {
  socketPath: string;   // ${stateDir}/sdk.sock    (MCP only — broker uses TCP)
  pidPath: string;      // ${stateDir}/gateway.pid (preserves post-#102 name)
  logPath: string;      // ${stateDir}/gateway.log
}

// Broker identity.
export interface BrokerPaths extends GatewayCommonPaths {
  pidPath: string;      // ${stateDir}/broker.pid
  logPath: string;      // ${stateDir}/broker.log
}

export function commonPaths(mode: 'repo' | 'installed', env?: NodeJS.ProcessEnv): GatewayCommonPaths;
export function mcpPaths(mode: 'repo' | 'installed', env?: NodeJS.ProcessEnv): McpPaths;
export function brokerPaths(mode: 'repo' | 'installed', env?: NodeJS.ProcessEnv): BrokerPaths;
```

Layout on disk:

```
${stateRoot}/{mode}/gateway/
  gateway.db (+ -shm, -wal)   # shared
  scripts/                     # shared
  sdk.sock                     # mcp only
  gateway.pid                  # mcp only
  gateway.log (+ .1, .2, .3)   # mcp only
  broker.pid                   # broker only
  broker.log (+ .1, .2, .3)    # broker only
```

`src/index.ts` calls `mcpPaths()` and acquires the `gateway.pid` lock. `src/broker.ts` calls `brokerPaths()` and acquires the `broker.pid` lock. Both resolve to the same `dbPath`, so `CoordinationDB` opens are coordinated via sqlite WAL + `busy_timeout` rather than via pidfile. Split-brain cannot occur — they're deliberately operating on the same db.

### 2. One-shot migration of legacy state

New `src/migrate.ts`. Runs **before** any side effect that touches the target directory — including `mkdirSync(stateDir)` and logger creation — so the substantive-state check on the target is meaningful. Migration uses bootstrap stderr-only output (plain `console.error`); the rotating file logger comes up after migration. Migration messages are short and finite, so stderr-only is acceptable for this narrow window; the first post-migrate log line records what migration reported.

**Sandbox safety.** Migration is **disabled entirely when `AOS_STATE_ROOT` is set to an explicit override** (i.e., anything other than the default `~/.config/aos`). This mirrors the isolated-root model the `./aos` binary already uses (`aosHasExplicitStateRootOverride()` in `runtime-paths.swift:103`). Harness tests that set `AOS_STATE_ROOT=/tmp/test-root` MUST NOT touch or mutate a real developer's `~/.config/aos-gateway/` — they only interact with state under the overridden root. The Node-side check:

```ts
function hasExplicitStateRootOverride(env = process.env): boolean {
  const v = env.AOS_STATE_ROOT;
  if (!v) return false;
  return path.resolve(v) !== path.resolve(os.homedir(), '.config/aos');
}
```

When `hasExplicitStateRootOverride()` is true, `migrate()` short-circuits to `{ migrated: false, skipped: 'explicit-state-root-override' }` without reading or stat'ing the real legacy directory.

Tests that want to exercise migration explicitly construct `{ legacyDir, target }` as sibling tmpdirs and call `migrate()` directly with injected paths, bypassing the env-based entry point.

**Startup order** in both `src/index.ts` and `src/broker.ts` (same skeleton, different role-specific paths):

1. `detectMode(scriptPath)` → mode. Resolve `mcpPaths(mode)` (or `brokerPaths(mode)`) → `paths`.
2. `migrate({ legacyDir: defaultLegacyDir(), target: paths.stateDir, env: process.env })`.
   *No mkdir on target yet; migration creates target via `mv` or `mkdir+mv` itself. This keeps the substantive-state guard honest. Migration no-ops under explicit `AOS_STATE_ROOT`.*
3. `mkdirSync(paths.stateDir, { recursive: true })` — idempotent; covers the clean-install case where migration no-oped and target still doesn't exist.
4. `createLogger({ logPath: paths.logPath, ... })` → logger. From this point forward, all startup diagnostics go through logger (stderr + file).
5. `logger.info("gateway starting", { mode, role, stateDir, pidPath, logPath, migrateResult })` where `role` is `"mcp"` or `"broker"`.
6. `acquirePidLock(paths.pidPath)` — per-role pidfile, so concurrent MCP + broker do not collide.
7. Role-specific init:
   - MCP: `new CoordinationDB(paths.dbPath)`, `startSDKSocket({ socketPath: paths.socketPath, db })`.
   - Broker: `new CoordinationDB(paths.dbPath)`, `new IntegrationBroker({ db, ... })`, `startIntegrationHttpServer({ broker, port, ... })`, `slackProvider.start()`.
8. Register MCP tools + connect transport (MCP only); start dist watcher in repo mode (MCP only — broker doesn't need it).

Migration logic (step 2, before any mkdir on target):

```
if hasExplicitStateRootOverride(env):
    return { migrated: false, skipped: 'explicit-state-root-override' }

LEGACY = ~/.config/aos-gateway
TARGET = paths.stateDir

if !exists(LEGACY):
    return { migrated: false, skipped: 'no-legacy' }
if exists(TARGET) && hasSubstantiveFiles(TARGET):
    # hasSubstantiveFiles: any of gateway.db, sdk.sock, scripts/**, gateway.pid,
    # broker.pid, gateway.log, broker.log. An empty-or-only-mkdir TARGET passes.
    console.error("aos-gateway: legacy state at LEGACY but TARGET has existing state; manual resolution needed")
    process.exit(1)

if !exists(TARGET):
    mkdir -p TARGET
for entry in readdir(LEGACY):
    try: rename(LEGACY/entry, TARGET/entry)
    catch ENOENT: ignore            # another concurrent migrator got it first
    catch EEXIST:
        # target already has this entry — only possible in concurrent-start race
        # where the other entrypoint already placed it. Leave legacy copy alone.
        continue
try: rmdir(LEGACY)
catch ENOTEMPTY | ENOENT: ignore    # concurrent migrator or partial-leftover case

console.error("aos-gateway: migrated legacy state LEGACY → TARGET")
return { migrated: true }
```

**Concurrent-start tolerance.** MCP and broker may start within milliseconds of each other and both enter migration. The renames are per-file atomic, and both ENOENT (lost the race for this file) and EEXIST (partner already placed it) are swallowed. The final rmdir tolerates `ENOTEMPTY` for the case where the concurrent migrator hasn't finished yet. End state: all legacy files in TARGET, LEGACY removed by whichever rmdir wins. No locking primitives needed.

The substantive-state guard still protects against the user pre-populating TARGET manually between starts, which is the failure mode worth hard-exiting on.

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

**Integration:** replace existing `console.error(...)` sites in `src/index.ts` (and the handful in `src/broker.ts`) with `logger.info/warn/error`. Singleton errors, init failures, dist-watcher warnings, broker lifecycle events all flow through logger. Pre-migration bootstrap messages stay on `console.error` (stderr only) as noted in section 2.

### 4. `./aos doctor gateway` — CLI health tool

CLI-first for local agents (AGENTS.md). Agents reach it via Bash tool. No MCP surface.

**Backward compatibility with existing `./aos doctor`.** Today `./aos doctor [--json]` is a flat command implemented in `src/commands/operator.swift:274` (`doctorCommand`) and registered in `src/shared/command-registry-data.swift:931` as a single `InvocationForm` reporting daemon/permissions/service state. It is consumed programmatically by `packages/gateway/src/aos-proxy.ts:177` (`runAos(['doctor', '--json'], ...)`). This contract MUST be preserved:

- **Bare `./aos doctor`** and **`./aos doctor --json`** retain identical behavior, output schema, and exit codes. No field renames, no new fields. `aos-proxy.ts` keeps working unchanged.
- **`./aos doctor gateway [flags]`** is added as a SECOND invocation form under the same `doctor` command path. Parsing: if first positional arg is `gateway`, route to the new subcommand; otherwise route to existing `doctorCommand` as today. Unknown-flag rejection in the existing path stays unchanged (the `gateway` token is consumed before flag validation).
- `command-registry-data.swift` gets a second `InvocationForm` under the same `CommandDescriptor(path: ["doctor"], ...)` — one form for `aos doctor [--json]`, one for `aos doctor gateway [--quick] [--json|--pretty] [--tail N]`. Both surface in `./aos doctor --help`.

No rename or alias plan needed — existing consumers untouched, new form is purely additive.

**Swift side** (new file, likely `src/commands/doctor-gateway.swift` or a subsection of existing operator.swift — confirmed during implementation):

```
./aos doctor gateway [--quick] [--json | --pretty] [--tail N]
```

Responsibilities:
1. Resolve mode via the existing `aosCurrentRuntimeMode()` helper in `shared/swift/ipc/runtime-paths.swift` (honors `AOS_RUNTIME_MODE`).
2. Resolve state root via existing `aosStateRoot()` (honors `AOS_STATE_ROOT`).
3. Locate the node reporter binary. In repo mode: `<repo>/packages/gateway/dist/doctor-cli.js`. In installed mode: bundled under the `.app` (path TBD by packaging — use `aosInstallAppPath()` as base and define one conventional subpath).
4. Spawn `node <reporter> --mode <mode> --state-root <aosStateRoot()> <forwarded flags>`, pipe stdout + stderr back, exit with reporter exit code. Forwarding `--state-root` means the reporter doesn't have to re-read env (though it also reads env as a fallback so it works when invoked directly outside `./aos`).
5. `./aos doctor --help` lists `gateway` as an optional first-positional target (per the command-registry addition above).
6. `./aos doctor gateway --help` enumerates flags and prints resolved state dir + log path so agents can `cat` them on failure.

Estimated ~50–80 LoC Swift.

**Node side** — reporter + CLI entry both live under `src/` so the existing tsconfig (which compiles `src/**/*` only) covers them with no config changes:

- `packages/gateway/src/doctor.ts` — pure reporter module. Exports `collectReport(mode, env): Promise<DoctorReport>` (internally calls both `mcpPaths()` and `brokerPaths()` and fills in per-role blocks) and `renderText(report): string`.
- `packages/gateway/src/doctor-cli.ts` — CLI entry with `#!/usr/bin/env node` shebang. Parses argv (`--mode`, `--state-root`, `--quick`, `--json`, `--pretty`, `--tail N`), resolves mode/state-root (flag > env), calls reporter, renders output, sets exit code.

**`package.json` edits in rollout:**

- Add `"aos-gateway-doctor": "dist/doctor-cli.js"` to the existing `bin` map (next to `"aos-gateway": "dist/index.js"`). Gives an npm-installable CLI name for standalone invocation outside `./aos` (useful for hermetic tests and for the case where the Swift binary isn't available).
- Add `"doctor": "node dist/doctor-cli.js"` to `scripts`.
- `build` script (`tsc`) already covers the new files since they're under `src/`.

No `tsconfig.json` edits required.

Entry accepts `--mode`, `--state-root`, `--quick`, `--json`, `--pretty`, `--tail N`. Default format: auto-detect `process.stdout.isTTY` — JSON if non-TTY (agent invocation via `./aos` or Bash pipe), pretty text if TTY (human terminal).

**Report shape.** Reflects the two-role reality: one shared block, one per-role block for mcp and broker. Shared state (db, scripts) is reported once; identity fields (pidfile, log file) are reported per role. `socket` is mcp-only.

```ts
interface ProcessBlock {
  role: 'mcp' | 'broker';
  pidfile: { path: string; pid: number | null; alive: boolean | null };
  log:     {
    path: string;
    size_bytes: number;
    rotations: number;           // count of <name>.log.{1..keep} present
    tail?: string[];             // raw log lines
  };
  socket?: { path: string; exists: boolean; stat?: { mtime: string; size: number } }; // mcp only
}

interface DoctorReport {
  mode: 'repo' | 'installed';
  state_root: string;           // resolved from AOS_STATE_ROOT or default
  state_dir: string;            // shared gateway/ subdir under state root
  scripts_dir: string;
  db: {
    path: string;
    size_bytes: number;
    row_counts?: { sessions: number; messages: number; locks: number };
    integrity?: 'ok' | string;
  };
  processes: { mcp: ProcessBlock; broker: ProcessBlock };
  sessions?: Array<{ name: string; role: string; harness: string; last_seen: string }>;
  lock_holders?: Array<{ key: string; owner: string; acquired: string; ttl: number | null }>;
  warnings: string[];
}
```

**Flags:**

- `--quick`: skip db open. Omits `row_counts`, `integrity`, `sessions`, `lock_holders`. For the "gateway won't start, is the db the problem?" case.
- `--json`: force JSON output even on TTY.
- `--pretty`: force text output even on non-TTY.
- `--tail N`: include last N log lines per role (MCP + broker each tail separately). `N` is split across log + rotated log.N files if needed.

**Exit codes:**

- `0`: healthy. No warnings, no errors.
- `1`: warnings only (stale pidfile, missing socket, one role down but other up, etc.). Agents can branch on this.
- `2`: hard errors (db corrupt, state dir unreadable, both roles down but state indicates they should be up).

**Liveness checks (per role):**

- Pidfile alive: read pid from `${role}.pid`, `kill(pid, 0)` — EPERM or success = alive, ESRCH = dead → warning.
- Socket (mcp only): exists + stat succeeds; no handshake attempt (would require holding a live connection; out of scope).
- DB opened read-only once (shared across both role checks), `PRAGMA integrity_check` only if `--quick` not set.

Estimated ~150–200 LoC Node.

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

- Repo path (script under git checkout with `@agent-os/gateway` package.json) → `'repo'`.
- Installed path (fake `.app` bundle in tmpdir) → `'installed'`.
- `AOS_RUNTIME_MODE=repo` env set, installed-looking path → `'repo'` (env wins).
- `AOS_RUNTIME_MODE=installed` env set, repo-looking path → `'installed'` (env wins).
- Unknown path, no env → `'installed'` + warning captured.

### `test/paths.test.ts`

- `commonPaths('repo')` with no env override → `~/.config/aos/repo/gateway/` + `gateway.db` + `scripts/`.
- `commonPaths('installed')` with no env override → `~/.config/aos/installed/gateway/` equivalents.
- `AOS_STATE_ROOT=/tmp/x` → `commonPaths('repo').stateDir` is `/tmp/x/repo/gateway`.
- `mcpPaths('repo')` adds `sdk.sock`, `gateway.pid`, `gateway.log`; all inside `stateDir`.
- `brokerPaths('repo')` adds `broker.pid`, `broker.log`; no `socketPath`; all inside `stateDir`.
- `mcpPaths('repo').dbPath === brokerPaths('repo').dbPath` (shared db).
- `mcpPaths('repo').pidPath !== brokerPaths('repo').pidPath` (distinct identities).

### `test/migrate.test.ts`

Tmpdir fixtures with injected `legacyDir` + `targetDir` (bypassing env to exercise migrate() directly):

- Legacy exists, target missing → mv succeeds, legacy gone, target populated with all files. Returns `{ migrated: true }`.
- Legacy exists, target has substantive state (e.g., existing gateway.db) → exits 1 with clear stderr, legacy untouched.
- Legacy exists, target exists but empty → mv proceeds normally.
- Legacy exists, target contains only an empty scripts/ subdir → mv proceeds.
- Legacy missing → no-op, returns `{ migrated: false, skipped: 'no-legacy' }`.
- Concurrent migration (two migrate() calls on same legacy/target, serialized or interleaved) → end state: legacy removed, all files in target, no thrown exception. Returns `{ migrated: true }` from whichever runner did real work.

Sandbox-safety tests (env-driven entry point):

- `hasExplicitStateRootOverride({ AOS_STATE_ROOT: '/tmp/x' })` → true; migration skipped, returns `{ migrated: false, skipped: 'explicit-state-root-override' }`.
- `hasExplicitStateRootOverride({})` → false.
- `hasExplicitStateRootOverride({ AOS_STATE_ROOT: '' })` → false (empty treated as unset, mirroring Swift helper).
- `hasExplicitStateRootOverride({ AOS_STATE_ROOT: path.join(os.homedir(), '.config/aos') })` → false (absolute default path, not an override). `AOS_STATE_ROOT` is an absolute-path contract per `runtime-paths.swift:96`; tilde-expanded strings aren't part of the contract and are out of scope.
- With `AOS_STATE_ROOT=/tmp/x` set, real `~/.config/aos-gateway` must NOT be stat'd. Test: stub `fs.statSync` / `fs.existsSync` on legacy path and assert it was never called.

### `test/logger.test.ts`

- Write past `maxBytes` (tiny override, e.g., 100 bytes) → rotation: `.log.1` appears, `.log` is new empty.
- Write past threshold twice → `.log.1` and `.log.2` present.
- Write past threshold `keep+1` times → `.log.{keep}` never exceeded.
- Write below threshold → no rotation.
- JSON line format: each line parses, has `ts` + `level` + `msg`.
- `close()` releases fd (attempt unlink on Linux/macOS; stat handle count on platforms that support it).

### `test/doctor.test.ts`

Tmpdir fake state dir, populated per case:

- Healthy (all files present, both mcp + broker pidfiles match real pids) → exit 0, `processes.mcp.pidfile.alive=true`, `processes.broker.pidfile.alive=true`, shared db row_counts populated.
- MCP up, broker down (broker.pid absent) → `processes.broker.pidfile.pid=null, alive=null`, warning, exit 1.
- Both pidfiles stale → both `.alive=false`, warnings, exit 1.
- Missing sdk.sock under mcp block → warning, exit 1. Broker block unaffected (socket is mcp-only).
- Corrupt db (zero bytes) → integrity fails, exit 2.
- `--quick` → `row_counts`, `integrity`, `sessions`, `lock_holders` absent; per-role `log.tail` still present if `--tail` given.
- `--tail 5` → `processes.mcp.log.tail.length <= 5` AND `processes.broker.log.tail.length <= 5`.
- `process.stdout.isTTY=false` stub → output parses as JSON.
- `process.stdout.isTTY=true` stub → output is text (contains known section headers for both roles).

### Swift-side shell test (`tests/doctor-gateway.sh`)

Runs under isolated root (`AOS_STATE_ROOT=<tmp>`, `AOS_RUNTIME_MODE=repo`):

- `./aos doctor gateway --json` → exit code, stdout parses as JSON, expected top-level keys present (`mode`, `state_root`, `state_dir`, `processes.mcp`, `processes.broker`, `db`).
- `./aos doctor --json` (bare form, no `gateway` arg) → output matches the pre-change schema byte-for-byte (or at least all pre-existing keys still present with same types) — regression guard for `aos-proxy.ts:177` consumer.
- Neither invocation writes to `~/.config/aos-gateway` or real `~/.config/aos` — assert via pre/post snapshot of those paths.

Requires `./aos` rebuild since this touches Swift in `src/`.

## Rollout

Single PR. Changes are self-contained:

**New files under `packages/gateway/src/` (all compile via existing tsconfig `include: ["src/**/*"]`):**

- `mode.ts` — `detectMode()`, `stateRoot()`, `hasExplicitStateRootOverride()`.
- `paths.ts` — `commonPaths()`, `mcpPaths()`, `brokerPaths()`.
- `migrate.ts` — one-shot legacy-state migration (sandbox-safe, concurrent-start tolerant).
- `logger.ts` — rotated JSON-lines logger with stderr mirror.
- `doctor.ts` — reporter module (pure, reusable).
- `doctor-cli.ts` — CLI entry with shebang, arg parsing, TTY-aware output.

**Edits to existing `packages/gateway/src/`:**

- `index.ts` (mcp role) — adopt startup order from section 2 using `mcpPaths()`; route logs through logger to `gateway.log`; pidfile at `gateway.pid`; gate + harden dist watcher.
- `broker.ts` (broker role) — adopt startup order from section 2 using `brokerPaths()`; stop hardcoding `~/.config/aos-gateway`; route logs through logger to `broker.log`; acquire pidfile at `broker.pid`. Broker does NOT start the SDK socket or the MCP stdio transport — only its HTTP server + Slack provider.

**`packages/gateway/package.json` edits:**

- Add `"aos-gateway-doctor": "dist/doctor-cli.js"` to `bin` map.
- Add `"doctor": "node dist/doctor-cli.js"` to `scripts`.
- No new runtime dependencies.

**No `packages/gateway/tsconfig.json` edits required** — new files all under `src/` which is already covered.

**New test files under `packages/gateway/test/`:**

- `mode.test.ts`, `paths.test.ts`, `migrate.test.ts`, `logger.test.ts`, `doctor.test.ts`.

**Swift-side changes under `src/`:**

- New command handler for `doctor gateway` (placement — new file `src/commands/doctor-gateway.swift` or added function alongside `doctorCommand` in `src/commands/operator.swift` — decided during implementation). Preserves existing `doctorCommand` flow identically for bare `aos doctor [--json]`.
- `src/shared/command-registry-data.swift` — add a second `InvocationForm` under the existing `doctor` `CommandDescriptor` for the `gateway [flags]` form. Bare `aos doctor [--json]` form stays unchanged.
- **Installed-mode reporter path concretization.** The Swift handler needs a concrete path to the Node reporter in installed mode (repo mode uses `<repo>/packages/gateway/dist/doctor-cli.js`). The packaging convention is not yet established in this repo for node-based gateway binaries — the implementation plan MUST resolve this before implementation begins. Two candidates to evaluate in plan-writing:
  - Bundle `dist/` under `<AOS.app>/Contents/Resources/gateway/dist/` and launch with the system `node`. Simpler, requires node on PATH.
  - Pre-bundle via `esbuild --bundle --platform=node` into a single `<AOS.app>/Contents/Resources/gateway/doctor-cli.cjs` and launch via `node` (no external deps). Larger artifact, no native bindings issue for `better-sqlite3` unless opted for the bundle route — which matters because doctor opens sqlite. Plan must call out the native-binding handling.
  The plan should pick one, justify, and list the packaging scripts / `build.sh` edits required. Spec does not prescribe — open decision flagged for plan phase.
- Requires `bash build.sh` to land (Swift change). Verification runs `./aos doctor --json` (must match prior output exactly) and `./aos doctor gateway --json` (new), both under isolated `AOS_STATE_ROOT`.

**New integration test:**

- `tests/doctor-gateway.sh` — runs `./aos doctor gateway --json` against a tmp state root (via `AOS_STATE_ROOT`), asserts exit code + JSON shape. Also asserts `./aos doctor --json` remains unchanged (a diff-against-golden or key-shape check).

**Migration behavior at deploy time:** automatic on first gateway start after deploy, in default-root operation only (not under `AOS_STATE_ROOT` override). Whichever of the two entry points (`index.ts` or `broker.ts`, repo or installed mode) starts first carries out the `~/.config/aos-gateway/` → `~/.config/aos/{mode}/gateway/` move. Concurrent starts are tolerated (ENOENT/EEXIST swallowed, section 2). Subsequent starts see legacy missing and proceed. Other-mode gateway starts with no legacy, fresh state directory.

**No breaking changes** to MCP tool contracts, `./aos doctor [--json]` output contract, or any external consumer. `aos-proxy.ts:177` continues to call `runAos(['doctor', '--json'], ...)` unchanged.

## Out of Scope (filed in `memory/scratchpad/gateway-hardening-followups.md`)

- Doc/help audit for recent changes (gateway singleton fix, issue-hygiene skill, etc.) — separate sweep.
- Meta-work on agent instructions to make CLI-first philosophy unmissable at design time.

# Gateway Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four #102 follow-ups from the gateway-hardening spec — mode-scoped state, rotated log file, `./aos doctor gateway` CLI health tool, non-fatal dist watcher — across both gateway entry points (MCP server + integration broker).

**Architecture:** Shared-path model with role-distinct process identity. New `src/mode.ts`, `src/paths.ts`, `src/migrate.ts`, `src/logger.ts`, `src/doctor.ts`, `src/doctor-cli.ts` under `packages/gateway/`. Both `src/index.ts` (mcp role, `gateway.pid`/`gateway.log`) and `src/broker.ts` (broker role, `broker.pid`/`broker.log`) adopt the new startup order. Doctor surfaces as `./aos doctor gateway`, added as a second `InvocationForm` under the existing `doctor` `CommandDescriptor` so bare `./aos doctor [--json]` remains byte-for-byte identical.

**Tech Stack:** TypeScript (`packages/gateway`, ES2022/NodeNext, existing `tsc` → `dist/`), Node `node --test` with `ts-node/esm` loader, Swift 5 under `src/` with the existing command registry + ArgumentParser-style dispatch.

**Spec:** `docs/superpowers/specs/2026-04-22-gateway-hardening-design.md`

---

## Decision 0: Installed-mode reporter packaging

This decision is locked in before implementation begins because it affects the Swift handler's spawn logic and any `build.sh` / packaging work.

**Decision: Option 1 — ship `packages/gateway/dist/` (plus `node_modules/better-sqlite3/build/Release/*.node`) under `<AOS.app>/Contents/Resources/gateway/` and launch with system `node`.**

Rationale:
- `better-sqlite3` is a native addon. `esbuild --bundle` cannot inline a `.node` binary, so Option 2 (single-file esbuild bundle) still requires shipping the native binding separately. Once that native binding must ride along, the bundling win disappears.
- Option 1 reuses the existing `tsc` output unchanged and requires no new build tool.
- System `node` is already a hard dependency for running the gateway at all (MCP spawns it). Assuming it's on PATH in installed mode matches how the gateway itself is launched.

Rejected: Option 2 (esbuild single-file bundle). Kept as fallback if native-binding wrangling proves tractable later; not part of this plan.

Packaging steps fold into Task 14 below.

---

## File structure

New files under `packages/gateway/src/`:
- `mode.ts` — runtime mode + state root resolution.
- `paths.ts` — path layouts per role.
- `migrate.ts` — legacy-state migration (sandbox-safe, concurrent-tolerant).
- `logger.ts` — rotated JSON-lines logger with stderr mirror.
- `doctor.ts` — reporter module (pure, reusable).
- `doctor-cli.ts` — CLI entry, TTY-aware output.

Edited files under `packages/gateway/src/`:
- `index.ts` — mcp startup order, harden dist watcher.
- `broker.ts` — broker startup order.

New test files under `packages/gateway/test/`:
- `mode.test.ts`, `paths.test.ts`, `logger.test.ts`, `migrate.test.ts`, `doctor.test.ts`.

Edits to `packages/gateway/package.json` (bin map + scripts).

New/edited files under repo `src/` (Swift):
- `src/commands/doctor-gateway.swift` (new) — subcommand handler.
- `src/shared/command-registry-data.swift` — add second `InvocationForm` under `doctor`.
- `src/commands/operator.swift` — route `doctor gateway` before the existing flat handler.

New shell test: `tests/doctor-gateway.sh`.

Packaging: `scripts/package-aos-runtime` updates to stage `dist/` + `better-sqlite3` native addon under `<AOS.app>/Contents/Resources/gateway/`. (`build.sh` only compiles `./aos`; it does not assemble the `.app`, so the gateway staging belongs in `scripts/package-aos-runtime`.)

---

## Pre-implementation: capture `./aos doctor --json` baseline

Task 13 (regression guard) diffs the live `./aos doctor --json` output against a reference fixture captured before any Swift-side change. Capture that fixture NOW, before Task 10/11 mutate the CLI path:

```bash
mkdir -p tests/fixtures
./aos doctor --json > tests/fixtures/doctor-before.json
# Quick sanity — confirm it parsed and has the expected top-level keys.
jq 'keys' tests/fixtures/doctor-before.json
```

Expected: at minimum `status`, `runtime`, `permissions` in the key list (current shape produced by `doctorCommand` in `src/commands/operator.swift:274+`). Commit the fixture with Task 13, not before — but CAPTURE the file up-front so later tasks can modify the code without losing the reference point.

---

## Testing conventions (applies to Tasks 1–7)

**Working directory.** All `npm test` and `node --test` commands below assume `cwd == packages/gateway/`. Prefix with `cd packages/gateway && ...` if running from repo root.

**Fail-first uses direct `node --test`, not `npm test`.** The package's `test` npm script is `node --test --loader ts-node/esm test/*.test.ts`. Because of the glob, `npm test -- test/mode.test.ts` expands to a command that runs the ENTIRE suite plus the new target — which (a) pollutes output with unrelated passing tests and (b) causes `node --test` to wrap the import failure as `ERR_TEST_FAILURE` instead of surfacing the literal `Cannot find module` error.

For fail-first verification, invoke the single target file directly (no glob, no npm-script wrapping):

```
node --test --loader ts-node/esm test/<name>.test.ts
```

Expected output for a missing-module fail-first: exit code non-zero; stderr/stdout mentions the target basename (e.g., `mode.js`) and one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. Either phrasing counts as proof the test cannot find the not-yet-implemented module.

**Pass step uses full `npm test`.** Once the implementation lands, run the full suite (not just the target) — it's cheap, catches ambient regressions eagerly, and matches the post-implementation checklist.

---

## Task 1: `src/mode.ts` — mode + state-root resolution

**Files:**
- Create: `packages/gateway/src/mode.ts`
- Test: `packages/gateway/test/mode.test.ts`

Implements `detectMode()`, `stateRoot()`, `hasExplicitStateRootOverride()`. Mirrors Swift helpers in `shared/swift/ipc/runtime-paths.swift:79, 96, 103`.

- [ ] **Step 1: Write failing tests**

Create `packages/gateway/test/mode.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { detectMode, stateRoot, hasExplicitStateRootOverride } from '../src/mode.js';

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('detectMode: AOS_RUNTIME_MODE=repo env wins over installed-looking path', () => {
  const installedPath = '/Applications/AOS.app/Contents/Resources/gateway/dist/index.js';
  assert.equal(detectMode(installedPath, { AOS_RUNTIME_MODE: 'repo' }), 'repo');
});

test('detectMode: AOS_RUNTIME_MODE=installed env wins over repo-looking path', () => {
  const repo = makeTmp('mode-repo-');
  try {
    mkdirSync(join(repo, '.git'));
    const pkgDir = join(repo, 'packages', 'gateway');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@agent-os/gateway' }));
    const scriptPath = join(pkgDir, 'dist', 'index.js');
    mkdirSync(join(pkgDir, 'dist'));
    writeFileSync(scriptPath, '');
    assert.equal(detectMode(scriptPath, { AOS_RUNTIME_MODE: 'installed' }), 'installed');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('detectMode: git ancestor with matching package.json → repo', () => {
  const repo = makeTmp('mode-repo-');
  try {
    mkdirSync(join(repo, '.git'));
    const pkgDir = join(repo, 'packages', 'gateway');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@agent-os/gateway' }));
    mkdirSync(join(pkgDir, 'dist'));
    const scriptPath = join(pkgDir, 'dist', 'index.js');
    writeFileSync(scriptPath, '');
    assert.equal(detectMode(scriptPath, {}), 'repo');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('detectMode: .app/Contents/ in path → installed', () => {
  const scriptPath = '/Users/x/Applications/AOS.app/Contents/Resources/gateway/dist/index.js';
  assert.equal(detectMode(scriptPath, {}), 'installed');
});

test('detectMode: unknown path + no env → installed (safe default)', () => {
  assert.equal(detectMode('/some/random/path/index.js', {}), 'installed');
});

test('stateRoot: no override → ~/.config/aos', () => {
  assert.equal(stateRoot({}), join(homedir(), '.config', 'aos'));
});

test('stateRoot: AOS_STATE_ROOT override resolved', () => {
  assert.equal(stateRoot({ AOS_STATE_ROOT: '/tmp/sandbox' }), '/tmp/sandbox');
});

test('hasExplicitStateRootOverride: unset → false', () => {
  assert.equal(hasExplicitStateRootOverride({}), false);
});

test('hasExplicitStateRootOverride: empty string → false', () => {
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: '' }), false);
});

test('hasExplicitStateRootOverride: default absolute path → false', () => {
  const defaultPath = join(homedir(), '.config', 'aos');
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: defaultPath }), false);
});

test('hasExplicitStateRootOverride: explicit non-default → true', () => {
  assert.equal(hasExplicitStateRootOverride({ AOS_STATE_ROOT: '/tmp/sandbox' }), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/gateway
node --test --loader ts-node/esm test/mode.test.ts
```

Expected: exit non-zero; output mentions `mode.js` + one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. (See "Testing conventions" above for why fail-first bypasses the `npm test` glob.)

- [ ] **Step 3: Implement `src/mode.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type RuntimeMode = 'repo' | 'installed';

export function detectMode(scriptPath: string, env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const envMode = env.AOS_RUNTIME_MODE?.toLowerCase();
  if (envMode === 'repo' || envMode === 'installed') return envMode;

  if (looksLikeRepo(scriptPath)) return 'repo';
  if (looksLikeInstalled(scriptPath, env)) return 'installed';

  process.stderr.write('aos-gateway: could not infer runtime mode, defaulting to installed\n');
  return 'installed';
}

function looksLikeRepo(scriptPath: string): boolean {
  let dir = dirname(resolve(scriptPath));
  let nearestPackage: string | undefined;

  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (!nearestPackage && existsSync(candidate)) nearestPackage = candidate;
    if (existsSync(join(dir, '.git'))) {
      if (!nearestPackage) return false;
      try {
        const pkg = JSON.parse(readFileSync(nearestPackage, 'utf8'));
        return pkg.name === '@agent-os/gateway';
      } catch {
        return false;
      }
    }
    dir = dirname(dir);
  }
  return false;
}

function looksLikeInstalled(scriptPath: string, env: NodeJS.ProcessEnv): boolean {
  if (scriptPath.includes('.app/Contents/')) return true;
  const installPath = env.AOS_INSTALL_PATH;
  if (installPath && scriptPath.startsWith(resolve(installPath))) return true;
  return false;
}

export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AOS_STATE_ROOT;
  if (override && override.length > 0) return resolve(override);
  return join(homedir(), '.config', 'aos');
}

export function hasExplicitStateRootOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.AOS_STATE_ROOT;
  if (!override || override.length === 0) return false;
  return resolve(override) !== join(homedir(), '.config', 'aos');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/mode.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/mode.ts packages/gateway/test/mode.test.ts
git commit -m "feat(gateway): runtime mode + state root resolution"
```

---

## Task 2: `src/paths.ts` — role-specific path layouts

**Files:**
- Create: `packages/gateway/src/paths.ts`
- Test: `packages/gateway/test/paths.test.ts`

Depends on Task 1.

- [ ] **Step 1: Write failing tests**

Create `packages/gateway/test/paths.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { commonPaths, mcpPaths, brokerPaths } from '../src/paths.js';

test('commonPaths: repo mode defaults to ~/.config/aos/repo/gateway', () => {
  const p = commonPaths('repo', {});
  assert.equal(p.stateDir, join(homedir(), '.config', 'aos', 'repo', 'gateway'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
  assert.equal(p.scriptsDir, join(p.stateDir, 'scripts'));
});

test('commonPaths: installed mode defaults to ~/.config/aos/installed/gateway', () => {
  const p = commonPaths('installed', {});
  assert.equal(p.stateDir, join(homedir(), '.config', 'aos', 'installed', 'gateway'));
});

test('commonPaths: AOS_STATE_ROOT shifts root', () => {
  const p = commonPaths('repo', { AOS_STATE_ROOT: '/tmp/x' });
  assert.equal(p.stateDir, join('/tmp/x', 'repo', 'gateway'));
});

test('mcpPaths: adds socket, gateway.pid, gateway.log inside stateDir', () => {
  const p = mcpPaths('repo', {});
  assert.equal(p.socketPath, join(p.stateDir, 'sdk.sock'));
  assert.equal(p.pidPath, join(p.stateDir, 'gateway.pid'));
  assert.equal(p.logPath, join(p.stateDir, 'gateway.log'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
});

test('brokerPaths: adds broker.pid, broker.log; no socketPath', () => {
  const p = brokerPaths('repo', {});
  assert.equal(p.pidPath, join(p.stateDir, 'broker.pid'));
  assert.equal(p.logPath, join(p.stateDir, 'broker.log'));
  assert.equal(p.dbPath, join(p.stateDir, 'gateway.db'));
  assert.equal((p as any).socketPath, undefined);
});

test('shared db path across roles', () => {
  const a = mcpPaths('repo', {});
  const b = brokerPaths('repo', {});
  assert.equal(a.dbPath, b.dbPath);
  assert.equal(a.scriptsDir, b.scriptsDir);
  assert.equal(a.stateDir, b.stateDir);
});

test('distinct pidfile paths across roles', () => {
  const a = mcpPaths('repo', {});
  const b = brokerPaths('repo', {});
  assert.notEqual(a.pidPath, b.pidPath);
  assert.notEqual(a.logPath, b.logPath);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --loader ts-node/esm test/paths.test.ts
```

Expected: exit non-zero; output mentions `paths.js` + one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. (See "Testing conventions" above.)

- [ ] **Step 3: Implement `src/paths.ts`**

```ts
import { join } from 'node:path';
import { stateRoot, type RuntimeMode } from './mode.js';

export interface GatewayCommonPaths {
  stateDir: string;
  dbPath: string;
  scriptsDir: string;
}

export interface McpPaths extends GatewayCommonPaths {
  socketPath: string;
  pidPath: string;
  logPath: string;
}

export interface BrokerPaths extends GatewayCommonPaths {
  pidPath: string;
  logPath: string;
}

export function commonPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): GatewayCommonPaths {
  const stateDir = join(stateRoot(env), mode, 'gateway');
  return {
    stateDir,
    dbPath: join(stateDir, 'gateway.db'),
    scriptsDir: join(stateDir, 'scripts'),
  };
}

export function mcpPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): McpPaths {
  const common = commonPaths(mode, env);
  return {
    ...common,
    socketPath: join(common.stateDir, 'sdk.sock'),
    pidPath: join(common.stateDir, 'gateway.pid'),
    logPath: join(common.stateDir, 'gateway.log'),
  };
}

export function brokerPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): BrokerPaths {
  const common = commonPaths(mode, env);
  return {
    ...common,
    pidPath: join(common.stateDir, 'broker.pid'),
    logPath: join(common.stateDir, 'broker.log'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/paths.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/paths.ts packages/gateway/test/paths.test.ts
git commit -m "feat(gateway): role-specific path layouts (mcp/broker)"
```

---

## Task 3: `src/logger.ts` — rotated JSON-lines logger

**Files:**
- Create: `packages/gateway/src/logger.ts`
- Test: `packages/gateway/test/logger.test.ts`

Independent of Tasks 1–2 (no imports from them), but needed before Tasks 4, 7.

- [ ] **Step 1: Write failing tests**

Create `packages/gateway/test/logger.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../src/logger.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'logger-')); }

test('JSON line has ts, level, msg', () => {
  const dir = makeTmp();
  try {
    const log = createLogger({ logPath: join(dir, 'out.log'), alsoStderr: false });
    log.info('hello', { k: 1 });
    log.close();
    const line = readFileSync(join(dir, 'out.log'), 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'hello');
    assert.deepEqual(parsed.meta, { k: 1 });
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('meta omitted when absent', () => {
  const dir = makeTmp();
  try {
    const log = createLogger({ logPath: join(dir, 'out.log'), alsoStderr: false });
    log.info('bare');
    log.close();
    const parsed = JSON.parse(readFileSync(join(dir, 'out.log'), 'utf8').trim());
    assert.equal('meta' in parsed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation on size threshold: .log.1 appears, .log is new', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 50, keep: 3, alsoStderr: false });
    for (let i = 0; i < 5; i++) log.info('padding to force rotation iteration ' + i);
    log.close();
    assert.ok(existsSync(path));
    assert.ok(existsSync(path + '.1'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation keeps at most `keep` rotated files', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 50, keep: 2, alsoStderr: false });
    for (let i = 0; i < 30; i++) log.info('padding padding padding padding iteration ' + i);
    log.close();
    assert.ok(existsSync(path + '.1'));
    assert.ok(existsSync(path + '.2'));
    assert.equal(existsSync(path + '.3'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no rotation below threshold', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'r.log');
    const log = createLogger({ logPath: path, maxBytes: 100 * 1024, keep: 3, alsoStderr: false });
    log.info('small');
    log.close();
    assert.equal(existsSync(path + '.1'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('levels: info, warn, error all emit', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'l.log');
    const log = createLogger({ logPath: path, alsoStderr: false });
    log.info('i'); log.warn('w'); log.error('e');
    log.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
    assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('close() flushes and releases handle', () => {
  const dir = makeTmp();
  try {
    const path = join(dir, 'c.log');
    const log = createLogger({ logPath: path, alsoStderr: false });
    log.info('x');
    log.close();
    // Allowed to fail on Windows; we're macOS/Linux only.
    rmSync(path);
    assert.equal(existsSync(path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --loader ts-node/esm test/logger.test.ts
```

Expected: exit non-zero; output mentions `logger.js` + one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. (See "Testing conventions" above.)

- [ ] **Step 3: Implement `src/logger.ts`**

```ts
import { appendFileSync, closeSync, existsSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';

export interface Logger {
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
  close(): void;
}

export interface LoggerOptions {
  logPath: string;
  maxBytes?: number;
  keep?: number;
  alsoStderr?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = opts.keep ?? 3;
  const alsoStderr = opts.alsoStderr ?? true;
  let fd: number | undefined;

  function open() {
    if (fd === undefined) fd = openSync(opts.logPath, 'a');
  }

  function rotate() {
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
    const rotated = (n: number) => `${opts.logPath}.${n}`;
    if (existsSync(rotated(keep))) unlinkSync(rotated(keep));
    for (let i = keep - 1; i >= 1; i--) {
      if (existsSync(rotated(i))) renameSync(rotated(i), rotated(i + 1));
    }
    if (existsSync(opts.logPath)) renameSync(opts.logPath, rotated(1));
  }

  function write(level: 'info' | 'warn' | 'error', msg: string, meta?: object) {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
    if (meta !== undefined) entry.meta = meta;
    const line = JSON.stringify(entry) + '\n';

    if (existsSync(opts.logPath)) {
      const size = statSync(opts.logPath).size;
      if (size + Buffer.byteLength(line, 'utf8') > maxBytes) rotate();
    }
    open();
    writeSync(fd!, line);
    if (alsoStderr) process.stderr.write(line);
  }

  return {
    info(msg, meta) { write('info', msg, meta); },
    warn(msg, meta) { write('warn', msg, meta); },
    error(msg, meta) { write('error', msg, meta); },
    close() { if (fd !== undefined) { try { closeSync(fd); } catch {} fd = undefined; } },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/logger.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/logger.ts packages/gateway/test/logger.test.ts
git commit -m "feat(gateway): rotated JSON-lines logger"
```

---

## Task 4: `src/migrate.ts` — sandbox-safe legacy migration

**Files:**
- Create: `packages/gateway/src/migrate.ts`
- Test: `packages/gateway/test/migrate.test.ts`

Depends on Task 1.

- [ ] **Step 1: Write failing tests**

Create `packages/gateway/test/migrate.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, migrateFromEnv } from '../src/migrate.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'mig-')); }
function seedLegacy(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gateway.db'), 'fake-db');
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'foo.ts'), 'export {};');
}

test('legacy exists, target missing → move succeeds', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    const result = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(result.migrated, true);
    assert.equal(existsSync(legacy), false);
    assert.ok(existsSync(join(target, 'gateway.db')));
    assert.ok(existsSync(join(target, 'scripts', 'foo.ts')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy exists, target has substantive state → exit 1 (throws)', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'gateway.db'), 'existing');
    assert.throws(
      () => migrate({ legacyDir: legacy, target, env: {}, exitFn: (code) => { throw new Error('EXIT:' + code); } }),
      /EXIT:1/,
    );
    assert.ok(existsSync(join(legacy, 'gateway.db'))); // untouched
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy exists, target is empty mkdir → move proceeds', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    mkdirSync(target);
    const result = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(result.migrated, true);
    assert.ok(existsSync(join(target, 'gateway.db')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy missing → no-op', () => {
  const root = makeTmp();
  try {
    const result = migrate({ legacyDir: join(root, 'nope'), target: join(root, 'target'), env: {} });
    assert.equal(result.migrated, false);
    assert.equal(result.skipped, 'no-legacy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('concurrent migrate: second call finds legacy already drained', () => {
  const root = makeTmp();
  try {
    const legacy = join(root, 'legacy');
    const target = join(root, 'target');
    seedLegacy(legacy);
    const first = migrate({ legacyDir: legacy, target, env: {} });
    const second = migrate({ legacyDir: legacy, target, env: {} });
    assert.equal(first.migrated, true);
    assert.equal(second.migrated, false);
    assert.equal(second.skipped, 'no-legacy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migrateFromEnv with AOS_STATE_ROOT set → sandbox-safe no-op, never stats legacy', () => {
  const root = makeTmp();
  try {
    const fakeLegacy = join(root, 'never-stat-me');
    // We deliberately do NOT create fakeLegacy. The contract: when
    // AOS_STATE_ROOT is set, migrate must not even check the legacy path.
    const statCalls: string[] = [];
    const result = migrateFromEnv({
      env: { AOS_STATE_ROOT: join(root, 'sandbox') },
      target: join(root, 'sandbox', 'repo', 'gateway'),
      legacyDirOverride: fakeLegacy,
      statFn: (p: string) => { statCalls.push(p); return undefined; },
    });
    assert.equal(result.migrated, false);
    assert.equal(result.skipped, 'explicit-state-root-override');
    assert.deepEqual(statCalls.filter((p) => p.includes('never-stat-me')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --loader ts-node/esm test/migrate.test.ts
```

Expected: exit non-zero; output mentions `migrate.js` + one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. (See "Testing conventions" above.)

- [ ] **Step 3: Implement `src/migrate.ts`**

```ts
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hasExplicitStateRootOverride } from './mode.js';

export interface MigrateResult {
  migrated: boolean;
  skipped?: 'no-legacy' | 'explicit-state-root-override';
}

export interface MigrateOptions {
  legacyDir: string;
  target: string;
  env: NodeJS.ProcessEnv;
  exitFn?: (code: number) => never;
}

const SUBSTANTIVE_FILES = [
  'gateway.db', 'gateway.db-wal', 'gateway.db-shm', 'sdk.sock',
  'gateway.pid', 'broker.pid', 'gateway.log', 'broker.log',
];

export function defaultLegacyDir(): string {
  return join(homedir(), '.config', 'aos-gateway');
}

export function hasSubstantiveFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  for (const name of SUBSTANTIVE_FILES) {
    if (existsSync(join(dir, name))) return true;
  }
  const scripts = join(dir, 'scripts');
  if (existsSync(scripts)) {
    try { if (readdirSync(scripts).length > 0) return true; } catch {}
  }
  return false;
}

export function migrate(opts: MigrateOptions): MigrateResult {
  const exit = opts.exitFn ?? (((code: number) => { process.exit(code); }) as (code: number) => never);

  if (!existsSync(opts.legacyDir)) {
    return { migrated: false, skipped: 'no-legacy' };
  }

  if (hasSubstantiveFiles(opts.target)) {
    process.stderr.write(
      `aos-gateway: legacy state at ${opts.legacyDir} but target ${opts.target} has existing state; manual resolution needed\n`,
    );
    exit(1);
    throw new Error('unreachable');
  }

  if (!existsSync(opts.target)) mkdirSync(opts.target, { recursive: true });

  let entries: string[];
  try { entries = readdirSync(opts.legacyDir); } catch { entries = []; }

  for (const name of entries) {
    try {
      renameSync(join(opts.legacyDir, name), join(opts.target, name));
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EEXIST') continue;
      throw err;
    }
  }

  try { rmdirSync(opts.legacyDir); }
  catch (err: any) { if (err?.code !== 'ENOENT' && err?.code !== 'ENOTEMPTY') throw err; }

  process.stderr.write(`aos-gateway: migrated legacy state ${opts.legacyDir} → ${opts.target}\n`);
  return { migrated: true };
}

export interface MigrateFromEnvOptions {
  env: NodeJS.ProcessEnv;
  target: string;
  legacyDirOverride?: string;
  statFn?: (path: string) => unknown;   // test hook
  exitFn?: (code: number) => never;
}

export function migrateFromEnv(opts: MigrateFromEnvOptions): MigrateResult {
  if (hasExplicitStateRootOverride(opts.env)) {
    return { migrated: false, skipped: 'explicit-state-root-override' };
  }
  const legacy = opts.legacyDirOverride ?? defaultLegacyDir();
  return migrate({ legacyDir: legacy, target: opts.target, env: opts.env, exitFn: opts.exitFn });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/migrate.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/migrate.ts packages/gateway/test/migrate.test.ts
git commit -m "feat(gateway): sandbox-safe legacy state migration"
```

---

## Task 5: `src/index.ts` — mcp startup order + harden dist watcher

**Files:**
- Modify: `packages/gateway/src/index.ts` (full rewrite of initialization block and dist watcher)

Depends on Tasks 1–4.

- [ ] **Step 1: Read current `src/index.ts`**

```bash
cat packages/gateway/src/index.ts
```

Confirm current structure: hardcoded `STATE_DIR`, pidLock, db + sdkServer init, tools registered, transport connect, dist watcher at end, shutdown handlers.

- [ ] **Step 2: Rewrite `src/index.ts`**

Replace the file with:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoordinationDB } from './db.js';
import { EngineRouter } from './engine/router.js';
import { NodeSubprocessEngine } from './engine/node-subprocess.js';
import { createLogger, type Logger } from './logger.js';
import { detectMode } from './mode.js';
import { migrateFromEnv } from './migrate.js';
import { mcpPaths } from './paths.js';
import { ScriptRegistry } from './scripts.js';
import { startSDKSocket } from './sdk-socket.js';
import { acquirePidLock, PeerAliveError, type PidLock } from './singleton.js';
import { registerCoordinationTools } from './tools/coordination.js';
import { registerExecutionTools } from './tools/execution.js';

const scriptPath = fileURLToPath(import.meta.url);
const mode = detectMode(scriptPath);
const paths = mcpPaths(mode);

const migrateResult = migrateFromEnv({ env: process.env, target: paths.stateDir });
mkdirSync(paths.stateDir, { recursive: true });

const logger: Logger = createLogger({ logPath: paths.logPath });
logger.info('gateway starting', {
  role: 'mcp',
  mode,
  stateDir: paths.stateDir,
  pidPath: paths.pidPath,
  logPath: paths.logPath,
  migrate: migrateResult,
});

let pidLock: PidLock | undefined;
try {
  pidLock = acquirePidLock(paths.pidPath);
} catch (err: any) {
  if (err instanceof PeerAliveError) {
    logger.error('peer gateway alive, exiting', { message: err.message });
  } else {
    logger.error('failed to acquire pidfile', { message: err.message });
  }
  logger.close();
  process.exit(1);
}

let db: CoordinationDB | undefined;
let sdkServer: ReturnType<typeof startSDKSocket> | undefined;
try {
  db = new CoordinationDB(paths.dbPath);
  sdkServer = startSDKSocket({ socketPath: paths.socketPath, db });
} catch (err: any) {
  logger.error('init failed', { message: err.message });
  pidLock?.release();
  logger.close();
  process.exit(1);
}

sdkServer!.on('error', (err: Error) => {
  logger.error('sdk socket error', { message: err.message });
  shutdown(1);
});

const engine = new NodeSubprocessEngine();
const router = new EngineRouter();
router.register(engine);
const registry = new ScriptRegistry(paths.scriptsDir);

const coordTools = registerCoordinationTools(db!);
const execTools = registerExecutionTools(router, registry, paths.socketPath);
const allHandlers: Record<string, (args: any) => any> = { ...coordTools, ...execTools };

const TOOL_DEFS = [
  { name: 'register_session', description: 'Register this agent session on the coordination bus.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, role: { type: 'string' }, harness: { type: 'string' },
      capabilities: { type: 'array', items: { type: 'string' } },
    }, required: ['name', 'role', 'harness'] } },
  { name: 'set_state', description: 'Write to the shared key-value store. Supports set, cas, acquire_lock, release_lock.',
    inputSchema: { type: 'object' as const, properties: {
      key: { type: 'string' }, value: {}, mode: { type: 'string', enum: ['set','cas','acquire_lock','release_lock'] },
      expected_version: { type: 'number' }, owner: { type: 'string' }, ttl: { type: 'number' },
    }, required: ['key'] } },
  { name: 'get_state', description: 'Read from the shared key-value store. Exact key or glob.',
    inputSchema: { type: 'object' as const, properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'post_message', description: 'Post a message to a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, payload: {}, from: { type: 'string' },
    }, required: ['channel', 'payload', 'from'] } },
  { name: 'read_stream', description: 'Read messages from a channel.',
    inputSchema: { type: 'object' as const, properties: {
      channel: { type: 'string' }, since: { type: 'string' }, limit: { type: 'number' },
    }, required: ['channel'] } },
  { name: 'who_is_online', description: 'List all sessions currently registered and online on the coordination bus.',
    inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'run_os_script', description: 'Execute a TS/JS script against the aos SDK. Runs off-stage.',
    inputSchema: { type: 'object' as const, properties: {
      script: { type: 'string' }, script_id: { type: 'string' }, params: { type: 'object' },
      intent: { type: 'string', enum: ['perception','action','coordination','mixed'] },
      timeout: { type: 'number' }, engine: { type: 'string', enum: ['auto','node-subprocess'] },
    } } },
  { name: 'save_script', description: 'Save a script for reuse.',
    inputSchema: { type: 'object' as const, properties: {
      name: { type: 'string' }, script: { type: 'string' }, description: { type: 'string' },
      intent: { type: 'string' }, portable: { type: 'boolean' },
      overwrite: { type: 'boolean' }, note: { type: 'string' },
    }, required: ['name', 'script', 'description', 'intent'] } },
  { name: 'list_scripts', description: 'List saved scripts.',
    inputSchema: { type: 'object' as const, properties: {
      intent: { type: 'string' }, query: { type: 'string' },
    } } },
  { name: 'discover_capabilities', description: 'Returns SDK namespaces and method signatures.',
    inputSchema: { type: 'object' as const, properties: { namespace: { type: 'string' } } } },
];

const server = new Server({ name: 'aos-gateway', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allHandlers[name];
  if (!handler) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
  try {
    const result = await handler(args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('aos-gateway started');

// Dist watcher — repo mode only, non-fatal.
let distWatcher: FSWatcher | undefined;
if (mode === 'repo') {
  const distDir = dirname(scriptPath);
  let notified = false;
  try {
    distWatcher = watch(distDir, { recursive: true }, (_event, filename) => {
      if (notified || !filename?.endsWith('.js')) return;
      notified = true;
      logger.info('dist changed — restart session to load new code', { filename });
    });
    distWatcher.on('error', (err) => {
      logger.warn('dist watcher error (non-fatal)', { error: err.message });
      try { distWatcher?.close(); } catch {}
    });
  } catch (err: any) {
    logger.warn('dist watcher unavailable (non-fatal)', { error: err.message });
  }
}

void sdkServer;

let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try { distWatcher?.close(); } catch {}
  try { sdkServer?.close(); } catch {}
  try { db?.close(); } catch {}
  try { pidLock?.release(); } catch {}
  try { logger.close(); } catch {}
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('exit', () => {
  try { pidLock?.release(); } catch {}
});
```

- [ ] **Step 3: Build and run existing tests**

```bash
cd packages/gateway
npm run build
npm test
```

Expected: build succeeds; existing singleton test still passes; new mode/paths/logger/migrate tests still pass.

- [ ] **Step 4: Smoke test gateway startup under isolated root**

```bash
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo node dist/index.js &
sleep 1
kill %1 2>/dev/null
ls /tmp/gwtest/repo/gateway/
rm -rf /tmp/gwtest
```

Expected: directory contains `gateway.log`, `gateway.pid` (may already be removed), `sdk.sock`, `gateway.db` (+ `-shm`, `-wal`).

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/index.ts
git commit -m "refactor(gateway): mcp role adopts shared paths + logger; non-fatal dist watcher"
```

---

## Task 6: `src/broker.ts` — broker startup order

**Files:**
- Modify: `packages/gateway/src/broker.ts`

Depends on Tasks 1–4.

- [ ] **Step 1: Rewrite `src/broker.ts`**

Replace the file with:

```ts
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoordinationDB } from './db.js';
import { loadGatewayEnv } from './env.js';
import { IntegrationBroker } from './integrations/broker.js';
import {
  buildPilotWorkflowCatalog,
  buildProviderCatalog,
  DEFAULT_SURFACES,
  loadLiveWorkflowCatalog,
  loadWikiIndex,
} from './integrations/catalog.js';
import { startIntegrationHttpServer } from './integrations/http-api.js';
import { SlackIntegrationProvider } from './integrations/providers/slack.js';
import { createLogger } from './logger.js';
import { detectMode } from './mode.js';
import { migrateFromEnv } from './migrate.js';
import { brokerPaths } from './paths.js';
import { acquirePidLock, PeerAliveError, type PidLock } from './singleton.js';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), '..');
const repoRoot = resolve(dirname(scriptPath), '..', '..', '..');

loadGatewayEnv(packageRoot);

const mode = detectMode(scriptPath);
const paths = brokerPaths(mode);

const migrateResult = migrateFromEnv({ env: process.env, target: paths.stateDir });
mkdirSync(paths.stateDir, { recursive: true });

const logger = createLogger({ logPath: paths.logPath });
logger.info('broker starting', {
  role: 'broker',
  mode,
  stateDir: paths.stateDir,
  pidPath: paths.pidPath,
  logPath: paths.logPath,
  migrate: migrateResult,
});

let pidLock: PidLock | undefined;
try {
  pidLock = acquirePidLock(paths.pidPath);
} catch (err: any) {
  if (err instanceof PeerAliveError) {
    logger.error('peer broker alive, exiting', { message: err.message });
  } else {
    logger.error('failed to acquire pidfile', { message: err.message });
  }
  logger.close();
  process.exit(1);
}

const db = new CoordinationDB(paths.dbPath);
const broker = new IntegrationBroker({
  db,
  repoRoot,
  brokerUrl: 'http://127.0.0.1:47231',
  surfaces: DEFAULT_SURFACES,
  providers: buildProviderCatalog({
    slackConfigured: Boolean(process.env.AOS_SLACK_BOT_TOKEN && process.env.AOS_SLACK_APP_TOKEN),
    slackEnabled: false,
  }),
  workflows: buildPilotWorkflowCatalog(),
  workflowRegistryLoader: loadLiveWorkflowCatalog,
  wikiIndexLoader: loadWikiIndex,
});
const slackProvider = new SlackIntegrationProvider({ broker });

async function main() {
  const requestedPort = Number(process.env.AOS_INTEGRATION_HTTP_PORT ?? '47231');
  const http = await startIntegrationHttpServer({
    broker,
    host: '127.0.0.1',
    port: Number.isFinite(requestedPort) ? requestedPort : 47231,
  });
  broker.setBrokerUrl(http.url);

  await slackProvider.start();

  logger.info('integration broker listening', { url: http.url });

  const shutdown = async () => {
    await slackProvider.stop();
    await new Promise<void>((resolveClose, rejectClose) => {
      http.server.close((error) => {
        if (error) { rejectClose(error); return; }
        resolveClose();
      });
    }).catch(() => undefined);
    db.close();
    try { pidLock?.release(); } catch {}
    try { logger.close(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

await main();
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 3: Smoke test broker startup under isolated root**

```bash
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo AOS_INTEGRATION_HTTP_PORT=48211 node dist/broker.js &
sleep 1
ls /tmp/gwtest/repo/gateway/
kill %1 2>/dev/null
rm -rf /tmp/gwtest
```

Expected: `broker.log`, `broker.pid`, `gateway.db` all present (shared db + role-specific pidfile/log).

- [ ] **Step 4: Smoke test concurrent operation**

```bash
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo AOS_INTEGRATION_HTTP_PORT=48211 node dist/broker.js &
BROKER_PID=$!
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo node dist/index.js &
MCP_PID=$!
sleep 1
ls /tmp/gwtest/repo/gateway/
kill $BROKER_PID $MCP_PID 2>/dev/null
rm -rf /tmp/gwtest
```

Expected: directory contains `gateway.pid`, `broker.pid`, `gateway.log`, `broker.log`, `sdk.sock`, `gateway.db` all at the same time. No errors in either log.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/broker.ts
git commit -m "refactor(gateway): broker role adopts shared paths + logger"
```

---

## Task 7: `src/doctor.ts` — reporter module

**Files:**
- Create: `packages/gateway/src/doctor.ts`
- Test: `packages/gateway/test/doctor.test.ts`

Depends on Tasks 1–3.

- [ ] **Step 1: Write failing tests**

Create `packages/gateway/test/doctor.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { collectReport, renderText } from '../src/doctor.js';

function makeTmp(): string { return mkdtempSync(join(tmpdir(), 'doc-')); }

// Mirrors real gateway schema (see packages/gateway/src/db.ts:199).
// Locks are modeled as state rows with non-null `owner`, not a separate table.
function seedShared(stateDir: string) {
  mkdirSync(join(stateDir, 'scripts'), { recursive: true });
  const db = new Database(join(stateDir, 'gateway.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE state (key TEXT PRIMARY KEY, owner TEXT, expires_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE integration_jobs (id TEXT PRIMARY KEY);
  `);
  db.close();
}

test('healthy: both roles alive', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'gateway.log'), '{"ts":"t","level":"info","msg":"m1"}\n{"ts":"t","level":"info","msg":"m2"}\n');
    writeFileSync(join(stateDir, 'broker.log'), '{"ts":"t","level":"info","msg":"b1"}\n');
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, true);
    assert.equal(report.processes.broker.pidfile.alive, true);
    assert.equal(report.processes.mcp.socket!.exists, true);
    assert.ok(report.db.row_counts);
    assert.equal(report.warnings.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mcp up, broker down → warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    // no broker.pid
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, true);
    assert.equal(report.processes.broker.pidfile.pid, null);
    assert.equal(report.processes.broker.pidfile.alive, null);
    assert.ok(report.warnings.some((w) => /broker/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stale pidfile → alive=false, warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), '999999');
    writeFileSync(join(stateDir, 'broker.pid'), '999998');
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.pidfile.alive, false);
    assert.equal(report.processes.broker.pidfile.alive, false);
    assert.ok(report.warnings.length >= 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing sdk.sock under mcp block → warning', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.equal(report.processes.mcp.socket!.exists, false);
    assert.ok(report.warnings.some((w) => /socket/.test(w)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('corrupt db → integrity failure', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    mkdirSync(join(stateDir, 'scripts'), { recursive: true });
    writeFileSync(join(stateDir, 'gateway.db'), 'not-a-db-file');
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    assert.notEqual(report.db.integrity, 'ok');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--quick: db fields omitted', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root }, { quick: true });
    assert.equal(report.db.row_counts, undefined);
    assert.equal(report.db.integrity, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--tail: per-role tail capped at N', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const lines = Array.from({ length: 20 }, (_, i) => `{"ts":"t","level":"info","msg":"m${i}"}`).join('\n') + '\n';
    writeFileSync(join(stateDir, 'gateway.log'), lines);
    writeFileSync(join(stateDir, 'broker.log'), lines);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root }, { tail: 5 });
    assert.ok(report.processes.mcp.log.tail!.length <= 5);
    assert.ok(report.processes.broker.log.tail!.length <= 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('renderText produces non-empty human-readable output', async () => {
  const root = makeTmp();
  try {
    const stateDir = join(root, 'repo', 'gateway');
    seedShared(stateDir);
    writeFileSync(join(stateDir, 'sdk.sock'), '');
    writeFileSync(join(stateDir, 'gateway.pid'), `${process.pid}`);
    writeFileSync(join(stateDir, 'broker.pid'), `${process.pid}`);
    const report = await collectReport('repo', { AOS_STATE_ROOT: root });
    const text = renderText(report);
    assert.ok(text.includes('mcp'));
    assert.ok(text.includes('broker'));
    assert.ok(text.includes(stateDir));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --loader ts-node/esm test/doctor.test.ts
```

Expected: exit non-zero; output mentions `doctor.js` + one of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or `MODULE_NOT_FOUND`. (See "Testing conventions" above.)

- [ ] **Step 3: Implement `src/doctor.ts`**

```ts
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import Database from 'better-sqlite3';
import { brokerPaths, mcpPaths, commonPaths } from './paths.js';
import { stateRoot, type RuntimeMode } from './mode.js';

export interface ProcessBlock {
  role: 'mcp' | 'broker';
  pidfile: { path: string; pid: number | null; alive: boolean | null };
  log: { path: string; size_bytes: number; rotations: number; tail?: string[] };
  socket?: { path: string; exists: boolean; stat?: { mtime: string; size: number } };
}

export interface DoctorReport {
  mode: RuntimeMode;
  state_root: string;
  state_dir: string;
  scripts_dir: string;
  db: {
    path: string;
    size_bytes: number;
    row_counts?: {
      sessions: number;
      state: number;
      messages: number;
      integration_jobs: number;
      locks_held: number;
    };
    integrity?: 'ok' | string;
  };
  processes: { mcp: ProcessBlock; broker: ProcessBlock };
  sessions?: Array<{ name: string; role: string; harness: string; last_seen: string }>;
  lock_holders?: Array<{ key: string; owner: string; acquired: string; ttl: number | null }>;
  warnings: string[];
  exit_code: 0 | 1 | 2;
}

export interface CollectOptions {
  quick?: boolean;
  tail?: number;
}

function readPidfile(path: string): { pid: number | null; alive: boolean | null } {
  if (!existsSync(path)) return { pid: null, alive: null };
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return { pid: null, alive: null };
    try { process.kill(pid, 0); return { pid, alive: true }; }
    catch (err: any) {
      if (err?.code === 'EPERM') return { pid, alive: true };
      return { pid, alive: false };
    }
  } catch { return { pid: null, alive: null }; }
}

function readLog(path: string, tail?: number) {
  if (!existsSync(path)) {
    return { path, size_bytes: 0, rotations: 0 };
  }
  const size_bytes = statSync(path).size;
  let rotations = 0;
  const dir = dirname(path);
  const base = basename(path);
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(base + '.')) rotations += 1;
    }
  } catch {}
  let tailLines: string[] | undefined;
  if (tail && tail > 0) {
    try {
      const all = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
      tailLines = all.slice(-tail);
    } catch {}
  }
  return tail ? { path, size_bytes, rotations, tail: tailLines ?? [] } : { path, size_bytes, rotations };
}

function mcpBlock(env: NodeJS.ProcessEnv, mode: RuntimeMode, opts: CollectOptions, warnings: string[]): ProcessBlock {
  const paths = mcpPaths(mode, env);
  const pidfile = { path: paths.pidPath, ...readPidfile(paths.pidPath) };
  if (pidfile.alive === false) warnings.push(`mcp pidfile ${paths.pidPath} references dead process ${pidfile.pid}`);
  if (pidfile.alive === null) warnings.push(`mcp pidfile absent or unreadable at ${paths.pidPath}`);
  const socketExists = existsSync(paths.socketPath);
  if (!socketExists && pidfile.alive) warnings.push(`mcp socket missing at ${paths.socketPath} though pidfile is live`);
  const socket: ProcessBlock['socket'] = { path: paths.socketPath, exists: socketExists };
  if (socketExists) {
    try {
      const s = statSync(paths.socketPath);
      socket.stat = { mtime: s.mtime.toISOString(), size: s.size };
    } catch {}
  }
  return { role: 'mcp', pidfile, log: readLog(paths.logPath, opts.tail), socket };
}

function brokerBlock(env: NodeJS.ProcessEnv, mode: RuntimeMode, opts: CollectOptions, warnings: string[]): ProcessBlock {
  const paths = brokerPaths(mode, env);
  const pidfile = { path: paths.pidPath, ...readPidfile(paths.pidPath) };
  if (pidfile.alive === false) warnings.push(`broker pidfile ${paths.pidPath} references dead process ${pidfile.pid}`);
  if (pidfile.alive === null) warnings.push(`broker pidfile absent or unreadable at ${paths.pidPath}`);
  return { role: 'broker', pidfile, log: readLog(paths.logPath, opts.tail) };
}

export async function collectReport(
  mode: RuntimeMode,
  env: NodeJS.ProcessEnv,
  opts: CollectOptions = {},
): Promise<DoctorReport> {
  const common = commonPaths(mode, env);
  const warnings: string[] = [];

  const db: DoctorReport['db'] = {
    path: common.dbPath,
    size_bytes: existsSync(common.dbPath) ? statSync(common.dbPath).size : 0,
  };

  let sessions: DoctorReport['sessions'];
  let lock_holders: DoctorReport['lock_holders'];

  if (!opts.quick && existsSync(common.dbPath)) {
    let handle: Database.Database | undefined;
    try {
      handle = new Database(common.dbPath, { readonly: true, fileMustExist: true });
      const integrity = handle.pragma('integrity_check', { simple: true }) as string;
      db.integrity = integrity === 'ok' ? 'ok' : String(integrity);
      try {
        // locks_held = state rows with non-null owner and not-yet-expired.
        // Mirrors gateway lock semantics (packages/gateway/src/db.ts:420–491).
        db.row_counts = {
          sessions: (handle.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any)?.n ?? 0,
          state: (handle.prepare('SELECT COUNT(*) AS n FROM state').get() as any)?.n ?? 0,
          messages: (handle.prepare('SELECT COUNT(*) AS n FROM messages').get() as any)?.n ?? 0,
          integration_jobs: (handle.prepare('SELECT COUNT(*) AS n FROM integration_jobs').get() as any)?.n ?? 0,
          locks_held: (handle.prepare(
            "SELECT COUNT(*) AS n FROM state WHERE owner IS NOT NULL AND (expires_at IS NULL OR expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)",
          ).get() as any)?.n ?? 0,
        };
      } catch (err: any) {
        warnings.push(`db row_counts unavailable: ${err.message}`);
      }
    } catch (err: any) {
      db.integrity = err.message || 'open_failed';
    } finally {
      try { handle?.close(); } catch {}
    }
  }

  const mcp = mcpBlock(env, mode, opts, warnings);
  const broker = brokerBlock(env, mode, opts, warnings);

  let exit_code: 0 | 1 | 2 = 0;
  if (db.integrity && db.integrity !== 'ok') exit_code = 2;
  else if (warnings.length > 0) exit_code = 1;

  return {
    mode,
    state_root: stateRoot(env),
    state_dir: common.stateDir,
    scripts_dir: common.scriptsDir,
    db,
    processes: { mcp, broker },
    sessions,
    lock_holders,
    warnings,
    exit_code,
  };
}

export function renderText(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`aos-gateway doctor  mode=${r.mode}  state_root=${r.state_root}`);
  lines.push(`state_dir=${r.state_dir}`);
  lines.push(`db=${r.db.path}  size=${r.db.size_bytes}B  integrity=${r.db.integrity ?? 'skipped'}`);
  if (r.db.row_counts) {
    const rc = r.db.row_counts;
    lines.push(
      `  row_counts: sessions=${rc.sessions} state=${rc.state} messages=${rc.messages} integration_jobs=${rc.integration_jobs} locks_held=${rc.locks_held}`,
    );
  }

  for (const [role, block] of Object.entries(r.processes) as Array<['mcp' | 'broker', ProcessBlock]>) {
    lines.push(`[${role}] pidfile=${block.pidfile.path} pid=${block.pidfile.pid ?? '-'} alive=${block.pidfile.alive ?? '-'}`);
    lines.push(`       log=${block.log.path} size=${block.log.size_bytes}B rotations=${block.log.rotations}`);
    if (block.socket) lines.push(`       socket=${block.socket.path} exists=${block.socket.exists}`);
    if (block.log.tail && block.log.tail.length > 0) {
      lines.push(`       tail:`);
      for (const t of block.log.tail) lines.push(`         ${t}`);
    }
  }

  if (r.warnings.length > 0) {
    lines.push(`warnings (${r.warnings.length}):`);
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  lines.push(`exit_code=${r.exit_code}`);
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- test/doctor.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/doctor.ts packages/gateway/test/doctor.test.ts
git commit -m "feat(gateway): doctor reporter module (dual-role report)"
```

---

## Task 8: `src/doctor-cli.ts` — CLI entry

**Files:**
- Create: `packages/gateway/src/doctor-cli.ts`

Depends on Task 7.

- [ ] **Step 1: Implement `src/doctor-cli.ts`**

```ts
#!/usr/bin/env node
import { collectReport, renderText } from './doctor.js';
import type { RuntimeMode } from './mode.js';

interface Args {
  mode?: RuntimeMode;
  stateRoot?: string;
  quick: boolean;
  json?: boolean;
  pretty?: boolean;
  tail?: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { quick: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': out.help = true; break;
      case '--quick': out.quick = true; break;
      case '--json': out.json = true; break;
      case '--pretty': out.pretty = true; break;
      case '--mode': {
        const v = argv[++i];
        if (v !== 'repo' && v !== 'installed') throw new Error(`--mode must be repo or installed (got ${v})`);
        out.mode = v; break;
      }
      case '--state-root': out.stateRoot = argv[++i]; break;
      case '--tail': {
        const n = Number.parseInt(argv[++i] ?? '', 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error('--tail requires positive integer');
        out.tail = n; break;
      }
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  const stateDirHint = process.env.AOS_STATE_ROOT ?? '~/.config/aos';
  process.stdout.write(`aos-gateway doctor

Usage: aos-gateway-doctor [--mode repo|installed] [--state-root PATH]
                          [--quick] [--json|--pretty] [--tail N]

Reports coordinated health of the gateway MCP server and integration broker.

Output format defaults to JSON on non-TTY, pretty text on TTY.

State root: ${stateDirHint}
  (override via --state-root or AOS_STATE_ROOT)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  if (args.stateRoot) process.env.AOS_STATE_ROOT = args.stateRoot;
  if (args.mode) process.env.AOS_RUNTIME_MODE = args.mode;

  const mode: RuntimeMode = args.mode ?? (process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo');

  const report = await collectReport(mode, process.env, { quick: args.quick, tail: args.tail });

  const useJson = args.json === true ? true : args.pretty === true ? false : !process.stdout.isTTY;
  if (useJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(renderText(report));
  process.exit(report.exit_code);
}

main().catch((err) => {
  process.stderr.write(`aos-gateway-doctor: ${err.message}\n`);
  process.exit(2);
});
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no type errors. `dist/doctor-cli.js` present.

- [ ] **Step 3: Smoke test the CLI**

```bash
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo node dist/doctor-cli.js --json | head -30
rm -rf /tmp/gwtest
```

Expected: JSON output with `mode: "repo"`, `state_root: "/tmp/gwtest"`, pidfiles reporting `pid: null, alive: null`, exit code 1 (warnings).

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/doctor-cli.ts
git commit -m "feat(gateway): doctor CLI entry (TTY-aware output, exit codes)"
```

---

## Task 9: `package.json` bin map + scripts

**Files:**
- Modify: `packages/gateway/package.json`

Depends on Task 8.

- [ ] **Step 1: Edit `package.json`**

Edit `"bin"` map and `"scripts"` block:

```json
"bin": {
  "aos-gateway": "dist/index.js",
  "aos-gateway-doctor": "dist/doctor-cli.js"
},
"scripts": {
  "build": "tsc",
  "dev": "tsc --watch",
  "test": "node --test --loader ts-node/esm test/*.test.ts",
  "start": "node dist/index.js",
  "start:broker": "node dist/broker.js",
  "doctor": "node dist/doctor-cli.js"
},
```

- [ ] **Step 2: Smoke test npm script**

```bash
cd packages/gateway
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo npm run doctor -- --json | head -10
rm -rf /tmp/gwtest
```

Expected: JSON output as in Task 8.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/package.json
git commit -m "chore(gateway): expose aos-gateway-doctor bin + npm doctor script"
```

---

## Task 10: Swift — register `doctor gateway` invocation form

**Files:**
- Modify: `src/shared/command-registry-data.swift` (around line 931)

- [ ] **Step 1: Read current `doctor` descriptor**

```bash
sed -n '930,945p' src/shared/command-registry-data.swift
```

Confirm the single `InvocationForm` structure shown in the spec.

- [ ] **Step 2: Edit the `doctor` descriptor**

Replace the existing `reg.append(CommandDescriptor(path: ["doctor"], ...)` block with:

```swift
    // ── doctor ────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["doctor"], summary: "Detailed runtime and permission diagnostics", forms: [
        InvocationForm(id: "doctor", usage: "aos doctor [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos doctor --json"]),
        InvocationForm(id: "doctor-gateway",
            usage: "aos doctor gateway [--quick] [--json|--pretty] [--tail N]",
            args: [
                pos("target", "Doctor target (must be 'gateway')",
                    type: .enumeration([EnumValue(value: "gateway", summary: "aos-gateway MCP + broker")])),
                flag("quick", "--quick", "Skip SQLite open and row counts", type: .bool),
                flag("json", "--json", "Force JSON output", type: .bool),
                flag("pretty", "--pretty", "Force human-readable output", type: .bool),
                flag("tail", "--tail", "Include last N log lines per role", type: .int),
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: [
                "aos doctor gateway",
                "aos doctor gateway --json --tail 20",
                "aos doctor gateway --quick",
            ])
    ]))
```

Helper reference (verified against live `src/shared/command-registry.swift` and `src/shared/command-registry-data.swift`):
- `pos(_ id: String, _ summary: String, type: ValueType = .string, required: Bool = true, ...)` — positional arg, identified by position.
- `flag(_ id: String, _ token: String, _ summary: String, type: ValueType = .string, required: Bool = false, default defaultVal: JSONValue? = nil, ...)`.
- `ValueType` cases: `.string, .int, .bool, .float, .json, .enumeration([EnumValue])` — note `.bool` (not `.boolean`) and `.int` (not `.integer`).
- `JSONValue` cases for defaults: `.string(...), .int(...), .float(...), .bool(...), .null`.
- `execReadOnly()`, `execMutating()`, `outJSON`, `outJSONFlag` already defined in the file.

- [ ] **Step 3: Build**

```bash
bash build.sh
```

Expected: build succeeds.

- [ ] **Step 4: Verify help still shows bare doctor + new form**

```bash
./aos doctor --help
```

Expected: usage shows both `aos doctor [--json]` and `aos doctor gateway [...]` forms.

- [ ] **Step 5: Verify bare `doctor --json` still works byte-for-byte like before**

```bash
AFTER="$(mktemp)"
./aos doctor --json > "$AFTER"
# Baseline fixture was captured up-front per the "Pre-implementation" section.
diff <(jq 'keys' tests/fixtures/doctor-before.json) <(jq 'keys' "$AFTER")
rm -f "$AFTER"
```

Expected: no diff in top-level keys. (If `tests/fixtures/doctor-before.json` is missing, STOP and re-capture per the "Pre-implementation" section before proceeding — the regression guard in Task 13 depends on this baseline.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/command-registry-data.swift
git commit -m "feat(cli): register 'aos doctor gateway' invocation form"
```

---

## Task 11: Swift — `doctor gateway` handler

**Files:**
- Create: `src/commands/doctor-gateway.swift`
- Modify: `src/commands/operator.swift` (`doctorCommand` routing)

- [ ] **Step 1: Read current `doctorCommand` routing**

```bash
sed -n '274,285p' src/commands/operator.swift
```

- [ ] **Step 2: Edit `doctorCommand` in `operator.swift`**

Insert the gateway-target shortcut at the top of `doctorCommand(args:)`:

```swift
func doctorCommand(args: [String]) {
    // Route `aos doctor gateway ...` to the gateway subcommand handler.
    if args.first == "gateway" {
        doctorGatewayCommand(args: Array(args.dropFirst()))
        return
    }
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["doctor"], json: args.contains("--json"))
        exit(0)
    }
    guard args.allSatisfy({ $0 == "--json" }) else {
        let unknown = args.first(where: { $0 != "--json" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(aosInvocationDisplayName()) doctor [--json]", code: "UNKNOWN_FLAG")
    }
    // ... rest unchanged
```

- [ ] **Step 3: Create `src/commands/doctor-gateway.swift`**

```swift
import Foundation

private func gatewayReporterPath(mode: AOSRuntimeMode) -> String {
    switch mode {
    case .repo:
        let exe = NSString(string: aosExecutablePath()).standardizingPath
        // ./aos lives at repo root; reporter at packages/gateway/dist/doctor-cli.js
        let repoRoot = (exe as NSString).deletingLastPathComponent
        return "\(repoRoot)/packages/gateway/dist/doctor-cli.js"
    case .installed:
        return "\(aosInstallAppPath())/Contents/Resources/gateway/dist/doctor-cli.js"
    }
}

func doctorGatewayCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        print("""
        Usage: aos doctor gateway [--quick] [--json|--pretty] [--tail N]

        Health report for aos-gateway (MCP server + integration broker).
        JSON output by default when stdout is non-TTY; pretty text on TTY.
        Exit codes: 0=healthy, 1=warnings, 2=hard errors.
        """)
        exit(0)
    }

    let mode = aosCurrentRuntimeMode()
    let reporter = gatewayReporterPath(mode: mode)

    guard FileManager.default.fileExists(atPath: reporter) else {
        exitError("aos-gateway doctor reporter not found at \(reporter). In repo mode, run `npm run -w packages/gateway build` first.", code: "REPORTER_MISSING")
    }

    var forwarded: [String] = ["--mode", mode.rawValue]
    let stateRoot = aosStateRoot()
    forwarded.append(contentsOf: ["--state-root", stateRoot])
    forwarded.append(contentsOf: args)

    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    task.arguments = ["node", reporter] + forwarded
    task.standardInput = FileHandle.nullDevice
    task.standardOutput = FileHandle.standardOutput
    task.standardError = FileHandle.standardError

    do { try task.run() }
    catch {
        exitError("failed to spawn gateway doctor reporter: \(error.localizedDescription)", code: "SPAWN_FAILED")
    }
    task.waitUntilExit()
    exit(task.terminationStatus)
}
```

- [ ] **Step 4: Build**

```bash
bash build.sh
```

Expected: build succeeds.

- [ ] **Step 5: End-to-end smoke test under isolated root**

```bash
cd packages/gateway && npm run build && cd -
AOS_STATE_ROOT=/tmp/gwtest AOS_RUNTIME_MODE=repo ./aos doctor gateway --json
rm -rf /tmp/gwtest
```

Expected: JSON report, exit code 1 (warnings — no gateway running). Confirm output has `mode: "repo"`, `state_root: "/tmp/gwtest"`, `processes.mcp.pidfile.alive: null`.

- [ ] **Step 6: Help discoverability check**

```bash
./aos --help | grep -i doctor
./aos doctor --help
./aos doctor gateway --help
```

Expected: `doctor` appears in `./aos --help` output; `./aos doctor --help` lists both invocation forms; `./aos doctor gateway --help` prints usage + exit-code legend.

- [ ] **Step 7: Commit**

```bash
git add src/commands/doctor-gateway.swift src/commands/operator.swift
git commit -m "feat(cli): aos doctor gateway handler spawns node reporter"
```

---

## Task 12: Integration test under isolated root

**Files:**
- Create: `tests/doctor-gateway.sh`

Depends on Task 11.

- [ ] **Step 1: Create `tests/doctor-gateway.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

export AOS_STATE_ROOT="$(mktemp -d -t aos-doctor-gateway)"
export AOS_RUNTIME_MODE=repo
trap 'rm -rf "$AOS_STATE_ROOT"' EXIT

# Snapshot pre-existing real state, to assert it is not touched.
LEGACY="$HOME/.config/aos-gateway"
LEGACY_BEFORE=""
if [[ -d "$LEGACY" ]]; then
  LEGACY_BEFORE="$(ls -la "$LEGACY")"
fi

echo "== bare ./aos doctor --json still works =="
./aos doctor --json | jq 'has("status") and has("runtime") and has("permissions")' | grep -q true

echo "== ./aos doctor gateway --json shape =="
OUT="$(./aos doctor gateway --json)"
echo "$OUT" | jq . > /dev/null           # parses as JSON
echo "$OUT" | jq -e '.mode == "repo"' > /dev/null
echo "$OUT" | jq -e '.state_root == env.AOS_STATE_ROOT' > /dev/null
echo "$OUT" | jq -e '.processes.mcp.pidfile | has("path")' > /dev/null
echo "$OUT" | jq -e '.processes.broker.pidfile | has("path")' > /dev/null

echo "== --quick omits db details =="
./aos doctor gateway --quick --json | jq -e '.db | has("integrity") | not' > /dev/null

echo "== sandbox safety: real legacy dir untouched =="
if [[ -n "$LEGACY_BEFORE" ]]; then
  LEGACY_AFTER="$(ls -la "$LEGACY")"
  [[ "$LEGACY_BEFORE" == "$LEGACY_AFTER" ]] || { echo "LEGACY state mutated under isolated root!"; exit 1; }
fi

echo "OK"
```

- [ ] **Step 2: Make it executable + run**

```bash
chmod +x tests/doctor-gateway.sh
bash tests/doctor-gateway.sh
```

Expected: prints "OK" and exits 0.

- [ ] **Step 3: Commit**

```bash
git add tests/doctor-gateway.sh
git commit -m "test(cli): integration test for aos doctor gateway under isolated root"
```

---

## Task 13: Backward-compat regression guard for `./aos doctor --json`

**Files:**
- Create: `tests/doctor-backcompat.sh`

- [ ] **Step 1: Verify the pre-flight baseline fixture is present**

The fixture at `tests/fixtures/doctor-before.json` must have been captured BEFORE Task 10/11 modified the CLI path — see the "Pre-implementation: capture `./aos doctor --json` baseline" section near the top of this plan.

```bash
test -f tests/fixtures/doctor-before.json && jq 'keys' tests/fixtures/doctor-before.json
```

Expected: the file exists and `jq` prints its top-level keys. If it is missing, STOP and capture it from a commit that pre-dates Task 10 (e.g., `git stash`, checkout the commit before Task 10, run `./aos doctor --json > tests/fixtures/doctor-before.json`, then return). Building a synthetic fixture from the documented shape is acceptable as a last resort — the check below asserts keys, not values, so any historical healthy run works.

- [ ] **Step 2: Create `tests/doctor-backcompat.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REFERENCE="tests/fixtures/doctor-before.json"
[[ -f "$REFERENCE" ]] || { echo "missing $REFERENCE — capture from main before landing this PR"; exit 1; }

CURRENT="$(mktemp)"
trap 'rm -f "$CURRENT"' EXIT

./aos doctor --json > "$CURRENT"

BEFORE="$(jq -S 'paths(scalars) | join(".")' "$REFERENCE" | sort -u)"
AFTER="$(jq -S 'paths(scalars) | join(".")' "$CURRENT" | sort -u)"

# Every path present before must still be present. New paths OK (additive).
MISSING="$(comm -23 <(echo "$BEFORE") <(echo "$AFTER") || true)"
if [[ -n "$MISSING" ]]; then
  echo "REGRESSION: missing paths in ./aos doctor --json output:"
  echo "$MISSING"
  exit 1
fi
echo "OK"
```

- [ ] **Step 3: Run**

```bash
chmod +x tests/doctor-backcompat.sh
bash tests/doctor-backcompat.sh
```

Expected: "OK".

- [ ] **Step 4: Commit**

```bash
git add tests/doctor-backcompat.sh tests/fixtures/doctor-before.json
git commit -m "test(cli): backward-compat regression guard for aos doctor --json"
```

---

## Task 14: Installed-mode packaging — stage gateway under `<AOS.app>`

**Files:**
- Modify: `scripts/package-aos-runtime` (this is the script that assembles `<DIST_DIR>/AOS.app`; `build.sh` only compiles `./aos`).

Orientation (already verified on main before this plan):
- `scripts/package-aos-runtime:10–14` defines `DIST_DIR`, `APP_DIR="$DIST_DIR/AOS.app"`, `CONTENTS_DIR`, `RESOURCES_DIR`.
- Line 26 announces "Packaging $APP_NAME.app..." and line 27 invokes `bash build.sh --release --no-restart` to produce `./aos`.
- Lines 30–37 create `MACOS_DIR`/`RESOURCES_DIR`, copy the binary, and stage Sigil resources under `$RESOURCES_DIR/agent-os/`.
- Line 39 writes `Info.plist`; line 70 signs. The gateway staging slots in after the Sigil copy and before the Info.plist write.

- [ ] **Step 1: Confirm the packaging layout is unchanged since this plan was written**

```bash
grep -n '^RESOURCES_DIR=\|^mkdir -p \\\|radial-menu-config.json\|cat >"$INFO_PLIST"' scripts/package-aos-runtime
```

Expected output includes `RESOURCES_DIR="$CONTENTS_DIR/Resources"` around line 14 and the existing Sigil `mkdir -p ... && cp ... radial-menu-config.json` block at ~34–37. If the script has been refactored, adapt the insertion point to where other resources under `$RESOURCES_DIR` are staged.

- [ ] **Step 2: Stage gateway under `$RESOURCES_DIR/gateway/`**

The staging needs:

1. `packages/gateway/dist/**` (the compiled TS output).
2. `packages/gateway/package.json` (so `require('better-sqlite3')` resolves in the installed layout).
3. `packages/gateway/node_modules/better-sqlite3/build/Release/*.node` (native addon — required because esbuild cannot inline `.node` binaries).
4. `packages/gateway/node_modules/better-sqlite3/lib/**` + `package.json` (the JS wrapper that loads the addon).

The Swift handler (Task 11) resolves the reporter at `$RESOURCES_DIR/gateway/dist/doctor-cli.js` in installed mode, so the layout below must match.

Edit `scripts/package-aos-runtime`. Insert the following block after the existing Sigil resource copy (after `cp "$REPO_ROOT/apps/sigil/radial-menu-config.json" ...`) and before `cat >"$INFO_PLIST" <<PLIST`:

```bash
# ── aos-gateway (MCP + broker) ─────────────────────────────────
# Plan: docs/superpowers/plans/2026-04-22-gateway-hardening.md (Task 14)
GATEWAY_SRC="$REPO_ROOT/packages/gateway"
GATEWAY_STAGE="$RESOURCES_DIR/gateway"

if [[ ! -d "$GATEWAY_SRC/dist" ]]; then
  echo "scripts/package-aos-runtime: building gateway dist (not present)" >&2
  (cd "$GATEWAY_SRC" && npm install --silent && npm run --silent build)
fi

mkdir -p "$GATEWAY_STAGE/dist"
rsync -a --delete "$GATEWAY_SRC/dist/" "$GATEWAY_STAGE/dist/"
cp "$GATEWAY_SRC/package.json" "$GATEWAY_STAGE/package.json"

# better-sqlite3 native addon + JS wrapper.
BSQLITE_SRC="$GATEWAY_SRC/node_modules/better-sqlite3"
if [[ ! -d "$BSQLITE_SRC/build/Release" ]]; then
  echo "scripts/package-aos-runtime: better-sqlite3 native addon missing at $BSQLITE_SRC/build/Release" >&2
  exit 1
fi
BSQLITE_DST="$GATEWAY_STAGE/node_modules/better-sqlite3"
mkdir -p "$BSQLITE_DST"
rsync -a --delete \
  --include='package.json' \
  --include='build/' --include='build/Release/' --include='build/Release/*.node' \
  --include='lib/' --include='lib/***' \
  --exclude='*' \
  "$BSQLITE_SRC/" "$BSQLITE_DST/"
```

Notes:
- `set -euo pipefail` is already active at the top of the script, so the missing-addon branch hard-fails — `better-sqlite3` is a runtime dependency of the doctor reporter. A silent skip would land a broken installed bundle.
- The rsync `--include`/`--exclude` ordering matters: parent directories (`build/`, `build/Release/`, `lib/`) must be explicitly included before their children match. `--delete` keeps re-runs idempotent.

- [ ] **Step 3: Repo-side build + local packaging run**

```bash
(cd packages/gateway && npm run build)
bash scripts/package-aos-runtime
DIST_APP="${AOS_DIST_DIR:-$PWD/dist}/AOS.app"
ls "$DIST_APP/Contents/Resources/gateway/dist/doctor-cli.js"
ls "$DIST_APP/Contents/Resources/gateway/node_modules/better-sqlite3/build/Release/"*.node
ls "$DIST_APP/Contents/Resources/gateway/node_modules/better-sqlite3/lib/"
ls "$DIST_APP/Contents/Resources/gateway/package.json"
```

Expected: each listing succeeds (doctor-cli.js present; at least one `.node` native addon under `Release/`; `lib/` present; staged `package.json` present).

- [ ] **Step 4: Installed-mode smoke test**

```bash
DIST_APP="${AOS_DIST_DIR:-$PWD/dist}/AOS.app"
AOS_STATE_ROOT=/tmp/gwtest-inst AOS_RUNTIME_MODE=installed "$DIST_APP/Contents/MacOS/aos" doctor gateway --json | jq .
rm -rf /tmp/gwtest-inst
```

Expected: JSON reports `mode: "installed"`, `state_root: "/tmp/gwtest-inst"`. The reporter path resolves to `$DIST_APP/Contents/Resources/gateway/dist/doctor-cli.js` (Task 11 handler). Exit code 1 (warnings — no gateway running).

If the smoke test fails with "reporter not found", re-check the `aosInstallAppPath()` helper in `shared/swift/ipc/` — it must return the `.app` path that `scripts/package-aos-runtime` produced (defaults to `$AOS_DIST_DIR/AOS.app` locally).

- [ ] **Step 5: Commit**

```bash
git add scripts/package-aos-runtime
git commit -m "build(package): stage gateway dist + better-sqlite3 native addon under AOS.app"
```

---

## Post-implementation checklist

- [ ] All `npm test` in `packages/gateway` pass.
- [ ] `bash build.sh` succeeds (compiles `./aos`).
- [ ] `bash scripts/package-aos-runtime` succeeds and stages `AOS.app/Contents/Resources/gateway/dist/doctor-cli.js` + `better-sqlite3` native addon.
- [ ] `bash tests/doctor-gateway.sh` passes.
- [ ] `bash tests/doctor-backcompat.sh` passes.
- [ ] `./aos doctor --json` output matches pre-change schema (checked by Task 13).
- [ ] `./aos doctor gateway --json` produces valid JSON with `processes.mcp` and `processes.broker` blocks.
- [ ] `./aos doctor gateway --help` prints exit-code legend.
- [ ] Under `AOS_STATE_ROOT=/tmp/x`, no read of `~/.config/aos-gateway/` occurs (verified in Task 12).
- [ ] MCP + broker can run concurrently in the same state dir with distinct pidfiles/logs (Task 6 smoke).
- [ ] Legacy migration moved `~/.config/aos-gateway/` on the first real default-root run (manual check — NOT under AOS_STATE_ROOT).

---

## Spec coverage cross-check

| Spec section | Tasks |
|---|---|
| §1 Mode-scoped state, `AOS_RUNTIME_MODE`/`AOS_STATE_ROOT` | 1, 2 |
| §2 One-shot migration + sandbox-safety + concurrent tolerance | 4 |
| §3 Logger + rotation | 3 |
| §4 `./aos doctor gateway` CLI (backward-compat, Swift wiring, Node reporter, flags, exit codes, TTY default) | 7, 8, 9, 10, 11 |
| §5 Non-fatal dist watcher | 5 |
| Rollout: both entry points adopt shared paths | 5, 6 |
| Rollout: package.json bin map + scripts | 9 |
| Rollout: Swift-side changes + integration test | 10, 11, 12 |
| Rollout: backward-compat regression guard | 13 |
| Rollout: installed-mode packaging path (Decision 0) | 14 |

All requirements accounted for.

# Input Tap Readiness Contract — Design

**Status:** Proposed
**Date:** 2026-04-24
**Scope:** Make the global input tap a first-class readiness signal across `aos service`, `aos permissions check`, `aos status`, `aos doctor`, the session-start hook, and the daemon auto-start path. Tightens the service-lifecycle exit contract so a daemon reachable but unable to create a working event tap is no longer classified as ready. Tracking: issue #109.

## Background

A repo-mode daemon started through `./aos service restart` can report as service-healthy while the critical global input tap is broken. Observed in #109:

- `./aos service restart` returns success based purely on launchd state.
- `./aos permissions check --json` returns `ready_for_testing: true` based on the **CLI process**'s `AXIsProcessTrusted()` and `CGPreflightScreenCaptureAccess()`.
- The **launchd-managed daemon**'s event tap fails silently (`Warning: CGEventTap failed — input tap unavailable (AX=false listen=false post=false); retrying on main run loop`) and keeps retrying indefinitely.
- `./aos status` does note the bad tap and demotes to `degraded`, but `degraded` is one undifferentiated bucket (stale canvases, ownership mismatches, legacy state, and broken input tap all share it).

The core defect is a source-of-truth mismatch. The CLI process and the launchd daemon are different processes with potentially different TCC grants; the readiness question is about the **daemon's** ability to observe input, but the answer is sourced from the **CLI's** preflights. Closing this gap requires three things: sourcing readiness from the daemon, giving the input-tap signal first-class structured visibility, and making service-lifecycle commands wait for the tap before claiming success.

## Goals

1. `./aos service install`, `service start`, and `service restart` block-and-poll the daemon's health after launchd kickstart. If the daemon is not reachable or its input tap is not active within a 5-second budget, exit non-zero with a structured, distinguishable response.
2. `./aos permissions check` sources `accessibility`, `listen_access`, `post_access`, and `input_tap.status` from the **daemon** when reachable, and falls back to the CLI's local preflights only when the daemon is unreachable.
3. `./aos status`, `./aos doctor`, and the session-start hook surface the input tap state as a named field, not as a line item inside a generic `degraded` note.
4. Provide consistent, explicit recovery guidance wherever a non-active tap is reported.
5. Regression coverage that exercises the service/readiness layer against a daemon reporting `input_tap.status != active` without requiring TCC manipulation or a launchd round-trip in CI.
6. Preserve the existing public contract (`status: ok|degraded`, existing flat `input_tap_status`/`input_tap_attempts` on `system.ping`) so current consumers do not break.

## Non-goals

- No new readiness taxonomy. Top-level `status` stays `ok|degraded`. No `degraded:input_tap` sub-state in the public contract.
- No new recovery automation command (no `./aos doctor recover input-tap`).
- No CLI verb rename.
- No event envelope changes. Request/response side only.
- No new Input Monitoring prompt flow inside `./aos permissions setup --once`. `IOHIDRequestAccess` is a clean follow-on if the operator surface shows the current manual path is painful.
- No `tccutil` invocations. Destructive; out of scope.
- `./aos service status` is **not** adopting the stricter exit-code contract. It remains read-only and non-failing on a bad tap. Only lifecycle commands that *claim to establish* readiness change behavior.

## Design

### Shape

Daemon is the source of truth. A small readiness probe wraps `system.ping`, classifies the response internally, and is consumed by every command that currently reports a readiness-like signal. The public contract stays `status: ok|degraded`; the new `input_tap` block is the structured first-class signal.

```
┌──────────────────────────────────────────────┐
│ Daemon (src/daemon/unified.swift)            │
│   system.ping → input_tap {...}, permissions │
└───────────────┬──────────────────────────────┘
                │
┌───────────────▼──────────────────────────────┐
│ Readiness probe (shared helper)              │
│   pings daemon, falls back to CLI-side       │
│   preflights when daemon unreachable         │
└────────┬────────┬───────────┬─────────┬──────┘
         │        │           │         │
  ┌──────▼──┐ ┌───▼────┐ ┌────▼───┐ ┌──▼──────┐
  │ service │ │ perms  │ │ status │ │ doctor  │
  │ install │ │ check  │ │        │ │         │
  │ /start/ │ │        │ │        │ │         │
  │ restart │ │        │ │        │ │         │
  └─────────┘ └────────┘ └────────┘ └─────────┘
```

Internal classifier names (`ready`, `inputTapInactive`, `socketUnreachable`) never appear in external output.

### `system.ping` extensions

`src/daemon/unified.swift` extends the `ping` response. Existing flat fields (`input_tap_status`, `input_tap_attempts`) are preserved byte-for-byte so current consumers continue to work; new nested blocks carry the full view.

```json
{
  "status": "ok",
  "uptime": 12345.0,
  "pid": 82838,
  "mode": "repo",
  "socket_path": "/Users/…/aos.sock",
  "started_at": "2026-04-24T…",
  "perception_channels": 2,
  "subscribers": 0,

  "input_tap_status": "retrying",
  "input_tap_attempts": 3,

  "input_tap": {
    "status": "retrying",
    "attempts": 3,
    "listen_access": false,
    "post_access": false,
    "last_error_at": "2026-04-24T…"
  },

  "permissions": {
    "accessibility": true,
    "screen_recording": true
  }
}
```

Field notes:

- `input_tap.status` mirrors the flat field. Values: `active`, `retrying`, `unavailable`.
- `input_tap.listen_access` and `input_tap.post_access` come from `CGPreflightListenEventAccess()` / `CGPreflightPostEventAccess()` called **from inside the daemon** at ping time. The CLI must not fabricate these.
- `input_tap.last_error_at` is an ISO-8601 timestamp set by `PerceptionEngine.logEventTapFailure`. It is `null` when no event tap failure has been recorded since daemon start. Always present; the schema has one shape.
- `permissions.accessibility` is `AXIsProcessTrusted()` called from inside the daemon. `permissions.screen_recording` is included only if a direct helper is already available in the daemon's imports; otherwise omitted from this block. The critical daemon-side signals for issue #109 are `accessibility`, `listen_access`, and `post_access` — `screen_recording` is a nice-to-have, not a blocker.

`shared/schemas/daemon-ipc.md` and `shared/schemas/daemon-response.schema.json` document the new fields. The flat keys remain documented and supported; no deprecation in this change.

### Service lifecycle (`service install` / `start` / `restart`)

Current flow (`src/commands/service.swift:134-155`): bootout (restart only) → install plist if missing → bootstrap → kickstart → emit launchd-only status. The emit happens regardless of whether the daemon actually came up or whether its input tap is working.

New flow introduces a single post-kickstart readiness path shared by all three entry points.

**Refactor.** Extract the probe as a private helper:

```swift
private enum ServiceReadinessOutcome {
    case ok(ping: [String: Any])
    case inputTapInactive(ping: [String: Any])
    case socketUnreachable
}

private func verifyServiceReadiness(
    mode: AOSRuntimeMode,
    budgetMs: Int = 5000
) -> ServiceReadinessOutcome
```

Implementation polls `system.ping` every 100 ms until:

- Socket unreachable at end of budget → `.socketUnreachable`
- Socket reachable and `input_tap.status == "active"` → `.ok(ping)`
- Socket reachable and `input_tap.status != "active"` at end of budget → `.inputTapInactive(ping)`

Restructure `installAOSService`, `startAOSService`, and the restart path (which composes stop + start) to all funnel through the same sequence:

1. Launchctl operations (install plist, bootstrap, kickstart).
2. `verifyServiceReadiness`.
3. Emit response.
4. Exit with the code from the table below.

The current `startAOSService` first-run fallback (`service.swift:138`) that delegates to `installAOSService` and returns must be reworked so the readiness probe is still reached on first install. `service install` used standalone gets the same contract: it also kickstarts and claims readiness.

**Exit-code contract.**

| Outcome                                          | Exit | `status`   | `reason`                  |
|--------------------------------------------------|:----:|------------|---------------------------|
| Launchctl bootstrap/kickstart failed             |  1   | `error`    | unchanged (existing path) |
| Socket never reachable within budget             |  1   | `degraded` | `socket_unreachable`      |
| Socket reachable, input tap not active           |  1   | `degraded` | `input_tap_not_active`    |
| Socket reachable, input tap active               |  0   | `ok`       | (field omitted)           |

The non-zero exit originates from the CLI lifecycle command only. The daemon process continues running under launchd; launchd's `KeepAlive` is orthogonal. A non-active tap does not cause launchd thrashing because the daemon process itself stays alive via its internal retry loop.

**Response shape** (extends `ServiceStatusResponse`):

```json
{
  "status": "degraded",
  "mode": "repo",
  "installed": true,
  "running": true,
  "pid": 82838,
  "launchd_label": "com.agent-os.aos.repo",
  "reason": "input_tap_not_active",
  "input_tap": { "status": "retrying", "attempts": 3,
                 "listen_access": false, "post_access": false },
  "recovery": [
    "./aos permissions setup --once",
    "./aos serve --idle-timeout none"
  ],
  "notes": [...]
}
```

- `reason` is present only when `status: "degraded"`.
- `input_tap` is forwarded from the daemon's ping. When the outcome is `.socketUnreachable`, the block is **omitted** (no daemon view, no CLI fabrication).
- `recovery` is present only when `status: "degraded"`. Content varies by context: after `service restart` the `./aos service restart` line is omitted; after `service install` or `service start` all three recovery lines appear.
- Text mode also prints the guidance block.

### Auto-start tolerance (`shared/swift/ipc/request-client.swift`)

`DaemonSession.connectWithAutoStart` currently spawns `aos service start --json` via `startManagedDaemon` and returns `false` when that command exits non-zero (`request-client.swift:88`). Under the new lifecycle contract, `service start` exits `1` for `input_tap_not_active` even though the socket is reachable. That would break auto-start for any non-input command (canvas ops, `see`, `listen`, etc.).

Change: drop the `proc.terminationStatus == 0` gate. Always fall through to the existing 3-second socket poll (`request-client.swift:64-68`). The socket poll becomes the arbiter of auto-start success. stderr is still captured and forwarded (useful diagnostic output), but exit code no longer gates.

Consequences:

- Non-input commands auto-start successfully even when the tap is `retrying`.
- Input commands (`do click`, `do type`, etc.) also auto-start successfully, then fail at their own `ensureInteractivePreflight` gate (below) with a tap-specific error — the correct layer for the message.
- A genuine launchd bootstrap failure is noticed by the 3-second socket-poll timeout. Slight latency penalty, no correctness impact.

### `permissions check` revisions

`src/commands/operator.swift` (currently reads `AXIsProcessTrusted()` + `CGPreflightScreenCaptureAccess()` from the CLI process only, at lines 510-515). New behavior:

1. When the daemon is reachable, ping it and source `accessibility`, `input_tap.*`, `listen_access`, `post_access` from the response.
2. Always compute the CLI-side view in parallel (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`, `CGPreflightListenEventAccess`, `CGPreflightPostEventAccess`).
3. Emit both views explicitly. Surface disagreements as a structured diff.

**Response shape:**

```json
{
  "status": "degraded",
  "permissions": {
    "accessibility": true,
    "screen_recording": true
  },
  "daemon_view": {
    "reachable": true,
    "accessibility": true,
    "input_tap": {
      "status": "retrying",
      "attempts": 3,
      "listen_access": false,
      "post_access": false
    }
  },
  "cli_view": {
    "accessibility": true,
    "screen_recording": true,
    "listen_access": true,
    "post_access": true
  },
  "requirements": [ ... existing + listen_access + post_access ... ],
  "setup": { ... existing ... },
  "missing_permissions": [...],
  "ready_for_testing": false,
  "ready_source": "daemon",
  "disagreement": {
    "listen_access": { "cli": true, "daemon": false },
    "post_access":   { "cli": true, "daemon": false }
  },
  "notes": [...]
}
```

**Top-level `permissions` field lineage.** The existing top-level `permissions` object (accessibility + screen_recording) remains **CLI-sourced** for back-compat — any existing consumer reading `permissions.accessibility` continues to see the CLI-process value. The authoritative readiness view is exposed through `daemon_view`, `cli_view`, and `ready_source`. Treating top-level `permissions` as CLI-sourced is consistent with its existing semantics (it has always been the CLI's view).

**`ready_for_testing` computation:**

- If daemon reachable: `daemon_view.accessibility && daemon_view.input_tap.status == "active" && setup.setup_completed`. `ready_source: "daemon"`. Note that `daemon_view.input_tap.status == "active"` already implies `listen_access` and `post_access` are functional — the daemon could not have created an active tap otherwise — so listen/post are not separate gate clauses.
- If daemon unreachable: `cli_view.accessibility && cli_view.screen_recording && setup.setup_completed`. `ready_source: "cli"`. Add note: "Daemon unreachable; readiness computed from CLI preflights only."

`missing_permissions` is reported as a diagnostic list of permission IDs whose `granted` value is `false` in the **chosen view** (daemon when reachable, CLI otherwise). It is informational; it does not directly gate `ready_for_testing` — the boolean checks above are authoritative. This avoids mixing daemon-sourced authority with CLI-sourced state inside a single boolean clause.

**Requirements list** gains two entries, always present, with `granted` filled from the appropriate source:

- `listen_access` — `required_for: ["global input tap", "perception"]`, `setup_trigger: "Input Monitoring TCC grant"`.
- `post_access` — `required_for: ["synthetic events (aos do click/type)"]`, `setup_trigger: "Input Monitoring TCC grant"`.

**`disagreement` block** appears only when the CLI and daemon views disagree on at least one boolean. It is a valuable diagnostic: a CLI with TCC approval for one grant while the launchd daemon is denied is the exact symptom of issue #109.

**Notes** include recovery text when `daemon_view.input_tap.status != "active"` (see Recovery Guidance below).

**Preflight gate** (`operator.swift:386-403`, `ensureInteractivePreflight`): widened so that when the daemon is reachable and `input_tap.status != "active"`, `do`-family commands exit with a new error code `INPUT_TAP_NOT_ACTIVE` (distinct from `PERMISSIONS_SETUP_REQUIRED`; permissions may appear granted and setup complete while the daemon's tap remains broken). Unreachable-daemon branch keeps existing behavior.

`permissions preflight` inherits from `permissions check`.

### `status`, `doctor`, session-start hook

**`./aos status`** (`operator.swift:172-272`):

- `RuntimeState` preserves the flat `input_tap_status`/`input_tap_attempts` and gains a nested `input_tap` block populated from the ping response.
- Text-mode one-liner adds `tap=<value>` after `daemon=<state>`:
  ```
  status=degraded mode=repo daemon=reachable pid=82838 tap=retrying focused_app=Xcode displays=2 windows=37 channels=1 stale_canvases=0 branch=main ahead=50 dirty=1
  ```
  `tap` values: `active`, `retrying`, `unavailable`, `unknown` (unknown = daemon unreachable). When `daemon=unreachable`, `tap=unknown` is displayed but the primary failure stays the loud signal — no tap-specific recovery note in that branch, only the existing daemon-recovery note.
- JSON mode: existing flat fields unchanged; `runtime.input_tap` is the new nested block.
- Notes: when `runtime.input_tap.listen_access` or `runtime.input_tap.post_access` is false (daemon-sourced), append Input Monitoring sub-guidance (see Recovery Guidance).

**`./aos doctor`** (`operator.swift:274-357`):

- `DoctorResponse.runtime` inherits the nested `input_tap` block automatically through `currentRuntimeState`.
- `DoctorResponse` gains top-level `ready_for_testing: Bool` and `ready_source: "daemon" | "cli"` fields — same computation as `permissions check` — so doctor consumers have one obvious gate to branch on and can distinguish daemon-backed from fallback answers.
- Notes reuse the same recovery block.

**Session-start hook** (`.agents/hooks/session-start.sh:113-140`):

The hook already computes `input_tap_status` inside `aos_runtime_ready` but discards it before display. Extend the Python block that formats the snapshot line to include `tap=<value>`:

```
aos=mode=repo status=degraded pid=82838 startup=already-running commit=518a7f8 acc=ok scr=ok tap=retrying
```

When `tap != active`, print a one-line pointer underneath the snapshot:

```
input_tap inactive — run './aos service restart' (see './aos status' for full guidance)
```

Rationale: the hook is the first thing every session sees. A one-line pointer flags the issue without duplicating the full recovery block — `./aos status` is where the full guidance lives. The existing `aos_runtime_ready` gate is unchanged.

### Recovery guidance

Same text, same ordering, emitted by every command that detects a non-active tap (`service install/start/restart`, `permissions check`, `status`, `doctor`). Two shapes:

**Default** (invoked from any command other than `service restart`):

```text
Input tap is not active (status=retrying, attempts=N).
Try:
  ./aos service restart              # restart the managed daemon and re-check readiness
  ./aos permissions setup --once     # refresh macOS permission onboarding
  ./aos serve --idle-timeout none    # temporary foreground fallback for this session
```

**After `service restart` itself failed readiness** (first line dropped to avoid telling the user to re-run the exact command that just failed):

```text
Input tap is still not active after service restart (status=retrying, attempts=N).
Try:
  ./aos permissions setup --once     # refresh macOS permission onboarding
  ./aos serve --idle-timeout none    # temporary foreground fallback for this session
```

`./aos permissions setup --once` is labeled "refresh macOS permission onboarding" — not "grant Input Monitoring." The current setup flow (`operator.swift:956-971`) prompts Accessibility (`AXIsProcessTrustedWithOptions`) and Screen Recording (`CGRequestScreenCaptureAccess`) only. It does **not** prompt for Input Monitoring / listen-event access, which are distinct TCC services on macOS. The wording avoids over-promising.

**Input Monitoring sub-guidance** — appended as a second block when `daemon_view.input_tap.listen_access` or `post_access` is `false`:

```text
Daemon lacks Input Monitoring access (listen=<bool>, post=<bool>).
Open System Settings > Privacy & Security > Input Monitoring and grant access to the daemon binary:
  <resolved daemon binary path>
```

The binary path is resolved from `aosExpectedBinaryPath(program: "aos", mode: runtime_mode)` so the operator sees the exact path launchd will have loaded.

## Testing strategy

Three independent layers. CI coverage of the health contract without requiring real CGEventTap failure, real launchd lifecycle, or TCC manipulation.

### Layer 1 — ping payload shape (real daemon)

Extends `tests/daemon-ipc-system.sh`. Uses the existing isolated-daemon harness (`tests/lib/isolated-daemon.sh`) which spawns a real `./aos serve` under `AOS_STATE_ROOT`. Asserts:

- `data.input_tap.status` ∈ `{active, retrying, unavailable}`
- `data.input_tap.attempts` is int
- `data.input_tap.listen_access` is bool
- `data.input_tap.post_access` is bool
- `data.input_tap.last_error_at` is string-or-null
- `data.permissions.accessibility` is bool
- Flat `input_tap_status` / `input_tap_attempts` are still present with the same values as the nested block

### Layer 2 — health contract via mock daemon

New mock: `tests/lib/mock-daemon.py`. Small Python script that speaks IPC v1 NDJSON, binds to the `AOS_STATE_ROOT`-scoped socket path, and responds to `system.ping` with a configurable payload (`--tap-status`, `--listen-access`, `--post-access`). No launchd. No TCC.

New test: `tests/input-tap-readiness.sh`. Starts the mock with `--tap-status retrying --listen-access false --post-access false`, then asserts:

- `./aos permissions check --json` returns `ready_for_testing: false`, `ready_source: "daemon"`, daemon-sourced `input_tap` fields (`listen_access: false`, `post_access: false`), and recovery notes present.
- The `disagreement` block is **not** asserted unconditionally: a CI/dev machine may legitimately have CLI `listen_access=false` (no Input Monitoring grant for the test runner), in which case daemon=false + CLI=false produces no disagreement. The presence-of-`disagreement`-when-views-differ behavior is exercised by a separate fixture that controls both views — either by pinning the CLI's preflight result via a test-only override (e.g. an `AOS_TEST_FORCE_CLI_PREFLIGHT_LISTEN=true` env var honored only in test builds), or by structuring the test so it skips the disagreement assertion when the CLI's local listen/post preflight returns `false`.
- `./aos status --json` includes `runtime.input_tap.status == "retrying"` and the tap note.
- `./aos status` (text) prints `tap=retrying` in the one-liner.
- `./aos do click 500,300` exits non-zero with `INPUT_TAP_NOT_ACTIVE` error code. (`ensureInteractivePreflight` is invoked from `main.swift:161`.)

Cleanup via `trap` ensures the mock is killed even on test failure.

### Layer 3 — readiness classifier unit test

Pure-logic test targeting `verifyServiceReadiness`. Driven through the same mock daemon from Layer 2: the test invokes the classifier (via a thin test-visible entry point — either a hidden CLI subcommand used only in tests, or by constructing the socket path and reading the outcome through the existing envelope helper). Asserts:

- Mock configured `.ok` → classifier returns `.ok(ping)`.
- Mock configured `retrying` → classifier returns `.inputTapInactive(ping)`.
- No mock listening → classifier returns `.socketUnreachable` (and respects the 5s budget — test uses a reduced budget to stay fast).

### Explicit CI exclusion

**Lifecycle exit-code behavior** (the exit table for `service install`/`start`/`restart`) is **not** covered by a launchd end-to-end test. Launchd E2E is intentionally out of scope for CI because it is slow, flaky, and risks clobbering the developer's real managed service. Coverage is provided by (1) Layer 3's classifier branches, (2) a small fixture test of the response-emit function: given each `ServiceReadinessOutcome` value (constructed directly, not via launchd), assert the resulting `ServiceStatusResponse` fields and exit code match the exit-code contract table, (3) PR review confirms the three lifecycle command entry points all compose launchctl-ops → `verifyServiceReadiness` → emit in the documented order.

`AOS_SERVICE_BINARY` (already honored at `service.swift:252`) remains the escape hatch for anyone who wants to manually smoke-test the full launchd path against a fake binary; it is not a CI test.

## Error codes

Added to the `shared/schemas/daemon-ipc.md` error vocabulary:

| Code | Meaning |
|------|---------|
| `INPUT_TAP_NOT_ACTIVE` | Daemon is reachable but its global input tap is not active. Emitted by `do`-family preflight, and surfaced as `reason` in service lifecycle responses when the tap-inactive branch is hit. |

`PERMISSIONS_SETUP_REQUIRED` is **not** reused for tap failures. Permissions may appear granted and setup marker present while the daemon tap is still broken; labeling that condition "permissions setup required" recreates the exact diagnostic confusion issue #109 describes.

## Files touched

- `src/daemon/unified.swift` — extend `system.ping` response payload.
- `src/perceive/daemon.swift` — expose `lastEventTapErrorAt`, helpers for listen/post preflights called at ping time.
- `src/commands/service.swift` — extract `verifyServiceReadiness`; route install/start/restart through it; extend `ServiceStatusResponse`; exit-code contract for lifecycle commands.
- `src/commands/operator.swift` — `permissions check` daemon-first sourcing; `status`/`doctor` nested `input_tap`; widened `ensureInteractivePreflight`; recovery-guidance helper.
- `shared/swift/ipc/request-client.swift` — drop `terminationStatus == 0` gate in `startManagedDaemon`.
- `shared/schemas/daemon-ipc.md` — document new ping fields, new error code, service lifecycle readiness contract.
- `shared/schemas/daemon-response.schema.json` — nested `input_tap`, `permissions` blocks on `system.ping`.
- `.agents/hooks/session-start.sh` — include `tap=<value>` in snapshot; one-line pointer when inactive.
- `docs/api/aos.md` — short "daemon-aware readiness" section.
- `tests/daemon-ipc-system.sh` — extend payload assertions.
- `tests/lib/mock-daemon.py` — new.
- `tests/input-tap-readiness.sh` — new.
- Test for readiness classifier (Layer 3) — new.

## Follow-ons (out of scope)

- Input Monitoring prompt flow in `./aos permissions setup --once` (`IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)`). The current manual path (System Settings) is explicit and safe; add automation only if operator complaint volume justifies it.
- `./aos doctor recover input-tap` automation command that sequences `service restart` → probe → `permissions setup --once` if still bad → labeled foreground fallback. Inline guidance covers issue #109's AC4; automate only if inline proves too friction-heavy.
- Event envelope v2 to unify readiness vocabulary across request and event sides (would also close the documented `service` enum drift noted in `2026-04-17-daemon-ipc-request-schema-v1-design.md`).
- Daemon-side `screen_recording` field on `system.ping.permissions`, if a clean helper becomes available in the daemon's imports without pulling additional frameworks.

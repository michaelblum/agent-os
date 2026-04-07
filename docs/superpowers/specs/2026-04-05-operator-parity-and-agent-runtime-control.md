# Operator Parity and Agent Runtime Control

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Give agent consumers the same practical operating ability a human has for launching, inspecting, verifying, and recovering the local agent-os runtime.

## Problem

Today, an agent can build binaries, invoke CLIs, talk to Unix sockets, and inspect some local state. That is useful, but it is not operator parity.

A human operator can also:

- launch long-lived GUI processes into the real logged-in macOS session
- tell whether a daemon is truly running vs merely spawned from a transient shell
- tell whether Accessibility and Screen Recording permissions are granted
- tell whether a canvas actually exists right now
- restart services cleanly
- confirm reconnect and recovery behavior
- reason from visible state when the system drifts from expected state

Agents currently lack a stable, JSON-first control plane for those tasks. Instead they rely on:

- transient shell backgrounds
- ad hoc `pkill` + restart loops
- direct socket probing
- logs with human-oriented interpretation
- partial CLI coverage that does not expose runtime health as first-class state

This creates a capability gap between "the agent can invoke commands" and "the agent can reliably operate the system."

## Goal

Create an operator-facing control surface for agent-os so that an agent consumer can:

1. launch and supervise the real runtime in the logged-in GUI session
2. inspect health, permissions, canvases, and process state as structured JSON
3. run deterministic smoke tests for the critical user-visible flows
4. recover from drift without relying on human interpretation

## Design Principles

- **Operator parity over feature sprawl.** Prefer commands that make the runtime observable and controllable over adding more ad hoc features.
- **JSON first.** Every health, status, and smoke-test command returns machine-readable JSON.
- **One authoritative path per operational concern.** Service control, permissions, canvas state, and smoke tests each get a canonical interface.
- **Real session semantics.** GUI runtimes must be launched in the logged-in macOS GUI session, not as fragile shell background jobs.
- **Incremental adoption.** Start with wrappers and scripts if necessary; fold into native CLIs once the operational model settles.

## Non-Goals

- Rewriting the runtime around async/await or actors
- Replacing `side-eye`, `heads-up`, or Sigil internals wholesale
- Solving every product-level workflow in one pass
- Remote orchestration across machines

## Capability Gaps To Close

### 1. Service Control

Agents need a stable way to start, stop, restart, and inspect long-lived GUI/runtime processes.

Current state:

- `aos serve` and `apps/sigil/build/avatar-sub` are often run as shell backgrounds
- shell-tool job control is not equivalent to a human terminal session
- GUI lifecycle and event-tap behavior become ambiguous under transient shells

Required outcome:

- launch under `launchd` in the GUI user domain
- inspect status via JSON
- clean restart and log access

### 2. Runtime Introspection

Agents need to know the current truth of the system, not infer it indirectly.

Current state:

- canvas existence is inferred via socket calls or logs
- permission state is not exposed as a first-class health contract
- process and reconnect state are not available as a coherent status view

Required outcome:

- one command for health/doctor
- one command for runtime status
- one command for canvas existence and details

### 3. Deterministic Recovery

Agents need explicit recovery surfaces.

Current state:

- reconnect behavior is tested informally
- canvas recreation behavior is validated by manual observation
- recovery flows depend on operator intuition

Required outcome:

- built-in smoke tests for cold start, reconnect, and canvas recovery
- return pass/fail JSON with concrete failure reasons

### 4. Permission Awareness

Accessibility, Screen Recording, and event-tap viability are runtime prerequisites.

Current state:

- these are implicit, human-remembered conditions
- failures often surface late and ambiguously

Required outcome:

- dedicated permission checks in JSON
- clear distinction between "binary exists", "process runs", and "process is actually empowered to operate"

## Proposed Surface

## Part 1: `aos doctor`

Add:

```bash
aos doctor --json
```

Returns:

```json
{
  "status": "ok",
  "platform": {
    "os": "macOS",
    "version": "14.x"
  },
  "permissions": {
    "accessibility": true,
    "screen_recording": true
  },
  "runtime": {
    "daemon_running": true,
    "socket_path": "/Users/Michael/.config/aos/sock",
    "socket_reachable": true,
    "event_tap_expected": true
  },
  "notes": []
}
```

Minimum responsibilities:

- check if `aos` daemon process is running
- check if socket exists and accepts a ping
- report Accessibility permission
- report Screen Recording permission
- return actionable notes when something is missing

## Part 2: Service Control

Add native or script-backed commands:

```bash
aos service install
aos service start
aos service stop
aos service restart
aos service status --json
aos service logs
```

For Sigil:

```bash
sigilctl install
sigilctl start
sigilctl stop
sigilctl restart
sigilctl status --json
sigilctl logs
```

Implementation model:

- use `launchctl bootstrap/bootout/kickstart` in the GUI user domain
- target `gui/$(id -u)` semantics
- store plists and logs in predictable locations

Status JSON should include:

```json
{
  "status": "ok",
  "installed": true,
  "running": true,
  "pid": 1234,
  "launchd_label": "com.agent-os.aos",
  "log_path": "/Users/Michael/.config/aos/daemon.log"
}
```

## Part 3: Canvas Introspection

Extend the display/runtime surface with explicit queries:

```bash
aos show exists --id avatar --json
aos show get --id avatar --json
aos show list --json
```

Example:

```json
{
  "status": "ok",
  "exists": true,
  "canvas": {
    "id": "avatar",
    "at": [200, 200, 300, 300],
    "scope": "global"
  }
}
```

This becomes the canonical way for agents to answer:

- does the avatar exist?
- where is it?
- is it global or connection-scoped?

## Part 4: Sigil Runtime State

Add:

```bash
sigilctl state --json
sigilctl ensure-avatar --json
```

`sigilctl state --json` should report:

```json
{
  "status": "ok",
  "process": {
    "running": true,
    "pid": 5678
  },
  "subscriber": {
    "connected": true,
    "last_connect_ts": "2026-04-05T21:30:00Z"
  },
  "avatar": {
    "canvas_exists": true,
    "state": "idle",
    "x": 200,
    "y": 200,
    "size": 300
  },
  "chat": {
    "canvas_exists": true
  }
}
```

`sigilctl ensure-avatar --json` should:

- query current avatar canvas state
- create/recreate if missing
- return the resulting state as JSON

This turns recovery into an explicit supported operation.

## Part 5: Smoke Tests

Add:

```bash
aos test daemon-smoke --json
aos test canvas-smoke --json
sigilctl smoke cold-start --json
sigilctl smoke reconnect --json
```

### `sigilctl smoke cold-start --json`

Flow:

1. stop daemon and Sigil if running
2. start daemon
3. start Sigil
4. assert subscriber connected
5. assert avatar canvas exists

### `sigilctl smoke reconnect --json`

Flow:

1. ensure daemon up
2. ensure Sigil up
3. assert avatar canvas exists
4. restart daemon
5. wait for reconnect
6. assert avatar canvas exists again

Example result:

```json
{
  "status": "ok",
  "test": "sigil_reconnect",
  "steps": [
    {"name": "daemon_started", "status": "ok"},
    {"name": "sigil_connected", "status": "ok"},
    {"name": "avatar_present_before_restart", "status": "ok"},
    {"name": "daemon_restarted", "status": "ok"},
    {"name": "sigil_reconnected", "status": "ok"},
    {"name": "avatar_present_after_restart", "status": "ok"}
  ]
}
```

## Part 6: Permission Checks

Expose:

```bash
aos permissions check --json
```

This is narrower than `doctor` and focused on machine capabilities:

- Accessibility granted
- Screen Recording granted
- event tap creation succeeds
- display capture capability available

The distinction:

- `doctor` = broad system health
- `permissions check` = capability contract

## Delivery Strategy

### Phase 1: Script-backed control plane

Fastest path:

- `scripts/aos-service`
- `scripts/sigilctl`

Use shell + `launchctl` + existing CLIs to validate the operational shape quickly.

### Phase 2: Native CLI hardening

Fold the stable commands into:

- `aos service ...`
- `aos doctor`
- `aos permissions ...`
- `aos test ...`

Keep Sigil control in `sigilctl` unless/until Sigil itself gets folded into a first-class app surface.

## Milestones

### Milestone 1: Basic observability

Deliver:

- `aos doctor --json`
- `aos show exists/get/list --json`

Success condition:

- an agent can determine whether the daemon is healthy and whether a target canvas exists without reading logs

### Milestone 2: Real service control

Deliver:

- `aos service start/stop/restart/status`
- `sigilctl start/stop/restart/status`

Success condition:

- an agent can launch and restart the runtime in the real GUI session without transient shell job control

### Milestone 3: Recovery primitives

Deliver:

- `sigilctl ensure-avatar --json`
- `sigilctl state --json`

Success condition:

- an agent can recover the avatar after drift or daemon restart without manual intervention

### Milestone 4: Smoke tests

Deliver:

- `aos test daemon-smoke --json`
- `sigilctl smoke cold-start --json`
- `sigilctl smoke reconnect --json`

Success condition:

- reconnect and cold-start flows are deterministically testable by an agent

## Open Questions

1. **Native vs script-backed first.**
   The pragmatic answer is script-backed first, but native is cleaner long term. Decide based on speed vs stability.

2. **Where `sigilctl` lives.**
   Likely `apps/sigil/` at first. If Sigil becomes a fully supported app surface, it may deserve promotion.

3. **How deep `doctor` should go.**
   Start narrow and reliable. Avoid speculative checks that produce flaky health output.

4. **How to test visible overlays.**
   Canvas existence is testable. Human-visible correctness is harder. If needed, add optional screenshot-backed assertions later.

## Recommendation

Do this work before adding more ad hoc runtime features.

The current system is powerful, but not yet easy for agents to operate reliably. Operator parity closes that gap and makes every other feature more usable.

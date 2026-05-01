# Capability Preflight And Readiness Lease Spec

Status: proposed implementation spec.

Tracking: GitHub issue #177.

Related note:
[`2026-05-01-capability-preflight-readiness-lease.md`](../notes/2026-05-01-capability-preflight-readiness-lease.md).

## Problem

`./aos ready` is the right explicit front-door readiness gate, but it should
not become an agent heartbeat. Live commands should not make the agent decide,
on every turn, whether another full readiness check is needed.

The runtime contract should be:

```text
agent chooses semantic capability
AOS performs deterministic preflight only when needed
AOS either runs the capability or returns a concrete blocker
```

The implementation target is a lazy capability preflight backed by scoped
readiness leases. A lease proves that a specific capability was checked against
the current runtime identity. Repeated live commands reuse valid leases instead
of re-running full readiness.

## Goals

- Keep agents focused on semantic path selection: `see`, `do`, `show`, `tell`,
  `listen`, `target.probe`, browser targets, and content roots.
- Move repeated readiness decisions into deterministic command/runtime code.
- Scope readiness to required capability classes instead of one opaque boolean.
- Reuse valid leases across CLI invocations while the daemon identity is stable.
- Return structured blockers and next actions when a preflight fails.
- Keep repair and macOS permission handoffs explicit.

## Non-Goals

- Do not hide `./aos ready --repair` behind ordinary live commands.
- Do not open System Settings or permission prompts automatically.
- Do not make agents run `./aos ready` as a polling loop.
- Do not let CLI fallbacks fabricate daemon-owned state. Follow
  [`shared/schemas/CONTRACT-GOVERNANCE.md`](../../../shared/schemas/CONTRACT-GOVERNANCE.md).
- Do not implement EVOI as part of this work.

## Capability Classes

Capability ids are stable, provider-neutral strings. A command form declares
the smallest set it needs.

| Capability | Meaning | Primary source |
| --- | --- | --- |
| `runtime.daemon` | The managed daemon is reachable, mode-matched, and owned by the active runtime identity. | daemon/CLI lifecycle view |
| `perception.ax` | Accessibility-backed structured perception can read targets, windows, selection, or AX tree data. | daemon when daemon-owned, CLI only when labeled |
| `perception.screen` | Screen capture is available for pixel capture or visual validation. | CLI Screen Recording view unless moved daemon-side |
| `action.input` | Real mouse/keyboard action can be posted through the active input route. | daemon input-tap health |
| `projection.canvas` | The daemon canvas/show path is available. | daemon display/canvas state |
| `content.root` | Required `aos://...` content roots exist and point at the active checkout when canonical roots are used. | daemon content status |
| `browser.adapter` | Browser target adapter, version, and session are available for `browser:*` targets. | browser adapter |

Future work can add more classes, but v1 should not split beyond observable
checks that commands already need.

## Lease Ownership

V1 leases live in the daemon process as mode-scoped runtime state.

Rationale:

- Command-process memory does not survive repeated CLI invocations.
- A repo cache file can go stale across daemon restarts, code-signing changes,
  or runtime mode switches.
- Daemon-owned capabilities must stay daemon-sourced.
- A daemon restart naturally drops leases and forces a bounded recheck.

The daemon may later persist non-sensitive lease metadata if evidence shows
startup cost is a bottleneck. That is not part of v1.

## Lease Shape

The daemon stores one lease per `(mode, capability, scope)` tuple.

```json
{
  "capability": "action.input",
  "scope": "daemon",
  "mode": "repo",
  "status": "valid",
  "source": "daemon",
  "checked_at": "2026-05-01T00:00:00Z",
  "expires_at": null,
  "daemon_pid": 12345,
  "daemon_started_at": "2026-05-01T00:00:00Z",
  "socket_path": "/Users/Michael/.config/aos/repo/sock",
  "evidence": {
    "input_tap.status": "active"
  }
}
```

Fields:

- `capability`: one capability id.
- `scope`: capability-specific scope. Examples: `daemon`, `screen`,
  `canvas`, `content.root:toolkit`, or `browser:default`.
- `mode`: runtime mode, currently `repo` or `installed`.
- `status`: `valid`, `invalid`, or `degraded`.
- `source`: `daemon`, `cli`, or adapter-specific source such as `browser`.
- `checked_at`: ISO timestamp of the deterministic check.
- `expires_at`: optional. V1 should prefer event invalidation and command
  failure invalidation. TTLs can be added per capability later.
- `daemon_pid`, `daemon_started_at`, `socket_path`: daemon identity fields used
  to reject stale leases.
- `evidence`: small diagnostic fields, not a replacement for full status.

CLI-sourced leases are allowed only for capabilities the CLI actually owns at
that moment, and the response must label `source: "cli"`. Do not silently merge
CLI and daemon views.

## Invalidation

Invalidate only the affected leases.

| Event | Invalidates |
| --- | --- |
| Daemon start, stop, restart, crash, or socket identity change | all daemon-sourced leases |
| Runtime mode change | all leases for the previous mode |
| Repo `./aos` rebuild or code-signing identity change | `perception.ax`, `perception.screen`, `action.input`, and any lease tied to permissions |
| Stale TCC or macOS permission handoff diagnosis | permission-backed leases |
| `system.ping` reports changed daemon `pid` or `started_at` | all daemon-sourced leases |
| Input tap health changes away from `active` | `action.input` and any dependent live-input lease |
| Content root mutation or content status failure | matching `content.root:*` leases and dependent `projection.canvas` leases when the root is required |
| Canvas manager restart or show-path failure | `projection.canvas` |
| Browser adapter attach/detach/version failure | matching `browser.adapter` lease |
| A live command fails with evidence that a lease was stale | the lease that authorized that capability |

A new agent turn is not an invalidation event.

## Command Registry Metadata

Add required capability metadata to command forms. The least disruptive shape is
an optional `required_capabilities` array inside `ExecutionMeta` JSON, because
the command registry already exposes execution behavior.

Proposed generated JSON shape:

```json
{
  "id": "do-click",
  "usage": "aos do click <target>",
  "execution": {
    "read_only": false,
    "mutates_state": true,
    "interactive": true,
    "auto_starts_daemon": false,
    "requires_permissions": true,
    "required_capabilities": [
      {
        "id": "action.input",
        "scope": "daemon",
        "when": "target_kind != browser"
      },
      {
        "id": "browser.adapter",
        "scope": "target.session",
        "when": "target_kind == browser"
      }
    ]
  }
}
```

Swift model sketch:

```swift
struct CapabilityRequirement {
    let id: String
    let scope: String?
    let when: String?
}

struct ExecutionMeta {
    let readOnly: Bool
    let mutatesState: Bool
    let interactive: Bool
    let streaming: Bool
    let autoStartsDaemon: Bool
    let requiresPermissions: Bool
    let supportsDryRun: Bool
    let requiredCapabilities: [CapabilityRequirement]
}
```

The `when` field is descriptive in v1. Command handlers still perform the
target-kind branch, such as skipping macOS input preflight for `browser:*`
targets. Later work can promote common predicates into typed schema.

Example v1 mappings:

| Command form | Required capabilities |
| --- | --- |
| `aos see target` | `perception.ax` |
| `aos see observe` | `runtime.daemon`, `perception.ax` |
| `aos see capture` without browser target | `perception.screen` |
| `aos see capture browser:*` | `browser.adapter` |
| `aos do click` without browser target | `action.input` |
| `aos do click browser:*` | `browser.adapter` |
| `aos show open` for `aos://...` content | `runtime.daemon`, `projection.canvas`, optional `content.root` |
| `aos tell ...` through daemon channel | `runtime.daemon` |
| `aos listen ...` through daemon channel | `runtime.daemon` plus future channel-specific capability |

Do not blindly reuse the current `readyBlockers.blocks` verb list as the command
mapping. The preflight mapping should be precise to the command form and target
kind.

## Preflight Flow

Introduce a command helper that replaces ad hoc interactive checks:

```swift
ensureCapabilityPreflight(
    command: "aos do click",
    requirements: [
        CapabilityRequirement(id: "action.input", scope: "daemon", when: nil)
    ],
    context: CapabilityPreflightContext(...)
)
```

Flow:

1. Resolve conditional requirements from parsed command args.
2. Ask the daemon for lease status when any daemon-owned requirement is present.
3. For missing or invalid leases, run the smallest deterministic check for the
   required capability only.
4. If every required capability is satisfied, cache/refresh leases and continue.
5. If a capability is blocked, exit before executing the command and emit a
   structured preflight failure.

The helper must not run `./aos ready --repair`, restart loops, or Settings
automation. It may perform bounded daemon start only when the command form
already declares `auto_starts_daemon` or the existing command path already owns
auto-start behavior. Otherwise it reports `daemon_unreachable`.

## Existing Precedent

`ensureInteractivePreflight(...)` already performs part of this job:

- It enforces permissions onboarding before live `see`/`do` paths.
- It checks daemon input-tap health for input-sensitive `do` commands.
- It skips macOS preflight for browser targets because the browser adapter owns
  that availability gate.

V1 should keep a compatibility wrapper:

```swift
func ensureInteractivePreflight(command: String, requiresInputTap: Bool = false) {
    let capabilities = requiresInputTap
        ? [CapabilityRequirement(id: "action.input", scope: "daemon", when: nil)]
        : [CapabilityRequirement(id: "perception.ax", scope: nil, when: nil)]
    ensureCapabilityPreflight(command: command, requirements: capabilities, context: ...)
}
```

Then migrate individual handlers to explicit requirements so the wrapper can be
removed after all live paths are covered.

## Preflight Failure Shape

A failed command preflight should return a compact error envelope, not the full
`ready` response. It should reuse the blocker vocabulary where possible and add
capability fields.

Text mode should keep the current concise `CODE: message` convention.

JSON mode should expose this shape:

```json
{
  "code": "CAPABILITY_PREFLIGHT_FAILED",
  "error": "aos do click requires action.input, but the daemon input tap is not active.",
  "preflight": {
    "status": "degraded",
    "phase": "capability_blocked",
    "diagnosis": "input_tap_not_active",
    "mode": "repo",
    "command": "aos do click",
    "repair_attempted": false,
    "required_capabilities": ["action.input"],
    "satisfied_capabilities": ["runtime.daemon"],
    "blocked_capabilities": ["action.input"],
    "blockers": [
      {
        "kind": "runtime",
        "id": "input_tap_not_active",
        "scope": "daemon",
        "source": "daemon",
        "capabilities": ["action.input"],
        "blocks": ["do"],
        "message": "Daemon input tap is not active (status=retrying, attempts=3).",
        "target_path": "/Users/Michael/Code/agent-os/aos",
        "settings_url": null,
        "next_actions": [
          {
            "type": "command",
            "label": "Run explicit readiness repair",
            "command": "./aos ready --repair"
          }
        ]
      }
    ]
  }
}
```

Rules:

- `repair_attempted` is always `false` for ordinary command preflight.
- `source` must be present on blockers that depend on daemon or CLI views.
- `blocked_capabilities` names capability classes, not verbs.
- `blocks` may preserve the existing verb-level vocabulary for compatibility.
- The command exits non-zero before performing the requested live action.

`./aos ready --json` can continue to emit the existing full readiness response.
Later implementation may add optional `capabilities` fields to ready blockers,
but that is not required to introduce command preflight.

## `aos dev recommend`

`aos dev recommend` should stop recommending redundant standalone ready checks
when the next concrete command has capability preflight coverage.

Rules:

- Keep recommending `./aos dev build` after relevant Swift source changes.
- Prefer recommending the focused verification command once that command
  declares required capabilities.
- Represent the readiness dependency as command metadata, not as a separate
  agent ritual.
- Continue recommending explicit `./aos ready --post-permission` after stale TCC
  handoff because that is a human-resume contract.
- Continue recommending explicit `./aos ready` for workflows that intentionally
  establish whole-runtime readiness, or for shell integration tests until those
  tests use command-level preflight directly.

Implementation path:

1. Extend command registry metadata with `required_capabilities`.
2. Extend dev workflow action metadata with optional
   `required_capabilities` or a reference to a command form.
3. Teach `aos dev recommend --json` to collapse a `ready_check` action when a
   remaining recommended command declares equivalent preflight coverage. Expose
   collapsed items in `collapsed_actions` so the optimization is auditable
   rather than implicit.
4. Preserve explicit human handoff actions.

## Test Plan

Use isolated state roots. Do not depend on the developer's live daemon.

Extend `tests/lib/mock-daemon.py` enough to support capability preflight tests:

- Count `system.ping` and future `system.preflight` requests.
- Emit configurable daemon identity fields such as `pid`, `started_at`, and
  `socket_path`.
- Emit configurable degraded health for input tap and permissions.
- Optionally accept a simple state-transition flag so a test can invalidate a
  lease between two commands.

Required tests:

1. Lease reuse:
   - Start the mock daemon with active input tap.
   - Run two non-browser `do` commands through an isolated state root.
   - Assert the second command reuses the valid `action.input` lease and does
     not repeat the expensive readiness path.
2. Daemon identity invalidation:
   - Establish a lease.
   - Restart or replace the mock daemon with a different `pid` or `started_at`.
   - Assert the next command rejects the stale lease and preflights again.
3. Degraded daemon-owned state:
   - Start the mock with `--tap-status retrying`.
   - Assert `aos do click ... --json` fails with
     `CAPABILITY_PREFLIGHT_FAILED`, `blocked_capabilities=["action.input"]`,
     `source="daemon"`, and `repair_attempted=false`.
   - Assert daemon-backed `aos see observe` fails with
     `blocked_capabilities=["perception.ax"]` when daemon Accessibility is not
     available.
4. No hidden repair:
   - Make the mock report `daemon_tcc_grant_stale_or_missing`-equivalent
     blocker data.
   - Assert command preflight reports `./aos ready --repair` or
     `./aos ready --post-permission` as a next action but does not run either.
5. Browser target routing:
   - Run a browser-targeted `do` form.
   - Assert it asks for `browser.adapter` and does not fail on macOS
     `action.input` state.
6. Content root scope:
   - Reuse the stale-root pattern from `tests/content-wait.sh`.
   - Assert only the matching `content.root:<name>` and dependent show
     capability are blocked.
7. Dev recommendation collapse:
   - Update `tests/dev-workflow-classify.sh` or a new focused test.
   - Assert a command with declared required capabilities does not also force a
     redundant standalone `ready_check`, except for explicit handoff paths.

Existing tests to preserve:

- `tests/input-tap-readiness.sh`
- `tests/input-tap-readiness-legacy.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/content-wait.sh`
- `tests/dev-workflow-classify.sh`
- `tests/schemas/dev-workflow-rules.test.mjs`

## Implementation Sequence

1. Add capability requirement types to the command registry Swift model and JSON
   serializer.
2. Add daemon-side in-memory lease storage keyed by `(mode, capability, scope)`.
3. Add a deterministic preflight service action, likely `system.preflight`, that
   evaluates requested capabilities and returns leases or blockers.
4. Add the CLI helper `ensureCapabilityPreflight(...)`.
5. Migrate current `ensureInteractivePreflight(...)` call sites to explicit
   capability requirements.
6. Extend the mock daemon and tests for lease reuse, invalidation, degraded
   daemon state, and no hidden repair.
7. Update `aos dev recommend` to collapse redundant ready checks when command
   preflight metadata covers the same need.
8. Promote stable response shapes into `docs/api/` and `shared/schemas/` after
   the implementation settles.

## Acceptance Criteria

- Live command forms declare required capability classes.
- A repeated live command skips full readiness checks while its lease is valid.
- Known invalidation events clear only the relevant leases.
- Failed preflights return concrete blocker codes, sources, and next actions.
- Ordinary command preflight never runs repair.
- Browser-targeted commands use browser adapter gating instead of macOS input
  gating.
- Tests cover valid lease reuse, invalidation, degraded daemon-owned state, and
  no hidden repair behavior.

# GDI AOS Ready Fast Healthy Path V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: make `./aos ready` fast and non-disruptive when the repo daemon is already healthy, while preserving the existing repair and post-permission safety contracts.
- Source artifact: Foreman acceptance of `383e07ee` on `feat/command-surface-extraction` and the follow-on observation that `./aos ready` took multiple seconds, sometimes paying service restart/readiness budget even when its name suggests a quick readiness gate.
- Branch/Base:
  - branch_from: `feat/command-surface-extraction`
  - required_start_ref: local `feat/command-surface-extraction` containing accepted commit `383e07ee` and this work-card checkpoint
- Branch/output expectations: keep changes on `feat/command-surface-extraction`; produce a focused diff and completion report. Do not push or open a PR.
- Stop conditions: stop and report `human_needed` if live AOS verification requires macOS permission changes. Stop and report a blocker if reducing healthy-path latency would weaken `ready --repair`, `ready --post-permission`, or the permission reset/regrant safety boundary.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## User Report

`./aos ready` seems too slow for its namesake. Foreman inspection found that the current command is justified as a front-door recovery gate, but the healthy already-running case appears to pay too much orchestration cost:

- `readyCommand` always invokes `./aos service start --mode repo --json`.
- `service start` calls `launchctl kickstart -k`, which can restart the job even when it is already running.
- service readiness polling has a `5000ms` budget.
- `ready` can add bounded repair waits for repairable runtime drift.

That behavior is appropriate for explicit repair paths, first startup, and post-permission recovery, but a healthy reachable daemon should be a quick check and should not be restarted as the default predicate.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/api/aos.md`
- `src/commands/operator.swift`
- `src/commands/service.swift`
- `tests/input-tap-readiness.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/help-contract.sh`

## Rediscover State

```bash
git status --short --branch
./aos service status --mode repo --json
./aos status
./aos ready --json
```

If live readiness reaches a repo-mode TCC/input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

- `./aos ready` must return quickly when the managed repo daemon is already running, socket-reachable, owned by the expected runtime, and reports an active input tap.
- The healthy fast path must not kickstart or restart the daemon.
- `./aos ready` may still start the managed daemon when it is not running or not loaded.
- Plain `./aos ready` may still perform the existing short automatic recovery for known repairable drift, such as daemon ownership mismatch or inactive input tap, but only after a cheap check proves the fast path is not already healthy.
- `./aos ready --repair` keeps the longer restart/recheck behavior.
- `./aos ready --post-permission` remains the bounded handoff check after human permission repair and must not encourage repeated ad-hoc repair loops.
- JSON responses must keep the existing structured shape. If a new action-trace step is needed for the fast path, keep it explicit and stable.
- Docs and tests should make the distinction clear: ready is a quick gate when healthy, a starter when down, and a bounded repair coordinator only when needed.

## Scope

Likely ownership is the AOS command/control surface: `readyCommand`, launchd-backed service start/status helpers, and focused shell contract tests.

## Hard Boundaries

- Do not weaken input-tap permission safety from `383e07ee`.
- Do not remove the `ready --repair` or `ready --post-permission` safety behavior.
- Do not replace `./aos` control-plane calls with raw launchd, tmux, socket, or state-file workflows in docs or tests except inside implementation internals where the command already owns that abstraction.
- Do not create a broad daemon lifecycle redesign.
- Do not make timing assertions brittle against slow developer machines. Prefer structural assertions that the healthy path does not call restart/kickstart, plus a bounded manual timing note if useful.

## Suggested Implementation Areas

- `src/commands/operator.swift` - add a cheap preflight in `readyCommand` before invoking `service start`, or otherwise avoid service start when daemon health already proves ready.
- `src/commands/service.swift` - if needed, split "ensure service exists/loaded" from "kickstart/restart and poll readiness" so callers can choose the cheaper path.
- `tests/input-tap-readiness.sh` or a new focused shell test - cover that a mocked healthy daemon path does not trigger service start/restart.
- `tests/ready-ownership-mismatch.sh` - preserve automatic repair for ownership mismatch.
- `docs/api/aos.md` and command help metadata if behavior wording changes.

## Verification

Run deterministic checks:

```bash
./tests/input-tap-readiness.sh
./tests/ready-ownership-mismatch.sh
./tests/help-contract.sh
git diff --check
```

Also run any new focused test added for the fast path.

If live AOS is safe and `./aos ready` is not blocked by permissions, run a bounded manual smoke:

```bash
./aos service status --mode repo --json
./aos ready --json
./aos ready
```

Report observed latency only as diagnostic evidence, not as the sole acceptance criterion. If `./aos ready` or `./aos ready --json` reports a TCC/input-tap blocker, use the GDI human-needed path above instead of looping.

## Completion Report

Report:

- files changed;
- the exact healthy-path behavior changed;
- how repair and post-permission behavior were preserved;
- tests run and results;
- live smoke result or the exact readiness/TCC blocker;
- any remaining reason `./aos ready` can legitimately take several seconds.

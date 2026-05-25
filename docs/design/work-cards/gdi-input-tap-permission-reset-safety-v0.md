# GDI Input Tap Permission Reset Safety V0

## Transfer

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make AOS input capture fail open during permission reset/regrant paths so the user can always operate macOS without rebooting.
- Source artifact: Foreman accepted rebuild-pause commit `be668f8e` (`Pause GDI after AOS rebuild`) plus this user report.
- Branch/Base:
  - branch_from: `feat/command-surface-extraction`
  - required_start_ref: local `feat/command-surface-extraction` containing this work card
- Branch/output expectations: keep changes on `feat/command-surface-extraction`; produce a focused diff and completion report. Do not push or open a PR.
- Stop conditions: stop and report `human_needed` if live AOS verification requires macOS permission changes or if the input path risks capturing user input during manual recovery.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## User Report

While fixing the GDI/AOS Agent Terminal rebuild pause flow, a major safety issue remained: input tap capture can steal mouse/keyboard events while the user is trying to remove and re-add macOS permissions. The existing Command+Option+Escape escape hatch opens the countdown feedback but no longer reliably allows mouse events through to other apps. The bigger goal is to not need that break-glass path during TCC recovery.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `src/perceive/daemon.swift`
- `src/perceive/input-safety-hotkeys.swift`
- `src/daemon/unified.swift`
- `src/daemon/input-safety-visual-feedback.swift`
- `tests/input-safety-hotkeys.sh`
- `tests/input-tap-readiness.sh`
- `docs/api/aos.md`

## Rediscover State

```bash
git status --short --branch
./aos ready
```

If live readiness reaches a repo-mode TCC/input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

- During permission reset/regrant recovery, AOS must not keep an active event tap path that can consume or interfere with user mouse/keyboard events.
- If the event tap loses permissions or detects a TCC recovery state, it must fail open before any downstream input consumer can consume an event.
- The Command+Option+Escape safety window must pass through ordinary mouse and keyboard events for its full window, and downstream consume decisions must be ignored while it is active.
- Visual countdown feedback must be non-authoritative. If the feedback surface exists but passthrough is not actually active, that is a bug.
- The safe permission recovery instructions should remain `./aos permissions reset-runtime --mode repo`, then `./aos permissions setup --once`, then `./aos ready --post-permission`.

## Scope

Likely ownership is daemon/native input tap and input safety state. Adjust docs/tests only as needed to lock the behavior.

## Hard Boundaries

- Do not route this through Agent Terminal PTY input.
- Do not add a new global hotkey unless the existing contract is proven impossible to preserve.
- Do not make manual Settings removal the primary path.
- Do not run broad live loops while input capture may be unsafe.
- Do not change the accepted rebuild-pause contract except for direct safety interactions.

## Suggested Implementation Areas

- `src/perceive/daemon.swift` for event tap fail-open and teardown behavior.
- `src/perceive/input-safety-hotkeys.swift` for pure safety-window classification.
- `src/daemon/unified.swift` for native canvas passthrough activation/restore.
- `src/commands/operator.swift` or related permission reset code only if reset-runtime does not reliably stop the daemon-owned tap before user action.

## Verification

Run deterministic checks:

```bash
./tests/input-safety-hotkeys.sh
./tests/input-tap-readiness.sh
git diff --check
```

If `./aos ready` passes without a permission blocker, run one bounded live smoke that proves Command+Option+Escape activates a real passthrough window and that mouse events reach another foreground app during that window. Keep the live evidence concise.

## Completion Report

Report:

- files changed;
- the exact safety invariant now enforced;
- tests run and results;
- live smoke result or the exact readiness/TCC blocker;
- any remaining human-only risk around macOS permissions or input capture.

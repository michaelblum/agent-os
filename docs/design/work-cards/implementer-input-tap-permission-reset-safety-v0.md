# Implementer Input Tap Permission Reset Safety V0

## Transfer

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: make `./aos permissions reset-runtime --mode repo` the boring, deterministic safety boundary for repo-mode permission reset/regrant after rebuilds, so AOS cannot keep or revive an input tap that steals user input during manual TCC repair.
- Source artifact: Foreman accepted rebuild-pause commit `be668f8e` (`Pause Implementer after AOS rebuild`), post-build hook commit `0d5673b7` (`fix(docks): reset runtime permissions after dev build`), and this user report.
- Branch/Base:
  - branch_from: `feat/command-surface-extraction`
  - required_start_ref: `origin/feat/command-surface-extraction`
- Branch/output expectations: keep changes on `feat/command-surface-extraction`; produce a focused diff and completion report. Do not push or open a PR.
- Stop conditions: stop and report `manual_intervention` if live AOS verification requires macOS permission changes or if the input path risks capturing user input during manual recovery.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## User Report

While fixing the Implementer/AOS Agent Terminal rebuild pause flow, a major safety issue remained: input tap capture can steal mouse/keyboard events while the user is trying to remove and re-add macOS permissions.

The reliable observed recovery is:

```bash
./aos permissions reset-runtime --mode repo
./aos permissions setup --once
./aos ready --post-permission
```

The likely failure mode is not primarily "missing escape hatch." It is probably
multiple runtime loops racing around TCC recovery:

1. A rebuilt or stale daemon has an input tap active or retrying.
2. The user removes Input Monitoring.
3. AOS keeps retrying or observing degraded tap state.
4. The user re-adds Input Monitoring.
5. A retry path recreates/enables the tap while related runtime state is stale
   or mismatched.
6. User clicks are intercepted or consumed.

The existing Command+Option+Escape escape hatch is fallback only. It opened
visual countdown feedback but no longer reliably allowed mouse events through.
Do not make this slice a broad redesign of that bandaid unless the reset-runtime
boundary cannot be made safe.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
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
the manual TCC blocker report path
```

Then stop. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

- `./aos permissions reset-runtime --mode repo` is the primary safety boundary after a repo-mode Swift rebuild. It must stop/disable/clear enough daemon/input-tap state that the user can remove and re-add macOS permissions without AOS consuming clicks or keys.
- After reset-runtime, no background daemon/input-tap retry loop may keep consuming events or suddenly re-enable into a stale/mismatched state during manual TCC repair.
- During permission reset/regrant recovery, AOS must not keep an active event tap path that can consume or interfere with user mouse/keyboard events.
- If the event tap loses permissions or detects a TCC recovery state, it must fail open before any downstream input consumer can consume an event.
- The safe permission recovery instructions remain exactly: `./aos permissions reset-runtime --mode repo`, then `./aos permissions setup --once`, then `./aos ready --post-permission`.
- Command+Option+Escape remains fallback-only. Do not rely on it as the primary safety mechanism. Only touch the escape hatch if doing so is required to prevent it from making reset-runtime recovery worse.

## Scope

Likely ownership is permission reset, daemon lifecycle, and native input-tap retry/teardown state. Adjust docs/tests only as needed to lock the behavior.

## Hard Boundaries

- Do not route this through Agent Terminal PTY input.
- Do not add a new global hotkey unless the existing contract is proven impossible to preserve.
- Do not make manual Settings removal the primary path.
- Do not run broad live loops while input capture may be unsafe.
- Do not change the accepted rebuild-pause contract except for direct safety interactions.
- Do not over-invest in Command+Option+Escape. Treat it as fallback. The primary fix is reset-runtime lifecycle safety.

## Suggested Implementation Areas

- `src/commands/operator.swift` for `permissions reset-runtime` behavior, daemon stop/check ordering, and post-reset guidance.
- `src/perceive/daemon.swift` for event tap fail-open, retry, and teardown behavior.
- `src/daemon/unified.swift` only if daemon health/lifecycle state needs to expose or clear input-tap state for reset-runtime.
- `tests/input-tap-readiness.sh` for reset-runtime/readiness contract coverage.
- `tests/input-safety-hotkeys.sh` only for narrow fail-open guards, not broad escape-hatch expansion.

## Verification

Run deterministic checks:

```bash
./tests/input-safety-hotkeys.sh
./tests/input-tap-readiness.sh
bash tests/dock-hook-isolation.sh
git diff --check
```

If live verification is safe and `./aos ready` passes without a permission blocker, run one bounded live smoke of the reset-runtime sequence, not a broad escape-hatch exercise:

```bash
./aos permissions reset-runtime --mode repo
./aos permissions setup --once
./aos ready --post-permission
```

Stop with `manual_intervention` before any step that would require the human to change
macOS permissions or if there is any risk of input capture during manual
recovery.

## Completion Report

Report:

- files changed;
- the exact reset-runtime safety invariant now enforced;
- tests run and results;
- live reset-runtime smoke result or the exact readiness/TCC blocker;
- any remaining human-only risk around macOS permissions or input capture.

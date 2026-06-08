# Implementer: Input Tap Stale Daemon Ready Hygiene V0

## Transfer

- recipient: Implementer
- kind: correction round
- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- source artifact: live user report plus Foreman diagnosis after
  `1bb4c553 fix(sigil): seed base wiki during activation`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## User Report

Michael reported mouse input jank that recently has indicated AOS/input-tap junk
blocking or consuming input.

Foreman immediately checked through AOS:

```text
./aos status --json
  status=degraded
  stale_daemons=2
  stale daemon pid=13808 args="./aos serve --idle-timeout 5m"
  stale daemon pid=13810 args="/Users/Michael/Code/agent-os/aos __serve --idle-timeout 5m"

./aos ready --json
  ready=true
  diagnosis=ready
  input_tap.status=active

./aos clean --dry-run --json
  status=dirty
  stale_daemons=[13808, 13810]
```

Running `./aos clean --json` cleared the stale daemon state. After Foreman folded
the latest Implementer seed correction and reactivated Sigil on
`feat/command-surface-extraction`, final live state was:

```text
./aos status --json
  status=ok
  branch=feat/command-surface-extraction
  stale_daemons=0
  input_tap.status=active
  daemon_pid=27839

./aos clean --dry-run --json
  status=clean
  stale_daemons=[]
  canvases=[]

./aos show list --json
  canvases=[]
```

The bug is not that `aos clean` exists. The bug is that `aos ready` can bless a
runtime as ready while `aos status` knows stale repo-mode daemon processes exist.
For input-tap ownership, that is too optimistic.

## Goal

Make AOS readiness and cleanup governance treat stale AOS daemon processes as a
runtime hygiene blocker until they are cleaned or proven harmless, so a session
does not proceed as "ready" while extra input-tap-capable processes may be
stacked.

## Read First

- `AGENTS.md`
- `src/commands/operator.swift`
- `scripts/aos-clean.mjs`
- `scripts/aos-service.mjs`
- `src/daemon/unified.swift`
- `tests/ready-fast-healthy-path.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/input-tap-readiness.sh`
- `tests/external-command-dispatch.sh`
- `docs/design/work-cards/implementer-experience-runtime-hygiene-correction-v0.md`

## Rediscover State

```bash
git status --short --branch
./aos status --json
./aos ready --json
./aos clean --dry-run --json
./aos show list --json
```

Use `./aos` for runtime control. Raw `ps`, `pgrep`, or process-table inspection
is acceptable only for the narrow singleton/stale-daemon diagnostics that AOS
does not yet expose directly; explain any bypass in the completion report.

If live AOS readiness hits repo-mode Accessibility/Input Monitoring or inactive
input-tap blockers, run:

```bash
the manual TCC blocker report path
```

After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

- In one runtime mode, AOS must not report `ready=true` when stale `aos serve` or
  `aos __serve` processes are detected by the same stale-daemon logic used by
  `./aos status` / `./aos clean --dry-run`.
- `./aos ready --json` should expose a clear runtime blocker or degraded
  diagnosis for stale daemons, with a next action that points to `./aos clean`
  or an existing repair flow.
- `./aos ready --repair --json`, if already intended to repair runtime hygiene,
  should clean stale daemons and then re-check readiness. If that is too broad
  for the current repair contract, document the reason and make the non-repair
  ready result clearly non-ready with `./aos clean` as the next action.
- `./aos clean --json` should not return a clean/cleaned status until stale
  daemon PIDs it reported are gone, or until it reports a failure/note naming
  what could not be killed or verified.
- The normal healthy path must remain fast and must not kill the managed daemon
  or its normal service wrapper/child relationship.
- The singleton contract should distinguish the expected service wrapper plus
  one `__serve` child from unrelated stale wrappers/children.

## Scope

Likely ownership boundary: readiness/status/clean governance and process
singleton diagnostics. Avoid broad daemon lifecycle redesign unless the current
code forces it.

## Hard Boundaries

- Do not kill unrelated user processes.
- Do not make `ready` destructive by default unless the command already has an
  explicit repair mode.
- Do not disable the one valid managed input tap.
- Do not add another command surface.
- Do not broaden into Sigil UI, graph/wiki, recipe, or experience manifest work.

## Suggested Implementation Areas

Inspect first; likely areas:

- `src/commands/operator.swift`
  - `statusCommand` already consumes `currentCleanReport()`.
  - `buildReadyResponse`, `readyBlockers`, `readyDiagnosis`, and
    `readyNextActions` likely need stale-daemon awareness.
- `scripts/aos-clean.mjs`
  - may need post-kill wait/reverification for stale daemon PIDs.
- Existing ready/clean tests may be enough to extend; otherwise add one focused
  regression for a stale daemon process shape.

## Verification

Run focused tests:

```bash
bash tests/ready-fast-healthy-path.sh
bash tests/ready-ownership-mismatch.sh
bash tests/input-tap-readiness.sh
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
git diff --check
```

Add or update regression coverage proving:

1. a healthy managed daemon still yields `ready=true`;
2. a stale `aos serve`/`aos __serve` process makes `./aos ready --json` non-ready
   or degraded with a stale-daemon cleanup next action;
3. `./aos clean --json` removes or explicitly reports any stale daemon it
   reported in dry-run.

If live readiness is available, finish with:

```bash
./aos clean --json
./aos ready --json
./aos status --json
./aos clean --dry-run --json
```

The final live state must show one managed daemon/input tap, no stale daemons,
and no canvases unless the user opened one during the run.

## Completion Report

Report:

- files changed;
- root cause of `ready=true` while `status=degraded` with stale daemons;
- whether `ready --repair` now cleans stale daemons or only routes the cleanup
  action;
- exact tests run and pass/fail result;
- final live AOS state from `ready`, `status`, `clean --dry-run`, and
  `show list`;
- any local-only state, especially daemon/canvas/process state;
- whether the branch was pushed.

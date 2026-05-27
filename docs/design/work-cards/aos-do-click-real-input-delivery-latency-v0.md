# AOS Do Click Real-Input Delivery Latency V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI implementation/validation round.
- Single next goal: make real-input click delivery timing useful for agents by
  either reducing safe `./aos do click` overhead or moving the focused
  status-item harness to a lower-latency, reusable real-input injection helper
  while reporting command/injection and app-response timings separately.
- Source artifact: follow-up from
  `docs/design/work-cards/sigil-status-item-summon-latency-v0.md` and current
  PR #378 status/radial live-proof work.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create or update
  `gdi/aos-do-click-real-input-delivery-latency-v0`, and push it.
- Stop conditions: complete, failed, human_needed, or blocker. Stop with
  `human_needed` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `gdi/aos-do-click-real-input-delivery-latency-v0`
- current PR stack checkpoint when routed: `1d6d747c`
  (`Merge status item stale root recovery`)

## Tracker

- Follow-up from `docs/design/work-cards/sigil-status-item-summon-latency-v0.md`.
- Source completion report: `gdi/sigil-status-item-summon-latency-v0`.
- Baseline evidence: status-item state synchronization is already correct, but
  a direct repo-mode measurement showed `./aos do click` command overhead of
  `2028.1ms` before the renderer became visible `165.8ms` later.
- Classification: measurement/test-tooling follow-up only. This does not
  explain the original background fan/resource consumption, which occurred while
  the user was not clicking and was using unrelated apps such as VS Code and
  Terminal.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, runtime
readiness, command timing, or root cause. Rediscover before editing.

## Goal

Make real-input click delivery measurements reflect actual app response time
instead of mostly measuring `./aos do click` command invocation overhead.

This slice should either reduce the overhead in the AOS `do click` path when
the daemon is already ready and the input tap is active, or adjust the status
item real-input harness to use an appropriate lower-latency real-input
injection boundary with timing split clearly reported.

Do not route this as the next product performance fix. If background resource
consumption persists after `11df6de`, investigate idle/background AOS canvas,
WebKit, BroadcastChannel, timer/listener, and renderer accumulation evidence
instead.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `src/main.swift`
- `src/act/act-cli.swift`
- `src/act/actions.swift`
- `src/act/session.swift`
- `tests/lib/status-item.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/real-input-surface-primitives.mjs`
- `tests/input-tap-readiness.sh`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "ensureInteractivePreflight|cliClick|handleClick|click_aos_status_item_real|do click|CGEventPost|click_dwell|real_input" src tests docs
```

If Swift files change, use the repo build surface recommended by the router.
Do not call `bash build.sh` directly.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop on
permission repair. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Stop with `human_needed`. After the human returns with `finished`, run exactly:

```bash
./aos ready --post-permission
```

## Current Evidence

The status-item follow-up branch found:

- no status sync code change was required because `origin/main` already routes
  `status_item.state` from the configured target canvas to
  `StatusItemManager.setPersistentVisible`;
- `bash tests/sigil-status-item-lifecycle.sh` passed;
- `bash tests/status-item-tracked-lifecycle-timeout.sh` passed;
- `bash tests/sigil-real-input-status-avatar.sh` passed;
- `./aos ready` reported `ready=true mode=repo daemon=reachable tap=active`;
- direct split timing measured:
  - `./aos do click` command overhead: `2028.1ms`;
  - renderer visible after click command returned: `165.8ms`;
  - total click-to-visible: `2193.8ms`.

That means the previously alarming first-click status item measurement is not a
renderer visibility transition or status-item state synchronization delay. It
is dominated by the real-input command path used by the harness.

This evidence is orthogonal to the original fan/load report. That report
occurred during ordinary desktop use with no click in progress, so the relevant
resource-consumption fix remains the idle/background render path work from
`11df6de` and any follow-up evidence of post-fix accumulation.

## Required Behavior

- When measuring app response to a real click, report at least two timings:
  event-delivery command/injection overhead and app-visible response after the
  event has been posted.
- The status item real-input smoke should not fail or imply an app regression
  because a local CLI invocation takes about two seconds before posting the
  event.
- Preserve `./aos do click` safety gates. Do not bypass Accessibility/Input
  Monitoring readiness checks for normal CLI use.
- If the command overhead is fixable without weakening safety, reduce it.
- If the overhead is mostly process startup, preflight, or shell/test harness
  cost, keep `./aos do click` semantics intact and use a lower-latency
  supervised real-input injection helper for tests that need precise click
  response timing.
- Native coordinate/CGEvent helpers are acceptable only at the final real-input
  injection boundary, with the same safety posture used by existing real-input
  harnesses.
- Any lower-latency helper must stay reusable and foundational. Do not create a
  Sigil-private click trick when the same primitive should support status items,
  radial targets, panels, and future Operator/GDI live checks.

## Scope

Allowed:

- focused changes to `tests/lib/status-item.sh`;
- focused changes to `tests/sigil-real-input-status-avatar.sh`;
- focused changes to reusable real-input test helpers under `tests/lib/`;
- focused AOS CLI/action changes only if timing evidence shows the overhead is
  in reusable command code and can be improved safely;
- focused tests for timing split output and input-tap readiness behavior.

Out of scope:

- status-item state synchronization changes;
- Sigil render-loop changes;
- Wiki Workbench warm/suspend/resume work;
- broad action-system rewrites;
- weakening TCC/input-tap preflight behavior.

## Suggested Investigation

1. Add temporary timing probes or use existing shell timing to split:
   bounds lookup, `./aos do click` process startup/preflight, action execution,
   CGEvent post, and renderer-visible response.
2. Inspect whether `ensureInteractivePreflight` or `cliSessionState` does
   repeated daemon/process work that can be cached or skipped only after
   `./aos ready` has proven the same condition.
3. Compare `./aos do click` against the existing Python/Quartz real-input
   primitive for one bounded status-item click.
4. Choose the smallest safe fix:
   - optimize reusable CLI overhead;
   - or keep CLI behavior and update the status-item harness to use the
     reusable low-latency real-input primitive for the final click while still
     reporting timing splits.

## Verification

Minimum checks:

```bash
git diff --check
./aos dev recommend --json
```

If Swift changed:

```bash
./aos dev build
```

If CLI preflight or action behavior changed:

```bash
bash tests/input-tap-readiness.sh
```

Focused live check if `./aos ready` passes:

```bash
bash tests/sigil-real-input-status-avatar.sh
```

If changing reusable real-input helpers, also run the smallest adjacent harness
tests recommended by `tests/README.md` and the harness ladder recipe.

The completion report must include the split timing before and after the
change. If total click-to-visible remains over `2000ms` only because command
startup is still counted, the report must state the renderer-visible latency
separately.

## Completion Report

Include:

- files changed;
- confirmed slow stage;
- before/after split timings;
- whether `./aos do click` itself changed or the harness moved to a lower
  latency injection helper;
- exact tests/builds run and pass/fail results;
- `./aos ready` result or blocker;
- any remaining product-facing status item latency risk.

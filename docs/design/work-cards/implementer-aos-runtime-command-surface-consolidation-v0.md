# Implementer Work Card: AOS Runtime Command Surface Consolidation V0

## Transfer

- recipient: Implementer
- kind: Implementer round
- governing issue: #113
- related card to absorb/supersede:
  `docs/design/work-cards/implementer-aos-daemon-unmanaged-owner-guardrail-v0.md`
- source artifact: Foreman diagnosis that `ready`, `status`, `doctor`,
  `clean`, and `service` duplicate runtime verdict, recovery, and cleanup
  language.

## Branch / Base

- `branch_from`: local `main`
- `required_start_ref`: local `main` containing this card
- `minimum_code_start_ref`:
  `3c187aca827b3512f4bcaa6041d371bb8f1aba64`
- `expected_output_branch`:
  `implementer/aos-runtime-command-surface-consolidation-v0`

Do not start from `origin/main`; this is local-relay state. Do not create linked
worktrees. Preserve unrelated untracked files, especially `.playwright-cli/`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Current Runtime Boundary

AOS is intentionally stopped at dispatch time. The repo service is installed
but unloaded/not running. Do not run live readiness/control commands unless
Foreman or the human explicitly approves restarting AOS.

Allowed passive classification:

```bash
./aos service status --mode repo --json
ps -axo pid,ppid,stat,etime,command | rg '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
lsof -nP -U | rg '/Users/Michael/.config/aos/repo/sock|/Users/Michael/Code/agent-os/aos' || true
```

Do not classify a repo AOS process as unmanaged from `pgrep`, `ps`, or PPID 1
alone. A launchd-managed repo service also appears as
`/Users/Michael/Code/agent-os/aos serve --idle-timeout none` with PPID 1. If a
real process is present, classify by service status and expected target,
launchd PID, socket owner, then command line before deciding whether it is a
blocker.

## Goal

Reduce AOS runtime command-surface sprawl by creating one shared runtime verdict
and action-plan contract that `./aos ready`, `./aos status`, `./aos doctor`,
`./aos service`, and `./aos clean` consume according to their roles, while
preserving public command availability.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/design/work-cards/implementer-aos-daemon-unmanaged-owner-guardrail-v0.md`
- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-doctor.mjs`
- `scripts/aos-clean.mjs`
- `scripts/aos-service.mjs`
- `scripts/lib/aos-facts.mjs`
- `scripts/lib/aos-readiness.mjs`
- `scripts/lib/aos-cli.mjs`
- `tests/aos-readiness-composition.test.mjs`
- `tests/ready-ownership-mismatch.sh`
- `tests/ready-stale-daemon-hygiene.sh`
- `tests/ready-auto-repair-flow.sh`
- `tests/external-command-dispatch.sh`
- `tests/help-contract.sh`

## Rediscover State

Use passive/non-live orientation:

```bash
git status --short --branch
git rev-parse HEAD
./aos dev gh issue view 113 --json
./aos service status --mode repo --json
ps -axo pid,ppid,stat,etime,command | rg '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
lsof -nP -U | rg '/Users/Michael/.config/aos/repo/sock|/Users/Michael/Code/agent-os/aos' || true
./aos dev recommend --json --paths scripts/aos-ready.mjs,scripts/aos-status.mjs,scripts/aos-doctor.mjs,scripts/aos-clean.mjs,scripts/aos-service.mjs,scripts/lib/aos-facts.mjs,scripts/lib/aos-readiness.mjs,tests/aos-readiness-composition.test.mjs,tests/ready-ownership-mismatch.sh,tests/ready-stale-daemon-hygiene.sh,tests/ready-auto-repair-flow.sh
rg -n "runtimeHealthNotes|readyBlockers|readyNextActions|readyAutoRepairReason|readinessRecovery|cleanReport|service start|service restart|daemon_unmanaged|daemon_ownership_mismatch|stale_daemons" scripts tests docs/api/aos.md
```

## Observed Sprawl

Foreman found these overlaps:

- `scripts/aos-ready.mjs` builds readiness, blockers, next actions, startup,
  clean repair, restart repair, and human handoff.
- `scripts/aos-status.mjs` separately builds runtime notes, clean dry-run
  summaries, daemon snapshot degradation, and recommended entrypoints.
- `scripts/aos-doctor.mjs` separately builds runtime notes, service state,
  permission notes, and readiness source.
- `scripts/aos-service.mjs` owns launchd lifecycle but also has a separate
  `_verify-readiness` path with its own recovery arrays and notes.
- `scripts/aos-clean.mjs` owns stale daemon/canvas detection and mutation, but
  its report is reinterpreted by `ready` and `status`.
- `scripts/lib/aos-facts.mjs` already has `runtimeHealthNotes`, but it still
  emits guidance that conflicts with `readyAutoRepairReason` for
  `daemon_unmanaged`.

## Required Behavior

### Command Roles Are Singular

Preserve the commands, but make their roles explicit in code and tests:

- `ready`: the readiness gate and the only command that may orchestrate
  automatic start/restart/repair behavior.
- `status`: passive current-state summary; no repair and no service mutation.
- `doctor`: passive diagnostic aggregation; no repair and no service mutation.
- `clean`: cleanup plan/executor for stale resources; no readiness verdict of
  its own.
- `service`: launchd lifecycle and service configuration state. It may report
  readiness probe facts after start/restart, but recovery/guidance should come
  from the shared runtime verdict/action-plan contract rather than bespoke
  service-only arrays.

Do not remove public commands in this slice.

### Shared Runtime Verdict

Create or reshape a shared JS helper, likely in `scripts/lib/`, that takes the
existing broker facts plus clean/service facts and returns a single
machine-readable runtime verdict:

- `ready` boolean or equivalent;
- `phase`;
- `diagnosis`;
- `blockers`;
- `blocked_capabilities`;
- `notes`;
- `next_actions`;
- ownership facts, including unmanaged owner PID and command line when
  available;
- cleanup facts needed to reason about stale daemons/canvases.

The helper should be pure or dependency-injectable enough to test without live
AOS. Existing `readyBlockers`, `readyPhase`, `readyDiagnosis`,
`readyNextActions`, `readyNotes`, and `runtimeHealthNotes` are candidates to
fold into this contract rather than leaving separate competing sources.

### No Conflicting Guidance

Make these invariants true across `ready`, `status`, `doctor`, and service
readiness output:

- `daemon_unmanaged` must not recommend repeated `ready --repair`,
  `service start`, or `service restart` loops.
- `stale_daemons` should point first to `clean`; `ready --repair` may run
  cleanup only in explicit repair mode.
- ownership mismatch should identify serving/lock/service PIDs and use the
  shared action plan.
- input-tap-not-active recovery should have one source of text/commands.
- permission/TCC handoff should stay in the existing broker/reset sequence and
  not be reimplemented in service or status.

### Guardrail Card Is Absorbed

Carry forward the concrete `daemon_unmanaged` guardrail from
`implementer-aos-daemon-unmanaged-owner-guardrail-v0.md`:

- unmanaged owner PID and command line should be visible in JSON where the
  current contract naturally puts runtime ownership details;
- process-command unavailable should be explicit rather than fabricated;
- `pgrep`/PPID 1 alone is not a verdict.

If the smaller guardrail card has not been run yet, this card supersedes it.

### API Docs Stay Honest

Update `docs/api/aos.md` only where current documented behavior or examples
would otherwise contradict the simplified command roles or JSON fields. Do not
turn this into a broad docs rewrite.

## Scope

This is external AOS command composition and deterministic test cleanup. Prefer
Node/script-layer changes. Do not edit Swift/native code unless you discover a
privileged fact or socket substrate change that cannot be supplied externally;
if that happens, stop with `foreman_rebuild_needed` and explain the
native-boundary justification.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or run real live readiness/control commands.
- Do not kill real user processes.
- Do not reset TCC, open Settings, run `permissions setup`, or run
  the manual TCC blocker report path unless a deterministic mock test
  unexpectedly turns into a real TCC blocker.
- Do not remove public command names or compatibility-facing JSON fields unless
  the repo tests prove they are internal-only and all callers are updated in the
  same slice.
- Do not change Sigil, toolkit surface behavior, scheduler behavior, or live
  smoke procedures.
- Do not push, open a PR, or mutate GitHub state. Foreman owns issue updates,
  publication, branch cleanup, and acceptance.

## Suggested Implementation Shape

1. Introduce one shared verdict/action-plan helper in `scripts/lib/`, or
   reshape `scripts/lib/aos-readiness.mjs` if that is cleaner.
2. Convert `ready` to use that helper without changing its public behavior
   except for fixing contradictory unmanaged guidance.
3. Convert `status` and `doctor` notes/action guidance to consume the same
   verdict fields instead of rebuilding runtime notes.
4. Convert service readiness recovery text/arrays to use the shared helper or a
   shared formatter, while leaving launchd lifecycle behavior in
   `scripts/aos-service.mjs`.
5. Keep `clean` as the stale-resource source of truth; if shared code needs
   clean facts, consume `clean --dry-run`/shared clean report data instead of
   duplicating stale process detection.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/aos-readiness-composition.test.mjs
bash tests/ready-ownership-mismatch.sh
bash tests/ready-stale-daemon-hygiene.sh
bash tests/ready-auto-repair-flow.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/help-contract.sh
```

Add focused deterministic coverage proving:

1. `daemon_unmanaged` next actions and notes do not contain `ready --repair`,
   `service start`, or `service restart`.
2. `status`, `doctor`, and `ready` agree on the same diagnosis for unmanaged,
   ownership mismatch, stale daemons, and input tap inactive mock states.
3. Service readiness output does not carry a bespoke recovery list that
   contradicts the shared runtime verdict.
4. Managed launchd repo service shape is not mistaken for unmanaged solely
   because the wrapper has PPID 1.

Do not run live `./aos ready`, `./aos status`, `./aos clean`, `./aos service
start`, `./aos service restart`, or Sigil live smoke in this round. The final
report should say live checks were intentionally skipped because AOS is stopped.

## Completion Report

Return a concise report with:

- branch name and head SHA;
- changed paths;
- the final shared verdict/helper shape;
- which commands now consume it and what duplicate guidance was removed;
- whether the smaller daemon-unmanaged guardrail card is fully absorbed;
- exact verification commands and pass/fail results;
- confirmation that no live AOS restart/control command was run;
- passive runtime classification at the end (`service status`, process list,
  socket owner);
- unrelated dirty/untracked state, including `.playwright-cli/` if still
  present.

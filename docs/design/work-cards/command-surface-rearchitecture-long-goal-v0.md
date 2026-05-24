# Work Card: Command Surface Rearchitecture Long Goal V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round, intentionally long-running `/goal`
- Single next goal: rearchitect the `aos` command surface so changing command logic no longer requires rebuilding the TCC-sensitive Swift binary.
- Source branch: `feat/command-surface-extraction`
- Required start ref: `origin/feat/command-surface-extraction`
- Output expectation: work autonomously on this branch for as long as needed; commit coherent checkpoints; push only if the active GDI/provider contract permits or the human explicitly asks.

## Foreman Override

This card intentionally overrides the usual small-slice Foreman/GDI workflow for
this branch. Michael wants one large `/goal` that can run for days or weeks.

Do not stop after demolition, one command, one commit, or the first green-ish
subset. Keep going until the success criteria are met or a true human blocker is
hit.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before editing.

## North Star

Changing command logic must not touch the TCC-sensitive Swift binary.

The Swift binary should become stable infrastructure:

- socket / IPC server and client primitives;
- TCC-gated native primitives;
- permission/readiness/runtime bootstrap;
- manifest dispatcher or external-command launcher;
- minimal compatibility needed to load and invoke external command logic.

Command behavior, argument shapes, help/registry metadata, workflow policy, and
implementation logic should move out of compiled Swift and into external
manifests/modules/scripts that can change without rebuilding the TCC binary.

## User Plan

### Phase 0 - Goal Loop Pause Guard

Before command-surface demolition, fix the repeated wasted rebuild/TCC loop.

Observed failure mode:

1. GDI runs `./aos dev build`.
2. The build succeeds but the rebuilt repo-mode `./aos` loses or stales
   Accessibility/Input Monitoring.
3. Codex keeps spending tokens on readiness classification, helper ritual,
   repeated status commands, and verbose `human_needed` reporting.
4. The goal should have paused immediately at the deterministic checkpoint.

There is no known Codex config/API switch for hard declarative pause conditions.
The supported mechanism is still `/goal pause`, so implement this at the Codex
hook/harness layer, not as a GDI-only convention:

- encode the pause condition in this `/goal` contract;
- add a dock/Codex hook for `PostToolUse` or the nearest supported tool-result
  event so this applies to all Codex docks, not just GDI;
- make the hook detect a completed `./aos dev build` tool call, run one bounded
  post-build readiness classification, and stop the loop with a concise
  instruction to issue `/goal pause`;
- use the existing Stop hook / stop-condition marker for TTS once the goal
  pauses;
- avoid repeated ad-hoc `./aos ready`, helper, status, and report loops after a
  rebuild has already proven the human permission reset is needed;
- add deterministic tests around the hook/stop-condition behavior before
  relying on it for the long rearchitecture.

A wrapper may still exist as a fallback for non-Codex/manual invocations, but it
is not the primary solution and must not be required for GDI to get the pause
behavior.

The desired behavior after any Swift rebuild is:

```text
build passed; readiness requires repo-mode TCC/Input Monitoring reset;
pause the current goal now with /goal pause; human should run the permission
setup path and resume with /goal resume after ready=true
```

Do not proceed to Phase 1 until this guardrail exists and is verified.

### Phase 1 - Demolition

Rip the command surface out of the Swift binary aggressively. Do not preserve
the old registry for comfort. Do not build a long compatibility migration first.

The binary becomes socket + TCC primitives + manifest dispatcher. It is expected
to be broken after this phase. Commit the demolition anyway as a clear checkpoint.

### Phase 2 - Proof Of Life

Get one real command running end-to-end externally. Pick the hardest one:
AFK trigger.

Use actual AFK trigger execution to shape the IPC protocol and manifest format.
Design from observed sharp edges, not from a speculative spec.

### Phase 3 - Flood Fill

Port all remaining commands externally, rough and fast. Some will be janky at
first. That is acceptable during this phase.

The point is to discover the skeleton from reality.

### Phase 4 - Shore Up

Fix what broke. Harden IPC, manifest validation, help output, error behavior,
test fixtures, and workflow routing based on actual failures.

Add validation where the implementation got cut, not where a theoretical design
said risk might exist.

### Phase 5 - Stabilize

Reach a clean state:

- no compiled command logic remains in Swift except stable dispatch/native
  primitives;
- no duplicated old/new command surfaces;
- manifests and external modules are the single command source of truth;
- `aos` commands work 100%;
- all tests are green;
- all repo dirt is cleaned or intentionally committed;
- future command logic changes should rarely require Swift rebuilds or TCC resets.

## Required Start

```bash
git fetch origin
git switch feat/command-surface-extraction
git status --short --branch
```

If local user work exists, do not discard it. Classify it and report before
resetting or overwriting.

## Read First

- `AGENTS.md`
- `src/AGENTS.md` if present
- `src/main.swift`
- `src/shared/command-registry.swift`
- `src/shared/command-registry-data.swift`
- `src/shared/command-help.swift`
- `src/commands/dev.swift`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/help-contract.sh`
- `tests/dev-workflow-router.sh`
- `docs/archive/superpowers/specs/2026-04-15-command-registry-design.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/dev/workflow-rules.json`

Then search broadly. The command surface is not only the old help registry.
Expect routing, tests, docs, workflow rules, shell scripts, and Node prototypes
to encode command behavior.

Useful starting searches:

```bash
rg -n "buildCommandRegistry|commandRegistry|printCommandHelp|helpCommand|InvocationForm|CommandDescriptor" src tests docs scripts
rg -n "afk-session-trigger|afk-launch-attempt|afk-dry-run|dev workflow|workflow-rules" src scripts tests docs shared
rg -n "aos help|--help|UNKNOWN_COMMAND|UNKNOWN_FLAG|MISSING_ARG|MISSING_SUBCOMMAND" src tests docs scripts
```

## Design Constraints

- Optimize for the north star, not incremental comfort.
- It is acceptable for tests to fail in the middle. Use failures as a map.
- Prefer real command behavior over speculative manifest purity.
- AFK trigger is the proof command because it exercises hard edges: args,
  JSON receipts, filesystem inputs/outputs, provider launch gating, readiness,
  cleanup, idempotence, and workflow policy.
- The manifest/IPC format must be robust enough that after it stabilizes, most
  command changes happen outside Swift.
- Keep the Swift side narrow and boring.
- Keep commits understandable even if the overall goal is long.

## TCC / Rebuild Guidance

Early demolition may require Swift rebuilds and therefore TCC readiness repair.
That is acceptable.

After Phase 0, do not perform the old ritual after a rebuild-triggered TCC
blocker. The hook-enforced goal-loop rule is:

- if a Codex tool call runs `./aos dev build` and it succeeds, the post-tool
  hook runs exactly one bounded readiness classification;
- if that classification reports stale/missing repo-mode TCC or inactive input
  tap, immediately pause the active goal with `/goal pause`;
- print only the concise human action and resume command;
- do not keep polling, do not run redundant status commands, and do not spend
  another cycle proving the same blocker;
- after the human returns and says `ready`, run only
  `./aos ready --post-permission`; if it reports `ready=true`, resume the next
  verification step.

The target architecture should quickly settle a future-accommodating manifest
and IPC shape so the Swift binary rarely changes after the dispatcher/native
primitive layer is stable.

If readiness reports repo-mode TCC/input-tap trouble during live checks, use the
repo-standard recovery path:

```bash
./aos permissions reset-runtime --mode repo
./aos permissions setup --once
./aos ready --post-permission
```

If the human must intervene, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

and stop with a clear `human_needed` report.

## Hard Boundaries

- Do not mutate `main`.
- Do not delete remote branches.
- Do not open or mutate GitHub issues/PRs unless explicitly instructed.
- Do not read or paste provider transcript bodies unless a later explicit card
  or human instruction authorizes it.
- Do not leave secret-bearing temp files, provider stores, or unbounded runtime
  artifacts in the repo.
- Do not stop merely because the usual small-slice workflow would stop.

## Expected Checkpoints

Use commits as recoverable checkpoints. Suggested checkpoint sequence:

0. Goal-loop guard commit: Codex post-tool hook detects rebuild-triggered
   TCC/input-tap degradation and causes a concise `/goal pause` checkpoint
   instead of repeated readiness/helper ritual.
1. Demolition commit: Swift command surface removed or reduced to dispatcher
   scaffolding, even if tests fail.
2. External manifest/IPC proof commit: AFK trigger runs externally end-to-end.
3. Flood-fill commits: remaining command families ported externally.
4. Hardening commits: IPC/manifest validation, help behavior, errors, routing,
   and tests repaired.
5. Stabilization commit: green test suite and clean dirt.

This sequence is guidance, not a cage. If reality suggests a better order,
choose it and document why in the completion report.

## Verification / Success Criteria

The goal is not complete until all are true:

- Rebuild-triggered repo-mode TCC/input-tap degradation has a deterministic
  Codex hook-level `/goal pause` path, verified by tests.
- `aos` commands work 100% for the repo's supported command surface.
- Existing help/JSON/error contracts are repaired or intentionally updated with
  matching tests/docs.
- AFK trigger works end-to-end through the external command surface.
- All deterministic tests are green.
- Live/runtime tests that are part of the supported surface pass when readiness
  is available.
- `./aos ready --post-permission` is understood and either ready or blocked only
  on a clearly reported human/macOS permission condition.
- Worktree is clean except intentional committed changes.
- No old compiled command registry/command logic remains as an active fallback.
- Manifests/external command modules are the command source of truth.

Run at least:

```bash
./aos dev build
bash tests/dock-hook-isolation.sh
bash tests/help-contract.sh
bash tests/dev-workflow-router.sh
bash tests/dev-audit.sh
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/schemas/dev-workflow-rules.test.mjs tests/schemas/dev-active-profile.test.mjs tests/schemas/dev-workflow-profiles.test.mjs
git diff --check
```

Also run broader repo tests discovered by `./aos dev recommend --json` and by
the changed paths. If a full test command exists and is feasible, run it before
claiming completion.

## Completion Report Required

Do not report completion until the success criteria are met.

Final report must include:

- classification: pass/fail/human_needed;
- architecture summary: what remains in Swift, what moved external, how IPC and
  manifests work;
- changed files grouped by subsystem;
- commit list created during the goal;
- AFK trigger proof evidence;
- full verification commands and exact pass/fail results;
- readiness/TCC state;
- final `git status --short --branch`;
- known remaining risks or explicit statement that no blockers remain.

If blocked, report:

- blocker class;
- exact phase/checkpoint reached;
- last good commit;
- dirty state;
- minimal human action needed;
- next command GDI will run after the human returns.

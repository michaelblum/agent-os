# Work Card: Command Surface Rearchitecture Long Goal V0

**Status:** Ready after input-tap safety prerequisite

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round, intentionally long-running `/goal`
- Single next goal: rearchitect the `aos` command surface so changing command logic no longer requires rebuilding the TCC-sensitive Swift binary.
- Source branch: `feat/command-surface-extraction`
- Required start ref: `origin/feat/command-surface-extraction` after the
  input-tap safety prerequisite has been accepted.
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

### Phase 0 - Accepted Goal Loop Pause Guard

The repeated wasted rebuild/TCC loop has been handled as accepted prerequisite
work on this branch. Do not redo it as the first part of the long goal.

Observed failure mode:

1. GDI runs `./aos dev build`.
2. The build succeeds but the rebuilt repo-mode `./aos` loses or stales
   Accessibility/Input Monitoring.
3. Codex keeps spending tokens on readiness classification, helper ritual,
   repeated status commands, and verbose `human_needed` reporting.
4. The goal should have paused immediately at the deterministic checkpoint.

The current branch now has the hook/harness implementation and deterministic
coverage for this guard:

- successful `./aos dev build` writes the completed-build checkpoint and
  produces the concise repo-mode TCC permission repair stop condition;
- GDI gets `/goal pause` injected through the dock PTY helper when a control
  target is available;
- `/goal resume` guidance is staged after the pause;
- repeat builds are blocked until `./aos ready --post-permission`;
- successful post-permission readiness clears the checkpoint and human-needed
  surface;
- failed builds and unrelated commands do not synthesize the pause.

Relevant accepted commits on this branch:

- `be668f8e` - pause GDI after AOS rebuild;
- `9a84944e` - centralize AOS build checkpoint contract;
- `d2aa65ac` - document hook-owned checkpoint cleanup.

The desired behavior after any successful `./aos dev build` is:

```text
build passed; pause the current goal now with /goal pause; human should run the
permission setup path and resume with /goal resume; after resume, run
./aos ready --post-permission once before continuing verification
```

Do not proceed to Phase 1 if this guardrail regresses. Re-run
`bash tests/dock-hook-isolation.sh` before depending on it.

### Phase 0.5 - Input-Tap Permission Reset Safety

Before command-surface demolition, complete and accept
`docs/design/work-cards/gdi-input-tap-permission-reset-safety-v0.md`.

Reason: command-surface work will still require some Swift rebuilds early in the
demolition. If repo-mode TCC/Input Monitoring gets reset while the daemon keeps
an active event-tap path, the user can lose reliable mouse/keyboard control
during permission repair. That safety bug is more important than the command
surface extraction.

Required invariant before Phase 1:

- during permission reset/regrant recovery, AOS fails open before any downstream
  input consumer can consume or interfere with user events;
- Command+Option+Escape activates real passthrough, not just visual feedback;
- permission recovery remains `./aos permissions reset-runtime --mode repo`,
  `./aos permissions setup --once`, then `./aos ready --post-permission`;
- live-dependent work stops with the dock-owned human-needed path when TCC/input
  tap recovery requires manual action.

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

Do not reset this branch to `origin/feat/command-surface-extraction` unless
Foreman explicitly says to. The local branch currently contains prerequisite
governance, rebuild-pause, interaction-map, and safety-routing work that may not
exist on the remote tracking ref yet.

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
- `tests/dock-hook-isolation.sh`
- `docs/archive/superpowers/specs/2026-04-15-command-registry-design.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/work-cards/gdi-input-tap-permission-reset-safety-v0.md`
- `docs/design/notes/aos-interaction-surfaces-map-2026-05-25.md`
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
- Use `./aos` as the first control plane for runtime/session/surface inspection
  and mutation. Raw `curl`, `tmux`, sockets, launchd, and state-file inspection
  are last-resort diagnostics unless the task is explicitly testing that lower
  layer or repairing the AOS control plane.

## TCC / Rebuild Guidance

Early demolition may require Swift rebuilds and therefore TCC readiness repair.
That is acceptable only after Phase 0.5 is complete.

After Phase 0, do not perform the old ritual after a successful rebuild. The
hook-enforced goal-loop rule is:

- if a Codex tool call runs `./aos dev build` and it succeeds, immediately
  request `/goal pause` for the active GDI session through the control helper;
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

0. Prerequisite verification commit if needed: confirm the accepted goal-loop
   guard and input-tap safety are still green before demolition.
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
- Permission reset/regrant paths fail open for user input and do not leave a
  live event tap consuming user events during manual recovery.
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

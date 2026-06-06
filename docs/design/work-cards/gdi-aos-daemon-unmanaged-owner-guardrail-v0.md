# GDI Work Card: AOS Daemon Unmanaged Owner Guardrail V0

## Transfer

- recipient: GDI
- kind: correction round
- governing issue: #113
- related surface ledger: #223
- source artifact: #113 guardrail observation comment recorded during the
  scheduler-adoption live-smoke pause

## Branch / Base

- `branch_from`: local `main`
- `minimum_code_start_ref`:
  `95e3e615f75d01ce6d83ef22d467912db42517cb`
- `required_start_ref`: local `main` containing this work card, descendant of
  `95e3e615f75d01ce6d83ef22d467912db42517cb`
- `expected_output_branch`:
  `gdi/aos-daemon-unmanaged-owner-guardrail-v0`

Do not start from `origin/main`: the scheduler-adoption checkpoint and this
work card are local-relay state. Do not create linked worktrees. Preserve
unrelated untracked files, especially `.playwright-cli/`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Current Runtime Boundary

AOS is intentionally stopped at dispatch time. The prior live smoke found an
unmanaged foreground daemon pair:

```text
31441 ./aos serve --idle-timeout 5m
31443 /Users/Michael/Code/agent-os/aos __serve --idle-timeout 5m
```

PID 31443 owned `/Users/Michael/.config/aos/repo/sock` and held the active
input tap. Terminating the foreground pair cleared the socket owner and the
human confirmed mouse lag was gone.

Do not run real live AOS readiness/control commands for this card. In
particular, do not run unscoped `./aos ready`, `./aos status`, `./aos clean`,
`./aos service start`, or `./aos service restart` unless Foreman or the human
explicitly says AOS may be restarted. Mock-daemon/state-root tests that set
their own `AOS_STATE_ROOT` and `AOS_TEST_*` variables are allowed.

## Goal

Make `daemon_unmanaged` diagnostics name the foreground owner PID and command
line, and make the recovery contract stop agents from repeating AOS repair or
service restart loops when the unmanaged owner still controls the repo socket
and input tap.

## Read First

- `AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-clean.mjs`
- `scripts/lib/aos-facts.mjs`
- `scripts/lib/aos-readiness.mjs`
- `scripts/lib/aos-cli.mjs`
- `tests/aos-readiness-composition.test.mjs`
- `tests/ready-ownership-mismatch.sh`
- `tests/ready-auto-repair-flow.sh`
- `tests/ready-stale-daemon-hygiene.sh`

## Rediscover State

Use only non-daemon orientation:

```bash
git status --short --branch
git rev-parse HEAD
./aos dev gh issue view 113 --json
./aos dev gh issue view 223 --json
./aos dev recommend --json --paths scripts/aos-ready.mjs,scripts/aos-status.mjs,scripts/aos-clean.mjs,scripts/lib/aos-facts.mjs,scripts/lib/aos-readiness.mjs,tests/aos-readiness-composition.test.mjs,tests/ready-ownership-mismatch.sh,tests/ready-auto-repair-flow.sh,tests/ready-stale-daemon-hygiene.sh
pgrep -af '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
rg -n "daemon_unmanaged|ownership_state|owner_pid|runtimeHealthNotes|readyNextActions|readyAutoRepairReason|ready --repair|service restart" scripts tests src docs/api/aos.md
```

If `pgrep` finds a real repo AOS owner, do not kill it and do not run AOS repair
loops. Stop and report `human_needed` with the PID/command.

## Required Behavior

### Foreground Owner Evidence

When `runtime.ownership_state === "unmanaged"`, `./aos ready --json` and
`./aos status --json` should expose the owner PID and command line in a
machine-readable place. Choose the narrowest stable shape after reading the
current JSON contracts; acceptable examples include:

- `runtime.owner_command_line`;
- `runtime.owner_process.command_line`;
- `runtime.input_tap.owner_command_line`.

Keep existing owner PID fields. If the process command line is unavailable
because the process exited or `ps` cannot read it, expose that explicitly as an
unknown/unavailable state rather than fabricating a command.

Prefer external composition in the Node readiness/status layer. Do not edit
Swift or native daemon code unless there is no JS-side way to add the evidence;
if Swift changes appear required, stop with `foreman_rebuild_needed` and report
the exact native-boundary justification. Foreman owns native rebuilds.

### No Misleading Repair Loop

For `daemon_unmanaged`, the public guidance must not tell agents to keep trying
`ready --repair`, `service start`, or `service restart` as the main recovery
path. Current code already keeps `readyAutoRepairReason` null for
`daemon_unmanaged`; keep that invariant and align all notes/status guidance
with it.

The guidance should say, in effect:

- the repo socket is owned by an unmanaged foreground daemon;
- the owner PID and command line are the relevant fact;
- run at most the bounded cleanup path that AOS actually owns, if it can handle
  this case;
- if cleanup cannot clear that owner, stop and hand the exact PID/command to
  Foreman/human instead of looping AOS repair.

Do not add a broad public `kill` workflow. If a process termination command is
needed, make it an explicit human/Foreman handoff note rather than an automatic
agent action.

### Cleanup Contract Is Honest

Inspect `scripts/aos-clean.mjs` before choosing the final contract. If `clean`
can safely classify and clear a foreground repo `aos serve` / `aos __serve`
owner that is not launchd-managed, add deterministic coverage for that path. If
it cannot safely own cleanup yet, leave `clean` non-destructive and make the
readiness/status guidance state that cleanup may be insufficient and the
foreground owner PID/command should be returned to Foreman.

Do not make plain `./aos ready` destructive by default.

## Scope

This is a readiness/status/cleanup guardrail slice in the external AOS command
composition layer. It is not a Sigil or scheduler regression, and it is not a
TCC permission reset slice.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or run real live AOS readiness/control commands.
- Do not kill real user processes.
- Do not reset TCC, open Settings, run `permissions setup`, or run
  `.docks/gdi/scripts/human-needed-tcc-reset` unless a deterministic mock test
  unexpectedly turns into a real TCC blocker.
- Do not change Sigil, toolkit surface behavior, scheduler behavior, or Phase 3
  surface migration code.
- Do not move policy/product/help/recovery behavior into native Swift without
  the explicit native-boundary stop described above.
- Do not push, open a PR, or mutate GitHub state. Foreman owns issue updates,
  publication, branch cleanup, and acceptance.

## Suggested Implementation Areas

- `scripts/lib/aos-facts.mjs` - likely place to enrich runtime facts with owner
  process command-line details using `/bin/ps`.
- `scripts/lib/aos-readiness.mjs` - blocker message, notes, and next-action
  invariants for `daemon_unmanaged`.
- `scripts/aos-status.mjs` - status notes should not recommend repair loops for
  unmanaged foreground owners.
- `scripts/aos-clean.mjs` - only if cleanup can safely and deterministically own
  foreground repo daemon cleanup.
- `tests/aos-readiness-composition.test.mjs` - pure JSON/decision coverage.
- `tests/ready-ownership-mismatch.sh` - mock daemon coverage for unmanaged owner
  output and no repair-loop guidance.

## Verification

Run deterministic checks only:

```bash
git diff --check
node --test tests/aos-readiness-composition.test.mjs
bash tests/ready-ownership-mismatch.sh
```

If you touch `scripts/aos-clean.mjs` or cleanup guidance, also run:

```bash
bash tests/ready-stale-daemon-hygiene.sh
bash tests/ready-auto-repair-flow.sh
```

If you touch command dispatch/help text, also run:

```bash
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
```

Do not run live `./aos ready`, `./aos status`, `./aos clean`, `./aos service`,
or Sigil live smoke in this round. The completion report should say live checks
were intentionally skipped because AOS is stopped after the input-lag incident.

## Completion Report

Return a concise report with:

- branch name and head SHA;
- changed paths;
- exact JSON fields or messages that now expose unmanaged owner PID/command;
- whether `daemon_unmanaged` guidance still mentions `ready --repair`,
  `service start`, or `service restart`;
- whether `clean` now owns this case or the result is an explicit Foreman/human
  handoff;
- exact verification commands and pass/fail results;
- confirmation that no live AOS restart/control command was run;
- current `pgrep` result for real AOS processes;
- known unrelated dirty/untracked state, including `.playwright-cli/` if still
  present.

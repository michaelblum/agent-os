# Operator TCC Reset Agent/User Path V0

## Tracker

- Immediate fix commit: `8939e10 Add safe runtime TCC reset flow`
- Manual test commit: `ff7f5ca Add manual TCC reset handoff test`
- Manual test script: `tests/manual/tcc-reset-agent-user-path.sh`
- Test docs: `tests/README.md`

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume daemon state,
permission state, terminal interactivity, or prior Foreman context. Rediscover
state before running the supervised test.

## Goal

Run the repo-mode TCC reset agent/user path with Michael as the supervised human,
using the manual test harness added for this exact flow. Validate that the agent
asks for permission at the right boundaries and never asks Michael to remove an
active daemon from macOS privacy settings.

This is supervised runtime/HITL verification. Do not edit code, create commits,
open GitHub issues, or broaden into implementation work.

## Read First

- `AGENTS.md`
- `.docks/operator/AGENTS.md`
- `tests/README.md`, section "Manual Disruptive TCC Recovery Test"
- `tests/manual/tcc-reset-agent-user-path.sh`

## Rediscover State

Run these first from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
./aos service status --mode repo --json
bash tests/manual/tcc-reset-agent-user-path.sh --dry-run
```

The dry run is non-mutating and should pass before any disruptive test is
attempted.

## Supervised Test Procedure

### 1. Confirm Interactivity And Consent

The full test requires an interactive terminal. If Operator cannot provide a TTY
for the command, stop and report that blocker.

Before running a mutating command, tell Michael:

- the test may reset Accessibility, Input Monitoring, and PostEvent grants;
- macOS may prompt for fresh approvals;
- the script stops the repo daemon by default on exit;
- the first full run does not authorize the broad TCC service reset.

Ask Michael for explicit approval in the Operator session before continuing.

### 2. Run The First Full Path

Run the guarded test without broad fallback:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

Follow the script prompts exactly. If the script reaches the broad-reset boundary
and exits with the "Broad service reset was not authorized" PASS message, treat
that as valid evidence for the human-approval boundary.

### 3. Broad Reset Requires A Second Explicit Approval

Do not run broad reset by default.

Only if Michael explicitly asks to validate full recovery after seeing the
targeted-reset result, run:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 AOS_ALLOW_BROAD_TCC_RESET=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

Follow the script prompts exactly. Do not improvise manual System Settings
remove/re-add steps outside the harness.

### 4. Cleanup And Final Runtime State

On success, cancellation, or failure, collect final daemon state:

```bash
./aos service status --mode repo --json
```

If the flow fails, is cancelled, or leaves uncertain input ownership, run:

```bash
./aos service stop --mode repo
./aos service status --mode repo --json
```

Do not leave a running repo daemon as an accident of the test.

## Stop Conditions

Stop and report instead of continuing when:

- Michael does not explicitly approve the disruptive run;
- Michael does not explicitly approve broad TCC service reset;
- the command is not running in an interactive TTY;
- macOS prompts are ambiguous or cannot be completed;
- the script asks for a step not described in this card;
- user input becomes degraded and `./aos service stop --mode repo` is needed.

## Evidence To Preserve

The script prints an artifact directory. Preserve and report:

- artifact directory path;
- whether `--dry-run` passed;
- whether the first full run was attempted;
- whether it stopped at the broad-reset approval boundary or completed targeted reset;
- whether broad reset was run, and only after what explicit Michael approval;
- final `./aos service status --mode repo --json` summary.

## Completion Report

Report back to Foreman with:

- exact commands run and pass/fail/skip result;
- Michael approvals requested and received;
- artifact path;
- final repo daemon status;
- any remaining blocker or follow-up implementation needed.

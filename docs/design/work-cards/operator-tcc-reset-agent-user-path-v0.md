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
- `the operator native subagent contract`
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

- the normal test attempts only the targeted repo-mode AOS TCC reset;
- macOS may prompt for fresh approvals;
- the script stops the repo daemon by default on exit;
- service-wide TCC reset can affect other apps and is emergency-only.

Ask Michael for explicit approval in the Operator session before continuing.

### 2. Run The First Full Path

Run the guarded test without emergency service-wide reset:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

Follow the script prompts exactly. If targeted reset fails and the script exits
with the emergency service-wide reset not requested message, treat that as valid
evidence that the normal path stopped before affecting other apps.

### 3. Emergency Service-Wide Reset Requires A Named Break-Glass Request

Do not run service-wide reset by default.

Only if Michael explicitly asks for break-glass emergency recovery after seeing
the targeted-reset result, run:

```bash
AOS_RUN_DISRUPTIVE_TCC_TEST=1 AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET=1 \
  bash tests/manual/tcc-reset-agent-user-path.sh
```

Follow the script prompts exactly. Do not improvise manual System Settings
remove/re-add steps outside the harness, and do not translate normal approval
into emergency approval.

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
- Michael does not explicitly ask for emergency service-wide TCC reset;
- the command is not running in an interactive TTY;
- macOS prompts are ambiguous or cannot be completed;
- the script asks for a step not described in this card;
- user input becomes degraded and `./aos service stop --mode repo` is needed.

## Evidence To Preserve

The script prints an artifact directory. Preserve and report:

- artifact directory path;
- whether `--dry-run` passed;
- whether the first full run was attempted;
- whether it stopped before emergency service-wide reset or completed targeted reset;
- whether emergency service-wide reset was run, and only after what explicit Michael request;
- final `./aos service status --mode repo --json` summary.

## Completion Report

Report back to Foreman with:

- exact commands run and pass/fail/skip result;
- Michael approvals requested and received;
- artifact path;
- final repo daemon status;
- any remaining blocker or follow-up implementation needed.

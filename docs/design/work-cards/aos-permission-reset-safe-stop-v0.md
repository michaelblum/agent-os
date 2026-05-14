# AOS Permission Reset Safe Stop V0

## Tracker

- Related runtime readiness docs: `docs/api/aos.md`
- Related readiness implementation: `src/commands/operator.swift`
- Related build warning implementation: `src/commands/dev.swift`

## Goal

Prevent the operational regression where a human removes/re-adds macOS
Accessibility/Input Monitoring permissions while the repo-mode AOS daemon is
still running and owning or attempting to own input taps.

The current human handoff can say "remove/re-add permissions" without first
stopping the managed repo daemon. That is unsafe: when the permission row is
removed under a live daemon/input-tap owner, user input can become blocked or
severely degraded. The safe procedure must stop the repo daemon before asking
the human to touch macOS privacy settings.

This is a runtime operations correctness slice. Do not resume Surface Inspector
smoke, Employer Brand alignment, live capture, locator, report, export, or
workflow work in this slice.

## Incident Evidence

After Swift runtime work and `./aos dev build`, the user removed the repo-mode
`aos` privacy entry and input was blocked again. Foreman immediately ran:

```bash
./aos service stop --mode repo
```

and got:

```text
mode=repo installed=true running=false pid=none label=com.agent-os.aos.repo
```

That should have been the required precondition before instructing the human to
remove/re-add Accessibility or Input Monitoring grants.

## Required Behavior

### 1. Human Permission Reset Handoffs Must Stop Daemon First

Whenever `./aos ready`, `./aos ready --repair`, `./aos ready --post-permission`,
or `./aos permissions setup --once` reaches a human-required TCC remove/re-add
handoff, the printed instructions must tell the agent/human to stop the managed
daemon before removing permissions.

Required wording/content:

- identify the exact runtime mode and target binary path;
- print a first step equivalent to:
  `./aos service stop --mode repo`;
- state not to remove/re-add permissions until the service reports
  `running=false`;
- then instruct the human to remove/re-add `/Users/Michael/Code/agent-os/aos`
  in Accessibility and/or Input Monitoring;
- after the human returns, instruct the agent to run
  `./aos ready --post-permission`, not plain `./aos ready`.

Do not rely on session memory or Foreman remembering the safe sequence.

### 2. Provide A Single Safe Preparation Command Or Action

Add one explicit, discoverable safe-prep path for this situation.

Acceptable implementation shapes:

- a command such as `./aos permissions prepare-reset --mode repo`;
- a `next_actions` command emitted by readiness, such as
  `./aos service stop --mode repo`;
- an extension to `./aos ready --repair` that stops the daemon before producing
  human-required remove/re-add instructions.

Minimum requirement: a user/agent reading the readiness output must have an
unambiguous command to run before opening macOS settings.

### 3. Do Not Leave Daemon Running In Human-Required Reset State

If readiness concludes that stale/missing daemon-owned Accessibility/Input
Monitoring grants require a human remove/re-add:

- either stop the daemon as part of the repair/handoff path, or print a blocking
  next action that must be run before permission removal;
- do not present the Settings removal step as safe while the daemon is still
  running;
- if automatic stop is attempted and fails, report that blocker plainly and do
  not tell the human to remove permissions yet.

Choose the safer behavior conservatively. If automatic stop in readiness is too
surprising, make the printed `service stop` step mandatory and explicit.

### 4. Build Warning Must Be Actionable

`./aos dev build` currently warns that rebuilt repo binaries may require a fresh
grant. Tighten that warning so it includes the safe reset sequence:

1. `./aos service stop --mode repo`;
2. remove/re-add `/Users/Michael/Code/agent-os/aos` in Accessibility/Input
   Monitoring if readiness reports stale TCC/input tap;
3. return and run `./aos ready --post-permission`.

The warning should not imply that permission removal is safe while the daemon is
running.

### 5. Tests And Docs

Update tests/docs so this cannot regress:

- readiness/human-required plain text includes the service-stop-before-remove
  instruction;
- structured `next_actions` includes a safe stop/prep action before any
  `open_settings` action when permissions require remove/re-add;
- `docs/api/aos.md`, `src/CLAUDE.md`, and repo agent guidance if needed reflect
  `ready --post-permission` after human reset;
- `./aos dev build` warning includes the safe stop first step.

Prefer existing readiness tests such as `tests/input-tap-readiness.sh` or nearby
fixtures. Add a focused regression if needed.

## Suggested Implementation Areas

Inspect before editing:

- `src/commands/operator.swift`
  - `readyCommand`;
  - `printReadyHumanHandoff`;
  - `permissionFixLines`;
  - readiness `next_actions` construction;
- `src/commands/dev.swift`
  - build permission warning;
- `docs/api/aos.md`;
- `src/CLAUDE.md`;
- `tests/input-tap-readiness.sh`;
- `tests/ready-ownership-mismatch.sh`;
- any tests covering `ready --repair` / `ready --post-permission` output.

## Verification

Run focused tests:

```bash
bash tests/input-tap-readiness.sh
bash tests/ready-ownership-mismatch.sh
node --test tests/toolkit/canvas-inspector.test.mjs
bash tests/help-contract.sh
git diff --check
```

If Swift files change, run:

```bash
./aos dev build
```

Completion report must explicitly say that a runtime rebuild occurred and that
Operator/Foreman should use the safe sequence:

```bash
./aos service stop --mode repo
# human removes/re-adds /Users/Michael/Code/agent-os/aos in Accessibility/Input Monitoring
./aos ready --post-permission
```

Do not ask Operator to run live AOS smoke until the human has completed the
safe post-build permission reset.

## Non-Goals

- no Surface Inspector feature work;
- no Employer Brand alignment/capture/report work;
- no macOS Settings automation;
- no repeated repair loop;
- no broad daemon/service manager rewrite;
- no attempt to bypass macOS privacy prompts.

# AOS Agent Workspace Native Live Proof V0

## Recipient

Operator supervised live/HITL evidence collection.

## Transfer Kind

Operator run.

## Branch / Base

- branch_from: `goal/aos-agent-workspace-handles`
- required_start_ref: PR #451 head for
  `AOS Agent Workspace V0: saved captures, scoped refs, validated saved-ref
  actions`
- expected output: evidence report only, unless Foreman explicitly opens a
  follow-up implementation slice

Work in the single local checkout at `/Users/Michael/Code/agent-os`. Do not
create linked git worktrees.

## Fresh Context Contract

Start from a fresh context window. Do not assume branch, daemon, TCC,
Accessibility, focused app, Space, cursor, or prior proof state. Rediscover the
repo and runtime before acting.

## Goal

Collect the approval-gated live evidence for native AX saved refs in the AOS
agent workspace contract. The proof must show whether a stable native saved ref
can dispatch through direct AX current matching while preserving explicit
uncertainty about no-foreground, focus, cursor, Space, fallback, and native
known-limit behavior.

This work card exists because deterministic contract tests prove the saved-ref
wrapper shape, but they do not prove live no-foreground/focus/cursor/Space
behavior.

## Read First

- `AGENTS.md`
- `docs/AGENTS.md`
- `scripts/AGENTS.md`
- `scripts/lib/agent-workspace/AGENTS.md`
- `src/AGENTS.md`
- `tests/AGENTS.md`
- `docs/api/aos.md`
- `shared/schemas/aos-agent-workspace-v0.md`
- `shared/schemas/aos-agent-workspace-v0.schema.json`
- `skills/aos-agent-workspace/SKILL.md`
- `tests/agent-workspace-native-refs.sh`

## Rediscover State

Run before any live action:

```bash
git status --short --branch
git rev-parse HEAD
gh pr view 451 --json number,title,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup,url
./aos service status --mode repo --json
./aos permissions check --json
```

`./aos service status --mode repo --json` and
`./aos permissions check --json` are passive readback. Do not treat
`running:true` or `status: ok` as permission to run live proof.

## Approval Gate

Do not run the live proof until Michael explicitly approves all of these for
this round:

- native repo-mode artifact rebuild;
- repo service start or restart;
- HITL live smoke;
- TCC/manual runtime prompts or permission repair if the environment requests
  them;
- foreground fallback observation if the native primitive reports it.

Without that approval, stop and report `human_needed_native_live_proof`.

## Live Proof Plan

After approval, use supported AOS surfaces only:

```bash
./aos dev build --no-restart --json
./aos service start --mode repo --json
./aos ready --json
```

The native build changes the permissioned repo-mode binary identity used for
this proof. Treat any rebuild as making earlier TCC/readiness evidence stale:
after the build, perform the approved repo-mode TCC reset or repair flow if the
environment requests it, then use `./aos ready --post-permission` as the return
check before running saved-ref live actions.

If the service is already running and Foreman asked for a restart-specific
proof, use `./aos service restart --mode repo --json` instead of `start`.
Record which command was used.

Choose a visible same-Space native UI control with:

- a current app PID;
- a current window id;
- an actual AX identifier, not only a path;
- `enabled: true`;
- captured native action names that map to `press`, `focus`, or `set-value`;
- `permission_state: granted`;
- a captured focus/cursor/Space baseline.

Save perception and inspect refs:

```bash
./aos see capture main --save --mode ax --workspace native-live-proof --name before
./aos see refs --workspace native-live-proof --snapshot before --json
```

`./aos see capture --save` already emits JSON and rejects a separate `--json`
flag.

Select only a ref whose compact readback reports:

- `backend: native_ax`
- `resolution_class: stable`
- `conformance.actionability: direct_ax_saved_ref_mutation`
- `conformance.target_uncertainty.status: requires_direct_ax_current_matching`

If no such ref exists, do not force coordinates or path-only evidence. Stop with
`blocked_missing_native_identity` and include the missing identity facts from
the ref conformance payload.

Run dry-run first, then dispatch only the exact dry-run command without
`--dry-run` when dry-run reports `direct_ax_ready`:

```bash
./aos do press ref:before:<ref-id> --workspace native-live-proof --dry-run
./aos do press ref:before:<ref-id> --workspace native-live-proof
```

Use `focus` or `set-value` instead of `press` only when the selected native ref
declares that action in `supported_actions`.

Immediately refresh perception:

```bash
./aos see capture main --save --mode ax --workspace native-live-proof --name after
./aos see refs --workspace native-live-proof --snapshot after --json
```

## Evidence Required

The report must include:

- pre-action and post-action service status;
- permission status;
- selected ref compact readback;
- dry-run envelope;
- dispatch envelope;
- post-action recommended capture command;
- before/after capture paths;
- focus, cursor, and Space baseline fields before and after;
- whether `fallback_used` or `foreground_fallback_required` appeared anywhere
  in the underlying native result;
- whether the result still reports `no_foreground.claim: not_claimed`;
- any native known-limit blocker such as off-Space, minimized window, custom
  control, canvas/game surface, or focus mismatch.

## Stop Conditions

Stop and report without retry loops if:

- repo service cannot be started or readied after the approved command;
- permissions or TCC prompts require human action;
- no stable native AX saved ref exists;
- dry-run does not report `direct_ax_ready`;
- dispatch reports `AX_TARGET_NOT_FOUND`, ambiguity, disabled state, foreground
  fallback, or any native known-limit blocker;
- proving focus/cursor/Space preservation requires lower-level APIs outside the
  supported AOS command surface.

## Non-Goals

- Do not mutate GitHub.
- Do not change source files during the live proof.
- Do not use coordinate fallback refs as mutation targets.
- Do not use raw daemon HTTP, direct sockets, tmux, launchctl, or ad hoc AppKit
  scripts unless Foreman explicitly opens a separate diagnostic slice.
- Do not upgrade schema/docs/proof status from
  `approval_gated_live_proof_not_run` unless a separate implementation slice is
  opened after reviewing the evidence.

## Verification

Before live approval, only validate the work card itself:

```bash
git diff --check
rg -n "AOS Agent Workspace Native Live Proof|human_needed_native_live_proof|blocked_missing_native_identity|direct_ax_ready|approval_gated_live_proof_not_run" docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md
```

After live approval, also rerun the deterministic contract ladder:

```bash
bash tests/agent-workspace-native-refs.sh
bash tests/agent-workspace-saved-ref.sh
bash tests/agent-workspace-contract-drift.sh
bash tests/help-contract.sh
```

## Completion Report

Report:

- exact branch, HEAD, PR #451 head OID, and dirty state;
- whether explicit approval was present;
- every live command run;
- every output artifact path;
- native ref actionability and uncertainty status before action;
- dry-run and dispatch status;
- fallback/no-foreground/focus/cursor/Space evidence;
- whether native live proof passed, failed, or remains blocked;
- confirmation that no GitHub mutation or source edit happened during live
  proof.

## Live Run Result 2026-07-02

- approval: Michael reset TCC for `aos` in Accessibility, Input Monitoring,
  and Screen & System Audio Recording, then approved post-reset readiness and
  native live proof.
- branch/head: `goal/aos-agent-workspace-handles` at
  `c19ad0877b993d55a4798b4dbe9f1861b1aafc1e`.
- workspace: `native-live-proof-20260702T194926Z`.
- readiness: `./aos ready --post-permission --json` reported `ready: true`
  from the daemon; permissions readback reported accessibility, screen
  recording, listen access, and post access all `true`.
- artifact-storage finding: the first native saved capture exposed a bug where
  non-browser `ax` saved captures could leave `./screenshot.png` outside the
  workspace. The implementation and storage regression test were fixed before
  accepting live evidence; no native Swift source was changed after the
  post-reset TCC flow.
- saved capture proof: `before-main-fixed`, `before-user-active`,
  `after-failed-set-value`, `calculator-before`, `calculator-after-one`, and
  `calculator-after-clear` all stored capture images under
  `~/.config/aos/repo/agent-workspaces/native-live-proof-20260702T194926Z/`.
- successful saved-ref action: Calculator `ref:calculator-before:r486`
  (`AXButton 1`) dry-ran with `resolution_status: direct_ax_ready`, dispatched
  successfully with `fallback_used: false`, and a fresh capture
  `calculator-after-one` showed the Calculator display value changed to `1`.
- stale/fail-closed proof: after Calculator was quit, replaying
  `ref:calculator-before:r486` failed closed with `ELEMENT_NOT_FOUND` and a
  fresh-capture recommendation.
- restore proof: Calculator `ref:calculator-after-one:r476` (`AXButton Clear`)
  dispatched successfully with `fallback_used: false`, and
  `calculator-after-clear` showed the display value restored to `0`; Calculator
  was then quit.
- no-foreground status: the live native primitive reported direct AX execution
  with `fallback_used: false`, but the contract remains
  `no_foreground.claim: not_claimed`; focus, cursor, and Space preservation are
  still reported as unverified by the wrapper contract.
- final validation: `git diff --check`, agent-workspace contract/storage/browser
  refs/canvas refs/native refs/cleanup/saved-ref/help tests, full schema tests,
  external parser/dispatch tests, dev workflow router, and standalone dev-help
  parity/profile tests passed after the live run.

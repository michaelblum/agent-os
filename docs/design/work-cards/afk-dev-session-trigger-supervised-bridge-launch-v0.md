# Work Card: AFK Dev Session Trigger Supervised Bridge Launch V0

**Status:** Accepted 2026-05-22

## Foreman Acceptance

Accepted final branch head:
`d885742b61dc95cccde9d40a416e5a8f46ea2fa4`
(`fix(afk): launch supervised Codex provider command`).

The first Implementer output at
`f501072779344a22222f45cf49e94cbed5dbe7aa` added the supervised bridge launch
plumbing, but Foreman rejected that output because the no-fixture guarded path
still selected the harmless no-provider marker command. The accepted final head
includes the follow-up correction from
`docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-provider-command-correction-v0.md`.

Accepted behavior:

- preserves the accepted dry-run receipt path and guarded live pre-launch
  checks;
- keeps provider launch unavailable unless
  `--supervised-live-launch`, `--i-am-present`, `--json`,
  `--provider codex`, and `--dock implementer` all pass;
- performs duplicate suppression before bridge/provider launch;
- keeps fixture-backed deterministic tests provider-free;
- adds an internal supervised-provider launch mode for the accepted trigger path
  so the no-fixture live branch selects `codex --no-alt-screen` from
  `the implementer native subagent` instead of the harmless no-provider marker command;
- keeps no-provider marker behavior available for launch-attempt diagnostics;
- reports unobserved provider acceptance as non-completed;
- keeps cleanup proof required before `completed`.

Foreman verification:

```text
git status --short --branch
## implementer/afk-dev-session-trigger-supervised-bridge-launch-v0

./aos ready
ready=true mode=repo daemon=reachable tap=active

node --test tests/afk-session-trigger-prototype.test.mjs
12 tests passed

node --test tests/afk-launch-attempt-prototype.test.mjs
22 tests passed

bash tests/dev-workflow-router.sh
all checks passed

bash tests/help-contract.sh
all checks passed

./aos dev build --no-restart
passed; ./aos was up to date

git diff --check
passed

./aos ready
ready=true mode=repo daemon=reachable tap=active
```

Foreman targeted smoke of the no-fixture guarded path used the internal
provider-launch dry-run hook to avoid starting Codex while proving the command
shape:

```json
{
  "exit": 1,
  "status": "provider_acceptance_unobserved",
  "provider_launch_allowed": true,
  "terminal_command": "codex --no-alt-screen",
  "provider_acceptance_status": "provider_acceptance_unobserved",
  "terminal_status": "observed",
  "mismatch_classes": [
    "provider_acceptance_unobserved"
  ]
}
```

No live Codex, Claude, Gemini, tmux, provider terminal, or real bridge session
was launched during Foreman acceptance. No real `~/.codex` transcript bodies,
provider configs, provider session files, provider transcripts, provider
catalogs, telemetry stores, gateway state, dock profiles/hooks, GitHub state,
pushes, PRs, or external publication were mutated.

Next routed step:
`docs/design/work-cards/operator-afk-dev-session-trigger-supervised-bridge-live-v0.md`.

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: make the accepted guarded
  `./aos dev afk-session-trigger --supervised-live-launch --i-am-present
  --json` path actually drive the supervised local bridge/provider launch
  substrate for Codex/Implementer, while preserving the accepted guard and receipt
  boundaries.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
  - `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
  - `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- Branch/base:
  - `branch_from: docs/durable-agent-cognition-v0`
  - `required_start_ref: docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `implementer/afk-dev-session-trigger-supervised-bridge-launch-v0`. Keep the
  checkpoint local; do not push, open a PR, mutate GitHub, or publish
  externally.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, transcript/catalog state, or final launch
implementation shape. Read and rediscover before editing.

## Goal

Turn the accepted guarded live trigger from a launch-intent receipt into the
first actual supervised launch path:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json
```

When all pre-launch guards pass, the command should start the supervised local
bridge/provider launch substrate for Codex from `the implementer native subagent`, observe terminal
substrate/provider acceptance or explicit timeout, and prove cleanup before it
reports terminal success. Implementer must implement and verify deterministically, but
must not run a live Codex session; Foreman will route Operator live evidence
after this source slice is reviewed.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
- `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `scripts/afk-session-trigger-prototype.mjs` owns the accepted guard,
  duplicate handling, cleanup classification, and trigger receipt sections.
- `scripts/afk-launch-attempt-prototype.mjs` owns the existing bridge substrate
  observation path, live/fixture bridge visibility shape, Codex adapter
  correlation, and launch-attempt receipt vocabulary. It currently does not
  export helpers, so inspect before deciding whether to refactor shared helpers
  or reuse lower-level code another way.
- `src/commands/dev.swift` owns wrapper parsing and script delegation.
- `src/shared/command-registry-data.swift`, `tests/dev-workflow-router.sh`, and
  `tests/help-contract.sh` own command discovery/help drift.

## Required Behavior

- Preserve all accepted guarded trigger behavior from
  `afk-dev-session-trigger-guarded-live-codex-launch-v0.md`.
- Keep provider launch disallowed unless `--supervised-live-launch`,
  `--i-am-present`, `--json`, `--provider codex`, and `--dock implementer` all pass.
- Before starting any bridge/provider process, write or emit the pre-launch
  receipt and perform duplicate suppression for the accepted live states.
- Start only Codex from `the implementer native subagent` through the supervised local bridge or a
  lower-level helper with equivalent bridge health, session handle, PTY/input,
  provider acceptance, and cleanup evidence.
- Preserve separate receipt ownership for scheduler, dispatch, terminal
  substrate, provider acceptance, Codex adapter, catalog, telemetry, result
  route, work receipt, evidence, and mismatches.
- Do not collapse this command into an opaque shell-out to
  `./aos dev afk-launch-attempt` if doing so hides scheduler gates,
  duplicate-prevention facts, human-supervision flags, or cleanup proof.
- If provider acceptance is not observed before the bounded timeout, return
  `provider_acceptance_unobserved` or equivalent without reporting completed.
- If cleanup cannot be proven, return `cleanup_unverified` without reporting
  completed.
- Keep result route and work receipt delivery as `not_attempted` in this
  launch-only slice.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this Implementer round.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not delete or clean real Codex sessions/transcripts.
- Do not add final `aos session ...` spelling, unattended scheduling, gateway
  result-route delivery, schema promotion, or multi-provider live parity.

## Suggested Implementation Areas

- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

Prefer a minimal helper extraction when it avoids duplicating the existing
bridge/cleanup/correlation logic. Keep public CLI additions narrow and
experimental.

## Verification

Required deterministic checks:

```bash
node --test tests/afk-session-trigger-prototype.test.mjs
```

Run if launch-attempt helpers change:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
```

Run after Swift/help registry changes:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Add or update tests proving:

- no bridge/provider process starts unless all accepted guards pass;
- same-key duplicate states still suppress launch before bridge start;
- unsupported providers and wrong docks remain unavailable/no-launch;
- fixture-backed bridge/provider acceptance updates terminal/provider receipt
  sections without reading real transcripts;
- provider-acceptance timeout returns non-completed state;
- cleanup failure remains `cleanup_unverified`;
- cleanup success is required before completed/terminal success.

Finish with:

```bash
git diff --check
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh
```

Do not run live Codex in this Implementer round. If deterministic verification passes,
report the exact Operator command/scenario Foreman should route for supervised
live evidence.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- actual bridge/provider launch cannot be initiated without violating the
  pre-launch receipt or duplicate-suppression boundary;
- cleanup proof cannot be represented without mutating provider-owned files;
- real transcript body reads become necessary;
- final command spelling, unattended behavior, gateway delivery, or
  multi-provider support becomes necessary to proceed.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this slice;
- exact bridge/provider launch behavior implemented;
- guard, duplicate, provider-acceptance, and cleanup behavior;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact manual-intervention blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened;
- whether the source branch is ready for Operator supervised live Codex
  evidence, including the proposed bounded command/scenario.

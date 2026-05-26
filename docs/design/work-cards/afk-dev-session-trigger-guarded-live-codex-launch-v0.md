# Work Card: AFK Dev Session Trigger Guarded Live Codex Launch V0

**Status:** Accepted 2026-05-22

## Foreman Acceptance

Accepted implementation commits:

- `9cf94336362a3e80f453462ad62b689ca0b015f5`
  (`feat(afk): guard supervised live session trigger`)
- `c6b05896375ebf1e944e0ba18ad8a1ca336c1e4d`
  (`fix(afk): guard duplicate live trigger cleanup`)

Accepted behavior:

- preserves the accepted `--dry-run` receipt path;
- adds experimental supervised live launch intent under
  `./aos dev afk-session-trigger --supervised-live-launch --i-am-present
  --json`;
- limits the guarded live path to Codex/GDI before any launch can be allowed;
- rejects missing human presence, missing JSON output, unsupported provider,
  wrong dock, ambiguous launch aliases, and conflicting action flags before
  side effects;
- suppresses same-key duplicate launch for accepted/live states including
  `accepted`, `accepted_pre_launch`, `terminal`, `terminal_started`, `running`,
  `observed`, `provider_acceptance_unobserved`,
  `provider_acceptance_observed`, `provider_session_observed`, and
  `completed`;
- keeps rejected/failed/expired/blocked attempts blocked until explicit
  replacement/supersession;
- adds explicit cleanup ownership and a deterministic `cleanup_unverified`
  classification path;
- keeps result route, work receipt, provider acceptance, Codex adapter, catalog,
  and telemetry as not attempted in the deterministic launch-intent source
  slice.

Foreman verification:

```text
./aos ready --post-permission
ready=true mode=repo daemon=reachable tap=active

node --test tests/afk-session-trigger-prototype.test.mjs
10 tests passed

node --test tests/afk-launch-attempt-prototype.test.mjs
22 tests passed

bash tests/dev-workflow-router.sh
all checks passed

bash tests/help-contract.sh
all checks passed

./aos dev build --no-restart
passed; ./aos was up to date

git diff --check 7ac982d181391cac8066d4074ba2d62e18249286..HEAD
passed

./aos ready
ready=true mode=repo daemon=reachable tap=active
```

Foreman also reran targeted smokes for the prior acceptance blockers:

- same-key `provider_acceptance_unobserved` existing receipt returns
  `status=duplicate` and `dispatch.provider_launch_allowed=false`;
- same-key `terminal_started` existing receipt returns `status=duplicate` and
  `dispatch.provider_launch_allowed=false`;
- deterministic cleanup failure returns `status=cleanup_unverified` and
  `dispatch.provider_launch_allowed=false`.

No live Codex, Claude, Gemini, tmux, provider terminal, or real bridge session
was launched during acceptance. No real `~/.codex` transcript bodies, provider
configs, provider session files, provider transcripts, provider catalogs,
telemetry stores, gateway state, dock profiles/hooks, GitHub state, pushes, PRs,
or external publication were mutated.

Next routed step:
`docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-launch-v0.md`.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add the deterministic source behavior for a guarded,
  supervised-live Codex-only launch mode under experimental
  `./aos dev afk-session-trigger`, without running a live provider session.
- Source artifact:
  `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- Branch/base:
  - `branch_from: docs/durable-agent-cognition-v0`
  - `required_start_ref: docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-dev-session-trigger-guarded-live-codex-launch-v0`. Keep the
  checkpoint local; do not push, open a PR, mutate GitHub, or publish
  externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Accepted readiness note:
  `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- Accepted dry-run command:
  `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
- Accepted launch-attempt live wrapper proof:
  `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, transcript/catalog state, or launch-mode
spelling. Read and rediscover before editing.

## Goal

Make the experimental developer command capable of one guarded live launch
intent:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json
```

This slice should implement the source behavior and deterministic verification
for the guard, receipt shape, duplicate prevention, unsupported-provider
classification, and cleanup classification. Do not perform the live Codex run in
GDI; Foreman will route a separate Operator run for supervised live evidence
after reviewing this source slice.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
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
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `scripts/afk-session-trigger-prototype.mjs` owns the dry-run receipt builder,
  packet/current-state validation, dock/provider selection, and scheduler
  idempotence material.
- `scripts/afk-launch-attempt-prototype.mjs` owns the current launch-attempt
  record, terminal-substrate observation helper, duplicate registry,
  provider-acceptance classification, Codex adapter correlation, and cleanup
  evidence shape.
- `src/commands/dev.swift` owns the `./aos dev afk-session-trigger` wrapper,
  CLI option parsing, required-flag enforcement, and script delegation.
- `src/shared/command-registry-data.swift`, `tests/dev-workflow-router.sh`, and
  `tests/help-contract.sh` own command discovery/help contract drift checks.
- `tests/afk-session-trigger-prototype.test.mjs` and
  `tests/afk-launch-attempt-prototype.test.mjs` own focused prototype coverage.

## Required Behavior

### Mode Selection And Guard

- Preserve the accepted `--dry-run` path and its existing receipt behavior.
- Add `--supervised-live-launch` as the only live action flag for this command.
- Require `--i-am-present` in the same invocation before any live launch path is
  allowed.
- Require `--json` for the first supervised-live source behavior.
- Reject combining `--dry-run` and `--supervised-live-launch`.
- Keep ambiguous aliases such as `--start`, `--live`, `--launch-provider`,
  `--unattended`, and `--background` unsupported.
- If any pre-launch gate fails, emit a rejected or blocked receipt and do not
  start a bridge, terminal, tmux, provider process, gateway job, result route,
  or transcript/catalog read.

### Provider And Dock Scope

- Allow live launch behavior only for `--provider codex --dock gdi` with
  `.docks/gdi` resolved as launch root.
- For Claude, Gemini, or other providers, return
  `provider_unsupported_for_supervised_live` or an equivalent unavailable
  provider receipt without launching anything.
- If dock is not `gdi`, reject before launch with a named mismatch and no side
  effects.

### Duplicate Prevention And Idempotence

- Compute the live idempotence key before launch using the dry-run packet facts
  plus live action, selected provider/dock, launch root, required start ref,
  result route refs, and human gate status.
- Do not include provider session id, transcript path, catalog source file,
  telemetry ref, or terminal snapshot in the pre-launch key.
- If a duplicate in-process or receipt-backed attempt is already terminal,
  running, observed, or completed, return the existing/duplicate state and do
  not start another provider.
- If a prior attempt is rejected, failed, expired, or blocked, require a fresh
  scheduler run, dispatch attempt, or explicit replacement/supersession field
  before relaunch.
- If a pre-launch receipt cannot be written, return `receipt_write_failed` and
  do not launch.

### Receipt Shape

- Emit `record_type: "aos.afk_session_trigger_supervised_live"` for the live
  path with `schema_status: "not_a_schema"`.
- Preserve separate receipt sections for packet/current state, scheduler,
  dispatch, terminal substrate, provider acceptance, Codex adapter correlation,
  catalog, telemetry, result route, work receipt, evidence, and mismatches.
- Keep result route and work receipt delivery as `not_attempted` in this
  launch-only source slice.
- Keep provider-owned transcript/catalog refs read-only and bounded. Do not
  copy full transcript bodies into the trigger receipt.

### Terminal, Provider, And Cleanup Classification

- Reuse lower-level helpers from `afk-launch-attempt` where practical, but do
  not shell out to `./aos dev afk-launch-attempt` as an opaque subcommand if
  that hides scheduler gate decisions, duplicate prevention, human-supervision
  flags, or cleanup proof.
- A terminal success receipt must include cleanup proof. If cleanup cannot be
  proven, report `cleanup_unverified` and do not classify the attempt as
  completed.
- Deterministic tests may use fixtures or no-provider substrates. They must not
  launch live Codex.

## Scope

- Source behavior and tests for the experimental developer command.
- No schema promotion, final `aos session ...` command spelling, unattended
  scheduling, gateway result-route delivery, or multi-provider live parity.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this GDI round.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not delete or clean real Codex sessions/transcripts.
- Do not create a Researcher dock.
- Do not turn this into final command spelling or committed schema work.

## Suggested Implementation Areas

- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

Use the repo's existing prototype style first. Add shared helper modules only if
they clearly reduce duplication without expanding this slice.

## Verification

Required deterministic checks:

```bash
node --test tests/afk-session-trigger-prototype.test.mjs
```

Run if `scripts/afk-launch-attempt-prototype.mjs` or shared launch-attempt
helpers change:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
```

Run after Swift/help registry changes:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Run command-level smokes with temporary packets that prove:

- the accepted dry-run command still emits
  `aos.afk_session_trigger_dry_run`;
- supervised live without `--i-am-present` rejects without launch side effects;
- supervised live with unsupported provider returns unavailable-provider output
  without launch side effects;
- combining `--dry-run` and `--supervised-live-launch` rejects;
- deterministic fixture/no-provider cleanup failure is classified as
  `cleanup_unverified` or equivalent, not completed.

Finish with:

```bash
git diff --check
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh
```

Do not run the supervised live Codex launch in this GDI round. If the source
implementation and deterministic checks pass, report the exact Operator command
or scenario Foreman should route for live evidence.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- the command cannot preserve pre-launch duplicate prevention;
- the source path cannot write a pre-launch receipt before launch;
- the implementation would need to mutate provider-owned transcript/catalog
  files;
- cleanup proof cannot be represented without actual live evidence;
- final command spelling, unattended behavior, or multi-provider live launch
  becomes necessary to proceed.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this slice;
- behavior implemented, including exact live flags and rejection cases;
- dry-run compatibility result;
- duplicate/idempotence and cleanup classification behavior;
- provider/dock scope behavior;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or the exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened;
- whether the source branch is ready for a separate Operator supervised live
  Codex evidence run, and the proposed bounded scenario for that run;
- any remaining product/architecture decisions for Foreman or Michael.

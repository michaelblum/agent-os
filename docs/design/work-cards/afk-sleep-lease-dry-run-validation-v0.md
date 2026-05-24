# Work Card: AFK Sleep Lease Dry-Run Validation V0

**Status:** Accepted

## Acceptance Result

Accepted on `main` through merge commit
`eda618f6bd1f98659297cb1e3592d132ac89d7ed`, after the original GDI head
`d22bb3e7afef0bc1878d03424ea1649dba7551f8` was corrected by
`f6e02c3e15d8023456a5636499050fd4a2a45179`.

Foreman accepted the combined dry-run and correction work after verifying:

- sleep-lease dry-run validation emits accepted and rejected receipts;
- local stdout route shorthands remain accepted;
- unsupported external route objects such as
  `{ "kind": "gateway_notifier", "ref": "stdout" }` reject the sleep lease
  before launch;
- rejected route mismatch receipts keep `provider_launch_allowed=false`,
  terminal `not_attempted`, `result_route.status="unsupported"`, and
  `result_route_unsupported` evidence.

Acceptance gates passed:

- `node --test tests/afk-session-trigger-prototype.test.mjs`: 33/33 pass;
- `bash tests/dev-workflow-router.sh`: pass;
- `bash tests/help-contract.sh`: pass;
- `./aos dev build --no-restart`: pass, with pre-existing Swift warnings;
- `git diff --check`: pass;
- manual external route mismatch smoke: pass.

Post-build `./aos ready --post-permission` reported
`human_required` for the repo-mode TCC/input tap grant. Live-dependent follow-up
work is blocked until the permission reset path is completed.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add deterministic sleep-lease packet validation and
  accepted/rejected dry-run receipt output, with no provider launch or
  unattended behavior.
- Source artifacts:
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `docs/design/durable-agent-cognition-and-afk-primitives.md`
  - `docs/design/work-cards/afk-sleep-lease-safety-contract-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `src/commands/dev.swift`
  - `src/shared/command-registry-data.swift`
  - `tests/dev-workflow-router.sh`
  - `tests/help-contract.sh`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-sleep-lease-dry-run-validation-v0` from `origin/main`. Commit and
  push that GDI branch when verification passes. Do not open a PR, merge,
  mutate main, mutate GitHub issues/projects, start live providers, or route
  follow-up work.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, provider state, current CLI behavior, or prior sleep-lease note
details. Read and rediscover before editing.

## Foreman Review Finding

The accepted safety contract says the first source slice should validate a
sleep lease deterministically and emit accepted/rejected dry-run receipts before
any true overnight run. Current `afk-session-trigger` live behavior correctly
requires `--supervised-live-launch --i-am-present`; do not weaken that.

## Goal

Add a sleep-lease dry-run validation envelope to the experimental AFK session
trigger prototype.

Use this option shape unless source reading proves a narrower local convention:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --sleep-lease <lease.json> \
  --dry-run \
  --json
```

The command should validate the lease, validate that the selected packet/work
item is allowed by the lease, and emit a reviewable dry-run receipt. It must not
launch providers, drive terminals, create branches, push, route async results,
or write generated receipt artifacts unless `--out` is already being used by
the existing dry-run path.

## Suggested Lease Shape

Use a plain local JSON object. This is not a schema yet:

```json
{
  "lease_id": "sleep-lease-example",
  "authorized_by": "local-human",
  "authorized_at": "2026-05-24T08:30:00.000Z",
  "expires_at": "2026-05-24T12:30:00.000Z",
  "max_wall_clock_minutes": 240,
  "max_provider_launches": 0,
  "provider_budget": {
    "status": "not_enforceable_yet",
    "declared_ceiling": "0 live launches in dry-run"
  },
  "allowed_docks": ["gdi"],
  "allowed_providers": ["codex"],
  "allowed_work_refs": [
    "docs/design/work-cards/example-v0.md"
  ],
  "allowed_branch_policy": {
    "create_branch": true,
    "branch_prefix": "gdi/",
    "allow_main_mutation": false
  },
  "allow_branch_push": false,
  "external_publication_policy": "none",
  "result_route": "stdout",
  "stop_conditions": [
    "human_judgment_needed",
    "provider_auth_prompt",
    "token_budget_reached",
    "cleanup_unverified"
  ]
}
```

Prefer validation that is strict enough to prevent ambiguous overnight work, but
avoid promoting a durable JSON schema in this slice.

## Required Behavior

1. CLI/source behavior:

   - Add a deterministic `--sleep-lease <path>` option to the prototype and the
     `./aos dev afk-session-trigger` wrapper if the wrapper does not already
     pass arbitrary options correctly.
   - Support `--sleep-lease` only with `--dry-run --json` in this slice.
   - Reject `--sleep-lease` combined with `--supervised-live-launch`,
     `--warm-dock-tui-reuse`, `--provider-launch-dry-run`, or missing `--json`.
   - Do not add or accept `--unattended`, `--background`, or any live sleep
     alias.

2. Lease validation:

   - Validate required fields from the accepted safety note:
     `lease_id`, `authorized_by`, `authorized_at`, `expires_at`,
     `max_wall_clock_minutes`, `max_provider_launches`, `allowed_docks`,
     `allowed_providers`, `allowed_work_refs`, `allowed_branch_policy`,
     `allow_branch_push`, `external_publication_policy`, `result_route`, and
     `stop_conditions`.
   - Reject expired leases using the command timestamp as the comparison time.
   - Reject relative-only expiry.
   - Reject negative or missing duration and provider-launch counts.
   - Reject broad or empty `allowed_work_refs`.
   - Reject `allow_main_mutation=true`.
   - Reject `external_publication_policy` other than `none` for V0.
   - Treat provider budget enforcement as informational if
     `provider_budget.status="not_enforceable_yet"`, but record it in the
     receipt.

3. Packet/work compatibility:

   - Ensure the selected packet source artifact or packet id is present in
     `allowed_work_refs`.
   - Ensure selected dock/provider are allowed by the lease.
   - Ensure the packet/result route is compatible with the lease result route.
   - Preserve existing packet/current-state validation and mismatch reporting.

4. Receipt output:

   - Preserve the existing dry-run receipt shape where practical.
   - Add a `sleep_lease` section with:
     - `status`: `accepted`, `rejected`, `expired`, or `not_applicable`;
     - `lease_ref`;
     - `lease_id`;
     - authorization and expiry fields;
     - provider launch and budget fields;
     - allowed docks/providers/work refs;
     - branch policy;
     - result route;
     - stop conditions;
     - mismatch list or diagnostics.
   - Scheduler `lease` should no longer be the string `not_enforced` when a
     sleep lease is present. It should summarize the accepted/rejected lease
     state.
   - Rejected or expired sleep leases must produce
     `dispatch.provider_launch_allowed=false`.
   - Accepted sleep-lease dry runs still must not launch providers; the receipt
     should make that clear with dry-run action and no launch attempt.

5. Tests:

   Add or update focused deterministic tests covering:

   - accepted sleep lease dry-run receipt for one allowed work card;
   - expired sleep lease rejection;
   - provider/dock not allowed rejection;
   - selected work ref not allowed rejection;
   - external publication policy rejected;
   - `--sleep-lease` rejected with supervised live or warm reuse modes;
   - existing dry-run, supervised-live guard, warm-dock reuse, result-route, and
     duplicate behavior still passes.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/work-cards/afk-sleep-lease-safety-contract-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Hard Boundaries

- Do not start live providers, tmux sessions, terminal bridges, or Agent
  Terminal surfaces.
- Do not remove or relax `--i-am-present`.
- Do not add or enable unattended live launch behavior.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, or external notifier routes.
- Do not promote durable schemas.
- Do not create durable work/evidence records beyond existing `--out` dry-run
  output.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  follow-up work.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
git diff --check
```

If `scripts/afk-launch-attempt-prototype.mjs` or shared launch-attempt helpers
change unexpectedly, also run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact sleep-lease CLI option behavior;
- accepted lease receipt summary;
- rejected/expired lease receipt summaries;
- how packet/source artifact, dock/provider, branch policy, and result route
  compatibility are checked;
- confirmation that existing live human-present guard behavior remains intact;
- verification commands and pass/fail results;
- explicit statement that no source outside scope, schema, fixture, generated
  durable receipt, provider launch, transcript body read, provider
  store/catalog/telemetry mutation, gateway/dock runtime mutation, GitHub
  issue/PR/main mutation, external notifier, durable work/evidence record,
  unattended trigger, or follow-up routing occurred beyond the expected GDI
  branch push.

# Work Card: AFK Session Trigger Result Route Override Normalization V0

**Status:** Accepted 2026-05-23

## Result

- Foreman review: accepted.
- Branch/ref gates passed on
  `gdi/afk-session-trigger-result-route-override-normalization-v0` at
  `8265ffc8dfe48f58b1f761657a01c1c9de030ed4`, based on
  `21a4fdde8ad21dd4edb6d134b375b24bc2a735f5`.
- Diff was scoped to:
  - `scripts/afk-launch-attempt-prototype.mjs`;
  - `scripts/afk-session-trigger-prototype.mjs`;
  - `tests/afk-launch-attempt-prototype.test.mjs`;
  - `tests/afk-session-trigger-prototype.test.mjs`.
- Behavior accepted: string result-route entries and `--result-route <ref>`
  overrides normalize to `{ kind: "local_artifact_path", ref: <ref> }` before
  local delivery classification. Object-shaped unsupported/external routes stay
  explicit and non-completed.
- Verification rerun by Foreman passed:
  - `./aos ready` returned
    `ready=true mode=repo daemon=reachable tap=active`;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 20/20
    passing;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 38/38
    passing;
  - `git diff --check`.
- Follow-up routed: model the user's actual long-lived dock terminal workflow
  as warm TUI reuse with `/clear` as the context boundary before broader async
  route work.
- No live provider launch, transcript body read, provider store/catalog/telemetry
  mutation, gateway/dock runtime mutation, GitHub issue/PR/main mutation, main
  merge, PR creation, external notifier, durable work/evidence record,
  unsupervised trigger, or non-local async routing occurred during Foreman
  acceptance.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: normalize the existing `--result-route <ref>` CLI fallback
  into the same local `local_artifact_path` route shape used by packet routes,
  so string overrides like `stdout` are delivered instead of reported as
  unsupported.
- Source artifacts:
  - `docs/design/work-cards/afk-session-trigger-local-result-route-delivery-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Branch/Base:
  - `branch_from: gdi/afk-session-trigger-local-result-route-delivery-v0`
  - `required_start_ref: gdi/afk-session-trigger-local-result-route-delivery-v0`
  - Accepted local route source head:
    `319e46db15fe6973dd0ead5784e0bd3e1ff64ab7`
- Branch/output expectation: create or reuse
  `gdi/afk-session-trigger-result-route-override-normalization-v0` from the
  required start ref. Commit and push that GDI branch when verification passes
  under the active `agentic_relay` profile. Do not open a PR, merge, mutate
  main, mutate GitHub issues/projects, or broaden into external publication.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree,
readiness, daemon state, or prior implementation state. Read and rediscover
before editing.

## Foreman Review Finding

The accepted local result-route implementation handles object-shaped packet
routes correctly. It missed the existing command-surface fallback:

```bash
node scripts/afk-session-trigger-prototype.mjs \
  --packet <packet-without-result-route.json> \
  --provider codex \
  --dock gdi \
  --dry-run \
  --json \
  --result-route stdout
```

Foreman probe on `319e46db15fe6973dd0ead5784e0bd3e1ff64ab7` produced:

```json
{
  "status": "dry_run_ready",
  "result_route": {
    "status": "unsupported",
    "refs": ["stdout"],
    "attempt_refs": [
      {
        "kind": "not_observed",
        "ref": "not_observed"
      }
    ],
    "delivered_refs": [],
    "failure": [
      {
        "code": "result_route_unsupported"
      }
    ]
  }
}
```

That is not an external route. It is the command's existing shorthand for a
local route ref and should normalize to `kind=local_artifact_path`,
`ref=stdout`.

## Required Behavior

- When the packet omits `result_route` / `result_routes` and the user supplies
  `--result-route stdout`, the receipt records:
  - `result_route.status=completed`;
  - attempted and delivered refs with
    `{ "kind": "local_artifact_path", "ref": "stdout" }`;
  - no unsupported-route failure.
- When `--result-route <local-path>` is supplied together with matching
  `--out <local-path>`, the receipt records confirmed local artifact delivery
  after the output write.
- Preserve object-shaped route behavior from the accepted slice.
- Preserve truly unsupported/external route behavior for object routes such as
  `{ "kind": "gateway_notifier", "ref": "..." }`.
- Keep top-level receipt status and launch-attempt lifecycle separate from
  result-route delivery status.
- Apply the behavior consistently to both AFK prototypes where the option or
  route normalization exists.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-session-trigger-local-result-route-delivery-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Existing Code To Inspect

- `scripts/afk-session-trigger-prototype.mjs` - owns dry-run CLI parsing,
  result route normalization, stdout receipt output, and `--out` writes for the
  session-trigger prototype.
- `scripts/afk-launch-attempt-prototype.mjs` - owns launch-attempt receipt
  construction and any shared local route classification behavior that must stay
  consistent with session-trigger receipts.
- `tests/afk-session-trigger-prototype.test.mjs` - owns deterministic coverage
  for CLI route overrides, stdout receipts, `--out` writes, and unsupported
  object routes.
- `tests/afk-launch-attempt-prototype.test.mjs` - owns deterministic coverage
  for launch-attempt route accounting and lifecycle separation.

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-session-trigger-local-result-route-delivery-v0 319e46db15fe6973dd0ead5784e0bd3e1ff64ab7
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs
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

## Suggested Implementation Areas

- `scripts/afk-session-trigger-prototype.mjs`
  - likely fix: normalize string result-route overrides into
    `{ kind: "local_artifact_path", ref: <string> }` before classification.
- `scripts/afk-launch-attempt-prototype.mjs`
  - mirror the same normalization if launch-attempt result routes can receive
    string routes from packets or future wrappers.
- `tests/afk-session-trigger-prototype.test.mjs`
  - add `--result-route stdout` coverage where the packet omits routes.
  - add or adjust `--result-route <path>` plus `--out <path>` coverage if that
    path is supported.
- `tests/afk-launch-attempt-prototype.test.mjs`
  - preserve object-route coverage and add string-route normalization only if
    launch-attempt accepts string routes directly.

## Hard Boundaries

- Do not implement gateway/broker integration-job start/complete/fail routes.
- Do not implement Slack, Foreman inbox, GitHub issue/PR comment, or external
  notifier routes.
- Do not implement durable work records or evidence records.
- Do not implement unsupervised triggers.
- Do not run live Codex/provider launches.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not remove or relax `--i-am-present`.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact normalization behavior added;
- receipt examples for `--result-route stdout` and, if supported,
  `--result-route <path>` with `--out <path>`;
- proof unsupported object route behavior is preserved;
- remaining next slice recommendation after this local-route compatibility
  correction;
- explicit statement that no live provider launch, transcript body read,
  provider store/catalog/telemetry mutation, gateway/dock runtime mutation,
  GitHub issue/PR/main mutation, main merge, PR creation, external notifier,
  durable work/evidence record, unsupervised trigger, or non-local async routing
  occurred beyond the expected GDI branch push.

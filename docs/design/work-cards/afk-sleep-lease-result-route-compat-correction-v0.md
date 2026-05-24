# Work Card: AFK Sleep Lease Result Route Compat Correction V0

**Status:** Ready for GDI correction

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: fix sleep-lease result-route compatibility so unsupported
  or external result-route objects cannot produce an accepted sleep-lease dry
  run.
- Source artifacts:
  - `docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md`
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: origin/gdi/afk-sleep-lease-dry-run-validation-v0`
  - `required_start_ref: origin/gdi/afk-sleep-lease-dry-run-validation-v0`
  - rejected head under review:
    `d22bb3e7afef0bc1878d03424ea1649dba7551f8`
- Branch/output expectation: update the existing
  `gdi/afk-sleep-lease-dry-run-validation-v0` branch or create a correction
  branch from it. Commit and push when verification passes. Do not open a PR,
  merge, mutate main, mutate GitHub issues/projects, start live providers, or
  route follow-up work.

## Foreman Review Finding

Foreman did not accept
`gdi/afk-sleep-lease-dry-run-validation-v0` at
`d22bb3e7afef0bc1878d03424ea1649dba7551f8`.

The implementation correctly adds dry-run lease validation and keeps provider
launch disabled, but one compatibility gate is too loose:

```json
{
  "result_route": { "kind": "gateway_notifier", "ref": "stdout" }
}
```

with a lease containing:

```json
{
  "result_route": "stdout"
}
```

currently produces:

- `status="dry_run_ready"`;
- `scheduler.lease.status="accepted"`;
- `sleep_lease.status="accepted"`;
- `mismatches=[]`;
- but `result_route.status="unsupported"` with
  `failure[0].code="result_route_unsupported"`.

A sleep lease must not be accepted when its required local result route is not
actually deliverable by the existing route classifier. Matching only `ref` is
not enough; the compatible route must normalize to an accepted local route kind.

## Goal

Tighten sleep-lease result-route compatibility so the lease only accepts routes
that the AFK result-route classifier can treat as local and compatible.

## Required Behavior

- `lease.result_route="stdout"` is compatible with:
  - packet `result_route: "stdout"`;
  - packet `result_route: { "kind": "stdout" }`;
  - packet `result_route: { "ref": "stdout" }`;
  - packet `result_route: { "path": "stdout" }`;
  - packet `result_route: { "artifact_path": "stdout" }`;
  - packet `result_route: { "kind": "local_artifact_path", "ref": "stdout" }`.
- `lease.result_route="stdout"` is not compatible with unsupported or external
  object routes, even if they include `ref: "stdout"`, such as:

```json
{ "kind": "gateway_notifier", "ref": "stdout" }
```

- Rejected incompatible routes must produce:
  - top-level `status="rejected"`;
  - `scheduler.lease.status="rejected"`;
  - `sleep_lease.status="rejected"`;
  - `dispatch.provider_launch_allowed=false`;
  - a mismatch such as `sleep_lease_result_route_mismatch`;
  - no provider launch, no terminal drive, and no generated durable artifact.
- Preserve accepted stdout shorthand behavior added by
  `afk-session-trigger-stdout-route-object-normalization-v0`.
- Preserve unsupported/external route behavior for the existing
  `result_route` receipt section.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md`
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
- `docs/design/work-cards/afk-session-trigger-stdout-route-object-normalization-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/afk-sleep-lease-dry-run-validation-v0 d22bb3e7afef0bc1878d03424ea1649dba7551f8
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,docs/design/work-cards/afk-sleep-lease-dry-run-validation-v0.md,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md
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

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

If command/help files change unexpectedly, also run:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact route compatibility behavior after the fix;
- accepted stdout shorthand examples;
- rejected unsupported/external object example;
- verification commands and pass/fail results;
- explicit statement that no source outside scope, schema, fixture, generated
  durable receipt, provider launch, transcript body read, provider
  store/catalog/telemetry mutation, gateway/dock runtime mutation, GitHub
  issue/PR/main mutation, external notifier, durable work/evidence record,
  unattended trigger, or follow-up routing occurred beyond the expected GDI
  branch push.

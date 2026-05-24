# Work Card: Operator AFK Sleep Lease Awake Guarded Live Proof V0

**Status:** Ready for Operator

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one real Codex/GDI `./aos dev afk-session-trigger`
  proof using an explicit sleep lease with the human-present supervised-live
  path, then report whether provider acceptance and cleanup complete.
- Source artifacts:
  - `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`
  - `docs/design/work-cards/afk-sleep-lease-awake-guarded-live-v0.md`
  - `docs/design/work-cards/afk-sleep-lease-awake-guarded-live-provider-sentinel-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Required start ref: `origin/main` with this work card present.
- Output expectation: make no source, docs, config, provider config/session
  catalog, telemetry, gateway, dock profile, hook, GitHub, branch, PR, push,
  merge, external publication, or async result-routing changes. Return a
  Foreman chat report only.

Provider-owned Codex metadata may be created by the live run. Read only bounded
metadata needed for proof classification. Do not edit, delete, move, clean, or
paste full bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or prior
proof state. Read and rediscover before acting.

## Goal

Prove that the accepted source path can use an explicit local sleep lease for
one awake, human-present Codex/GDI supervised live launch:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --sleep-lease <temp-lease.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-afk-sleep-lease-awake-guarded-live-proof-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home-fixture`, or
`--provider-launch-dry-run`.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main ac4b9f3638898b241f863750bd9152855287cf63
./aos ready --post-permission
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

Stop if the worktree is dirty, if `HEAD` is not current `main`/`origin/main`
with this work card present, or if readiness is not:

```text
ready=true mode=repo daemon=reachable tap=active
```

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/operator/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports ready.

## Baseline Snapshot

Before the trigger run, capture bounded baseline state:

```bash
ps -axo pid=,ppid=,pgid=,command= | rg 'server.mjs|bridge-server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
```

Also record the newest five Codex rollout files by path, mtime, and size only.
Do not open or paste full transcript bodies.

## Packet And Lease

Create temporary packet, lease, and output paths outside the repo.

Packet fields:

- `packet_id`:
  `operator-afk-sleep-lease-awake-guarded-live-proof-v0`
- `source_artifact`:
  `docs/design/work-cards/afk-sleep-lease-awake-guarded-live-provider-sentinel-v0.md`
- `requested_recipient`: `gdi`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `origin/main`
- `provider_hint`: `codex`
- `result_route`: `{ "kind": "local_artifact_path", "ref": "stdout" }`
- `external_publication_policy`: `local-only`
- `goal`: `awake guarded sleep lease live proof`

Lease fields:

- `lease_id`: include
  `operator-afk-sleep-lease-awake-guarded-live-proof-v0` and a timestamp
- `authorized_by`: `local-human-awake`
- `authorized_at`: current ISO timestamp
- `expires_at`: no more than 20 minutes after `authorized_at`
- `max_wall_clock_minutes`: `20`
- `max_provider_launches`: `1`
- `provider_budget.status`: `not_enforceable_yet`
- `provider_budget.declared_ceiling`:
  `one Codex launch for awake guarded sleep-lease proof`
- `allowed_docks`: `["gdi"]`
- `allowed_providers`: `["codex"]`
- `allowed_work_refs`:
  `["docs/design/work-cards/afk-sleep-lease-awake-guarded-live-provider-sentinel-v0.md"]`
- `allowed_branch_policy.allow_main_mutation`: `false`
- `allow_branch_push`: `false`
- `external_publication_policy`: `none`
- `result_route`: `stdout`
- `stop_conditions`: include `human_judgment_needed`,
  `provider_auth_prompt`, `token_budget_reached`, `cleanup_unverified`,
  `lease_expired`, and `provider_timeout`

## Required Evidence

Passing evidence:

- command exit code `0`;
- top-level `status=completed`;
- `packet.validation_status=valid`;
- `scheduler.lifecycle_state=completed`;
- `scheduler.lease.status=accepted`;
- `sleep_lease.status=accepted`;
- `dispatch.provider_launch_allowed=true`;
- `dispatch.launch_root=.docks/gdi`;
- terminal substrate observed with driver, cwd, and command;
- input submission used `provider_prompt_mode=codex_goal` and prefix
  `"/goal "`;
- prompt ref/source artifact points to the provider sentinel work card;
- provider acceptance observed with a concrete provider session id;
- if metadata promotion closes acceptance, report the correlation status and
  matched thread id;
- cleanup status is `verified`;
- result route status is `completed`;
- `mismatches=[]`;
- bounded visible evidence, if available, includes the proof token
  `sleep-lease-awake-guarded-live-provider-sentinel-v0`.

If provider acceptance remains unobserved with verified cleanup, classify as
`provider_acceptance_unobserved`, not pass. If cleanup is not verified, classify
as `cleanup_unverified`. If the lease rejects before launch, classify the exact
sleep-lease mismatch.

## Cleanup

After the trigger exits:

- verify the proof-owned bridge/processes are gone or unreachable;
- compare process snapshot against the baseline and name any pre-existing
  long-lived Codex/Sigil/bridge processes separately;
- remove temporary packet, lease, and output files unless retaining the output
  path is necessary for the report;
- run `./aos ready --post-permission`;
- run `git status --short --branch`.

## Completion Report Required

Return:

- classification: pass, provider_acceptance_unobserved, cleanup_unverified,
  sleep_lease_rejected, human_needed, or failed;
- branch/head before and after, and whether it matched `origin/main`;
- readiness before and after;
- preflight results;
- temp packet/lease/output paths if retained, or state that they were removed;
- selected lease id and expiry window;
- exact receipt fields listed under Required Evidence;
- provider session id and bounded metadata source if observed;
- cleanup/process comparison result;
- whether the sentinel proof token was observed without transcript body reads;
- final git status;
- explicit statement that no source/docs/config/provider-store/GitHub/branch/
  PR/push/merge, external notifier, durable work/evidence record, unattended
  trigger, or non-local async routing mutation occurred.

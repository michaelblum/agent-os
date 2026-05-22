# Work Card: AFK Dev Session Trigger Guarded Live Duplicate/Cleanup Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the guarded live session-trigger source slice so it
  satisfies Foreman's duplicate-state and cleanup-classification acceptance
  findings.
- Source artifact:
  `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
- Reviewed output branch:
  `gdi/afk-dev-session-trigger-guarded-live-codex-launch-v0`
- Reviewed output head:
  `9cf94336362a3e80f453462ad62b689ca0b015f5`
- Reviewed base:
  `7ac982d181391cac8066d4074ba2d62e18249286`
- Branch/output expectation: continue on
  `gdi/afk-dev-session-trigger-guarded-live-codex-launch-v0` from this
  correction card commit. Keep the checkpoint local; do not push, open a PR,
  mutate GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, transcript/catalog state, or Foreman's review
details beyond this card. Read and rediscover before editing.

## Foreman Review Findings

### Finding 1: receipt-backed duplicate suppression misses accepted live states

The accepted readiness note requires the same idempotence key with
`terminal_started`, `provider_acceptance_unobserved`, `provider_session_observed`,
or `completed` to prevent a second provider launch. The current implementation
does not treat `provider_acceptance_unobserved` or `terminal_started` as
duplicate states.

Evidence:

- `scripts/afk-session-trigger-prototype.mjs:14` defines
  `LIVE_TERMINAL_STATES` as
  `terminal`, `running`, `observed`, `completed`, and
  `provider_session_observed`;
- `scripts/afk-session-trigger-prototype.mjs:471` and `:476` use that set to
  decide `duplicate`, `reused_state`, and therefore
  `dispatch.provider_launch_allowed`;
- Foreman targeted smoke with an existing receipt state
  `provider_acceptance_unobserved` returned:

```json
{
  "exit": 0,
  "status": "supervised_live_launch_ready",
  "lifecycle_state": "accepted_pre_launch",
  "duplicate": false,
  "provider_launch_allowed": true
}
```

That result is not acceptable because it would allow a second launch after a
prior same-key attempt already reached provider-acceptance observation.

### Finding 2: cleanup classification requirement is still unproven

The routed source card requires cleanup classification before acceptance:

- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md:182`
  says a terminal success receipt must include cleanup proof and missing proof
  should report `cleanup_unverified`;
- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md:251`
  requires a deterministic fixture/no-provider cleanup failure smoke classified
  as `cleanup_unverified` or equivalent, not completed.

Current `scripts/afk-session-trigger-prototype.mjs` has no cleanup status or
`cleanup_unverified` path, and `tests/afk-session-trigger-prototype.test.mjs`
does not cover cleanup failure classification.

## Required Behavior

Fix both acceptance blockers without broadening the slice:

- same-key existing receipts with `terminal_started`,
  `provider_acceptance_unobserved`, `provider_session_observed`, `completed`,
  `running`, and any existing equivalent live-observed state must return
  `status: "duplicate"` or an equivalent non-launching duplicate result;
- those duplicate results must set `scheduler.lifecycle_state` to `duplicate`
  or equivalent and `dispatch.provider_launch_allowed` to `false`;
- same-key rejected/failed/expired/blocked receipt behavior must still require
  explicit replacement/supersession before relaunch;
- the supervised-live receipt must represent cleanup ownership explicitly;
- deterministic fixture/no-provider cleanup failure must classify as
  `cleanup_unverified` or an equivalent non-completed status/mismatch, with no
  live provider launch and no transcript/catalog mutation;
- preserve the accepted dry-run behavior and existing guarded live guard
  behavior.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this correction round.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not redesign final command spelling, schema promotion, unattended
  scheduling, gateway result-route delivery, or multi-provider live launch.

## Suggested Implementation Areas

- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

Touch Swift/help registry files only if the correction adds or changes a
documented CLI flag. Prefer no new public flags unless the existing fixture or
receipt mechanisms cannot express the cleanup classification clearly.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

Run if touched:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Add or update focused tests proving:

- `provider_acceptance_unobserved` existing receipt state is duplicate and
  `provider_launch_allowed=false`;
- `terminal_started` existing receipt state is duplicate and
  `provider_launch_allowed=false`;
- rejected/failed retry still blocks unless replacement/supersession is
  explicit;
- deterministic cleanup failure classifies as `cleanup_unverified` or
  equivalent and is not completed.

If repo-mode TCC/Input Monitoring readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this correction;
- exact duplicate states now treated as non-launching duplicates;
- cleanup classification behavior and the exact status/mismatch used;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened.

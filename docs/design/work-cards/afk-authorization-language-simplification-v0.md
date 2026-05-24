# Work Card: AFK Authorization Language Simplification V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: simplify the user-facing AFK run language by making the
  primary CLI/help/docs terms `AFK authorization` and `AFK live launch`, while
  preserving compatibility with the existing implementation.
- Source artifact: user direction on 2026-05-24: avoid adding new terms and keep
  the away-work surface simple.
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-authorization-language-simplification-v0` from `origin/main`.
  Commit and push that GDI branch when verification passes. Do not open a PR,
  merge, mutate main, mutate GitHub issues/projects, launch providers, or route
  follow-up work from inside the GDI round.

## Product Direction

The capability is just an approved AFK run. Do not keep inventing project-local
terms for it.

Preferred user-facing language:

- `AFK authorization`
- `AFK live launch`
- approved AFK run
- away/AFK report

Avoid using `sleep lease` in new user-facing help, docs, work cards, or status
messages except when documenting backward compatibility with existing flags,
field names, fixtures, or historical work cards.

## Goal

Make the primary CLI/help path read like a simple approved AFK run:

```bash
./aos dev afk-session-trigger \
  --packet packet.json \
  --afk-authorization authorization.json \
  --afk-live-launch \
  --json \
  --out receipt.json
```

Keep the existing `--sleep-lease` and `--sleep-lease-live-launch` flags working
as compatibility aliases unless source reading proves they are not externally
reachable. Do not break existing receipts or tests that assert backward
compatibility.

## Read First

- `AGENTS.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
rg -n "sleep[- ]lease|sleep_lease|--sleep-lease" scripts src tests docs/design | head -200
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,src/commands/dev.swift,src/shared/command-registry-data.swift,tests/afk-session-trigger-prototype.test.mjs,tests/dev-workflow-router.sh,tests/help-contract.sh,docs/design/durable-agent-cognition-and-afk-primitives.md,docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md
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

## Required Behavior

1. Add primary CLI aliases:

   - `--afk-authorization <authorization.json>` as the primary spelling for the
     existing authorization file input.
   - `--afk-live-launch` as the primary spelling for the unattended AFK launch
     action.

2. Preserve compatibility:

   - Existing `--sleep-lease` and `--sleep-lease-live-launch` inputs must still
     work.
   - Existing receipt fields may stay stable in this slice if renaming them
     would increase compatibility risk. If additive mirror fields are cheap and
     clear, add them; do not remove existing fields.
   - Existing historical work card filenames do not need to be renamed.

3. Help and docs:

   - Make command help show the AFK wording as primary.
   - Keep compatibility aliases documented briefly if they remain public.
   - Update near-term design docs so new prose uses AFK authorization / AFK
     live launch instead of sleep lease.

4. Tests:

   - Add tests proving the new flags behave the same as the old flags.
   - Keep tests proving old flags still work.
   - Update help/router assertions to prefer the new flags while preserving
     compatibility coverage.

## Hard Boundaries

- Do not redesign AFK scheduling, provider launch policy, route delivery,
  receipts, provider metadata correlation, or cleanup semantics.
- Do not perform a real provider launch.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  another session from inside the GDI round.

## Verification

Run the checks recommended by `./aos dev recommend`. Expected minimum:

```bash
./aos dev build
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
git diff --check
```

If the slice changes only JS/docs/help and `./aos dev recommend` says a Swift
build is not required, report that exact recommendation instead of forcing a
build.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact new primary flags and old compatibility aliases;
- receipt compatibility decision;
- docs/help wording summary;
- verification commands and results;
- statement confirming the hard boundaries were respected.

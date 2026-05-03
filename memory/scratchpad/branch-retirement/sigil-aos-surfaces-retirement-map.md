# Retire `codex/sigil-aos-surfaces`

Status: working retirement map for review. Do not treat this as an instruction
to merge, rebase, or delete branches without a fresh human decision.

## Goal

Retire `codex/sigil-aos-surfaces` as an active work branch because the name and
history now mix several unrelated efforts. Preserve the useful work as focused
future levers that can be pulled one at a time from current `main`.

The safe default is:

1. Keep `main` as the integration branch.
2. Keep the old branch and checkpoint branch as evidence until each useful slice
   is classified.
3. Port useful work only through fresh, narrowly named branches from current
   `main`.
4. Never merge or rebase `codex/sigil-aos-surfaces` wholesale.

## Current Safety Handles

- Current integration ref: `main` at `1fdb7f1`.
- Old mixed branch: `codex/sigil-aos-surfaces` at `0d9dfc3`.
- Remote old mixed branch: `origin/codex/sigil-aos-surfaces` at `0d9dfc3`.
- Local checkpoint branch preserving the former root dirty state:
  `checkpoint/sigil-aos-surfaces-root-2026-05-03` at `7d74264`.
- Retirement inventory branch:
  `codex/retire-sigil-aos-surfaces` at `1fdb7f1` plus this note.
- Merge base for `main`, the old branch, and the checkpoint branch:
  `9c7b254662bd37ba7f2e852c2fed1af6c41bf53e`.

The checkpoint branch is intentionally local-only. It should stay until the
classification is complete.

As of the latest local/GitHub check on 2026-05-03:

- No active worktree is attached to `codex/sigil-aos-surfaces`.
- No GitHub PR was found with head branch `codex/sigil-aos-surfaces`.
- The active retirement worktree is
  `/Users/Michael/Code/agent-os-worktrees/retire-sigil-aos-surfaces`.

## Why Not Rebase Or Merge The Old Branch

`codex/sigil-aos-surfaces` has 43 branch-only commits after the merge base and
touches runtime Swift, schemas, toolkit packages, Sigil visuals, tests, docs,
and scratchpad material. Its tree also predates newer `main` work that already
landed through focused PRs.

A wholesale merge would force current `main` to reconcile a broad historical
branch whose intent is no longer one topic. A rebase would make the history look
cleaner without solving the semantic problem: every conflict would still require
deciding which feature slice belongs in the product now.

## Already Landed Or Superseded

These do not need to be ported from `codex/sigil-aos-surfaces`.

- Addressable canvas object registry and transform control landed through the
  #198/#199/#200 workstream.
- Sigil wiki-brain object adoption landed through the focused Sigil adopter work.
- Stale Sigil radial menu config normalization landed through the follow-up fix
  on `main`.
- `human-brain` model assets are present on `main`.
- Several toolkit semantic target files and Sigil radial target-surface files
  are byte-for-byte identical between the old branch and `main`.

## Decision Buckets

### 1. Retire The Old Branch As Active Work

Recommended lever after review:

```sh
git branch -m codex/sigil-aos-surfaces archive/sigil-aos-surfaces-retired-2026-05-03
git push origin --delete codex/sigil-aos-surfaces
```

Do this only after confirming no active worktree is attached to the old branch
and no open PR depends on it.

### 2. Sigil Brain Chrome And Visual Tuning

Evidence:

- The old branch and checkpoint contain Sigil radial visual experiments.
- Current `main` already has the live `human-brain` shell, inner tree model, and
  stale-config normalization.
- The checkpoint branch still has a divergent
  `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`, so there may be
  visual tuning worth porting.

Recommended lever:

```sh
git worktree add ../agent-os-worktrees/salvage-sigil-brain-visuals -b codex/salvage-sigil-brain-visuals main
```

Then manually port only the desired visual behavior from the checkpoint branch.
Verify with the real `avatar-main` surface before merging.

Human decision needed:

- Whether any old visual behavior is still desired now that the current
  wiki-brain shell/tree path is working.
- Whether to keep the richer brain chrome as product behavior or leave it as
  non-critical visual experiment material.

Likely provenance:

- `bfa36ef` `sigil: refine radial wiki brain visuals`
- `f90d2a5` `sigil: preserve wiki brain asset license`
- `efd4056` `Add Sigil radial brain real-input scenario`
- `11dfbde` `Fix Sigil real-input harness daemon ownership`
- `630a6df` `Harden radial real-input drag fixture`
- `61d5e94` `Expose Sigil radial menu targets to AOS agents`
- `6c60309` `fix(content): detect stale canonical roots`
- `a046dc6` `fix(status): preflight utility content roots`

### 3. Runtime Capability Preflight Work

Evidence:

- The old branch contains broad Swift/runtime changes around capability
  preflights, daemon commands, show/content/spatial/voice/log projection paths,
  and related shell tests.
- This is permission-bearing runtime code. Porting it may require rebuilding
  `./aos` and could surface macOS TCC permission drift.
- Current repo guidance already treats `./aos ready` as the primary readiness
  gate and says not to rebuild unless Swift/runtime changes require it.

Recommended lever:

```sh
git worktree add ../agent-os-worktrees/salvage-runtime-preflight -b codex/salvage-runtime-preflight main
```

Then review the old commits as source material, not as a patch queue. Start from
the current readiness model and port only the contract gaps that still exist.

Human decision needed:

- Whether capability preflight is still the next runtime priority.
- Whether the work should be reduced to docs/spec first, or implemented directly
  in the Swift runtime.

Likely provenance:

- `bf589ac` `Mark isolated daemon status items`
- `2ad50fb` `fix(dev): keep app routing local`
- `eff8558` `Describe lazy readiness preflight`
- `80c8826` `Link readiness preflight tracker`
- `2f94692` `Specify capability preflight leases`
- `0f10108` `Expose command capability requirements`
- `06d0f2a` `Add daemon capability preflight leases`
- `8178354` `Route input actions through capability preflight`
- `4b7398c` `Preflight show canvas commands`
- `ad7fb0a` `Preflight observe subscriptions`
- `11b8962` `Collapse redundant readiness recommendations`
- `f6dd20c` `Document daemon preflight IPC contract`
- `76857f1` `Preflight daemon channel commands`
- `4e4bc11` `Preflight remaining show commands`
- `2e364e2` `Preflight voice daemon commands`
- `9f5d152` `Preflight spatial daemon commands`
- `ef9f2ca` `Preflight content daemon commands`
- `4832125` `Preflight log projection commands`
- `0d9dfc3` `Preflight show ping`

### 4. Governance, Docs, And Agent Coordination Notes

Evidence:

- The old branch contains docs about GitHub coordination hygiene, design
  operator implementation, topic-branch defaults, AOS taxonomy, instruction
  surfaces, value-of-information, EVOI placement, test harness roles, and
  supervised runs.
- Some of this intent is now represented in `AGENTS.md`,
  `docs/design/permission-bearing-runtime-boundary.md`, and existing recipes.
- Some checkpoint-only scratchpad notes are not on `main`.

Recommended lever:

```sh
git worktree add ../agent-os-worktrees/salvage-governance-notes -b codex/salvage-governance-notes main
```

Then port only durable, current guidance into the right boundary:

- repo-wide behavior in `AGENTS.md`,
- reusable operating procedures in `docs/recipes/`,
- provider-neutral plans in `docs/design/`,
- scratchpad-only idea capture in `memory/scratchpad/`.

Human decision needed:

- Which scratchpad notes are worth keeping on `main`.
- Whether EVOI belongs as active design work now or should remain parked as a
  concept note.

Likely provenance:

- `095b669` `docs: add github coordination hygiene plan`
- `d3434d5` `docs: add design operator implementation plan`
- `f09cc76` `docs: plan supervised test runs`
- `4efc74d` `docs: reframe supervised run roadmap`
- `945d95f` `governance: make topic branches default`
- `42f8c7a` `Document GitHub issue lane labels`
- `d659f1b` `Clarify AOS instruction surface taxonomy`
- `8ea7e06` `Mark legacy Superpowers design archive`
- `dec4a27` `Document test harness folder roles`
- `760f1a6` `Classify EVOI placement`
- `1605748` `Add value-of-information clarification recipe`

### 5. Steerable Collection, Source Packs, Browser Intent, And Run Control

Evidence:

- The old branch has a coherent-looking future feature set around steerable
  collection schemas, source packs, target probes, browser intent sensors,
  run-control substrate, and tests.
- This is not necessary to retire the old branch and is not necessary for the
  current Sigil brain menu fix.

Recommended lever:

```sh
git worktree add ../agent-os-worktrees/salvage-steerable-collection -b codex/salvage-steerable-collection main
```

Then decide whether this becomes a product feature, a design note, or an archive
only.

Human decision needed:

- Whether steerable collection/run control is a near-term product direction.
- Whether it should be decomposed before any implementation is ported.

Likely provenance:

- `4185d8e` `steerable collection schemas`
- `34de47c` `toolkit run control puck substrate`
- `314f053` `browser intent sensor canonicalization`
- `3e09876` `steerable collection source pack demo`
- `bc89077` `Add AOS dev workflow control surface`
- `2091375` `Add AOS toolkit accessibility semantics`
- `e98c988` `Retrofit toolkit surfaces with AOS AX metadata`

### 6. Checkpoint-Only Scratchpad Notes

Evidence:

The checkpoint branch contains scratchpad notes that are not on `main`:

- `memory/scratchpad/EVOI_Project/2026-05-01-readiness-preflight-session-handoff.md`
- `memory/scratchpad/EVOI_Project/aos-taxonomy-next-session-game-plan.md`
- `memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md`
- `memory/scratchpad/EVOI_Project/playbook_prototype.md`
- `memory/scratchpad/aos-worktree-session-scope-musings.md`

Recommended lever:

```sh
git worktree add ../agent-os-worktrees/salvage-checkpoint-notes -b codex/salvage-checkpoint-notes main
```

Then copy only notes that should survive worktree pruning.

Human decision needed:

- Whether these are useful project memory or stale session residue.

## Proposed Review Order

1. Review this retirement map.
2. Decide whether the old branch can be marked inactive immediately.
3. Decide whether checkpoint-only scratchpad notes should be saved to `main`.
4. Decide whether Sigil brain visual tuning needs a fresh salvage branch.
5. Decide whether runtime preflight is active work or parked design material.
6. Decide whether steerable collection/run-control deserves its own future
   workstream.
7. Delete or archive the old remote branch only after the useful buckets have
   either been saved or intentionally discarded.

## Commands For Evidence Review

Inspect branch-only commits:

```sh
git log --oneline --reverse 9c7b254662bd37ba7f2e852c2fed1af6c41bf53e..codex/sigil-aos-surfaces
```

Inspect checkpoint-only changes:

```sh
git diff --stat codex/sigil-aos-surfaces..checkpoint/sigil-aos-surfaces-root-2026-05-03
```

Inspect current conflict surface against `main`:

```sh
git diff --stat main..codex/sigil-aos-surfaces
git diff --stat main..checkpoint/sigil-aos-surfaces-root-2026-05-03
```

The important rule is to compare and port by topic, not by whole branch.

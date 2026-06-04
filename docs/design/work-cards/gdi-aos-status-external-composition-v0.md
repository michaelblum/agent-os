# GDI AOS Status External Composition V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: move public `./aos status` behavior out of Swift into external script composition while preserving current status JSON/text behavior and using existing private broker primitives plus daemon socket snapshot composition.
- Source artifact: #407 TCC broker lane, ADR `docs/adr/0015-aos-tcc-capability-broker-boundary.md`, inventory `docs/design/aos-tcc-capability-broker-inventory-v0.md`, and accepted ready cutover commit `f418bb22`.
- Branch/Base:
  - branch_from: local `gdi/aos-target-addressed-action-ergonomics-v0`
  - required_start_ref: local `gdi/aos-target-addressed-action-ergonomics-v0` at or after `f418bb22`
- Branch/output expectations: use the existing single checkout at `/Users/Michael/Code/agent-os`; keep changes on `gdi/aos-target-addressed-action-ergonomics-v0`; do not create linked worktrees; do not push or open a PR.
- Stop conditions: stop with `human_needed` if live verification hits repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers; stop and report a blocker if public `status` cannot be preserved without adding another native primitive or moving workflow policy back into Swift.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make `./aos status` route through external composition, with Swift retaining only private fact/action primitives and public status behavior remaining equivalent for the covered runtime, permission, stale-resource, git, and daemon-snapshot contracts.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/dev/command-surface.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `src/main.swift`
- `src/commands/operator.swift`
- `scripts/aos-ready.mjs`
- `scripts/aos-clean.mjs`
- `scripts/aos-focus-graph.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `tests/input-tap-readiness.sh`
- `tests/ready-fast-healthy-path.sh`
- `tests/external-command-dispatch.sh`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`

## Rediscover State

```bash
git status --short --branch
git log --oneline -5
./aos ready
./aos status --json
./aos dev recommend --json --paths scripts/aos-status.mjs manifests/commands/aos-external-commands.json tests/external-command-dispatch.sh tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If `./aos ready`, `./aos status --json`, or a bounded live check reports repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman. Do not run permission reset/setup, TCC reset, service restart loops, raw launchd recovery, raw socket probes, or tmux/PTY recovery.

## Existing Code To Inspect

- `src/commands/operator.swift` - current public `statusCommand`, `currentCleanReport`, `currentGitStatus`, `currentRuntimeState`, `currentSpatialSnapshot`, and status text/JSON shape.
- `src/main.swift` - current private route table and broad `__status` public workflow route.
- `scripts/aos-ready.mjs` - current self-contained external composition pattern and private primitive invocation helpers.
- `scripts/aos-clean.mjs` - stale-resource dry-run contract currently called from Swift status.
- `scripts/aos-focus-graph.mjs` - Node daemon socket request pattern for `see`/`snapshot`; reuse the concept only if needed, without starting daemons implicitly.
- `manifests/commands/aos-external-commands.json` - public `status` route cutover target.
- `tests/input-tap-readiness.sh` and `tests/ready-fast-healthy-path.sh` - deterministic status runtime/input-tap expectations.
- `tests/external-command-dispatch.sh` and `tests/schemas/aos-external-command-manifest-v0.test.mjs` - manifest route and private primitive guard expectations.

## Required Behavior

- Add external `scripts/aos-status.mjs` or the narrow equivalent script path that owns public `status` grammar, status aggregation, JSON output, text one-line summary, notes, and recommended entrypoint presentation.
- Public `./aos status` and `./aos status --json` must continue to accept only the existing flags and preserve current unknown-flag error behavior closely enough for users and tests.
- Compose status from existing private facts and external scripts:
  - `./aos __runtime status-facts --json`
  - `./aos __permissions facts --json`
  - `./aos __permissions setup-marker get --json`
  - `./aos __daemon health --json` only if needed for notes or parity not already present in runtime facts
  - `scripts/aos-clean.mjs --dry-run --json`
  - git commands equivalent to Swift `currentGitStatus`
  - daemon socket `see`/`snapshot` request for `daemon_snapshot`; if unavailable, preserve the current notes behavior (`Daemon snapshot is unavailable.` or decode/error note) rather than fabricating a snapshot.
- Preserve current `status --json` top-level shape:
  - `status`
  - `identity`
  - `runtime`
  - `permissions`
  - `permissions_setup`
  - `daemon_snapshot`
  - `stale_resources`
  - `git`
  - `recommended_entrypoints`
  - `notes`
- Preserve current text summary fields: `status`, `mode`, `daemon`, `pid`, `tap`, `focused_app`, `displays`, `windows`, `channels`, `stale_canvases`, and git `branch`, `ahead`, `dirty` when git state is available.
- Preserve legacy daemon absent-field semantics: missing daemon listen/post/accessibility facts are unknown or omitted, not fabricated false.
- Preserve the current clean dry-run degradation behavior: clean failures produce `stale_resources.status="unknown"` with a useful note, not a hard public status crash.
- Cut public `status` in `manifests/commands/aos-external-commands.json` away from `$AOS_PATH __status` to the external script with the same env plumbing used by `ready`.
- Update manifest/schema/dispatch tests so public `status` no longer counts as an allowed direct `$AOS_PATH` bootstrap route. Do not add a new broad `__status` wrapper or alias.
- Leave broad Swift `__status` in place unless every in-repo caller is confirmed cut over and removal is explicitly safe without a native build/TCC cycle. If removal looks warranted, report it to Foreman as the next slice instead of expanding this GDI round into Swift cleanup.

## Scope

This is external command composition and tests. It should be hot-swappable after the accepted native primitive and ready cutover commits already present on this branch. It should not add new Swift/native behavior.

## Hard Boundaries

- Do not edit Swift unless you discover a compile-independent test-only assertion update is impossible without a tiny deletion; if Swift behavior is missing, stop and report the missing primitive to Foreman.
- Do not add aliases, adapters, compatibility wrappers, transitional broad routes, or old-vocabulary fallbacks.
- Do not move permission recovery policy, next-action text, public grammar, help text, status presentation, or workflow composition into Swift.
- Do not start daemon/service loops from `status`; status must remain observational.
- Do not push, open a PR, create a linked worktree, reset unrelated files, or clean unrelated untracked work.
- Do not run raw daemon HTTP, tmux, launchd, socket/state-file inspection, or direct PTY control unless an `./aos` command is broken and you state the bypass reason in the report.

## Suggested Implementation Areas

- `scripts/aos-status.mjs` - new external status implementation.
- Optional `scripts/lib/aos-runtime-compose.mjs` - only if sharing helpers with `scripts/aos-ready.mjs` materially reduces duplication without widening the slice. Keep any extraction mechanical and test-covered.
- `manifests/commands/aos-external-commands.json` - public status route cutover.
- `tests/input-tap-readiness.sh` and `tests/ready-fast-healthy-path.sh` - preserve status JSON/text contracts against isolated mock daemons.
- `tests/external-command-dispatch.sh` and `tests/schemas/aos-external-command-manifest-v0.test.mjs` - update route allowlists/expectations so `status` no longer points to `__status`.
- Add a focused Node or shell test for `scripts/aos-status.mjs` only if the existing shell tests do not cover a meaningful new parser/composition path.

## Verification

Run deterministic checks:

```bash
node --check scripts/aos-status.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/input-tap-readiness.sh
bash tests/ready-fast-healthy-path.sh
bash tests/runtime-readiness-broker-primitives.sh
bash tests/permissions-broker-primitives.sh
bash tests/help-contract.sh
git diff --check
```

Run workflow recommendation on changed paths:

```bash
./aos dev recommend --json --paths <changed paths>
```

If live AOS is safe and `./aos ready` is not blocked by permissions, run:

```bash
./aos status --json
./aos status
./aos ready --json
```

Live `./aos status` may be `degraded` for stale resources, active-experience drift, or other non-TCC notes. That is acceptable if the command returns valid status output and the report explains the note. If readiness is blocked by TCC/input tap, use the human-needed stop path above instead of looping.

## Completion Report

Report:

- files changed;
- whether public `status` now routes externally and which manifest entries changed;
- whether any Swift broad `__status` route/callers remain, and why;
- how runtime, permission, setup marker, daemon snapshot, stale-resource, git, legacy daemon, and text summary behavior was preserved;
- exact verification commands and pass/fail results;
- live `./aos status` and `./aos ready` result, or exact human-needed blocker;
- unrelated dirty/untracked state left untouched;
- recommended next slice after Foreman acceptance, especially whether `doctor` external composition is now unblocked.

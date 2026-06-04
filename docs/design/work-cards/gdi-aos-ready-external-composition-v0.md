# GDI AOS Ready External Composition V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: move public `./aos ready` behavior out of Swift into external script composition while preserving current ready JSON/text behavior and using the new private broker primitives.
- Source artifact: #407 TCC broker lane, ADR `docs/adr/0015-aos-tcc-capability-broker-boundary.md`, inventory `docs/design/aos-tcc-capability-broker-inventory-v0.md`, and local primitive commits `4cd5b503` and `b94f486f`.
- Branch/Base:
  - branch_from: local `gdi/aos-target-addressed-action-ergonomics-v0`
  - required_start_ref: local `gdi/aos-target-addressed-action-ergonomics-v0` at or after `b94f486f`
- Branch/output expectations: use the existing single checkout at `/Users/Michael/Code/agent-os`; keep changes on `gdi/aos-target-addressed-action-ergonomics-v0`; do not create linked worktrees; do not push or open a PR.
- Stop conditions: stop with `human_needed` if live verification hits repo-mode TCC/Input Monitoring/input-tap blockers; stop and report a blocker if public `ready` cannot be preserved without adding another native primitive or moving workflow policy back into Swift.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make `./aos ready` route through external composition, with Swift retaining only private fact/action primitives and the public command behavior remaining equivalent for the covered readiness contracts.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/dev/command-surface.md`
- `src/main.swift`
- `src/commands/operator.swift`
- `scripts/aos-service.mjs`
- `scripts/aos-clean.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `tests/runtime-readiness-broker-primitives.sh`
- `tests/permissions-broker-primitives.sh`
- `tests/input-tap-readiness.sh`
- `tests/input-tap-readiness-legacy.sh`
- `tests/ready-ownership-mismatch.sh`

## Rediscover State

```bash
git status --short --branch
git log --oneline -5
./aos ready
./aos dev recommend --json --paths scripts/aos-ready.mjs manifests/commands/aos-external-commands.json manifests/commands/aos-commands.json tests/input-tap-readiness.sh tests/ready-ownership-mismatch.sh
```

If `./aos ready` or a bounded live check reports repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman. Do not run permission reset/setup, TCC reset, service restart loops, or raw launchd recovery.

## Existing Code To Inspect

- `src/commands/operator.swift` - current public `readyCommand` behavior and the private broker primitives now available.
- `src/main.swift` - current private route table and broad `__ready` public workflow route.
- `scripts/aos-service.mjs` - external service start/status/restart behavior used by current ready orchestration.
- `scripts/aos-clean.mjs` - external stale-resource cleanup dry-run contract currently called from Swift.
- `manifests/commands/aos-external-commands.json` - public route cutover target.
- `manifests/commands/aos-commands.json` - public help/usage source of truth.
- `tests/input-tap-readiness.sh`, `tests/input-tap-readiness-legacy.sh`, `tests/ready-ownership-mismatch.sh`, `tests/permissions-marker-worktree.sh` - current ready/permission behavior contracts.

## Required Behavior

- Add external `scripts/aos-ready.mjs` or the narrow equivalent script path that owns public `ready` grammar, startup decision, repair sequencing, blocker assembly, text output, JSON output, and next-action/human-handoff text.
- Public `./aos ready`, `./aos ready --json`, `./aos ready --repair`, and `./aos ready --post-permission` must continue to behave consistently with existing tests.
- Compose readiness from private broker primitives:
  - `./aos __daemon health --json`
  - `./aos __runtime status-facts --json`
  - `./aos __permissions facts --json`
  - `./aos __permissions setup-marker get --json`
  - `scripts/aos-service.mjs` for service start/restart/status
  - `scripts/aos-clean.mjs --dry-run --json` or `./aos clean --json` only where existing behavior already uses cleanup policy.
- Cut public `ready` in `manifests/commands/aos-external-commands.json` away from `$AOS_PATH __ready` to the external script.
- Keep Swift public `readyCommand` unexpanded. Removing or parking the broad `__ready` route is acceptable only if every in-repo caller is cut over in the same slice. Do not add a broad compatibility shim.
- Preserve legacy daemon absent-field semantics: missing daemon listen/post/accessibility facts are unknown, not fabricated false.
- Preserve repo-mode cross-worktree marker behavior from `tests/permissions-marker-worktree.sh`.
- Preserve safe permission reset handoff wording and `finished` relay expectation already covered by `tests/input-tap-readiness.sh`.

## Scope

This is external command composition and tests. It should be hot-swappable after the native primitive commits already present on this branch. It should not add new Swift/native behavior.

## Hard Boundaries

- Do not edit Swift unless you discover a small compile-independent deletion/cutover cleanup that is strictly required and does not add behavior. If Swift behavior is missing, stop and report the missing primitive to Foreman.
- Do not add aliases, adapters, compatibility wrappers, or old broad route fallbacks.
- Do not move permission recovery policy, next-action text, public grammar, help text, or workflow composition into Swift.
- Do not push, open a PR, create a linked worktree, reset unrelated files, or clean unrelated untracked work.
- Do not run raw daemon HTTP, tmux, launchd, socket/state-file inspection, or direct PTY control unless an `./aos` command is broken and you state the bypass reason in the report.

## Suggested Implementation Areas

- `scripts/aos-ready.mjs` - new external ready implementation.
- `manifests/commands/aos-external-commands.json` - public ready route cutover.
- `tests/input-tap-readiness.sh`, `tests/input-tap-readiness-legacy.sh`, `tests/ready-ownership-mismatch.sh`, `tests/permissions-marker-worktree.sh` - update expectations only as needed to assert script-owned output and private primitive facts.
- `tests/external-command-dispatch.sh` and `tests/schemas/aos-external-command-manifest-v0.test.mjs` - update route allowlists/expectations so `ready` no longer points to `__ready`.
- `docs/dev/command-surface.md` or inventory docs only if the cutover changes durable command-surface wording.

## Verification

Run deterministic checks:

```bash
node --check scripts/aos-ready.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/input-tap-readiness.sh
bash tests/input-tap-readiness-legacy.sh
bash tests/ready-ownership-mismatch.sh
bash tests/permissions-marker-worktree.sh
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
./aos ready --json
./aos ready
```

If readiness is blocked by TCC/input tap, use the human-needed stop path above instead of looping.

## Completion Report

Report:

- files changed;
- whether public `ready` now routes externally and which manifest entries changed;
- which Swift broad route/callers remain, if any, and why;
- how existing repair, post-permission, marker, legacy daemon, and unmanaged-owner behavior was preserved;
- exact verification commands and pass/fail results;
- live `./aos ready` result or exact human-needed blocker;
- unrelated dirty/untracked state left untouched;
- recommended next slice after Foreman acceptance.

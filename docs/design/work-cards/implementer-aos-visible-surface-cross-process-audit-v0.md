# Implementer Work Card: AOS Visible Surface Cross-Process Audit V0

## Recipient

Implementer implementation round.

## Branch / Base

- `branch_from`: `implementer/aos-visible-surface-orphan-audit-v0`
- `minimum_code_start_ref`: `935461f29148eb6e31d641356812180ddc9b4157`
- `required_start_ref`: the Foreman routing checkpoint containing this work
  card, descendant of `935461f29148eb6e31d641356812180ddc9b4157`.
- `expected_output_branch`: `implementer/aos-visible-surface-cross-process-audit-v0`

Do not restart from `origin/main`. This card depends on the accepted
current-daemon visible surface audit at `935461f29148eb6e31d641356812180ddc9b4157`.

## Source Artifact

Foreman accepted the corrected visible surface audit slice at:

```text
935461f29148eb6e31d641356812180ddc9b4157 fix(show): correct visible surface audit registry
```

That slice made `./aos show audit --json` honest and useful for the active
daemon:

- `orphan_native_windows` contains only visible, on-screen unmatched native
  windows owned by the current daemon process;
- non-visible unmatched current-daemon windows are separated into
  `non_visible_unmatched_native_windows`;
- requested frame comes from `Canvas.desiredCGFrame` when available;
- the runtime block explicitly states
  `native_window_scope = "current_daemon_process"`.

The original human-visible defect was broader than that: stale or duplicate AOS
surfaces from another branch/worktree/runtime can remain visible while the
active daemon registry looks correct. The next audit slice must make those
external visible AOS windows observable before toolkit placement, Sigil avatar
avoidance, or panel drag correction resumes.

Current paused card:

```text
docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md
```

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extend the AOS visible-surface audit so agents can see visible AOS-owned native
windows from other daemon/runtime processes or stale worktrees, while preserving
the current-daemon registry/native join contract.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `docs/design/work-cards/implementer-aos-visible-surface-orphan-audit-v0.md`
- `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/worktree-session-scope.md`
- `docs/design/aos-surface-system.md`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `src/daemon/unified.swift`
- `src/commands/operator.swift`
- `scripts/aos-clean.mjs`
- `tests/canvas-visible-surface-audit.sh`
- `tests/ready-stale-daemon-hygiene.sh`
- `tests/canvas-owner-metadata.sh`
- `tests/daemon-input-surface-ownership.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 935461f29148eb6e31d641356812180ddc9b4157 HEAD; echo "accepted_current_daemon_audit_ancestor=$?"
./aos ready --json
./aos status --json
./aos show audit --json
./aos clean --dry-run --json
./aos dev recommend --json --paths src/display/canvas.swift,src/display/protocol.swift,src/daemon/unified.swift,src/commands/operator.swift,scripts/aos-clean.mjs,tests/canvas-visible-surface-audit.sh,tests/ready-stale-daemon-hygiene.sh
rg -n "visibleSurfaceAudit|nativeWindowServerEntries|CGWindowListCopyWindowInfo|owner_pid|native_window_scope|stale_daemons|aos clean|show audit|windowNumbers" src scripts tests manifests docs/design/work-cards/implementer-aos-visible-surface-orphan-audit-v0.md
```

Run `./aos ready --post-permission` only when a live input or capture check is
needed. If it reports a repo-mode TCC, Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`,
continue in the same Implementer session and run:

```bash
./aos ready --post-permission
```

Do not start permission setup, readiness repair, or ad-hoc retry loops from
Implementer.

## Required Behavior

### Keep The Accepted Current-Daemon Contract

Do not regress the accepted `./aos show audit --json` contract:

- current-daemon `registered_canvases` still join through
  `CanvasInfo.windowNumbers[] == CGWindowListCopyWindowInfo[kCGWindowNumber]`;
- current-daemon `orphan_native_windows` remains only visible and on-screen;
- non-visible unmatched current-daemon native windows remain separated;
- current-daemon rows still expose requested frame, actual native frame,
  owner metadata, logical surface key, duplicate logical surfaces, and
  input-target winner diagnostics.

If the schema changes, keep the old meaning strict rather than widening a field
silently. Prefer adding a clearly named field over making
`orphan_native_windows` mean both current-daemon orphan and external runtime
window.

### Add Cross-Process Visible AOS Native Windows

Add an audit section with a stable name such as
`external_aos_native_windows`. It must list visible, on-screen native windows
that appear to be AOS-owned but are not owned by the current daemon PID.

Each row should expose real native/process truth where available:

- native window number, owner PID, owner name, actual native frame,
  window layer/level, visibility, on-screen state, display relationship, and
  front-to-back order;
- classification, for example `external_aos_daemon_window`,
  `stale_aos_daemon_window`, `installed_mode_window`, or
  `unknown_aos_runtime_window`;
- process identity evidence such as executable path, command line, runtime
  mode, state root, socket path, worktree root, branch, repo git commit, or an
  explicit unavailable reason for each field that cannot be known;
- whether the PID appears in the same stale-daemon model used by
  `./aos clean --dry-run --json`.

It is acceptable for some provenance fields to be unavailable from native
window-server data. Do not fake branch, worktree, or content-root identity from
the active daemon registry. Use explicit unavailable reasons.

### Add Runtime Scope Summary

Extend the audit's `runtime` or a sibling diagnostics block so the output
explains both scopes:

- current daemon PID and mode;
- current daemon native window scope;
- whether cross-process AOS window discovery ran;
- how external AOS process candidates were identified;
- what external process metadata source was used;
- what cleanup/status command can remove or further inspect stale runtime
  state when a stale external PID is detected.

The audit should make it impossible to confuse "current registry is clean" with
"no other visible AOS windows exist."

### Input Target Winner Across External Windows

When `--point x,y` is provided, include external visible AOS windows in the
front-to-back input-target diagnostic. If a visible external AOS window wins at
the point, the winner should identify it as external and include the native
window/process evidence rather than pretending it is a current-daemon canvas.

If this cannot be done without a larger router change, preserve the existing
current-daemon point winner and add an explicit
`external_window_winner_unavailable_reason` field plus a focused follow-up
recommendation in the completion report.

### AOS-First Boundary

The accepted user-facing proof remains `./aos show audit --json` and related
`./aos status` / `./aos clean --dry-run` output. Implementation may use native
window-server and process metadata internally, but do not make Foreman, Implementer, or
Operator rely on raw `curl`, direct state-file inspection, `tmux`, `ps`, or
ad-hoc Quartz scripts as the primary proof.

## Scope

Likely ownership is daemon/display observability plus the existing cleanup or
status process metadata bridge. CLI/help/schema files are in scope only if the
audit shape, help text, or command registry needs updating.

## Hard Boundaries / Non-Goals

- Do not resume
  `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md`.
- Do not implement toolkit panel placement overflow policy.
- Do not move the Sigil avatar or change Avatar controls UI.
- Do not migrate `sigil.avatar_panel.*` in this round.
- Do not make `./aos ready` a visual-surface exclusivity proof.
- Do not make cleanup destructive as part of `show audit`; this is read-only
  observability.
- Do not collapse external AOS windows into the current daemon's
  `registered_canvases` or `orphan_native_windows`.
- Do not mutate unrelated work cards, reports, or generated proof artifacts.

## Suggested Implementation Areas

- `src/display/canvas.swift` - current `visibleSurfaceAudit`,
  `nativeWindowServerEntries(ownerPID:)`, and point winner logic.
- `src/display/protocol.swift` - only if the audit needs additional
  serializable fields.
- `src/daemon/unified.swift` - daemon route surface if the audit needs a small
  helper endpoint or health payload addition.
- `src/commands/operator.swift` and `scripts/aos-clean.mjs` - existing
  stale-daemon/process metadata models to reuse or align with audit output.
- `tests/canvas-visible-surface-audit.sh` - primary focused audit contract.
- `tests/ready-stale-daemon-hygiene.sh` - precedent for isolated stale daemon
  setup and cleanup expectations.

## Verification

Run deterministic checks first:

```bash
git diff --check
./aos dev recommend --json --paths src/display/canvas.swift,src/display/protocol.swift,src/daemon/unified.swift,src/commands/operator.swift,scripts/aos-clean.mjs,tests/canvas-visible-surface-audit.sh,tests/ready-stale-daemon-hygiene.sh
```

If Swift, daemon, manifest, or CLI code changes, run the recommended build
command. At minimum:

```bash
./aos dev build
bash build.sh --no-restart
```

Run focused regression coverage:

```bash
bash tests/canvas-visible-surface-audit.sh
bash tests/canvas-owner-metadata.sh
bash tests/daemon-input-surface-ownership.sh
```

Also run stale-daemon or cross-process coverage. Prefer a deterministic
isolated-daemon test that starts a second AOS daemon/runtime with a visible
surface, audits from the active daemon, and proves that surface appears in the
external cross-process section. If a real second visible native window cannot
be synthesized reliably in CI, add the narrowest helper-level test for
classification and include a live-only smoke command for Foreman/Operator.

When live readiness is available, run this bounded smoke:

1. Clean existing canvases with `./aos show remove-all`.
2. Create one visible canvas in the active daemon.
3. Start or identify one external/stale AOS runtime that owns a visible native
   window, preferably using isolated test state rather than a real stale user
   window.
4. Run `./aos show audit --json --point x,y`.
5. Confirm current-daemon canvas rows still join correctly.
6. Confirm the external visible AOS native window is listed separately from
   current-daemon orphan rows.
7. Confirm the point winner identifies an external window if that external
   window is frontmost at the point, or reports an explicit unavailable reason.
8. Clean all surfaces and prove `./aos show list --json` is empty and
   `./aos clean --dry-run --json` is clean or explicitly explains unrelated
   leftovers.

If `./aos ready --post-permission` is blocked, report the exact readiness
blocker and keep deterministic evidence separate.

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- exact JSON fields added or changed;
- how external AOS native windows are discovered and classified;
- which fields are native truth, process truth, current-daemon registry
  metadata, or explicitly unavailable;
- whether `orphan_native_windows` retained its current-daemon meaning;
- whether point winner diagnostics include external windows;
- deterministic test commands and pass/fail results;
- live smoke result or readiness blocker;
- final cleanup result from `./aos show list --json`,
  `./aos status --json`, and `./aos clean --dry-run --json`;
- remaining recommended next slice: toolkit panel placement contract/final
  settled frame reporting, Sigil avatar avoidance, or refreshed live drag.

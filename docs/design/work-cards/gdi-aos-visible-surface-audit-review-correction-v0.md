# GDI Correction Card: AOS Visible Surface Audit Review Correction V0

## Recipient

GDI correction round.

## Branch / Base

- `branch_from`: `gdi/aos-visible-surface-orphan-audit-v0`
- `required_start_ref`: `e8a4326baba4193d198a54e7e81021683540f053`
- `expected_output_branch`: `gdi/aos-visible-surface-orphan-audit-v0`

Continue on the existing audit branch. Do not resume
`docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`; that
card remains paused.

## Source Artifact

Foreman review of `e8a4326b` found that the audit command works, but the branch
does not yet satisfy the visible-surface audit contract.

Positive evidence:

- `./aos show audit --json` returns a JSON audit payload.
- `bash tests/canvas-visible-surface-audit.sh` passed.
- `bash tests/canvas-owner-metadata.sh` passed.
- `bash tests/daemon-input-surface-ownership.sh` passed.
- `bash tests/display-debug-battery.sh` exited successfully; Foreman cleaned up
  the diagnostic canvases afterward.
- `./aos ready --json`, `./aos status --json`, and
  `./aos clean --dry-run --json` were clean after cleanup.

Acceptance failures:

1. `show audit` is externally routed but not discoverable in the canonical help
   registry.
   - `./aos show audit --json` works.
   - `./aos help show audit --json` returns `UNKNOWN_COMMAND`.
   - `./aos show --help` omits `show audit`.
   - `node --test tests/schemas/aos-external-command-manifest-v0.test.mjs`
     fails subtest `external-only routes are explicitly private helper paths`
     with: `show audit is externally routed but not discoverable in the
     registry`.
2. `orphan_native_windows` includes non-visible native windows.
   - Foreman live smoke saw an orphan entry with `on_screen=false` and
     `visible=false`.
   - The card requires visible orphan native AOS windows not represented in the
     registry. Non-visible unmatched native windows may be useful diagnostics,
     but they must not be mixed into the visible orphan bucket.
3. `requested_frame` is currently copied from `CanvasInfo.at`, and
   `CanvasInfo.at` is derived from the current native canvas frame. That does
   not prove requested-frame versus actual-native-frame divergence when AppKit
   placement, clamping, or retry behavior changes the native frame.
4. The audit currently filters native window-server truth to the current daemon
   PID. The original problem involved stale/duplicate visible surfaces across
   branch/worktree identities. If this slice intentionally remains scoped to
   the current daemon, the audit output and completion report must say that
   explicitly and route a follow-up. If the correction can safely include other
   visible AOS-owned process windows, do so with bounded tests.

## Fresh Context Contract

GDI starts from a fresh context window. Rediscover before editing. Preserve
unrelated untracked planning/report files.

## Goal

Correct the visible-surface audit so it is discoverable through the canonical
`./aos help` registry and its JSON buckets distinguish visible orphan native
windows, requested daemon frames, and actual native frames accurately enough for
Foreman to accept the audit slice.

## Read First

- `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`
- `manifests/commands/aos-commands.json`
- `manifests/commands/aos-external-commands.json`
- `scripts/aos-show-client.mjs`
- `scripts/aos-help-proxy.mjs`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`
- `tests/help-contract.sh`
- `tests/show-external-parser.sh`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `src/daemon/unified.swift`
- `tests/canvas-visible-surface-audit.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor e8a4326baba4193d198a54e7e81021683540f053 HEAD; echo "audit_head_ancestor=$?"
./aos ready --json
./aos show audit --json
./aos help show audit --json || true
./aos show --help | rg -n "audit|show audit" || true
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If live readiness reports a TCC/input-tap blocker, do not start a reset loop.
Report the exact blocker. The last Foreman check had `ready=true`.

## Required Corrections

### 1. Register `show audit` In Canonical Help

- Add the `show audit` form to `manifests/commands/aos-commands.json` or the
  repo's current generated/help registry source of truth.
- `./aos help show audit --json` must return the command form, including
  `--json` and optional `--point`.
- `./aos show --help` must list `./aos show audit`.
- Keep the external route in `manifests/commands/aos-external-commands.json`.
- Add focused coverage or rely on the existing schema/help tests if they fail
  before the fix and pass after it.

### 2. Keep Visible Orphans Visible

- `orphan_native_windows` must contain only visible/on-screen AOS native windows
  that are not joined to the registry.
- If unmatched non-visible daemon windows are diagnostically useful, put them
  under a separately named bucket such as `unmatched_native_windows` or
  `non_visible_unmatched_native_windows`.
- Update `tests/canvas-visible-surface-audit.sh` or add a focused assertion so
  non-visible native windows cannot appear in `orphan_native_windows`.

### 3. Separate Requested Frame From Actual Native Frame

- Expose the daemon-requested canvas frame separately from actual native
  window-server frame.
- Do not set `requested_frame` to a value that is merely a copy of current
  `CanvasInfo.at` if `CanvasInfo.at` is actual/current frame.
- Prefer a field that reflects the canvas's last requested/desired CG frame.
  If the current abstractions cannot expose that safely, add an explicit
  `requested_frame_unavailable_reason` and route the smallest follow-up needed.
- Keep `actual_native_windows[].actual_frame` as native window-server truth.

### 4. State Cross-Process Scope Explicitly

- Decide whether this correction can safely include visible AOS windows owned
  by other `aos` daemon/runtime processes.
- If yes, include those native windows in the audit with process identity
  fields such as owner PID/name and executable path when available.
- If no, keep the implementation current-daemon scoped but add an explicit
  `runtime.native_window_scope` or equivalent field and a completion-report
  follow-up for cross-process/stale-worktree visible windows. Do not let the
  output imply it proves every visible AOS window across all worktrees when it
  only scans the current daemon PID.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json --paths src/display/canvas.swift,src/display/protocol.swift,src/daemon/unified.swift,src/commands/operator.swift,src/main.swift,manifests/commands/aos-commands.json,manifests/commands/aos-external-commands.json,scripts/aos-show-client.mjs
./aos dev build
bash build.sh --no-restart
./aos show audit --json
./aos help show audit --json
./aos show --help | rg -n "audit|show audit"
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
bash tests/runtime-external-commands.sh
bash tests/show-external-parser.sh
bash tests/canvas-visible-surface-audit.sh
bash tests/canvas-owner-metadata.sh
bash tests/daemon-input-surface-ownership.sh
```

When `./aos ready --json` is clean, run one bounded live smoke:

```bash
./aos show remove-all
./aos show create --id foreman-audit-smoke-a --at 80,90,180,120 --interactive --window-level floating --html '<!doctype html><html><body>A</body></html>'
./aos show create --id foreman-audit-smoke-b --at 300,90,180,120 --interactive --window-level floating --html '<!doctype html><html><body>B</body></html>'
./aos show audit --json --point 90,100
./aos show remove-all
./aos show list --json
```

The live smoke must show `orphan_native_windows` contains no entries with
`visible=false` or `on_screen=false`.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- exact `show audit` help registry shape;
- before/after result for the schema failure;
- orphan bucket semantics and test evidence;
- requested-frame versus actual-native-frame semantics;
- explicit cross-process scope decision and follow-up if any;
- deterministic and live verification command results;
- final `./aos ready --json`, `./aos status --json`,
  `./aos clean --dry-run --json`, and `./aos show list --json`.

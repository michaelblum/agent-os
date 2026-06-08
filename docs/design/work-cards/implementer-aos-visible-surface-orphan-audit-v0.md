# Implementer Work Card: AOS Visible Surface Orphan Audit V0

## Recipient

Implementer implementation round.

## Branch / Base

- `branch_from`: `implementer/radial-compact-snapshot-extraction-integration-v0`
- `required_start_ref`: `7d8e593a4353a685a35e6a21f163475c0f72a32d`
- `expected_output_branch`: `implementer/aos-visible-surface-orphan-audit-v0`

Do not restart from `origin/main`. This card depends on the accepted
`21dc331d` action bus / detached Avatar panel implementation and the
`7d8e593a` Foreman routing-alignment checkpoint.

## Source Artifact

Human-visible evidence during live panel-drag testing showed two Avatar/Sigil
control surfaces visible at the same time across displays:

- main display: new panel-backed Avatar controls with panel chrome/container;
- extended display: older compact Avatar/Sigil controls surface without the
  panel container.

AOS reported expected registered state for the active panel, but that was not
enough to prove there were no lingering or orphan visible windows still
participating in input. Earlier cleanup also found live interactive Sigil
canvases still registered, including a `screen_saver` level hit surface.

The current live-drag correction card is paused until AOS can audit what a
human can see:

```text
docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md
```

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Add an AOS-first visible-surface/orphan audit that joins daemon canvas registry
state with native window-server truth so agents can detect duplicate, stale, or
orphan AOS-visible surfaces before live input tests.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `src/daemon/unified.swift`
- `src/commands/operator.swift`
- `src/main.swift`
- `tests/canvas-window-placement.sh`
- `tests/canvas-owner-metadata.sh`
- `tests/daemon-input-surface-ownership.sh`
- `tests/display-debug-battery.sh`
- `docs/design/worktree-session-scope.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 7d8e593a4353a685a35e6a21f163475c0f72a32d HEAD; echo "routing_checkpoint_ancestor=$?"
./aos show list --json
./aos see list
./aos show --help
./aos see --help
./aos dev recommend --json --paths src/display/canvas.swift,src/display/protocol.swift,src/daemon/unified.swift,src/commands/operator.swift,src/main.swift
rg -n "CGWindowListCopyWindowInfo|windowNumbers|toInfo|diagnosticsSnapshot|CanvasInfo|owner|worktree|contentRoot|windowLevel|input_surface|hit" src tests
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

Important: `ready=true` is not visual-surface exclusivity proof. It only proves
the daemon/runtime/input-tap readiness checks represented by that command.

## Required Behavior

### AOS-First Audit Command

Add or extend an `./aos` command so an agent can request a read-only JSON audit
of visible AOS surfaces. Prefer the smallest command shape consistent with the
existing CLI taxonomy, for example `./aos show audit --json` if `show` remains
the canvas/window surface area after rediscovery.

The audit must be available before running live drag or pointer actions. It
must not require raw daemon HTTP, direct state-file inspection, ad-hoc Quartz
scripts, or `tmux` as the primary user-facing proof.

### Native Truth Joined With Registry Truth

The JSON output must expose, at minimum:

- all registered AOS canvases with their logical canvas id, URL/content source,
  owner metadata, parent/cascade metadata when available, lifecycle state,
  suspended state, interactive flag, and daemon-requested frame;
- native window-server entries owned by the daemon/runtime process that
  correspond to AOS canvases, including actual native frame, window number,
  window level, visibility/on-screen state, display relationship when known,
  focus/key ordering when available, and whether the window is interactive;
- a join key or explanation for how registered canvases map to native windows;
- `orphan_native_windows`: visible native AOS windows not represented by the
  daemon canvas registry;
- `registered_without_native_window`: registry entries missing a corresponding
  visible native window when one should exist;
- `duplicate_logical_surfaces`: repeated logical/semantic surfaces, such as two
  visible Avatar controls surfaces, across displays or content roots;
- requested frame versus actual native frame so clamping, auto-repositioning,
  and stale frame bookkeeping can be diagnosed;
- branch, worktree, scoped root, content root, or URL provenance wherever the
  current daemon/canvas metadata already exposes it.

If one of these fields cannot be supported from existing daemon/native
information, implement the narrowest missing metadata path or clearly mark the
field as unavailable with a reason in the audit output. Do not fake native
truth from registry data.

### Input Target Winner

Expose the input target winner at a point if an existing daemon input router or
hit-test path can answer it safely. The output should say which visible surface
would receive input at a requested point and why, including window level or
input-region evidence when available.

If the current code cannot answer this without a larger input-router change,
leave a small explicit follow-up in the completion report and keep this audit
slice focused on visible-surface/orphan truth.

### Ownership Boundary

Keep this slice observability-only:

- daemon/kernel owns native truth, display/window lifecycle observability,
  actual window frames, window levels, focus/interactivity, orphan detection,
  and input-routing diagnostics;
- toolkit owns reusable panel placement policy in later work;
- Sigil owns Avatar semantics and any avatar-versus-panel avoidance in later
  work.

Do not implement layout policy, panel clamping, avatar movement, or drag
correction in this audit slice.

## Hard Boundaries / Non-Goals

- Do not resume
  `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md` in this
  round.
- Do not implement toolkit panel placement overflow policy in this round.
- Do not move the Sigil avatar, change Avatar controls UI, or migrate
  `sigil.avatar_panel.*` in this round.
- Do not make `./aos ready` destructive or broaden it into surface
  exclusivity. This audit is a separate observable proof.
- Do not use raw daemon HTTP, direct state-file probing, `tmux`, or ad-hoc
  Quartz scripts as the primary interface for the accepted behavior.
- Do not mutate unrelated work cards, reports, or generated proof artifacts.

## Verification

Run deterministic checks first:

```bash
git diff --check
./aos dev recommend --json --paths src/display/canvas.swift,src/display/protocol.swift,src/daemon/unified.swift,src/commands/operator.swift,src/main.swift
```

If Swift, daemon, or CLI code changes, run the recommended build command. At
minimum:

```bash
bash build.sh --no-restart
```

Add or update focused tests proving the audit contract. Prefer extending the
existing shell-test style around daemon/canvas behavior:

```bash
bash tests/canvas-window-placement.sh
bash tests/canvas-owner-metadata.sh
bash tests/daemon-input-surface-ownership.sh
```

The new or updated test coverage should prove:

- the audit output includes registered canvas metadata and native window frame
  metadata for a visible AOS canvas;
- requested and actual/native frames are both present;
- owner/worktree/content-root provenance is preserved where available;
- window level, focus/key/interactivity, and visibility fields are present or
  explicitly unavailable with a reason;
- a native AOS window that cannot be joined to the registry is reported as an
  orphan, or the test documents why the repo cannot synthesize that condition
  without a lower-level fixture;
- a registry entry missing native window truth is reported or explicitly
  diagnosed;
- duplicate logical surfaces are detectable by stable canvas/logical surface
  metadata.

When live readiness is available, run one bounded smoke that creates two AOS
surfaces, runs the audit, confirms they appear with native truth, then removes
them and confirms cleanup. If `./aos ready --post-permission` is blocked,
report the exact readiness blocker and keep deterministic evidence separate.

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- exact audit command and JSON shape added;
- how registry/native joining works;
- which fields are real native truth versus registry metadata;
- orphan and missing-native detection behavior;
- duplicate logical-surface detection behavior;
- whether input-target-winner diagnostics were implemented or deferred;
- deterministic test commands and pass/fail results;
- `./aos ready --post-permission` result if checked;
- final cleanup result from `./aos show list --json`;
- recommended next slice: toolkit panel placement contract/final-frame
  reporting, Sigil avatar avoidance, or refreshed live-drag correction.

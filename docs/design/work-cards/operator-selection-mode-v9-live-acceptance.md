# Operator Selection Mode V9 Live Acceptance

## Recipient

Operator.

## Transfer Kind

Operator run: supervised live/HITL evidence collection.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, daemon,
canvas, display topology, pointer state, screenshots, or prior live setup.
Rediscover before touching the live surface.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `24eb2ac912d4ff0a0801a47b9da5f12cff16259e`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Latest correction card:
  `docs/design/work-cards/selection-mode-render-only-pointer-correction-v9.md`

## Single Goal

Collect bounded live evidence that the V9 branch is usable in real Selection
Mode:

- Primary HITL double-click enters Selection Mode.
- Primary HITL click on a visible `Save` semantic button acquires the semantic
  button, not only the containing canvas.
- The cursor is the shared-scene Three.js `sigil_model`, not a 2D drawn cursor.
- Pointer movement feels responsive and does not obviously stutter.
- Debug snapshot reads do not mutate cursor model update counters.
- Escape exits Selection Mode, unregisters the Selection Mode input region, and
  cleanup leaves no stale purple avatar/cursor dot.

## Branch / Base

- `required_start_ref`: `24eb2ac912d4ff0a0801a47b9da5f12cff16259e`
- Work surface: local branch `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Do not implement, edit source, commit, push, open or update PRs, or mutate
  GitHub state.
- Store evidence under `/tmp/aos-pr392-selection-mode-v9`.

## Rediscover State

Run from `/Users/Michael/Code/agent-os`:

```bash
mkdir -p /tmp/aos-pr392-selection-mode-v9
git status --short --branch | tee /tmp/aos-pr392-selection-mode-v9/00-git-status.txt
git rev-parse --abbrev-ref HEAD | tee /tmp/aos-pr392-selection-mode-v9/00-branch.txt
git rev-parse HEAD | tee /tmp/aos-pr392-selection-mode-v9/00-head.txt
./aos ready --json | tee /tmp/aos-pr392-selection-mode-v9/00-ready.json
./aos status | tee /tmp/aos-pr392-selection-mode-v9/00-aos-status.txt
```

Stop with `human_needed` if the branch or HEAD is not the required branch/ref.

Stop with `human_needed` if `./aos ready --json` reports Accessibility, Input
Monitoring, inactive input-tap, or other live input/capture blockers. Do not
bypass AOS with raw `curl`, `tmux`, direct daemon state files, or lower-level
PTY control.

## Setup

Use AOS as the control plane:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos content wait --root toolkit --auto-start --timeout 15s
./aos content wait --root sigil --auto-start --timeout 15s
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --track union --ttl none
./aos show wait --id avatar-main --js '!!window.__sigilDebug?.snapshot && window.__sigilBootError == null' --timeout 10s --json \
  | tee /tmp/aos-pr392-selection-mode-v9/01-avatar-wait.json
./aos show list | tee /tmp/aos-pr392-selection-mode-v9/01-show-list-before.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v9/01-sigil-snapshot-before.json
```

If Sigil boot fails because repo content has not been seeded, run
`apps/sigil/sigilctl-seed.sh --mode repo` once, then repeat the setup. Stop if
the renderer is blank or `window.__sigilBootError` is non-null after one seed
retry.

## Live Target

Create one temporary target canvas on the main display and register a
canvas-local semantic button target:

```bash
TARGET_FRAME=$(./aos show eval --id avatar-main --js '(() => { const displays = window.liveJs?.displays || []; const d = displays.find((entry) => entry.is_main) || displays[0] || {}; const b = d.visible_bounds || d.bounds || { x: 0, y: 40, w: 1200, h: 800 }; return `${Math.round((b.x || 0) + 160)},${Math.round((b.y || 0) + 140)},360,260`; })()' | tr -d '"')
./aos show create --id selection-mode-live-target --at "$TARGET_FRAME" --html '<div style="width:100%;height:100%;background:#f7f9fb;border:2px solid #1f2937;box-sizing:border-box;font:14px system-ui;color:#111827"><button style="position:absolute;left:24px;top:36px;width:90px;height:44px">Save</button><div style="position:absolute;left:24px;top:104px">Selection Mode live target</div></div>' --interactive --ttl none --focus
./aos show wait --id selection-mode-live-target --timeout 5s --json \
  | tee /tmp/aos-pr392-selection-mode-v9/02-target-wait.json
./aos show post --id avatar-main --event '{"type":"canvas_inspector.semantic_targets","payload":{"canvas_id":"selection-mode-live-target","semantic_targets":[{"id":"selection-mode-live-save-button","label":"Save","role":"button","kind":"button","rect":{"x":24,"y":36,"w":90,"h":44},"coordinate_space":"canvas_local"}]}}'
./aos show eval --id avatar-main --js '(() => { const values = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; return JSON.stringify(values.filter((candidate) => String(candidate.id || candidate.subject_id || "").includes("selection-mode-live")), null, 2); })()' \
  > /tmp/aos-pr392-selection-mode-v9/02-target-candidates.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v9/02-live-target-before.png
```

If `02-target-candidates.json` does not include both
`selection-mode-live-target` and `selection-mode-live-save-button`, stop and
report the candidate cache state.

## Primary HITL Check

Use the live surface first:

1. Bring `avatar-main` to front with `./aos show to-front --id avatar-main`.
2. Double-click the Sigil avatar to enter Selection Mode.
3. Move naturally over the visible `Save` button.
4. Click once to acquire the target.
5. Capture evidence:

```bash
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v9/03-selection-mode-acquired.png
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v9/03-sigil-snapshot-acquired.json
./aos show eval --id avatar-main --js '(() => { const a = window.__sigilDebug.snapshot()?.selectionModeCursorModel?.resource_counts?.update_count; const b = window.__sigilDebug.snapshot()?.selectionModeCursorModel?.resource_counts?.update_count; return JSON.stringify({ before: a, after: b, snapshotReadChangedUpdateCount: a !== b }, null, 2); })()' \
  > /tmp/aos-pr392-selection-mode-v9/03-snapshot-read-update-count.json
```

Expected:

- acquired path includes `selection-mode-live-save-button`;
- badges/frames align to the visible button and target canvas;
- `selectionModeCursorModel.visible === true`;
- `selectionModeCursorModel.model_kind === "sigil_model"`;
- `selectionModeCursorModel.hotspot_aligned === true`;
- no 2D cursor glyph is visible;
- Selection Mode input region is registered while active;
- pointer movement is not visibly choppy.

## Bounded Debug-API Fallback

If primary HITL cannot acquire the semantic button after two attempts, use one
debug-API fallback and label it as fallback evidence:

```bash
./aos show eval --id avatar-main --js '(() => { const candidates = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; const target = candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-live-save-button") || candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-live-target"); const rect = target?.projection?.visible_display_rect || target?.projection?.display_space_rect; if (!rect) return JSON.stringify({ ok: false, reason: "target_rect_missing", target }); const w = Number(rect.w ?? rect.width); const h = Number(rect.h ?? rect.height); const p = { x: Math.round(Number(rect.x) + w / 2), y: Math.round(Number(rect.y) + h / 2), valid: true }; window.__sigilDebug.enterSelectionMode(p); window.__sigilDebug.dispatchDesktop({ type: "left_mouse_up", x: p.x, y: p.y }); const snapshot = window.__sigilDebug.snapshot(); return JSON.stringify({ ok: true, point: p, target, selectionMode: snapshot.selectionMode, selectionModeOverlay: snapshot.selectionModeOverlay, selectionModeCursorModel: snapshot.selectionModeCursorModel, inputRegions: snapshot.inputRegions }, null, 2); })()' \
  > /tmp/aos-pr392-selection-mode-v9/03-debug-fallback-acquire.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v9/03-debug-fallback-acquired.png
```

Do not attempt more than one fallback run.

## Exit And Cleanup Check

Exit with Escape from the live surface. If Escape is not captured, use
`window.__sigilDebug.cancelSelectionMode("operator-exit")` and label that as a
fallback.

Then collect:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v9/04-sigil-snapshot-after-exit.json
./aos show remove --id selection-mode-live-target
./aos show eval --id avatar-main --js 'window.__sigilDebug?.dispatch?.({ type: "status_item.hide", source: "operator-v9-cleanup" }); JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v9/05-sigil-snapshot-after-hide.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v9/05-after-cleanup.png
./aos show list | tee /tmp/aos-pr392-selection-mode-v9/05-show-list-after.json
```

Expected after cleanup:

- `selectionMode.active === false`;
- `inputRegions.regions.selectionMode.registered === false`;
- `selectionModeOverlay.visible !== true`;
- `selectionModeCursorModel.visible !== true`;
- `selection-mode-live-target` is removed;
- no stale purple Sigil avatar/cursor dot remains on the visible display.

## Required Evidence

Return:

- whether branch and HEAD matched the required ref;
- whether `./aos ready --json` passed;
- exact screenshot and JSON evidence paths;
- whether evidence came from primary HITL input or the debug-API fallback;
- acquired target path and whether it includes the semantic Save button;
- concise observations for projection alignment, cursor model state, badge
  order/alignment, pointer smoothness, snapshot read update-count stability,
  Escape exit, input-region cleanup, and stale-dot cleanup;
- any blocker or divergence, with the relevant JSON file path.

## Stop Conditions

Stop and report instead of improvising if:

- AOS readiness or capture/input permission fails;
- branch or HEAD is not the required ref;
- Sigil boot remains blank or boot-error after one seed retry;
- target candidates do not enter Sigil's candidate cache;
- Selection Mode cannot be entered after two HITL attempts and one debug-API
  fallback;
- cleanup leaves a stale visible cursor/avatar dot.

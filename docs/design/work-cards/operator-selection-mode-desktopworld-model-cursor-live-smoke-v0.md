# Operator Selection Mode DesktopWorld Model Cursor Live Smoke V0

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
- Required reviewed head: `749bbb0ee1ceab0407004a1185db6cbfc6b29a7d`
- Base: `0ad72ead315d0052a1154fbb09e58e7c3893e672`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction cards:
  - `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v5.md`
  - `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v6.md`

## Single Goal

Collect bounded live evidence that Sigil Selection Mode still works on the live
AOS canvas after the DesktopWorld projection and Three.js model cursor
corrections:

- Selection Mode enters from the live Sigil avatar.
- A target canvas and canvas-local semantic target project to the same
  DesktopWorld location as their visual surface.
- The Selection Mode cursor is the `sigil_model` Three.js cursor, visible only
  when the cursor projects.
- Ancestor badges and frames line up with the clicked target path.
- Escape exits Selection Mode and unregisters the Selection Mode input region.

## Branch / Base

- `required_start_ref`: `749bbb0ee1ceab0407004a1185db6cbfc6b29a7d`
- Work surface: local branch `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Do not implement, edit source, commit, push, open or update PRs, or mutate
  GitHub state.
- You may create temporary evidence under `/tmp/aos-pr392-selection-mode-v6`.

## Rediscover State

Run from `/Users/Michael/Code/agent-os`:

```bash
mkdir -p /tmp/aos-pr392-selection-mode-v6
git status --short --branch | tee /tmp/aos-pr392-selection-mode-v6/00-git-status.txt
git rev-parse --abbrev-ref HEAD | tee /tmp/aos-pr392-selection-mode-v6/00-branch.txt
git rev-parse HEAD | tee /tmp/aos-pr392-selection-mode-v6/00-head.txt
./aos ready --json | tee /tmp/aos-pr392-selection-mode-v6/00-ready.json
./aos status | tee /tmp/aos-pr392-selection-mode-v6/00-aos-status.txt
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
  | tee /tmp/aos-pr392-selection-mode-v6/01-avatar-wait.json
./aos show list | tee /tmp/aos-pr392-selection-mode-v6/01-show-list-before.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v6/01-sigil-snapshot-before.json
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
  | tee /tmp/aos-pr392-selection-mode-v6/02-target-wait.json
./aos show post --id avatar-main --event '{"type":"canvas_inspector.semantic_targets","payload":{"canvas_id":"selection-mode-live-target","semantic_targets":[{"id":"selection-mode-live-save-button","label":"Save","role":"button","kind":"button","rect":{"x":24,"y":36,"w":90,"h":44},"coordinate_space":"canvas_local"}]}}'
./aos show eval --id avatar-main --js '(() => { const values = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; return JSON.stringify(values.filter((candidate) => String(candidate.id || candidate.subject_id || "").includes("selection-mode-live")), null, 2); })()' \
  > /tmp/aos-pr392-selection-mode-v6/02-target-candidates.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v6/02-live-target-before.png
```

If `02-target-candidates.json` does not include both
`selection-mode-live-target` and `selection-mode-live-save-button`, stop and
report the candidate cache state.

## Primary HITL Check

Use the live surface first:

1. Bring `avatar-main` to front with `./aos show to-front --id avatar-main`.
2. Double-click the Sigil avatar to enter Selection Mode.
3. Move to the visible `Save` button in `selection-mode-live-target`.
4. Click once to acquire the target.
5. Capture evidence:

```bash
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v6/03-selection-mode-acquired.png
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v6/03-sigil-snapshot-acquired.json
```

The screenshot and snapshot should show a live Selection Mode overlay, the
Three.js model cursor, badges/frame geometry aligned to the target canvas and
button, and a registered Selection Mode input region with
`cursor_suppression_owner: "selection_mode"`.

## Bounded Debug-API Fallback

If manual input cannot reliably acquire the target after two attempts, use one
debug-API fallback and label it as fallback evidence in the report:

```bash
./aos show eval --id avatar-main --js '(() => { const candidates = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; const target = candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-live-save-button") || candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-live-target"); const rect = target?.projection?.visible_display_rect || target?.projection?.display_space_rect; if (!rect) return JSON.stringify({ ok: false, reason: "target_rect_missing", target }); const w = Number(rect.w ?? rect.width); const h = Number(rect.h ?? rect.height); const p = { x: Math.round(Number(rect.x) + w / 2), y: Math.round(Number(rect.y) + h / 2), valid: true }; window.__sigilDebug.enterSelectionMode(p); window.__sigilDebug.dispatchDesktop({ type: "left_mouse_up", x: p.x, y: p.y }); const snapshot = window.__sigilDebug.snapshot(); return JSON.stringify({ ok: true, point: p, target, selectionMode: snapshot.selectionMode, selectionModeOverlay: snapshot.selectionModeOverlay, selectionModeCursorModel: snapshot.selectionModeCursorModel, inputRegions: snapshot.inputRegions }, null, 2); })()' \
  > /tmp/aos-pr392-selection-mode-v6/03-debug-fallback-acquire.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-mode-v6/03-debug-fallback-acquired.png
```

Do not attempt more than one fallback run.

## Exit Check

Exit with Escape from the live surface. If Escape is not captured, use
`window.__sigilDebug.cancelSelectionMode("operator-exit")` and label that as a
fallback in the report.

Then collect:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot())' \
  > /tmp/aos-pr392-selection-mode-v6/04-sigil-snapshot-after-exit.json
./aos show list | tee /tmp/aos-pr392-selection-mode-v6/04-show-list-after.json
```

Expected after exit: `selectionMode.active === false` and
`inputRegions.regions.selectionMode.registered === false`.

## Cleanup

Remove only the temporary target canvas:

```bash
./aos show remove --id selection-mode-live-target
```

Leave `avatar-main` alone unless it was clearly created only for this run and no
other live work is using it.

## Required Evidence

Return:

- whether branch and HEAD matched the required ref;
- whether `./aos ready --json` passed;
- exact screenshot paths collected;
- whether evidence came from primary HITL input or the debug-API fallback;
- concise observations for:
  - Selection Mode entry;
  - target canvas and semantic button candidate projection;
  - cursor model `visible`, `model_kind`, `hotspot_aligned`, and
    `blocker_reason`;
  - badge/frame alignment and leaf-to-root badge order;
  - Selection Mode input region registration and cursor suppression metadata;
  - Escape exit and input-region cleanup;
- any blocker or divergence, with the relevant JSON file path.

## Stop Conditions

Stop and report instead of improvising if:

- AOS readiness or capture/input permission fails;
- branch or HEAD is not the required ref;
- Sigil boot remains blank or boot-error after one seed retry;
- target candidates do not enter Sigil's candidate cache;
- Selection Mode cannot be entered after two HITL attempts and one debug-API
  fallback;
- the live result shows a stale visible cursor after an invalid or blocked
  projection.

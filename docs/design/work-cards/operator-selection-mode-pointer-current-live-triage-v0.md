# Operator Selection Mode Pointer Current Live Triage V0

## Recipient

Operator.

## Transfer Kind

Operator run: supervised live/HITL evidence collection.

## Source Artifact

- Branch family: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required start ref: `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Relevant prior cards:
  - `docs/design/work-cards/selection-mode-render-only-pointer-correction-v9.md`
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`

## Single Goal

Capture bounded live evidence for the current remaining Selection Mode pointer
issue before routing the next GDI correction.

Classify the observed issue into one or more concrete buckets:

- visual inheritance: pointer does not look like the current avatar/effects;
- hotspot/alignment: pointer apex is not at the actual cursor coordinates;
- responsiveness: pointer movement visibly stutters or lags;
- projection/targeting: badges/frames/acquired target do not match the visible
  semantic target;
- cleanup: exit/hide leaves a stale avatar/cursor dot or stale visible object.

## Branch / Base

- Work surface: local repo at `/Users/Michael/Code/agent-os`.
- Start from exact ref `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`.
- This is evidence-only. Do not edit source, commit, push, open/update PRs, or
  mutate GitHub state.
- Evidence directory: `/tmp/aos-pr392-selection-pointer-current-triage-v0`.

If the repo has tracked dirty state that would make checkout unsafe, stop with
`human_needed` and include `git status --short --branch`.

## Rediscover State

Run:

```bash
mkdir -p /tmp/aos-pr392-selection-pointer-current-triage-v0
git status --short --branch | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/00-status-before.txt
git switch gdi/selection-mode-cursor-ancestor-ladder-v0
git checkout ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b
git status --short --branch | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/00-status.txt
git rev-parse HEAD | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/00-head.txt
./aos ready --json | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/00-ready.json
./aos status | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/00-aos-status.txt
```

If `./aos ready --json` reports Accessibility, Input Monitoring, inactive
input-tap, or other live input/capture blockers, stop with `human_needed` and
include the ready JSON. Do not bypass AOS with raw daemon/socket/tmux control.

## Setup

Use AOS as the control plane:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos content wait --root toolkit --auto-start --timeout 15s
./aos content wait --root sigil --auto-start --timeout 15s
./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --track union --ttl none
./aos show wait --id avatar-main --js '!!window.__sigilDebug?.snapshot && window.__sigilBootError == null' --timeout 10s --json \
  | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/01-avatar-wait.json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot(), null, 2)' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/01-snapshot-before.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-pointer-current-triage-v0/01-before.png
```

If Sigil boot fails because repo content has not been seeded, run
`apps/sigil/sigilctl-seed.sh --mode repo` once, then repeat setup. Stop if boot
still fails.

## Live Target

Create a temporary target canvas and register a semantic button:

```bash
TARGET_FRAME=$(./aos show eval --id avatar-main --js '(() => { const displays = window.liveJs?.displays || []; const d = displays.find((entry) => entry.is_main) || displays[0] || {}; const b = d.visible_bounds || d.bounds || { x: 0, y: 40, w: 1200, h: 800 }; return `${Math.round((b.x || 0) + 160)},${Math.round((b.y || 0) + 140)},360,260`; })()' | tr -d '"')
./aos show create --id selection-mode-pointer-triage-target --at "$TARGET_FRAME" --html '<div style="width:100%;height:100%;background:#f7f9fb;border:2px solid #1f2937;box-sizing:border-box;font:14px system-ui;color:#111827"><button style="position:absolute;left:24px;top:36px;width:90px;height:44px">Save</button><div style="position:absolute;left:24px;top:104px">Selection Mode pointer triage</div></div>' --interactive --ttl none --focus
./aos show wait --id selection-mode-pointer-triage-target --timeout 5s --json \
  | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/02-target-wait.json
./aos show post --id avatar-main --event '{"type":"canvas_inspector.semantic_targets","payload":{"canvas_id":"selection-mode-pointer-triage-target","semantic_targets":[{"id":"selection-mode-pointer-triage-save-button","label":"Save","role":"button","kind":"button","rect":{"x":24,"y":36,"w":90,"h":44},"coordinate_space":"canvas_local"}]}}'
./aos show eval --id avatar-main --js '(() => { const values = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; return JSON.stringify(values.filter((candidate) => String(candidate.id || candidate.subject_id || "").includes("selection-mode-pointer-triage")), null, 2); })()' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/02-target-candidates.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-pointer-current-triage-v0/02-target-before-selection.png
```

Stop if `02-target-candidates.json` does not include both the target canvas and
the Save button.

## Primary HITL Pass

Use the live surface first:

1. Bring `avatar-main` to front with `./aos show to-front --id avatar-main`.
2. Double-click the Sigil avatar to enter Selection Mode.
3. Move naturally around the target, including slow movement and a quick move.
4. Move over the visible `Save` button.
5. Click once to acquire the target.
6. Capture:

```bash
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-pointer-current-triage-v0/03-active-acquired.png
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot(), null, 2)' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/03-snapshot-active-acquired.json
./aos show eval --id avatar-main --js '(() => { const a = window.__sigilDebug.snapshot()?.selectionModeCursorModel?.resource_counts?.update_count; const b = window.__sigilDebug.snapshot()?.selectionModeCursorModel?.resource_counts?.update_count; return JSON.stringify({ before: a, after: b, snapshotReadChangedUpdateCount: a !== b }, null, 2); })()' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/03-snapshot-read-update-count.json
```

Record human observations in the completion report, especially whether the
pointer looks wrong, is misplaced, stutters, acquires the wrong target, or
leaves stale pixels.

## Debug Fallback

If manual entry/acquire fails after two attempts, use exactly one debug fallback
and label it as fallback evidence:

```bash
./aos show eval --id avatar-main --js '(() => { const candidates = [...(window.liveJs?.annotationReticleTargetEvidence?.candidates?.values?.() || [])]; const target = candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-pointer-triage-save-button") || candidates.find((candidate) => String(candidate.id || candidate.subject_id || "") === "selection-mode-pointer-triage-target"); const rect = target?.projection?.visible_display_rect || target?.projection?.display_space_rect; if (!rect) return JSON.stringify({ ok: false, reason: "target_rect_missing", target }, null, 2); const w = Number(rect.w ?? rect.width); const h = Number(rect.h ?? rect.height); const p = { x: Math.round(Number(rect.x) + w / 2), y: Math.round(Number(rect.y) + h / 2), valid: true }; window.__sigilDebug.enterSelectionMode(p); window.__sigilDebug.dispatchDesktop({ type: "left_mouse_up", x: p.x, y: p.y }); return JSON.stringify({ ok: true, point: p, target, snapshot: window.__sigilDebug.snapshot() }, null, 2); })()' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/03-debug-fallback-acquire.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-pointer-current-triage-v0/03-debug-fallback-acquired.png
```

Do not attempt additional fallback runs.

## Exit And Cleanup

Exit with Escape from the live surface. If Escape is not captured, use
`window.__sigilDebug.cancelSelectionMode("operator-triage-exit")` and label it
as fallback.

Then run:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.snapshot(), null, 2)' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/04-snapshot-after-exit.json
./aos show remove --id selection-mode-pointer-triage-target
./aos show eval --id avatar-main --js 'window.__sigilDebug?.dispatch?.({ type: "status_item.hide", source: "operator-pointer-triage-cleanup" }); JSON.stringify(window.__sigilDebug.snapshot(), null, 2)' \
  > /tmp/aos-pr392-selection-pointer-current-triage-v0/05-snapshot-after-hide.json
./aos see capture main --perception --show-cursor --highlight-cursor \
  --out /tmp/aos-pr392-selection-pointer-current-triage-v0/05-after-cleanup.png
./aos show list | tee /tmp/aos-pr392-selection-pointer-current-triage-v0/05-show-list-after.txt
```

## Required Evidence

Return:

- branch/head tested and whether it matched `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`;
- whether `./aos ready --json` passed;
- exact screenshot and JSON evidence paths;
- whether evidence was primary HITL or debug fallback;
- issue classification bucket(s): visual inheritance, hotspot/alignment,
  responsiveness, projection/targeting, cleanup;
- observed pointer visual mismatch, if any;
- observed hotspot/apex mismatch, if any;
- observed stutter/lag, if any;
- acquired target path and whether it includes the semantic Save button;
- `selectionModeCursorModel.visible`, `model_kind`, `hotspot_aligned`, and
  resource/update-count observations from the snapshot;
- exit and cleanup result, including whether any stale dot remains;
- recommendation for next GDI correction, scoped to the evidence.

## Stop Conditions

Stop and report instead of improvising if:

- checkout to the required ref is unsafe;
- AOS readiness/capture/input permission fails;
- Sigil boot remains blank or boot-error after one seed retry;
- target candidates do not enter Sigil's candidate cache;
- Selection Mode cannot be entered after two HITL attempts and one debug
  fallback;
- cleanup leaves a visible stale cursor/avatar object.

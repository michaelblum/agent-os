# Sigil Foundation — Agent Documents and Global Canvas

**Status:** draft
**Date:** 2026-04-12
**Layer:** Sigil (application)
**Depends on:** `2026-04-12-aos-wiki-writes-and-namespaces.md` (platform: wiki writes, change events, seed helper, `sigil/` namespace)

## Purpose

Sigil-1 shipped a working avatar state machine with several encoded assumptions that must be unwound before Sigil-2 (menu slices, beam, stellation) builds on top. This spec consolidates four open issues plus one topology change into a single foundation pass:

- **#29** — the drawing canvas doesn't span multiple displays, so the orb strands on the main display while the hit-area follows the cursor across displays.
- **#25** — IDLE state follows the cursor; the intended default is parked.
- **#26** — avatar spawn position is implicit; needs to be configurable and deterministic.
- **#28** — fast-travel ghost trails are hard-coded; should be configurable.
- **#20** — avatar configuration is not live-reloaded.

Rather than sprawl a flat `avatar-config.json`, Sigil adopts a cleaner model: each avatar is an **agent document** living as a wiki page under the `sigil/agents/` namespace. One document per agent, self-contained, cloneable by copy.

## Non-goals

- **Studio UX rework.** Save-button redesign, roster view, clone UX, random-variant flyout — deferred to a follow-on spec. This spec only wires Studio's save to persist the full agent document via the AOS write API.
- **Multi-agent scene.** Orchestrator-plus-subagents is accommodated by the global canvas topology but not implemented here. Single active agent today.
- **Per-agent skills enforcement.** Agent documents carry `minds` references, but the renderer does not act on them beyond storage. The runtime that enforces mind composition is separate.
- **Procedural / seed-based appearance generation.** Seeds are a future variant-generation tool, not a storage format.

## Model

### An agent is a wiki page

Agent documents live at `sigil/agents/<id>.md` in the wiki (see AOS spec for namespace convention). Markdown frontmatter + a fenced `json` block carries the whole definition. Prose around the block is free-form notes.

```markdown
---
type: agent
id: default
name: Default
tags: [sigil, orchestrator]
---

The default Sigil agent. Purple polyhedron, parked in the bottom-right
corner of the main display at boot.

```json
{
  "appearance": { /* full Studio UI state snapshot */ },
  "minds": { "skills": [], "tools": [], "workflows": [] },
  "instance": { "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" }, "size": 300 }
}
```
```

**Appearance** is an opaque blob from the renderer's point of view — whatever key-value state Studio persists. This spec deliberately does not enumerate appearance fields; that surface already exists in `apps/sigil/renderer/presets.js` / Studio UI and would rot if duplicated here.

**Minds** are arrays of wiki paths pointing to skills/tools/workflows elsewhere in the wiki. The renderer stores them but does not act on them in this spec.

**Instance** carries per-agent runtime fields that aren't part of the visual identity:
- `home.anchor`: `"nonant"` | `"coords"` | `"last-known"`
- `home.nonant`: one of 9 grid cells, centered in visible bounds of the chosen display (for `anchor: nonant`)
- `home.display`: `"main"` | display UUID
- `home.coords`: `{x, y}` in global canvas coordinates (for `anchor: coords`)
- `size`: base avatar size in pixels (replaces the existing `{base, min, max}` config; min/max become derived constants in the renderer)

### Idle is parked — no knob

Per #25 analysis, follow-cursor is the wrong default for every agent, not just the current one. IDLE = parked is hard-coded in the state machine. No configuration field. Future cursor-treatment modes, if they happen, become *modes* the state machine enters on explicit trigger, not idle-behavior toggles.

### Global canvas

The renderer launches one canvas spanning the union of all displays, derived from the existing `display_geometry` subscription shipped in AOS-1.

- Launch-time: before `aos show create`, compute `{minX, minY, maxX, maxY}` across all displays in `display_geometry`. Issue `aos show create --id avatar-main --at minX,minY,(maxX-minX),(maxY-minY) ...`.
- Runtime: on `display_geometry` rebroadcast (display plug/unplug), recompute the union. If it shrank and the avatar position is now outside visible bounds, clamp to the nearest visible region. If it grew, no action — the avatar stays where it is until moved.
- Dead gaps between non-adjacent displays are transparent. The Three.js scene renders nothing there; cost is a few MB of framebuffer, trivial on modern hardware.
- The `avatar-hit` child canvas model is unchanged (a small movable canvas for gesture capture).

## Components

### Sigil startup (new)

A Sigil-specific initialization step runs before the renderer spawns. Responsibilities:

1. Call the AOS `seedIfAbsent` helper with Sigil's bundled seed files. Sigil ships `apps/sigil/seed/wiki/sigil/agents/default.md` and any other starter pages.
2. Exit. The renderer boot path proceeds as normal.

Seeding is idempotent — on every Sigil boot, absent files get written; present files are left alone.

### Renderer — agent loader (new)

`apps/sigil/renderer/agent-loader.js`:

- Given a wiki path (e.g. `sigil/agents/default`), fetch the markdown page via the content server.
- Parse frontmatter and extract the JSON block body.
- Return `{frontmatter, appearance, minds, instance}`.
- On parse error: return a hard-coded minimal-default agent (purple polyhedron, nonant bottom-right) and log a warning. The avatar always renders.

### Renderer — boot (modified)

`apps/sigil/renderer/index.html?mode=live-js` gains a new query param `?agent=<wiki-path>`, defaulting to `sigil/agents/default`.

Boot sequence:

1. Subscribe to `display_geometry`, `input_event`, `wiki_page_changed`.
2. Wait for the first `display_geometry` snapshot. Compute global canvas bounds. (Note: the renderer is already inside the canvas at this point; global bounds are for coordinate math, not canvas creation — see §spawn below.)
3. Fetch the agent document. Apply `appearance` to the scene via the same setter machinery `applyPreset` uses in `presets.js`. (This factors out a reusable `applyAppearance(blob)` function.)
4. Resolve `instance.home` against `display_geometry` → initial position in global canvas coordinates.
5. Place the orb there. Set size from `instance.size`. Idle state is `parked`.
6. Spawn `avatar-hit` at the orb position, as today.

### Renderer — live reload (new)

The renderer subscribes to `wiki_page_changed` and filters for `path === "sigil/agents/" + currentAgentId + ".md"`, where `currentAgentId` is captured at boot from the `?agent=` URL param (default `default`).

On match:
- If the orb is in IDLE: refetch and re-apply immediately.
- If the orb is in any other state (PRESS, DRAG, GOTO, or mid-fast-travel): queue the re-apply for the next return to IDLE. Prevents visual yank mid-gesture.

Re-apply performs the same `applyAppearance(blob)` that boot performs. `instance.size` changes propagate. `instance.home` changes do **not** relocate a running avatar — home applies only at spawn. Changing home is a user choice that takes effect on next boot.

### Renderer — global canvas spawn (modified)

The launch command used by operators and documentation changes:

Before: `./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html?mode=live-js' --at 0,0,1512,982`

After: `./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html?mode=live-js' --at $(aos runtime display-union)`

A small new `aos runtime display-union` subcommand prints the union bounds of all currently attached displays as `x,y,w,h`. This is platform work, but so trivial it rides with this spec rather than the AOS spec.

### Renderer — state machine (modified)

`liveJs.avatarPos` stops tracking `currentCursor` in IDLE. It only updates on explicit state-driven writes: fast-travel interpolation, drag release, goto-click. `currentCursor` continues to update in the background so GOTO-click coordinate math still works.

Spec doc `docs/superpowers/specs/2026-04-12-sigil-1-state-machine.md` acceptance criterion #2 ("idle cursor follow") is superseded. A note on that spec should point to this one.

### Studio persistence (modified, minimal)

`apps/sigil/studio/js/ui.js` — the save handler currently writes `{base, min, max}` to `/_state/avatar-config.json`. Change:

- Collect the full UI state into an appearance blob (same shape `applyAppearance` expects).
- Read the current active agent document from `sigil/agents/<active-id>.md`.
- Replace the appearance block, preserve minds and instance.
- Write back via the AOS wiki write API (`PUT /wiki/sigil/agents/<active-id>.md`).

The active-agent id is read from a URL param `?agent=<id>` (defaulting to `default`), matching the renderer's convention.

Studio's save-button UX is otherwise unchanged in this spec.

## Data flow

### Boot
1. Sigil startup calls `seedIfAbsent`. `sigil/agents/default.md` materializes if absent.
2. Operator runs `aos show create` with global display-union bounds.
3. Renderer subscribes to channels, fetches agent doc, applies appearance, spawns orb at resolved home position, size from instance.
4. State machine runs. Idle = parked. Fast-travel uses appearance-configured trails.

### Studio edit
1. User adjusts UI in Studio.
2. On save, Studio composes full appearance blob, merges into current agent doc, PUTs to wiki.
3. AOS wiki broadcasts `wiki_page_changed` for `sigil/agents/<id>.md`.
4. Renderer subscribed to that channel receives event, matches active agent, re-applies appearance in IDLE.
5. User sees live update.

### Display plug / unplug
1. `display_geometry` rebroadcasts new set of displays.
2. Renderer recomputes global bounds. Clamps avatar position if newly out-of-bounds.
3. The underlying canvas itself does **not** resize in-place — resizing an existing canvas across displays is fraught. If the topology change is material (display added/removed), operator may restart the avatar canvas; the renderer logs a recommendation in that case. A future spec can automate the resize if it matters.

### Shutdown
1. `aos show remove --id avatar-main` — existing cascade removes `avatar-hit`. Unchanged.

## Error handling

- **Agent doc missing** (first boot, seed helper failed): fall back to hard-coded minimal default in `agent-loader.js`. Log. Avatar still renders.
- **Agent doc malformed JSON**: same fallback. Log with the parse error.
- **Referenced mind path doesn't resolve**: logged, ignored. Minds are non-load-bearing in this spec.
- **`instance.home` resolves off-screen** (display referenced by UUID is no longer attached; coords are outside union): resolve to nonant bottom-right of main display as ultimate fallback.
- **Live reload fires mid-gesture**: queue; re-apply on return to IDLE.
- **Wiki write fails from Studio**: Studio surfaces the error in its UI and retains unsaved state. Does not silently drop the edit.

## Acceptance criteria

1. **Default seed materializes.** Fresh wiki (delete `~/.config/aos/{mode}/wiki/sigil/agents/` and restart Sigil). `sigil/agents/default.md` exists after startup.
2. **Launch spawns orb at home.** `aos show create` with union bounds launches. Orb renders at the bottom-right nonant of the main display.
3. **Idle is parked.** Move cursor across the display. Orb does not move.
4. **Click-goto still works.** Click on avatar → ring appears. Click elsewhere → avatar fast-travels there.
5. **Fast-travel trails honor config.** Edit `appearance.trails.count` in the agent doc, trigger fast-travel, observe different trail count on next travel.
6. **Global canvas crosses displays.** With two displays attached, fast-travel from a point on display 1 to a point on display 2. Orb visibly crosses the boundary in a single scene (not two separate canvases).
7. **Live reload on wiki edit.** Edit `sigil/agents/default.md` in a text editor (change a color). Orb updates color within ~1 second, no restart.
8. **Live reload deferred mid-gesture.** Start a drag. Edit wiki file during the drag. Release drag (fast-travel begins). Re-apply happens only after fast-travel completes and state returns to IDLE.
9. **Studio save round-trip.** Open Studio, change a slider, save. `sigil/agents/default.md`'s JSON block reflects the new value. Live avatar updates.
10. **Home off-screen fallback.** Set `instance.home.display` to a bogus UUID, restart. Avatar spawns at fallback nonant.
11. **Cascade cleanup unchanged.** `aos show remove --id avatar-main` removes avatar-main and avatar-hit.
12. **Sigil-1 spec annotation.** `docs/superpowers/specs/2026-04-12-sigil-1-state-machine.md` carries a note pointing to this spec and marking criterion #2 superseded.

## Testing

- Manual QA per acceptance criteria above, screenshot-verified where visual.
- Automated: appearance blob roundtrip (parse → apply → re-serialize → parse equals original).
- Multi-display: requires a physical second display for criterion 6; document as manual-only.
- Load test: open Studio with live-reload active, drag a color slider for 30 seconds. Verify no runaway re-fetches (debouncing works at the wiki-change layer).

## Migration / rollout

- One-time: existing `~/.config/aos/{mode}/avatar-config.json` (the `{base, min, max}` size-only file) is ignored by this spec's renderer. The renderer reads from the agent doc. The old file can stay on disk harmlessly; a later cleanup spec can delete it.
- Sigil-1 spec acceptance criterion #2 is explicitly superseded. Note added inline on that file.
- Legacy Swift avatar-sub path: untouched. The `?mode=live-js` gate still selects the JS path; omitting it still runs the legacy Swift renderer. Retirement of avatar-sub remains a Sigil-2 tail concern.

## Open questions

- Should `instance.size` changes to a running avatar animate (scale transition) or snap? **Recommendation:** snap for v1. Animation is a polish pass.
- Should the agent doc hold a `version` field for forward-compat? **Recommendation:** yes, small cost. `{version: 1, ...}` at the top of the JSON block.

## Follow-on specs enabled by this one

- **Studio UX rework** — save-as, roster, clone, random-variant flyout, save-button redesign. The biggest visible UX chunk.
- **Multi-agent scene** — spawn multiple agents in the global canvas (orchestrator + subagents). Scene-graph extensions, proximity relationships, shared effects.
- **Agent viewer page** — a wiki-native page renderer that displays an agent's prose + embeds Studio against the JSON block. "Default viewer for an avatar wiki page is Studio."
- **Seed-based variant generation** — deterministic randomization tool, seed logged alongside generated appearance.
- **Sigil-2** — menu slices, beam, stellation push, breathing-menu behavior.

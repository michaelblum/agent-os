# Studio UX Rework

**Date:** 2026-04-12
**Session:** studio-ux-rework
**Scope:** `apps/sigil/studio/` — HTML, CSS, JS. Minor extensions to `apps/sigil/renderer/` for fork helpers. No Swift changes.
**Follows:** Sigil Foundation arc (commits 23fa4f6..72e39d2). Supersedes the Avatar-panel placeholder of `2026-04-07-studio-ui-reorganization.md`.

## Summary

Turn the Avatar Studio into a stageless, identity-first inspector for editing Sigil agents. Replace the single-agent, URL-param-selected editor with:

1. A persistent **agent chip** carrying identity, sync status, and destination actions (save-as, clone, rename, revert, delete).
2. A first-class **Roster** as the top nav-rail destination — agent docs rendered as tiles with mini-orb thumbnails.
3. A **seeded Reroll flyout** with scope chips (Everything / Shape / Palette / Effects), a recent-seeds strip, and a seed paste box.
4. **Stageless Studio** — the in-app 3D preview canvas is removed. The live avatar on the desktop is the preview. Studio becomes a ~460px floating inspector that sits beside the avatar. Slider drags push live updates on `input`; autosave debounces to `change`.

The old floppy-disk "Save" button is deleted. Saves are passive; the chip shows sync state.

## Context & Motivation

The Studio shipped from Celestial (a standalone Three.js visualizer) with two features that no longer fit Sigil:

- An in-app 3D preview canvas duplicating what Sigil-10 now does live on the desktop (save → `wiki_page_changed` → renderer re-applies appearance, commits `141e8d7`, `114917e`).
- A single-agent editing model (`?agent=<id>` URL param, one save button, no visibility into other agents).

Sigil's direction — multi-agent scenes, teams, viewer-native wiki pages — requires agents to be first-class in the UI. Identity is unique; multiplicity comes from **instances**, not duplicate identities. This spec bakes that distinction in.

## Conceptual Model

### Agents

An **agent** is a wiki document at `sigil/agents/<id>.md`. It contains a frontmatter header (`type`, `id`, `name`, `tags`), prose, and a fenced `json` block with `version`, `appearance`, `minds`, and `instance`. Agent id is the canonical identity; name is display-facing and mutable. The existing schema is preserved.

### Roster

The **roster** is the set of agent wiki docs under `sigil/agents/`. It is discovered by listing the wiki namespace; no separate index file. The roster is a list of identities.

### Teams (future, not in scope)

Teams are groupings of agents, modeled as a separate wiki doc at `sigil/teams/<name>.md` referencing member ids. Teams are overlay on top of the roster, not a new primitive. Out of scope for this initiative; the design must not preclude them.

### Fork semantics

Three entry points to **fork** — creating a new agent doc from a source:

| Entry point | Location | Source |
|-------------|----------|--------|
| **+ new** tile | Roster view | Seed default (`DEFAULT_APPEARANCE`, default minds/instance) |
| **Save as…** | Chip menu (current agent) | Current agent's full doc |
| **Clone** | Chip menu (current agent) or row overflow in roster | That agent's full doc |

All three share the same mechanic: copy source doc → prompt for new id/name → `PUT /wiki/sigil/agents/<new-id>.md` → switch Studio to the new agent. The only difference is the source document.

### Instances, not duplicates

Duplicate identities are not supported. If N copies of an agent are needed on screen (e.g., a research team of five researchers), that is a runtime **instance** concern handled by the canvas/scene system — out of scope here. Fork is explicitly for *variation*, not replication.

### Save = autosave

There is no "save" verb in the UI. Every appearance change persists automatically to the active agent's wiki doc (existing `persistAgent()` at `ui.js:935`, debounced). The chip's sync indicator is the only surface for save state: "All changes saved" / "Saving…" / "Save failed — retry".

Safety (try-without-committing) is delegated to wiki version history via a **Revert to previous version** action in the chip menu. No draft state machine is introduced.

## UI Design

### Window model

Studio is a **compact interactive canvas** — ~460px wide, flexible height — rendered via `aos show create --url aos://sigil/studio/index.html --interactive --focus --at <geom>`. The inspector-style look (small, floating beside the avatar) is achieved via caller-supplied size/position and the window chrome inherited from the existing `.floating` interactive-canvas path (`src/display/canvas.swift:161-164`). No daemon changes; no new `--kind` flag introduced here.

Previous split-view layout (3D canvas left, 340px sidebar right) is gone. The entire window is the sidebar.

### Persistent header

A single row across the top of the window, always visible:

- **Agent chip** (left, flex: 1): pill-shaped, contains:
  - 28×28 mini-orb thumbnail (gradient derived from the agent's face colors)
  - Agent name (display-facing)
  - Sync status subline (dot + text, green when saved, amber while saving, red on failure)
  - Caret indicating the chip is clickable
- **Reroll button** (right, fixed): purple pill, emoji die + "Reroll ▾". Opens the reroll flyout.

Clicking the chip opens a menu anchored to it:

- **Save as…** — fork current doc into a new id (same mechanic as the roster "+ new" tile, source = current agent)
- **Rename** — inline edit of the name field; id does not change
- **Undo last save** — session-scoped revert. Studio maintains an in-memory ring buffer of the last 20 pre-save appearance snapshots per agent; this menu item steps one back. See *Undo model* below.
- **Delete** — confirm modal, `DELETE /wiki/sigil/agents/<id>.md`, switches Studio back to `default`

**Clone** is intentionally not in the chip menu — it would duplicate **Save as…** with the same source. Clone lives in the roster tile row-overflow (kebab) for cloning *other* agents without switching to them first.

### Nav rail

Left column, 56px wide, five items top-to-bottom:

| Icon | Label | Content |
|------|-------|---------|
| ◈ | Roster | Tile grid of all agents (default view on Studio open) |
| ▲ | Shape | Existing Shape panel (per `2026-04-07` spec) |
| ◉ | Color | Existing Colors panel |
| ✦ | FX | Existing Effects panel with FX tile grid |
| ☺ | Agent | Per-agent non-appearance fields: display name, home position (anchor/nonant/display), base/min/max size. Minds (tools/skills/workflows) editing is out of scope for this initiative — the panel reserves space but reads from the `json` block as opaque display only. |

The old "Environment" panel (gutted to become the Avatar placeholder in `2026-04-07`) is repurposed as the real **Agent** panel — the home for identity-level configuration that isn't visual appearance. Appearance lives in Shape/Color/FX; identity lives in Roster + Agent + chip.

### Roster view

Default view when Studio opens (unless `?agent=<id>` is in the URL, in which case the Shape panel opens with that agent loaded).

- Grid of tiles, 3 per row, responsive.
- Each tile: 50px mini-orb (live gradient from the agent's face colors), name, status subtext ("editing" for active agent, "idle" otherwise).
- Active agent has a purple glow and `border-color: #bc13fe`.
- Row overflow (kebab on tile hover): Rename · Clone · Delete.
- Trailing "+ new" tile with dashed border opens the fork flow seeded from `DEFAULT_APPEARANCE`.

Tile orb thumbnails are rendered client-side as CSS radial gradients derived from each agent's `appearance.colors.face`. No thumbnail file is stored on disk.

### Reroll flyout

Anchored below the Reroll button. 280px wide, detached popover.

- **Scope chips row**: Everything · Shape · Palette · Effects. Default is Everything. One chip selected at a time.
- **Recent strip**: up to 6 mini-orbs showing the last 6 rolls in temporal order. Current roll has a purple border. Click any orb to restore that seed.
- **Seed row**: pill-shaped input showing the current seed (e.g., `forest-lion-42`). Editable — pasting a seed and pressing Enter reruns randomize with that seed.

Clicking a scope chip does *not* immediately roll; it sets the scope for the next roll. Clicking the Reroll button (outside the flyout) or pressing Enter in the seed row triggers the roll.

**Seeded determinism**: `randomizeAll(seed)` already exists (`ui.js:547`) and drives a `mulberry32` PRNG. The refactor work is (a) partitioning the randomize body by scope so `randomizeAll(seed, scope)` touches only the requested slice, (b) maintaining a bounded in-memory history of recent seeds, (c) converting numeric seeds to human-readable word-pairs for display (e.g., a hash-to-wordlist mapping). Seeds remain numerically stable; the word form is display only.

**Wordlist**: ships in-repo at `apps/sigil/studio/js/seed-words.js` — two arrays of ~128 adjectives and ~128 nouns (~16k combinations, sufficient for display uniqueness within a roster). No new runtime dependency. A numeric seed maps to `<adjective>-<noun>-<seed mod 100>` via stable hashing; the exact derivation lives in the plan.

### Undo model

Revert-to-previous is **session-scoped, in-memory, per-agent**. The daemon content server performs destructive writes with no revision history (confirmed at `src/content/server.swift:271-285`). A proper durable wiki-history story is a separate future initiative and is intentionally out of scope here.

Studio keeps a ring buffer of the last 20 pre-save appearance snapshots for each agent it has touched during the session. Each entry stores: timestamp, agent id, appearance blob, seed (if the save was produced by a roll). The chip menu's **Undo last save** item pops the top entry and re-applies it, triggering a new save (so the undo itself becomes a save event — consistent with autosave semantics and reversible by a subsequent undo).

The buffer does *not* persist across Studio restarts. Closing Studio forfeits in-session undo history; the current wiki doc is the floor. Users who want a specific past state for long-term recovery should fork it (save-as) into its own agent before discarding.

When the durable wiki-history initiative lands, the chip menu item will rename back to "Revert to previous version" and gain cross-session depth; the UI affordance is stable.

### Live-preview slider behavior

Slider drag behavior changes to give desktop-side liveness:

- `input` event → push new state to the live avatar via `persistAgent()`'s output contract *without* writing to wiki (new `pushLivePreview()` helper that emits a transient `sigil_live_preview` message to the canvas, consumed by the renderer's state bridge — no file write).
- `change` event → debounced autosave via existing `persistAgent()` path (issue #36 debounce work covers the debounce mechanic).

The live-preview path is non-persistent; if Studio closes mid-drag, the wiki doc reflects the last `change`-event state, not the drag midpoint.

## Files Touched

### Modified

| File | Changes |
|------|---------|
| `apps/sigil/studio/index.html` | Gut 3D canvas and sidebar split. New shell: titlebar + header (chip + reroll) + body (rail + panel). Add roster panel, rebuild chip, reroll flyout, agent panel. |
| `apps/sigil/studio/js/ui.js` | Add chip menu, roster rendering, fork flow, reroll flyout wiring, scope-partitioned randomize, live-preview emitter. Delete 3D-canvas-coupled code paths (camera, skybox, pathing preview). |
| `apps/sigil/studio/js/main.js` | Delete scene init, remove Three.js imports. Studio no longer runs a render loop. |
| `apps/sigil/studio/css/` | New app-shell styles: titlebar, header pill, chip, reroll button, flyout, roster grid, agent tiles. Remove canvas-positioning CSS. |

### Deleted

- `apps/sigil/studio/js/scene.js`
- `apps/sigil/studio/js/skybox.js`
- `apps/sigil/studio/js/interaction.js` (camera orbit + context menus on 3D canvas)
- `apps/sigil/studio/js/pathing.js` (preview-only; live pathing is IPC-driven)
- `apps/sigil/studio/js/grid3d.js` (already UI-removed in prior spec)
- `apps/sigil/studio/js/swarm.js` (already UI-removed in prior spec)
- `apps/sigil/avatar.html` (legacy, already superseded by `renderer/index.html`)

Three.js CDN reference and all `renderer/` imports that exist purely to support the Studio preview are removed from Studio's entry point. The live renderer continues to import those modules; Studio no longer does.

### New

- `apps/sigil/renderer/agent-fork.js` — small helper exposing `forkAgent(sourceDoc, newId, newName)` that returns the new doc string. Used by the three fork entry points. Placing it under `renderer/` (not `studio/`) keeps it available for any future canvas that wants to offer fork (e.g., a viewer page).

### Not touched

- `apps/sigil/renderer/index.html`, `appearance.js`, `state.js`, presets, shaders — the live renderer is the source of truth and unchanged.
- `apps/sigil/avatar-*.swift` — no Swift changes.
- `src/daemon/content.swift` (and sibling) — wiki PUT/GET semantics unchanged; wiki history API may need a surface if one doesn't exist (see Open Questions).

## Non-Goals

- **Teams** — separate future spec. The roster design leaves room (a future Teams rail icon + team docs) but does not implement.
- **Multi-agent scene** — spawning multiple live agents on the desktop is the follow-on `multi_agent_scene` initiative.
- **Agent viewer page** — a wiki-native renderer that displays agent prose + embeds Studio against the JSON block. Separate initiative.
- **Seed-based variant library** — a catalog of named seeds and stylistic presets beyond the per-scope randomize. This spec delivers the seeded randomize mechanic only.
- **Sigil-2 menu work** — radial menu, beam, stellation push are out of scope.
- **Visual redesign of Shape/Color/FX panel contents** — internal control layouts are preserved from the `2026-04-07` spec. This initiative rebuilds the shell, not the panels.

## Resolved During Spec Review

The following were open in early drafts; each is now closed with a codebase citation.

1. **Wiki revision history — NONE.** `src/content/server.swift:271-285` performs destructive writes with no history/backup mechanism; no `?rev=` routing exists and the wiki directory is not a git repo. Decision: ship a session-scoped in-memory undo ring buffer in this initiative (see *Undo model*). File a follow-on issue for durable wiki history.
2. **Seed wordlist — in-repo.** No existing petname/wordlist utility in the codebase (grep confirmed). Ship ~128 adjectives + ~128 nouns as a JS module under `apps/sigil/studio/js/seed-words.js`. Zero new runtime dependencies.
3. **Inspector window kind — not a daemon concept.** `aos show create` accepts no `--kind`, `--style`, or `--level` flag (`src/display/client.swift:113-215`); interactive canvases all use `.floating` window level uniformly. Studio opens as a regular interactive canvas with caller-supplied compact geometry. "Inspector" is a look, not a kind. No daemon changes in this initiative.

## Follow-on Issues To File

- **Durable wiki revision history**: content server should retain prior revisions (git-backed or sidecar `.history/`) and expose them via HTTP. Unblocks cross-session revert in Studio and everywhere else the wiki is edited.
- **Canvas window kinds**: introduce a `--kind` enum on `aos show create` for inspector/palette/hud variants if more than Sigil Studio wants compact chrome. Optional, low priority; Studio does not need it.

## Constraints

1. The wiki doc format (frontmatter + `json` block) is unchanged. All agent docs remain human-readable markdown.
2. Agent ids are immutable once created. Rename edits `name` only.
3. The Studio must remain usable as a standalone HTML page in a browser (for dev) — wiki PUT/GET is the transport, not a Swift-only path.
4. Purple accent (`#bc13fe`), dark theme, and existing typography from Celestial carry forward. Control styling inside Shape/Color/FX panels is not redesigned.
5. `getConfig()`/`setConfig()` contract (serialization of full appearance) must remain functional — it is the path the live renderer's state bridge uses.
6. No new runtime dependencies. Three.js remains loaded by the live renderer only.

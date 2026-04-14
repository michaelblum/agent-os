---
name: sigil-studio-presentation-design
description: Studio-adjacent avatar behaviors — kill `home` as an abstraction (replace with `instance.birthplace` + daemon-side `lastPosition`), add a Studio-invoked "inspected" state for the avatar, formalize Studio/avatar cooperation. To be promoted to a spec via superpowers:brainstorming.
type: project
status: validated-deferred
source: session c42b7da7 (studio-slider-fix) conversation with Michael, 2026-04-13
connects_to: apps/sigil/studio/, apps/sigil/renderer/, src/daemon/
updated: 2026-04-13
---

# Sigil + Studio presentation + avatar-adjacency design

Captured from a drifted brainstorm in session `studio-slider-fix` (transcript `c42b7da7`) where Michael worked through how Studio and the live avatar should present and cooperate. The session never produced a spec — these are the conclusions, to be formalized via `superpowers:brainstorming` in a follow-up.

## What Michael decided

### 1. Kill `home` as an abstraction

- **Why:** `home` was originally about "where the avatar spawns on first appearance." It accidentally became a return-anchor / idle-parking concept that's been fighting the natural "user leaves avatar wherever they drop it" behavior.
- **Replace with:**
  - `instance.birthplace` in the wiki doc — consulted **exactly once**, on the agent's first-ever spawn. Nonant cell name or explicit coords.
  - Daemon-side per-agent `lastPosition` map (ephemeral, out of wiki) — updated whenever avatar moves, used on every subsequent spawn.
- **Net:** `home-resolver.js` collapses to a trivial birthplace→coords helper. Wiki doc gets smaller. No return-to-anchor logic anywhere.

### 2. Studio-invoked "inspected" state for the avatar

Not a home override — a new avatar behavior state:

- **On Studio open (for this agent):**
  - Snapshot avatar's current `(x, y)` (daemon-side, keyed by agent id).
  - Move avatar to top-left nonant of the display Studio is on (or wherever Studio opens).
  - Baked-in behavior in this state: if user drags the avatar away, spring back to that spot after 1s. Nothing else.
- **On Studio close:**
  - Avatar returns to the snapshotted `(x, y)`. No residue.
- **No baked-in demo gestures** — user drives testing by playing with knobs.

### 3. Studio window geometry

- **Layout:** avatar in top-left nonant of the display Studio lives on; Studio fills the right ~⅔ of the display.
- **Uniform padding:** all four sides of Studio get the same inset. Use `0.1 × display shorter-axis` as the default.
- **Formalization as a style token:** `SIGIL_PAD` — whenever Sigil programmatically positions its own canvases (Studio, future chat, future panels), it applies `SIGIL_PAD`. Not a constraint on canvases in general; just Sigil's own placement default.
- **Keep 3×3 nonant grid** — it's for human-naming park positions, not for placing Studio. 4×3 doesn't help here and makes cell names worse.

### 4. Live reflection during Studio editing

Commit-on-release (the current wiki round-trip) is acceptable IF the mesh-stacking bug is fixed. Live scrub-while-dragging is nice-to-have, not required.

If live scrub is wanted, the design consensus was:
- **Working-copy + Commit model:** Studio holds a working copy in memory; avatar renders from it via a fast direct channel; wiki is only written on an explicit Commit action. Undo = revert to committed. Sync indicator stops lying.
- **Fast channel preference:** gateway `post_message` on a new `aos-sigil-studio` channel. Already exists, right abstraction, ~10–50ms latency.

Michael's explicit preference: "reduce complexity." So commit-on-release first, working-copy+Commit only if #39 (live preview) demands it.

### 5. Multi-display and cross-display concerns Michael raised

- Studio being cut off at the bottom of a display surfaced a concern that canvases don't span display boundaries well.
- Michael's understanding: avatar canvas covers all displays (union-of-displays canvas). He recalled that shipping.
- Agent needs to verify this before any "inspected state" work — if cross-display handoff is broken, the "move to top-left nonant of Studio's display" behavior will have edge cases at display boundaries.
- File as a prerequisite for the spec: confirm current cross-display behavior of `avatar-main`.

## Mesh-stacking bug (in-scope, unfixed)

The drifted session also diagnosed but did not fix a mesh-stacking bug in the live-js renderer:

- `syncWindowStateToModule` in `renderer/index.html:3479-3483` copies ALL `window.state` keys (including `polyGroup`, `omegaGroup`, mesh refs) into `moduleState`. This causes module-level `updateGeometry` to actually run instead of silently no-op, and it adds a mesh. Then the inline `updateGeometry` adds another. Each wiki reload leaks one mesh per mesh-type.
- Fix plan: (a) guard `updateGeometry`/`updateOmegaGeometry` in `renderer/geometry.js` with `if (!state.polyGroup) return;`; (b) restrict `syncWindowStateToModule` to a scalar allowlist so Three.js refs never leak.
- This blocks any live-reflection work — even the current wiki round-trip becomes unusable after a few slider moves.
- Should be filed as a separate bug before the presentation spec work begins.

## How to pick this up

When you come back:

1. Invoke `superpowers:brainstorming` with this file as the starting point. The intent/requirements sections are already mostly written above — the skill can validate them with Michael and move to approaches + spec.
2. Prerequisite: file and fix the mesh-stacking bug (GitHub issue + small PR).
3. Prerequisite: verify current cross-display behavior of `avatar-main`.
4. Spec should cover, in order: birthplace replacement → daemon last-position storage → inspected state (move+spring-back) → Studio geometry + SIGIL_PAD → working-copy+Commit (optional, #39 driven).

## Keywords for future matching

home removal, birthplace, inspected state, avatar parking, spring-back, working copy, commit button, SIGIL_PAD, nonant, Studio adjacency, mesh stacking, live reflection, cross-display avatar

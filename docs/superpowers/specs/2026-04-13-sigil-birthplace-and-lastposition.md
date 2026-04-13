---
title: Sigil — birthplace + lastPosition refactor
date: 2026-04-13
status: draft
type: spec
scope: spec (i) of the Sigil+Studio presentation-design arc
---

# Sigil — birthplace + lastPosition refactor

Replace the `instance.home` abstraction on agent wiki docs with two cleaner concepts:

- **`instance.birthplace`** — a first-spawn-only placement descriptor, read from the wiki doc exactly once per agent per daemon lifetime.
- **Daemon-side `lastPosition` map** — an in-memory per-agent `{x, y}` store, updated by the renderer on every transition to IDLE, consulted for all subsequent spawns within a daemon lifetime.

This is spec (i) of a two-spec arc. Spec (ii) will cover Studio's "inspected" avatar state and the `SIGIL_PAD` geometry token, both of which depend on the model established here.

## Why

`home` was originally about "where the avatar spawns on first appearance." It accidentally grew return-to-anchor / idle-parking semantics that fight the natural "user leaves avatar wherever they drop it" behavior. Splitting the concept eliminates the conflict: `birthplace` is a boring one-shot default, `lastPosition` is the live per-user position, and there is no "return to anchor" logic anywhere in the system.

## Non-goals

- **Disk-persisted lastPosition.** In-memory only; wiped on daemon restart. If cross-reboot persistence is wanted later, it's a single follow-on issue.
- **Inspected avatar state, SIGIL_PAD, Studio-adjacent behaviors.** Spec (ii).
- **Renderer architecture reconciliation** (inline bundle vs ES modules — #47). This spec rides on existing hooks without touching the split.
- **New position-change pub/sub channel.** No external consumer legitimately needs position-change events at the canvas-IPC layer.

## Schema & data model

### Wiki doc — `instance` block

Before:
```json
"instance": {
  "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
  "size": 300
}
```

After:
```json
"instance": {
  "birthplace": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
  "size": 300
}
```

Field shape is identical to today's `home`:
`{anchor: 'coords'|'nonant', coords?: {x,y}, nonant?: one-of-9, display?: 'main'|<uuid>}`.
Only the key name changes. The seed doc at `apps/sigil/seed/wiki/sigil/agents/default.md` is updated in the same PR.

### Daemon — `lastPosition` map

- **Type:** `Dictionary<AgentID, {x: Double, y: Double}>`, where `AgentID` is the agent id parsed from the wiki doc path (e.g. `"default"` from `sigil/agents/default.md`).
- **Lifetime:** process-local on the daemon. Allocated on daemon start, never written to disk, wiped on daemon restart and on `aos reset`.
- **Coordinates:** global CG frame (top-left origin, matches `display_geometry`), same units as `computeUnion` bounds. Per ARCHITECTURE.md §6 invariant 1.
- **Mutations:** renderer-initiated only. Daemon never derives or infers; it is a passive KV store.
- **Reads:** renderer-initiated only, on boot, per-agent.
- **Boundaries:** no coordinate validation, no decay, no eviction. All position semantics (clamp to union, fallback to birthplace on missing entry) live on the renderer side where they already exist. ARCH §6 invariant 5 ("position data stays out of canvases") extends to "position logic stays out of the daemon."

## Runtime flow

### Boot sequence (renderer, on canvas load)

```
1. init() + setupLiveJs()         [unchanged — opens subscription]
2. loadAgent(path)                [migration: if doc has 'home' but no 'birthplace',
                                   rewrite in place via wiki PUT; read result]
3. applyAppearance()              [unchanged]
4. awaitFirstDisplayGeometry()    [unchanged]
5. NEW — resolvePosition(agent):
      lp = await daemon.getLastPosition(agent.id)
      if (lp) return lp
      return resolveBirthplace(agent.instance.birthplace, displays)
6. liveJs.avatarPos = { x, y, valid: true }
```

Step 5 is the only new logic. `resolveBirthplace` is the renamed `resolveHome` — trivial behavior preservation.

### IDLE update path

The renderer's state machine transitions to IDLE from drag-end and fast-travel-end. At the moment of transition, renderer posts fire-and-forget:

```
daemon.setLastPosition(key, { x, y })
```

Daemon writes into its in-memory map. No ack needed. On next daemon restart the value is gone and `resolveBirthplace` takes over, which is the correct behavior.

### New daemon IPC surface

On the existing canvas IPC bridge (same mechanism as `subscribe`, `canvas.create`, etc. — `postToHost` path):

- `position.get { key } → { key, position: {x,y} | null }` — request/response.
- `position.set { key, x, y }` — fire-and-forget.

Wire verbs use a generic key-space namespace (`position.*`) for reuse by future presence systems. The spec requires only:
- a request/response read keyed by `key`, returning the current position or null;
- a fire-and-forget write keyed by `key` with `{x, y}`;
- and that both be served over the existing canvas IPC bridge (no new transport, no pub/sub channel).

### Union canvas contract

`lastPosition` is stored in global CG coordinates per ARCH §6 invariant 1. On boot, if the resolved position falls outside the current display union (e.g., display rearrangement between sessions), the existing clamp-on-rebroadcast logic at `apps/sigil/renderer/index.html:2906-2929` handles it — avatar snaps to the nearest union edge. Accepted v1 behavior; #49 tracks the long-term fix (auto-resize of the union canvas on topology change).

## Migration

`loadAgent` in `apps/sigil/renderer/agent-loader.js`:
1. Fetch the agent wiki doc.
2. Parse the JSON `instance` block.
3. If `instance.birthplace` is present → use it.
   - If `instance.home` is ALSO present → log an advisory ("doc has both; `home` is orphaned — not removed to avoid unexpected writes on read"). No rewrite. `birthplace` wins.
4. Else if `instance.home` is present → construct `instance.birthplace = instance.home`, delete `instance.home`, serialize doc, PUT via the wiki write endpoint, then proceed with the in-memory rewritten doc.
5. Else → `instance.birthplace = MINIMAL_DEFAULT.birthplace` (rename of today's `MINIMAL_DEFAULT.home`).

Fresh installs never see `home`. The seed doc at `apps/sigil/seed/wiki/sigil/agents/default.md` AND `MINIMAL_DEFAULT` in `agent-loader.js` are both updated in the same PR.

## Error handling

| Failure mode | Behavior |
|--------------|----------|
| Daemon `getLastPosition` errors or times out | Fall through to `resolveBirthplace` as if no entry existed. Log-and-continue. No user-visible error. |
| Daemon `setLastPosition` errors | Fire-and-forget, no retry. Warning log. Next IDLE overwrites. |
| Wiki rewrite during migration fails | Keep the in-memory rewritten doc, continue boot. Log warning. Next load retries the rewrite. |
| Malformed `birthplace` descriptor | `resolveBirthplace` falls back to `MINIMAL_DEFAULT.birthplace` (mirrors today's `resolveHome` fallback). |

No new error codes, no new user-facing messages.

## Testing

### Unit (node --test, pattern matches Studio module tests)

- `birthplace-resolver.test.js` — ports `home-resolver` tests verbatim under the new name. Covers all anchor/nonant/display combinations, negative-coordinate displays, missing fields.
- `agent-loader.test.js` additions — three cases:
  - doc with `birthplace` only → no rewrite;
  - doc with `home` only → rewrite happens, result has `birthplace` and no `home`;
  - doc with both → prefer `birthplace`, log advisory.

### Integration (acceptance-style, via `aos show eval`)

- Fresh boot (no lastPosition yet) → avatar at `birthplace`.
- Move avatar, wait for IDLE, close + relaunch avatar-main → avatar at last IDLE position.
- Restart daemon (`aos service restart` or equivalent) → next spawn at `birthplace`, not at old lastPosition.
- Legacy doc (only `home`) → after first load, file on disk has `birthplace` and no `home`.
- Malformed `birthplace` → avatar lands at `MINIMAL_DEFAULT.birthplace` with a log line.

No UI tests — no UI surface in this spec.

## Open questions

None at spec level. Plan-level open items:
- Exact wire names and envelope shape for the two new IPC verbs.
- Whether the daemon-side map lives inside `unified.swift` directly or in a new helper under `src/daemon/`.

## References

- Scratchpad: `memory/scratchpad/sigil-studio-presentation-design.md` (source of the design intent)
- Architecture: `ARCHITECTURE.md` §6 (Union Canvas Foundation — coordinate contract, invariants)
- Umbrella issue: #50 (union canvas foundation)
- Related issues: #49 (auto-resize on topology change), #47 (renderer reconciliation — out of scope)
- Current home-resolver: `apps/sigil/renderer/home-resolver.js` (becomes `birthplace-resolver.js`)
- Current boot sequence: `apps/sigil/renderer/index.html:3381-3442`
- Current display-topology handling: `apps/sigil/renderer/index.html:2890-2929`, `src/daemon/unified.swift:213-407`

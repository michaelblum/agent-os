# Team Lead Prompt — hand-off v2 Review Fixes + heads-up Channel Integration

You are the team lead for a multi-agent implementation session on the agent-os project.

## What agent-os is

agent-os is a set of independent macOS CLI tools that give AI agents a physical body on a Mac. Each tool does one thing:

- **side-eye** (sensor) — sees the screen: screenshots, AX tree, spatial topology
- **hand-off** (actuator) — operates the computer: clicks, types, drags, scrolls, holds modifier keys
- **heads-up** (projector + control surface) — shows the human what the agent is doing AND lets the human talk back through interactive floating canvases

Tools are Unix-style: structured JSON in, structured JSON out. No tool knows about any other tool. An LLM agent (Claude Code, Codex, any model) orchestrates them.

## What's been built

All three tools are production Swift CLIs in `/Users/Michael/Documents/GitHub/agent-os/packages/`.

**hand-off v2** was just implemented across 10 Swift files (~2750 lines):
- Session mode: persistent stdin process with ndjson protocol, modifier state, cursor tracking
- Behavioral profiles: JSON files that define human-like timing, mouse curves, typing cadence
- Context operator: sets inherited defaults (pid, window, coordinate space, scale factor, subtree)
- AX targeting overhaul: multi-field matching, match modes (exact/contains/regex), near disambiguation, depth/timeout limits
- Focus channel binding: reads channel files, auto-sets context, element resolution
- All v1 CLI commands preserved with new flags

**side-eye daemon** was just implemented across 5 new Swift files (~1584 lines):
- Unix socket server maintaining a spatial model
- Focus channel management: create/update/remove channels targeting windows + subtrees
- Channel files at `~/.config/agent-os/channels/<id>.json` with triple coordinates (pixel, window-relative, global CG)
- Progressive perception: graph-deepen/graph-collapse for progressive AX depth
- Subscribe for change events (channel_updated, window_moved, focus_changed)

**heads-up** has render mode + serve mode (~1614 lines):
- Persistent daemon with floating transparent canvases
- Window anchoring at 30fps via CGWindowListCopyWindowInfo polling
- Full-duplex bridge: eval (host→content) + messageHandler (content→host)
- TTL, connection-scoped canvases, subscribe for events

Both hand-off and side-eye compile clean with no warnings.

## What needs to be done

There are two workstreams:

### Workstream A: Review fixes (9 issues)

A code review found 2 critical and 7 important issues in the Phase 1-3 implementation. The full plan with implementation details, file locations, and tests is at:

**`docs/superpowers/plans/2026-04-01-review-fixes.md`**

Priority order:
1. **CRITICAL — hand-off signal handler** (`session.swift`): No SIGINT/SIGTERM handler. Stuck modifier keys make the computer unusable. Must release all held modifiers before exit.
2. **CRITICAL — side-eye thread safety** (`spatial.swift`): `SpatialModel.channels` dictionary accessed from poll timer and connection handlers concurrently with no synchronization. Will crash.
3. Error code naming alignment (3 string replacements)
4. Bind response missing channel name (1 line)
5. Snapshot hardcoded `windows: 0` (1 CGWindowList call)
6. Channel element resolution not wired up — `resolveChannelElement` exists but actions never call it
7. Display ID mismatch — channels use ordinal, graph commands use CGDirectDisplayID
8. CLI type missing `--delay`/`--variance` flags
9. No AX refresh unless window moves — need periodic re-scan

### Workstream B: heads-up channel integration (new feature)

The spec for extending heads-up to work with focus channels is at:

**`docs/superpowers/specs/2026-04-01-heads-up-channel-integration.md`**

Three additions:
1. **`anchorChannel` field** on create/update — canvas positions relative to a focus channel's window instead of requiring manual window_id extraction
2. **Auto-projection modes** — built-in renderers that visualize channel state: `highlight_focused` (border around focused subtree), `label_elements` (live badges), `cursor_trail` (fading cursor trail)
3. **Control surface patterns** — documented examples of interactive canvases for human→agent communication (approval dialogs, action menus, stop buttons)

## Key files

| Path | What |
|---|---|
| `docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md` | The full design spec (source of truth) |
| `docs/superpowers/specs/2026-04-01-heads-up-channel-integration.md` | heads-up channel integration spec |
| `docs/superpowers/plans/2026-04-01-review-fixes.md` | Prioritized fix plan with implementation details |
| `docs/agent-os-explainer.md` | What agent-os is and why it exists |
| `packages/hand-off/*.swift` | hand-off v2 implementation (10 files) |
| `packages/side-eye/daemon.swift` | side-eye daemon |
| `packages/side-eye/spatial.swift` | Spatial model, channel management, AX traversal |
| `packages/side-eye/protocol.swift` | side-eye daemon protocol types |
| `packages/heads-up/protocol.swift` | heads-up daemon protocol types |
| `packages/heads-up/canvas.swift` | Canvas management, anchor polling |
| `ARCHITECTURE.md` | Ecosystem design, philosophy, component roster |

## How to staff this

**Option A — Two agents in parallel:**
- Agent 1: Workstream A (review fixes). Start with the two critical fixes, then work down the priority list. All changes are in `packages/hand-off/` and `packages/side-eye/`.
- Agent 2: Workstream B (heads-up channel integration). All changes are in `packages/heads-up/`. No overlap with Agent 1's files.

**Option B — Three agents:**
- Agent 1: Critical fixes only (signal handler + thread safety). Fast, focused.
- Agent 2: Remaining review fixes (issues 3-9).
- Agent 3: heads-up channel integration.

Agent 1 should finish first and fastest. Agents 2 and 3 have no file overlap and can run fully in parallel.

## Build and test

Each package builds independently:
```bash
cd packages/hand-off && bash build.sh    # swiftc -parse-as-library -O -o hand-off *.swift
cd packages/side-eye && bash build.sh    # swiftc -parse-as-library -O -o side-eye *.swift
cd packages/heads-up && bash build.sh    # swiftc -parse-as-library -O -o heads-up *.swift
```

hand-off has integration tests: `bash packages/hand-off/test.sh`

All Swift. Zero dependencies. No SPM, no Xcode. Just `swiftc` and Apple frameworks.

## Rules

- Read the relevant spec section BEFORE writing code. The spec is detailed and precise.
- Read the fix plan BEFORE fixing an issue. It includes the exact file, the problem, and the implementation approach.
- Build after every change. Don't accumulate uncommitted changes.
- Commit each fix or feature separately with a descriptive message.
- Don't modify files outside your workstream without coordinating.
- If something in the spec is ambiguous, make a decision, document it in a code comment, and move on. Don't block.

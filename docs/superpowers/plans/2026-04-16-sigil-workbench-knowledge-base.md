# Sigil Workbench Knowledge Base Implementation Plan

> **For agentic workers:** keep the implementation layer-correct. The canonical knowledge model stays in `aos wiki`; toolkit surfaces consume shared shapes; Sigil owns only Sigil policy such as avatar sync and workbench composition.

**Goal:** Add a first-class knowledge base tab to Sigil workbench, backed by the canonical wiki model rather than a bespoke UI-only graph feed. Agents must be able to access and drive the same knowledge surface via CLI/SDK and via semantic UI intents, without reasoning in screen coordinates or canvas choreography.

**Tracking issue:** `#72` — Add canonical wiki graph projection and Sigil workbench knowledge base tab

**Architecture:** Introduce a shared wiki graph projection primitive at Layer 0/1, reuse the existing toolkit `wiki-kb` snapshot/update contract as the canonical graph payload, mount `wiki-kb` directly into Sigil workbench as a toolkit peer, and keep avatar/context sync as a Sigil-owned consumer behavior. No new transport protocol. Live refresh flows through the existing `wiki_page_changed` event and a shared graph projection helper.

**Tech Stack:** Swift (`aos wiki`, content server, wiki index hooks), SQLite (`wiki.db` pages + links materialization), vanilla ES modules (`packages/toolkit`, `apps/sigil/workbench`), existing canvas bridge (`headsup.receive` / postMessage), existing workbench `Tabs(...)` layout.

**Spec:** none yet. This plan encodes the approved architecture from the 2026-04-16 workbench KB design review.

**Status:** Phases 0-3 are implemented and verified locally. Phase 4 (`aos wiki reveal` CLI sugar and Sigil-owned avatar/context sync) remains deferred.

---

## Desired outcome

After this plan lands:

- `aos wiki graph --json` returns the canonical graph payload for wiki surfaces.
- In-canvas consumers can fetch the same graph projection over the content server without shelling out.
- Sigil workbench includes a direct-mounted Knowledge Base tab alongside Studio, Chat, Canvas Inspector, and Log Console.
- `wiki-kb` can be driven by semantic intents such as `reveal`, `clear-selection`, and `set-view`, and emits semantic `selection` events.
- Sigil can optionally mirror KB selection into avatar/context presentation using a high-level intent payload, not coordinates.

Non-goals for this plan:

- Semantic search or embeddings
- Rich graph editing in the UI
- Multi-user/shared wiki sync
- Sigil avatar choreography beyond a minimal context-focus handoff

---

## Phase 0 — Baseline and ownership

- [x] Confirm no parallel session is actively editing:
  - `src/commands/wiki*.swift`
  - `src/content/server.swift`
  - `packages/toolkit/components/wiki-kb/*`
  - `packages/toolkit/panel/layouts/tabs.js`
  - `apps/sigil/workbench/index.html`
- [x] Record this plan in a GitHub tracking issue and update the `Tracking issue` line with the issue number.
- [x] Verify current baseline behavior:
  - `aos wiki list --json`
  - `aos wiki show employer-brand-profile --json`
  - `apps/sigil/workbench/launch.sh`

**Done when:** the plan is tracked in both git and GitHub, and the implementation slice has clear ownership.

---

## Phase 1 — Canonical wiki graph projection

### Task 1: Add a graph query surface to `aos wiki`

**Why:** `wiki-kb` already has a canonical graph payload contract, but no canonical wiki producer exists. The graph must come from `aos wiki` / `wiki.db`, not from ad hoc JS assembly.

**Files:**
- `src/commands/wiki.swift`
- `src/commands/wiki-index.swift`
- `src/shared/command-registry-data.swift`
- optionally `src/CLAUDE.md` / `docs/api/aos.md` if command docs need updating in the same pass

- [x] Add `graph` to the `aos wiki` subcommand router.
- [x] Add `WikiIndex` queries for:
  - all links
  - optionally filtered pages/links by type/plugin/path when needed
- [x] Implement `aos wiki graph --json` returning:
  - `nodes`
  - `links`
  - `raw` keyed by page path when `--raw` is requested
  - `config.graphView` defaults suitable for wiki browsing
- [x] Use page `path` as canonical node id.
- [x] Keep the payload shape aligned to `docs/api/toolkit.md` and `packages/toolkit/components/wiki-kb`.

**Initial scope:** full snapshot only. No CLI-side incremental delta protocol in v1.

**Verification:**

```bash
./aos wiki graph --json | jq '.nodes | length, .links | length'
./aos wiki graph --json | jq '.nodes[] | select(.id=="aos/entities/employer-brand-profile.md")'
./aos wiki graph --raw --json | jq '.raw["aos/entities/employer-brand-profile.md"] | startswith("---")'
```

Expected: snapshot returns the employer-brand pages, links are populated, and `--raw` includes markdown bodies.

### Task 2: Make live wiki writes keep the index trustworthy

**Why:** the content server already emits `wiki_page_changed`, but its `WikiIndexHooks` are currently stubs. If the index drifts after PUT/DELETE, graph consumers become unreliable.

**Files:**
- `src/daemon/wiki-change-bus.swift`
- supporting shared helper location if refactoring is required
- `src/content/server.swift`

- [x] Replace the `WikiIndexHooks` stubs with real page reindex/remove behavior for single-page writes and deletes.
- [x] Ensure PUT updates:
  - page row
  - outgoing links for that page
  - plugin row when the page is a plugin `SKILL.md`
- [x] Ensure DELETE removes:
  - page row
  - incoming/outgoing links touching that page
  - plugin row when a plugin `SKILL.md` or plugin directory is removed
- [x] Avoid full `dropTables()` reindex on every write.

**Verification:**

```bash
PORT=$(./aos config get content.port 2>/dev/null || true)
./aos wiki graph --json > /tmp/wiki-before.json
curl -sf -X PUT "http://127.0.0.1:${PORT:-7777}/wiki/test/graph-smoke.md" --data-binary $'---\ntype: concept\nname: Graph Smoke\ndescription: smoke\ntags: [smoke]\n---\n\n# Graph Smoke\n\n## Related\n- [Employer Brand Profile](../aos/entities/employer-brand-profile.md)\n'
./aos wiki graph --json | jq '.nodes[] | select(.id=="test/graph-smoke.md")'
./aos wiki graph --json | jq '.links[] | select(.source=="test/graph-smoke.md")'
curl -sf -X DELETE "http://127.0.0.1:${PORT:-7777}/wiki/test/graph-smoke.md"
./aos wiki graph --json | jq '.nodes[] | select(.id=="test/graph-smoke.md")'
```

Expected: the node/link appear after PUT and disappear after DELETE without a manual `aos wiki reindex`.

### Task 3: Expose the same graph projection to canvases

**Why:** Sigil workbench cannot shell out to `aos wiki graph`. It needs an in-canvas read path that returns the same payload as the CLI.

**Files:**
- `src/content/server.swift`
- shared helper extracted from `aos wiki graph` implementation if needed

- [x] Add a read-only virtual endpoint under `/wiki/` for the graph snapshot.
- [x] Reuse the same graph projection helper as `aos wiki graph`.
- [x] Support `raw=1` or equivalent opt-in raw-content inclusion.
- [x] Keep the endpoint read-only and cache-safe.

**Proposed endpoint:** `GET /wiki/.graph` with optional `?raw=1`

**Verification:**

```bash
curl -sf "http://127.0.0.1:7777/wiki/.graph" | jq '.nodes | length'
curl -sf "http://127.0.0.1:7777/wiki/.graph?raw=1" | jq '.raw["aos/entities/employer-brand-profile.md"] | startswith("---")'
```

Expected: content server returns the same graph payload shape as the CLI helper.

---

## Phase 2 — Toolkit KB as a first-class control surface

### Task 4: Expand `wiki-kb` with semantic intents and emitted selection

**Why:** agents should drive the KB via meaning, not graph mechanics. The component needs a small semantic control surface beyond raw snapshot/update.

**Files:**
- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/wiki-kb/views/*` if view focus helpers need light extension
- `docs/api/toolkit.md`

- [x] Extend the manifest to accept:
  - `reveal`
  - `clear-selection`
  - `set-view`
- [x] Emit `selection` whenever the active selection changes.
- [x] Keep payloads semantic:
  - `reveal`: `{ id | path | name, openSidebar?, focus?, view? }`
  - `selection`: `{ id, path, name, type, tags, plugin }`
- [x] Ensure `reveal` works across graph and mind-map views.
- [x] Preserve existing `graph` / `graph/update` compatibility.

**Verification:**

```bash
./aos show create --id kb-test --interactive --url 'aos://toolkit/components/wiki-kb/index.html'
./aos show post --id kb-test --event "$(./aos wiki graph --json | jq -c '{type:\"wiki-kb/graph\",payload:.}')"
./aos show post --id kb-test --event '{"type":"wiki-kb/reveal","payload":{"id":"aos/entities/employer-brand-profile.md","openSidebar":true,"focus":true}}'
```

Expected: the KB view selects the node, centers/focuses it, and opens the markdown/raw sidebar.

### Task 5: Add generic tab activation to toolkit `Tabs(...)`

**Why:** workbench-level automation should be able to switch tabs semantically. This is generic panel behavior, not a Sigil-only hack.

**Files:**
- `packages/toolkit/panel/layouts/tabs.js`
- `packages/toolkit/panel/router.js` only if routing adjustment is required
- `docs/api/toolkit.md`

- [x] Add a panel-level `tabs/activate` intent that can target a tab by:
  - content `name`
  - title
  - index
- [x] Optionally emit a `tabs/activated` event with the active tab metadata.
- [x] Keep the change generic for any tabbed panel, not just Sigil workbench.

**Verification:**

```bash
./aos show post --id sigil-workbench --event '{"type":"tabs/activate","payload":{"name":"wiki-kb"}}'
```

Expected: the workbench switches to the Knowledge Base tab.

---

## Phase 3 — Sigil workbench integration

### Task 6: Mount `wiki-kb` directly in Sigil workbench

**Why:** the KB tab is a toolkit peer, like Canvas Inspector and Log Console. It should be direct-mounted, not embedded through an iframe.

**Files:**
- `apps/sigil/workbench/index.html`
- workbench stylesheet additions if needed

- [x] Import `WikiKB` and its stylesheet.
- [x] Add a `Knowledge Base` tab to the existing `Tabs([...])` composition.
- [x] Keep Studio and Chat iframed.
- [ ] Fetch the initial graph snapshot from the new `/wiki/.graph` endpoint and feed it to the component.

**Verification:**

```bash
apps/sigil/workbench/launch.sh
./aos show post --id sigil-workbench --event '{"type":"tabs/activate","payload":{"name":"wiki-kb"}}'
```

Expected: workbench shows a populated KB tab with graph + mind-map + markdown/raw detail.

### Task 7: Add live graph refresh on `wiki_page_changed`

**Why:** the KB tab should track live wiki edits without manual reload.

**Files:**
- `apps/sigil/workbench/index.html`

- [ ] Subscribe workbench to `wiki_page_changed`.
- [ ] Debounce refreshes.
- [ ] On refresh, refetch `/wiki/.graph` and post `wiki-kb/graph` to the direct-mounted component.
- [ ] Do not invent a new daemon event or channel for graph state.

**Verification:**

```bash
./aos show post --id sigil-workbench --event '{"type":"tabs/activate","payload":{"name":"wiki-kb"}}'
printf '%s\n' $'---\ntype: concept\nname: KB Live Reload Smoke\ndescription: smoke\ntags: [smoke]\n---\n\n# KB Live Reload Smoke' > ~/.config/aos/repo/wiki/test/kb-live-reload-smoke.md
```

Expected: the KB tab updates within the debounce window and shows the new node.

---

## Phase 4 — Agent-facing presentation and Sigil-owned sync

### Task 8: Add a high-level reveal/present command path

**Why:** agents should be able to say “show this knowledge item” rather than manually coordinate tab switches and node selection.

**Files:**
- `src/commands/wiki.swift`
- possibly `src/shared/command-registry-data.swift`

- [ ] Add a presentation-oriented convenience command, likely:
  - `aos wiki reveal <path>`
- [ ] Implement it by sending semantic events to the running workbench:
  - `tabs/activate`
  - `wiki-kb/reveal`
- [ ] Keep the CLI thin. The workbench fans out UI effects.

**Verification:**

```bash
./aos wiki reveal employer-brand-profile
```

Expected: the running workbench switches to KB and reveals the requested node.

### Task 9: Add Sigil-owned avatar context sync

**Why:** KB surfaces are human-facing and agent-facing. When requested, Sigil should be able to mirror KB selection into avatar/context presentation without leaking UI mechanics back to the agent.

**Files:**
- `apps/sigil/workbench/index.html`
- Sigil renderer/control path only if a new intent receiver is required

- [ ] Define a Sigil-owned semantic payload:
  - `sigil/context-focus { target: { kind: "wiki-page", path, type, name }, mode }`
- [ ] Add a workbench-level toggle for whether KB selection should mirror to Sigil.
- [ ] When enabled, transform `wiki-kb/selection` into the Sigil context-focus intent.
- [ ] Keep payloads coordinate-free.

**Verification:**

1. Enable sync.
2. Select a KB node.
3. Confirm the avatar/renderer receives the semantic context intent and updates accordingly.

Expected: KB selection drives Sigil presentation without the agent needing to script panning/highlighting details.

---

## Documentation and follow-through

- [ ] Update `docs/api/toolkit.md` for the new `wiki-kb` intents/events and `tabs/activate`.
- [ ] Update `docs/api/aos.md` / `src/CLAUDE.md` for `aos wiki graph` and `aos wiki reveal`.
- [ ] If the issue is closed by this plan, add a closing note similar to other plan docs referencing the plan path.

---

## Exit criteria

- `aos wiki graph --json` exists and is trustworthy after live wiki writes.
- canvases can fetch the same graph projection over `/wiki/.graph`.
- Sigil workbench has a working KB tab backed by the canonical payload.
- agents can reveal a wiki node semantically via control surface, not graph mechanics.
- any avatar sync remains Sigil-owned and coordinate-free.

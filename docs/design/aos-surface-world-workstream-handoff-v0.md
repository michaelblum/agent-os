# AOS Surface / One-World Workstream — Handoff & Backlog (v0)

**Status: Continuity doc.** Entry point for any model or session (Claude, Codex,
Gemini, etc.) picking up this workstream. Big-picture, not fine-grained. Read
this first, then the two artifacts it points to.

Date: 2026-06-05

---

## 0. How to use this doc

This is the umbrella for two pieces of work that share one throughline. It exists
so a fresh session does **not** have to re-derive the analysis or re-spelunk the
code. If you are starting cold:

1. Read this doc (orientation + backlog + guardrails).
2. Read the two artifacts in §2.
3. Use the code anchors in §6 instead of re-searching.
4. Respect the guardrails in §7 — they are what kept the analysis honest.

---

## 1. The throughline (big picture)

Two questions, one arc:

- **Transport review** asked: why is the stacked scenario (Surface Inspector +
  avatar compact panel + slider drag) at risk of jank? Finding: the platform
  already has the right *parts* (render-loop cost classification, slider
  change/commit, the visual-object descriptor contract, routed-input identity,
  telemetry), but **the contract between layers is too coarse** — preview/commit
  and cheap/structural distinctions live only at the edges and are dropped in the
  transport middle; the daemon fans input out to every canvas with no coalescing.
- **One-World reframe** (owner-driven) asked: is there a simpler architecture?
  Finding: yes — most transport pain is the *tax of process separation*
  (`publishState`/snapshots/cross-canvas messages exist only because owner and
  observer are in different heaps). **Co-locate first-party surfaces in one
  "World" (one heap, one scene, one app) and that whole category deletes itself.**

The reframe *subsumes* the review: the review's directions (shared scheduler,
signals core, descriptor binding) become **local in-heap concerns** in the World,
and only two seams still need coalescing/backpressure — daemon→World input, and
cross-display / Browser-Host sync.

---

## 2. Artifacts (read these next)

- **`docs/dev/reports/aos-surface-transport-architecture-review-v0.md`** —
  descriptive review of the current transport/render/coalescing situation, with
  a measurement-first decision space (Directions A–F). Grounded in file:line.
- **`docs/design/aos-one-world-architecture-proposal-v0.md`** —
  **Proposal, NOT accepted.** The "AOS is one world, not an OS" reframe: two-layer
  model (daemon = privileged hands / the World = unified Canvas Host), focus model,
  what survives, what we trade, the extension-API long pole, and an ADR/CONTEXT
  triage (all triage rows are *proposals* for a future owner-approved governance
  pass).

---

## 3. Current state: decided vs proposed vs open

- **Owner-accepted (axioms):** AOS is a coherent world, not an OS; the World sits
  **above everything except (maybe) screensaver**; we **trade away OS-native
  window interleaving** (future workarounds noted: drive real app windows via AX
  `do`; per-node clip/alpha tricks).
- **Proposed, NOT accepted:** the entire One-World architecture and the ADR/CONTEXT
  triage. Do **not** treat these as decided (see guardrails §7).
- **Open / unknown (the long pole):** a **World extension API + theming contract**
  — the thing the owner's "make your own panels/forms/dashboards/widgets,
  custom-themed" goal entirely depends on. It does not exist yet. "Extend by
  programming against the World" is only as real as this API.

---

## 4. Sequenced next steps (cheapest-first; do NOT skip ahead)

1. **Measure the separation tax — no World code.** Instrument the *current* avatar
   owner ↔ detached compact panel path; count `control_change` / queued `snapshot`
   / `publishState` per second during a slider drag. Pure measurement; validates
   the One-World premise before anyone writes World code.
2. **Confirm the cost model's inputs.** Count live `input_event` subscribers
   during the stacked scenario — the parked card hints at *duplicate* Avatar/Sigil
   surfaces, so N (fan-out multiplier) may be *wrong*, not just un-coalesced. Fix
   correctness before optimizing.
3. **Confirm the render over-mark.** Check whether scale-drag frames report
   `structural` and what the structural branch *emits* (overlay redraw + publish
   are unconditional; the hit-region sync is diff-guarded). Decides "decompose the
   coarse bundle" vs "render is fine."
4. **The co-location probe** — only if (1) shows deletable traffic: prototype the
   pair as two layers in one document binding to a shared signal store; confirm
   traffic → ~0. (Caveat: presupposes some World substrate, so it partly builds
   what it de-risks — that's why (1) comes first.)
5. **Sketch the World extension-API + theming contract** (§3 long pole).
6. **Then** a deliberate, owner-approved governance pass (the §9 triage in the
   proposal): invert ADR-0012; re-register 0005/0008/0011/0004/0014 in World
   vocabulary; full-read the provisional-orthogonal ADRs; resolve CONTEXT.md term
   collisions and add World/scene vocabulary; collapse ARCHITECTURE's 3-layer
   surface ownership to 2.

---

## 5. Backlog — future items that must NOT fall into a memory hole

> The owner specifically flagged the CDP overlay item below. Keep this list live;
> convert items to GitHub issues / work cards as they get routed.

- **★ Browser-overlay CDP geometry stream (scroll-locked overlays).** Today AOS
  browser overlays are native canvases anchored to the Chrome *window*
  (`anchor_window + offset`) — they follow window move but **not page scroll**
  (re-anchor manually). The future upgrade: subscribe to CDP layout/scroll events
  and stream element rects so the overlay tracks scroll — i.e. **treat browser
  element geometry as a "fast input signal"** into the World, same model as
  cursor / `display_geometry`. This makes browser overlays first-class World
  nodes. *Owner explicitly does not want this lost.*
- **Drain-paced daemon input coalescing** (review Direction A): per-canvas
  backpressure (at most one pending `input_event`, last-write-wins), opt-in raw.
  Pure mechanism, ADR-0015 intact. Gated on step 4.1 measurement.
- **Decompose the coarse structural render bundle** (review §2.3/§4B): overlay
  redraw + `publishState` are unconditional on a structural frame; a transform
  edit (e.g. scale) over-marks structural. Separate the flags so cheap edits run
  only what they need. Gated on step 4.3.
- **Preview/commit protocol class** (review Direction C): tag messages as
  coalescible signal vs reliable commit. Snapshots/echoes are commit-class, not
  preview-rate.
- **Shared interaction scheduler / priority tiers** (review Direction D):
  interaction > app render > diagnostics. In the World this is local.
- **Retire `sigil.avatar_panel.*`; promote the visual-object descriptor contract**
  (review Direction E): add the owner→view accepted-state echo + origin identity
  (the control-level silent `setValue` exists; the *protocol* echo is the gap).
- **Reactive signals core** (review Direction F / World extension API): fine-grained
  signals (Solid/Svelte-runes/Vue-refs/Angular-signals/TC39 model), prefer a tiny
  standalone lib over hand-rolling. NOT a framework (per ADR-0012's warning).
- **Visual-object descriptors → in-heap scene primitives** (ADR-0014 reinterpreted
  under One-World).
- **Sigil-as-content migration** (separate, larger track): avatar renderer becomes
  entities in the World; has a parked work card with observability/placement
  prerequisites — `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.
- **Focus model implementation** (proposal §4): focus-group manager, two Tab loops
  (intra-panel trap + panel-switch gesture), per-panel focus memory,
  passthrough-drives-key-window seam, agent-non-stealing-by-default.
- **OS-interleaving workarounds** (future, only if needed): drive real app windows
  via AX `do`; per-node clip/alpha tricks in the display graph.
- **CONTEXT.md term collisions**: "Layer" (subject-expression vs visual),
  "Control" (already triple-booked: verb / Layer / `toolkit/controls/` widget),
  "surface" (CONTEXT already flags it overloaded). Resolve when adding World/scene
  vocabulary.

---

## 6. Code anchors (use these instead of re-searching)

Bridge & transport
- WKWebView bridge (post / `headsup.receive` / base64): `apps/sigil/renderer/live-modules/host-runtime.js`
- Daemon input fan-out (no coalescing): `src/daemon/unified.swift` → `forwardInputEventToCanvases` (799–811), `broadcastInputEvent` (3494)
- Canvas eval delivery (main-thread): `src/display/canvas.swift` → `postMessageAsync`/`evalAsync` → `DispatchQueue.main.async { evaluateJavaScript("window.headsup.receive(…)") }` (2299–2308)

Render path
- Frame classification: `apps/sigil/renderer/live-modules/render-loop.js` → `classifyRenderLoopWork`
- `scheduleRenderFrame` defaults `structural=true`: `apps/sigil/renderer/live-modules/main.js:536`
- Structural block (overlay.draw 5016, publishState 5057, `polyGroup.scale.setScalar` 5056 — scale is outside the gate): `main.js:5001–5057`
- Scale descriptor (route `transform.patch`, `rendererSync: avatarScale`): `apps/sigil/avatar-controls/descriptors.js:207`, hook 365–367
- Diff-guarded hit-region sync: `apps/sigil/renderer/live-modules/hit-target.js:84–128`, `packages/toolkit/runtime/desktop-world-hit-region.js:169–189`
- Owner subscribes `input_event`: `main.js:4729`

Controls / panel / routing
- Slider change vs commit + silent setValue: `packages/toolkit/controls/slider.js:163–190, 300–309`
- Panel drag uses uncoalesced daemon global input: `packages/toolkit/panel/chrome.js` → `wireDrag` (1608+)
- Owner-side routing + dedupe + publishSnapshot: `apps/sigil/avatar-controls/compact-surface-session.js:80`

Browser overlay
- Native window-anchored overlay (not page-injected): `src/browser/anchor-resolver.swift`, `canvas.swift:819`

Governing docs
- `ARCHITECTURE.md` (surface ownership boundary §, Union/DesktopWorld §5)
- ADRs: 0012 (inverts), 0011/0015 (sharpen), 0005/0008/0004/0014 (survive-reinterpreted), 0001/0010 (term collision), others orthogonal
- `CONTEXT.md` (governed vocabulary: Subject/Facet/Host/Layer/Control), `CONTEXT-MAP.md` (routing)

---

## 7. Guardrails (keep a fresh session on the rails)

- **The One-World proposal is a PROPOSAL.** Do not start ripping out ADRs or
  editing CONTEXT/ARCHITECTURE. Governing-doc edits wait for the owner-approved
  governance pass (step 4.6). Per `AGENTS.md` change control, these are not
  casually edited.
- **Measure before architecting.** Do not build the scheduler (D), daemon
  coalescing (A), or the bundle decomposition (B) before the §4 measurements say
  which cost is real. The transport review is a *decision space*, not a build plan.
- **Verify load-bearing claims against code before asserting.** This session was
  twice caught with prose outrunning evidence (a render-traffic claim; an
  "untouched ADRs" claim). The fix each time was a 2-minute read. Do the read.
- **Don't over-build reactivity.** ADR-0012 warns against a bespoke framework;
  prefer a tiny signals core / standalone lib.
- **Keep durable artifacts in the repo**, not in chat or model-local memory, so
  any agent stack can continue.

---

## 8. Recommended working model (cheap driver + strong advisor)

The owner wants to run a cheaper driver (e.g. Sonnet) with a stronger model
(Opus-class) jumping in occasionally for advisory work. **This session already
ran exactly that pattern** — a driver doing the work, calling a stronger-model
**`advisor`** at checkpoints — and the advisor materially improved every artifact.
So:

- **In Claude Code:** drive with Sonnet (`/model`), and call the **`advisor` tool**
  (stronger reviewer) at these checkpoints — it is the cheap way to get Opus-class
  judgment without running Opus throughout:
  - before committing to an interpretation/approach,
  - before declaring an artifact done (make it durable first),
  - when stuck or considering a change of approach.
- **In other stacks (Codex/Gemini/etc.):** same discipline — get a stronger-model
  review at those same checkpoints; they just won't have the `advisor` tool by
  name. Keep the durable docs as the shared substrate.
- **What the advisor is for here:** framing, scope (it shrank the "reconsider
  everything" blast radius to ~one ADR), and catching unverified claims. Use it on
  framing/architecture decisions, not on mechanical edits.

---

## 9. One-line status for the next session

> Two durable artifacts written (transport review + One-World proposal). Proposal
> is *not accepted* — next is measurement (§4.1–4.3), not building. Long pole is
> the World extension-API + theming contract. Don't lose the CDP browser-overlay
> geometry-stream item (§5 ★).

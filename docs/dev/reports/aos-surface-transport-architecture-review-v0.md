# AOS Surface Transport and Fast-Signal Architecture Review V0

Date: 2026-06-05

Reviewer role: outside technical reviewer.

Companion to: `docs/dev/reports/aos-surface-transport-performance-observations-v0.md`
(the descriptive observations report). This document is an independent read. It
is descriptive and decision-oriented, not an implementation plan. Where it names
directions, it pairs them with the measurement that should decide whether to
take them.

The grounding for every load-bearing claim below is a specific code path; file
and line references are inline so the claims can be checked or falsified.

---

## 0. How this maps to the seven asks

| Ask | Section |
| --- | --- |
| 1. Independent read + where the real friction is | §1, §2 |
| 2. Promising directions with tradeoffs | §4 (decision space) |
| 3. Privileged/native vs toolkit/JS boundary | §5 |
| 4. Toolkit APIs familiar to React/Vue/Svelte/Angular, kept simple | §6 |
| 5. Sigil/Avatar as showcase + reusable model | §7 |
| 6. Performance principles/contracts for the stacked scenario | §8 |
| 7. Risks, open questions, evidence to gather first | §3 (lead), §9 |

§3 (what to measure first) is deliberately near the front, not the back: the
diagnosis below narrows to a small number of branch points, and three cheap
measurements decide which branch is real. The directions in §4 are written as
conditional branches off those measurements, not as a committed roadmap.

---

## 1. Independent read: the pieces mostly exist; the *contract between them* does not

The strongest and most surprising finding is that this is **not a "missing
primitives" problem**. The platform already contains most of the machinery a
smooth stacked scenario needs:

- **Render-side cost classification already exists.** `render-loop.js`
  (`classifyRenderLoopWork`, lines 34–66) distinguishes `visualOnly`,
  `cheapFrame`, `overlay`, `publishState`, and `structural` work, and
  `createRenderLoopScheduler` (68–138) coalesces to a single queued frame via
  the host `requestFrame` with optional `delayMs`. `selection-mode-runtime.js`
  already opts into the cheap lane with `scheduleRenderFrame({ structural: false })`
  in ~10 places.
- **Control-side preview/commit already exists.** The toolkit slider
  (`controls/slider.js`) emits `change` on every value change and `commit` on
  value-change-end (163–190), and supports a silent programmatic update
  (`setValue(value, { emit: false })`, 300–309; `suppressAdapterChange`, 124,
  284–286). The loop-prevention primitive is present at the control edge.
- **A reusable descriptor/binding contract already exists.** ADR-0014
  (`aos.visual_object.descriptor.v0`) plus
  `packages/toolkit/workbench/visual-object-*.js` define caller-owned routes,
  ordered renderer-sync handlers, form-field binding, and a resource-lifecycle
  evidence contract.
- **Identity metadata for loop-safety already exists** in the routed-input v2
  envelope: `gesture_id`, `capture_id`, `source_canvas_id`, `owner_canvas_id`,
  `source_sequence`, `coordinate_authority` (`runtime/input-events.js`,
  192–221).
- **Telemetry surfaces already exist**: `components/render-performance`,
  `components/spatial-telemetry`, `components/surface-inspector`,
  `runtime/canvas-stats.js`.

The friction is that **these distinctions live only at the two edges — the
control and the renderer — and are never carried through the transport middle.**
The edit-intent → cross-canvas message → owner-descriptor → render-schedule path
does not propagate "this is a coalescible preview" vs "this is a reliable
commit," nor "this is a cheap transform" vs "this is structural." Each layer
re-derives (or fails to derive) its own pacing. There is no shared rate,
priority, or backpressure contract that spans input → toolkit → render → daemon.

A second-order consequence sharpens it: because the cost class is not
propagated, a *cheap* edit is silently promoted to a *structural* one, and the
structural render frame runs a **coarse bundle** of work — diff-guarded
hit-region sync, plus unconditional overlay redraw and state publish — fused
behind a single default-true flag (§2.3). The render gap is therefore not a
separate problem from the transport story; both are instances of one pattern: the
contract between layers is too coarse to carry "how cheap is this edit, really,
and which downstream work does it actually require."

---

## 2. The stacked scenario, decomposed into independent loops

The scenario (Surface Inspector visible + minimap mouse display on + avatar
visible + compact controls panel visible + dragging the scale slider) is not one
hot path. It is at least **two concurrent high-frequency loops on different
channels plus a render path**, and which one dominates the jank is a measurement
question, not something to assert up front.

Assumption stated explicitly: "compact controls panel visible" is read here as
the **detached** panel (its own canvas, cross-canvas messaging). The **embedded**
path (compact surface mounted in the renderer DOM) removes Loop 2's cross-canvas
hops but keeps the same render behavior of §2.3 and drives the slider from local
DOM events. The two paths differ enough that the scenario should specify which is
under test.

### 2.1 Loop 1 — cursor → input fan-out (the *physical* mouse moving)

While the user drags, the cursor is physically moving, so the CGEvent tap is
producing `mouse_moved`/`left_mouse_dragged` at device rate. In the daemon:

- `handleInputEvent` → `broadcastInputEvent` (`unified.swift`, 3454–3514).
- `broadcastInputEvent` writes the envelope to every socket subscriber fd, then
  calls `forwardInputEventToCanvases` (799–811).
- `forwardInputEventToCanvases` iterates **every canvas subscribed to
  `input_event`** and calls `canvasManager.postMessageAsync(canvasID, payload)`
  per canvas — which becomes `evalAsync` →
  `DispatchQueue.main.async { webView.evaluateJavaScript("window.headsup.receive('<base64>')") }`
  (`display/canvas.swift`, 2299–2308, 2307–2308).

So input fan-out is **O(events × subscribed canvases)** with **no coalescing**:
no rate cap, no last-write-wins, no per-frame merge. In the scenario, the
subscribers receiving every `mouse_moved` include the Surface Inspector and the
Sigil owner renderer (confirmed: `main.js:4729` subscribes `input_event`
continuously); each does a base64 decode + `JSON.parse` + normalization + its own
redraw scheduling per event.

Honesty about *where* this costs: WKWebView is multi-process, so each canvas's JS
handler runs in its own web-content process, not the daemon main thread. The
daemon main thread pays N `evaluateJavaScript` dispatches per event (marshalling
+ run-loop occupancy on the same thread that also services `canvas.update` window
moves and `canvas.send` relays); each content process pays its own decode +
handle; and there is daemon↔content IPC per call. **The bottleneck location
(daemon run-loop saturation vs per-WebView decode vs IPC) is genuinely
non-obvious and must be measured before it is optimized.**

### 2.2 Loop 2 — slider → owner (the *control* changing)

Inside the (detached) compact panel, the Zag slider is driven by WebKit DOM
pointer events, which WebKit coalesces toward frame rate. But each `change`:

- emits `change` (`slider.js`, 178–183) and schedules a microtask `bindAll()`
  that re-runs all Zag bindings (`scheduleBindAll`, 254–261; `bindAll`, 239–252);
- in the detached panel, produces a `sigil.avatar_panel.control_change` over
  `canvas.send` (a renderer→daemon→owner cross-canvas hop, via the same
  `postMessageAsync` path as Loop 1);
- and the panel queues a **snapshot after change**, i.e. a *second* cross-canvas
  message family (`sigil.avatar_panel.snapshot`).

On the owner side, `routeChangedControls`
(`avatar-controls/compact-surface-session.js`, 80–96) de-dupes against a value
cache (good — repeated identical values are dropped), routes the descriptor, then
on change calls `syncState()` **and** `publishSnapshot()`. So a moving slider can
produce, per accepted value: one inbound control message, one descriptor apply,
one owner render schedule, and one outbound snapshot — a round-trip plus a
fan-back, on the same daemon thread Loop 1 is using.

### 2.3 The render path — a cheap edit wearing a structural costume

This is the most actionable single finding, and it ties Loops 1 and 2 together.

- The mother-scale slider descriptor routes `canvas_object.transform.patch` with
  `rendererSync: avatarScale` (`avatar-controls/descriptors.js`, 207).
- The `avatarScale` hook is **cheap**: it only writes
  `context.state.baseScale = computeBaseScale(value)` (365–367). No geometry
  rebuild.
- The scale is applied **unconditionally** every frame as a Three.js group
  transform: `state.polyGroup.scale.setScalar(state.baseScale * …)`
  (`main.js`, 5056). This is matrix-only — exactly the cheap path the render loop
  is built to support.
- **But** `scheduleRenderFrame` defaults to structural:
  `if (options.structural !== false) structuralFrameDirty = true` (`main.js`,
  536–539). And `structural: false` appears **nowhere** in `avatar-controls/` or
  `avatar-editor/`; the avatar descriptor path calls bare `scheduleRenderFrame()`.

So every accepted scale value marks `structuralFrameDirty`, and the gated
structural block (`main.js`, 5001–5015) runs **every frame of the drag** even
though the scale itself only needed line 5056. That block, plus the adjacent
gated work, bundles three *separable* concerns behind one flag:

1. **Hit-region geometry sync** — `updateSegmentPosition()`, and either
   `syncWorldRect(interactiveBounds())` or `syncHitTargetToAvatar()` →
   `syncSigilInputRegions()`. **This is diff-guarded** and is *not* a per-frame
   daemon-traffic source during a stationary scale drag: `hit-target.js`
   no-ops `setSize` when size is unchanged (124–128) and returns a `changed`
   boolean from `controller.sync` (84–90); the toolkit controller
   (`desktop-world-hit-region.js`, 169–189) only calls `postUpdate(payload)` when
   `surface.setPlacement(...)` reports a change. So `input_region.update` fires
   only when the avatar's interactive region actually moves/resizes. (Note: in
   the **detached-panel** path `interactiveBounds()` returns `null`
   (`surface.js`, 1246), so the region tracks `avatarPos`/`avatarHitRadius`, not
   `baseScale` — a stationary-avatar scale drag emits little or nothing here.)
2. **Overlay redraw** — `overlay.draw(...)` (5016), gated only by `work.overlay`,
   runs unconditionally whenever the frame is structural, regardless of whether
   the overlay content changed.
3. **State publish** — `desktopWorldSurface.publishState(...)` (5057), gated only
   by `work.publishState`, likewise unconditional.

The scale transform itself (`polyGroup.scale.setScalar`, 5056) is **outside** the
structural gate and runs every frame cheaply regardless.

**Corrected unifying insight (the earlier draft of this section overstated it):**
the over-mark does *not* reliably flood the daemon with input-region traffic —
that path is correctly diff-guarded. The real defect is that **the structural
bundle is too coarse**: hit-region geometry (cheap, diff-guarded, sometimes
genuinely needed), overlay redraw (unconditional), and state publish
(unconditional) are fused behind a single default-true `structuralDirty` flag. A
transform-rate edit that over-marks structural therefore pays the unconditional
overlay redraw and state publish every frame for no benefit, and re-runs the
diff checks for work it usually doesn't need. The cost is wasted CPU/redraw and a
possible per-frame `publishState`, not guaranteed bridge congestion.

This matters for the fix (see §4B): the naive "`transform.patch` ⇒
non-structural" relabel is **too blunt**, because some transform edits (any that
move or resize the avatar's interactive region) legitimately need the
diff-guarded hit-region sync, and blanket-marking them cheap would leave clicks
landing on stale bounds mid-drag. The sharper fix is to **decompose the coarse
bundle** so a cheap edit can run the (already diff-guarded) region sync without
also forcing the unconditional overlay redraw and publish. Either way the lesson
is the same: the distinction exists at the edges and is dropped in the middle.

---

## 3. What to measure first (the center of gravity)

Before committing to any direction in §4, three measurements discriminate the
branches. They are cheap, and an outside reviewer should insist on them because
the diagnosis above contains at least three candidate "primary costs" (input
fan-out, cross-canvas chattiness/snapshot duplication, structural over-mark) and
the existing evidence (a passing hit-test unit test) speaks to none of them.

1. **Per-canvas input delivery under the live scenario.** Count, per second:
   `mouse_moved` events leaving the tap; `forwardInputEventToCanvases` targets
   (i.e. how many canvases are actually subscribed to `input_event`); and per
   target, the `evaluateJavaScript` dispatch count and completion latency.
   - *Discriminates:* Is Loop 1 real, and is it daemon-thread-bound or
     content-process-bound?
   - *Cheapest precursor:* just log the **subscriber count**. The parked work
     card `gdi-sigil-avatar-panel-resource-contract-migration-v0.md` already cites
     "duplicate Avatar/Sigil surfaces across displays." If N is *wrong* (phantom
     or duplicated subscribers), the first fix is subscriber-set correctness, not
     fan-out coalescing. **Verify the cost model's inputs before redesigning the
     model.**

2. **Cross-canvas message rate, split by kind.** Count `canvas.send`/sec during a
   slider drag, separated into `control_change` vs `snapshot`. If `snapshot`
   roughly equals `control_change`, the snapshot-after-change path is doubling
   Loop 2's transport for no interactive benefit (snapshots are an
   accepted-state echo and need not run at preview rate).
   - *Discriminates:* Loop 2 chattiness, and specifically whether snapshot
     duplication is a real cost.

3. **Frame classification *and what the structural branch emits* during the
   drag.** Read `liveJs.renderLoop.work` (`main.js`, 4992–4998) to confirm
   scale-drag frames report `structural: true` (§2.3 predicts yes), then — more
   importantly — count what that branch actually *does* per frame: `overlay.draw`
   invocations, `publishState` invocations, and whether any `input_region.update`
   fires. §2.3 predicts the region sync is diff-guarded to near-zero and the
   overlay/publish work is the real per-frame cost; confirming this is what
   tells you to *decompose the bundle* (§4B) rather than relabel the route.
   - *Discriminates:* coarse-bundle over-mark vs render-is-fine, and *which part*
     of the bundle is the cost.

These three together tell you whether the dominant cost is Loop 1 (fan-out), Loop
2 (cross-canvas + snapshot), or the render over-mark — which is the choice the
entire decision space hinges on. `render-performance`, `spatial-telemetry`, and
`canvas-stats` already exist to host (1) and (3); (2) needs a daemon-side counter
on `postMessageAsync` keyed by message type.

---

## 4. Decision space (conditional, not a roadmap)

Each direction is tagged with the measurement that should trigger it. Several are
complementary; none should be built ahead of its trigger.

### A. Drain-paced backpressure coalescing of native input fan-out
*Trigger:* measurement (1) shows Loop 1 dominates **and** subscriber-set is
correct.

The daemon already owns the input stream and is the only place that can drop or
merge an event *before* paying the per-canvas eval/IPC cost. The key design
constraint (and the reason this is viable under ADR-0015) is to make it **pure
mechanism, never policy**: the daemon does **not** choose a Hz or a frame rate.
Instead, per subscribed canvas, it holds **at most one pending `input_event`**
and replaces it last-write-wins if that canvas's previous `evaluateJavaScript`
has not completed. It never accumulates a backlog at an undrained consumer.

- *Why this shape:* it is exactly apt for the multi-process model in §2.1 —
  delivery is paced to each content process's *actual* drain rate rather than
  queuing 90 evals/sec at a process that drains 60. It directly realizes the
  observations report's "predictable backpressure" principle.
- *Tradeoff:* a consumer that needs every raw sample (e.g. velocity/gesture
  integration) must opt out. So this must be an **opt-in subscription mode**
  (`input_event` vs `input_event:raw`), defaulting to coalesced.
- *Risk:* changes delivery semantics; needs the raw escape hatch and tests that
  prove last-write-wins preserves the final position and the up/cancel terminal
  events (never coalesce a terminal phase away).

### B. Decompose the coarse structural bundle (and give edits a cost class)
*Trigger:* measurement (3) confirms scale-drag frames are `structural` and that
the unconditional overlay/publish work (not the diff-guarded region sync) is the
cost.

§2.3 shows the structural flag fuses three separable concerns: diff-guarded
hit-region sync (sometimes needed), unconditional overlay redraw, and
unconditional `publishState`. The fix is **not** the blunt "`transform.patch` ⇒
non-structural" relabel — that would skip a region sync a bounds-affecting
transform legitimately needs and leave clicks on stale bounds. The fix is to
**separate the flags** so a cheap edit can run the (already cheap, diff-guarded)
region sync while overlay redraw and state publish are gated on their own
change-detection or commit phase rather than on `structuralDirty`. The descriptor
can then carry a cost class (an extension of ADR-0014) that schedules only the
work an edit actually requires.

- *Why high-confidence:* the render machinery is already correct
  (`classifyRenderLoopWork` distinguishes the lanes); the gap is that the avatar
  path collapses them onto one default-true flag.
- *Tradeoff:* requires expressing per-edit cost/affected-work in the descriptor
  contract; clean extension, but it must be explicit per route and tested.
- *Risk:* getting the decomposition wrong (e.g. gating a needed region sync on the
  wrong signal) reintroduces stale-bounds bugs; this is why measurement (3) must
  confirm *which* part of the bundle is the cost before touching it.

### C. A protocol-level preview/commit (signal vs intent) message class
*Trigger:* measurement (2) shows snapshot/preview duplication, or (1)+(2) show
the same un-prioritized channel carrying both diagnostics and edits.

Make explicit at the transport contract what currently lives only at the slider
edge: a **signal** class (coalescible, droppable, last-write-wins, may be merged
per frame) vs a **commit/intent** class (reliable, ordered, never dropped).
Snapshots and accepted-state echoes are commit-class and need not run at preview
rate; `control_change` during drag is signal-class.

- *Tradeoff:* this is the most invasive contract change and should not precede
  A/B; it is the generalization that makes A and the §8 contracts uniform across
  consumers rather than per-surface.
- *Risk:* over-generalization. Keep it to a tag on existing messages, not a new
  channel, until measurement shows the tag is insufficient.

### D. A shared interaction scheduler / priority governor in the toolkit runtime
*Trigger:* measurement shows multiple consumers (Surface Inspector minimap +
slider + render) competing within a frame, not a single dominant cost.

Generalize what `render-loop.js` does well to the whole surface: a small toolkit
primitive every high-frequency producer funnels through (input handling,
diagnostic redraws, drag geometry), coalescing to the host `requestFrame` with
explicit priority tiers — **interaction > app render > diagnostics** — so the
Surface Inspector minimap yields to active editing under load.

- *Tradeoff:* adds a layer every consumer must adopt; risk of premature
  abstraction. Do **not** build this before measurement shows contention; if one
  cost dominates, fix that cost (A or B) first.

### E. Promote the visual-object descriptor contract to the canonical two-way
binding model; retire `sigil.avatar_panel.*`
*Trigger:* independent of perf — this is coherence/showcase debt — but gated
behind the parked work card's prerequisites (surface-orphan / cross-process /
input-tap-observability audits), which are exactly the §3 measurements.

The detached panel uses a private `sigil.avatar_panel.*` vocabulary
(`avatar-editor/panel.js`) where ADR-0014's descriptor/controller/form contract
already covers the shape. Migrating closes the "showcase app shouldn't be a
private fork" gap (§7) and lets preview/commit + cost class be expressed once in
the generic contract.

- *Precision on loop-safety:* the **control-level** silent update already exists
  (`setValue({ emit:false })` / `suppressAdapterChange`). The gap is the
  **protocol** carrying origin identity (the `gesture_id`/`source_canvas_id`
  already in routed-input v2) so the owner can echo accepted state to *other*
  views without echoing back to the originator. State it precisely: the control
  primitive exists; the echo/identity plumbing through the panel protocol is
  what's missing.

### F. Reactive first-party authoring core
*Trigger:* product/ergonomics, not perf (see §6).

---

## 5. The native vs toolkit/JS boundary

The existing boundary (ARCHITECTURE.md §"Surface Ownership Boundary"; ADR-0015) is
sound and should be the tie-breaker. The performance work tests it precisely
once, and there is a clean rule:

- **Native/daemon keeps:** input capture, canvas/window lifecycle, native frame
  mutation, display topology, content serving, and the socket/eval transport.
  **Add exactly one new native capability:** generic *delivery mechanics* —
  drain-paced coalescing of high-frequency native→canvas delivery (Direction A).
  This belongs native because only the daemon sits before the per-canvas eval/IPC
  cost and can drop/merge cheaply. It stays "boring" by being mechanism only
  (last-write-wins, no chosen rate, no product semantics, opt-in raw).
- **Toolkit keeps and gains:** priority *policy* (interaction > render >
  diagnostics), the preview/commit and cost-class *semantics*, the
  descriptor/controller/binding model, panel/window policy, and the reactive core
  (§6). Policy and semantics are explicitly *not* the broker's job per ADR-0015.
- **Apps keep:** domain state, content, theming, renderer specifics (Three.js
  pools stay renderer-local per ADR-0014's retained limits).

The boundary test, stated as a one-liner for future calls: **"how often events
cross the bridge" is a native mechanism; "what a preview vs a commit means and
who is allowed to act on it" is toolkit/app policy.** Coalescing identical
high-frequency events by last-write-wins is mechanism. Deciding that a scale edit
is cheap, or that diagnostics yield to interaction, is policy.

A caution the daemon evidence raises: do not let Direction A grow product
awareness. The daemon must not learn what a "slider" or an "avatar" is to decide
coalescing; it coalesces by `(canvas, event-type)` and drains. The moment it
needs to inspect payload semantics, the logic belongs in the toolkit.

---

## 6. Toolkit ergonomics: familiar to framework developers, still simple

This must be reconciled with ADR-0012 explicitly, or it reads as contradicting an
accepted decision. ADR-0012 already settled the *framework* question: surfaces
are runtime-agnostic HTML/JS at the daemon boundary; the platform contract is the
manifest + bridge message shape + subscriptions + readiness + tokens; third
parties may bring React/Vue/Svelte/Solid; the toolkit should **not** become a
bespoke component framework. None of that should be reopened.

So ask #4 is **not** "pick a framework." It is "what is the first-party authoring
*ergonomic* and the *binding model*, underneath the manifest/message contract?"
The answer the codebase is already reaching for is an **owner-mediated reactive
model**, and the right reference point is the **converging fine-grained signals
model** — Angular signals, Vue refs/`computed`, Solid signals, Svelte 5 runes,
and the TC39 Signals proposal have all converged on the same shape: observable
atoms, derived/computed values, and effects, with explicit reads/writes and no
virtual-DOM reconcile step.

That convergence is the argument: it is simultaneously (a) **familiar** to
developers from every major ecosystem, (b) **simple and explicit** in the way
ADR-0012 wants — no component lifecycle, no JSX requirement, no reconciler — and
(c) **the correct performance fit**, because fine-grained signals update exactly
the bound view slice with no diff pass, which is what a 60–120 Hz, 3D-coupled
edit needs. A VDOM/reconcile mental model (React's) is the *wrong* fit for this
workload and should not be the template even though it is the most famous.

Concretely, this is a **tiny reactive core**, not a framework:

- owner holds canonical model state as signals;
- views (slider, label, 3D handle, Surface Inspector readout) subscribe to slices
  via computed/effect;
- writes are owner-mediated: edit intent → owner validates/applies → dependents
  recompute → originator is suppressed by identity (§4E);
- it compiles down to the existing manifest/message contract — it is *under* the
  ADR-0012 boundary, not a replacement for it.

"Mirror, don't reinvent" (ARCHITECTURE.md) argues for adopting a small standalone
signals library (e.g. a TC39-Signals polyfill or an equivalently tiny
dependency-light core) over hand-rolling reactivity, and pairing it with the
existing `aos.visual_object.descriptor.v0` binding rather than inventing new
binding glue. The descriptor contract is already the "model"; signals are the
"reactive subscription"; the slider's `change`/`commit` is already the "event
phase"; owner descriptor routing is already the "owner-mediated update." The
pieces named in the observations report's principles section already map onto
this; they are just not yet unified behind one ergonomic.

---

## 7. Sigil/Avatar as showcase and reusable model

Sigil is positioned (ADR-0014; ARCHITECTURE.md component roster) as the reference
app, but in the area under review it currently demonstrates a **private fork**
(`sigil.avatar_panel.*`) rather than the reusable pattern. Making it the showcase
means making it the worked example of exactly the contracts above:

1. **Owner-canonical state with two-way binding** (§6): the avatar's 3D
   drag-handle and the compact slider both edit the same owner model; moving the
   handle moves the slider thumb and label without a feedback loop. The report's
   desired behavior is literally this; the primitives (descriptors, suppressed
   `setValue`, identity metadata) exist (§4E) and only need the protocol echo.
2. **Preview/commit + cost class made visible** (§4B, §4C): scale drag is the
   canonical "cheap preview that must not go structural" example; it is a good
   teaching case precisely because §2.3 shows the easy way to get it wrong.
3. **Retire the private vocabulary** (§4E) so a third-party app author can read
   Sigil and see the *normal* AOS way to build an editable visual surface, not a
   set of `sigil.*` messages they would have to reinvent.
4. **Ship a minimal "hello avatar" / "hello bound surface" template** that forks
   without reaching into renderer internals — the concrete proof of the
   extensibility principle. The existence of such a template is itself a test of
   whether the toolkit boundary is honest.

The sequencing constraint is real: the parked work card defers this migration
behind observability/placement prerequisites (duplicate-surface audits). Those
prerequisites are the same §3 measurements, so the showcase migration and the
performance investigation share a critical path and should be planned together,
not as competing tracks.

---

## 8. Performance principles/contracts for the stacked scenario

Stated as platform contracts (the report asks for performance to be a platform
requirement, not polish). These are the invariants the stacked scenario needs;
§4 are the mechanisms that satisfy them.

1. **One coalesced frame per surface per refresh.** Already true inside
   `render-loop.js`; the gap is at the transport edges (input fan-out, drag
   geometry), which Direction A/D would bring under the same rule.
2. **Priority tiers; diagnostics yield to interaction.** Surface Inspector
   minimap/annotation redraws are diagnostics and must run below active editing
   and rendering. They should never be on the critical path of a slider drag.
3. **Preview is lossy; commit is reliable.** Preview-rate signals may be dropped
   or merged last-write-wins; commits (final value, accepted-state echo,
   snapshot) are delivered exactly once and ordered. (§4C)
4. **Per-edit cost class; previews schedule only the work they require.** A
   transform/uniform edit should run its cheap path plus any diff-guarded region
   sync it genuinely needs — not the fused overlay-redraw + state-publish bundle
   (§2.3, §4B). Geometry/material rebuilds may be structural but should be
   commit-gated where possible.
5. **Native delivery is drain-paced, not event-paced.** Per-canvas backpressure,
   opt-in raw (§4A, §5).
6. **Feedback-loop safety by identity.** Echoes carry `gesture_id`/source so a
   view never re-applies its own edit (§4E). Terminal phases (up/cancel) are
   never coalesced away.
7. **Measured budgets, not vibes.** Each surface has an observable per-frame
   budget surfaced through the existing telemetry components; "smooth" is a number
   in `render-performance`, not a subjective claim. The existing unit test
   (`avatar-controls-hit-test`) is correctness coverage and explicitly does not
   establish any of this.

---

## 9. Risks, open questions, and the smallest useful next investigations

### Open questions (must be answered by evidence, not argument)
- **Where is the actual cost?** Daemon main-thread run-loop saturation vs
  per-WebView decode vs daemon↔content IPC (§2.1). The multi-process model means
  intuition is unreliable here.
- **Is N correct?** How many canvases are *actually* subscribed to `input_event`
  live? The work card's duplicate-surface hint suggests the cost model's input may
  be wrong before it is un-coalesced (§3.1).
- **Does scale-drag report `structural`, and what does that branch actually
  emit?** §2.3 predicts the frame is structural but the hit-region sync is
  diff-guarded to near-zero, leaving unconditional `overlay.draw` and
  `publishState` as the per-frame cost. Confirm via `liveJs.renderLoop.work` plus
  overlay/publish/`input_region.update` counts. Sub-question: does `publishState`
  cross segments or the bridge, or is it renderer-local?
- **Detached vs embedded:** which compact-panel path is the scenario actually
  exercising? The transport profile differs materially (§2).
- **Snapshot rate:** does `publishSnapshot()` run at preview rate during drag, and
  is that ever observed by a consumer that needs it at that rate?

### Risks of acting before measuring
- **Premature scheduler (Direction D)** before knowing whether one cost dominates
  — could add a layer that solves nothing.
- **Daemon coalescing semantics (Direction A)** breaking velocity/gesture
  consumers without a raw opt-out, or coalescing a terminal phase.
- **Over-building reactivity (Direction F)** — ADR-0012 explicitly warns against a
  bespoke framework; keep it a tiny core, prefer adopting a standalone signals
  lib.
- **Protocol churn (Direction C)** ahead of A/B — adds contract surface before the
  cheaper, higher-confidence fixes are in.

### Smallest useful next investigations (in order)
1. **Count `input_event` subscribers live** during the scenario (one daemon log
   line). Confirms or kills the duplicate-surface hypothesis. Cheapest, highest
   information.
2. **Instrument the three §3 measurements** (per-canvas eval count+latency;
   `canvas.send` split by `control_change`/`snapshot`; frame `structural` flag)
   using the existing telemetry surfaces.
3. **Confirm the structural over-mark and what it costs.** The avatar descriptor
   render path passes no `{ structural: false }` (already strongly indicated;
   §2.3). Pair that with measurement (3)'s emit-counts to confirm the cost is the
   unconditional overlay redraw + publish, not the diff-guarded region sync — the
   distinction that decides between *decomposing the bundle* and a simpler relabel
   (§4B). Highest confidence, lowest cost.
4. **Behind a flag, prototype drain-paced coalescing** on `forwardInputEventToCanvases`
   and measure the delta on (1)/(2) — only if (1)/(2) show fan-out dominates.

The throughline: the platform already has the right *parts* (cost classification,
preview/commit, descriptor binding, identity, telemetry). The work is to make the
*contract between them* explicit and shared, and to confirm with three cheap
measurements which seam to tighten first.

# AOS as One World — Architecture Proposal (v0)

**Status: Proposal for discussion — NOT accepted.**
Date: 2026-06-05

Register: this note is exploratory. It emerged from a live design conversation
following the surface-transport review
(`docs/dev/reports/aos-surface-transport-architecture-review-v0.md`) and is
**not** a ratified platform decision. Every ADR / CONTEXT / ARCHITECTURE change
described in §9 is a **proposal to be decided in a deliberate, owner-approved
governance pass**, per the change-control posture in `AGENTS.md`. Nothing here
should be treated as accepted direction or implemented without that pass.

---

## 0. Headline: "reconsider everything" collapses to essentially one ADR

This proposal started from a strong provocation: that the framework-neutral
toolkit decision (ADR-0012) is "an albatross around AOS's neck," and that we
should "throw it in the trash and re-consider all of the ADRs, CONTEXT-MAP,
CONTEXT."

**Having now read the full ADR set, the blast radius is far smaller than that
framing implied — and that is the most important finding in this note.** The
reframe is largely *expressible in the existing host-neutral vocabulary* that
ADRs 0005 / 0008 / 0011 already established. Concretely:

- **One ADR genuinely inverts: 0012.** Its load-bearing assumption — that the
  AOS "Canvas Host" is realized as *N independent, framework-agnostic,
  message-bus-isolated WKWebView surfaces* — is the thing the One-World model
  contradicts.
- **Two ADRs sharpen / are partly vindicated: 0011, 0015.** ADR-0011 already
  warns that "canvas-hosted only because the toolkit leans WKWebView is a design
  smell." The One-World model is the logical *endpoint* of that warning.
- **Several survive, reinterpreted in World terms: 0005, 0008, 0004, 0014.**
- **Two carry a vocabulary collision but no substantive change: 0001, 0010.**
- **The semantic / execution-model ADRs are orthogonal and untouched:** 0013
  (read in full), and provisionally 0002, 0003, 0006, 0007, 0009 (classified by
  title + decision line — confirm in the deliberate pass; see §9).

So the honest recommendation is **not** "burn the governance corpus." It is:
**collapse the Canvas Host from N isolated WKWebViews into one World, invert
0012, and re-register a handful of ADRs in World vocabulary.** The rest stands.

---

## 1. The axiom and what it buys

**Axiom: AOS is one coherent world, not an operating system.** It is not a
window manager that hosts independent surfaces; it is a single live scene/app —
closer to a game-engine editor, **Blender**, or Smalltalk **Morphic** ("a live
sandbox of building blocks you can poke") than to a desktop windowing system.

Why this is the simpler architecture, recast from the transport review: the
`publishState`, cross-canvas `canvas.send`, and `sigil.avatar_panel.snapshot`
machinery the review flagged as overhead exist **only because owner and observer
live in separate heaps**. They are the *tax of process separation*. Co-locate
first-party surfaces in one heap and that entire category of work **deletes
itself** — an observer reads the live object instead of a serialized copy; a
slider writes a shared signal the renderer already subscribes to.

The product owner has explicitly chosen this identity ("AOS is not a real OS and
shouldn't try to be one… a sandbox with building blocks") and explicitly
accepted the trade in §6. This note does not relitigate that axiom; it works out
its consequences.

---

## 2. The two-layer model

Today's surface model is three layers (daemon / toolkit-windowing / apps), and
the docs strain to say "the daemon is not a window manager" while building
minimize/maximize/drag/placement. The reframe cuts that knot — **there is no
window manager** — leaving two layers:

1. **The daemon — the privileged hands.** Native broker only: `see / do / show
   / tell / listen`, input *capture*, screen perception, window placement, TTS,
   display topology. It stops being a message bus between surfaces. **ADR-0015
   (TCC broker boundary) gets sharper**, not weaker: its job becomes
   unambiguous — native HOW, nothing else.
2. **The World — one heap, one scene, one app = the unified Canvas Host.** The
   old "toolkit vs app" split stops being a *platform boundary* and becomes a
   normal in-app concern: the World's **scene-kit / standard library** (controls,
   panels-as-regions, scene graph, effect/transform stack, theming) vs its
   **content** (Sigil's avatar, dashboards, widgets).

**The one boundary that cannot collapse**, because it is the whole point of
agent-OS: the World is **transparent and passthrough-by-default**, overlaid on
the *real* desktop, and the daemon arbitrates "does this click go to a World
region or to the real app underneath." AOS is a world whose level is your actual
screen; it must let real software receive input where AOS isn't. Default z-order:
**above everything except (possibly) screensaver.**

---

## 3. Reconciliation with the surface ADRs (the load-bearing section)

The Subject / Facet / Host model already gives us the vocabulary:

- **Subjects are host-neutral** (0005): Sigil, a radial menu, a Work Record keep
  one identity regardless of where rendered.
- **Facets declare Hosts** (0005, 0011): a **Browser Host** (`browser:…`, for
  documents/wiki/reports/workbenches/preview) or a **Canvas Host** (`canvas:…`,
  *required* for DesktopWorld placement, daemon lifecycle, input regions,
  diagnostics, privileged interaction).

**The One-World move, stated in ADR vocabulary: the Canvas Host is realized as
one World, not N WKWebViews.** Host-neutrality survives. Browser-host survives.
A Facet that needs runtime privileges mounts as a *node in the World* instead of
spawning its own canvas.

**The tension to state plainly (do not imply full harmony):** ADR-0011's
*anti-sprawl warning* is vindicated, but its *render-core-portability aspiration*
is **strained**. The World's defining benefits — shared heap, direct binding,
pooled resources, shared focus/scheduler — are intrinsically **non-portable** to
a Browser Host. So dual-host Facets will *diverge*: the Browser Host necessarily
becomes the **document / preview / Playwright-addressable** path, not a co-equal
interactive one. This is consonant with where 0011 already points (browser-host
for documents; canvas-host for live runtime UI), but the divergence should be
named, not glossed.

| ADR | Verdict under One-World |
| --- | --- |
| **0005** Subjects host-neutral; Facets declare Hosts | **Survives, reinterpreted.** Canvas Host = the World. |
| **0008** Subject Browser is a surface kind | **Survives.** A Subject Browser can be a World node (canvas) or browser-hosted. |
| **0011** Host-neutral surfaces, capability-bounded hosts | **Sharpens + strained.** Anti-WKWebView-sprawl vindicated; render-core portability strained (see above). |
| **0004** Anchor is a role → Anchor Binding | **Survives, vindicated.** `anchor_window + offset` is exactly how a World node anchors to a browser window (§5). `canvas:` scope = "a World region" not "one of N webviews." |
| **0014** Visual-object descriptor contract | **Survives, reinterpreted.** Descriptors become **in-heap scene primitives**; binding is local, which is where it was always natural. |

---

## 4. Focus & input ownership

The standard **two-level focus model** that every single-window rich app uses:

- **Level 1 (OS):** does the AOS window hold key-window status, or another macOS
  app? OS-managed, binary.
- **Level 2 (internal):** within AOS, exactly one panel is the active keyboard
  owner — only meaningful when Level 1 = AOS.

**The AOS-specific seam (differs from Blender):** because the World is a
*transparent passthrough overlay*, Level 1 is itself dynamic and **driven by the
daemon's hit-arbitration**, not AppKit's default click-to-focus. Mouse-down on a
World interactive region → daemon promotes the AOS window to key → World routes
keys to its internal focus owner. Click on a passthrough hole → the real app
becomes key → AOS internal focus goes dormant. (Plus an explicit summon/hotkey
path.)

Build cheaply on the DOM, don't reinvent it:

- DOM `document.activeElement` already gives single-control-at-a-time, `tabindex`,
  focus rings, and IME composition target. Use it for intra-control focus.
- Build only the thin layer: a **focus-group manager** ("which panel is active"),
  **two Tab loops** (Tab trapped *within* the active panel; a separate
  gesture — e.g. Cmd+\` — to switch panels), and **per-panel focus memory**.
  Zag (already in the toolkit) supplies the focus-trap primitive.

**Agent-OS-specific rule:** focus changes have an **origin** (human gesture vs
agent action). **Agent-opened panels must not steal keyboard focus by default** —
don't yank the caret out of the human's field because the agent popped a
dashboard. (`element_focused` is already a subscribed stream, so focus is already
a first-class observable.)

Note: this is *consolidated* complexity, not new complexity — today focus is
already smeared across macOS (which of N AOS windows is key) and the DOM
(activeElement in each). One World makes it one `activeElement` + one focus ring
**you control**.

---

## 5. Native capabilities that survive the reframe

- **Browser overlays still work — and get cleaner.** Confirmed in code: an AOS
  browser overlay is a native AOS canvas anchored to the Chrome *window*
  (`BrowserAnchor { anchor_window, offset }`, `src/browser/anchor-resolver.swift`;
  `anchorWindow` on the canvas, `canvas.swift`/`protocol.swift`). It is **not**
  page-injected DOM. So it is already "a node positioned over a screen region" —
  the World's native unit. Above-everything **removes** the overlay-vs-browser
  z-order management that exists today. Honest limits, unchanged by the reframe
  (intrinsic to native-over-top): window-anchored not scroll-locked; tracking
  smoothness bounded by CDP/Playwright introspection rate; no auto viewport clip.
  *Future:* scroll-locked overlays = treat browser element geometry as a **fast
  input signal** (CDP layout/scroll stream → node transform), same signal model
  as cursor/`display_geometry`.
- **Window control over real apps** (focus, raise, move) via the daemon's AX/`do`
  capability remains available as the future escape hatch for the interleaving
  trade in §6.
- **Input arbitration stays daemon-owned** — it is the seam in §2 that cannot
  collapse.

---

## 6. What we trade away (eyes-open; owner-accepted)

- **OS-native window interleaving.** Today an AOS panel can be a real NSWindow
  in OS z-order *between* two real apps. A single transparent World sits at one
  window level (above-everything, toggleable to ambient). **Accepted** by the
  owner, with future workarounds noted (drive real app windows via AX; per-node
  clipping/alpha tricks in the display graph).
- **Process fault isolation → in-app fault tolerance.** One heap is one fault
  domain; a logic fault can take the World down. This is replaced by *tolerance*
  (error boundaries, a watchdog, a safe-mode frame), **not** by nothing. The
  distinction matters: kill isolation, keep tolerance.
- **Literal single window.** Multi-display is physically irreducible (no shared
  GL context across NSWindows on different displays). So "one app" is really
  **one brain (heap/state/scene) + thin per-display projection surfaces** — 1
  stateful world, not N. The focus owner determines which display's window holds
  OS key status (only one can).

---

## 7. The central unknown (the long pole)

The owner's stated product goal — **"make your own panels / forms / dashboards /
workbenches / widgets, with custom-themed controls and panels"** — is **entirely
gated on a World extension API + theming contract that does not exist yet.**
"Extend by programming against the World" (the Blender-addon / VS Code-extension
/ Figma-plugin / Godot model that replaces ADR-0012's bring-your-own-framework
surfaces) is only as real as that API. **This is the long pole of the whole
proposal, not an afterthought.** It must define, at minimum:

- a scene-node / component model (how a widget is added to the World);
- the control / widget kit and its composition rules;
- the reactive store + binding contract (the fine-grained signals core from the
  transport review, now in-heap);
- a theming token contract (so "custom-themed" is real);
- a **sandbox escape hatch** for genuinely untrusted third-party code (the
  inverse of today: shared-World is default, isolated WKWebView/iframe is the
  rare exception).

Until this contract is sketched, "one coherent extensible World" is an
aspiration, not a buildable plan. Designing it is the recommended next deep
workstream.

---

## 8. How this unifies the transport review

The review's separate directions become facets of one idea:

- The **shared interaction scheduler** and **signals core** become *in-heap and
  local* — their natural home.
- The **descriptor binding** (ADR-0014) becomes in-heap object binding.
- **Preview/commit, coalescing, and backpressure** mostly only matter at the
  **two remaining seams**: daemon→World input delivery, and cross-display /
  Browser-Host sync. Within the World there is nothing to coalesce — you bind to
  live state.
- The **drain-paced daemon coalescing** (review Direction A) still applies at the
  daemon→World seam and stays "pure mechanism, opt-in raw" (ADR-0015 intact).

**Sigil's own migration is a separate, larger track.** Sigil-as-content — the
avatar renderer becoming entities in the World rather than a private full
canvas — is *not* folded into this proposal. It already has a parked work card
with observability/placement prerequisites
(`docs/design/work-cards/implementer-sigil-avatar-panel-resource-contract-migration-v0.md`)
and should be sequenced on its own, after the §10 probes.

---

## 9. ADR / CONTEXT / ARCHITECTURE triage (all entries are PROPOSALS)

Verdict legend: **Inverts** · **Sharpens** · **Survives-reinterpreted** ·
**Term-collision** (substantively unchanged, vocabulary needs disambiguation) ·
**Orthogonal**.

| Artifact | Verdict | Note (proposal only) |
| --- | --- | --- |
| **ADR-0012** toolkit platform strategy | **Inverts** | Replace "bring-your-own-framework isolated surfaces" with "extend by programming against the World API + sandbox escape hatch." This is the one real inversion. |
| **ADR-0011** host-neutral, capability-bounded hosts | **Sharpens (+strained)** | Anti-WKWebView-sprawl vindicated; render-core portability strained — Browser Host becomes document/preview, not co-equal interactive. Re-register: Canvas Host = the World. |
| **ADR-0015** TCC broker boundary | **Sharpens** | Daemon = native HOW only; no longer a surface message bus. Crisper, not weaker. |
| **ADR-0005** subjects host-neutral | **Survives-reinterpreted** | Canvas Host = the World. |
| **ADR-0008** Subject Browser is a surface kind | **Survives-reinterpreted** | A Subject Browser may be a World node or browser-hosted. |
| **ADR-0004** anchor → binding | **Survives (vindicated)** | `anchor_window+offset` = how a World node anchors to a browser window; `canvas:` scope = World region. |
| **ADR-0014** visual-object descriptors | **Survives-reinterpreted** | Descriptors → in-heap scene primitives. |
| **ADR-0001** facets within layers | **Term-collision** | "Layer" here = subject-expression taxonomy, NOT visual/composite layer. Disambiguate "layer" in World docs; concept unchanged. |
| **ADR-0010** capabilities vs facets/controls | **Term-collision** | "Controls" here = derived subject affordances, NOT UI widgets. Collision **pre-exists** (`packages/toolkit/controls/`). Disambiguate; concept unchanged. |
| **ADR-0013** execution model | **Orthogonal** | Read in full; work/recipe/workflow taxonomy, unaffected. |
| **ADR-0002, 0003, 0006, 0007, 0009** | **Orthogonal (provisional)** | Classified by title + decision line (semantic / work-record / state-id domain). **Confirm by full read in the deliberate pass** — not asserted as verified. |
| **ARCHITECTURE.md** surface-ownership (3-layer) | **Collapses → 2** | daemon/toolkit/app surface-ownership → broker / World. "Daemon isn't a window manager" becomes absolute. |
| **CONTEXT.md** (governed vocabulary) | **Additions + real term-collision** | Confirmed by read: CONTEXT.md governs **Layer** (subject-expression taxonomy, narrative→…→health) and **Control (Verb)** (a *derived operation* like `open`/`edit`). Both collide with the World's *visual layer/node* and *UI-widget* meanings — "control" is in fact already **triple-booked** (Control-verb vs the "controls" Layer vs `toolkit/controls/` widgets). No **World** / **scene** / **Canvas-Host-as-World** vocabulary exists yet. Note: CONTEXT.md *already* disambiguates model-vs-display terms (Facet → _Avoid_ view/panel/pane) and **already flags "surface" as overloaded with the display system** — World vocabulary must slot into that existing discipline. Its **Subject Owner** + **State Patch** definitions *survive and underpin* in-heap owner-mediated binding. |
| **CONTEXT-MAP.md** (routing) | **Add routing entry** | Routes Subjects/Facets/Layers and "reusable surface policy: controls, panel" today; would need a route for the World / scene-kit. Lighter touch than CONTEXT.md. |

---

## 10. Smallest probe and sequencing

Do not write any ADR / CONTEXT / ARCHITECTURE edits before working the front of
this list. In cheapest-first order:

1. **Measure the separation tax first — no World code.** Instrument the *current*
   avatar owner ↔ detached compact panel path and count `control_change` /
   queued `snapshot` / `publishState` per second during a slider drag. This is a
   *measurement*, not a substrate build; it quantifies what co-location would
   delete and validates (or punctures) the premise before anyone writes World
   code. (It is also measurement (2) from the transport review.)
2. **The co-location probe** — only if (1) shows meaningful deletable traffic:
   prototype that same pair as **two layers in one document binding to a shared
   signal store**, and confirm the traffic → ~0 and the slider-drag feels direct.
   Honest caveat: this probe *presupposes* enough World substrate to host two
   surfaces, so it partly builds the thing it de-risks — which is exactly why (1)
   comes first.
3. **A World extension-API + theming sketch** (§7) — the long pole. Without it,
   "extensible coherent World" is unproven.

Only after those: a **deliberate, owner-approved governance pass** that executes
the §9 proposals (including the full read of the provisional-orthogonal ADRs).

---

## Change-control reminder

This is a proposal for discussion. The ADR / CONTEXT / ARCHITECTURE entries in §9
are **not edits** — they are a map for a future owner-approved pass. Per
`AGENTS.md`, governing docs are not casually edited; this note exists in
`docs/design/` precisely so its register reads "under discussion," not "decided."

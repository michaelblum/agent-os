# AOS One-World — Goal Contract (v0)

**Status: Goal adopted as direction by the owner. Means proposed. Irreversible
architectural ratifications are GATED (Phase 4).**
Date: 2026-06-05

This is the north-star contract for the surface / One-World workstream. Any
session or model stack picking up this work **adopts this contract**: the Goal in
§1, the Done conditions in §2, the Invariants in §3, and the Non-Goals in §4 bind
the effort; the Phase Gates in §5 are how progress stays honest and on-track. It
is intentionally big-picture — detail lives in the artifacts in §7.

---

## 1. Goal (north star)

**Collapse AOS's first-party surfaces from N isolated WKWebView canvases into one
coherent "World" — a single heap / scene / app (per display segment) where
first-party visual and light-interaction surfaces are nodes that bind to shared
live state, share one render loop and resource pool, and communicate directly
without serializing through the daemon.** The daemon remains the privileged
native broker (the "hands"); the World is the substrate the user and the agent
share.

AOS is **a coherent world, not an operating system** — closer to a game-engine
editor / Blender / Morphic than to a window manager.

## 2. Definition of Done (success conditions — checkable)

The goal is achieved when **all** hold:

1. **Co-location.** First-party visual + light-interaction surfaces (overlays,
   chips, diagnostics, avatar compact controls, radial menu) run as nodes in one
   shared World, not as independent WKWebViews.
2. **Direct binding.** Co-located surfaces bind to shared live state; the
   `publishState` / `snapshot` / cross-canvas `control_change` category is **gone
   for co-located surfaces** — measurably ~0 such messages during a slider drag.
3. **Pooled + budgeted.** One render loop, one resource pool, one interaction
   scheduler; the stacked scenario (Surface Inspector + avatar compact panel +
   slider drag) holds a **measured** per-frame budget (not a subjective "feels
   smooth").
4. **Extensible.** A documented **World extension API + theming contract** exists,
   and a third-party-shaped widget/panel/dashboard can be built against it,
   custom-themed, **without reaching into renderer/runtime internals**.
5. **Broker intact.** The daemon remains the sole privileged broker; input
   arbitration and above-everything transparent-overlay behavior are preserved.
6. **Browser overlays preserved.** They keep working as World nodes; the
   CDP scroll-lock geometry-stream upgrade is on the backlog (not lost).
7. **Governance ratified.** ADR-0012 inverted; surface ADRs re-registered in World
   vocabulary; CONTEXT term collisions resolved (Phase 4, owner-approved).

## 3. Invariants (must hold at every step — the contract's teeth)

- **Daemon = privileged native broker only** (ADR-0015). It owns native HOW
  (input capture, window placement, perception, TTS, display topology); it is
  **not** a surface message bus and **not** a window manager.
- **The World is transparent + passthrough-by-default** over the real desktop;
  the daemon arbitrates AOS-vs-real-app input; default z-order is
  above-everything-except-screensaver.
- **Fault tolerance is required** (error boundaries / watchdog / safe-mode frame).
  Killing process *isolation* is allowed; killing *tolerance* is not.
- **Never discard or overwrite user changes** to satisfy workflow hygiene
  (repo Hard Invariant). Parallel sessions/stacks share this tree.
- **Preserve runtime-mode isolation and wiki namespace conventions**
  (repo Hard Invariant).
- **No AI attribution** on commits, PRs, issues, or release notes
  (repo Hard Invariant).
- **Measure before architecting; verify load-bearing claims against code** before
  asserting them.
- **Governing-doc edits (ADR / CONTEXT / ARCHITECTURE) happen only at the Phase 4
  ratification gate, owner-approved.** Until then they are proposals.
- **Durable artifacts live in the repo**, not in chat or model-local memory, so
  any stack can continue.
- **Don't over-build a bespoke framework** (ADR-0012's own warning); prefer a tiny
  standalone signals core over hand-rolling reactivity.

## 4. Non-Goals (explicitly out of scope)

- AOS as a real OS, window manager, or OS-window-interleaving system (that trade
  is accepted; future workarounds via AX `do` / node clip+alpha are backlog only).
- A default third-party-framework plugin host (sandboxed foreign-framework
  surfaces become the **rare escape hatch**, not the norm — the ADR-0012
  inversion).
- A fine-grained implementation plan (this contract sets direction + gates, not
  steps).
- Committing specific ADR/CONTEXT text before the Phase 4 gate.

## 5. Phase gates (entry → exit; a gate can revisit the Goal)

Each phase must pass its exit gate before the next begins. Gates are honest —
Phase 0/1 can still reshape or kill the approach.

- **Phase 0 — Validate the premise (measurement; no World code).**
  Instrument the current avatar-owner ↔ detached-compact-panel path; count
  `control_change` / `snapshot` / `publishState` per second on a slider drag;
  confirm live `input_event` subscriber count (duplicate-surface check); confirm
  whether scale-drag frames mark `structural`.
  **Exit gate:** the separation tax is real and material. *If not → revisit the
  Goal.* (Evidence owner:
  `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`.)
- **Phase 1 — Co-location probe (one pair).**
  Prototype the avatar owner ↔ compact panel as two layers in one document
  binding to a shared signal store.
  **Exit gate:** deletable traffic → ~0; slider-drag is direct; focus + fault
  behavior acceptable. *Failure here reshapes the World/Browser-Host line.*
- **Phase 2 — World substrate + extension-API/theming sketch (the long pole).**
  Minimal World (one heap/scene/scheduler/resource pool) + the extension + theming
  contract from §2.4.
  **Exit gate:** a sample widget is built against the API and themed, by someone
  not reaching into internals.
- **Phase 3 — Incremental first-party migration.**
  Move surfaces onto the World node-by-node (overlays → chips → diagnostics →
  avatar compact controls → …), each only when its window-semantics need is shown
  unnecessary.
  **Exit gate (per surface):** behavior parity + the §2.3 perf budget held in the
  stacked scenario.
- **Phase 4 — Governance ratification (owner-approved).**
  Execute the proposal's triage: invert ADR-0012; re-register 0005/0008/0011/0004/
  0014 in World vocabulary; full-read the provisional-orthogonal ADRs; resolve
  CONTEXT "Layer"/"Control"/"surface" collisions + add World/scene vocabulary;
  collapse ARCHITECTURE's 3-layer surface ownership to 2.
  **Gate:** owner approval.
- **Phase 5 — Sigil-as-content migration (separate, larger track).**
  Avatar renderer becomes World entities. Its prerequisites stay in the
  One-World handoff/backlog and the accepted visual-object descriptor/resource
  contracts.

## 6. Acceptance evidence

Tie "done" to numbers, not vibes: the Phase 0 baseline counts (the traffic that
should approach 0), per-canvas frame budgets via the existing telemetry
(`render-performance`, `spatial-telemetry`, `canvas-stats`), and the Phase 2
"third-party widget built against the API" demo. The existing hit-test unit test
is correctness coverage and does **not** establish any of this.

## 7. Owning artifacts (detail lives here, not in this contract)

- Review / decision space: `docs/dev/reports/aos-surface-transport-architecture-review-v0.md`
- Architecture proposal (the means): `docs/design/aos-one-world-architecture-proposal-v0.md`
- Handoff / backlog / code anchors / guardrails: `docs/design/aos-surface-world-workstream-handoff-v0.md`
- Phase 0 measurement evidence: `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`
- Phase 5 Sigil/resource baseline: `docs/design/visual-object-descriptor-contract-v0.md`; status/evidence: `docs/dev/reports/aos-visual-object-architecture.md`

## 8. Change control

This contract is owner-owned. Gates may only be opened by meeting their exit
conditions; the Goal itself is revisable at the Phase 0 and Phase 1 gates if the
premise fails to validate. Governing-doc changes wait for Phase 4. Per
`AGENTS.md`, this lives in `docs/design/` because it is direction-setting, not yet
ratified architecture.

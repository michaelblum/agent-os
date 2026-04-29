# Human Intent Sensing and Steerable Collection — V0 Implementation Plan

> Tracking: GitHub issue #141, "Human Intent Sensing and Steerable Collection Sessions".
> Status: canonical reconciled plan for the V0 substrate. This document merges
> the broad platform plan with the implementation-ready V0 plan and removes the
> duplicate rework track.

**Goal:** Ship a steerable browser collection run that a human can pause, step,
take over, and annotate, producing a single canonical timeline plus narrative
and Playwright-replay projections. Generalize the underlying contracts so a
desktop adapter can land later without re-architecting.

**Architecture:** One canonical run timeline, one run-control state machine, one
intent-event contract. Browser is the only sensor adapter in V0. The toolkit
hosts the run-puck and action gate. `aos` owns the durable session, source
pack, evidence records, and replay generation.

```text
human instruction / steering
  -> run control plane (toolkit)
  -> action gate
  -> intent event contract (shared/schemas)
  -> browser intent sensor (in-page overlay -> bridge -> canonical events)
  -> AOS see/do/show/listen/tell loop
  -> evidence and replay projections
```

**Tech Stack:** Existing AOS primitives (`see` / `do` / `show` / `listen` /
`tell`), existing Playwright browser adapter
(`docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`), Sigil
workbench surfaces, JSONL run logs, Markdown narrative output, Playwright
codegen for browser replay. No new runtime dependencies.

**Source Material:**

- Browser adapter plan:
  `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`
- Input surface contract:
  `docs/superpowers/plans/2026-04-27-aos-input-surface-contract-proposal.md`
- Canvas inspector object marks plan:
  `docs/superpowers/plans/2026-04-18-canvas-inspector-object-marks.md`
- Design operator plan:
  `docs/superpowers/plans/2026-04-28-design-operator.md`
- Syborg extension (reference, not vendored):
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/`
- Syborg unified annotation source:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`
- Syborg annotation model:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/lib/annotation-types.ts`
- Employer brand workflow map (consumer of V0 output, not blocker):
  `wiki-seed/concepts/employer-brand-workflow-map.md`

---

## Reconciled Scope Decisions

| Concern | Reconciled decision |
|---|---|
| V0 scope | Ship browser-only steerable collection as the first usable substrate. Keep the platform contract general, but defer replay codegen, Employer Brand Audit, and desktop sensing to named follow-up plans. |
| Task shape | Implement as staged PRs with exact files, tasks, tests, dependencies, and acceptance gates, following the convention from `2026-04-27-aos-input-surface-contract-proposal.md`. |
| Spec vs. plan | Keep architectural context in this document, but make the implementable contracts owned by PR 1 schemas rather than free-floating prose. |
| Dependency order | Land schemas first, then pure run-control logic, then the puck, browser sensor, collection orchestrator, and finally the deterministic demo recipe. |
| Demo definition | Preserve the original eight-step happy path, but make it an explicit PR 6 acceptance gate and allow `playwright-replay.spec.ts` to be a V0 stub until replay codegen has its own plan. |
| Follow-up ownership | Treat dual-layer replay codegen, Employer Brand Audit V0, desktop intent sensing, and richer evidence schemas as separate plans that consume the V0 source-pack and timeline contracts. |

---

## Decisions Locked Before Implementation

| # | Decision | Rationale |
|---|---|---|
| 1 | Human intent sensing is a platform contract, not a browser feature. | Browser annotations, desktop pointer marks, and canvas object marks must be different adapters for one timeline. |
| 2 | Browser is the first (and only V0) implementation adapter. | DOM refs, accessible roles, selector hints, screenshots, and Playwright replay make browser the least fragile first slice. |
| 3 | Do not vendor the Syborg extension wholesale. | AOS appropriates the overlay model, data types, and interaction lessons while adapting them to AOS primitives and repo conventions. |
| 4 | Run control ships before autonomous collection is considered usable. | The human needs a visible trust handle: pause, resume, step, take over, abort, safety gates. |
| 5 | `aos show` owns the ambient run puck. | The puck must work outside browser pages so future desktop and canvas sessions inherit it without rework. |
| 6 | In-page browser overlay is allowed as a precision sensor. | DOM-local selection and drawing are better handled in-page, then normalized into canonical AOS intent events at the bridge boundary. |
| 7 | The append-only run log is canonical. | Narrative Markdown, Playwright replay, evidence JSONL, and UI timelines are projections from one source of truth. |
| 8 | Desktop intent sensing is a follow-up plan, not a V0 workstream. | Desktop adds AX/pixel fragility to the first milestone for no V0 demo gain. Generalizing the contract now is correct; building two adapters in parallel is not. |
| 9 | Dual-layer replay codegen ships in a follow-up plan once the timeline schema is stable. | V0 must produce a faithful canonical log; codegen quality is its own engineering problem with its own fixtures. |
| 10 | Employer Brand Audit V0 is a downstream consumer of this system, not part of it. | This plan ships the substrate. The audit workflow plan composes that substrate. |

---

## V0 Scope

**In scope (this plan):**

- Run-control state machine and action gate.
- Ambient run puck via `aos show`.
- Canonical schemas: `run-control`, `agent-action`, `intent-event`, `human-mark`.
- Browser intent sensor: in-page overlay, bridge, canonical event emission.
- Steerable browser collection session that records into a source-pack directory.
- One end-to-end dry-run on a static fixture page producing a real source pack.

**Deferred (named follow-up plans, to be authored):**

- Dual-layer replay codegen — `docs/superpowers/plans/YYYY-MM-DD-dual-layer-replay-codegen.md`.
  The V0 source pack records enough information to drive Playwright codegen,
  but the codegen module itself, its fixtures, and validation belong in their
  own plan once the timeline schema is exercised by V0.
- Employer Brand Audit V0 workflow — `docs/superpowers/plans/YYYY-MM-DD-employer-brand-audit-v0.md`.
  Consumes the V0 source-pack format. Authored after at least one real audit
  collection run has shaken out the evidence shape.
- Desktop intent sensor — `docs/superpowers/plans/YYYY-MM-DD-desktop-intent-sensor.md`.
  Adds an AX/screenshot/OCR adapter behind the same intent-event contract.
- Evidence schema beyond V0 minimum — covered in the Employer Brand Audit
  follow-up; V0 emits a small `evidence-items.jsonl` with whatever the source
  pack needs.

**Explicitly out of scope (V0 and follow-ups):**

- Background autonomous browsing without visible run control.
- Replacing the existing browser adapter.
- Shipping a new browser product instead of an AOS adapter.
- Generalized visual programming surface.
- Selector stability guarantees across arbitrary sites.

---

## Architecture Context

The detail below is the context implementers need; the implementable contracts
are listed alongside their owning PR.

### Run states and commands

States: `idle`, `planning`, `running`, `paused`, `stepping`, `takeover`,
`blocked`, `aborting`, `completed`, `failed`.

Commands: `pause`, `resume`, `step`, `skip`, `replan`, `take_over`, `release`,
`abort`, `open_timeline`, `open_evidence`.

Safety gates: `before_submit`, `before_download`, `before_file_upload`,
`before_payment`, `before_external_domain`, `before_login_secret`,
`before_destructive_action`.

The action loop:

```text
agent proposes action
  -> run control checks state
  -> optional safety gate checks action
  -> execute one atomic action
  -> observe result
  -> append timeline event
  -> decide next action
```

### Run puck

Bottom-center translucent `aos show` overlay. One- or two-word state label;
primary click is the most common control for the current state.

| Puck state | Primary click |
|---|---|
| Running | Pause |
| Paused | Resume |
| Step | Execute one action |
| Takeover | Release control |
| Blocked | Open blocker detail |
| Done | Open run summary |

Long press / secondary click opens: `Pause/Resume`, `Step`, `Skip action`,
`Replan`, `Take over`, `Abort run`, `Open timeline`, `Open evidence`.

Default hotkeys (active only inside automation ownership scope; bindings
configurable):

```text
Space        pause/resume
S            step
R            resume
T            take over / release
Esc          pause
Cmd+.        hard pause
Shift+Esc    abort confirmation
```

macOS Voice Control maps to the same commands via configurable hotkeys, menu
commands, or command URLs. The run-control plane receives the same event
regardless of source (puck click, hotkey, voice, Sigil chat, or system safety
gate).

### Intent event shape

```json
{
  "type": "human.mark",
  "kind": "element",
  "session_id": "collect",
  "target": {
    "surface": "browser",
    "target_id": "browser:collect",
    "app": "Chrome",
    "window_id": 123,
    "url": "https://example.com/careers"
  },
  "anchors": {
    "semantic": {
      "role": "link",
      "name": "Benefits",
      "selector_hints": ["a[href*='benefits']"]
    },
    "spatial": {
      "viewport_rect": { "x": 120, "y": 340, "width": 180, "height": 44 },
      "desktop_rect": { "x": 690, "y": 412, "width": 180, "height": 44 }
    },
    "visual": {
      "screenshot_path": "artifacts/screenshots/mark_001.png",
      "crop_path": "artifacts/crops/mark_001.png"
    },
    "replay": {
      "playwright": "page.getByRole('link', { name: 'Benefits' })",
      "aos_target": "browser:collect/e21"
    }
  },
  "utterance": "This is probably where benefits proof lives.",
  "confidence": 0.82,
  "resolution": "agent_acknowledged"
}
```

Surface-specific anchors are defined per adapter:

| Surface | Primary anchors | Replay projection |
|---|---|---|
| Browser (V0) | URL, tab id, selector hints, DOM role/text, viewport rect, screenshot crop | Playwright |
| Desktop app (follow-up) | app id, window id, AX role/title/path, screen rect, OCR/text, screenshot crop | `aos do`, AX, AppleScript, CGEvent |
| Pixel-only surface (follow-up) | screen rect, screenshot crop, OCR, image features | coordinate or image-match action |
| AOS canvas (follow-up) | canvas id, object id, local coordinate, scene/object marks | canvas/app event replay |

### Source pack layout

```text
source-pack/
  source-pack.json
  collection-session.jsonl
  narrative.md
  playwright-replay.spec.ts        # generated by follow-up plan; V0 leaves a stub
  artifacts/
    screenshots/
    page-text/
    selected-regions/
    crops/
  evidence/
    evidence-items.jsonl
  marks/
    human-marks.jsonl
```

### Canonical timeline (illustrative)

```json
{"type":"human.intent","text":"Prioritize proof of employee voice over generic culture claims."}
{"type":"agent.plan.step","goal":"Inspect careers navigation for evidence paths."}
{"type":"agent.action.proposed","action_id":"act_042","op":"click","target":"browser:collect/e17","why":"Open Benefits page."}
{"type":"run.control","command":"step","source":"hotkey","budget":1}
{"type":"agent.action.executed","action_id":"act_042","op":"click","target":"browser:collect/e17"}
{"type":"human.mark.comment","annotation_id":"mark_001","note":"This claim needs proof."}
{"type":"evidence.captured","evidence_id":"ev_001","mark_ids":["mark_001"]}
```

---

## File Structure

The V0 implementation creates the following files. Each PR below names the
subset it owns.

**Schemas (PR 1):**

- Create: `shared/schemas/run-control.schema.json`
- Create: `shared/schemas/agent-action.schema.json`
- Create: `shared/schemas/intent-event.schema.json`
- Create: `shared/schemas/human-mark.schema.json`
- Create: `shared/schemas/source-pack.schema.json`
- Create: `tests/fixtures/run-control/` (transition fixtures)
- Create: `tests/fixtures/intent-event/` (browser, region, comment, draw)

**Run control plane (PR 2):**

- Create: `packages/toolkit/src/run-control/state-machine.ts`
- Create: `packages/toolkit/src/run-control/action-gate.ts`
- Create: `packages/toolkit/src/run-control/timeline.ts`
- Create: `packages/toolkit/src/run-control/safety-gates.ts`
- Create: `packages/toolkit/src/run-control/index.ts`
- Test: `packages/toolkit/test/run-control/state-machine.test.ts`
- Test: `packages/toolkit/test/run-control/action-gate.test.ts`
- Test: `packages/toolkit/test/run-control/safety-gates.test.ts`

**Run puck (PR 3):**

- Create: `packages/toolkit/src/run-puck/puck-canvas.ts`
- Create: `packages/toolkit/src/run-puck/puck-controls.ts`
- Create: `packages/toolkit/src/run-puck/hotkeys.ts`
- Create: `packages/toolkit/src/run-puck/index.ts`
- Modify: `apps/sigil/renderer/...` to mount the puck for active sessions
  (exact entry point determined in PR 3 Step 1; see Files Discovery note)
- Test: `packages/toolkit/test/run-puck/puck-controls.test.ts`
- Test: `tests/run-puck-real-input.sh` (real-input smoke per `tests/README.md`)

**Browser intent sensor (PR 4):**

- Create: `src/browser/intent-sensor/overlay/` (in-page overlay; ts/js per
  existing `src/browser/` conventions)
- Create: `src/browser/intent-sensor/bridge.ts`
- Create: `src/browser/intent-sensor/canonicalize.ts`
- Create: `tests/fixtures/browser-intent/static-page.html`
- Test: `tests/browser-intent-sensor.sh`

**Steerable collection session (PR 5):**

- Create: `src/sessions/steerable-collection/` (orchestrator)
- Create: `scripts/source-pack/init.ts` and `scripts/source-pack/append.ts`
- Modify: `apps/sigil/...` collection room module (entry determined in
  PR 5 Step 1; see Files Discovery note)
- Create: `tests/steerable-collection-session.sh`

**Demo dry-run (PR 6):**

- Create: `docs/recipes/steerable-browser-collection.md`
- Create: `tests/fixtures/v0-demo/demo-page.html`
- Create: `tests/v0-demo-dry-run.sh`

**Files Discovery note:** Sigil mount points (`apps/sigil/...`) are determined
at the start of PR 3 and PR 5 by reading the current Sigil renderer entry. Do
not guess paths; PR Step 1 in each case grep-locates the host module and pins
the exact path before code lands.

---

## Staged Implementation

Each PR has its own test gate. Do not merge a PR if its tests are not green and
its acceptance criteria are not met.

### PR 1: Schemas and Fixtures Only

**Purpose:** Lock the canonical contracts before any consumer is written.
Mirrors the convention in `2026-04-27-aos-input-surface-contract-proposal.md`
PR 1.

**Files (this PR only):**

- Create: `shared/schemas/run-control.schema.json`
- Create: `shared/schemas/agent-action.schema.json`
- Create: `shared/schemas/intent-event.schema.json`
- Create: `shared/schemas/human-mark.schema.json`
- Create: `shared/schemas/source-pack.schema.json`
- Create: `tests/fixtures/run-control/` (transitions)
- Create: `tests/fixtures/intent-event/` (browser element, region, comment, draw)
- Modify: `docs/api/` index if cross-tool-facing surfaces change

**Tasks:**

- [ ] Define `run-control.schema.json`: states, commands, transitions,
  blocked-state reasons, source attribution (`puck`, `hotkey`, `voice`,
  `chat`, `safety_gate`).
- [ ] Define `agent-action.schema.json`: `proposed`, `executed`, `skipped`,
  `blocked`; required fields `action_id`, `op`, `target`, `why`; per-op
  payload variants for browser ops in V0 (`click`, `hover`, `type`, `fill`,
  `key`, `navigate`, `scroll`).
- [ ] Define `intent-event.schema.json`: `human.intent`, `human.mark`,
  `human.annotation`, `human.override`, `human.takeover`; target-context
  union over `browser`, `desktop`, `canvas`, `pixel_surface`; semantic /
  spatial / visual / replay anchor groups; resolution states `unresolved`,
  `agent_acknowledged`, `bound_to_action`, `captured_as_evidence`, `stale`,
  `rejected`; confidence and re-resolution fields.
- [ ] Define `human-mark.schema.json` as a refinement of `intent-event` for
  marks specifically (kind = `element` | `region` | `comment` | `draw`).
- [ ] Define `source-pack.schema.json` covering `source-pack.json` metadata
  and pointers to JSONL streams + artifact directories.
- [ ] Add positive fixtures: a representative event per `event_kind` and per
  surface (browser only is required for V0; include one desktop and one
  canvas example for forward compatibility).
- [ ] Add negative fixtures: missing required fields per kind, invalid state
  transitions, mismatched target/anchor pairs (e.g. desktop target with only
  selector_hints).
- [ ] Add schema validation tests consumed by both Swift (where the daemon may
  reject invalid payloads) and JS (toolkit + browser sensor) so producer and
  consumer interpretations cannot drift. Use the same fixture directory from
  both sides.
- [ ] Update `docs/api/` index entries if any of these schemas become
  cross-tool-facing.

**Tests / acceptance:**

- All schemas validate against their positive fixtures.
- All negative fixtures fail validation with a recognizable error.
- Cross-language validation (Swift daemon + JS toolkit) passes against the
  same fixtures.
- No daemon emission or Sigil behavior changes in this PR.

**Unblocks:** PR 2, PR 3, PR 4.

---

### PR 2: Run Control Plane and Action Gate (No UI)

**Purpose:** Provide the toolkit-side state machine, action gate, and timeline
event emitter. Pure logic — no rendering, no browser dependency.

**Files (this PR only):**

- Create: `packages/toolkit/src/run-control/state-machine.ts`
- Create: `packages/toolkit/src/run-control/action-gate.ts`
- Create: `packages/toolkit/src/run-control/timeline.ts`
- Create: `packages/toolkit/src/run-control/safety-gates.ts`
- Create: `packages/toolkit/src/run-control/index.ts`
- Test: `packages/toolkit/test/run-control/state-machine.test.ts`
- Test: `packages/toolkit/test/run-control/action-gate.test.ts`
- Test: `packages/toolkit/test/run-control/safety-gates.test.ts`

**Tasks:**

- [ ] Implement the state machine matching `run-control.schema.json` with
  pure-function transitions.
- [ ] Implement the action gate: every atomic action must call
  `gate.check(action) -> Allowed | Blocked(reason) | RequiresGate(kind)`
  before execution.
- [ ] Implement step-budget semantics: `step` consumes exactly one budgeted
  action and returns the machine to `paused`.
- [ ] Implement takeover semantics: in `takeover`, the gate denies all agent
  actions; `release` returns control.
- [ ] Implement safety-gate evaluation: each gate kind maps to a
  pre-execution check that returns `pass`, `block`, or `require_human_ack`.
- [ ] Implement timeline append: `proposed`, `executed`, `skipped`, `blocked`,
  `run.control`, plus pass-through for `human.*` events emitted by sensors.
- [ ] Add unit tests for every legal and illegal transition in the schema
  fixtures; test the gate against fixture actions including each safety-gate
  kind.

**Tests / acceptance:**

- All transition fixtures pass.
- Gate denies actions in `paused`, `takeover`, `blocked`, `aborting`,
  `completed`, `failed`.
- Step budget is exactly one; second action without re-arming is denied.
- No browser, no `aos show`, no live `aos` binary required to test.

**Unblocks:** PR 3, PR 4, PR 5.

---

### PR 3: Ambient Run Puck

**Purpose:** Mount a persistent `aos show` overlay that exposes the run-control
commands to the human via click, hotkey, and voice-control surfaces.

**Files (this PR only):**

- Create: `packages/toolkit/src/run-puck/puck-canvas.ts`
- Create: `packages/toolkit/src/run-puck/puck-controls.ts`
- Create: `packages/toolkit/src/run-puck/hotkeys.ts`
- Create: `packages/toolkit/src/run-puck/index.ts`
- Modify: Sigil renderer host (path determined in Step 1).
- Test: `packages/toolkit/test/run-puck/puck-controls.test.ts`
- Test: `tests/run-puck-real-input.sh`

**Tasks:**

- [ ] **Step 1 — Files Discovery.** `grep` Sigil renderer for the existing
  workbench / overlay mount sites. Pin the exact host file path in this
  PR's description before writing code.
- [ ] Build the puck as an `aos show` canvas at bottom-center with the state
  set: `Planning`, `Running`, `Paused`, `Step`, `Takeover`, `Blocked`,
  `Done`. No app-specific styling that would prevent reuse outside Sigil.
- [ ] Wire primary click per the state→command table in
  `## Architecture Context`.
- [ ] Implement long-press / secondary-click menu (Pause/Resume, Step,
  Skip, Replan, Take over, Abort, Open timeline, Open evidence).
- [ ] Implement configurable hotkey bindings, scoped to the active automation
  ownership window. Bindings load from a config file under
  `~/.config/aos/{mode}/run-puck/hotkeys.json`. Default set per
  `## Architecture Context`.
- [ ] Provide a command surface that macOS Voice Control can target via
  hotkeys, menu items, or command URLs. The run-control plane receives the
  same `run.control` event regardless of source.
- [ ] Mount the puck in Sigil for active sessions; ensure it remains visible
  when the active surface is a browser tab, an `aos` canvas, or another
  desktop app — the puck is not a Sigil-internal surface.
- [ ] Add unit tests for the state→command mapping and config loading.
- [ ] Add a real-input smoke test (per `tests/README.md`) that programmatically
  fires the default hotkeys against a stub run-control plane and asserts
  the right command emits with the right `source` attribution.

**Tests / acceptance:**

- Puck renders in all seven states with the correct primary-click behavior.
- Hotkey defaults work; rebinding via the config file works.
- Real-input smoke test passes.
- Puck is visible across at least one non-Sigil surface (browser tab in front)
  during manual verification.

**Unblocks:** PR 5 (the steerable collection session needs the puck mounted to
be considered demo-ready).

---

### PR 4: Browser Intent Sensor

**Purpose:** Adapt Syborg's unified annotation mechanics into an AOS-compatible
in-page sensor that emits canonical `intent-event` records via a bridge.

**Files (this PR only):**

- Create: `src/browser/intent-sensor/overlay/` (in-page selection / region /
  comment / draw modes; mirrors Syborg interaction shapes)
- Create: `src/browser/intent-sensor/bridge.ts` (page <-> AOS canonical event
  translation)
- Create: `src/browser/intent-sensor/canonicalize.ts` (Syborg-shape to
  `intent-event` schema)
- Create: `tests/fixtures/browser-intent/static-page.html`
- Test: `tests/browser-intent-sensor.sh`

**Tasks:**

- [ ] Read `unified-annotation.ts` and `annotation-types.ts` from the Syborg
  reference path. Extract the useful concepts: `select`, `comment`, `draw`,
  element descriptors, contained / enclosed element resolution, bubble
  text, capture preparation. Do not vendor Syborg files.
- [ ] Implement an in-page overlay that exposes those modes against the
  active document. Rendering is in-page; AOS treats this as a precision
  sensor, not the canonical event surface.
- [ ] Implement the bridge: AOS can `start_mode`, `stop_mode`, `highlight`,
  `remove`, `request_capture`, and receive overlay events back.
- [ ] Implement `canonicalize`: convert overlay events to `intent-event`
  records matching `intent-event.schema.json`. Populate browser target
  context (`browser:<session>`, URL, title, tab/window IDs where available),
  viewport geometry, semantic anchors (role, name, selector hints), spatial
  anchors (viewport / desktop rects), visual anchors (screenshot crop), and
  replay anchors (Playwright locator string + `aos_target` ref).
- [ ] Append canonicalized events to the active timeline via the run-control
  plane from PR 2.
- [ ] Replace any Syborg-specific runtime messages with canonical events.
  No Syborg vocabulary leaks past `canonicalize.ts`.
- [ ] Add a static fixture HTML page that includes a heading, link, image,
  paragraph, and form. The test runs the overlay against the fixture and
  asserts: element select emits a `human.mark` with role/name/selector;
  region drawing emits a `human.mark.region` with viewport rect; comment
  attaches to the prior mark via `mark_id`; draw path emits a
  `human.mark.draw` with stroke points; capture writes screenshot+crop
  artifacts and references them in the mark.
- [ ] Add a stale-selector fallback test: rename the link's text after the
  mark, then ensure resolution falls back to the spatial / visual anchor
  rather than producing a hard error. Resolution state moves to `stale`
  on the next attempt to bind it to an action.

**Tests / acceptance:**

- All four modes (select / region / comment / draw) emit valid canonical
  events against the fixture page.
- Capture writes artifacts to the expected paths.
- Stale-selector fallback test passes.
- No Syborg files copied into the repo.

**Unblocks:** PR 5.

---

### PR 5: Steerable Browser Collection Session

**Purpose:** Wire run-control + puck + browser sensor + the existing browser
adapter into one orchestrator that turns a natural-language collection goal
into a recorded source pack.

**Files (this PR only):**

- Create: `src/sessions/steerable-collection/` (orchestrator)
- Create: `scripts/source-pack/init.ts`
- Create: `scripts/source-pack/append.ts`
- Modify: Sigil collection room module (path determined in Step 1).
- Test: `tests/steerable-collection-session.sh`

**Tasks:**

- [ ] **Step 1 — Files Discovery.** `grep` Sigil for the current "Source
  Collection" or equivalent room module. Pin the exact host path here.
- [ ] Implement session startup: attach or launch a browser target via the
  existing Playwright browser adapter, create the source-pack directory
  layout from `## Architecture Context`, instantiate the run-control plane,
  mount the puck, log a `session.started` event.
- [ ] Implement a live plan view: `current goal`, `current action`, `why`,
  `risk`, `next checkpoint` — surfaced through `aos show` (a separate
  surface from the puck) and via Sigil chat status.
- [ ] Route user steering into the timeline. Sources: Sigil chat
  (`human.intent`), puck or hotkey (`run.control`), voice (also `run.control`
  with `source: voice`), browser sensor (`human.mark.*`). Every routed event
  is persisted.
- [ ] Wrap the existing browser `see` and `do` calls so each observation and
  each action is recorded as `agent.action.proposed` (pre-gate) and
  `agent.action.executed` (post-gate). A blocked action records
  `agent.action.blocked` with the gate kind.
- [ ] Capture screenshots, page text, selected regions, and mark crops to the
  `artifacts/` subtree of the source pack. Reference paths from the
  corresponding events.
- [ ] Wire safety gates for: external-domain navigation, file upload, file
  download, form submit, payment surfaces, login fields. Each gate emits a
  `safety_gate.requested` event and waits for `safety_gate.acked` (sourced
  from puck, hotkey, or chat) before executing.
- [ ] Emit a minimal `evidence-items.jsonl`: each evidence item is the union
  of one or more `human.mark` events plus the action that captured them.
  Richer evidence shape is the Employer Brand Audit follow-up's job.
- [ ] On `completed` / `aborted` / `failed`, finalize `source-pack.json` with
  pointers to all JSONL streams, artifact counts, and final state.

**Tests / acceptance:**

- `tests/steerable-collection-session.sh` runs against a static fixture page
  served locally, drives a scripted run that includes a pause, a step, a
  human mark, an acknowledged safety gate, and a clean completion.
- The resulting source pack contains: a non-empty
  `collection-session.jsonl`, at least one screenshot, at least one mark
  crop, a populated `human-marks.jsonl`, a populated `evidence-items.jsonl`,
  and a complete `source-pack.json`.
- Schema validation passes on every JSONL stream.

**Unblocks:** PR 6.

---

### PR 6: V0 Demo Dry-Run and Recipe

**Purpose:** Prove the system works end-to-end on a representative real page,
not just the test fixture, and produce the recipe a future agent reads to
operate it.

**Files (this PR only):**

- Create: `docs/recipes/steerable-browser-collection.md`
- Create: `tests/fixtures/v0-demo/demo-page.html`
- Create: `tests/v0-demo-dry-run.sh`

**Tasks:**

- [ ] Author the recipe: when this workflow applies, prerequisites
  (`./aos ready`, browser adapter healthy, source-pack target dir writable),
  startup sequence, steering options, safety-gate checklist, completion
  artifacts, troubleshooting.
- [ ] Build a richer demo HTML page: nav with multiple sections, a careers
  page with a benefits sub-page, a couple of forms, an external link to a
  same-origin "external" stub.
- [ ] Add `tests/v0-demo-dry-run.sh` that drives the eight-step demo from
  `## V0 Demo Definition` deterministically.
- [ ] Manually walk through the demo once with the live `./aos` binary,
  starting from `./aos ready`. Capture the produced source pack and check
  it in under `docs/superpowers/artifacts/v0-demo/` (or equivalent — confirm
  artifact location convention before adding).
- [ ] Update `ARCHITECTURE.md` if the V0 system introduces cross-tool
  contracts (it likely should, for the run-control + intent-event family).

**Tests / acceptance:**

- `tests/v0-demo-dry-run.sh` passes deterministically against the demo
  fixture.
- One real-binary walkthrough produces a valid source pack that schema-
  validates and is readable end-to-end.
- The recipe is sufficient for a fresh agent to repeat the demo without
  reading this plan.

**Unblocks:** Follow-up plans for replay codegen, Employer Brand Audit V0,
and the desktop intent sensor.

---

## V0 Demo Definition

The first useful demo is intentionally small. PR 6 makes this deterministic.

1. User starts a browser collection session against a visible tab.
2. Puck appears bottom-center as `Running`.
3. Agent announces / proposes a browser action.
4. User presses `Space`; puck flips to `Paused`.
5. User presses `S`; exactly one browser action executes, then state returns
   to `Paused`.
6. User adds a browser annotation or text clarification via the browser
   intent sensor.
7. Agent acknowledges the mark and replans.
8. Session writes `collection-session.jsonl`, `human-marks.jsonl`,
   `evidence-items.jsonl`, `narrative.md` (basic stub OK in V0;
   full codegen is a follow-up plan), and `source-pack.json`. The
   `playwright-replay.spec.ts` file is left as a stub pointing at the
   replay-codegen follow-up plan.

---

## Acceptance Criteria

- [ ] All schemas in `shared/schemas/` validate their positive fixtures and
  reject their negative fixtures (PR 1).
- [ ] Cross-language schema validation (Swift daemon + JS toolkit) is wired
  and green (PR 1).
- [ ] State machine, action gate, and timeline emitter exist in the toolkit
  with passing unit tests for every legal and illegal transition (PR 2).
- [ ] Run puck is mounted in Sigil and renders the seven canonical states with
  correct primary-click behavior (PR 3).
- [ ] Default hotkeys work and are reconfigurable via
  `~/.config/aos/{mode}/run-puck/hotkeys.json` (PR 3).
- [ ] Real-input smoke test for the puck passes (PR 3).
- [ ] Browser intent sensor handles select / region / comment / draw against a
  static fixture and emits canonical events (PR 4).
- [ ] Stale-selector fallback test passes (PR 4).
- [ ] No Syborg source files are vendored into the repo (PR 4).
- [ ] Steerable collection session produces a fully populated source pack
  against the test fixture (PR 5).
- [ ] All safety gates pause execution and resume on ack (PR 5).
- [ ] V0 demo dry-run script passes deterministically (PR 6).
- [ ] One real-binary V0 demo walkthrough produces a valid checked-in source
  pack (PR 6).
- [ ] Recipe `docs/recipes/steerable-browser-collection.md` is sufficient for
  a fresh agent to repeat the demo without this plan (PR 6).
- [ ] No commits in this work attribute authorship to Claude or any AI
  assistant (per `AGENTS.md`).

---

## Open Risks and Contingencies

**R1 — Schema drift between Swift daemon and JS toolkit.**
PR 1 enforces shared fixtures across both sides. If cross-language validation
is harder than expected, the contingency is to make the JS toolkit the
authoritative validator and have the Swift daemon defer to it for
non-performance-critical surfaces; daemon revalidates only on the producer
side of its own emissions. Do not ship two diverging validators.

**R2 — Puck portability beyond Sigil.**
Decision 5 says the puck must work outside Sigil. PR 3's "puck visible while
browser tab is in front" check is the load-bearing test. If the puck can only
render inside Sigil's renderer, escalate before merging PR 3 — the right fix
is at the `aos show` layer, not in `apps/sigil/`.

**R3 — Browser sensor and existing Playwright adapter coupling.**
The browser intent sensor must layer on top of the existing browser adapter
without forking its lifecycle. If the adapter does not expose the hooks the
sensor needs (page handle, target ref, screenshot capability), the contingency
is to extend the adapter via a small additive PR labeled R3-a, not to fork.
Refer back to `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`.

**R4 — Selector fragility on real pages.**
Decision 6 puts in-page selection in-page on purpose, but real pages still
break selectors. PR 4's stale-selector fallback test asserts visual / spatial
anchors take over. If real-binary V0 walkthrough (PR 6) reveals selectors
breaking faster than visual fallback can catch, file a follow-up issue rather
than widening V0 scope.

**R5 — Safety gates mis-triggering or under-triggering.**
PR 5's gates are heuristic. Acceptance for V0 is "they fire on the obvious
cases (submit, download, file upload, external nav, login fields, payment
fields) and they do not pause routine link clicks or scroll." Tightening
heuristics is a follow-up.

**R6 — Daemon readiness.**
At the time of writing, `./aos ready` may report `input_tap_not_active`. PR 3
real-input tests and the PR 6 walkthrough require a healthy daemon. Use
`./aos ready --post-permission` after any macOS permission refresh, and do
not run repeated ad-hoc repair loops (per `AGENTS.md`).

**R7 — Source pack format churn vs. Employer Brand Audit follow-up.**
The audit follow-up will exercise the source-pack format and likely demand
fields V0 did not anticipate. The contingency is to bump
`source-pack.schema.json` minor version and treat fields added by the audit
plan as additive rather than breaking. V0 must keep `source-pack.json`
forward-compatible.

---

## Self-Review

Run this checklist after the plan lands.

**1. Spec coverage:** Every broad workstream that remains in V0 maps to exactly one PR: run
control to PR 2, the ambient puck to PR 3, intent contracts to PR 1, the
browser intent sensor to PR 4, and steerable collection to PR 5. Replay
codegen, Employer Brand Audit, and desktop intent sensing are captured in
`## V0 Scope > Deferred` so they do not compete with the V0 demo gate.

**2. Placeholder scan:** No "TBD", "implement later", or "fill in details"
in this plan. Two paths are explicitly determined-at-Step-1: Sigil mount
points in PR 3 and PR 5. These are flagged as `Files Discovery` tasks with
a deterministic resolution mechanism (grep), not placeholders.

**3. Type / name consistency:** State names match between the schema PR (PR 1)
and the run-control plane PR (PR 2). Command names match across the puck
PR (PR 3) and PR 2. Event family names (`human.intent`, `human.mark`,
`agent.action.proposed/executed/skipped/blocked`, `run.control`,
`safety_gate.requested/acked`) are used consistently across PRs.

**4. Acceptance gates:** Every PR has explicit tests and acceptance criteria
that the next PR can rely on. No PR's acceptance is "looks good".

**5. Out-of-scope clarity:** Deferred work has named follow-up plan
filenames so the next plan author can find them.

---

## Plan complete.

Pre-implementation, also confirm:

- Daemon health: `./aos ready` is healthy (or has been brought to ready via
  `./aos ready --post-permission` after a permission refresh) before any PR
  3+ live verification.
- Branch policy: per `AGENTS.md`, treat `main` as the integration branch and
  use named topic branches/worktrees for substantive staged work unless the
  user explicitly asks for direct-on-main editing.
- Attribution policy: no `Co-Authored-By: Claude` trailers, no "Generated
  with Claude Code" tags, no AI attribution in commits, PR descriptions, or
  issue comments (per `AGENTS.md`).

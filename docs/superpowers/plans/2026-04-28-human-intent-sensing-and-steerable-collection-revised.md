# Human Intent Sensing and Steerable Collection — V0 Implementation Plan (revised)

> Tracking: GitHub issue #141, "Human Intent Sensing and Steerable Collection Sessions".
>
> Status: revised V0 substrate plan. Supersedes the same-day plan at
> `docs/superpowers/plans/2026-04-28-human-intent-sensing-and-steerable-collection.md`,
> which is preserved for side-by-side comparison.
>
> What changed: corrected toolkit/browser/sensor file layouts to match the actual
> repo, fixed the run puck's mount story (sibling canvas, not Sigil-internal),
> dropped speculative cross-surface fixtures and unreachable voice attribution,
> tightened step semantics and resolution states, named safety-gate heuristics,
> and made the locator strategy explicit (A-prime: candidate array per mark with
> deterministic primary selection and forward-compat structured data).

**Goal:** Ship a steerable browser collection run that a human can pause, step,
take over, and annotate, producing a single canonical timeline plus narrative
and Playwright-replay projections. Generalize the underlying contracts so a
desktop adapter can land later without re-architecting.

**Architecture:** One canonical run timeline, one run-control state machine, one
intent-event contract. Browser is the only sensor adapter in V0. The toolkit
hosts the run-puck (as its own daemon canvas), the run-control plane, and the
in-page intent sensor. `aos` owns the durable session, source pack, evidence
records, and replay generation.

```text
human instruction / steering
  -> run control plane (toolkit, JS)
  -> action gate
  -> intent event contract (shared/schemas)
  -> browser intent sensor (toolkit overlay -> adapter eval -> canonical events)
  -> AOS see/do/show/listen/tell loop
  -> evidence and replay projections
```

**Tech Stack:** Existing AOS primitives (`see` / `do` / `show` / `listen` /
`tell`), existing Playwright browser adapter at `src/browser/` (Swift, already
landed), Sigil collection room surface, JSONL run logs, Markdown narrative
output, Playwright locator candidates baked into each mark for replay codegen
follow-up. No new runtime dependencies. All toolkit code is plain `.js`
(matching `packages/toolkit/runtime/` convention); tests use `node --test`.

**Source Material:**

- Browser adapter (already in `src/browser/`, Swift):
  `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`
- Input surface contract (sibling plan, defines the routing layer below this one):
  `docs/superpowers/plans/2026-04-27-aos-input-surface-contract-proposal.md`
- Canvas inspector object marks (orthogonal — same word, different concept):
  `docs/superpowers/plans/2026-04-18-canvas-inspector-object-marks.md`
- Design operator plan (unrelated, same date):
  `docs/superpowers/plans/2026-04-28-design-operator.md`
- Syborg extension (reference, not vendored):
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/`
- Syborg unified annotation source:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`
- Syborg annotation model:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/lib/annotation-types.ts`
- Employer brand workflow map (downstream consumer, not blocker):
  `wiki-seed/concepts/employer-brand-workflow-map.md`

---

## Decisions changed from prior plan

A reviewer can read just this table plus the original plan to grasp the rework.

| # | Prior plan | Revised plan | Why |
|---|---|---|---|
| 1 | Toolkit at `packages/toolkit/src/run-control/` (TS) | `packages/toolkit/run-control/` (`.js`) | Toolkit has no `src/`; convention is plain `.js` peers under `runtime/`, `panel/`, `components/` |
| 2 | Browser sensor at `src/browser/intent-sensor/` | `packages/toolkit/browser-intent-sensor/` | `src/browser/` is pure Swift; in-page JS belongs in toolkit |
| 3 | Run puck "mounted in Sigil renderer" | Sibling daemon canvas (`aos show create --id run-puck-<session> --track union`) | `aos show` is daemon-driven; nothing mounts inside Sigil's renderer |
| 4 | Cross-language schema validation in PR 1 acceptance | JS-only validation in V0; Swift validator deferred to follow-up | The harness doesn't exist; gating PR 1 on building it would inflate scope |
| 5 | Speculative desktop + canvas fixtures in PR 1 | Browser-only fixtures | Speculative fixtures rot — codify wrong shapes |
| 6 | `source: voice` attribution on `run.control` events | Dropped | macOS doesn't expose voice-vs-keyboard provenance; Voice Control fires hotkeys, period |
| 7 | "Records enough for Playwright codegen" — locator generation hand-waved | Option A-prime: candidate array per mark with deterministic primary, structured data, mark-time validation, versioned strategy | Concrete contract; future codegen can re-rank without re-collecting |
| 8 | Step semantics implicit | "One `do` + observation tail until next propose OR 8s timeout OR manual unblock" | Prevents step from wedging on unobserved tails |
| 9 | `agent.observation` events not in timeline | Added; payload is artifact-ref'd (no inline AX trees) | Replay needs observations; inlining blows up the JSONL |
| 10 | Resolution states `unresolved → acknowledged → bound → captured → stale → rejected` with no triggers | V0 scope: `unresolved → acknowledged → bound`; transitions tied to explicit events | Cuts speculation; gives PR 2 a tight state machine |
| 11 | `evidence-items.jsonl` "minimal — whatever the source pack needs" | Schema in PR 1: `evidence_id`, `mark_ids[]`, `action_ids[]`, `source_url`, optional `quote`, `crop_path` | Audit follow-up gets a stable shape; no churn |
| 12 | Safety-gate detection unstated | Heuristics enumerated (URL host, DOM event, input-name regex) | Heuristic ≠ undefined |
| 13 | Source-pack root unspecified | `~/.config/aos/{mode}/source-packs/<session_id>/` | Operational clarity |
| 14 | "select / region / comment / draw" all in V0 | **select + region + comment**; freehand draw deferred. Region covers box / lasso / encircle (selection, not decoration) | Region is load-bearing for evidence; freehand is illustration |
| 15 | `target_id: "browser:collect"` | Live adapter session id (`browser:<session>/<ref>`) | Match adapter contract; multi-session works |
| 16 | R6 (daemon readiness) listed as risk | Moved to pre-flight | Operational, not architectural |
| 17 | `scripts/source-pack/init.ts \| append.ts` | Library code under `src/sessions/steerable-collection/` | No `scripts/` precedent |
| 18 | `tests/run-puck-real-input.sh` (described as unit-style) | `tests/run-puck-hotkey-binding.sh` (unit-style); manual cross-surface check is the genuine real-input verification | Truth in naming |
| 19 | Browser sensor described as one piece | Two halves named: toolkit (in-page JS) + daemon ride on existing Playwright adapter eval (no new Swift) | Clean page-to-AOS boundary |
| 20 | Single-writer timeline implicit | Stated explicitly: all sources hand events to `runControl.append()` | Prevent improvised locking in PR 5 |
| 21 | `agent.mark.acknowledged` event not named | Added | Trigger for `unresolved → acknowledged` |
| 22 | `directness` field on V0 evidence-item | Dropped | Belongs to audit-workflow normalization stage |
| 23 | Hotkey-handler-as-input-surface-seam not called out | Stated as an architectural seam | Cross-plan integration point |

---

## Reconciled Scope Decisions

| Concern | Decision |
|---|---|
| V0 scope | Ship browser-only steerable collection as the first usable substrate. Keep the platform contract general, but defer replay codegen, Employer Brand Audit, and desktop sensing to named follow-up plans. |
| Task shape | Implement as staged PRs with exact files, tasks, tests, dependencies, and acceptance gates. |
| Spec vs. plan | Architectural context lives in this document; the implementable contracts are owned by PR 1 schemas, not free-floating prose. |
| Dependency order | Schemas first, then run-control logic, then puck, browser sensor, collection orchestrator, demo recipe. |
| Demo definition | Eight-step happy path is an explicit PR 6 acceptance gate. `playwright-replay.spec.ts` is a stub in V0; full codegen is a follow-up plan. |
| Follow-up ownership | Dual-layer replay codegen, Employer Brand Audit V0, desktop intent sensing, and richer evidence schemas are separate plans that consume the V0 source-pack and timeline contracts. |

---

## Decisions Locked Before Implementation

| # | Decision | Rationale |
|---|---|---|
| 1 | Human intent sensing is a platform contract, not a browser feature. | Browser annotations, desktop pointer marks, and canvas object marks must be different adapters for one timeline. |
| 2 | Browser is the first (and only V0) implementation adapter. | DOM refs, accessible roles, selector hints, screenshots, and Playwright replay make browser the least fragile first slice. |
| 3 | Do not vendor the Syborg extension wholesale. | AOS appropriates the overlay model, data types, and interaction lessons while adapting them to AOS primitives. |
| 4 | Run control ships before autonomous collection is considered usable. | The human needs a visible trust handle: pause, resume, step, take over, abort, safety gates. |
| 5 | The run puck is its own daemon canvas, not a Sigil-internal surface. | `aos show` is daemon-driven; the puck must survive across non-Sigil surfaces. |
| 6 | In-page browser overlay is allowed as a precision sensor. | DOM-local selection and drawing are better handled in-page, then normalized into canonical AOS intent events at the toolkit canonicalize boundary. |
| 7 | The append-only run log is canonical. | Narrative Markdown, Playwright replay, evidence JSONL, and UI timelines are projections from one source of truth. |
| 8 | Single-writer timeline. | All event sources hand events to `runControl.append()`. Prevents improvised locking. |
| 9 | Desktop intent sensing is a follow-up plan, not a V0 workstream. | Desktop adds AX/pixel fragility to the first milestone for no V0 demo gain. |
| 10 | Dual-layer replay codegen ships in a follow-up plan. | V0 produces a faithful canonical log and structured locator candidates; codegen quality is its own engineering problem. |
| 11 | Employer Brand Audit V0 is a downstream consumer. | This plan ships the substrate; the audit workflow plan composes that substrate. |

---

## V0 Scope

**In scope (this plan):**

- Run-control state machine and action gate.
- Ambient run puck as a sibling daemon canvas.
- Canonical schemas: `run-control`, `agent-action`, `intent-event`, `human-mark`, `evidence-item`, `source-pack`.
- Browser intent sensor: in-page overlay (select + region + comment), adapter eval bridge, canonicalize with locator candidates.
- Steerable browser collection session that records into a source-pack directory.
- One end-to-end deterministic dry-run on a static fixture page producing a real source pack.

**Deferred (named follow-up plans, to be authored):**

- Dual-layer replay codegen — `docs/superpowers/plans/YYYY-MM-DD-dual-layer-replay-codegen.md`. V0 source pack records candidate arrays; codegen module owns ranking, regeneration, and replay-spec emission.
- Employer Brand Audit V0 workflow — `docs/superpowers/plans/YYYY-MM-DD-employer-brand-audit-v0.md`. Consumes V0 source-pack format. Authored after one real audit collection run shakes out the evidence shape.
- Desktop intent sensor — `docs/superpowers/plans/YYYY-MM-DD-desktop-intent-sensor.md`. Adds AX/screenshot/OCR adapter behind the same intent-event contract.
- Cross-language schema validator (Swift side) — `docs/superpowers/plans/YYYY-MM-DD-shared-schema-validator-swift.md`. Builds the shared-fixture harness on the daemon side.
- Voice command sensor — `docs/superpowers/plans/YYYY-MM-DD-voice-command-sensor.md`. Adds a real `source: voice` attribution path; cannot be done via Voice Control alone.
- Freehand draw mode — folded into the browser intent sensor follow-up that adds richer annotation tooling once the audit workflow demands it.
- Evidence schema beyond V0 minimum — covered in the Employer Brand Audit follow-up.

**Explicitly out of scope (V0 and follow-ups):**

- Background autonomous browsing without visible run control.
- Replacing the existing browser adapter.
- Shipping a new browser product instead of an AOS adapter.
- Generalized visual programming surface.
- Selector stability guarantees across arbitrary sites.

---

## Architecture Context

### Run states and commands

States: `idle`, `planning`, `running`, `paused`, `stepping`, `takeover`,
`blocked`, `aborting`, `completed`, `failed`.

Commands: `pause`, `resume`, `step`, `skip`, `replan`, `take_over`, `release`,
`abort`, `open_timeline`, `open_evidence`.

Source attributions: `puck`, `hotkey`, `chat`, `safety_gate`. (No `voice` —
Voice Control fires hotkeys; from the run-control plane's view it's
indistinguishable, and the OS does not expose voice provenance.)

Safety gates: `before_submit`, `before_download`, `before_file_upload`,
`before_payment`, `before_external_domain`, `before_login_secret`,
`before_destructive_action`.

The action loop:

```text
agent proposes action
  -> agent.action.proposed event
  -> run control checks state
  -> action gate checks (sync) -> Allowed | Blocked(reason) | RequiresGate(kind)
  -> if RequiresGate: emit safety_gate.requested, await safety_gate.acked
  -> execute one atomic action
  -> observe result (one or more agent.observation events, artifact-ref'd)
  -> append agent.action.executed
  -> until next propose OR 8s step-tail timeout OR manual unblock
  -> decide next action
```

Step semantics: a `step` command sets budget=1. The next propose-execute-observe
cycle consumes the budget. The step ends when the agent proposes the next
action **or** an 8-second step-tail timer expires **or** the human unblocks via
puck/hotkey, whichever first. The machine then returns to `paused`.

### Run puck

The puck is **its own daemon canvas**, not a Sigil renderer overlay.
Lifecycle:

- On `session.started`, the orchestrator runs `aos show create --id run-puck-<session> --url aos://run-puck/ --track union`. The daemon spawns a WKWebView at bottom-center, loaded from `packages/toolkit/run-puck/index.html` via the existing canvas-content-server route.
- The puck subscribes to the run-control plane via the same bridge other toolkit canvases use (`packages/toolkit/runtime/bridge.js`).
- On `session.ended` (`completed` | `aborted` | `failed`), the orchestrator dismisses the canvas (`aos show dismiss --id run-puck-<session>`).

Z-order: floating top-most via `--track union`. The puck is not parented to any
window; it survives across non-Sigil surfaces (browser tabs, other apps).

Focus: the puck does not need OS focus to receive hotkeys. Hotkeys reach it
through the input-surface contract's routed-input path (see *Architectural seams*
below). When the operator presses Space, the daemon's input router publishes a
routed input event; the puck's hotkey handler consumes it and emits
`run.control` with `source: hotkey`.

Visual states and primary-click behavior:

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

Default hotkeys (configurable via `~/.config/aos/{mode}/run-puck/hotkeys.json`):

```text
Space        pause/resume
S            step
R            resume
T            take over / release
Esc          pause
Cmd+.        hard pause
Shift+Esc    abort confirmation
```

### Intent event shape

Browser-target example (the only V0 surface):

```json
{
  "type": "human.mark",
  "kind": "element",
  "session_id": "browser-session-<id>",
  "target": {
    "surface": "browser",
    "target_id": "browser:<session>/e21",
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
      "locator_strategy_version": "aos.browser-locator.v0",
      "selected_locator": "role_name",
      "locator_candidates": [
        {
          "id": "role_name",
          "kind": "role",
          "role": "link",
          "name": "Benefits",
          "playwright": "page.getByRole('link', { name: 'Benefits' })",
          "validated_at_mark_time": true
        },
        {
          "id": "text",
          "kind": "text",
          "text": "Benefits",
          "playwright": "page.getByText('Benefits')",
          "validated_at_mark_time": true
        },
        {
          "id": "css",
          "kind": "css",
          "selector": "a[href*='benefits']",
          "playwright": "page.locator('a[href*=\"benefits\"]')",
          "validated_at_mark_time": true
        }
      ],
      "aos_target": "browser:<session>/e21"
    }
  },
  "utterance": "This is probably where benefits proof lives.",
  "confidence": 0.82,
  "resolution": "agent_acknowledged"
}
```

Locator strategy notes:

- `selected_locator` priority order: `role_name → text → css`. The first candidate that resolves to exactly one element on the live page at mark time wins.
- `validated_at_mark_time: true` means canonicalize evaluated the candidate against the live page and confirmed exactly one match.
- `locator_strategy_version: "aos.browser-locator.v0"` so future replay codegen can detect old shapes.
- All three candidates are stored even if only one is selected — replay codegen can re-rank without re-collecting.

Resolution lifecycle (V0 scope only):

| State | Trigger |
|---|---|
| `unresolved` | Mark created by browser intent sensor. |
| `agent_acknowledged` | Agent loop emits `agent.mark.acknowledged` after seeing the mark in the timeline. |
| `bound_to_action` | Agent emits `agent.action.proposed` whose payload references this `mark_id`. |

(`captured_as_evidence`, `stale`, `rejected` defer to follow-up plans. V0 marks
that never get acknowledged simply remain `unresolved` in the source pack.)

Surface-specific anchor groups beyond browser are deferred. The intent-event
envelope is generic; per-surface anchor schemas are owned by their respective
adapter follow-up plans.

### Source pack layout

Root: `~/.config/aos/{mode}/source-packs/<session_id>/`.

```text
source-pack/
  source-pack.json
  collection-session.jsonl
  narrative.md
  playwright-replay.spec.ts        # stub in V0; codegen is a follow-up plan
  artifacts/
    screenshots/
    page-text/
    selected-regions/
    crops/
    observations/                   # agent.observation snapshots (artifact-ref'd)
  evidence/
    evidence-items.jsonl
  marks/
    human-marks.jsonl
```

### Canonical timeline (illustrative)

```json
{"type":"human.intent","text":"Prioritize proof of employee voice over generic culture claims."}
{"type":"agent.plan.step","goal":"Inspect careers navigation for evidence paths."}
{"type":"agent.action.proposed","action_id":"act_042","op":"click","target":"browser:<session>/e17","why":"Open Benefits page."}
{"type":"run.control","command":"step","source":"hotkey","budget":1}
{"type":"agent.action.executed","action_id":"act_042","op":"click","target":"browser:<session>/e17"}
{"type":"agent.observation","observation_id":"obs_077","action_id":"act_042","artifact_refs":["artifacts/observations/obs_077.json"],"summary":"Benefits page loaded; nav, hero, FAQ visible."}
{"type":"human.mark","mark_id":"mark_001","kind":"element","resolution":"unresolved", "...": "..." }
{"type":"agent.mark.acknowledged","mark_id":"mark_001"}
{"type":"human.mark.comment","annotation_id":"mark_001","note":"This claim needs proof."}
{"type":"evidence.captured","evidence_id":"ev_001","mark_ids":["mark_001"],"action_ids":["act_042"]}
```

### Architectural seams

Three integration points with neighboring plans. Spell them out so future
implementers don't re-litigate.

**Seam 1: Run puck as sibling daemon canvas.** The puck is created via
`aos show create` at session start, served from
`packages/toolkit/run-puck/index.html`, dismissed at session end. Sigil's
collection room module triggers creation but does **not** host the canvas. The
puck participates in the same canvas-lifecycle bus other AOS canvases use.

**Seam 2: Hotkey handler bridges input-surface contract → run-control plane.**
The 2026-04-27 input surface contract defines daemon-level routing
(`delivery_role: owned/captured/observed`, `region_id`, `gesture_id`). This
plan defines run-control source attribution at the semantic level
(`puck`, `hotkey`, `chat`, `safety_gate`). The seam is the puck's hotkey
handler in `packages/toolkit/run-puck/hotkeys.js`: it subscribes to routed
input events from the input-surface contract and emits `run.control` events
with `source: hotkey`. This is where physical input becomes semantic command.

**Seam 3: Browser sensor canonicalize generates locator candidates.** The
toolkit overlay collects raw element descriptors (selector, role, name, text)
from the page. `canonicalize.js` synthesizes the three locator candidates
(role_name, text, css), evaluates each via the adapter's eval path against the
live page, records `validated_at_mark_time`, and selects the primary by
priority order. No new Swift; the daemon side rides
`browser-adapter.swift`'s existing `playwright eval` path.

---

## File Structure

The V0 implementation creates the following files. Each PR below names the
subset it owns.

**Schemas (PR 1):**

- Create: `shared/schemas/run-control.schema.json`
- Create: `shared/schemas/agent-action.schema.json`
- Create: `shared/schemas/intent-event.schema.json`
- Create: `shared/schemas/human-mark.schema.json`
- Create: `shared/schemas/evidence-item.schema.json`
- Create: `shared/schemas/source-pack.schema.json`
- Create: `shared/schemas/fixtures/run-control/` (transition fixtures)
- Create: `shared/schemas/fixtures/intent-event/` (browser element, region, comment)
- Create: `shared/schemas/fixtures/evidence-item/` (positives + negatives)
- Modify: `shared/schemas/CONTRACT-GOVERNANCE.md` if cross-tool surfaces change

**Run control plane (PR 2):**

- Create: `packages/toolkit/run-control/state-machine.js`
- Create: `packages/toolkit/run-control/action-gate.js`
- Create: `packages/toolkit/run-control/timeline.js`
- Create: `packages/toolkit/run-control/safety-gates.js`
- Create: `packages/toolkit/run-control/index.js`
- Test: `tests/toolkit/run-control-state-machine.test.mjs`
- Test: `tests/toolkit/run-control-action-gate.test.mjs`
- Test: `tests/toolkit/run-control-safety-gates.test.mjs`

**Run puck (PR 3):**

- Create: `packages/toolkit/run-puck/index.html`
- Create: `packages/toolkit/run-puck/index.js`
- Create: `packages/toolkit/run-puck/canvas.js`
- Create: `packages/toolkit/run-puck/controls.js`
- Create: `packages/toolkit/run-puck/hotkeys.js`
- Create: `packages/toolkit/run-puck/styles.css`
- Test: `tests/toolkit/run-puck-controls.test.mjs`
- Test: `tests/run-puck-hotkey-binding.sh` (drives hotkey events via the
  input-surface route into a stub run-control plane)
- Manual verification (acceptance): puck visible across at least one non-Sigil
  surface (browser tab in front)

**Browser intent sensor (PR 4):**

- Create: `packages/toolkit/browser-intent-sensor/overlay.js` (in-page UI)
- Create: `packages/toolkit/browser-intent-sensor/dom-crawl.js` (ancestor-badge
  tree nav, contained-element resolution)
- Create: `packages/toolkit/browser-intent-sensor/canonicalize.js` (descriptor
  → intent-event with locator candidates and mark-time validation)
- Create: `packages/toolkit/browser-intent-sensor/install.js` (eval entry point;
  invoked via `aos do --target browser:<session> install_intent_overlay`)
- Create: `packages/toolkit/browser-intent-sensor/index.js`
- Create: `tests/fixtures/browser-intent/static-page.html`
- Test: `tests/toolkit/browser-intent-canonicalize.test.mjs`
- Test: `tests/browser-intent-sensor.sh` (drives overlay against the static
  fixture via the existing browser adapter; asserts canonical event emission)

**Steerable collection session (PR 5):**

- Create: `src/sessions/steerable-collection/orchestrator.swift`
- Create: `src/sessions/steerable-collection/source-pack.swift`
- Create: `src/sessions/steerable-collection/safety-gates.swift` (the heuristic
  classifiers — see PR 5 task list)
- Modify: `apps/sigil/renderer/live-modules/main.js` collection room hook (path
  pinned in PR 5 Step 1; expected: a session-start handler that issues the
  orchestrator command and the puck `aos show create`)
- Test: `tests/steerable-collection-session.sh`

**Demo dry-run (PR 6):**

- Create: `docs/recipes/steerable-browser-collection.md`
- Create: `tests/fixtures/v0-demo/demo-page.html`
- Create: `tests/v0-demo-dry-run.sh`
- Create: `docs/superpowers/artifacts/v0-demo/source-pack/` (committed real
  walkthrough output — confirm this is the right artifact location at start of
  PR 6 Step 1)

**Files Discovery note:** Two paths are determined at PR-time rather than
plan-time: the Sigil collection room hook in `apps/sigil/renderer/live-modules/main.js`
(PR 5 Step 1) and the artifact check-in location for the V0 demo walkthrough
(PR 6 Step 1). Each is a single grep / convention check, not open-ended design.

---

## Staged Implementation

Each PR has its own test gate. Do not merge a PR if its tests are not green and
its acceptance criteria are not met.

### PR 1: Schemas and Fixtures Only

**Purpose:** Lock the canonical contracts before any consumer is written.

**Files (this PR only):** as listed under "Schemas (PR 1)" above.

**Tasks:**

- [ ] Define `run-control.schema.json`: states (`idle | planning | running | paused | stepping | takeover | blocked | aborting | completed | failed`), commands, transitions, blocked-state reasons, source attribution (`puck | hotkey | chat | safety_gate`), `budget` field (optional, only meaningful for `step`).
- [ ] Define `agent-action.schema.json`: `proposed | executed | skipped | blocked`; required fields `action_id`, `op`, `target`, `why`; per-op payload variants for V0 browser ops (`click`, `hover`, `type`, `fill`, `key`, `navigate`, `scroll`); also include `agent.observation` (artifact-ref'd: `observation_id`, `action_id`, `artifact_refs[]`, optional `summary`) and `agent.mark.acknowledged` (`mark_id`).
- [ ] Define `intent-event.schema.json`: kinds `human.intent | human.mark | human.annotation | human.override | human.takeover`; browser target context only (`surface: "browser"`, `target_id`, `app`, `window_id`, `url`); semantic / spatial / visual / replay anchor groups; resolution states **V0 subset only** (`unresolved | agent_acknowledged | bound_to_action`); confidence and re-resolution fields. Future surfaces add their own target_context kinds in their own follow-up plans — do not pre-bake.
- [ ] Define `human-mark.schema.json` as a refinement of `intent-event` for marks specifically (kind = `element | region | comment`). The `replay` group on each mark carries `locator_strategy_version`, `selected_locator`, `locator_candidates[]`, and `aos_target`. Each candidate has `id`, `kind` (`role | text | css`), `playwright`, `validated_at_mark_time`, plus kind-specific fields (`role` + `name` for role, `text` for text, `selector` for css).
- [ ] Define `evidence-item.schema.json`: `evidence_id`, `mark_ids[]`, `action_ids[]`, `source_url`, optional `quote`, optional `crop_path`. No `directness` or `confidence` — those belong to the audit follow-up's normalization stage.
- [ ] Define `source-pack.schema.json` covering `source-pack.json` metadata, paths to all JSONL streams + artifact directories, `source_pack_format_version` for forward-compat.
- [ ] Add positive fixtures: representative browser events per kind (element, region with contained elements, comment); a transition fixture for each legal run-control transition; an evidence-item with marks and actions.
- [ ] Add negative fixtures: missing required fields, invalid run-control transitions, locator candidate without `validated_at_mark_time`, evidence-item without `mark_ids[]`.
- [ ] Wire JS-side schema validation in `tests/toolkit/schema-validation.test.mjs`. (Swift-side validation is deferred; see *Out of scope* and the named follow-up plan.)

**Tests / acceptance:**

- All schemas validate against their positive fixtures (JS).
- All negative fixtures fail validation with a recognizable error (JS).
- Fixture directory layout is consumable from both Swift and JS sides (verified by directory structure, not yet by Swift code).
- No daemon emission or Sigil behavior changes in this PR.

**Unblocks:** PR 2, PR 3, PR 4.

---

### PR 2: Run Control Plane and Action Gate (No UI)

**Purpose:** Toolkit-side state machine, action gate, single-writer timeline,
and step-tail timer. Pure logic — no rendering, no browser dependency.

**Files (this PR only):** as listed under "Run control plane (PR 2)" above.

**Tasks:**

- [ ] Implement the state machine matching `run-control.schema.json` with pure-function transitions.
- [ ] Implement the action gate: every atomic action calls `gate.check(action) → Allowed | Blocked(reason) | RequiresGate(kind)` before execution. The gate is sync; the human-ack flow is two-step (`safety_gate.requested` → wait for `safety_gate.acked`) and lives in the orchestrator (PR 5).
- [ ] Implement step semantics: `step` sets budget=1; the budget is consumed by the next executed action. The step ends when (a) the agent emits a new `agent.action.proposed`, (b) the 8-second step-tail timer expires, or (c) a `pause`/`take_over`/`abort` command arrives. The state machine returns to `paused`.
- [ ] Implement takeover semantics: in `takeover`, the gate denies all agent actions; `release` returns control to the agent.
- [ ] Implement safety-gate evaluation: each gate kind maps to a pre-execution check that returns `pass | block | require_human_ack`. The classifiers themselves live in PR 5 (orchestrator); PR 2 owns the dispatch logic.
- [ ] Implement timeline append: single-writer via `runControl.append(event)`. All callers (run-control itself, browser sensor, observation collector, chat, safety gates) hand events to this method. The timeline is in-memory in PR 2; PR 5 wires it to JSONL on disk.
- [ ] Add unit tests for every legal and illegal transition in the schema fixtures; test the gate against fixture actions including each safety-gate kind; test the step-tail timer; test that the action gate denies in `paused`, `takeover`, `blocked`, `aborting`, `completed`, `failed`.

**Tests / acceptance:**

- All transition fixtures pass.
- Gate denies actions in non-running states.
- Step budget is exactly one; the step-tail timer enforces the 8-second bound.
- Single-writer test: concurrent appends from N sources serialize correctly.
- No browser, no `aos show`, no live `aos` binary required to test.

**Unblocks:** PR 3, PR 4, PR 5.

---

### PR 3: Ambient Run Puck (Sibling Canvas)

**Purpose:** Mount the puck as its own daemon canvas, exposing run-control
commands via click and hotkey. The puck is **not** mounted in Sigil's
renderer — it is a sibling canvas served from `packages/toolkit/run-puck/`.

**Files (this PR only):** as listed under "Run puck (PR 3)" above.

**Tasks:**

- [ ] Build the puck HTML/JS at `packages/toolkit/run-puck/`. Layout: bottom-center translucent overlay with state label and primary button. The page subscribes to the run-control plane via the toolkit canvas bridge (`packages/toolkit/runtime/bridge.js`).
- [ ] Wire primary click per the state→command table in *Architecture Context > Run puck*.
- [ ] Implement long-press / secondary-click menu (Pause/Resume, Step, Skip, Replan, Take over, Abort, Open timeline, Open evidence).
- [ ] Implement configurable hotkey bindings, loaded from `~/.config/aos/{mode}/run-puck/hotkeys.json`. Default set per *Architecture Context > Run puck*.
- [ ] Implement the input-surface seam: hotkeys arrive via the daemon's routed-input path (the 2026-04-27 input surface contract). The puck's `hotkeys.js` subscribes to routed input events and emits `run.control` events with `source: hotkey`. Document the seam in a top-of-file comment.
- [ ] Provide the canvas lifecycle: PR 5's orchestrator runs `aos show create --id run-puck-<session>` at session start and `aos show dismiss` at session end. PR 3 itself does not start the canvas — it just provides the content.
- [ ] Add unit tests for state→command mapping, hotkey loading, and the routed-input → run-control conversion.
- [ ] Add `tests/run-puck-hotkey-binding.sh` that drives synthetic routed-input events into the puck's hotkey handler and asserts the right `run.control` command emits with the right `source` attribution.
- [ ] Manual verification (acceptance, not automated): start a session, open a browser tab in front of all other surfaces, confirm the puck is visible bottom-center over the tab. Document the verification steps in PR 3 description.

**Tests / acceptance:**

- Puck renders in all seven states with the correct primary-click behavior.
- Hotkey defaults work; rebinding via the config file works.
- `tests/run-puck-hotkey-binding.sh` passes.
- Manual cross-surface verification documented and confirmed.
- The puck participates in the canvas-lifecycle bus (visible to `canvas-lifecycle.js` subscribers).

**Unblocks:** PR 5.

---

### PR 4: Browser Intent Sensor

**Purpose:** Adapt Syborg's unified annotation mechanics into an AOS-compatible
toolkit module. The toolkit owns the in-page JS; the daemon side rides the
existing Playwright adapter eval path — **no new Swift**.

**Files (this PR only):** as listed under "Browser intent sensor (PR 4)" above.

**Tasks:**

- [ ] Read `unified-annotation.ts` and `annotation-types.ts` from the Syborg reference path. Extract the useful concepts: select / region / comment modes, ElementDescriptor (selector, role, name, textExcerpt), ancestor-badge tree navigation, drag-to-bound region selection with contained-element resolution, bubble text. **Do not vendor** Syborg files. Freehand draw is deferred.
- [ ] Implement `overlay.js`: in-page overlay UI exposing select / region / comment modes against the active document. Region mode supports box / lasso / encircle (drag-to-bound shapes that resolve enclosed elements).
- [ ] Implement `dom-crawl.js`: ancestor-badge tree navigation (top-center badge bar showing path from root, click to walk up/down), contained-element resolution for region marks (find all semantic elements inside a bounded region), and ElementDescriptor extraction.
- [ ] Implement `install.js`: a single-eval entry point that the daemon invokes via the existing `playwright eval` path. The orchestrator runs `aos do --target browser:<session> install_intent_overlay`, which evaluates `install.js` into the page; the overlay then communicates back via the adapter's existing event-return path. The orchestrator emits `start_mode | stop_mode | highlight | remove | request_capture` via the same eval channel.
- [ ] Implement `canonicalize.js`: convert overlay events to `intent-event` records matching `intent-event.schema.json`. Populate browser target context (`browser:<session>/<ref>`, URL, title, window id), viewport geometry, semantic anchors, spatial anchors, visual anchors (screenshot crop via the adapter's screenshot path), and **the locator-candidates array** (Seam 3 above). For each candidate, evaluate it against the live page via the eval path, record `validated_at_mark_time`, and pick `selected_locator` by priority order `role_name → text → css`.
- [ ] Append canonicalized events to the active timeline via the run-control plane's single-writer `runControl.append()`.
- [ ] Add a static fixture HTML page (`tests/fixtures/browser-intent/static-page.html`) with a heading, link, image, paragraph, and form.
- [ ] Add `tests/browser-intent-sensor.sh` driving the overlay against the fixture via the existing browser adapter and asserting:
  - element select emits a `human.mark` with role, name, selector, **and a populated locator-candidates array with `validated_at_mark_time: true` for at least the role_name candidate**;
  - region drawing emits a `human.mark.region` with viewport rect and contained-element ids;
  - comment attaches to the prior mark via `mark_id`;
  - capture writes screenshot + crop artifacts and references them in the mark.
- [ ] Add a stale-selector fallback test: rename the link's text after the mark, then ensure subsequent re-resolution falls back through the candidate priority order without producing a hard error. (Resolution-state transitions to `stale` are deferred to a follow-up; in V0 the test asserts the locator-candidate fallback chain succeeds.)
- [ ] Add `tests/toolkit/browser-intent-canonicalize.test.mjs` — pure unit test for the canonicalize function (descriptor → intent-event), without the eval path. Validates the locator-candidate priority logic and schema conformance against fixtures.

**Tests / acceptance:**

- All three modes (select / region / comment) emit valid canonical events against the fixture page.
- Capture writes artifacts to the expected paths.
- Stale-selector fallback test: at least one candidate validates after the rename, and `selected_locator` reflects the surviving candidate.
- Canonicalize unit test passes against the schema.
- No Syborg files copied into the repo.
- No new Swift files.

**Unblocks:** PR 5.

---

### PR 5: Steerable Browser Collection Session

**Purpose:** Wire run-control + puck + browser sensor + the existing browser
adapter into one orchestrator that turns a natural-language collection goal
into a recorded source pack.

**Files (this PR only):** as listed under "Steerable collection session (PR 5)" above.

**Tasks:**

- [ ] **Step 1 — Files Discovery.** `grep` `apps/sigil/renderer/live-modules/main.js` for the current "Source Collection" or equivalent room module. Pin the exact integration point in this PR's description.
- [ ] Implement session startup in `orchestrator.swift`:
  - Attach or launch a browser target via the existing Playwright browser adapter.
  - Use the adapter's session id (`browser:<session>`); do not hardcode.
  - Create the source-pack directory at `~/.config/aos/{mode}/source-packs/<session_id>/` per the layout in *Architecture Context > Source pack layout*.
  - Instantiate the run-control plane (PR 2 module) and wire the timeline writer to `collection-session.jsonl`.
  - Run `aos show create --id run-puck-<session>` to start the puck (PR 3 canvas).
  - Install the browser intent sensor: `aos do --target browser:<session> install_intent_overlay` (PR 4 install entry).
  - Log a `session.started` event.
- [ ] Implement the live plan view: `current goal`, `current action`, `why`, `risk`, `next checkpoint` — surfaced through a separate `aos show` canvas (distinct from the puck) and via Sigil chat status.
- [ ] Route user steering into the timeline. Sources: Sigil chat (`human.intent`), puck or hotkey (`run.control`), browser sensor (`human.mark.*`). Every event funnels through `runControl.append()` (single-writer).
- [ ] Wrap the existing browser `see` and `do` calls so each action is recorded as `agent.action.proposed` (pre-gate) and `agent.action.executed` (post-gate). A blocked action records `agent.action.blocked` with the gate kind. After each `do`, emit one or more `agent.observation` events with **artifact refs only** — write the snapshot itself to `artifacts/observations/<id>.json`. Never inline AX trees in the timeline.
- [ ] Capture screenshots, page text, selected regions, and mark crops to the `artifacts/` subtree of the source pack. Reference paths from the corresponding events.
- [ ] Implement safety-gate classifiers in `safety-gates.swift`:
  - `before_external_domain`: URL host comparison against the session's anchor host.
  - `before_submit`: DOM `submit` event (via Playwright's page.on('framenavigated') for form submits).
  - `before_download`: Playwright's download event.
  - `before_file_upload`: action targets a `<input type="file">`.
  - `before_payment`: action targets an input whose `name`, `id`, or `autocomplete` matches `(card|cc|cvc|cvv|expir)` (case-insensitive).
  - `before_login_secret`: action targets an input whose `name`, `id`, or `autocomplete` matches `(password|passwd|pwd|otp|2fa|mfa)` (case-insensitive). Also fires for any input with `type="password"`.
  - `before_destructive_action`: action targets a button whose visible text matches `(delete|remove|cancel subscription|close account)` (case-insensitive).

  Each gate emits a `safety_gate.requested` event and the orchestrator awaits a `safety_gate.acked` event (sourced from puck, hotkey, or chat) before executing.
- [ ] Implement `agent.mark.acknowledged` emission: when the agent loop sees a new `human.mark` in the timeline that doesn't yet have an `agent.mark.acknowledged` for it, emit one. State transitions handled by the run-control plane.
- [ ] Emit `evidence-items.jsonl` per the V0 schema: each evidence item is the union of one or more `human.mark` events plus the action(s) that captured them. Optional `quote` populated when text is selected; optional `crop_path` populated when a region or element was screenshotted.
- [ ] On `completed | aborted | failed`: dismiss the puck (`aos show dismiss --id run-puck-<session>`); finalize `source-pack.json` with pointers to all JSONL streams, artifact counts, source-pack-format-version, and final state.

**Tests / acceptance:**

- `tests/steerable-collection-session.sh` runs against a static fixture page served locally, drives a scripted run that includes a pause, a step, a human mark, an acknowledged safety gate, and a clean completion.
- The resulting source pack contains:
  - non-empty `collection-session.jsonl`,
  - at least one screenshot and at least one crop,
  - non-empty `human-marks.jsonl` with locator-candidate arrays,
  - non-empty `evidence-items.jsonl` matching the schema,
  - non-empty `artifacts/observations/` directory referenced by `agent.observation` events,
  - complete `source-pack.json`.
- Schema validation passes on every JSONL stream (JS-side).
- Multi-writer test: simultaneous emissions from sensor, agent, and puck serialize correctly through `runControl.append()`.

**Unblocks:** PR 6.

---

### PR 6: V0 Demo Dry-Run and Recipe

**Purpose:** Prove the system works end-to-end on a representative real page,
not just the test fixture, and produce the recipe a future agent reads to
operate it.

**Files (this PR only):** as listed under "Demo dry-run (PR 6)" above.

**Tasks:**

- [ ] **Step 1 — Files Discovery.** Confirm the artifact location convention for committed walkthrough output. Default proposal: `docs/superpowers/artifacts/v0-demo/source-pack/`. Verify against any existing convention in the repo before checking in.
- [ ] Author the recipe `docs/recipes/steerable-browser-collection.md`: when this workflow applies, prerequisites (`./aos ready`, browser adapter healthy, source-pack root writable), startup sequence, steering options, safety-gate checklist, completion artifacts, troubleshooting.
- [ ] Build a richer demo HTML page: nav with multiple sections, a careers page with a benefits sub-page, two forms (one with login-pattern fields, one with payment-pattern fields), and an external link to a same-origin "external" stub.
- [ ] Add `tests/v0-demo-dry-run.sh` driving the eight-step demo from *V0 Demo Definition* deterministically.
- [ ] Manually walk the demo once with the live `./aos` binary, starting from `./aos ready`. Capture the produced source pack, schema-validate it end-to-end, and check it in at the location pinned in Step 1.
- [ ] Update `ARCHITECTURE.md` with the run-control + intent-event family as cross-tool contracts. Add references to the source-pack format and the locator-strategy version.

**Tests / acceptance:**

- `tests/v0-demo-dry-run.sh` passes deterministically against the demo fixture.
- One real-binary walkthrough produces a valid source pack that schema-validates and is readable end-to-end.
- The recipe is sufficient for a fresh agent to repeat the demo without reading this plan.
- Locator candidates in marks from the real walkthrough are populated and at least one is `validated_at_mark_time: true` per mark.
- Safety gates fire at least once during the walkthrough (e.g., on the login-pattern form).

**Unblocks:** Follow-up plans for replay codegen, Employer Brand Audit V0,
desktop intent sensor, and the Swift-side schema validator.

---

## V0 Demo Definition

The first useful demo is intentionally small. PR 6 makes this deterministic.

1. User starts a browser collection session against a visible tab (Sigil collection room → orchestrator → adapter attaches; source pack root created; puck canvas spawned via `aos show create`).
2. Puck appears bottom-center as `Running` (sibling daemon canvas; visible across non-Sigil surfaces).
3. Agent announces / proposes a browser action (`agent.action.proposed` event).
4. User presses `Space`; routed input arrives at the puck via the input-surface seam; puck emits `run.control` with `source: hotkey`; state flips to `Paused`.
5. User presses `S`; `step` command sets budget=1; gate allows exactly one action; action executes; one or more `agent.observation` events emit with artifact refs; step ends on next propose or 8s timeout; state returns to `Paused`.
6. User adds an annotation via the browser intent sensor (overlay was eval'd into the page at session start; user picks an element). Mark emitted with the locator-candidate array, `validated_at_mark_time` flags, and `selected_locator` chosen by priority. Resolution state: `unresolved`.
7. Agent loop sees the new `human.mark` and emits `agent.mark.acknowledged`; resolution state transitions to `agent_acknowledged`. Agent emits `agent.plan.step` with a revised goal. If the agent's next `agent.action.proposed` references the `mark_id`, resolution transitions to `bound_to_action`.
8. Session writes `collection-session.jsonl`, `human-marks.jsonl`, `evidence-items.jsonl`, `artifacts/observations/`, `narrative.md` (basic stub OK in V0; full codegen is a follow-up plan), and `source-pack.json`. The `playwright-replay.spec.ts` file is left as a stub pointing at the replay-codegen follow-up plan. Puck dismissed.

---

## Acceptance Criteria

- [ ] All schemas in `shared/schemas/` validate their positive fixtures and reject their negative fixtures (PR 1, JS-side).
- [ ] Fixture directory structure is consumable from both Swift and JS sides; Swift validation is deferred to the named follow-up plan (PR 1).
- [ ] State machine, action gate, single-writer timeline, and step-tail timer exist in the toolkit with passing unit tests for every legal and illegal transition (PR 2).
- [ ] Run puck is its own sibling daemon canvas, served from `packages/toolkit/run-puck/`, started/dismissed by the orchestrator (PR 3).
- [ ] Default hotkeys work and are reconfigurable via `~/.config/aos/{mode}/run-puck/hotkeys.json` (PR 3).
- [ ] `tests/run-puck-hotkey-binding.sh` passes (PR 3).
- [ ] Manual cross-surface verification documented and confirmed (PR 3).
- [ ] Browser intent sensor handles select / region / comment against a static fixture and emits canonical events with the locator-candidate array populated (PR 4).
- [ ] Stale-selector fallback test passes via the candidate priority chain (PR 4).
- [ ] No Syborg source files vendored; no new Swift in PR 4 (PR 4).
- [ ] Steerable collection session produces a fully populated source pack against the test fixture, including artifact-ref'd `agent.observation` events (PR 5).
- [ ] All seven safety gates pause execution and resume on ack; classifiers documented in `safety-gates.swift` (PR 5).
- [ ] V0 demo dry-run script passes deterministically (PR 6).
- [ ] One real-binary V0 demo walkthrough produces a valid checked-in source pack with populated locator candidates (PR 6).
- [ ] Recipe `docs/recipes/steerable-browser-collection.md` is sufficient for a fresh agent to repeat the demo without this plan (PR 6).
- [ ] No commits in this work attribute authorship to Claude or any AI assistant (per `AGENTS.md`).

---

## Open Risks and Contingencies

**R1 — Deferred Swift validation drift.**
V0 ships JS-side validation only. The Swift-side validator is a named follow-up.
Until that lands, the daemon may accept payloads the toolkit would reject (or
vice-versa). Mitigation: PR 1's fixture directory is layout-stable from day
one, so the Swift follow-up can plug in without re-shaping fixtures. If
producer/consumer drift surfaces during V0 walkthroughs, the contingency is to
make JS-side validation authoritative for V0 surfaces and treat any Swift-side
emission as additionally-validated by the JS toolkit before any consumer
action.

**R2 — Run puck portability.**
Decision 5 says the puck is a sibling canvas. The PR 3 manual cross-surface
verification is the load-bearing test. If the puck cannot render outside
Sigil's window context, the bug is at the `aos show` canvas layer, not in the
toolkit — escalate before merging PR 3.

**R3 — Browser sensor coupling to the existing adapter.**
The browser intent sensor rides the adapter's eval path with no new Swift.
If the adapter does not expose a stable eval entry for the session
(or if the eval channel can't carry overlay events back), the contingency is
to extend the adapter via a small additive PR labeled R3-a, **not** to fork.
Refer back to `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`.

**R4 — Selector fragility on real pages.**
Real pages still break selectors. PR 4's stale-selector fallback test asserts
the locator-candidate priority chain catches role_name failures via text and
text failures via css. If real-binary V0 walkthrough (PR 6) reveals the chain
itself failing too often, file a follow-up issue rather than widening V0
scope. The structured candidate array is the long-term remedy: future
codegen can add new candidate kinds (e.g., ARIA-described-by, data-testid)
without re-collecting old marks.

**R5 — Safety-gate heuristics mis-triggering.**
PR 5's classifiers are explicit regex/event matchers, not ML. Acceptance for
V0 is "they fire on the obvious cases enumerated in the task list and they do
not pause routine link clicks or scroll." Tightening heuristics is a follow-up.

**R6 — Multi-writer timeline contention.**
Single-writer through `runControl.append()` is the design. If PR 5 implementers
find a path that bypasses `append()` (direct disk write, side-channel emit),
the bug is in PR 5. PR 2's multi-writer test asserts serialization holds.

**R7 — Source pack format churn vs. Employer Brand Audit follow-up.**
The audit follow-up will exercise the source-pack format and likely demand
fields V0 did not anticipate. Mitigation: bump `source-pack.schema.json` minor
version and treat fields added by the audit plan as additive. V0 must keep
`source-pack.json` forward-compatible.

**R8 — Locator strategy maintenance.**
V0 owns the priority logic in `canonicalize.js`. If the priority chain proves
wrong on real pages, the strategy version field (`aos.browser-locator.v0`)
lets us bump to v1 without breaking already-collected source packs. Existing
source packs retain their v0 candidates; new collections use v1.

---

## Pre-flight (operational checks before any PR 3+ live verification)

- `./aos ready` is healthy. If it reports `input_tap_not_active` after a macOS permission refresh, run `./aos ready --post-permission`. Do not run repeated ad-hoc repair loops (per `AGENTS.md`).
- The Playwright browser adapter is healthy: `./aos see capture --xray --target browser:<session>` returns a snapshot.
- Source-pack root (`~/.config/aos/{mode}/source-packs/`) is writable.

These are operational gates, not architectural risks.

---

## Self-Review

**1. Spec coverage.** Every V0 workstream maps to exactly one PR: schemas to PR 1, run control to PR 2, puck to PR 3, browser sensor to PR 4, orchestrator to PR 5, demo to PR 6. Replay codegen, Employer Brand Audit, desktop intent sensing, Swift-side validation, voice command sensor, and freehand draw mode are captured in *V0 Scope > Deferred*.

**2. Placeholder scan.** No "TBD", "implement later", or "fill in details" in this plan. Two paths are explicitly determined-at-Step-1: the Sigil collection room hook in PR 5, and the demo artifact location in PR 6. Each is a single grep / convention check.

**3. Path consistency.** All file paths in this plan match the actual repo layout (toolkit at `packages/toolkit/<peer>/`, browser at `src/browser/` Swift-only, Sigil at `apps/sigil/renderer/live-modules/main.js`, tests as shell scripts using `aos_test_*` harness or `node --test *.mjs`). No `src/` under toolkit. No JS under `src/browser/`.

**4. Type / name consistency.** State names match between PR 1 schemas and PR 2 plane. Command names match across PR 3 puck and PR 2 plane. Event family names (`human.intent`, `human.mark`, `agent.action.proposed/executed/skipped/blocked`, `agent.observation`, `agent.mark.acknowledged`, `run.control`, `safety_gate.requested/acked`) used consistently across PRs.

**5. Acceptance gates.** Every PR has explicit tests and acceptance criteria the next PR can rely on. No PR's acceptance is "looks good".

**6. Out-of-scope clarity.** Deferred work has named follow-up plan filenames so the next plan author can find them.

**7. Locator strategy completeness.** A-prime is fully specified: schema shape, priority order, validation behavior, version field, forward-compat story. Future codegen has everything it needs.

**8. Architectural seams.** Three seams named, each with file paths and ownership. No load-bearing ambiguity.

---

## Plan complete.

Pre-implementation, also confirm:

- Branch policy: per `AGENTS.md`, treat `main` as the integration branch and use named topic branches/worktrees for substantive staged work unless the user explicitly asks for direct-on-main editing.
- Attribution policy: no `Co-Authored-By: Claude` trailers, no "Generated with Claude Code" tags, no AI attribution in commits, PR descriptions, or issue comments (per `AGENTS.md`).

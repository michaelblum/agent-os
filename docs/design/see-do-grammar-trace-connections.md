# See/Do Grammar And Trace Connections

**Date:** 2026-05-04
**Status:** research note / brainstorming

This note connects two threads from an external discussion:

- BNF and grammar-constrained sampling as a way to keep model output inside a
  valid machine-readable shape.
- Playwright event/action recordings as reusable recipes, audit traces, and
  human-visible receipts.

The working question is how those ideas should inform AOS `see` and `do`
without prematurely changing repo contracts.

## Initial Connection

`aos see` is the sensor side of the loop. It emits bounded state: screenshots,
xray elements, semantic targets, focus channels, cursor state, browser refs, AX
paths, canvas ids, and coordinate frames.

`aos do` is the actuator side of the loop. It consumes bounded action forms:
click, hover, drag, scroll, type, key, press, focus, set-value, raise, and
browser-oriented target forms such as `browser:<session>/<ref>` when browser
support is available.

The loop is:

```text
see -> decide -> do -> see again
```

The BNF/grammar-constrained insight is that the action side should not be
free-form prose. The valid next action should be narrowed by the current
perception state, the command registry, target grammars, schemas, and stable
error codes. The agent can still choose, but the shape of valid choices should
be constrained before an action reaches macOS, a canvas, or a browser.

## Recording Uses

The Playwright discussion usefully separates several recording artifacts:

- Codegen-style recording turns observed interaction into a reusable recipe.
- Trace-style recording captures enough state to debug what happened later.
- Video or screencast recording provides a human-readable receipt.

AOS likely needs the same separation. A reusable recipe should prefer semantic
targets and assertions over raw coordinates. An audit trace should capture exact
`see` outputs, `do` invocations, daemon events, target strings, exit codes,
timestamps, and before/after perception frames. A visual receipt can help a
human review the session, but it should not be the only machine-readable
evidence.

For browser targets, raw Playwright traces, video, screencast, and codegen can
remain useful escape hatches. The AOS-level recording is different: it records
which AOS verb was invoked, which AOS target grammar was used, what `see` had
made available, and what the next perception frame showed after the action.

## Replay Hypothesis

Replay should not mean blindly re-firing old events. A robust AOS replay would
use the old trace as a plan, then re-enter the live `see -> decide -> do -> see`
loop at each step.

For each recorded action:

1. Re-perceive the relevant target with `aos see`.
2. Resolve the recorded semantic target again, preferring stable refs and
   accessible names over coordinates.
3. Check that the current state satisfies the recorded precondition.
4. Execute the matching `aos do` action.
5. Re-perceive and compare against the recorded postcondition.

Coordinates remain valid for inherently spatial tasks, but they should carry
their coordinate frame and the perception capture that produced them. When a
semantic ref exists, prefer it.

## Design Questions

- What is the smallest useful AOS interaction trace schema?
- Should trace events be named around CLI verbs, daemon envelope services, or a
  separate interaction-recorder vocabulary?
- How much of a `see` payload should be stored inline versus referenced by
  artifact path?
- Should replay consume a recorded trace directly, or should traces compile into
  a higher-level recipe format first?
- Where does browser-native Playwright evidence attach to an AOS-level trace?
- What is the right stale-ref story for AX refs, browser refs, and canvas
  semantic targets?
- Which failures should be replay blockers versus ordinary branch points?

## Candidate Future Direction

This is not yet a proposal, but the idea points toward:

- A trace schema in `shared/schemas/` only after the shape is clearer.
- A strict target grammar for every `do` action target.
- `see` outputs that preserve enough stable identity for later actions.
- A recorder that captures AOS-level verb envelopes and selected artifacts.
- Replay that re-perceives and re-resolves targets instead of replaying raw
  coordinates by default.

## Source Pointers

- `ARCHITECTURE.md` for sensor, actuator, projection separation.
- `docs/api/aos.md` for the current consumer-facing CLI contract.
- `docs/recipes/agent-entry-paths-and-verification.md` for real-input evidence
  expectations.
- `docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md` for
  browser targets across `see`, `do`, and `show`.

## Codebase Poke: Employer Brand And Capture Workflows

The employer-brand material is real but still decomposed unevenly.
`wiki-seed/concepts/employer-brand-workflow-map.md` is the active canonical
flow: intake, artifact collection planning, evidence collection, normalization,
profile synthesis, comparison, and report preparation. It explicitly leaves
open which stages should become deterministic scripts, where artifacts live
outside the wiki, and where review checkpoints belong.

The collection stage is not implemented as an executor yet. The strongest
current planning artifact is
`wiki-seed/plugins/employer-brand-artifact-collection-planner/SKILL.md`, which
turns an intake brief into a manifest and explicitly says not to browse or
collect during that planning step. The manifest template captures stable
`request_id` values, surface type, URL or target, requested evidence, priority,
status, and notes. That is the natural input to a future "gather web source
artifacts" workflow, but the current repo stops at planning plus downstream
normalization/synthesis contracts.

The legacy KILOS schema is where replay-like capture identity appears most
clearly. `wiki-seed/plugins/kilos-competitor-audit/references/output-schema.md`
defines a provenance chain:

```text
finding -> evidence_id -> evidence_registry entry -> request_id
  -> capture_job_id -> url
```

The same schema includes artifact paths for screenshot, page text, and page
source; operator notes; and nullable `replay_hints` such as wait selectors,
scroll pauses, login requirements, and platform hints. This looks like a
desired capture-execution record, not a current executor.

There is also a root `Employer_Brand_Audit/` HTML report prototype and a
parallel wiki-seed report-generation schema/template. Those are rendering and
delivery surfaces, not collection/playback machinery.

The word "cohorts" does not appear to be an employer-brand domain object in the
repo. The employer-brand docs use "company set", "competitors", and
"companies covered." Existing "cohort" hits are unrelated runtime/package
language.

## Codebase Poke: Existing Record, Replay, Script, And Trace Surfaces

No general AOS workflow recorder/replayer appears to exist yet. The closest
concrete pieces are adjacent, not unified:

- `aos ops` recipes are source-backed operator scripts. They execute declared
  command-registry forms with assertions and cleanup rules. They are authored
  recipes, not recordings.
- Gateway `run_os_script`, `save_script`, and `list_scripts` persist
  hand-authored TypeScript scripts with SDK access. The SDK exposes desktop
  primitives and smart operations, but it does not expose browser target
  strings or Playwright-backed helpers.
- Sigil's interaction trace records bounded diagnostic event history for real
  user interaction bugs. It stores sanitized stages, input events, menu state,
  hit-target decisions, and routing decisions. It does not replay them.
- Canvas inspector bundles capture a point-in-time `see` bundle: screenshot,
  capture metadata, inspector state, display geometry, canvas list, manifest,
  and optional xray. The config intentionally lives under `see` so future
  bundle or record presets can grow beside it.
- Daemon event `snapshot:true` replays current stream state for subscribers.
  That is state replay for pub/sub consumers, not action playback.
- Workbench planning notes describe workflow subjects, browser replay, recorded
  browser actions, Playwright traces, and generated artifact bundles as future
  workbench subjects/artifacts.

This suggests the future capture/playback layer should not start from nothing,
but it also should not pretend any one of those surfaces is already the answer.

## Codebase Poke: Browser As Desktop See/Do

The browser adapter makes Playwright a target medium beneath the existing AOS
verbs. `ARCHITECTURE.md` and the browser adapter spec describe a browser tab as
a first-class target for `see`, `do`, and `show`, with the adapter living in the
CLI process under `src/browser/` and shelling out to `playwright-cli`. The
daemon does not know that a target is a browser tab.

The target grammar is:

```text
browser:
browser:<session>
browser:<session>/<ref>
```

Refs come from `aos see capture browser:<session> --xray`, which parses
Playwright snapshot markdown into AOS `AXElementJSON` records. Browser xray has
refs but usually no bounds; `--label` fetches bounds with one eval call per ref.

The `do` side dispatches existing verbs such as click, hover, drag, scroll,
type, and key to Playwright when the first target is `browser:...`. Browser-only
`do fill` and `do navigate` are implemented as small AOS verbs over
Playwright's `fill` and `goto`. Anything not wrapped, such as tracing, codegen,
tab operations, check/select/upload, reload/back, and arbitrary page scripts,
remains a raw `playwright-cli` escape hatch.

For `show`, `--anchor-browser` resolves a browser ref to a static window anchor
and offset. It follows Chrome window movement through the existing
`anchor_window` substrate, but it does not follow page scroll, zoom,
navigation, or DOM mutation. The agent must re-anchor.

## Gaps And Contradictions Worth Tracking

- The canonical employer-brand workflow has a collection stage but no
  collection executor. The planner explicitly refuses to browse/collect.
- KILOS output schema assumes an artifact bundle returned by "Studio" with
  `capture_job_id` and `replay_hints`, but current Studio/Sigil code appears to
  be a customization/workbench surface, not a web artifact capture engine.
- Gateway marks the two KILOS workflows as launch-ready, while
  `docs/api/integration-broker.md` correctly says they are scaffolds, not
  finished workers.
- Browser adapter docs say no workflow recording/replay/codegen wrapper exists
  in v1, while workbench notes point to that as future subject/artifact work.
  These are compatible, but the distinction should stay explicit.
- Gateway scripts cannot currently use browser refs through the typed SDK.
  A future "gather web source artifacts" worker would either shell out to
  `./aos`/`playwright-cli` directly or need SDK/browser additions.
- `docs/api/aos.md` does not document browser target usage even though
  `ARCHITECTURE.md`, help metadata, and implementation do.
- `aos help see --json` exposes `browser.adapter` as a capability but the
  target discovery/examples do not show `browser:<session>`.
- Existing `do` help shows browser-only `fill`/`navigate`, but the browser
  forms of existing verbs such as `click browser:<session>/<ref>` are not clear
  in usage examples.
- The implementation plan described internal browser debug helpers as omitted
  from help unless verbose, but the command registry has no internal/verbose
  field and `aos help browser --json` exposes them.
- Static browser anchoring is thinner than the plan's content-inset strategy:
  `src/browser/anchor-resolver.swift` currently uses viewport coords plus
  window id and notes that Chrome content-view inset calibration is deferred.
- Browser xray snapshots omit text nodes and no-ref decoration lines. The
  browser smoke test verifies some DOM effects through raw `playwright-cli eval`
  because the current snapshot parser does not surface every visible text
  change as title/value.

## Implication For "Gather Web Source Artifacts"

A plausible next research direction is a capture-run record that sits between
the employer-brand manifest and the evidence bundle:

- input: collection manifest rows with stable `request_id`
- execution: AOS-level `see` and `do` envelopes plus optional raw
  `playwright-cli` escape-hatch calls
- artifacts: screenshot, page text, page source, optional trace/video, and
  operator notes
- provenance: `capture_job_id`, timestamps, URL, target grammar, before/after
  perception, exit codes, and replay hints
- output: evidence registry entries that normalize into the employer-brand
  evidence model

For replay, the safe shape remains semantic and perceptual: re-open or attach
to a browser session, navigate, perceive, re-resolve refs/selectors, execute the
next action, and capture after each meaningful step. Raw coordinate playback
should be a last resort with coordinate-frame metadata attached.

## Layered Recording Hypothesis

A true AOS recording should probably be multi-layered, not a flat event log.
The durable layer is a human-legible workflow spine. The brittle layer is an
evolving execution map attached to that spine.

For web source artifact collection, the spine could be a compact narrative:

```text
Open each company career site, capture the employer value proposition,
save a screenshot and page text, then log gaps for gated review sites.
```

The execution map for that spine might contain Playwright refs, locators,
selectors, waits, network observations, screenshots, page text paths, page
source paths, and trace/video artifacts. Those details are useful but not
canonical. They can be refreshed by re-running the workflow, by observing the
user, or by letting an agent perform a rolling capture. When they drift, the
spine survives and the map is repaired.

For a desktop workflow demo movie, the same shape could hold:

```text
Open the workflow launcher, choose the employer-brand competitor audit,
show the queued job, then open the generated evidence bundle.
```

The execution map would be the desktop equivalent of a Playwright work
sequence: AX refs or selectors, app/window identity, canvas ids, `see` frames,
`do` actions, before/after states, screenshots, and optional video. It is still
secondary to the narrative spine.

## Candidate Unified Unit: Do Step

The smallest portable unit may be a `do_step`, not a raw event. A `do_step`
describes one intentional action plus the perception context that made it safe:

```yaml
id: capture_careers_home
nl: "Open the company careers homepage and capture the initial employer-brand message."
intent: "collect_source_artifact"
surface: "browser"
precondition:
  see: "browser session exists"
  target: "current tab is blank or navigable"
action:
  verb: "navigate"
  target: "browser:kilos"
  args:
    url: "https://example.com/careers"
postcondition:
  see: "page has loaded enough to extract title, text, and screenshot"
artifacts:
  - screenshot
  - page_text
  - page_source
evidence:
  request_id: "example_careers_home"
  capture_type: "navigate"
execution_map:
  browser:
    locator_hints: []
    replay_hints:
      wait_for_selector: "main"
```

That same shape should work for desktop if `surface` changes and the target map
uses AX/canvas/window identities instead of browser refs. This keeps `do` close
to the embodied verb model while borrowing Playwright's useful notions:
semantic locators, actionability, traces, videos, before/after snapshots, and
generated scripts.

The key distinction: the `do_step` is not "click x/y." It is "perform this
intentional action under these observed conditions, producing these artifacts."
Browser and desktop become target dialects under the same envelope.

## External Signals Checked

Current Playwright docs reinforce the split between generated scripts,
locators, traces, video, and screencast/action overlays. Codegen records
actions and assertions while prioritizing role/text/test-id locators; Trace
Viewer gives before/after action state plus source/network/console context;
locators re-resolve before each action; and the newer screencast API can add
action annotations and overlays to video receipts.

Browser-focused agent projects are converging on similar ideas. Browser Use's
`workflow-use` describes a "record once, reuse forever" flow that converts
execution history into semantic workflow files with variables, storage, and
reuse without AI. HyperAgent has "action caching" that records action steps and
can replay them without LLM calls, with fallback when deterministic replay
fails. Desktop-oriented tools such as `agent-computer-use` and `agent-desktop`
show the analogous desktop grammar: observe/snapshot accessibility tree,
target refs/selectors, act, then re-observe.

The useful lesson is not to copy any of these systems directly. It is that AOS
can treat browser and desktop as two dialects of one `see -> do_step -> see`
recording model, with narrative workflow text as the source of durable intent.

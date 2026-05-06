# AOS Grand Unification Plan

**Status:** implementation plan, not a public API contract
**Checkpointed:** 2026-05-05

## Summary

Build AOS around one coherent loop:

```text
see -> decide -> do -> see -> record -> verify
```

AOS remains the canonical control plane. `pi-computer-use` supplies
semantic-first computer-use lessons, `playwright-cli` remains the browser
backend under AOS `browser:<session>/<ref>` targets, Open Design informs
browser-compatible artifact workbenches, the wiki becomes the first Subject
Browser, and work records become the durable evidence/replay/verifier substrate.

Chosen defaults:

- First milestone: foundation hardening.
- Host posture: browser-first for wiki/editor/artifact workbenches.
- Replay posture: record + verify before guided replay.

## Key Interfaces

- Extend AOS docs/help around existing browser targets:
  - `aos see capture browser:<session> --xray`
  - `aos do click browser:<session>/<ref>`
  - `aos do fill browser:<session>/<ref> <text>`
  - `aos show create --anchor-browser browser:<session>/<ref>`
- Treat `--anchor-browser browser:<session>/<ref>` as the current CLI role flag
  for using a browser Target-with-Ref as a `show` Anchor. It is not a separate
  target dialect; resolution produces the display Anchor Binding.
- Keep target dialects explicit:
  - `browser:<session>/<ref>`: Playwright-backed DOM/ARIA targets.
  - `canvas:<canvas-id>/<ref>`: AOS canvas semantic targets.
  - `screen:<state-id>/<x,y>`: coordinate fallback with state guard.
  - `ax:<...>`: future first-class macOS AX refs.
- Evolve `aos.workbench.subject` in a compatible way:
  - Add optional `links`, `facets`, `edit_targets`, and `verification` fields
    after design/schema tests prove the shape.
  - Do not turn wiki pages into editors; wiki pages link to subjects and
    facets.
- Define a work-record v0 contract:
  - `intent`
  - `execution_map`
  - `evidence`
  - `health`
  - `claims`
  - `verifier_report`
- Define verifier report v0:
  - `status`
  - `confidence`
  - `claims`
  - `verified`
  - `failed`
  - `unverified`
  - `evidence_refs`
  - `feedback`

## Implementation Phases

### Phase 1: Stop Losing The Existing Thread

- Add a design note that maps AOS, Pi, Playwright, Open Design, wiki subjects,
  work records, and verifiers into one architecture.
- Update `docs/api/aos.md`, `ARCHITECTURE.md`, and command help examples so
  agents can discover browser targets without prior memory.
- Add regression tests that fail if browser-target examples disappear from
  `aos help see --json`, `aos help do --json`, or `aos help show --json`.
- Preserve current reference clones as local research inputs only:
  - `/Users/Michael/Code/pi-computer-use`
  - `/Users/Michael/Code/open-design`

### Phase 2: Harden The Control Plane

- Normalize AOS target guidance around semantic refs before coordinates.
- Ensure browser `do` responses carry the same execution metadata shape as
  desktop `do`: backend, strategy, fallback flag, and state id.
- Document stale-state policy:
  - Semantic refs are preferred.
  - Coordinates require a `state_id`.
  - Stale coordinate rejection is a future enforcement step, not silently
    assumed today.
- Add focused tests for:
  - Browser xray emits refs.
  - Browser `do` emits execution metadata.
  - Coordinate dry-run preserves `state_id`.
  - Canvas semantic xray still exposes stable `data-aos-ref`.

### Phase 3: Make Subjects The Shared Navigation Model

- Treat wiki as a subject browser, not an editor.
- Promote the workbench subject descriptor as the shared object model for:
  - wiki pages
  - markdown documents
  - work records
  - radial menu items
  - 3D object registries
  - generated artifact bundles
- Add optional subject links:
  - Wiki Markdown links can resolve to subjects.
  - Subjects can link to source files, schemas, workbench facets, and child
    subjects.
- Add one real Navigation Trail of Subject Entry Handles:
  - `wiki:Sigil`
  - `sigil.radial_menu:default`
  - `sigil.radial_menu.item:wiki-graph`
  - `canvas_object:radial.wiki-brain.shell`
  - Each handle resolves to a Subject plus entry Facet; this is not a literal
    chain of Subjects.

### Phase 4: Browser-Hosted Wiki Subject Browser

- The wiki is the first **Subject Browser** (a class of surfaces — see
  `CONTEXT.md` and ADR-0008 — not a wiki-only concept). Phase 4 builds the
  Browser-Hosted instance.
- Make the wiki graph/browser run cleanly in a real browser session as the
  default compatible host.
- Keep AOS canvas hosting available for runtime-integrated surfaces, but do not
  require every editor Facet to ship both Browser-Host and Canvas-Host
  implementations.
- The browser-hosted wiki browser must support:
  - graph browsing
  - markdown facet viewing
  - followable subject links
  - stable semantic controls for `aos see/do browser:<session>/<ref>`
  - opening controls/editor-layer facets when the Subject advertises an
    `editable` capability
- Use the titlebar/path idea only as a locator/trail, not as graph ontology:
  - `*` means return to graph origin.
  - `/` means followed exploration path.
  - Long browsing history collapses.
  - Edit-root/object-path context stays visible during decomposition.

### Phase 5: Work Records And Verifiers

- Add a report-only work-record verifier first.
- A work record captures:
  - the intent
  - the selected subject/facet
  - prior `see` state
  - `do` action
  - execution metadata
  - post-action `see` state
  - artifacts
  - claims
- Verifier v0 consumes saved evidence and emits a structured report.
- No autonomous reprompting in v0.
- Auto-feedback may draft findings; any replay/repair loop needs an explicit
  workflow gate.

### Phase 6: Browser Playbooks

- Add "AOS browser playbooks" as recorded, evidence-backed units, not raw macro
  recordings.
- A playbook step is:
  - re-see target
  - resolve semantic ref
  - check precondition
  - execute `aos do`
  - re-see
  - verify postcondition
- Keep raw `playwright-cli` traces, screenshots, video, and codegen as attached
  evidence or hints, not canonical truth.
- First candidate playbook:
  - open browser-hosted wiki browser
  - locate Sigil subject
  - follow radial menu item subject
  - inspect/edit one object transform
  - save a work record
  - run verifier report

### Phase 7: AOS-Native Runtime Surfaces Stay Native

- Keep these primarily AOS-native:
  - Canvas Inspector
  - DesktopWorld overlays
  - input routing diagnostics
  - spatial telemetry
  - permission/readiness surfaces
- They still expose semantic targets so agents can operate them with `aos
  see/do`.
- They can appear as subjects in the wiki browser, but their runtime projection
  remains AOS-owned.
- Canvas Inspector *may* implement AOS-Native **Subject Browser** behavior when
  navigating live runtime Subjects (canvas registry, input routes, permission
  state). That does not force every diagnostic panel into the full Subject
  Browser contract — it is an additive capability, not a requirement. See
  ADR-0008.

## Test Plan

- Command/help contract:
  - `tests/help-contract.sh`
  - new assertions for browser target examples in `see`, `do`, and `show`.
- Browser adapter:
  - `tests/browser/see-capture.test.sh`
  - `tests/browser/do-existing-verbs.test.sh`
  - `tests/browser/do-fill.test.sh`
  - `tests/browser/show-anchor.test.sh`
- Toolkit/subject contracts:
  - `tests/schemas/aos-workbench-subject.test.mjs`
  - wiki subject tests
  - radial item subject tests
  - work-record subject tests
- Live verification for browser-compatible workbenches:
  - launch browser session with `aos focus create --target browser://new`.
  - run `aos see capture browser:<session> --xray`.
  - act using `aos do ... browser:<session>/<ref>`.
  - verify post-state through AOS, not raw Playwright alone.
- Live verification for AOS-native surfaces:
  - `./aos ready`
  - `./aos show wait`
  - `./aos see capture --canvas <id> --xray`
  - one real-input or captured-routing check for bugs observed by human input.

## Assumptions

- AOS does not depend on `pi-computer-use` at runtime.
- AOS does not import Open Design wholesale.
- Playwright remains an adapter behind AOS browser targets.
- Browser-compatible workbenches are preferred for wiki/editor/artifact
  workflows.
- Canvas Inspector and runtime diagnostics remain AOS-native.
- Record + verify ships before guided replay.
- Macro playback is explicitly out of scope for the first implementation wave.

## Source Map

- AOS primitives and repo contract: `AGENTS.md`, `ARCHITECTURE.md`
- Layered subjects: `docs/recipes/layered-subject-expressions.md`,
  `docs/design/aos-workbench-pattern.md`
- Work records: `docs/design/aos-work-records-and-self-healing-recipes.md`
- Browser recording and grammar: `docs/design/see-do-grammar-trace-connections.md`
- Pi lessons: `docs/design/pi-computer-use-lessons-for-aos-see-do.md`
- Open Design comparison: `docs/design/open-design-workbench-cross-reference.md`
- Local reference checkouts:
  - `/Users/Michael/Code/pi-computer-use`
  - `/Users/Michael/Code/open-design`
- External references:
  - https://github.com/injaneity/pi-computer-use
  - https://github.com/nexu-io/open-design

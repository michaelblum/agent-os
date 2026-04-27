# Recipe: Agent Entry Paths and Verification

Use this recipe when an agent is developing or diagnosing AOS through AOS itself.
The goal is to dogfood the platform without confusing ordinary harness behavior
with elevated developer powers.

## Entry Paths

### Agent Harness

Start from the base harness model. The agent should prefer AOS primitives:
`see` for perception, `do` for action, `show` for projected UI, `tell` for
outbound communication, and `listen` for inbound communication. This is the
default lens for evaluating whether a future AOS app could use the same
capability.

### AOS Developer

Add developer powers only when the work requires changing the platform: editing
repo files, running tests, restarting canvases, reading logs, or committing a
checkpoint. Treat these as elevated privileges, not as capabilities that normal
app agents automatically inherit.

### Testing

Use the smallest stable test harness that exercises the changed behavior. Prefer
local Node/package tests for pure JavaScript and package logic. Use `./aos`
backed tests when the behavior depends on the daemon, canvases, display
topology, input taps, or real host routing.

Synthetic events are appropriate for deterministic state-machine coverage. When
a defect manifests through real mouse or keyboard use, add a real-input spot
check with `./aos do` or capture trace evidence before declaring the issue
fixed. If real input is blocked by macOS permissions, report that explicitly and
use `./aos ready` / `./aos ready --repair` rather than silently substituting a
synthetic-only proof.

### Visual Diagnostics

For display, canvas placement, or coordinate routing work, add visual diagnostic
overlays deliberately. The standard generic add-ons are canvas inspector and
spatial telemetry. They are diagnostic surfaces, not app semantics.

Use app-specific diagnostic panels when the missing facts are internal routing
decisions that generic panels cannot know. Examples include menu hit-test
targets, state transitions, duplicate-event suppression, and control callbacks.
Keep those panels scoped to the app until the pattern proves reusable.

### User-Input Diagnostics

Input bugs need event ownership evidence. Capture enough data to answer:

- Which source produced the event: daemon, hit canvas, DOM, synthetic test, or
  app-specific adapter?
- Which coordinate frame was received and which frame was used for routing?
- Which component claimed ownership of the gesture?
- What state transition or close/cancel reason fired?
- Did a real user event produce a second echo through another surface?

Only after those facts are visible should the fix choose whether the answer
belongs in primitives, toolkit routing, or the app.

## Placement Rules

Record durable guidance at the smallest boundary that will keep it alive without
over-scoping it:

- Repo-wide operating rules belong in `AGENTS.md`.
- App-local contracts belong in the nearest subtree `AGENTS.md`.
- Verification mechanics belong in `tests/README.md`.
- Reusable SOPs and practices belong in `docs/recipes/`.
- Cross-tool or consumer-facing contracts belong in `shared/schemas/`,
  `docs/api/`, or `ARCHITECTURE.md`.
- Runtime knowledge, Sigil agent documents, operator concepts, user/project
  memory, and graphable product knowledge may belong in the AOS wiki.

These sources are not mutually exclusive. Agents developing AOS may need to read
and write the wiki as part of their job, especially when the work changes what a
harness knows or how an operator-facing concept is represented at runtime. The
repo remains the source of truth for engineering contracts and reproducible
verification; the wiki is a first-class runtime knowledge substrate, not a
scratchpad and not a dumping ground for repo-only procedures.

Do not add angry-session reminders, one-off repro notes, or provider-specific
workflow fragments to app contracts or wiki pages. Convert lessons into neutral
rules, checklists, schemas, tests, or runtime knowledge records.

## Checklist

1. Name the current entry path: agent harness, AOS developer, testing, visual
   diagnostics, user-input diagnostics, or an app-specific layer.
2. Use AOS primitives first unless the task explicitly needs repo-level powers.
3. Pick the smallest test loop that matches the changed behavior.
4. For visual/display work, launch the relevant diagnostics instead of relying
   on memory or screenshots alone.
5. For real-input bugs, capture or run at least one real-input verification.
6. If the task touches runtime knowledge, check whether the AOS wiki needs to be
   read or updated in addition to repo docs or code.
7. If a lesson should survive the session, place it using the placement rules
   above before handing the work back.

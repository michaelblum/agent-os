# Recipe: Agent Tooling Contexts and Verification

Use this recipe when an agent is developing or diagnosing AOS through AOS itself.
The goal is to dogfood the platform without confusing ordinary harness behavior
with elevated developer powers.

## Tooling Contexts

Tooling contexts are progressive-disclosure branches. Choose the narrowest path that
matches the task, then backtrack and add layers when the task pivots, the user
asks for a different mode, or evidence shows the current path cannot answer the
question. Do not make non-dev agents read developer/testing procedures unless
their task crosses into that layer.

Be transparent about the active path. When the choice affects what the agent
will read, skip, test, or modify, say the current path briefly. If the session
pivots and the agent adds a layer, call out the change before acting through the
new capability.

## Host Shell Boundary

Treat AOS as the agent shell. The base harness should use typed AOS primitives
and control surfaces before reaching for raw host process execution.

The practical layers are:

- `see`, `do`, `show`, `tell`, and `listen` are the base harness shell.
- `./aos dev ...` is the AOS developer shell for repo workflow, builds, audits,
  and regularized integrations such as GitHub.
- Raw Bash, Node, npm, Python, and arbitrary process execution are
  developer/testing escape hatches. They are useful for building the platform,
  but they should not become the default interface that user-facing agents
  inherit.

When the AOS developer or testing path needs raw process execution, keep the
scope explicit: narrow cwd, bounded command, clear reason, and reviewable side
effects. Prefer a typed AOS control surface when one exists. Add a new control
surface when the same raw command cluster becomes repeated, risky, or easy to
misuse.

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

For repo workflow routing, prefer `./aos dev recommend --json` before choosing
between a Swift rebuild, package-local test, schema test, canvas reload, or
readiness loop. The source of truth is `docs/dev/workflow-rules.json`; update
that manifest and `shared/schemas/dev-workflow-rules.schema.json` when routing
policy changes.

### Testing

Use the smallest stable test harness that exercises the changed behavior. Prefer
local Node/package tests for pure JavaScript and package logic. Use `./aos`
backed tests when the behavior depends on the daemon, canvases, display
topology, input taps, or real host routing.

For runtime, canvas, input, status-item, lifecycle, visual, supervised, or
cross-layer work, use the foundational ladder in `tests/README.md` and the
prep routine in `docs/guides/test-harness-ladder-and-prep.md` when the right
harness is not obvious. Keep fixtures canonical-path representative, and avoid
fixtures that remove the defect variable under test.

Synthetic events are appropriate for deterministic state-machine coverage. When
a defect manifests through real mouse or keyboard use, add a real-input spot
check with `./aos do` or capture trace evidence before declaring the issue
fixed. If real input is blocked by macOS permissions, report that explicitly and
use `./aos ready` / `./aos ready --repair` rather than silently substituting a
synthetic-only proof.

### Visual Diagnostics

For display, canvas placement, or coordinate routing work, add visual diagnostic
overlays deliberately. The standard generic add-ons are Surface Inspector and
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

- Repo-wide signage, hard invariants, and authority routing belong in root
  `AGENTS.md`.
- Dock roles, hook-owned behavior, native prompt contracts, and cross-session
  transfer policy belong under `.docks/`.
- App-local contracts belong in the nearest subtree `AGENTS.md`.
- Verification mechanics belong in `tests/README.md`.
- Reusable SOPs and practices belong in `docs/guides/`.
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

## Instruction Hygiene

Assume capable agents in the harness unless a surface is explicitly meant for
novices or constrained automation. Markdown should orient agents, define
contracts, and point to source-of-truth surfaces; it should not map every
possible step or replace ordinary software engineering judgment.

Use a mix of sources deliberately:

- root `AGENTS.md` for compact signage and hard invariants
- dock and subtree `AGENTS.md` files for compact operating contracts
- `ARCHITECTURE.md`, `docs/api/`, and schemas for platform contracts
- the AOS wiki for runtime knowledge and product memory
- AOS control surfaces and `help` output for discoverable operation
- general engineering principles that current agents already know

Before adding durable instructions, ask whether the text constrains future
agents unnecessarily. Prefer principles, decision rules, and canonical command
examples over exact rituals. Use `must`, `never`, and `always` only for genuine
contracts, safety boundaries, or known destructive operations. If the guidance
is merely one useful workflow, put it in a recipe and phrase it as a default or
starting point.

## Checklist

1. Name the current tooling context: agent harness, AOS developer, testing, visual
   diagnostics, user-input diagnostics, or an app-specific layer.
2. State the active path when it affects what will be read, skipped, tested, or
   modified.
3. Skip sections outside the active path, but backtrack when the session pivots
   or the evidence requires another layer.
4. Use AOS primitives first unless the task explicitly needs repo-level powers.
5. Treat raw shell, Node, npm, Python, and arbitrary process execution as
   developer/testing capabilities, not base harness primitives.
6. Pick the smallest test loop that matches the changed behavior.
7. For visual/display work, launch the relevant diagnostics instead of relying
   on memory or screenshots alone.
8. When a repo-owned scenario harness exists for the behavior, use that harness
   before inventing an ad hoc verification path.
9. For real-input bugs, capture or run at least one real-input verification.
10. If the task touches runtime knowledge, check whether the AOS wiki needs to be
   read or updated in addition to repo docs or code.
11. Before building a new browser, workbench, editor, inspector, or artifact
    panel, identify the subject's layered expressions. See
    `docs/guides/layered-subject-expressions.md`.
12. If a lesson should survive the session, place it using the placement rules
   above before handing the work back.

# Surface Annotation Intent Convergence Tracker

Status: planning tracker only. Do not implement this foundation yet.
GitHub tracker: https://github.com/michaelblum/agent-os/issues/294
Display-first Annotation Mode direction:
`docs/design/display-first-annotation-mode-and-sigil-reticle.md`

The Employer Brand pilot has exposed a missing platform layer: direct
human-in-the-loop intent convergence on a live surface. The current evidence
workflow has strong artifact/control-plane contracts, but the human input loop
is still indirect. An Operator inspects a page, edits a patch file, and reports
what happened. That is auditable, but it is not the final interaction model.

The reusable platform need is a loop where the user and agent converge on
intent directly on the same live surface before a patch or execution plan is
emitted.

## Decision

Treat Surface Annotation Intent Convergence V0 as a foundational
general-purpose workflow. Employer Brand may be the first consumer, but it is
not the abstraction owner.

## Core Loop

1. Agent opens or attaches to a specific live tab, window, canvas, or surface.
2. Agent overlays proposed targets, assumptions, and numbered next steps.
3. User annotates, corrects, selects, rejects, or comments directly on that
   surface.
4. User annotations become structured next-message or event data.
5. Agent converts the structured intent into a plan, patch, or execution gate.
6. Agent updates the overlay and repeats until approval.

## Candidate Primitive Blocks

| Block | Responsibility |
| --- | --- |
| Surface binding | Identify the live surface, coordinate space, ownership, and allowed interaction mode. |
| Overlay anchors | Bind proposed labels, highlights, affordances, and comments to stable surface locations or element refs. |
| Agent proposal layer | Render agent assumptions, candidate targets, alternatives, and numbered next steps. |
| Human annotation layer | Capture user selection, rejection, correction, free-text notes, and approval gestures. |
| Intent convergence record | Preserve the dialogue between proposals and user corrections as structured evidence. |
| Patch emission | Convert approved converged intent into a domain patch, plan, or readiness artifact. |
| Execution gate | Require explicit approval before any destructive, live-capture, or external side-effect step. |

## Relationship To Existing AOS Work

This is not greenfield implementation work. Current and historical footholds
include:

- `shared/schemas/spatial-subject-tree-v0.schema.json`, which defines the
  neutral visible/addressable subject tree connecting DesktopWorld topology,
  AOS canvas targets, surface-owned children, and annotation projections.
- `shared/schemas/annotation.schema.json`, which already models labeled surface
  regions without owning the renderer.
- `shared/schemas/annotation-projection-v0.schema.json`, which models derived
  current geometry for annotation anchors inside a live adapter-owned surface.
- `docs/design/aos-workbench-pattern.md`, which frames the shared loop as
  subject, views, controls, patch channel, persistence adapter, and artifact
  set.
- `docs/design/aos-surface-system.md`, which separates canvases, workbench
  panels, desktop-world visuals, interaction surfaces, and visual/interaction
  bindings.
- Existing `aos see`, `aos show`, `aos do`, `aos tell`, and `aos listen`
  primitives, which are the likely transport and perception/action surfaces.
- The Employer Brand evidence artifacts, which show why indirect patch editing
  is useful for auditability but insufficient for rich HITL target selection.

The tracker should use those footholds as prior art. It should not import an
archived heads-up plan wholesale or make Employer Brand fields generic.

## First Consumer: Employer Brand

Employer Brand needs this loop for source evidence targeting and repair:

- identify exact page elements,
- correct hidden or ambiguous targets,
- approve scroll/wait/viewport assumptions,
- reject login-gated or unavailable sources,
- convert user intent into deterministic approval/repair patches.

Those needs make Employer Brand a good proving ground. They should not force
KILOS, company comparison, employer-brand source categories, or report
semantics into the platform contracts.

## Conservative Extraction Gate

Do not implement broad platform primitives yet. First define contracts and
inventory existing primitives. Implementation should wait until one of these is
true:

- Employer Brand reaches a repeated pain point where direct surface annotation
  would materially simplify the active HITL loop.
- A second workflow needs the same surface annotation/convergence loop.
- A scoped V0 can be proven with a local mock surface and no live external
  capture.

## First Local Proof: Surface-Zoom Inspector

`packages/toolkit/components/surface-zoom-inspector/` is the first bounded proof
of the core surface annotation loop without crossing into live capture or domain
workflow execution. It consumes the fixture Spatial Subject Tree V0 data,
renders the outer DesktopWorld/display/window/canvas/surface structure, lets the
operator select one surface, treats that surface as its own mini-map with
adapter-owned child bounds, and creates local structured annotation intent draft
records from selected nodes.

This proof validates the minimum shared loop: select surface, inspect inside
surface, choose node, draft annotation. It intentionally leaves proposal
overlays, live user correction events, adapter-specific harvesting, patch
emission, and execution gates as future work for the broader convergence model.

The Employer Brand Human Alignment Pack is the first Markdown consumer seed for
that proof. `scripts/markdown-spatial-subject-tree.mjs` converts the checked-in
Markdown alignment pack into a deterministic Spatial Subject Tree fixture at
`docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`.
The seed represents key human decision points as inspectable line-based surface
children, allowing Surface-Zoom Inspector hit-tests to create local annotation
drafts and Surface Hit-Test Inspect verification seeds without resuming capture
or opening target company URLs.

## Contract Questions

- What identifies a surface binding: app/window id, browser tab id, canvas id,
  URL, capture id, or subject id?
- Which coordinate spaces must V0 support: viewport, window-local, captured
  image local coordinate space, DesktopWorld, or DOM element refs?
- How are overlay anchors kept stable across scroll, resize, SPA mutation, and
  reload?
- What event payload represents a user correction versus approval versus
  rejection?
- How does the convergence record preserve both the agent proposal and the
  human override?
- Which fields are neutral and which belong to domain patch emitters?
- How does the execution gate prevent accidental live capture, crawling,
  external writes, or bypass work?

## Non-Goals

- No broad implementation in the current Employer Brand capture path.
- No workflow engine.
- No report renderer or export work.
- No autonomous browser crawling.
- No replacement for current patch artifacts; this should eventually emit
  patches, not bypass audit records.
- No Employer Brand-specific schema in the platform layer.
- No live URL or capture execution as part of the planning tracker.

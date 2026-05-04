# AOS Workbench Pattern

Status: Planning note with narrow contract extraction in progress.

This note captures a platform direction before it leaks out of session memory.
It is not an implementation mandate. Promote slices from this note only when a
concrete consumer needs them and the slice can be specified with explicit
contracts. The first promoted slice is the shared workbench subject descriptor
in `packages/toolkit/workbench/subject.js`.

## Problem

agent-os is accumulating several related needs:

- tune addressable 3D objects in a live or preview canvas
- edit Markdown and render it beside the source
- render Mermaid diagrams from text
- model workflows from Markdown, JSON, and recorded browser actions
- generate and review reports, slide decks, screenshots, and SPA artifacts
- let a human and agent discuss, inspect, edit, validate, and lock in visible
  work

Treating each surface as a one-off app will duplicate the same mechanics:
preview, controls, patching, validation, persistence, artifacts, history, and
agent handoff. Treating everything as a generic "item editor" is also too vague:
a radial menu item, workflow, Markdown document, Playwright recording, report,
and slide deck do not have the same domain model.

The useful abstraction is the workbench loop itself.

## Principle

AOS should provide a reusable workbench pattern:

```text
subject + views + controls + patch channel + persistence adapter + artifact set
```

The subject is what is being edited. Views and controls attach to the subject
through explicit contracts. The subject owner remains responsible for validation
and persistence. The workbench shell coordinates the loop but does not become
the owner of every domain model.

This keeps the platform flexible enough to support design, documents, slides,
3D scenes, workflows, reports, and app-specific editors without forcing them
into one inheritance hierarchy.

## Relationship To Open Design

Open Design is relevant as a working peer pattern, not as code to import
wholesale. Its README describes a local-first design workbench where a local
daemon delegates to existing agent CLIs, skills live as folders with `SKILL.md`,
artifacts render in sandboxed previews, project state persists locally, and
outputs can export as HTML, PDF, PPTX, ZIP, Markdown, images, and video:

https://github.com/nexu-io/open-design

The AOS version should reuse the underlying ideas while preserving AOS layering:

- the AOS daemon already owns primitives such as canvases, content serving,
  IPC, pub/sub, capture, and input
- `packages/toolkit/` should own reusable workbench components
- apps such as Sigil should be consumers, not owners, of the generic pattern
- workflows, reports, slide decks, and visual editors should be first-class
  subjects above the primitive layer

Do not clone Open Design's product shape into Sigil. Learn from its daemon,
skill, preview, artifact, and project-loop architecture.

## Existing AOS Footholds

This is not a greenfield idea. Several AOS threads already point toward the
same platform shape:

- `canvas_object.registry` plus transform and visibility patches already prove
  the owner-publishes, controller-patches, owner-acknowledges loop for 3D
  objects.
- `packages/toolkit/components/object-transform-panel/` is already a reusable
  control surface that listens to a provider-neutral object contract.
- `docs/api/integration-broker.md` describes a provider-neutral workflow
  catalog where Slack is only one transport over reusable workflow and job
  state.
- `docs/sdk-first-scripts.md` treats saved scripts as workflows and frames the
  SDK as primitive wrappers plus higher-level operations.
- `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
  explicitly calls out workflow recording, replay, and codegen as future work
  that should store replayable workflows with canvas provenance.

The workbench pattern should connect these footholds instead of creating a
parallel philosophy.

## Core Concepts

### Subject

A subject is the thing being edited, reviewed, generated, or executed.

Examples:

- 3D radial menu item
- 3D scene
- Markdown document
- Mermaid diagram
- slide deck
- report
- Playwright recording
- workflow graph
- provider session catalog
- generated artifact bundle

A subject needs stable identity, type, capabilities, state, and ownership.
Current adopters publish this as `aos.workbench.subject` so a workbench shell,
agent, or persistence adapter can inspect different subject kinds without
knowing their private renderer internals.

Wiki pages are the next natural subject catalog. A wiki page can project as
`wiki.concept`, `wiki.entity`, `wiki.workflow`, `wiki.reference`, or an
app-specialized type such as `sigil.agent` while retaining its canonical wiki
path as source identity.

### View

A view renders a subject or part of a subject.

Examples:

- source text editor
- rendered Markdown
- Mermaid canvas
- 3D preview stage
- production radial-menu preview
- slide preview
- workflow graph
- execution timeline
- browser replay
- artifact gallery

Multiple views can attach to the same subject. A workflow may be viewed as
Markdown, JSON, a DAG, and an execution timeline. A radial menu item may be
viewed as production radial preview, isolated 3D preview, object graph, and
source config.

### Controls

Controls edit subject state through structured operations.

Examples:

- transform triplets
- visibility toggles
- material controls
- text editor operations
- property inspector fields
- outline/tree controls
- step editor
- dependency editor
- run/pause/resume controls
- validation controls

Controls should not mutate private renderer internals directly. They send
patches or commands to the subject owner and render owner results.

### Patch Channel

The patch channel carries structured edits and results between controls, views,
agents, and subject owners.

Existing `canvas_object.registry`, transform patch, visibility patch, and result
messages are the first narrow example. Future patch classes may include:

- text edit
- property patch
- add/remove/reorder child
- duplicate object
- replace asset
- select/focus
- annotate
- approve/reject
- run/cancel workflow step
- attach artifact

Patches should be reversible where feasible and must produce explicit accepted,
rejected, stale, or validation-result messages.

### Persistence Adapter

The persistence adapter writes accepted subject state back to the correct
source of truth.

Examples:

- source file
- wiki document
- JSON config
- app component module
- generated artifact folder
- workflow run record
- provider session metadata

The workbench should not assume one persistence model. A Markdown subject and a
3D radial menu item can use the same workbench mechanics while saving to very
different places.

### Artifact Set

Artifacts are durable outputs produced or collected by a subject or workflow.

Examples:

- HTML preview
- PDF
- PPTX
- Markdown report
- screenshots
- Playwright trace
- JSON result data
- rendered image
- video

Artifacts need metadata: origin subject, producing workflow run, source files,
validation status, and preview/export routes.

## Workflow Subjects

A workflow is a subject, but it is also an executable composition.

It should be able to contain:

- atomic steps
- reusable sub-workflows
- external tool calls
- human approval gates
- artifact-producing stages
- validation stages
- branches and conditionals
- retries and fallbacks

This makes a workflow a graph or DAG, not only a checklist.

Workflows should also be chainable: one workflow node may reference a reusable
sub-workflow with its own inputs, outputs, approval gates, artifacts, and
validation state. Chaining should be modeled as subject composition, not as a
new special-case editor. A workflow workbench can render the same subject as
source text, JSON, a DAG, a run timeline, or an artifact gallery while patching
the underlying graph through structured node and edge operations.

Example: SPA report workflow

```text
intake source data
  -> capture app state with Playwright
  -> run screenshot QA
  -> generate Markdown report
  -> generate charts
  -> generate slide deck
  -> export PDF/PPTX
  -> review and approval
```

Each child workflow can have its own subject, views, controls, artifacts, and
persistence. The parent workflow composes them and tracks state.

Do not build a full Airflow-style orchestrator from this note. The first model
should be small: workflow id, nodes, edges, inputs, outputs, status, artifact
references, and subworkflow references.

## Candidate Layering

### Level 0: Primitives

The daemon owns OS-facing and host-level primitives:

- canvas lifecycle
- content serving
- IPC and pub/sub
- screen/canvas capture
- input and accessibility actions
- readiness and permission diagnostics

Workbench work should avoid changing the permission-bearing runtime unless a
missing primitive is clearly identified.

### Level 1: Shared Contracts

Shared contracts belong in `shared/schemas/` and `docs/api/` when they become
cross-tool interfaces:

- subject descriptor
- view descriptor
- control descriptor
- patch/result envelopes
- artifact metadata
- workflow descriptor
- workflow run state

Do not add schemas before a concrete adopter needs them.

### Level 2: Toolkit Workbench Components

Reusable workbench components belong in `packages/toolkit/`:

- subject descriptor helpers
- workbench shell
- subject registry viewer
- object transform panel
- property inspector
- source editor
- Markdown renderer
- Mermaid renderer
- 3D preview stage
- artifact gallery
- workflow graph view
- execution timeline
- validation panel

These components should be generic over subject contracts, not hardcoded to
Sigil.

### Level 3: App Consumers

Apps compose toolkit pieces into product experiences:

- Sigil 3D radial menu item editor
- Sigil avatar composition editor
- agent terminal/session workbench
- report builder
- slide deck builder
- workflow modeler
- Open-Design-style artifact studio

Apps own product decisions, naming, layout, and domain-specific persistence.

## First Concrete Adopters

### 3D Radial Menu Item Editor

Use current Sigil radial item work as the first proof.

Minimum slice:

- one subject: a 3D radial menu item
- views: isolated 3D preview and production radial preview
- controls: object list, transform triplets, visibility toggles, scene orbit
- patch channel: current canvas object transform/visibility contract
- persistence adapter: write accepted transforms back to item definition/config

This should prove whether the `subject + views + controls + patch` pattern can
replace one-off tuner pages.

### Markdown/Mermaid Workbench

Use a Markdown document as the second proof.

Minimum slice:

- one subject: Markdown file or wiki page
- views: source editor, rendered Markdown, Mermaid previews for fenced diagrams
- controls: outline, frontmatter/properties, validation diagnostics
- patch channel: text edits and metadata patches
- persistence adapter: file or wiki write-back

This proves the pattern is not only for 3D.

Near-term order:

1. Build a file-backed Markdown workbench before adding wiki persistence. File
   editing is easier to verify, avoids daemon/runtime changes, and matches the
   repo docs use case.
2. Keep the first surface app-owned or demo-scoped if needed, but structure the
   source editor, preview, diagnostics, and persistence seams so they can move
   into `packages/toolkit/` after one real consumer.
3. Start with source plus rendered preview. Add Mermaid fences, outline,
   metadata controls, and richer patch/history only after the basic edit,
   render, validate, and save loop is reliable.
4. Treat the editor as the subject owner. Agent operations should be explicit
   text or metadata patches with accepted/rejected results, not hidden DOM
   mutation.

### Workflow Workbench

Use a small workflow definition as the third proof.

Minimum slice:

- one subject: workflow graph persisted as Markdown or JSON
- views: source, graph, run timeline
- controls: edit nodes, edit dependencies, run/pause/cancel
- patch channel: node/edge/property patches and run commands
- artifact set: links to outputs from each node

This proves composability and sub-workflow references.

## Non-Goals

- Do not create a universal `ItemEditor` class hierarchy.
- Do not make Sigil the owner of generic workbench primitives.
- Do not invent a broad AOS data bus before specific contracts demand it.
- Do not build a full workflow orchestrator from this note alone.
- Do not copy Open Design wholesale into agent-os.
- Do not require Swift daemon changes for workbench behavior that can live in
  content, toolkit, schemas, and app code.

## Promotion Criteria

Promote a concept from this note when all are true:

1. A concrete consumer needs it now.
2. The subject, view, control, or patch boundary can be described in one page.
3. Existing AOS primitives are sufficient, or the missing primitive is narrow.
4. The first adopter can be tested without building a broad platform first.
5. The change creates reusable leverage for at least one plausible second
   adopter.

## Open Questions

- What is the minimal subject descriptor that works for both 3D objects and
  text documents?
- Should workflow definitions live primarily in wiki documents, repo files, or
  a runtime state store?
- How much history/undo belongs in the toolkit versus each subject owner?
- Should artifacts be addressed through wiki, content roots, or a dedicated
  artifact registry?
- How should human approval gates be represented without turning every
  workflow into a bespoke UI?
- Which provider-session concepts should become workbench participants versus
  artifacts?

## Next Planning Move

Do not start with a grand workbench implementation. The 3D radial item tuning
loop is already the first proof. The next practical move is a file-backed
Markdown workbench with source and preview panes, explicit save, and a narrow
text patch/result contract. If that and the 3D workbench fit the same pattern
without contortion, promote the shared shell and subject descriptors into
toolkit workbench components.

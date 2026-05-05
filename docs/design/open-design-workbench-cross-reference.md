# Open Design Workbench Cross-Reference

Status: Research note and adaptation proposal. No runtime implementation.
Tracking issue: #263.

Source studied:

- `nexu-io/open-design` at `b4e69ac`
- Existing AOS docs and code in this worktree on `research/open-design-workbench-study`

## Quick Reference Pass

Before studying the external project, the repo already had one direct reference:
`docs/design/aos-workbench-pattern.md` cites
`https://github.com/nexu-io/open-design` in its "Relationship To Open Design"
section. That note already takes the right stance: Open Design is a peer
pattern to learn from, not code or product shape to copy into Sigil.

The live AOS footholds found during the pass are:

- `shared/schemas/aos-workbench-subject.schema.json`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/workflow-subject.js`
- `packages/toolkit/workbench/work-record-subject.js`
- `packages/toolkit/components/markdown-workbench/`
- `packages/toolkit/components/work-record-workbench/`
- `apps/sigil/radial-item-editor/`
- `apps/sigil/radial-item-workbench/`
- `docs/design/aos-workbench-pattern.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/aos-surface-system.md`

## AOS Baseline

AOS already has a stronger workbench boundary than Open Design. The canonical
unit is `aos.workbench.subject`, with stable identity, owner, source,
capabilities, views, controls, persistence, artifacts, state, and metadata. The
important design point is that the subject owner validates and persists; the
workbench shell coordinates views and controls without becoming every domain
model.

The Sigil radial item model is the clearest item-model proof. A radial item is a
3D subject backed by `DEFAULT_SIGIL_RADIAL_ITEMS`, projected through an object
registry, patched through `canvas_object.*` messages, and exported through a
source-ready `sigil.radial_item_editor.lock_in` handoff. It is deliberately not
browser-side file mutation. This is a good primitive pattern for generated
artifacts: visible preview, structured controls, explicit lock-in, and a
domain-owned persistence adapter.

The Markdown and work-record workbenches prove the same loop for non-3D
subjects. Markdown has source, preview, outline, diagnostics, and explicit save
requests. Work records preserve natural-language intent as the durable spine
while execution maps, evidence, health, and artifacts are synchronized views.
Workflow subjects project wiki maps into chain, graph, source, and artifact
views without turning the projection into a workflow engine.

## Open Design Model

Open Design is organized around local-first design projects. A local daemon owns
privileged work: `.od` state, SQLite persistence, project folders, file access,
agent CLI invocation, artifacts, logs, and task lifecycle. The web layer owns
UI, presentation state, file panels, iframe previews, forms, and streaming
rendering.

Its project model is file-backed. Each project has a working directory under
`.od/projects/<id>/`; the active agent is spawned with that directory as its
`cwd`. Project metadata, conversations, messages, tabs, templates, and status
live in SQLite. The file panel reads the project tree through daemon APIs, not
browser filesystem access.

The artifact model has three layers:

- inline streaming tags: `<artifact ...>...</artifact>`
- sidecar metadata: `*.artifact.json` manifests with kind, renderer, entry,
  status, exports, skill id, design system id, supporting files, and metadata
- renderer routing: HTML, deck HTML, React component, Markdown, SVG, diagram,
  code, mini app, and design-system renderer ids

The UI treats generation as a product workflow, not just a chat transcript. It
has question forms, direction cards, live plan/progress cards, tool-call cards,
file workspace, sandboxed iframe preview, comment bridge, deck bridge, and
export affordances. The prompt stack is a first-class system: discovery rules,
direction library, identity charter, active `DESIGN.md`, craft references,
active `SKILL.md`, project metadata, skill side files, and deck/media
directives compose into the dispatched agent prompt.

The transferable insight is not the Next.js app or `.od` implementation. It is
the way artifact creation is modeled as a project workspace with structured
front-door intake, deterministic skill/design-system context, streamed evidence
of agent work, durable files, preview routing, and export metadata.

## Cross-Reference

| Open Design concept | AOS equivalent today | AOS adaptation opportunity |
| --- | --- | --- |
| Project folder | Runtime-mode isolated state, repo/wiki files, content roots | Add a file-backed artifact-bundle subject instead of a new global project model |
| Artifact manifest | `aos.workbench.subject.artifacts` is present but loose | Promote a small artifact metadata contract after one gallery/preview consumer |
| Sandboxed preview iframe | `aos://` canvases and content server | Host preview panes as AOS canvases/workbench views with content-root routing |
| Skill folders | AOS skills, wiki plugins, gateway integrations | Treat skills as inspectable workflow/reference subjects, not hidden prompt text |
| `DESIGN.md` systems | Wiki/file Markdown subjects and docs | Model design systems as Markdown subjects with preview and token diagnostics |
| Question forms | Human approval/input gates are open design questions | Represent forms as workbench controls and workflow gates, not chat-only markup |
| Direction picker | No generic visual-direction subject | Add optional design-direction references as reusable craft artifacts |
| Agent CLI spawn | AOS daemon already owns primitive actions and `aos` CLI | Avoid copying OD's daemon; use AOS primitives and existing dev/runtime split |
| Tool-call/todo stream | Work records and traces are emerging | Attach run progress and tool evidence to work-record subjects |
| Comment bridge | AOS semantic targets and canvas object controls | Reuse semantic target surfaces for artifact annotations and surgical edits |
| Export list | No first-class artifact export contract | Add export capabilities to artifact metadata, implemented by subject owners |

## What To Adapt

The first high-leverage adaptation is an artifact-bundle subject. It should
represent a generated or collected design output as one workbench subject with a
source folder, entry file, renderer, supporting files, exports, validation
state, provenance, and related work records. This closes the main gap between
AOS and Open Design: AOS can already describe subjects, but it does not yet have
a native artifact studio for HTML, Markdown, slides, screenshots, PDFs, images,
video, and bundles.

AOS should keep the subject descriptor as the top-level interface and make
artifact metadata a child concept. A proposed minimum artifact shape:

```json
{
  "id": "artifact:example-landing",
  "kind": "html",
  "entry": "index.html",
  "renderer": "html.preview",
  "status": "complete",
  "exports": ["html", "pdf", "zip"],
  "files": ["index.html", "assets/hero.png"],
  "source_subject_id": "workflow:example",
  "work_record_id": "work-record:generate-example-landing",
  "validation": {
    "state": "unchecked"
  }
}
```

This should not become a schema yet. It should start as a fixture and
projection helper once a concrete artifact-gallery workbench consumes it.

The second adaptation is a workbench-shell composition for generated artifacts:

- left or center preview pane
- right inspector for manifest, source, exports, validation, and provenance
- bottom or side run/evidence pane for work records and tool events
- source/file pane for entry files and supporting assets
- annotation controls backed by semantic targets when the preview exposes them

The third adaptation is to promote "prompt stack as product" into AOS language.
For AOS this should not be one giant system prompt. It should be a visible
workflow subject whose inputs are design brief, skill/workflow, design system,
craft references, artifact target, approval gates, and validation rules. The
agent may still receive a composed prompt, but the workbench should show and
patch the structured ingredients.

The fourth adaptation is to treat question forms and direction cards as
workflow gates. AOS already has the right vocabulary: controls, approval gates,
human input, and patch/result messages. A design-artifact workflow should expose
the intake form as a control view and persist the answers as subject state, so a
later agent can resume the run without scraping chat prose.

## What Not To Copy

Do not copy Open Design's product shape into Sigil. Sigil should remain a
consumer of toolkit workbench primitives, not the owner of an artifact studio.

Do not introduce a second local daemon or `.od` state model. AOS already has
runtime-mode isolation, content roots, canvases, IPC, pub/sub, wiki namespaces,
and readiness gates.

Do not make SQLite the canonical artifact source just because Open Design does.
For AOS, repo files, wiki pages, runtime state, and generated artifact folders
should remain separately owned sources with explicit persistence adapters.

Do not make `<artifact>` tags the canonical interface. They are useful as one
streaming ingestion format, but AOS should normalize incoming design outputs
into artifact subjects and work records.

Do not promote a broad renderer registry until there are at least two artifact
kinds using it under AOS workbench pressure. Start with Markdown and HTML.

## Proposed Narrow Path

1. Add a docs-only artifact-bundle fixture under
   `docs/design/fixtures/aos-artifacts/` with one HTML artifact and one
   Markdown/report artifact.
2. Add a small projection helper in `packages/toolkit/workbench/` only after
   the fixture shape survives one workbench consumer.
3. Build or extend a read-only artifact gallery workbench view that accepts a
   subject with `artifacts[]` and renders metadata plus links. No generation,
   no export implementation, no agent execution.
4. Add an HTML preview view using the existing AOS content server and
   workbench shell. Keep it file-backed and read-only first.
5. Attach a work-record fixture to the artifact bundle so generated output,
   evidence, and validation state appear in one workbench.
6. Only after the read-only loop works, add explicit save/export/lock-in
   handoffs owned by the artifact subject's persistence adapter.

## Candidate First Subject

The best first subject is not a net-new design generator. It is a captured
artifact bundle representing a generated HTML prototype plus a Markdown report.
That lets AOS test the missing workbench pieces while avoiding agent execution
and prompt-stack complexity.

Candidate subject:

```json
{
  "type": "aos.workbench.subject",
  "schema_version": "2026-05-03",
  "id": "artifact-bundle:example-design-pass",
  "subject_type": "aos.artifact_bundle",
  "label": "Example design pass",
  "owner": "artifact-workbench",
  "source": {
    "kind": "repo_folder",
    "path": "docs/design/fixtures/aos-artifacts/example-design-pass"
  },
  "capabilities": [
    "artifact.gallery",
    "artifact.preview.html",
    "artifact.preview.markdown",
    "work_record.evidence.view"
  ],
  "views": [
    "artifact.gallery",
    "artifact.preview",
    "artifact.source",
    "work_record.evidence"
  ],
  "controls": [
    "open",
    "inspect.artifact"
  ],
  "artifacts": [],
  "state": {
    "artifact_count": 2,
    "validation_state": "unchecked"
  }
}
```

## Open Questions For AOS

- Should artifact folders live under repo paths, wiki namespaces, runtime
  content roots, or a dedicated artifact registry?
- Should `artifacts[]` remain loose objects until a gallery needs stricter
  fields, or should a draft schema be added alongside fixtures?
- How should an artifact preview expose semantic targets for comments without
  granting the iframe direct workbench authority?
- Should design systems be modeled as normal Markdown subjects, or should they
  get a dedicated `aos.design_system` subject type?
- What is the smallest export contract that covers HTML, PDF, ZIP, PPTX,
  images, and video without making every subject implement every exporter?
- Which parts of the prompt stack belong in wiki workflow pages versus
  skill-level instructions versus runtime work records?

## Recommendation

Use Open Design as proof that broad design artifact creation benefits from a
project workspace, deterministic skill/design-system context, preview routing,
and export metadata. Adapt those ideas through AOS's stronger subject-owner
model:

```text
artifact-bundle subject
  + preview/gallery/source/work-record views
  + explicit artifact metadata
  + subject-owned persistence/export handoffs
  + workflow-gated intake and validation
```

That path keeps AOS aligned with primitives first, avoids a parallel product
architecture, and gives the existing workbench/UI framework a concrete bridge
from 3D items and Markdown documents to wide-ranging generated design outputs.

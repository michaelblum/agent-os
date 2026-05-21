# HTML File Workbench V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact: `docs/design/work-cards/html-file-workbench-v0.md`
- Single next goal: add a simple file-backed HTML viewer/editor workbench for local standalone `.html` files.
- Branch/base: start from the current `main` worktree containing this card; expected output branch pattern is `gdi/html-file-workbench-v0`.
- Stop conditions: completed with evidence, failed with technical blocker, stalled/human_needed for repo-mode permission or product direction.

## Fresh Context Contract

GDI starts from a fresh context window in `/Users/Michael/Code/agent-os`. Do not
work in `.docks/`. Do not assume branch, daemon, canvas, issue, prior chat, or
implementation state. Read and rediscover before editing.

## Goal

Make AOS have a simple HTML file workbench analogous to the existing Markdown
Workbench, but scoped to standalone local `.html` files like:

```text
/Users/Michael/Code/tmp/undulating-background.html
```

The user asked whether we have an AOS viewer/editor for simple HTML demos, then
asked Foreman to route GDI to make it.

The new workbench should let a user open a local HTML file in an AOS panel,
edit the source, see a live preview, save back to the file, and reload/revert
without leaving AOS.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/panel-window.md`
- `packages/toolkit/components/markdown-workbench/launch.sh`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/html-workbench-expression/index.js`
- `packages/toolkit/components/html-workbench-expression/launch.sh`
- `docs/design/work-cards/aos-html-workbench-expression-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos dev recommend --json
```

For live AOS verification, run:

```bash
./aos ready
```

If `./aos ready` or a bounded live check reports repo-mode Accessibility, Input
Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and report the script output. After the human
returns with "ready", run:

```bash
./aos ready --post-permission
```

Only continue live checks if it reports ready. Deterministic unit tests may
continue without live AOS if they do not need daemon input.

## Existing Code To Inspect

- `packages/toolkit/components/markdown-workbench/` - file-backed editor
  pattern, source/preview split, save/revert workflow, launcher shape.
- `packages/toolkit/components/html-workbench-expression/` - existing
  annotation-ready HTML projection; useful contrast, but not the target surface.
- `packages/toolkit/controls/textarea.js` - shared textarea control.
- `packages/toolkit/controls/button.js` - shared button rendering/creation.
- `packages/toolkit/panel/index.js` and `packages/toolkit/panel/layouts/` -
  panel mounting and layout helpers.
- `docs/api/aos.md` - current `show create --file`, `show update --file`, and
  canvas semantics.
- `tests/toolkit/markdown-workbench-layout.test.mjs` and adjacent toolkit
  component tests - deterministic component test style.

## Required Behavior

### Component

Add a new reusable toolkit component, likely:

```text
packages/toolkit/components/html-file-workbench/
```

Expected surface behavior:

- opens as an AOS panel with manifest name `html-file-workbench`;
- accepts an event such as `html_file.open` with `{ path, content }`;
- renders a source editor and live preview;
- tracks dirty state when source changes;
- supports Save, Revert, Reload Preview, and Close controls;
- exposes `window.__htmlFileWorkbenchState` with enough state for smoke tests:
  path, dirty, content length/hash, preview mode, last result/status;
- emits a save request/result shape that an agent helper can use to write the
  current source to disk;
- provides a launch helper that opens a local `.html` file and posts its source
  into the workbench.

Suggested launch command shape:

```bash
packages/toolkit/components/html-file-workbench/launch.sh /Users/Michael/Code/tmp/undulating-background.html
```

Default canvas id should be `html-file-workbench`, overrideable with
`CANVAS_ID=...`.

### Editing And Save

GDI may choose either a helper-script save model like Markdown Workbench or a
direct local save helper invoked by Foreman/agent, but the contract must be
clear and deterministic.

Minimum acceptable save path:

- a component Save action emits or records a save request containing the target
  path and current content;
- a repo helper such as
  `packages/toolkit/components/html-file-workbench/save-current.sh
  html-file-workbench` writes the current source back to the file through
  `./aos show eval`;
- successful save clears dirty state or records a save result that the panel can
  consume.

If GDI can keep the implementation smaller with the exact Markdown Workbench
save-current pattern, prefer that.

### Preview

Preview must be useful for standalone demos like the anchor FX lab:

- render the current HTML in an iframe or equivalent contained preview surface;
- preserve CSS and scripts inside the preview well enough for local demos to
  run interactively;
- do not let preview scripts reach the workbench shell DOM;
- keep preview refresh explicit enough that syntax errors do not destroy the
  editor shell;
- show preview errors or blocked state visibly instead of going blank.

Use a sandboxed iframe unless a narrower existing toolkit pattern is clearly
better. If sandboxing prevents local interactive demos from working, document
the tradeoff and choose the safest mode that still supports same-file CSS/JS
inside `srcdoc`.

### Source Handling

- Treat the local `.html` file as the durable source.
- Do not create a metadata sidecar requirement for simple file editing.
- Do not require the generated HTML Expression schema.
- Do not mutate files outside the target path.
- Guard against accidental binary/huge-file opens with a reasonable size check
  or error result.
- Preserve the exact text content on no-op open/save cycles.

### Relationship To Existing HTML Workbench Expression

Keep `html-workbench-expression` intact. It is for safe annotation-ready
projections with metadata and semantic targets. The new workbench is for simple
file-backed source editing and live preview.

Do not merge the two in this slice unless the existing abstraction already makes
that trivial. A wrapper around shared helpers is fine; a broad rewrite is not.

## Scope

Ownership boundary: toolkit component/workbench layer plus focused docs/tests.

Likely paths:

- `packages/toolkit/components/html-file-workbench/index.html`
- `packages/toolkit/components/html-file-workbench/index.js`
- `packages/toolkit/components/html-file-workbench/styles.css`
- `packages/toolkit/components/html-file-workbench/launch.sh`
- `packages/toolkit/components/html-file-workbench/save-current.sh`
- `tests/toolkit/html-file-workbench.test.mjs`
- `docs/api/toolkit/components.md` or another scoped toolkit API doc

GDI may adjust paths after inspecting current toolkit conventions.

## Hard Boundaries / Non-Goals

- Do not implement a full IDE, syntax highlighter, formatter, bundler, npm
  runtime, asset server, or browser automation layer.
- Do not replace Markdown Workbench.
- Do not replace or remodel `html-workbench-expression`.
- Do not add arbitrary dynamic npm installs.
- Do not execute preview HTML in the parent workbench DOM.
- Do not add daemon/native primitives unless a truly blocking gap is discovered;
  report that to Foreman instead.
- Do not edit `/Users/Michael/Code/tmp/undulating-background.html` except as an
  optional live smoke target after the component exists.

## Verification

Run deterministic checks first:

```bash
node --test tests/toolkit/html-file-workbench.test.mjs
node --test tests/toolkit/markdown-workbench-layout.test.mjs tests/toolkit/html-workbench-expression.test.mjs
git diff --check
```

Also run `node --check` on new JS files if they are not covered by `node --test`.

If `./aos ready` passes, run a bounded live smoke:

```bash
packages/toolkit/components/html-file-workbench/launch.sh /Users/Michael/Code/tmp/undulating-background.html
./aos show wait --id html-file-workbench --manifest html-file-workbench --timeout 5s
./aos show eval --id html-file-workbench --js 'JSON.stringify(window.__htmlFileWorkbenchState)'
```

Live smoke should prove:

- manifest readiness passes;
- state names the opened file path;
- source editor exists and contains HTML;
- preview iframe exists and has non-empty rendered content;
- changing source marks dirty and Reload Preview updates the preview;
- save helper can write a harmless temporary copy or no-op save without
  corrupting the target.

If testing against the real tmp demo feels risky, copy it to a temp file and use
the temp file for save/revert proof.

## Completion Report

Report back to Foreman with:

- files changed;
- behavior implemented;
- exact tests run and pass/fail results;
- live AOS smoke result, or the exact readiness/TCC blocker;
- whether `/Users/Michael/Code/tmp/undulating-background.html` was used only as
  a smoke target or left untouched;
- any generated/untracked artifacts;
- known limitations of the preview sandbox;
- recommended next slice, if one remains.

Use a path-scoped summary if unrelated dirty state exists.

# Canonical Canvas Reload Workflow V0

## Tracker

- Epic: #223 AOS Surface System
- Source queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- Checkpoint PR: #307 Surface Stack V0 checkpoint
- Preceding follow-up:
  `docs/design/work-cards/surface-inspector-mark-contract-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. The branch may have unrelated local state such as `.vscode/` or dock
skill edits; do not stage or mutate those unless the active diff proves they are
part of this slice.

## Goal

Make "reload this existing AOS canvas from current content" a canonical,
documented workflow so verification no longer requires ad hoc `show update`,
remove/recreate loops, or accidental loss of developer/admin surfaces such as
`surface-inspector`.

Start by auditing the current `show update` and content-root behavior. If the
existing command surface already provides a safe canonical path, document it and
add focused tests around that path. If not, add the smallest CLI/daemon surface
needed for a real reload workflow.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/api/aos.md`
- `src/shared/command-registry-data.swift`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `tests/help-contract.sh`
- `tests/daemon-ipc-show.sh`
- `tests/show-wait.sh`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
./aos show --help
rg -n "show reload|show update|reload this canvas|content root|canvas reload|show create|show remove|show wait" docs/api/aos.md tests src/display src/daemon src/shared packages/toolkit/components
```

Before choosing build/test commands after edits, run `./aos dev recommend
--json` again.

## Existing Behavior To Inspect

Current known surface:

- `./aos show update --id <name> --url <url>` can change a canvas URL.
- `./aos show update --id <name> --html/--file` can replace inline/file
  content.
- `./aos show wait --id <name> --manifest <name> --js <condition>` is the
  readiness gate after content changes.
- Component launch scripts often use remove/create loops because there is no
  obvious "reload current URL from active content root" command.
- Worktree-scoped content roots may require `scripts/aos-content-scope.sh` or
  `aos content wait` before a canvas can load current files.

Inspect whether `show update` preserves frame, scope, interactivity,
window-level, parent, surface/track, lifecycle metadata, and focus behavior when
only URL/content is updated. If it does, a documented reload recipe might be
enough. If it does not, implement the narrow missing primitive.

## Required Behavior

### Canonical Workflow

By the end of the slice, a developer should have one clear answer for:

> "I changed web assets under the active content root. How do I reload this
> existing canvas without recreating it or disturbing unrelated canvases?"

The answer must be in `docs/api/aos.md`, and if there is a CLI addition it must
also appear in `./aos show --help` and `./aos help show ... --json`.

### Preservation Semantics

The reload workflow should preserve the existing canvas identity and placement
state unless the user explicitly changes it:

- canvas id;
- frame/segments/track/surface when applicable;
- scope;
- interactivity;
- window level;
- parent relationship;
- TTL unless explicitly refreshed;
- lifecycle metadata appropriate for a reloaded canvas.

If any of these cannot be preserved by the chosen implementation, document the
exception and add a test proving the current behavior.

### Content Root Semantics

Document or implement how the workflow interacts with content roots:

- `aos://...` URLs should reload from the current active content server root;
- if a content root is not live, the command or recipe should make the required
  `aos content wait` / root-scope step obvious;
- do not overwrite canonical `toolkit` or `sigil` roots from topic worktrees.

### Possible Implementation Paths

Choose the smallest path after inspection:

- **Docs/test-only path:** document `show update --id <id> --url <same-url>`
  plus `show wait` as the canonical reload workflow if it is safe and adequate.
- **Small CLI path:** add a narrow `aos show reload --id <name>` or equivalent
  flag that reloads the existing canvas's current content URL while preserving
  canvas metadata.

If adding a CLI path, update parser/help registry/API docs/tests together.

## Scope

This is an AOS CLI/display/daemon contract slice. It may touch Swift, docs, and
shell tests. It should not touch Sigil product behavior, Surface Inspector UI,
or toolkit component internals except for tests/fixtures that prove reload
against a simple component.

## Hard Boundaries

- Do not add app-specific reload behavior.
- Do not add a broad hot-module-reload/watch system.
- Do not change content-root scoping policy except to document or use existing
  scoped-root helpers.
- Do not remove/recreate canvases inside a command called "reload" unless the
  behavior is explicitly documented and tested as a fallback.
- Do not disturb preserved surfaces like `surface-inspector` in tests; use
  isolated daemon roots or unique test canvas ids.

## Suggested Implementation Areas

Likely files:

- `src/shared/command-registry-data.swift`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `docs/api/aos.md`
- `tests/help-contract.sh`
- `tests/daemon-ipc-show.sh`
- `tests/show-wait.sh`
- new focused shell test such as `tests/show-reload.sh` if a CLI primitive is
  added.

## Verification

Minimum for docs/test-only:

```bash
git diff --check
bash tests/help-contract.sh
bash tests/show-wait.sh
```

If Swift or command parser/registry changes:

```bash
./aos dev build
./aos ready
bash tests/help-contract.sh
bash tests/daemon-ipc-show.sh
bash tests/show-wait.sh
```

If a new reload command is added, include a focused shell test that proves:

- reloading an existing URL/file-backed canvas updates content;
- frame and interactivity are preserved;
- unrelated canvases are not removed;
- `show wait` can be used after reload.

Run broader commands only if `./aos dev recommend --json` points to them.

## Completion Report

Include:

- whether the final path is docs/test-only or new CLI behavior;
- files changed;
- exact reload workflow wording or command added;
- preservation semantics verified;
- tests run and results;
- readiness result or blocker;
- next follow-up recommendation from
  `surface-stack-retrospective-followups-v0.md`.

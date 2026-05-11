# Surface-Zoom Markdown Preview AOS Source Resolution Fix V0

## Goal

Fix the Markdown preview layer so it actually loads Markdown source in an AOS canvas launched from dock/worktree-scoped content roots.

The previous Surface-Zoom Markdown preview/highlight slice added model/UI support, but Foreman AOS smoke found the browser preview still falls back to synthetic overlay because Markdown source fetch fails with `404`.

## Foreman Reproduction

Command:

```bash
./aos ready
AOS_SURFACE_ZOOM_INSPECTOR_ID=surface-zoom-markdown-preview-review \
AOS_SURFACE_ZOOM_INSPECTOR_TREE_URL=aos://repo_codex_docks_session_roots/docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json \
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

Observed structured state:

- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` correctly selects `target:line-041-company-and-competitor-set`.
- `snapshot.selected_line_range` is `{ start_line: 41, end_line: 49 }`.
- synthetic overlay hierarchy metadata is present.
- `snapshot.markdown_preview.status` is `fallback`.
- `snapshot.markdown_preview.fallback_reason` is `source fetch failed: 404`.
- `snapshot.map_display_mode` stays `overlay`.
- `.surface-zoom-markdown-preview` is not present.
- no `.surface-zoom-source-line-highlight` elements are present.

Root cause to address:

- `packages/toolkit/components/surface-zoom-inspector/index.js` currently resolves repo-relative Markdown source paths to `aos://repo/...`.
- The launched tree came from `aos://repo_codex_docks_session_roots/...`.
- The Markdown source URL should resolve against the active tree URL's AOS content root/authority, not a hard-coded `repo` root.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent focused tests only if needed

## Required Fix

Make Markdown source resolution content-root aware:

- If the tree fixture URL is an `aos://<root>/...` URL and the Markdown source path is repo-relative, resolve the Markdown source to `aos://<same-root>/<source-path>`.
- If the source path is already absolute or has a protocol, preserve it.
- If the app is running from a non-AOS browser/file/http context, preserve the current local relative fallback behavior.
- Do not hard-code `aos://repo/`.

The fix should work for arbitrary branch/worktree/dock-scoped content roots such as:

- `aos://repo_codex_docks_session_roots/...`
- future `aos://<branch-scoped-root>/...`

## Required Behavior After Fix

With the same Foreman reproduction:

- Markdown preview fetch succeeds.
- `snapshot.markdown_preview.available === true`.
- `snapshot.markdown_preview.status === "ready"`.
- `snapshot.map_display_mode === "both"` by default for Markdown subjects.
- `.surface-zoom-markdown-preview` is present.
- rendered Markdown text is visible.
- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` selects `target:line-041-company-and-competitor-set`.
- highlighted rendered source lines include 41 through 49.
- synthetic overlay hierarchy/inset remains presentation-only and does not alter hit-test coordinates, stored bounds, drafts, or verification seeds.

## Tests

Add focused tests for source URL resolution, including:

- AOS tree URL root is reused for repo-relative Markdown source paths.
- `aos://repo_codex_docks_session_roots/...` produces `aos://repo_codex_docks_session_roots/docs/.../human-alignment-pack.md`.
- already-protocol source URLs are preserved.
- non-AOS fallback remains local/import-relative.

Keep existing tests for:

- Markdown preview state and line-range highlight.
- `inspectPoint(...)`.
- overlay hierarchy presentation metadata.

Run:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/markdown-render.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- `bash tests/help-contract.sh`
- `git diff --check`

If `./aos ready` passes, run the bounded AOS smoke above and remove the smoke canvas afterward.

The smoke must verify:

- Markdown preview is visible.
- No document-level horizontal overflow.
- default display mode is `Both`.
- selecting/inspecting company competitor target highlights lines 41-49.
- diagnostics remain hidden/collapsed by default.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not add new preview types beyond fixing Markdown preview source resolution.

## Completion Report

Report:

- changed files;
- exact source-resolution rule implemented;
- AOS smoke evidence, including preview status and highlighted lines;
- verification commands and results.

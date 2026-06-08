# Surface Inspector See Bundle Clipboard Payload Mode V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Snapshot issue: https://github.com/michaelblum/agent-os/issues/298
- Builds on:
  - `7be60c3` `fix(surface-inspector): preserve capture permission boundary`
  - `19fee7e` `feat(toolkit): align annotation snapshots with shared session`
- Related cards:
  - `docs/design/work-cards/surface-inspector-annotation-snapshot-artifact-v0.md`
  - `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
permissions, config state, clipboard contents, bundle paths, live annotation
state, or prior implementation state. Read and rediscover before editing. Work
in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Add the next #298 snapshot behavior: a configurable clipboard-payload mode for
Surface Inspector see-bundle exports when the operator does not want the daemon
to write a temp bundle directory.

The current behavior remains the default: write a temp bundle directory and copy
the bundle path to the system clipboard. The new mode should make the clipboard
itself the durable handoff payload for metadata and annotation snapshot evidence,
without embedding image binary/base64 data in JSON and without turning snapshots
into a persistent live annotation database.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/surface-inspector-annotation-snapshot-artifact-v0.md`
- `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
- `src/shared/config.swift`
- `src/commands/config-command.swift`
- `src/daemon/surface-inspector-bundle.swift`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos permissions check --json
./aos dev recommend --json
./aos dev gh issue view 298 --json
rg -n "canvas_inspector_bundle|annotation_snapshot|clipboard|capture_bundle|requestSeeBundle" src packages tests docs
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic tests only unless Foreman or the human
explicitly routes runtime repair work.

## Required Behavior

### 1. Add A Configurable Output Mode

Add a small config surface under the existing daemon-owned namespace:

```text
see.canvas_inspector_bundle.*
```

Choose the smallest clear key shape after inspecting existing config helpers.
Suggested shape:

```text
see.canvas_inspector_bundle.output.mode = bundle_path | clipboard_payload
```

Equivalent names are acceptable if they fit existing config style better, but
the public contract must be documented and discoverable through `aos config get`
and `aos config set`.

Default behavior must remain `bundle_path`:

- write the temp bundle directory;
- copy the bundle directory path to clipboard;
- preserve current bundle manifest and include-toggle behavior.

### 2. Define Clipboard Payload Mode

When configured for clipboard payload mode:

- do not write a temp bundle directory for the export;
- copy a JSON payload to the clipboard;
- include a clear top-level identity, for example
  `kind: "canvas_inspector_see_bundle_clipboard_payload"`;
- include status, created timestamp, trigger, shortcut/config, source canvas id,
  and the resolved include toggles;
- include the public `surface_inspector_annotation_snapshot` payload inline when
  `include.annotation_snapshot=true`;
- include inspector state, display geometry, and canvas list inline only when
  their include toggles are enabled and the data is already available without a
  disk bundle;
- do not embed image binary, base64 image data, or `data:image/...` values;
- if capture image/metadata/xray cannot be represented without disk files,
  record explicit unavailable/skipped evidence instead of silently pretending
  those artifacts exist.

The payload should be useful if pasted into another session. It should not be a
hidden persistence layer for live annotations.

### 3. Surface Inspector Status And Settings Exposure

Surface Inspector should make the active export mode visible in the existing
bundle/status area or support summary. Add only the smallest UI/status exposure
needed for an operator to tell whether `ctrl+opt+c` will copy a path or a JSON
payload.

If a settings/menu control already has a natural home, expose the mode there.
If adding a new interactive settings surface would be broader than this slice,
document the config command in the status copy/docs and report the UI follow-up
explicitly instead of forcing a large menu refactor.

### 4. Preserve Existing Contracts

Preserve:

- `ctrl+opt+c` and `requestSeeBundle(...)`;
- `see.canvas_inspector_bundle.include.*` toggles;
- current disk bundle behavior by default;
- `annotation-snapshot.json` schema/version and session-derived snapshot
  semantics;
- no image binary/base64 in JSON;
- no persistent annotation database.

Do not route around the daemon permission boundary fixed in `7be60c3`.

## Scope

Likely ownership:

- `src/shared/config.swift`
- `src/commands/config-command.swift`
- `src/shared/command-registry-data.swift` if help examples or config key docs
  need discoverability updates;
- `src/daemon/surface-inspector-bundle.swift`
- `packages/toolkit/components/surface-inspector/index.js` for status display
  only;
- `docs/api/aos.md`
- `docs/api/toolkit/components.md`
- bundle/config shell tests and focused Surface Inspector tests.

Swift changes are likely. Use `./aos dev recommend --json` before deciding the
build/verification loop.

## Hard Boundaries / Non-Goals

- No annotation snapshot schema redesign unless a tiny optional clipboard
  payload wrapper schema is clearly needed.
- No persistent annotation database.
- No sync service.
- No report/export renderer.
- No image binary or base64 JSON payloads.
- No broad Surface Inspector settings UI rewrite.
- No Sigil reticle behavior changes except preserving the shared
  `canvas_inspector.capture_bundle` trigger path.
- No service-wide TCC reset or permission-flow changes.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json
./aos dev build
node --test tests/toolkit/surface-inspector.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
git diff --check
```

Add or extend a shell test so both output modes are covered:

- default mode copies a bundle path and writes bundle files;
- clipboard-payload mode copies parseable JSON and does not require a bundle
  directory;
- clipboard-payload mode preserves annotation snapshot payload identity and
  rejects embedded image data;
- include toggles remain reflected in output status/config.

If `./aos ready` passes, run a bounded live smoke:

1. Open Surface Inspector.
2. Enter Annotation Mode and create or reuse one visible frame anchor/comment.
3. Set clipboard payload mode.
4. Trigger `requestSeeBundle(...)` or `ctrl+opt+c`.
5. Verify the clipboard contains parseable JSON with the annotation snapshot
   session data and no embedded image data.
6. Restore default bundle-path mode before finishing.
7. Clean up smoke canvases and temp artifacts.

If live readiness is blocked, report the exact blocker and deterministic
coverage completed.

## Completion Report

Report:

- changed files;
- final config key shape and defaults;
- clipboard payload top-level shape;
- how disk bundle behavior stayed compatible;
- how Surface Inspector exposes the active mode;
- exact tests and results;
- live smoke result or readiness blocker;
- final `./aos ready`;
- final `git status --short --branch`;
- recommended next #298 slice, if any.

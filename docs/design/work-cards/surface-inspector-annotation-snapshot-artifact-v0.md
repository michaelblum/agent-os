# Surface Inspector Annotation Snapshot Artifact V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active issue: https://github.com/michaelblum/agent-os/issues/298
- Builds after accepted Surface Inspector adapter work:
  - `7da2d3f Add root-scoped annotation candidates`
  - `3b685e5 Reveal AOS semantic annotation targets`
  - `04198c9 Add native AX annotation candidates`
  - `853cb0e Guard annotation hit layer frames`
  - `baec91c Preserve native AX root kind in scopes`
- Existing bundle docs:
  - `docs/api/toolkit/components.md`
  - `docs/api/aos.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Make Surface Inspector annotation snapshots a first-class, versioned see-bundle
artifact.

After this slice, `ctrl+opt+c` / `requestSeeBundle()` should still produce the
existing bundle directory, but the bundle should also contain a durable
`annotation-snapshot.json` payload with a public schema and fixtures. The
payload must represent the in-memory Annotation Mode state at capture time
without introducing a long-lived annotation database.

This is the contract/artifact slice for #298. Keep the existing disk bundle
default and clipboard-path behavior compatible. Leave disk-write-disabled
clipboard-payload mode and menu/settings UI for a follow-up slice unless the
implementation already has an unavoidable tiny seam.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/work-cards/surface-inspector-annotation-layer-foundation-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-root-candidate-adapter-v0.md`
- `docs/design/work-cards/surface-inspector-aos-semantic-target-reveal-v0.md`
- `docs/design/work-cards/surface-inspector-native-ax-candidate-adapter-v0.md`
- `docs/api/toolkit/components.md`
- `docs/api/aos.md`
- `shared/schemas/CONTRACT-GOVERNANCE.md`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
gh issue view 298 --json number,title,state,url,body,labels,comments
./aos ready
./aos dev recommend --json
```

If `./aos ready` is blocked by macOS permission/TCC state, do not loop repair.
Report the concrete blocker and continue with deterministic Node/schema tests
where possible. If Swift files are changed, use `./aos dev recommend --json`
before choosing build or integration checks.

## Existing Code To Inspect

- `packages/toolkit/workbench/surface-inspector-annotations.js` - owns
  `buildSurfaceInspectorSnapshotPayload(...)`, pins, comments, projection
  blockers, scope stack, and adapter capability summary.
- `packages/toolkit/components/surface-inspector/index.js` - owns
  `window.__canvasInspectorState`, `requestSeeBundle(...)`, Annotation Mode
  state, active root/scope state, and bundle status rendering.
- `src/daemon/surface-inspector-bundle.swift` - owns
  `canvas_inspector.capture_bundle`, bundle file creation, manifest files, and
  clipboard path behavior.
- `src/shared/config.swift` and `src/commands/config-command.swift` - current
  `see.canvas_inspector_bundle.*` config shape if you add an include toggle.
- `tests/toolkit/surface-inspector-annotations.test.mjs` - focused annotation
  state and snapshot tests.
- `tests/toolkit/surface-inspector.test.mjs` - focused Surface Inspector model
  tests.
- `tests/surface-inspector-see-bundle.sh` and
  `tests/surface-inspector-see-bundle-config.sh` - daemon/bundle integration
  checks and existing compatibility expectations.

## Required Behavior

### 1. First-Class Bundle Artifact

When a Surface Inspector see bundle succeeds, the bundle should include:

- `annotation-snapshot.json` containing the point-in-time annotation snapshot;
- a `bundle.json.files.annotation_snapshot_json` manifest entry;
- existing `inspector-state.json`, `capture.json`, `capture.png`,
  `display-geometry.json`, and `canvas-list.json` behavior unchanged unless
  current config excludes those artifacts.

The artifact must be written for both annotation and non-annotation captures.
When Annotation Mode is inactive or no pins/comments exist, the artifact should
still be valid and should make the empty state explicit.

If you add an include toggle, prefer the existing namespace:

```text
see.canvas_inspector_bundle.include.annotation_snapshot
```

Default it to enabled so current `ctrl+opt+c` exports gain the artifact without
breaking the existing bundle path workflow.

### 2. Public Snapshot Shape

Create a versioned public payload distinct from the raw debug state. It may
embed the existing normalized annotation state, but the top-level artifact
should be stable enough for tools to consume without reading
`window.__canvasInspectorState` internals.

The payload should include:

- a versioned schema identity, for example
  `schema: "surface_inspector_annotation_snapshot"` and `version: "0.1.0"`;
- capture metadata: captured timestamp, trigger, source Surface Inspector canvas
  id, Surface Inspector frame, and bundle-relative asset references where
  applicable;
- active root/display context when known, including current scope/root id,
  root kind, root label, adapter id, and display/canvas coordinates available
  at capture time;
- selected/active edge or frame path fields already tracked by Annotation Mode;
- all in-memory frame pins and comments, including actor/timestamps/status,
  comment text, annotation kind, and subject identity/path/role/label/value or
  text excerpts when available;
- projection and visibility proof already available on pins and candidates:
  local/display bounds, current render status, blocker reasons, reveal status,
  and can-project/can-reveal flags;
- adapter capability summaries and explicit blockers;
- external asset references only. Do not embed image binary or base64 data in
  JSON.

Prefer adding a small builder/helper near the existing annotation snapshot
normalization rather than making the daemon reconstruct toolkit semantics from
raw JS debug state.

### 3. Schema, Fixtures, And Docs

Add a public schema and docs at the interface boundary:

- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
- valid and invalid fixtures using the repo's existing schema fixture
  convention;
- a schema test under `tests/schemas/`.

Update the user-facing docs that describe Surface Inspector see bundles:

- `docs/api/toolkit/components.md`
- `docs/api/aos.md`
- `docs/api/README.md` if the config/index list needs the new artifact or
  include key.

### 4. Compatibility

Preserve these existing contracts:

- `ctrl+opt+c` remains the global see-bundle hotkey when Surface Inspector is
  open;
- `requestSeeBundle(...)` still works;
- existing default clipboard contents remain the bundle directory path;
- existing non-annotation bundle tests remain compatible;
- `inspector-state.json` remains available when
  `see.canvas_inspector_bundle.include.inspector_state=true`;
- browser DOM/CDP remains deferred and must not be added in this slice.

## Scope

Ownership boundaries:

- toolkit workbench/component owns the annotation snapshot semantics;
- daemon owns bundle artifact creation and clipboard-path compatibility;
- shared schemas/docs own the public contract;
- no app-specific or Sigil-specific behavior belongs in this slice.

Swift changes are acceptable only for bundle artifact/config support. Keep the
daemon generic: it should request/copy the snapshot artifact, not encode
Surface Inspector annotation semantics beyond file orchestration.

## Hard Boundaries / Non-Goals

- No long-lived annotation database.
- No sync service.
- No report/export renderer.
- No embedded image binary or base64 in JSON.
- No browser DOM/CDP.
- No broad AX harvesting.
- No disk-write-disabled clipboard-payload mode in this slice unless it is
  already essentially free and does not destabilize the artifact contract.
- No menu/status settings UI in this slice except small status copy needed to
  reflect the new artifact.

## Verification

Run focused deterministic checks first:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
git diff --check
```

If Swift/config/bundle code changes, also run:

```bash
./aos dev recommend --json
./aos dev build
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
```

If `./aos ready` passes, run a bounded live smoke:

1. Launch Surface Inspector.
2. Enable Annotation Mode.
3. Create or reuse one visible frame pin/comment if available.
4. Trigger `requestSeeBundle("annotation-snapshot-smoke")` or press
   `ctrl+opt+c`.
5. Verify the bundle contains `annotation-snapshot.json`.
6. Verify `bundle.json.files.annotation_snapshot_json` points to it.
7. Verify the artifact has the public schema id/version, active scope/root
   context, pins/comments arrays, projection/capability fields, and no embedded
   image data.
8. Clean up smoke canvases and temp bundle artifacts.

If live readiness is blocked, report the exact blocker and the deterministic
coverage you did complete.

## Completion Report

Report back with:

- changed files;
- final snapshot artifact shape and schema id/version;
- whether you added an include toggle and its default;
- compatibility status for existing bundle path/clipboard behavior;
- exact tests run and pass/fail results;
- live smoke result or readiness blocker;
- recommended next slice for #298, especially disk-write-disabled clipboard
  payload mode and settings/menu exposure.

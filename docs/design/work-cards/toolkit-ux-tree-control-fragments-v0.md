# Toolkit UX Tree Control Fragments V0

## Transfer

- Recipient: Implementer
- Transfer kind: Implementer round
- Source branch: `origin/implementer/sigil-ux-tree-pre-toolkit-adoption-closure-v0`
- Output branch: `implementer/toolkit-ux-tree-control-fragments-v0`
- Base stack: PR #388, `implementer/sigil-ux-tree-pre-toolkit-adoption-closure-v0`
- Goal owner: toolkit controls

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Start the toolkit adoption path by making basic toolkit controls able to expose
read-only UX tree fragments for their existing user interaction bindings.

This is the first toolkit-owned producer after the Sigil reference
implementation. It should prove that a normal toolkit control can describe:

- its node identity;
- the gestures it already handles;
- the command name those gestures imply;
- ownership/target relations where useful;
- inspect-only metadata suitable for a future workbench editor.

Do not build a user-editable binding editor yet. Do not add toolkit command
execution or persistence yet.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/sigil-ux-tree-pre-toolkit-adoption-closure-v0.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos-ux-tree-v0.md`
- `shared/schemas/aos-ux-tree-v0.schema.json`

## Rediscover State

```bash
git status --short --branch
git fetch origin
git switch -c implementer/toolkit-ux-tree-control-fragments-v0 origin/implementer/sigil-ux-tree-pre-toolkit-adoption-closure-v0
./aos dev recommend --json --files packages/toolkit/controls docs/api/toolkit/components.md docs/api/toolkit/workbench.md shared/schemas/aos-ux-tree-v0.schema.json
```

This slice should be deterministic. `./aos ready` is optional unless your
implementation touches live canvas/runtime behavior, which it should not.

## Existing Code To Inspect

- `packages/toolkit/runtime/ux-tree.js` - canonical UX tree normalization,
  merging, validation, relation helpers, and strict safety checks.
- `packages/toolkit/workbench/ux-tree-subject.js` - existing read-only
  workbench subject projection for full UX trees.
- `packages/toolkit/controls/button.js` - current button DOM/events.
- `packages/toolkit/controls/toggle.js` - current toggle DOM/events.
- `packages/toolkit/controls/button-group.js` - current segmented button group
  DOM/events and keyboard navigation.
- `packages/toolkit/controls/index.js` - public controls export surface.
- `tests/toolkit/controls-button.test.mjs`
- `tests/toolkit/controls-toggle.test.mjs`
- `tests/toolkit/controls-button-group.test.mjs`
- `tests/toolkit/runtime-ux-tree.test.mjs`
- `tests/toolkit/ux-tree-subject.test.mjs`

## Required Behavior

Add a small toolkit-controls UX tree fragment layer.

The preferred shape is a new module such as
`packages/toolkit/controls/ux-tree.js` that exports focused helpers for basic
controls. Implementer may adjust names after inspecting the code, but keep the public
surface small and explicit.

At minimum cover these control families:

- button activation;
- toggle change/toggle;
- segmented button group option selection.

The helpers should produce JSON-only UX tree fragments or full read-only trees
that can be validated by the existing `createUxTree` / `resolveUxTree`
runtime helpers. The output must not contain functions, DOM nodes, event
objects, binary payloads, `data:` refs, or `blob:` refs.

The fragments should include, as appropriate:

- stable node ids derived from explicit control ids or caller-supplied UX ids;
- commands with allowlisted `handler_ref` strings;
- bindings for current gestures, for example pointer click, Space/Enter button
  activation, Space toggle activation, and segmented group arrow/select
  behavior;
- `owns` or `targets` relations for grouped controls/options when useful;
- metadata that clearly marks the fragment as `read_only_shadow` or equivalent,
  not live command execution;
- current value/disabled state only as data, not behavior.

Existing controls may expose their fragment additively, for example through a
returned `uxTreeFragment` / `getUxTreeFragment()` member or through helper
functions that accept the same config shape. Choose the least invasive pattern
that still lets a caller discover the mapping in a regular way.

## Hard Boundaries

- Do not add a toolkit command registry or execute commands from the UX tree in
  this slice.
- Do not add user persistence, CRUD, override patches, or a binding editor.
- Do not copy `apps/sigil/renderer/live-modules/ux-tree-readiness.js` into the
  toolkit. A toolkit-wide readiness/audit helper belongs after multiple
  toolkit surfaces emit fragments.
- Do not change existing control behavior, DOM event timing, keyboard handling,
  or CSS.
- Do not change the `aos_ux_tree` schema unless inspection proves a strict
  schema bug blocks this slice.
- Do not touch Sigil runtime code except for docs references if absolutely
  necessary.

## Suggested Implementation Areas

- Add `packages/toolkit/controls/ux-tree.js`.
- Export the new helpers from `packages/toolkit/controls/index.js`.
- Add focused tests in `tests/toolkit/controls-ux-tree.test.mjs`.
- Add or update narrowly scoped assertions in the existing button, toggle, and
  button-group tests only if the control factories expose fragments directly.
- Update `docs/api/toolkit/components.md` to document the read-only control UX
  fragment adoption state.
- Update `docs/api/toolkit/workbench.md` only if the workbench subject docs need
  to explain how assembled toolkit-control UX trees are inspected.

## Verification

Run the recommendation first, then deterministic checks:

```bash
./aos dev recommend --json --files packages/toolkit/controls docs/api/toolkit/components.md docs/api/toolkit/workbench.md shared/schemas/aos-ux-tree-v0.schema.json
node --check packages/toolkit/controls/ux-tree.js
node --test tests/toolkit/controls-ux-tree.test.mjs tests/toolkit/controls-button.test.mjs tests/toolkit/controls-toggle.test.mjs tests/toolkit/controls-button-group.test.mjs tests/toolkit/runtime-ux-tree.test.mjs tests/toolkit/ux-tree-subject.test.mjs
git diff --check
```

If the implementation changes package exports or shared runtime helpers, also
run the relevant broader toolkit tests recommended by `./aos dev recommend`.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact control families covered;
- whether fragments are helper-only or exposed on factory return values;
- whether any schema/runtime changes were needed;
- tests run with exact pass/fail result;
- local-only state, if any;
- remaining follow-up recommendation for the next toolkit adoption slice.

Commit and push the branch. Do not open a PR.

# Compact Control Record ID/Ref Consistency Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref:
  `gdi/post-refactor-real-input-dogfooding-corrections-v0` at `4b19984f`
- expected output branch:
  `gdi/post-refactor-real-input-dogfooding-corrections-v0`

Do not reset to `origin/main`. Do not discard unrelated local untracked work
cards or reports.

## Source Artifact

- GDI completion report for
  `docs/design/work-cards/gdi-compact-control-record-contract-review-correction-v0.md`
  at `4b19984f`.
- Foreman acceptance review after local verification.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make compact form control records internally consistent: the emitted semantic
`id` and `aosRef`/`ref` must describe the same canonical target identity.

## Review Finding

`packages/toolkit/panel/form.js` normalizes a target with `id: descriptorId`,
which produces `aosRef` such as:

```text
sigil.avatar.compact_control_surface:sigil-menu-opacity
```

Then `controlRecordFor()` overwrites the returned `id` with `field.id`. For
Sigil compact controls, that can produce a record shaped like:

```json
{
  "id": "sigil.avatar.primary-polyhedron.avatar.appearance.opacity",
  "descriptor_id": "sigil-menu-opacity",
  "ref": "sigil.avatar.compact_control_surface:sigil-menu-opacity",
  "aosRef": "sigil.avatar.compact_control_surface:sigil-menu-opacity"
}
```

That leaves `surface:id` unable to reconstruct the emitted `aosRef`, which
undercuts the canonical identity contract this branch is trying to establish.

## Required Correction

- Decide the canonical control-record target id and make `id`, `aosRef`, and
  `ref` internally consistent.
- Preferred shape: use the descriptor id as the semantic record `id` for
  descriptor-addressed agent operation, keep `descriptor_id`, and preserve the
  original form field id under an explicit local field such as `field_id` or in
  metadata if it is still useful.
- If inspection proves the visual-object/form field id should be the semantic
  `id`, generate `aosRef`/`ref` from that returned `id` and keep
  `descriptor_id` only as the route key. Do not leave the current split.
- Update focused tests to assert the consistency invariant. At minimum, the
  panel form and Sigil compact surface tests should fail if `record.ref` is not
  exactly `${record.surface}:${record.id}` for these canonical records.
- Keep the record-primary fallback enforcement from `4b19984f` unchanged.

## Scope

`packages/toolkit/panel/form.js`,
`apps/sigil/avatar-editor/compact-surface.js` only if needed, and focused tests
under:

- `tests/toolkit/panel-form.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/context-menu-hit-test.test.mjs` if its assertions need to
  follow the identity decision

## Hard Boundaries / Non-Goals

- Do not reopen role/frame normalization or fallback enforcement unless this
  identity fix exposes a direct test failure there.
- Do not decompose `apps/sigil/context-menu/menu.js` in this correction.
- Do not add compatibility aliases or a second ref namespace.
- Do not edit `.codex/config.toml`.
- Do not run live pointer scenarios for this identity correction.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/panel-form.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
bash -n tests/sigil-hit-target-drag-fast-travel.sh
python3 -m py_compile tests/lib/real_input_surface_primitives.py
bash tests/sigil-hit-target-drag-fast-travel.sh
```

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- chosen canonical id/ref shape and why;
- exact tests run with pass/fail results;
- whether `record.ref` exactly equals `${record.surface}:${record.id}` is now
  asserted for compact form records;
- any unrelated local-only state that remains.

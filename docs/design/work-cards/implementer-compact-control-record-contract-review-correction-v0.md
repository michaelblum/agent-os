# Compact Control Record Contract Review Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from: `implementer/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: local branch
  `implementer/post-refactor-real-input-dogfooding-corrections-v0` at `05a904e5`
- expected output branch:
  `implementer/post-refactor-real-input-dogfooding-corrections-v0`

Do not reset to `origin/main` or to
`origin/implementer/post-refactor-real-input-dogfooding-corrections-v0`; the remote
branch is behind this local head. Do not discard unrelated local untracked
work cards or reports.

## Source Artifact

- Foreman review input: "Thermo-Nuclear Review -
  implementer/post-refactor-real-input-dogfooding-corrections-v0" against base
  `77cdbdb1`, 10 commits, reviewed at local head `05a904e5`.
- Prior adjacent cards:
  - `docs/design/work-cards/implementer-aos-native-compact-tab-records-v0.md`
  - `docs/design/work-cards/implementer-aos-native-compact-record-primary-smoke-v0.md`
- Current reviewed files of interest:
  - `tests/lib/real_input_surface_primitives.py`
  - `tests/sigil-hit-target-drag-fast-travel.sh`
  - `packages/toolkit/runtime/semantic-targets.js`
  - `packages/toolkit/panel/form.js`
  - `apps/sigil/avatar-editor/compact-surface.js`
  - `tests/toolkit/panel-form.test.mjs`
  - `tests/renderer/context-menu-hit-test.test.mjs`
  - `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make compact context-menu operation genuinely semantic-record primary for tabs,
segmented controls, and sliders, and make the compact control-record contract
compose from the canonical toolkit semantic-target normalizer instead of a
parallel hand-rolled role/ref/frame implementation.

This is one correction round with two ordered milestones. Complete milestone 1
before milestone 2 only if it stays simpler; if inspection shows one shared
normalization helper naturally fixes both, use that shape.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/work-cards/implementer-aos-native-compact-tab-records-v0.md`
- `docs/design/work-cards/implementer-aos-native-compact-record-primary-smoke-v0.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/lib/real_input_surface_primitives.py`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `tests/toolkit/panel-form.test.mjs`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -12
rg -n "segmentedReady|sliderReady|tabReady|broken-contract-dom-selector|assert_control_record_payload|normalizeSemanticTarget|AX_ROLE_ALIASES|aosRefForTarget|rectForElement|roleForField|getControlRecords" tests packages apps/sigil/avatar-editor apps/sigil/context-menu
```

This is deterministic toolkit/Sigil test-harness work. Do not run live OS
pointer scenarios unless `./aos ready` is clean and a test explicitly requires
`AOS_REAL_INPUT_OK=1`. If a live check hits repo-mode TCC/Input Monitoring or
input-tap blockers, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`; after the human returns with `finished`, run
`./aos ready --post-permission`.

## Milestone 1 - Enforce Record-Primary Hit Points

The current tab path is correctly guarded: `tabReady` marks
`fallback = "broken-contract-dom-selector"` when it derives the click point from
DOM fallback, and `assert_tab_record_payload(..., forbid_fallback=True)` fails
the smoke if that happens.

Segmented controls and sliders are not guarded the same way. They can return a
populated `controlRecord` while deriving the actual point from
`segmentedButton(...)` or `sliderControl(...)`, and
`assert_control_record_payload` currently accepts that.

Required correction:

- In `tests/lib/real_input_surface_primitives.py`, make segmented and slider
  readiness/click/drag helpers mark `fallback: "broken-contract-dom-selector"`
  whenever the interaction point comes from DOM fallback instead of the
  record's normalized frame/bounds.
- Prefer one shared helper for "record frame/bounds point, otherwise DOM
  fallback point with explicit fallback marker" instead of maintaining three
  subtly different blocks for tabs, segmented controls, and sliders.
- Update `tests/sigil-hit-target-drag-fast-travel.sh` so
  `assert_control_record_payload` forbids fallback, matching the tab assertion.
- Keep the DOM fallback only as a loud broken-contract diagnostic. It must not
  be accepted as the normal path for compact segmented controls or sliders.
- If the record field name changes from `bounds` to canonical `frame` in
  milestone 2, update this milestone's helper to use the canonical field.

## Milestone 2 - Use Canonical Semantic Target Normalization

The compact control records currently duplicate semantic-target ownership:

- `packages/toolkit/panel/form.js` has local `text()`, `roleForField()`, and
  `rectForElement()` helpers.
- `apps/sigil/avatar-editor/compact-surface.js` has its own `text()` and
  `rectForElement()`.
- Records use `aos.control:<descriptorId>` and `aos.tab:<tabKey>` rather than
  the canonical `aosRefForTarget` surface/id scheme.
- Field roles such as `AXRadioGroup`, `AXCheckBoxGroup`, and `AXPopUpButton`
  bypass the canonical `AX_ROLE_ALIASES` vocabulary in
  `packages/toolkit/runtime/semantic-targets.js`.

Required correction:

- Make `packages/toolkit/runtime/semantic-targets.js` the owner for record
  role/name/aosRef/frame normalization.
- Add the missing form/control roles to the canonical role alias table using
  web/ARIA roles that match the rest of the normalizer. Update
  `tests/toolkit/runtime-semantic-targets.test.mjs` for those aliases.
- Build `packages/toolkit/panel/form.js` control records through
  `normalizeSemanticTarget`/`aosRefForTarget` or the smallest canonical helper
  needed after inspection. Preserve form-specific fields such as
  `descriptor_id`, `kind`, `value`, `options`, `actions`, `hidden`, and
  `metadata`, but do not reimplement generic name/role/ref/frame logic locally.
- Build compact tab records in
  `apps/sigil/avatar-editor/compact-surface.js` through the same canonical
  normalizer. Do not keep `aos.tab:` as a private parallel namespace unless
  inspection proves an external contract requires it; if so, document the
  removal gate in the completion report.
- Prefer the canonical frame field from `normalizeSemanticTarget`. If existing
  helper or test seams require `bounds` for this branch, derive it from the
  canonical frame in one place and state why it remains.
- Delete local duplicate helpers when they are no longer needed. Do not expose
  new public runtime helpers just to save a few local lines unless that is the
  cleanest owner boundary after reading the code.
- Update shape-locking tests so they assert the canonical role/ref/frame
  contract rather than the old bespoke `AX*`/`aos.control:`/`aos.tab:` shape.

## Scope

Toolkit runtime semantic-target normalizer, toolkit panel form records, Sigil
compact surface records, deterministic real-input helper assertions, and their
focused tests.

## Hard Boundaries / Non-Goals

- Do not decompose `apps/sigil/context-menu/menu.js` in this correction. That
  is queued separately in
  `docs/design/work-cards/implementer-sigil-context-menu-record-snapshot-extraction-v0.md`.
- Do not reopen the broader AOS input architecture or command-surface SOP work.
- Do not add compatibility aliases, shims, or parallel ref namespaces unless a
  current external consumer is proven and the removal gate is explicit.
- Do not add Sigil-private agent APIs when a toolkit semantic target/control
  record is the correct layer.
- Do not use raw daemon HTTP, tmux, launchd, or state-file probes for runtime
  control unless `./aos` is missing or broken and you state the reason.
- Do not edit `.codex/config.toml`.

## Verification

Run at minimum:

```bash
git diff --check
bash -n tests/sigil-hit-target-drag-fast-travel.sh
python3 -m py_compile tests/lib/real_input_surface_primitives.py
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/panel-form.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
bash tests/sigil-hit-target-drag-fast-travel.sh
```

If any broader form/control primitive changes are needed, also run the focused
adjacent toolkit tests Implementer identifies with `rg --files tests/toolkit`.

Do not substitute live pointer proof for the deterministic contract above. Live
real-input scenarios are optional only after `./aos ready` is clean and the
human has explicitly permitted real input.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- how segmented and slider helpers now fail loudly on DOM fallback;
- the final compact record role/ref/frame field shape;
- what canonical semantic-target API now owns each generic field;
- whether any private `aos.control:` or `aos.tab:` refs remain and why;
- exact verification commands with pass/fail results;
- AOS readiness/live-input status if any live check was attempted;
- unrelated local-only state that remains;
- whether the queued `menu.js` extraction card is still the right next
  follow-up after this correction.

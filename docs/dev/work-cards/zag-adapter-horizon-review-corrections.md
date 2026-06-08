# Work Card: zag-adapter-horizon-review-corrections

## Goal

Fix the aggregate review findings on `implementer/zag-adapter-horizon` without
rewriting the existing per-adapter checkpoint commits.

This is a forward correction card. Add one or more new correction commits after
`3c00784a3d4bc13492d53a105bf41097a4c42c86`; do not rebase, squash, or edit the
adapter checkpoint history.

## Review Status

Foreman reviewed the completed Zag adapter horizon at:

```text
head_sha: 3c00784a3d4bc13492d53a105bf41097a4c42c86
base_sha: b1514c13d6ca954a95d40c3b53b1c6e0bb05653e
branch: implementer/zag-adapter-horizon
```

Deterministic verification:

```bash
node --test tests/toolkit/zag-adapter-*.test.mjs  # passed, 67/67
node --test tests/toolkit/*.test.mjs              # passed, 899/899
export checks for createAosZag<Adapter>           # all function
```

The branch is not accepted yet because `git diff --check` fails and several
default bind selectors do not match the AOS data-part contract robustly.

## Findings To Fix

### 1. `git diff --check` fails

Remove trailing whitespace reported by:

```bash
git diff --check b1514c13d6ca954a95d40c3b53b1c6e0bb05653e..HEAD
```

Current failures:

```text
packages/toolkit/adapters/zag/collapsible.js:34: trailing whitespace.
packages/toolkit/adapters/zag/popover.js:50: trailing whitespace.
packages/toolkit/adapters/zag/splitter.js:37: trailing whitespace.
packages/toolkit/adapters/zag/tooltip.js:39: trailing whitespace.
```

### 2. Repeated-part selectors over-match or miss AOS data attrs

`createZagAdapter.bind()` treats every function binding as a repeated binding
and uses `selectors[part]` through `bindMany()`
(`packages/toolkit/adapters/zag/shared.js`). That means broad selectors such as
`[data-value]`, `[data-index]`, and `[data-id]` are not safe defaults for
adapter parts.

Concrete review probes:

```text
tabs: bindTriggers(root) returned 2 when the root contained one trigger and one
content panel sharing data-value="a".

accordion: bindItems(root) returned 3 when item, item-trigger, and item-content
all shared data-value="a".

slider: bindThumbs(root) returned 0 for markup with data-aos-slider-thumb.

splitter: bindPanels(root) returned 0 for markup with data-aos-splitter-panel.
```

Fix the new horizon adapters so default repeated-part selectors use the AOS
data-part attributes as the primary selector. Preserve existing value/id/index
derivation inside the binding functions.

At minimum, inspect and correct these selectors:

- `packages/toolkit/adapters/zag/accordion.js`: `item`
- `packages/toolkit/adapters/zag/tabs.js`: `trigger`
- `packages/toolkit/adapters/zag/radio-group.js`: `item`
- `packages/toolkit/adapters/zag/slider.js`: `thumb`
- `packages/toolkit/adapters/zag/splitter.js`: `panel`
- `packages/toolkit/adapters/zag/toggle-group.js`: `item`
- `packages/toolkit/adapters/zag/tags-input.js`: `item`

Do not change the pre-existing select/combobox `[data-value]` behavior in this
card unless a focused regression proves it is also wrong for those adapters.

### 3. Strengthen bind tests beyond `typeof`

Several new tests currently call `adapter.bind(container)` and assert only that
the adapter methods exist. Strengthen the tests so they would have caught the
selector issues above.

Add focused assertions that:

- repeated-part helpers return the expected count for each part;
- AOS data-part selectors are honored;
- unrelated sibling parts with the same `data-value` are not bound as the wrong
  part;
- at least one concrete Zag-provided role/ARIA/id attribute appears on the
  intended element after binding.

Minimum scenarios:

- tabs: one trigger and one content panel share `data-value="a"`;
  `bindTriggers(root)` must return `1`, and `bindContents(root)` must return
  `1`.
- accordion: item, trigger, and content share `data-value="a"`;
  each bind helper must return `1`.
- slider: a thumb marked with `data-aos-slider-thumb` must be bound and receive
  slider thumb props.
- splitter: a panel marked with `data-aos-splitter-panel` must be bound.
- radio-group, toggle-group, and tags-input should get analogous repeated-part
  count assertions.

## Boundaries

- Do not adopt these adapters in surfaces.
- Do not change bridge messages, manifests, or existing surface code.
- Do not rewrite the prior checkpoint commits.
- Keep correction commits narrow and reviewable.

## Verification

Run:

```bash
node --test tests/toolkit/zag-adapter-*.test.mjs
node --test tests/toolkit/*.test.mjs
git diff --check b1514c13d6ca954a95d40c3b53b1c6e0bb05653e..HEAD
git status --short --branch
```

If the full toolkit suite creates `.playwright-cli/` trace files, remove that
generated untracked directory before reporting completion.

## Completion Report Format

```text
## Completion Report
- profile: agentic_relay
- horizon: zag-adapter-horizon
- correction_card: docs/dev/work-cards/zag-adapter-horizon-review-corrections.md
- branch: implementer/zag-adapter-horizon
- prior_reviewed_head: 3c00784a3d4bc13492d53a105bf41097a4c42c86
- new_head_sha: <git rev-parse HEAD>
- correction_commits: <list sha + subject>
- files_changed: <n>
- tests_passed: <n>/<n>
- diff_check: <passed|failed>
- conflict_risk: <none|low|medium — list files if low or medium>
- local_only_state: <none|dirty files/untracked/generated artifacts/runtime blockers, and whether related>
- relay_action_required: hold_for_foreman_review
```

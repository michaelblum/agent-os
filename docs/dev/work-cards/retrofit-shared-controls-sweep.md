# Work Card: retrofit-shared-controls-sweep

## Goal

Retrofit the remaining eight lower-priority toolkit components to consume the
shared control layer instead of hand-rolling inline controls.

## Background

The toolkit surface audit (`docs/dev/reports/toolkit-surface-audit.md`)
identified 11 hand-rolling components. The top-3 were completed in
`retrofit-shared-controls` (PR #323). This card covers the remaining eight.

The shared control layer (`packages/toolkit/controls/index.js`) now exports:

- `createButton`, `createButtonGroup`
- `createToggle`
- `createTextField`, `createTextarea`
- `createCheckboxGroup`
- `createSelect`
- `createTimerBar`
- Number-field helpers: `handleNumberFieldKeydown`, `handleNumberFieldWheel`,
  `numberFieldBaseStep`, `numberFieldStepForEvent`, `stepNumberField`,
  `wheelDirection`, `wireNumberFieldControls`
- HTML render helpers: `renderButtonHtml`, `renderTextFieldHtml`,
  `renderTextareaHtml`

## Candidates (Ordered by Value)

Work through these in order. Each is retrofit-only — no behavioral changes.

### 1. `work-record-workbench`

- Replace Apply JSON / Revert / Save buttons → `createButton` / `createButtonGroup`
- Replace multi-line JSON and intent textareas → `createTextarea` (now exported)

### 2. `object-transform-panel`

- Already uses `wireNumberFieldControls`; extend coverage:
  - Mode buttons → `createButtonGroup`
  - Object selection / action buttons → `createButton`
  - Visibility / effect checkboxes → `createCheckboxGroup`
  - Single-line descriptor fields → `createTextField`

### 3. `markdown-workbench`

- Preview / source segmented buttons → `createButtonGroup`
- Outline / annotation / save / revert / close buttons → `createButton`
- Source editor textarea → `createTextarea`

### 4. `test-console`

- Supervisor action buttons (confirm / fail / blocked / note / retry) →
  `createButtonGroup` / `createButton`
- Supervisor note textarea → `createTextarea`

### 5. `integration-hub`

- Command input → `createTextField`
- Send / Refresh / surface action buttons → `createButton`
- Mutually exclusive provider / workflow controls → `createButtonGroup`

### 6. `playbook-workbench`

- Gate ref / token inputs → `createTextField`
- Apply Gate / Simulate / Open Work Record buttons → `createButton` /
  `createButtonGroup`

### 7. `artifact-bundle-workbench`

- Open Work Record button → `createButton`

### 8. `surface-zoom-inspector`

- Toolbar buttons → `createButton` / `createButtonGroup`
- Overlay checkbox → `createToggle` / `createCheckboxGroup`
- Label-density / map-display selects → `createSelect`

> **Note:** `surface-zoom-inspector` is also a candidate for eventual
> fold-in to `surface-inspector`. That structural work is tracked separately
> and is explicitly out of scope here. Retrofit only.

## Deliverables

1. Each component above refactored to consume shared controls in place of
   inline implementations
2. No behavioral changes — retrofit only
3. Toolkit tests green (822+/822)
4. `bash tests/help-contract.sh` passes

## Branch

`gdi/retrofit-shared-controls-sweep`

## Relay Review Correction — 2026-05-15

PR #324 is still open and branch `gdi/retrofit-shared-controls-sweep` is behind
current `main`. The branch cannot be merged cleanly after the select adapter
merge. Rebase or merge current `origin/main` into the branch and resolve the
known conflicts in:

- `packages/toolkit/controls/button.js`
- `packages/toolkit/controls/index.js`
- `tests/toolkit/controls-text-field.test.mjs`

The current `main` baseline fails `tests/toolkit/surface-inspector-ax.test.mjs`
because string `rawAttributes` are rendered one character at a time in Surface
Inspector button markup. This is in scope for the shared-control sweep, not the
Zag select adapter card. Preserve the intended shared-control behavior while
making the full toolkit suite green again.

After resolving conflicts, rerun at minimum:

```bash
node --test --test-reporter=dot tests/toolkit/surface-inspector-ax.test.mjs
node --test tests/toolkit/controls-button.test.mjs tests/toolkit/controls-checkbox-group.test.mjs tests/toolkit/controls-text-field.test.mjs
node --test tests/toolkit/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

Completion report must include:

```text
## Completion Report
- profile: agentic_relay
- branch: gdi/retrofit-shared-controls-sweep
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/main SHA used for final rebase/merge>
- files_changed: <n>
- tests_passed: <n>/<n>
- conflict_risk: <none|low|medium — list files if low or medium>
- open_prs_on_same_files: <none|list>
- relay_action_required: merge
```

## Active Workflow Profile

`agentic_relay` — GDI branches `gdi/<slug>`, commits, pushes, reports branch +
HEAD SHA + `git show --stat HEAD`. Relay partner merges via PR.

## References

- Surface audit report: `docs/dev/reports/toolkit-surface-audit.md`
- Shared control layer: `packages/toolkit/controls/`
- Reference implementations:
  - `packages/toolkit/controls/textarea.js` (PR #322)
  - `packages/toolkit/controls/button.js` (PR #323)
  - `packages/toolkit/controls/text-field.js` (PR #323)
- Prior sweep: `docs/dev/work-cards/retrofit-shared-controls.md` (PR #323)

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

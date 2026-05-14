# Work Card: Toolkit Surface Audit

**Branch:** `gdi/research-toolkit-surfaces`  
**Type:** Research — no code changes  
**Stage only:** `docs/dev/reports/toolkit-surface-audit.md`

---

## Objective

Inventory every component in `packages/toolkit/components/` and classify how it handles interactive controls — specifically whether it already delegates to the shared control layer introduced in Session 2, hand-rolls its own inline controls, or is display-only.

---

## Instructions for GDI

### Preconditions

```sh
git fetch origin
git reset --hard origin/main
git checkout -b gdi/research-toolkit-surfaces
```

### Step 1 — Inventory controls/index.js

Open `packages/toolkit/controls/index.js` and list every export. Note the full set of shared controls now available (button, button-group, toggle, text-field, checkbox-group, timer-bar, etc.).

### Step 2 — Classify every component

For every subdirectory under `packages/toolkit/components/`, open its `index.js` and classify it as **one or more** of:

| Class | Criterion |
|---|---|
| **Uses shared controls** | Imports from `../../controls/` or `../../panel/form.js` |
| **Has inline controls** | Hand-rolls its own `<input>`, `<button>`, `<select>`, or equivalent without going through the shared layer |
| **Display-only** | Renders data/state only — no interactive controls of any kind |

### Step 3 — Scan for UI-rendering code outside packages/toolkit/

Check for any UI-rendering code that lives outside `packages/toolkit/` (e.g. in `packages/cli/`, `packages/gateway/`, `packages/daemon/`). Note file paths only — do not audit deeply.

### Step 4 — Write the report

Write the audit results to `docs/dev/reports/toolkit-surface-audit.md` as a Markdown table with columns:

```
| Component | Uses shared controls? | Has inline controls? | Display-only? | Purpose |
```

Add a **Retrofit Candidates** section after the table listing components that could benefit from being rewired to the shared control layer introduced in PR #314. For each candidate, note which inline control(s) could be replaced and with which shared control export.

### Step 5 — Stage, commit, push

```sh
git add docs/dev/reports/toolkit-surface-audit.md
git show --stat HEAD
git commit -m "research(toolkit): surface audit report"
git push origin gdi/research-toolkit-surfaces
```

Report back with: branch name, HEAD SHA, and `git show --stat HEAD` output.

---

## Acceptance Criteria

- [ ] `docs/dev/reports/toolkit-surface-audit.md` exists on branch `gdi/research-toolkit-surfaces`
- [ ] Table covers all components in `packages/toolkit/components/`
- [ ] Retrofit Candidates section present
- [ ] No source code files modified
- [ ] Commit staged with explicit path only (no `git add .`)

# Work Card: canvas-inspector Naming Investigation

**Branch:** `gdi/research-canvas-inspector-naming`  
**Type:** Research — no code changes  
**Stage only:** `docs/dev/reports/canvas-inspector-naming.md`

---

## Background

The toolkit surface audit (`docs/dev/reports/toolkit-surface-audit.md`) identified two components that may be related:

- `packages/toolkit/components/canvas-inspector` — “Surface/canvas inspector, minimap, annotation, and tree controls”
- `packages/toolkit/components/surface-zoom-inspector` — “Zoomed surface/semantic target inspector”

There is a belief that `canvas-inspector` was renamed to `surface-inspector` at some point. No `surface-inspector` directory exists on `main`. This task determines whether that rename occurred, is pending, or is a false memory, and clarifies the relationship between the two existing components.

---

## Instructions for GDI

### Preconditions

```sh
git fetch origin
git reset --hard origin/main
git checkout -b gdi/research-canvas-inspector-naming
```

### Step 1 — Search commit history for surface-inspector references

```sh
git log --all --oneline --grep="surface-inspector"
git log --all --oneline --grep="surface_inspector"
```

### Step 2 — Grep codebase for surface-inspector string references

```sh
grep -r "surface-inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" -l
grep -r "surface_inspector" . --include="*.js" --include="*.ts" --include="*.json" --include="*.md" -l
```

### Step 3 — Examine both component index.js files

Open and read:
- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/surface-zoom-inspector/index.js`

Note: registered component name/title strings, any internal comments referencing a rename, and whether either file imports from or references the other.

### Step 4 — Check git rename history on both paths

```sh
git log --follow --oneline -- packages/toolkit/components/canvas-inspector/index.js
git log --follow --oneline -- packages/toolkit/components/surface-zoom-inspector/index.js
```

Note the full history of each file including any renames detected by `--follow`.

### Step 5 — Check registration in Sigil and gateway

Search for whether either component is registered or imported in:
- `apps/sigil/` (any `.js` or `.html` that imports or references the component by name)
- `packages/gateway/` (any tool or index that references it)

```sh
grep -r "canvas-inspector" apps/sigil packages/gateway --include="*.js" --include="*.ts" --include="*.html" -l
grep -r "surface-zoom-inspector" apps/sigil packages/gateway --include="*.js" --include="*.ts" --include="*.html" -l
```

### Step 6 — Write the report

Write findings to `docs/dev/reports/canvas-inspector-naming.md` covering:

1. **Rename evidence** — Is there any commit history or codebase evidence of a `canvas-inspector` → `surface-inspector` rename?
2. **Component purposes** — Based on actual source, are these two distinct active components or is one a superseded version of the other?
3. **Registration status** — Which (if either) is currently wired into Sigil or the gateway?
4. **Recommendation** — One of: (a) both are separate active components, (b) one is obsolete and should be removed, (c) a rename/consolidation work card should be filed.

### Step 7 — Stage, commit, push

```sh
git add docs/dev/reports/canvas-inspector-naming.md
git show --stat HEAD
git commit -m "research(toolkit): canvas-inspector naming investigation"
git push origin gdi/research-canvas-inspector-naming
```

Report back with: branch name, HEAD SHA, and `git show --stat HEAD` output.

---

## Acceptance Criteria

- [ ] `docs/dev/reports/canvas-inspector-naming.md` exists on `gdi/research-canvas-inspector-naming`
- [ ] Commit history examined via `--follow` for both component paths
- [ ] Codebase grep for `surface-inspector` completed
- [ ] Sigil and gateway registration status documented
- [ ] Recommendation section present
- [ ] No source code files modified
- [ ] Staged with explicit path only (no `git add .`)

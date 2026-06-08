# Repo Cleanup Investigation

> **Task for local agent.** Work through each item below, make the changes you're confident about,
> and document your findings for anything that needs a human call. Push a single clean commit
> (or a small ordered series) when done so the results can be reviewed remotely.

---

## Context

A structural review flagged the following as sprawl or residue. Items are grouped by confidence.
For each **Maybe** you must investigate before acting — the guidance below tells you what to look for.

---

## Definite Deletes — Do These First

These have no ambiguity. Remove them.

| Path | Reason |
|------|--------|
| `_dev/spikes/desktop-world-three-spike/` | Named spike, single entry in `_dev/spikes/`. Spikes are throwaway by definition. Confirm nothing in `src/`, `packages/`, or `scripts/` imports from it, then delete the whole `_dev/` tree. |
| `scripts/afk-dry-run-prototype.mjs` | `-prototype` suffix = explicit throwaway marker. |
| `scripts/afk-launch-attempt-prototype.mjs` | Same. |
| `scripts/afk-session-trigger-prototype.mjs` | Same. |

**Before deleting the `afk-*` prototypes:** grep the codebase for any `import` or `require` referencing them. If nothing references them, delete. If something does, note it in your findings and skip the delete.

```bash
grep -r 'afk-dry-run-prototype\|afk-launch-attempt-prototype\|afk-session-trigger-prototype' \
  --include='*.mjs' --include='*.js' --include='*.ts' --include='*.sh' \
  --exclude-dir='.git' .
```

---

## Maybes — Investigate, Then Decide

### 1. `scripts/annotation-perception-verify.mjs` (~13 KB)

**What to check:**
- Is it referenced in `package.json` `bin`, `scripts`, or any `Makefile` / `build.sh` / `package.sh`?
- Is it imported by any other script?
- Does its internal logic duplicate or overlap with `aos-inspect.mjs` or `aos-see-*.mjs`?
- Check git log for last meaningful commit: `git log --oneline -5 -- scripts/annotation-perception-verify.mjs`

**Decision criteria:**
- Referenced anywhere → keep, note where.
- Standalone, last touched >3 months ago, logic covered elsewhere → delete.
- Standalone but unique capability → move to `_dev/spikes/` or keep with a comment in `CONTEXT.md`.

---

### 2. `scripts/aos-html-workbench-expression.mjs` (~2.7 KB)

**What to check:**
- Same reference grep as above.
- The name suggests a workbench / REPL helper — is there a `workbench` command registered in the CLI router (`aos-subcommand-router.mjs`, `aos-family-router.mjs`)?
- Any mention in `CONTEXT.md`, `ARCHITECTURE.md`, or `docs/`?

**Decision criteria:**
- Registered in CLI → keep.
- Not registered, not imported → delete or archive.

---

### 3. `wiki-seed/` directory

Contains `README.md`, `concepts/`, `entities/`, `plugins/` subdirs.

**What to check:**
- Read `wiki-seed/README.md` — does it say the seed was a one-time bootstrap or is it intended to stay?
- Is there a GitHub Wiki enabled on this repo (`gh api repos/michaelblum/agent-os | jq .has_wiki`)?
- Does any script reference `wiki-seed/` (e.g. `aos-wiki-graph.py`, `aos-content.mjs`)?
- How populated are the subdirs — are they full documents or skeleton stubs?

**Decision criteria:**
- README says one-time bootstrap + subdirs are mostly empty stubs + nothing references it → delete.
- README says living source-of-truth, or scripts reference it → keep, and note in `CONTEXT-MAP.md` so it's findable.
- Contains real content but isn't actively used → move to `docs/wiki/` so it's part of the documented surface.

---

### 4. `GEMINI.md` (40 bytes)

**What to check:**
- Read its content. (`CLAUDE.md` is just `@AGENTS.md` — an include pointer. Is `GEMINI.md` the same?)
- Is Gemini CLI / Gemini runner actually used anywhere in this repo?
- Check `.codex/`, `.claude/`, `.agents/` for any Gemini-specific config.

**Decision criteria:**
- It's a valid include pointer AND Gemini is used as a runner → keep.
- It's a stub with no real runtime use → delete.

---

### 5. `build.sh` and `package.sh` at repo root

These sit outside `scripts/` while the rest of the tooling lives inside it.

**What to check:**
- Are they called by CI (check `.github/workflows/` if it exists, or any `Makefile`)?
- Do they duplicate entrypoints already in `scripts/` (e.g. `aos-dev-build.mjs`)?
- Are they referenced in `README.md` or `CONTEXT.md` as the canonical build command?

**Decision criteria:**
- CI calls them by name at root → leave in place, this is intentional.
- They're thin wrappers around `scripts/aos-*` equivalents AND CI doesn't hard-code them → merge the logic and delete, or symlink.
- They're the canonical entry point but conceptually belong with scripts → move to `scripts/`, add a root `Makefile` or update `README.md` with the new path.

---

## What to Produce

1. **Make the definite deletes** (after the import check).
2. **For each Maybe:** make the change you're confident about, or leave it untouched and add a findings block below.
3. **Push one commit** titled `chore: structural cleanup - remove residue and prototypes` (or split into logical commits if the scope warrants it).
4. **Append your findings** to this file under a `## Agent Findings` section before pushing, so the remote reviewer can see the reasoning. Format:

```markdown
## Agent Findings

### annotation-perception-verify.mjs
- **Action taken:** deleted / kept / moved
- **Reason:** ...

### aos-html-workbench-expression.mjs
- **Action taken:** ...
- **Reason:** ...

### wiki-seed/
- **Action taken:** ...
- **Reason:** ...

### GEMINI.md
- **Action taken:** ...
- **Reason:** ...

### build.sh / package.sh
- **Action taken:** ...
- **Reason:** ...
```

---

## Out of Scope

Do **not** touch:
- Anything under `.docks/foreman/scripts/` — those are dock-local and correct where they are.
- `CLAUDE.md` — it's a valid include pointer, not a stub.
- `scripts/aos-wiki-graph.py` — needs a separate Python dependency audit before any decision.
- Any file under `src/`, `packages/`, `apps/` — this pass is structural cleanup only.

## Agent Findings

### _dev/spikes/desktop-world-three-spike/
- **Action taken:** deleted
- **Reason:** No `src/`, `packages/`, or `scripts/` imports or runtime references were found. The only remaining references were the cleanup task and archived historical plan text.

### afk prototype scripts
- **Action taken:** kept
- **Reason:** The safety grep found live references. `scripts/afk-session-trigger-prototype.mjs` imports `scripts/afk-launch-attempt-prototype.mjs`; `tests/external-command-dispatch.sh` asserts `./aos dev afk-session-trigger` routes through `afk-session-trigger-prototype.mjs`; `scripts/aos-dev-workflow.mjs` still audits the `dev-afk-dry-run`, `dev-afk-launch-attempt`, and `dev-afk-session-trigger` forms; and focused prototype tests import or execute all three scripts. Removing them safely needs a separate command-surface retirement or rename pass.

### annotation-perception-verify.mjs
- **Action taken:** kept
- **Reason:** It is documented in `docs/api/toolkit/workbench.md` as the command that writes `docs/design/fixtures/annotation-perception-verification-v0/representative-surfaces.report.json`, and the work card `docs/design/work-cards/annotation-perception-verification-harness-v0.md` names it as the harness output. The script builds representative fixture cases through `packages/toolkit/workbench/annotation-perception-verification.js`; this is distinct from the interactive `aos-inspect.mjs` and `aos-see-*` surfaces.

### aos-html-workbench-expression.mjs
- **Action taken:** kept
- **Reason:** It is documented in `docs/api/toolkit/workbench.md`, covered by `docs/design/html-workbench-expression-adoption-audit-2026-05-13.md`, and generates the committed `docs/design/fixtures/aos-html-workbench-expression-v0/` fixture from `docs/design/work-cards/aos-html-workbench-expression-v0.md`. It is not registered as an `aos workbench` CLI command, but it is the source fixture generator for the toolkit workbench expression contract.

### wiki-seed/
- **Action taken:** kept
- **Reason:** `wiki-seed/README.md` identifies the tree as the repo-backed source of truth for the default `aos wiki seed` starter pack. `scripts/aos-wiki-seed.mjs` defaults `--from` to `wiki-seed`, `docs/wiki/README.md` documents it as a source layer, `tests/wiki-seed.sh` covers the seed command, and GitHub wiki is enabled for the repo. The subdirectories contain real platform-neutral seed content rather than empty stubs. Added `CONTEXT-MAP.md` routing so the seed source is easier to find.

### GEMINI.md
- **Action taken:** kept
- **Reason:** It is a valid include pointer to `AGENTS.md` and `skills/caveman/SKILL.md`; both targets exist. Current docs describe it as a compatibility pointer for provider-neutral dispatch, and the AFK prototype command surfaces still recognize `gemini` as a provider.

### build.sh / package.sh
- **Action taken:** kept
- **Reason:** There is no `.github/workflows/` or root `Makefile`, but root `build.sh` is the canonical Swift build wrapper used by `./aos dev build` through `scripts/aos-dev-build.mjs`, by `scripts/aos-after-build`, and by `scripts/package-aos-runtime`. Root `package.sh` is a legacy/manual packaging entrypoint, while the current script packaging surface is `scripts/package-aos-runtime`; consolidating those would be broader packaging cleanup, not a confident structural delete.

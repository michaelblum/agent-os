# Domain Material Archive Removal V0

## Tracker

- GitHub issue: #421.
- Source plan: `/Users/Michael/.claude/plans/structured-sleeping-diffie.md`.
- Archive target: `/Users/Michael/Code/_archive/employer-brand-domain/`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
issue, archive, or prior implementation state. Read and rediscover before
editing.

## Goal

Archive the tracked employer-brand plus KILOS domain fileset outside
`agent-os`, remove the same tracked files from the repo, fix surviving live
references, and prove the install-independent static gates.

## Branch/Base

- Profile: `local_relay`.
- Work surface: the single checkout at `/Users/Michael/Code/agent-os`.
- Do not create a linked worktree.
- `branch_from`: `ae262e7fca28a9c82974d61539842673a84f0c4a`
- `required_start_ref`: `ae262e7fca28a9c82974d61539842673a84f0c4a` or a
  branch containing it.
- Preserve unrelated dirty files:
  - `packages/gateway/package-lock.json`
  - `apps/sigil/package.json`

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `/Users/Michael/.claude/plans/structured-sleeping-diffie.md`
- `CONTEXT.md`
- `shared/schemas/browser-evidence-capture-v0.md`
- `.fallowrc.jsonc`
- GitHub issue #421 via `./aos dev gh issue view 421 --json`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --show-toplevel
git rev-parse HEAD
./aos dev situation --json
```

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman. This round can
mostly be verified statically, so do not invent live checks unless the static
gates need them.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - owns
  `WIKI_WORKBENCH_DEFAULT_PATH`.
- `apps/sigil/renderer/live-modules/radial-item-action-dispatch.js` - has a
  default wiki path.
- `apps/sigil/renderer/live-modules/radial-menu-activation.js` - has a default
  wiki path.
- `CONTEXT.md` - contains a live canonical concept reference.
- `shared/schemas/browser-evidence-capture-v0.md` - contains a reference to a
  schema being removed.
- `.fallowrc.jsonc` - remove only employer-brand-specific anchors if present.

## Required Behavior

Build the exact tracked fileset from the source plan using `git ls-files`, copy
that fileset to `/Users/Michael/Code/_archive/employer-brand-domain/` while
preserving repo-relative paths, verify the archive list exactly matches the
removal list, then `git rm` the same tracked files.

Remove these tracked paths/pathspecs:

```text
packages/toolkit/workbench/_reference/employer-brand/
scripts/employer-brand-*.mjs
tests/toolkit/employer-brand-*.test.mjs
tests/schemas/employer-brand-*.test.mjs
shared/schemas/employer-brand-*
shared/schemas/fixtures/employer-brand-audit-project-v0/
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/
docs/design/references/employer-brand-legacy-claude/
docs/design/work-cards/*employer-brand*
wiki-seed/plugins/employer-brand-*
wiki-seed/concepts/*employer-brand*
wiki-seed/entities/employer-brand-*
Employer_Brand_Audit/
wiki-seed/plugins/kilos-competitor-audit/
wiki-seed/plugins/kilos-brand-audit-report/
shared/schemas/company-brand-audit-v0.*
shared/schemas/comparative-brand-audit-v0.*
```

Keep these schemas:

```text
shared/schemas/browser-evidence-capture-v0.*
shared/schemas/spatial-subject-tree-v0.*
```

Fix live references after removal:

- Repoint Sigil's default wiki path from
  `aos/concepts/employer-brand-workflow-map.md` to a surviving neutral concept.
  `aos/concepts/runtime-modes.md` is acceptable if it still resolves to
  `wiki-seed/concepts/runtime-modes.md`.
- Neutralize the live employer-brand canonical concept reference in
  `CONTEXT.md`.
- Remove the `company-brand-audit-v0` reference from
  `shared/schemas/browser-evidence-capture-v0.md`.
- In `.fallowrc.jsonc`, remove employer-brand-specific anchors only if present.

## Suggested Fileset Commands

These commands are suggestions, not a requirement. Adjust if inspection finds a
safer equivalent.

```bash
list_file=/tmp/domain-material-removal-files.txt
archive_root=/Users/Michael/Code/_archive/employer-brand-domain

git ls-files \
  'packages/toolkit/workbench/_reference/employer-brand/' \
  'scripts/employer-brand-*.mjs' \
  'tests/toolkit/employer-brand-*.test.mjs' \
  'tests/schemas/employer-brand-*.test.mjs' \
  'shared/schemas/employer-brand-*' \
  'shared/schemas/fixtures/employer-brand-audit-project-v0/' \
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/' \
  'docs/design/references/employer-brand-legacy-claude/' \
  'docs/design/work-cards/*employer-brand*' \
  'wiki-seed/plugins/employer-brand-*' \
  'wiki-seed/concepts/*employer-brand*' \
  'wiki-seed/entities/employer-brand-*' \
  'Employer_Brand_Audit/' \
  'wiki-seed/plugins/kilos-competitor-audit/' \
  'wiki-seed/plugins/kilos-brand-audit-report/' \
  'shared/schemas/company-brand-audit-v0.*' \
  'shared/schemas/comparative-brand-audit-v0.*' \
  | sort -u > "$list_file"
```

Review the list before copying or removing. If the fileset contains
`shared/schemas/browser-evidence-capture-v0.*`,
`shared/schemas/spatial-subject-tree-v0.*`, this work card, or unrelated dirty
paths, stop and report `failed`.

## Scope And Hard Boundaries

- Scope: archive/removal, live-reference cleanup, static verification.
- Do not delete platform-generic abstractions merely because they contain
  employer-brand examples.
- Do not rewrite historical archive prose unless a static gate proves it breaks
  the live repo.
- Do not touch Sigil fallow anchoring except for employer-brand-specific anchors
  if found.
- Do not modify `packages/gateway/package-lock.json` or
  `apps/sigil/package.json`.
- Do not push, open a PR, or close issues. Foreman owns external publication and
  ledger reconciliation after acceptance.

## Verification

Run these gates and report exact results:

```bash
git status --short --branch
git diff --check
```

Archive completeness:

```bash
archive_root=/Users/Michael/Code/_archive/employer-brand-domain
find "$archive_root" -type f | sed "s#^$archive_root/##" | sort > /tmp/domain-material-archive-files.txt
diff -u /tmp/domain-material-removal-files.txt /tmp/domain-material-archive-files.txt
```

Removed tracking:

```bash
while IFS= read -r path; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 && printf 'still tracked: %s\n' "$path"
done < /tmp/domain-material-removal-files.txt
```

This must print nothing.

Static reference gates:

```bash
git ls-files | xargs rg -n '_reference/employer-brand|employer-brand-.*\.(js|mjs)' || true
rg -n 'employer-brand|company-brand-audit|comparative-brand-audit|employer-brand-audit-project-v0' tests || true
rg -n 'company-brand-audit-v0|comparative-brand-audit-v0' shared/schemas packages apps scripts tests || true
rg -n 'aos/concepts/employer-brand-workflow-map.md|WIKI_WORKBENCH_DEFAULT_PATH' apps/sigil/renderer/live-modules/main.js apps/sigil/renderer/live-modules/radial-item-action-dispatch.js apps/sigil/renderer/live-modules/radial-menu-activation.js
test -f wiki-seed/concepts/runtime-modes.md
git ls-files 'shared/schemas/browser-evidence-capture-v0.*' 'shared/schemas/spatial-subject-tree-v0.*'
```

The broad grep may return historical or coordination docs. Classify any
survivors. There must be no surviving imports, requires, spawn calls, tests, or
live default paths into removed files.

Optional only if package installation is already available:

```bash
npm test -- --help
```

Do not install dependencies as part of this round.

## Completion Report

Report:

- Files archived and removed, including count and archive root.
- The exact archive/removal list comparison result.
- Live references changed.
- Verification commands with pass/fail results and any classified grep
  survivors.
- Confirmation that the unrelated dirty files were preserved untouched.
- Any blockers, especially product-direction questions about whether a file is
  platform-generic and should be kept.

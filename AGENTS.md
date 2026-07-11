# agent-os Root DOX Contract

This file is the DOX rail for repo-root sessions. It tells agents how to find
the applicable local authority; it is not the place for workflow, role, runtime,
or architecture detail.

## DOX Framework

- DOX is the binding `AGENTS.md` hierarchy installed here.
- Agents must follow DOX instructions across any edits.

### Root Scope

- Root owns this hierarchy protocol, repo-wide hard invariants, and the
  top-level Child DOX Index.
- Child `AGENTS.md` files own local purpose, scope, workflow, verification,
  and child indexes.
- Detailed rules belong in the nearest owner, not in this root file.

### Core Contract

- `AGENTS.md` files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable `AGENTS.md` plus
  every parent `AGENTS.md` above it.

### Read Before Editing

1. Read the root `AGENTS.md`.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every `AGENTS.md` found along each route.
5. If a parent `AGENTS.md` lists a child `AGENTS.md` whose scope contains the
   path, read that child and continue from there.
6. Use the nearest `AGENTS.md` as the local contract and parent docs for
   repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child
   doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session
before editing.

### Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning `AGENTS.md` when a change affects:

- purpose, scope, ownership, or responsibilities;
- durable structure, contracts, workflows, or operating rules;
- required inputs, outputs, permissions, constraints, side effects, or
  artifacts;
- user preferences about behavior, communication, process, organization, or
  quality;
- `AGENTS.md` creation, deletion, move, rename, or index contents.

Update parent docs when parent-level structure, ownership, workflow, or child
index changes. Update child docs when parent changes alter local rules. Remove
stale or contradictory text immediately. Small edits that do not change behavior
or contracts may leave docs unchanged, but the DOX pass still must happen.

### Hierarchy

- Root `AGENTS.md` is the DOX rail and top-level Child DOX Index.
- Child `AGENTS.md` files own domain-specific instructions and their own Child
  DOX Index.
- Each parent explains what its direct children cover and what stays owned by
  the parent.
- The closer a doc is to the work, the more specific and practical it must be.

### Child Doc Shape

- Create a child `AGENTS.md` when a folder becomes a durable boundary with its
  own purpose, rules, responsibilities, workflow, materials, or quality
  standards.
- Work Guidance must reflect the current standards of the project or user
  instructions; if there are no specific standards or instructions yet, leave it
  empty.
- Verification must reflect an existing check; if no verification framework
  exists yet, leave it empty and update it when one exists.

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

### Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local
  version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for
  risks that no longer exist.

### Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

## Hard Invariants

- Do not discard or overwrite user changes to satisfy workflow hygiene.
- Do not invent new scoping models for runtime resources.
- Do not create or use linked git worktrees for agent-os agent work. The
  default repo runtime belongs to the primary checkout; runtime-coupled tests
  from any alternate checkout must use an explicit isolated `AOS_STATE_ROOT`.
- Treat `_dev` demos as non-canonical.
- Treat external Sigil as AOS's first-party reference consumer. Sigil needs may
  drive product-neutral primitives, toolkit policy, hosts, schemas, and public
  CLI changes without waiting for a second consumer; keep branded product
  composition in the Sigil repository.
- Never attribute commits, PR descriptions, issue comments, or release notes to
  Claude or any AI assistant.

## Child DOX Index

- `.codex/AGENTS.md` governs local Codex configuration and native custom-agent
  disablement.
- `.agents/` contains cross-provider hook scripts and stays root-owned until a
  child doc is needed.
- `.claude/` contains Claude compatibility settings and statusline hooks; live
  project-agent orchestration is retired from AOS core.
- `apps/AGENTS.md` governs retained application fixtures. Its current child is
  the frozen legacy contract at `apps/sigil/AGENTS.md`; active Sigil product
  authority lives in `Ch-osctrl/sigil`.
- `docs/AGENTS.md` governs durable docs, ADRs, guides, API docs, reports, and
  archives.
- `experiences/AGENTS.md` governs experience manifests and app activation
  material.
- `manifests/AGENTS.md` governs command and capability manifests.
- `packaging/AGENTS.md` governs repo runtime packaging metadata such as
  `Info.plist`, entitlements, and signing experiment inputs.
- `packages/AGENTS.md` governs reusable JavaScript/package layers. Its current
  child is `packages/toolkit/AGENTS.md`, which further indexes `contracts/`,
  `controls/`, `panel/`, and `runtime/`.
- `recipes/AGENTS.md` governs operational recipes and repeatable procedures.
- `scripts/AGENTS.md` governs executable repo tooling and `aos` command
  adapters.
- `shared/AGENTS.md` governs shared schemas, shared JS contracts, and shared
  Swift IPC helpers.
- `skills/AGENTS.md` governs local skill packages.
- `src/AGENTS.md` governs native Swift source. Its current child is
  `src/daemon/AGENTS.md`.
- `tests/AGENTS.md` governs shell, Node, Python, browser, daemon, toolkit, and
  scenario verification assets.
- `wiki-seed/AGENTS.md` governs seed wiki content.

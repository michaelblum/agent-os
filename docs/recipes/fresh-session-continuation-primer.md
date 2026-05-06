# Fresh Session Continuation Primer

> **Current handoff note:** For the grand-unification/schema-hardening
> workstream, read this primer first, then read
> `docs/design/aos-grand-unification-next-session-goal.md`. That handoff's
> Work Record schema-design slice supersedes the older "Current Likely Next
> Work" section below when continuing from branch
> `codex/toolkit-style-contracts`.

Use this primer when a new agent session needs to continue recent AOS work but may not have reliable hydrated context. Do not assume the current worktree, branch, open issues, open PRs, daemon state, or local canvases match any prior session summary.

## First Rule

Rediscover the state before continuing work. Treat previous summaries as hints, not truth.

## Entry Path

Start as an AOS developer session, not just an agent harness session. The current workstream touches toolkit, app surfaces, docs, GitHub coordination, and AOS runtime behavior.

Run from the repo root if available:

```sh
pwd
git status --short --branch
git worktree list
git branch --format='%(refname:short)' | sort
./aos ready
./aos show list --json
```

If `./aos ready` reports blockers, follow root `AGENTS.md`. Do not improvise repeated repair loops.

## Do Not Assume These Are Current

The following branches and worktrees were active around the last handoff, but a fresh session must verify them before use:

- `main`
- `codex/wiki-workbench-sidebar`
- `codex/employer-brand-demo`
- `codex/demo-postmortem-2026-05-05`
- `/Users/Michael/Code/agent-os-worktrees/wiki-workbench-sidebar`
- `/Users/Michael/Code/agent-os-worktrees/employer-brand-demo`

The exact branch list, worktree list, PR state, and issue state may have changed.

## High-Level Workstream

Before the demo interruption, the active platform work was not the Employer Brand report itself. It was AOS surface/toolkit consolidation:

- normalize panel/window chrome and typography around the best workbench style,
- reduce bespoke panel/sidebar/split-pane behavior into toolkit primitives,
- make wiki workbench graph controls use a real fixed sidebar split-pane instead of private overlay UI,
- keep Agent Terminal and future Sigil Chat aligned around shared shell primitives,
- improve window ownership, minimize/maximize, display placement, and canvas inspector behavior through shared logic,
- preserve larger workbench/artifact/workflow ideas without letting them derail the short-term toolkit cleanup.

The Employer Brand demo branch is a separate short-term artifact/report harness. Do not merge that work into the toolkit path unless the user explicitly asks.

## Important Recent Lessons

### Demo Failure

Read this before preparing another stakeholder demo:

```sh
sed -n '1,260p' docs/design/2026-05-05-employer-brand-demo-postmortem.md
```

Main lesson: the demo failed as an integrated AOS experience because surface control, artifact routing, and report polish were not ready, even though the collection harness worked.

### Surface Control Gap

AOS has primitives: `see`, `do`, `show`, `tell`, and `listen`. The missing layer is reliable product-action routing:

- open a named artifact,
- move a named surface to a named display,
- focus a named workbench,
- open a wiki node by semantic label,
- close/minimize/restore surfaces consistently.

Do not hide this gap with ad hoc AppleScript or one-off UI hacks. If a fix belongs in toolkit or primitives, push it there.

### Workbench Direction

Read these before changing workbench abstractions:

```sh
sed -n '1,260p' docs/design/aos-workbench-pattern.md
sed -n '1,260p' docs/design/open-design-workbench-cross-reference.md
sed -n '1,260p' docs/design/aos-work-records-and-self-healing-recipes.md
```

The durable direction is layered artifacts: natural language spine, structured data, preview/render surfaces, and agent/human editing loops. Do not turn this into a huge platform rewrite unless there is a clear issue and exit criteria.

### Window And Surface Behavior

Read these before touching canvas placement or panel chrome:

```sh
sed -n '1,260p' docs/design/aos-panel-window-placement-contract.md
sed -n '1,260p' docs/design/aos-surface-system.md
```

The goal is shared behavior for toolkit windows and AOS-owned surfaces, not private placement logic in each panel.

## Suggested State Discovery

After the initial local checks, inspect GitHub state. Prefer the GitHub app if available, otherwise `gh`.

Useful targets to rediscover:

- open PRs from current local branches,
- open issues related to toolkit surface primitives, workbench, window placement, wiki workbench, and Employer Brand workflow,
- any PR comments that changed priorities,
- whether branches have already landed or been superseded.

Examples:

```sh
gh pr list --state open --limit 30
gh issue list --state open --limit 50
```

If `gh` is unavailable or unauthenticated, report that and continue with local evidence.

## Suggested Resume Path

1. Switch away from transient/demo branches if needed.
2. Verify whether `codex/wiki-workbench-sidebar` still exists and is the active toolkit cleanup branch.
3. If it exists, inspect its diff against `main`.
4. If it has landed, resume from `main` on a new topic branch.
5. If it is stale or conflicts with newer work, summarize the conflict before editing.

Recommended inspection:

```sh
git -C /Users/Michael/Code/agent-os-worktrees/wiki-workbench-sidebar status --short --branch
git -C /Users/Michael/Code/agent-os-worktrees/wiki-workbench-sidebar diff --stat main...HEAD
git -C /Users/Michael/Code/agent-os-worktrees/wiki-workbench-sidebar log --oneline --decorate --max-count=12
```

Adjust paths if that worktree no longer exists.

## Current Likely Next Work

The likely next useful slice is to continue toolkit normalization:

- compare the current wiki workbench and canvas inspector against the preferred 3D radial item workbench visual style,
- identify private CSS/HTML/JS that duplicates toolkit window, titlebar, toolbar, split-pane, fixed-sidebar, and collapsible-panel behavior,
- extract only the clean shared pieces,
- update the adopter surfaces,
- verify with `./aos show` and, where appropriate, `./aos see`.

Keep the slice small. Avoid a full "parallel windowing system" rewrite.

## Verification Expectations

For pure toolkit DOM/model work:

```sh
npm test -- --help
node --test <focused-test-file>
git diff --check
```

Use the repo's actual test scripts if found. Do not invent a large new test harness unless the local package already expects it.

For AOS display behavior:

```sh
./aos ready
./aos show create ...
./aos show wait --id <canvas-id> --json
./aos see ...
```

If the user is explicitly providing visual sign-off, set up the state quickly and ask for confirmation instead of over-automating visual judgment.

## Demo-Specific Caution

Do not use the demo TTS setup as normal development process. It was a controlled live-demo affordance.

If TTS is needed again, foreground `./aos tell human ...` is safer than a fire-and-forget helper for important lines.

Do not use the Computer Use plugin for this repo unless the user explicitly reverses that constraint. Use AOS primitives and local command surfaces.

## What To Tell The User At Start

Use plain English:

"I am going to rediscover the repo, branch, worktree, GitHub, and AOS runtime state first. I will treat prior summaries as hints, not truth. Then I will resume from the smallest current platform slice, likely the toolkit/wiki-workbench surface consolidation path, unless the live evidence points elsewhere."

## When To Stop And Ask

Stop for user input only when:

- there are conflicting active branches that both contain substantive unmerged work,
- a PR or issue has changed the target direction,
- a visual decision is required,
- a fix would require rebuilding `./aos` and may trigger macOS permission churn,
- or continuing would collapse separate workstreams, such as report delivery and toolkit platform cleanup.

Otherwise, make the conservative choice, checkpoint reversibly, and continue.

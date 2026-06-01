# AOS Canonical URL Harness Primitives V0

## Recipient

GDI.

## Transfer Kind

Deterministic implementation round for shared test harness / SOP primitives.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon state,
canvas state, content roots, or prior Foreman discussion. Rediscover from the
repo.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required start ref:
  `e4beb770bd5dafe813d4a93792c37896ea460105`
- Triggering concern: the prior Sigil trail correction card carried
  hand-written instructions for canonical `aos://` URL use, fresh runtime
  checks, and single-worktree checks. That is the wrong abstraction layer for a
  recurring runtime evidence contract.

## Single Goal

Encode the AOS canonical URL and fresh-runtime evidence contract in reusable
test harness primitives and deterministic tests, so future Sigil/AOS live
cards call shared helpers instead of freelancing URL/reload/runtime checks.

This slice is the prerequisite for resuming the interdimensional trail
preflight. Do not continue the trail fix in this round.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `e4beb770bd5dafe813d4a93792c37896ea460105`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Use the single repo worktree at `/Users/Michael/Code/agent-os`.
- Commit the harness/SOP/test changes locally on that branch.
- Do not push, open/update PRs, close issues, or mutate GitHub state.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/lib/visual-harness.sh`
- `tests/lib/isolated-daemon.sh`
- `scripts/aos-content-scope.sh`
- `tests/visual-harness-content-preflight.sh`
- `tests/renderer/sigil-content-roots.test.mjs`
- `docs/api/aos.md` section "Reload an Existing Canvas From Current Content"
- `apps/sigil/scripts/launch-common.sh`
- `apps/sigil/AGENTS.md`

## Problem

The current repo has the right concepts, but the evidence contract is spread
across work cards, docs, launch helpers, and individual shell tests:

- use `aos://...` at command/config boundaries;
- allow AOS/WKWebView to resolve that to `http://127.0.0.1:<port>/...` at
  runtime;
- compare canonical and resolved URLs by root/path/query equivalence, not raw
  string equality;
- use scoped content-root keys only as content-root namespaces, not as Git
  worktrees;
- choose canonical `sigil` / `toolkit` roots for the single-worktree dev
  workflow, even on a feature branch;
- use branch-scoped roots only when there are actual parallel worktrees /
  sessions to isolate, or when an explicit environment override requests them;
- reload URL-backed canvases through canonical `aos://...`, not by copying
  resolved localhost URLs;
- assert that a live smoke is using a page loaded after the commit under test;
- assert live canvases are owned by the expected repo worktree.

When those checks live in a one-off work card, agents improvise, tests get
longer, and live evidence becomes unpredictable.

## Required Implementation

Promote the contract into shared harness primitives. Prefer extending
`tests/lib/visual-harness.sh` unless you find a cleaner existing home.

Add focused helpers for the reusable operations. Names are suggestions; choose
clear local names consistent with the file:

- choose content-root keys deterministically:
  - in a single Git worktree, default to canonical `sigil` and `toolkit`;
  - in a true parallel-worktree/session setup, use scoped roots from
    `scripts/aos-content-scope.sh`;
  - preserve explicit `AOS_SIGIL_CONTENT_ROOT` / `AOS_TOOLKIT_CONTENT_ROOT`
    overrides.
- build canonical content URLs:
  - `aos_visual_content_url <root-key> <path> [query]`
  - `aos_visual_sigil_renderer_url`
  - `aos_visual_toolkit_url <path> [query]`
- reload/update a URL-backed canvas through a canonical `aos://...` URL:
  - reject or warn on raw `http://127.0.0.1:<port>/...` inputs unless a caller
    explicitly opts into a diagnostic-only comparison mode;
  - preserve the existing canvas via `./aos show update --id ... --url ...`.
- compare canonical and live canvas URLs by content-root/path/query
  equivalence:
  - `aos://sigil_x/renderer/index.html?toolkit-root=toolkit_x`
  - `http://127.0.0.1:<port>/sigil_x/renderer/index.html?toolkit-root=toolkit_x`
  should match.
- assert a canvas is loaded from the expected repo worktree:
  - `owner.worktree_root === /Users/Michael/Code/agent-os` in show-list data.
- assert a live renderer is fresh for the commit under test:
  - `git show -s --format=%cI HEAD`;
  - `window.__sigilDebug.snapshot().runtime.loadedAt`;
  - fail if `loadedAt` is older than the commit time.

Keep the helpers composable. Do not make a giant Sigil-only smoke runner.
Sigil-specific wrappers can call generic helpers.

## Required Adoption

Use the new helpers in at least one existing harness path so the primitive is
not dead code. Good candidates:

- `aos_visual_launch_sigil_avatar`;
- `aos_visual_prepare_live_roots`;
- `tests/visual-harness-content-preflight.sh`;
- a small new shell test beside `tests/visual-harness-content-preflight.sh`.

Do not migrate every test in the repo. This is a small primitive slice.

## Required Tests

Add deterministic coverage for the helper contract. Keep it fast and small.

Cover:

- canonical URL builder returns `aos://...` URLs for canonical and
  branch-scoped root keys;
- content-root key selection returns canonical `sigil` / `toolkit` for the
  single-worktree dev workflow on a feature branch;
- content-root key selection still supports explicit branch-scoped overrides
  and true parallel-worktree isolation;
- raw resolved localhost URLs are not accepted as canonical launch/update
  inputs by default;
- `aos://...` and resolved `http://127.0.0.1:<port>/...` forms compare
  equivalent when root/path/query match;
- different root/path/query does not compare equivalent;
- fake `show list --json` data can prove expected `owner.worktree_root`;
- fake commit time plus fake debug `loadedAt` catches stale live canvases.

Use a fake AOS script if needed, following
`tests/visual-harness-content-preflight.sh`. Do not require a live daemon for
these deterministic tests.

## SOP Documentation

Update the shared harness documentation, not the trail work card, with the
durable rule:

- command/config boundary: use canonical `aos://...`;
- runtime observation: AOS may report resolved localhost URLs;
- comparison: use root/path/query equivalence;
- reload: `show update --url 'aos://...'`;
- root scoping: single-worktree dev workflow uses canonical roots; branch
  scoping is only for explicit or true parallel-worktree isolation;
- content-root namespace is not a Git worktree;
- freshness: live smoke must prove the loaded page is newer than or equal to
  the commit under test when code changes matter.

Best places:

- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md` if there is an appropriate live harness section.

## Hard Boundaries

- Do not implement or continue the Sigil interdimensional trail fix in this
  round.
- Do not implement Selection Mode scene facets or pointer migration.
- Do not change AOS daemon URL rewriting behavior unless a tiny deterministic
  bug is exposed and fixed with tests.
- Do not remove branch-scoped content-root support.
- Do not create additional Git worktrees.
- Do not push or mutate GitHub state.

## Verification

Run at minimum:

```bash
git diff --check
bash tests/visual-harness-content-preflight.sh
node --test tests/renderer/sigil-content-roots.test.mjs
```

Also run the new deterministic helper test you add.

If you touch only shell/docs and no Node modules, explain why no additional
`node --check` command applies. If you add shell helpers, run them through the
new deterministic test rather than a long live smoke.

## Completion Report

Return:

- commit SHA;
- files changed;
- helper names added and where they live;
- deterministic tests added/updated and what contract each catches;
- docs/SOP sections updated;
- exact verification commands and pass/fail result;
- confirmation that the trail fix and Selection Mode scene facet were not
  implemented;
- local-only state still present;
- confirmation that no push/GitHub mutation occurred.

# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Wiki/Content Test State Isolation
**Date:** 2026-05-06

## Goal

Harden wiki/content integration tests so normal agent verification cannot reset
or mutate the live repo-mode wiki state.

The Wiki Graph Taxonomy Alignment V0 slice landed on `main` at `bf03eab`. During
that GDI and the foreman rerun, `tests/wiki-integration.sh` exposed a serious
operational hazard: when run without an explicit isolated `AOS_STATE_ROOT`, the
script targets `~/.config/aos/repo/wiki` and begins by deleting the wiki
directory. That behavior is incompatible with safe agentic development.

The immediate workstream is tracked in GitHub issue #289:

```text
https://github.com/michaelblum/agent-os/issues/289
```

The target branch for the next session is:

```text
codex/wiki-content-test-isolation
```

## Required Rediscovery

Do not assume branch, worktree, PR, issue, daemon, canvas, or dirty state from
prior summaries. Start by reading `AGENTS.md`, then rediscover state:

```bash
git status --short --branch
git worktree list
git branch --format='%(refname:short)' | sort
./aos ready
./aos show list --json
./aos dev recommend --json
gh issue view 289 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the repo and testing guidance:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `tests/README.md`
- `docs/dev/workflow-rules.json`
- `docs/dev/workflow-rules.schema.json`
- `docs/api/aos.md`

Then inspect the wiki/content tests and related commands:

- `tests/wiki-integration.sh`
- `tests/content/wiki-graph-page-kind.test.sh`
- `tests/content/wiki-list.test.sh`
- other `tests/content/*.sh`
- `src/commands/wiki.swift`
- `src/commands/wiki-graph.swift`
- `src/content/server.swift`
- `apps/sigil/sigilctl-seed.sh`
- adjacent tests selected by `./aos dev recommend`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `bf03eab feat: align wiki graph page kinds`
- `3c8a130 feat: add artifact bundle subject v0`
- `797123d docs: refine gdi exit interview recipe`

Treat these as orientation only. Rediscover before editing.

## Foreman Finding To Verify

This finding was collected during foreman verification:

- Running `tests/wiki-integration.sh` directly printed
  `Wiki dir: /Users/Michael/.config/aos/repo/wiki`.
- The script then reset that directory.
- Running it as `AOS_STATE_ROOT=$(mktemp -d) bash tests/wiki-integration.sh`
  used `/tmp/.../repo/wiki` and passed.
- `tests/content/wiki-graph-page-kind.test.sh` uses the live content server and
  writes temporary pages through HTTP, then deletes them. It passed when run
  separately.
- Running stateful wiki/content tests concurrently can create false failures or
  runtime contamination.

## Immediate Work Plan

1. Audit all wiki/content shell tests for writes, deletes, and implicit repo-mode
   state assumptions.
2. Classify each test as:
   - read-only against live repo state;
   - self-isolating with a temporary `AOS_STATE_ROOT`;
   - live content-server test with explicit cleanup;
   - destructive and unsafe.
3. Harden `tests/wiki-integration.sh` first. Preferred behavior:
   - allocate a temporary `AOS_STATE_ROOT` by default;
   - export it before invoking `./aos`;
   - print the isolated wiki dir;
   - clean it up on exit;
   - refuse to run if its computed `WIKI_DIR` is under
     `~/.config/aos/repo/wiki`.
4. Keep an explicit escape hatch only if there is a proven need, and name it so
   it cannot be set accidentally.
5. Add or update a focused regression check proving the script will not target
   the canonical repo wiki path.
6. Update `tests/README.md` or nearby docs so agents know destructive wiki tests
   must be isolated.
7. Update `docs/dev/workflow-rules.json` only if the router should recommend the
   isolated invocation form for changed wiki/content tests.
8. Run the workflow router with focused `--files`, then focused tests,
   router-selected tests, `git diff --check`, and `./aos ready`.
9. Verification must include:
   - a before/after live repo wiki graph or list check proving normal test runs
     did not mutate repo wiki state;
   - isolated `tests/wiki-integration.sh`;
   - `tests/content/wiki-graph-page-kind.test.sh`;
   - any changed content tests.
10. Commit focused reversible slices.

## Acceptance Criteria

- `tests/wiki-integration.sh` never deletes or writes under
  `~/.config/aos/repo/wiki` by default.
- The default invocation of `tests/wiki-integration.sh` is safe for agents to run
  in repo mode.
- A regression check proves the script refuses or avoids the canonical repo wiki
  path.
- Existing wiki integration behavior still passes under an isolated state root.
- Content-server tests with live HTTP writes still clean up after themselves and
  are documented as live-state tests.
- `./aos dev recommend --json --files ...` gives usable verification guidance
  for this class of change, or the router gap is documented precisely.
- Final state has no created canvases and no leftover test pages under the live
  repo wiki.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not broaden this into wiki graph taxonomy, Subject Browser, Sigil renderer,
  or content-server feature work.
- Do not delete, reset, or rewrite live repo wiki state as part of verification.
- Do not leave temporary state roots behind.
- No new public `aos` command surface unless rediscovery proves one is necessary
  and the user explicitly approves broadening.
- Keep worktree/canonical content-root rules from `AGENTS.md` in force. The
  singleton daemon is shared across worktrees.

## Known Follow-Up Outside This Slice

Issue #288 separately tracks ref-based AOS actions for xray/accessibility
targets. Do not mix that command-surface work into this test-isolation slice.

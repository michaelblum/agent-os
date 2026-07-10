# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Live Canvas Test Serial V0
**Date:** 2026-05-06

## Goal

Make the live AOS canvas shell-test contract explicit and resilient enough that
agents do not accidentally run shared-daemon canvas tests concurrently.

The Semantic Target `do_target` V0 slice landed on `main` at `65d19a0`. Its exit
interview reported that two live canvas xray smoke tests failed once when run
concurrently, then passed when rerun serially. These tests create AOS canvases
against the singleton repo daemon, so concurrent execution can create false
failures or state contamination.

The immediate workstream is tracked in GitHub issue #291:

```text
https://github.com/michaelblum/agent-os/issues/291
```

The target branch for the next session is:

```text
codex/live-canvas-test-serial-v0
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
node scripts/aos-dev-workflow.mjs recommend --json
gh issue view 291 --json number,title,state,url,body
```

Use focused `node scripts/aos-dev-workflow.mjs recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the repo and testing guidance:

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `docs/guides/agent-entry-paths-and-verification.md`
- `tests/README.md`
- `docs/dev/workflow-rules.json`
- `shared/schemas/dev-workflow-rules.schema.json`
- `docs/api/aos.md`

Then inspect the likely live canvas test surface:

- `tests/aos-semantic-targets-xray.sh`
- `tests/aos-semantic-targets-xray-retry.sh`
- `tests/aos-canvas-ref-click.sh`
- `tests/capture-canvas-surface.sh`
- `tests/capture-union-canvas-surface.sh`
- `tests/canvas-id-injection.sh`
- `tests/canvas-stats-injection.sh`
- `tests/canvas-lifecycle-metadata-smoke.sh`
- `tests/lib/visual-harness.sh`
- adjacent tests selected by `node scripts/aos-dev-workflow.mjs recommend`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `65d19a0 feat: expose semantic target do target`
- `1ca2e54 feat: add canvas ref click path`
- `9a26492 test: isolate wiki content state`

Treat these as orientation only. Rediscover before editing.

## Foreman Finding To Verify

The relevant failure mode is not deterministic logic failure. It is shared
runtime contention:

- live canvas shell tests create/remove AOS canvases through the shared repo
  daemon;
- the singleton daemon and canvas namespace are not isolated by default;
- two xray/ref-click smoke tests can overlap in timing and produce false
  failures;
- serial reruns passed.

This is similar in spirit to the wiki/content state isolation work, but the
scope should stay smaller: document or protect live canvas shell tests from
accidental parallel execution. Do not redesign daemon isolation.

## Immediate Work Plan

1. Audit the focused live canvas shell tests that create AOS canvases through
   the shared repo daemon.
2. Classify them as:
   - isolated daemon/root tests;
   - shared repo daemon live canvas tests that must run serially;
   - pure local tests that do not need this contract.
3. Choose the smallest durable guard:
   - documentation-only is acceptable if it clearly prevents prompt/router misuse;
   - a tiny shared shell lock helper is acceptable if it is simple and reduces
     repeated mistakes;
   - do not build a full test harness or daemon-isolation system in this slice.
4. Update `tests/README.md` with the serial-live-canvas contract.
5. Update the affected semantic target/ref-click tests to either:
   - use the shared lock/helper; or
   - carry a clear header/comment naming the serial contract.
6. If router rules should steer changed live canvas tests toward serial focused
   commands, update `docs/dev/workflow-rules.json` and schema/fixtures only as
   needed.
7. Run `node scripts/aos-dev-workflow.mjs recommend --json --files ...`, then focused tests,
   router-selected tests, `git diff --check`, `./aos ready`, and `./aos show
   list --json` cleanup verification.
8. Commit focused reversible slices.

## Acceptance Criteria

- `tests/README.md` explains that live canvas tests using the shared repo daemon
  should run serially unless they allocate an isolated daemon/root.
- The semantic target/ref-click live tests are documented or protected by a
  shared lock/helper.
- Focused serial runs still pass:
  - `bash tests/aos-semantic-targets-xray.sh`
  - `bash tests/aos-semantic-targets-xray-retry.sh`
  - `bash tests/aos-canvas-ref-click.sh`
- Final verification leaves no `semantic-target-*` or `canvas-ref-click-*`
  canvases behind.
- The handoff schema path uses
  `shared/schemas/dev-workflow-rules.schema.json`.
- No broad daemon isolation, macro playback, work-record, or UI feature work is
  added.

## Guardrails

- Use `./aos` primitives and repo CLI. Do not use the Computer Use plugin for
  this repo.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not add new public `aos` command surface.
- Do not broaden into ref-click behavior, semantic target schema, workbench UI,
  or daemon architecture.
- Keep live canvas verification serial in this session.
- Remove verification canvases before exit.

## Known Follow-Up Outside This Slice

The same exit interview mentioned a compact GDI evidence packet helper and
post-build TCC messaging. Those are useful but separate workstreams; do not mix
them into the live canvas serial-test slice.

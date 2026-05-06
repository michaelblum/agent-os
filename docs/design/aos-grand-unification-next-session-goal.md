# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Ref-Based AOS Click V0
**Date:** 2026-05-06

## Goal

Add a bounded ref-based AOS action path so agents can click semantic targets
discovered by `./aos see capture --canvas <id> --xray` without manual coordinate
math.

The immediate workstream is tracked in GitHub issue #288:

```text
https://github.com/michaelblum/agent-os/issues/288
```

The target branch for the next session is:

```text
codex/aos-ref-click-v0
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
gh issue view 288 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the repo and action/perception guidance:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/api/aos.md`
- `shared/schemas/aos-semantic-targets.md`
- `tests/README.md`
- `docs/dev/workflow-rules.json`
- `docs/dev/workflow-rules.schema.json`

Then inspect the likely implementation surface:

- `src/main.swift`
- `src/shared/command-registry-data.swift`
- `src/act/act-cli.swift`
- `src/act/actions.swift`
- `src/act/act-models.swift`
- `src/act/targeting.swift`
- `src/perceive/semantic-targets.swift`
- `src/perceive/capture-pipeline.swift`
- `src/perceive/models.swift`
- `tests/aos-semantic-targets-xray.sh`
- `tests/see-do-state-metadata.sh`
- `tests/help-contract.sh`
- adjacent tests selected by `./aos dev recommend`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `9a26492 test: isolate wiki content state`
- `bf03eab feat: align wiki graph page kinds`
- `3c8a130 feat: add artifact bundle subject v0`

Treat these as orientation only. Rediscover before editing.

## Foreman Finding To Verify

Current browser actions already support target-with-ref syntax:

```bash
./aos do click browser:<session>/<ref>
```

AOS-owned canvas perception already exposes semantic refs:

```bash
./aos see capture --canvas <canvas-id> --xray
```

That response includes `semantic_targets[]` entries carrying fields such as
`canvas_id`, `ref`, `role`, `name`, `action`, `surface`, `enabled`, `bounds`,
and `center`. But one-shot `aos do click` currently has no canvas target-with-ref
form; agents must convert xray bounds into coordinates manually or fall back to
developer-only `show eval`.

`state_id` is a correlation handle for the perception an action was chosen from.
It is not currently a stable object cache key. Do not design V0 as if
`--state-id` alone can dereference a historical capture.

## Preferred Command Shape

Prefer extending the existing `click` command instead of adding a new subcommand:

```bash
./aos do click canvas:<canvas-id>/<ref> --state-id <see_id>
```

This matches the established target-with-ref model already used by browser
targets and avoids verb-surface sprawl. Only choose a separate command such as
`click-ref` if rediscovery proves the existing parser/registry cannot support the
target form cleanly.

V0 may be canvas-only. Browser targets already have a ref-backed action path.

## Immediate Work Plan

1. Confirm the target dialect and parser plan:
   - `browser:<session>/<ref>` already works.
   - Add `canvas:<canvas-id>/<ref>` for click if feasible.
   - Keep coordinate click behavior unchanged.
2. Implement canvas ref resolution above the daemon boundary in the existing
   `aos do click` path unless rediscovery proves a lower primitive is required.
3. Resolve the ref from current canvas semantic targets:
   - verify the canvas exists;
   - collect semantic targets using the fixed probe path, not caller-supplied JS;
   - match by exact `ref`;
   - reject missing, disabled, or ambiguous targets with structured errors.
4. Convert the resolved semantic target center to the coordinate space expected
   by the existing CGEvent click path.
   - Handle normal canvases first.
   - If DesktopWorld/segmented canvases cannot be handled safely in V0, fail
     explicitly with a structured unsupported-surface error instead of guessing.
5. Preserve `--state-id` in action metadata, but do not enforce stale-state
   rejection unless the existing state model already supports it.
6. Return useful execution metadata:
   - backend/strategy/fallback_used/state_id;
   - target dialect, canvas id, ref;
   - resolved center/click coordinate;
   - coordinate-space/source metadata if available.
7. Update command registry/help and `docs/api/aos.md`.
8. Add focused tests:
   - dry-run reports the resolved canvas ref target without clicking;
   - missing ref fails structurally;
   - disabled ref fails structurally if the semantic target marks it disabled;
   - live smoke launches a small AOS canvas, captures xray, clicks
     `canvas:<id>/<ref>` through `./aos do`, and verifies state changed without
     manual math.
9. Run `./aos dev recommend --json --files ...`, then focused tests,
   router-selected tests, `bash tests/help-contract.sh`, `git diff --check`,
   `./aos ready`, and live AOS verification.
10. Commit focused reversible slices.

## Acceptance Criteria

- A ref discovered by `./aos see capture --canvas <id> --xray` can be clicked
  through `./aos do` without manual coordinate conversion.
- The preferred public form is documented as
  `aos do click canvas:<canvas-id>/<ref> --state-id <id>` unless rediscovery
  justifies a different shape.
- Existing coordinate clicks and browser ref clicks remain compatible.
- Missing, disabled, unsupported, or unresolvable refs produce structured errors
  and do not silently fall back to arbitrary coordinates.
- Retina/scale handling is either handled internally or reported clearly in
  execution metadata.
- A live AOS test proves a `data-aos-ref` on an AOS canvas can be clicked without
  `show eval` or manual coordinate math.
- `docs/api/aos.md`, command help, and relevant tests describe when to use
  ref-based canvas action versus coordinate fallback.

## Guardrails

- This is an approved, deliberate public AOS command-surface change, but keep it
  as narrow as possible.
- Do not implement replay/repair, macro playback, work-record capture, browser
  playbooks, or broad target dialect redesign in this slice.
- Do not use `show eval` to perform the action under test. It is acceptable for
  setup or assertion when no better read-only assertion exists.
- Do not use AppleScript as a shortcut for AOS-owned behavior.
- Do not remove coordinate fallback; this adds a semantic path, it does not
  break low-level actuation.
- Keep DesktopWorld/segmented canvas behavior explicit. Support it only if the
  coordinate mapping is clear and testable in this slice.
- Remove verification canvases before exit.

## Known Follow-Up Outside This Slice

The broader Target/Ref/Anchor vocabulary may deserve a later docs/schema pass
after the command lands. Do not block this V0 on that broader taxonomy unless
the implementation reveals a real contract conflict.

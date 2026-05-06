# AOS Grand Unification Next Session Goal

**Status:** handoff goal for Semantic Target `do_target` V0
**Date:** 2026-05-06

## Goal

Expose a canonical `do_target` field in AOS canvas `semantic_targets[]` so the
perception-to-action loop is directly machine-round-trippable.

The AOS ref click V0 slice landed on `main` at `1ca2e54` and added:

```bash
./aos do click canvas:<canvas-id>/<ref> --state-id <id>
```

That solves semantic action, but agents still need to synthesize the target
string from `semantic_targets[].canvas_id` and `semantic_targets[].ref`.
`semantic_targets[]` should carry the exact target-with-ref string accepted by
`aos do`.

The immediate workstream is tracked in GitHub issue #290:

```text
https://github.com/michaelblum/agent-os/issues/290
```

The target branch for the next session is:

```text
codex/semantic-target-do-target-v0
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
gh issue view 290 --json number,title,state,url,body
```

Use focused `./aos dev recommend --json --files ...` arguments after editing so
the router sees the intended slice.

## Read First

Read the repo and perception/action guidance:

- `docs/recipes/fresh-session-continuation-primer.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/api/aos.md`
- `shared/schemas/aos-semantic-targets.md`
- `tests/README.md`
- `docs/dev/workflow-rules.json`
- `docs/dev/workflow-rules.schema.json`

Then inspect the likely implementation and tests:

- `src/perceive/semantic-targets.swift`
- `src/perceive/models.swift`
- `src/perceive/capture-pipeline.swift`
- `src/act/canvas-ref-targeting.swift`
- `src/act/act-cli.swift`
- `tests/aos-semantic-targets-xray.sh`
- `tests/aos-canvas-ref-click.sh`
- `tests/help-contract.sh`
- adjacent tests selected by `./aos dev recommend`

## Current Checkpoint

At this handoff, `main` is expected to include:

- `1ca2e54 feat: add canvas ref click path`
- `9a26492 test: isolate wiki content state`
- `bf03eab feat: align wiki graph page kinds`

Treat these as orientation only. Rediscover before editing.

## Foreman Finding To Verify

`aos see capture --canvas <id> --xray` currently emits entries like:

```json
{
  "canvas_id": "example",
  "ref": "primary.action"
}
```

The action target is now:

```text
canvas:example/primary.action
```

Agents should not need to reconstruct that string. The target string is a
cross-tool contract, and work records/playbooks should be able to carry it
directly as action evidence.

## Immediate Work Plan

1. Add `do_target` to AOS canvas semantic target projection.
   - Only emit it when both `canvas_id` and `ref` are present.
   - Value should be exactly `canvas:<canvas-id>/<ref>`.
   - Preserve all existing `semantic_targets[]` fields.
2. Update `shared/schemas/aos-semantic-targets.md`.
   - Document `do_target` as the canonical target-with-ref string accepted by
     `./aos do click`.
   - Keep `canvas_id` and `ref` documented for structured querying.
3. Update `docs/api/aos.md`.
   - Say agents may pass `semantic_targets[].do_target` directly to
     `aos do click`.
   - Clarify that `state_id` is still correlation metadata, not historical target
     dereference.
4. Update focused tests.
   - `tests/aos-semantic-targets-xray.sh` should assert the `do_target` value.
   - If useful, add a lightweight assertion that the emitted `do_target` works
     with `tests/aos-canvas-ref-click.sh` rather than reconstructing the target.
5. Run `./aos dev recommend --json --files ...`, then focused tests,
   router-selected tests, `bash tests/help-contract.sh` if command docs/help are
   touched, `git diff --check`, `./aos ready`, and live AOS verification.
6. Commit focused reversible slices.

## Acceptance Criteria

- `./aos see capture --canvas <id> --xray` includes
  `semantic_targets[].do_target` for entries with both `canvas_id` and `ref`.
- The value is exactly the public target-with-ref form accepted by
  `./aos do click`.
- Existing `semantic_targets[]` fields remain present and unchanged.
- Tests cover the JSON shape in the semantic target smoke path.
- Docs explain that agents can pass `do_target` directly to `aos do click`.
- Final verification leaves no `semantic-target-smoke-*` or
  `canvas-ref-click-*` canvases behind.

## Guardrails

- This is an additive schema/API field, not a new command.
- Do not redesign Target/Ref/Anchor vocabulary in this slice.
- Do not change `aos do click` behavior unless a bug blocks using the new field.
- Do not implement replay/repair, macro playback, or work-record capture.
- Do not use `show eval` to perform the action under test. It is acceptable for
  setup or read-only assertion if needed.
- Keep live canvas tests serial unless isolated daemon roots are introduced.
- Remove verification canvases before exit.

## Known Follow-Up Outside This Slice

The AOS ref click exit interview also flagged `dev recommend --files`
comma-input ergonomics, live canvas test isolation policy, and post-build TCC
messaging. Those may become separate issues later, but do not mix them into this
`do_target` schema/API slice.

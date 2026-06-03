# GDI Round Transfers

Use this reference when Foreman routes work to GDI.

## Round Contract

A GDI round has exactly one goal. It ends in one of four states:

- **completed:** implementation/validation finished and evidence is reported;
- **failed:** GDI attempted the goal and found a blocking technical failure;
- **stalled:** the next step needs human input, permissions, credentials, or
  product direction;
- **misrouted:** the goal is coordination, prioritization, or human judgment and
  should return to Foreman or Operator.

Do not ask GDI to select the next workstream. GDI may recommend a follow-up, but
Foreman owns acceptance and routing.

## Required Work Card Slots

For non-trivial GDI work, create or update a work card with:

- Fresh Context Contract.
- Goal: one outcome.
- Read First.
- Rediscover State.
- Branch/Base: include `branch_from: <ref>` and `required_start_ref: <ref>`
  when the work card, report, fixtures, or prerequisite commits are not on
  `origin/main`.
- Existing Code To Inspect.
- Required Behavior or Validation Questions.
- Scope and Hard Boundaries.
- Verification.
- Completion Report.

For the full flexible authoring shape, read
`references/gdi-work-card-authoring.md`. Keep that detail in the work card, not
in the clipboard dispatch.

When the card lives on a branch that is not `origin/main`, the dispatch should
also mention the branch:

```text
follow the instructions in docs/design/work-cards/<card>.md; start from <ref>
```

## Branch/Base Rules

Foreman must not assume GDI will infer the base correctly.

- If the work card exists on `origin/main`, omit `branch_from` only when
  `origin/main` is truly the correct base.
- If the work card exists only on a feature branch, set `branch_from` to that
  branch or commit and say whether GDI should create an output branch from it.
- If GDI should validate a Foreman branch in place, say "work surface" instead
  of "output branch".
- If GDI should produce a new branch, name the output branch pattern.
- If a branch already exists, say whether to reuse, reset, rebase, or stop and
  report.

## TCC/Input Monitoring Stall

For live AOS verification, add this stop condition:

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, GDI must stop looping on the
goal and run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then GDI reports `human_needed` with the script output and waits for the human.
After the human returns with "finished", return the exact blocker to Foreman.
Foreman owns any binary rebuild and manual TCC regrant handoff.

Keep the copied GDI dispatch plain. Do not prepend `/goal`, and do not add
addressee ceremony. If the work is TCC-sensitive, put the TCC stop branch in the
work card or append a plain suffix to the dispatch, for example:

```text
follow the instructions in docs/design/work-cards/<card>.md; if repo-mode TCC or input tap blocks live verification, run .docks/gdi/scripts/human-needed-tcc-reset and stop with human_needed
```

The GDI helper is stop-only: it prints the human-needed blocker and does not
write hook markers, reset permissions, open Settings, or start AOS.

## Bad Assumptions To Prevent

- Do not read router changed-file counts as dirty worktree state.
- Do not reset to `origin/main` before reading a work card that may only exist
  on a feature branch.
- Do not use a successor-Foreman handoff as a work card.
- Do not let a validation card become a doc rewrite unless explicitly assigned.
- Do not self-accept architecture or product-priority findings; report them to
  Foreman.

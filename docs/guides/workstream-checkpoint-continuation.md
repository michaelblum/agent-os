# Guide: Workstream Checkpoint Continuation

Use this recipe after a local slice has been reviewed, accepted, and
checkpointed. The goal is to keep an active workstream moving without making
the human choose between obvious coordinator options such as "publish now" or
"route the next local slice."

## Default Rule

Do not ask the human to choose between publication and continuation while a
reversible local next step exists.

Publication is the default only when the source card, issue, branch policy, or
human explicitly asks for external review or GitHub mutation, or when the
workstream is complete and no useful local next slice remains. Otherwise, keep
the checkpoint local and route the next bounded step.

## Inputs

Inspect enough local state to make the choice:

- current branch, HEAD, dirty status, and branch diff against the workstream
  base;
- accepted work card, completion report, and acceptance evidence;
- `./aos dev recommend --json` output for the current diff;
- live readiness when the next meaningful proof depends on AOS runtime state;
- external publication policy from the work card, issue, or user instruction;
- concrete gaps named by the accepted note, test result, prototype output, or
  review.

## Decision Ladder

1. If the accepted work lacks bounded local evidence, run or inspect that
   evidence first.
2. If the accepted diff is uncommitted and scoped, commit the checkpoint before
   routing adjacent work.
3. If acceptance state, synthesis docs, or work-card status is stale, update it
   in the same branch with a small docs checkpoint.
4. If the accepted work exposes one concrete deterministic correction, route a
   correction card to the next local implementation session.
5. If the accepted work exposes one concrete implementation or docs follow-up
   that does not need human-only state, route that next local slice.
6. If the next meaningful proof is a supervised live run, route it explicitly
   when readiness is available. If permissions, credentials, or a
   human-operated external surface are missing, emit a human-needed packet with
   the exact recovery path.
7. If no local correction, implementation, docs, or supervised proof step
   remains, classify the branch as publication-ready and state that external
   publication is the next gate.

## Completion Report Review

When a local completion report arrives, the review authority should use this
procedural pass before accepting or routing follow-up work:

1. Recompute local state with `git status --short --branch`, the relevant
   branch refs, and the diff against the assigned base. Do not rely only on the
   report's file count or cleanliness claim.
2. Read the assigned work card, changed files, and reported evidence. Include
   any dirty local diff in the review instead of discarding or ignoring it.
3. Classify the result:
   - accept when the card goal is met, scope boundaries hold, local evidence is
     reproducible, and no blocking review finding remains;
   - route correction when the goal is partly met but one bounded defect or
     missing proof blocks acceptance;
   - block when the next step requires human permission, credentials,
     external publication, runtime permissions, or product judgment.
4. After acceptance, run the no-neutral-acceptance ladder in this guide.
   Acceptance must end in a local checkpoint, routed next slice, supervised
   proof or human-needed packet, or named external gate.

## Local Integration Gate

Fast-forwarding an accepted work branch into local `main` is a reversible local
checkpoint, not external publication. It is appropriate when all are true:

- the branch is accepted against the current `origin/main` or another intended
  integration base;
- the worktree is clean except for deliberate, reviewed checkpoint edits;
- `git merge --ff-only <branch>` succeeds from local `main`;
- the active work card, issue, or human instruction does not require PR review
  before local integration.

Stop before local integration when the accepted branch needs a PR-first policy,
has unresolved base drift, contains unrelated dirty changes, or leaves multiple
plausible local follow-ups whose ordering affects product behavior.

After local integration, report the exact local and remote relationship, such
as `main...origin/main [ahead N]`. Do not treat a local fast-forward as
permission to push, create or update a PR, mutate issues, or delete remote
branches.

## Publication Gate

External publication means push, PR creation, issue mutation, remote comment,
or any provider-visible result route. Do not perform it merely because a branch
is clean.

Use publication as the next action only when at least one is true:

- the active work card or issue explicitly requires external review;
- the human asked to push, open a PR, update an issue, or publish externally;
- the workstream has reached its stated local exit criteria and all remaining
  next steps are external review, merge, or stakeholder decision;
- a relay packet or result route explicitly allows and requires the external
  mutation.

When publication is blocked only by missing permission, stop with a concrete
human-needed packet. Do not present publication versus continuation as a
generic preference question.

## Branch Hygiene Gate

Delete or retire feature branches only after their publication state is known.
Local cleanup is procedural only when one of these is true:

- the accepted branch has been merged or fast-forwarded into the publication
  target and the remote target has also been updated;
- the branch is superseded by a named replacement branch or correction card;
- the human explicitly asked for branch cleanup.

Otherwise, keep the branch as an audit handle and name branch retirement as a
remaining external hygiene decision.

## Output Shape

End the coordinator turn with one of these states:

- accepted checkpoint plus next work card or dispatch copied;
- accepted checkpoint plus supervised proof packet or human-needed recovery
  path;
- correction routed with the exact finding;
- publication-ready checkpoint with the exact external gate named.

Avoid vague endings such as "publish or continue." If several local next slices
are plausible, choose the smallest reversible one that reduces risk or makes
the next decision more evidence-backed.

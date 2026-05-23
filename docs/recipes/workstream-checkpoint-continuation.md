# Recipe: Workstream Checkpoint Continuation

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
   correction card to GDI.
5. If the accepted work exposes one concrete implementation or docs follow-up
   that does not need human-only state, route that next local GDI card.
6. If the next meaningful proof is a supervised live run, route an Operator
   packet when readiness is available. If permissions, credentials, or a
   human-operated external surface are missing, emit a human-needed packet with
   the exact recovery path.
7. If no local correction, implementation, docs, or supervised proof step
   remains, classify the branch as publication-ready and state that external
   publication is the next gate.

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

## Output Shape

End the coordinator turn with one of these states:

- accepted checkpoint plus next work card or dispatch copied;
- accepted checkpoint plus Operator packet or human-needed recovery path;
- correction routed with the exact finding;
- publication-ready checkpoint with the exact external gate named.

Avoid vague endings such as "publish or continue." If several local next slices
are plausible, choose the smallest reversible one that reduces risk or makes
the next decision more evidence-backed.

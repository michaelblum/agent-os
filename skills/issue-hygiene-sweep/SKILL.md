---
name: issue-hygiene-sweep
description: >
  Audit open GitHub issues against the AGENTS.md "open is not automatically current"
  rule. Classify each issue as landed, superseded, active, or unclear, and propose
  next steps. Read-only: never closes, comments, labels, or edits issues. User
  decides what to act on.
disable-model-invocation: true
---

# Issue Hygiene Sweep

You are performing a read-only audit of open GitHub issues. Classify every
open issue into one of four buckets, and present an inline conversational
report. Do not close, comment on, label, or edit any issue. The user executes
any mutation.

## Context

`AGENTS.md` says: "An open issue is not automatically current. If work has
landed, close the issue or restate the exact remaining gap before leaving it
open." Open backlog accumulates `Follow-on:`, `Retroactive:`, `Post-demo:`,
and `Meta:` issues that may or may not still be current. This audit gives
the user a repeatable pass.

## Procedure

### Step 0: enumerate open issues

```bash
gh issue list --state open --limit 100 --json number,title,labels,updatedAt
```

### Prescriptive checks (per issue)

For each open issue number `N`:

1. Pull full metadata:
   ```bash
   gh issue view <N> --json title,body,labels,updatedAt,comments,closedAt
   ```

2. Search for merged PRs covering the issue topic:
   ```bash
   gh pr list --state merged --search "<keyword-from-title>"
   ```
   Pick the most distinctive 1–3 word keyword from the issue title.

3. Find commits referencing the issue number:
   ```bash
   git log --all --oneline --grep "#<N>"
   ```

4. Pull linked and cross-referenced PRs:
   ```bash
   gh issue view <N> --json timelineItems
   ```

5. Title-prefix triage. If the issue title starts with any of:
   - `Follow-on:`
   - `Retroactive:`
   - `Post-demo:`
   - `Low Priority:`
   - `Meta:`

   apply extra scrutiny — these are the AGENTS.md target class and are the
   most likely to be stale.

### Signal-only guidance (fuzzy calls)

- Issue body references paths or features that now exist in the tree. Spot-check with `ls`.
- Last update older than two weeks with no activity plus a matching merged PR is a strong landed signal.
- Duplicate topic across two open issues.

### Classification rules

- **landed**: merged PR references the issue, OR body goal visibly shipped
  (created paths exist, feature documented/present).
- **superseded**: newer issue covers the same scope, OR folded into a larger
  workstream issue.
- **active**: recent activity, linked open PR, or clear unresolved gap.
- **unclear**: fuzzy match, conflicting signals, or evidence too weak.

## Error handling

If any command fails (`gh` unauthenticated, network error, issue body
malformed), add the issue to the **unclear** bucket with a one-line note
about the error. Do not abort the sweep.

## Report format

Present the report inline in chat, four sections:

```
## Issue Hygiene Sweep — <date>

Total open issues reviewed: <N>

### Landed (<count>)
- #<N> <title> — <one-line evidence>. Propose: close #<N>, comment with landing
  commit SHA <sha>.

### Superseded (<count>)
- #<N> <title> — superseded by #<M>. Propose: close and link to #<M>.

### Active (<count>)
- #<N> <title> — <one-line evidence>. Leave open.
  Optional: restate remaining gap in one line if the title has drifted:
  "<suggested gap restatement>".

### Unclear (<count>)
- #<N> <title> — <conflicting-signals>. Propose: human read needed, specifically
  <open question>.
```

## Do not

- Never run `gh issue close`, `gh issue comment`, `gh issue edit`,
  `gh issue reopen`, or any issue mutation.
- Never push labels, assignees, or milestones.
- Never auto-promote an unclear item.

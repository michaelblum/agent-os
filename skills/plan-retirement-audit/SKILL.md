---
name: plan-retirement-audit
description: >
  Audit docs/superpowers/plans/*.md against the AGENTS.md retirement-or-supersession
  policy. Classify each plan as landed, superseded, active, or unclear, and propose
  next steps. Read-only: never moves, archives, edits, or deletes files. User decides
  what to act on.
disable-model-invocation: true
---

# Plan Retirement Audit

You are performing a read-only audit of plans under `docs/superpowers/plans/`.
Classify every `.md` file in that directory into one of four buckets, and present
an inline conversational report. Do not move, archive, edit, or delete any file.
The user executes any mutation.

## Context

`AGENTS.md` says: "Before treating grep hits, old paths, or old commands as live,
check for retirement or supersession notes in the nearest subtree docs, active
plans, and open issues." Plans accumulate without a standardized retirement
signal. This audit gives the user a repeatable pass.

## Procedure

For each plan file:

### Prescriptive checks (run in order)

1. Read the file's first 20 lines. Look for explicit `status:` front-matter,
   "supersedes", or "superseded by" prose. Most plans in this repo lack
   standardized front-matter — that's expected. Note and move on.

2. Count checkboxes:
   ```bash
   grep -ci '^- \[x\]' <file>
   grep -c '^- \[ \]' <file>
   ```
   All-checked is a strong landed signal. All-unchecked suggests active or
   never-started.

3. Get the plan's own churn history:
   ```bash
   git log --all --oneline -- <file>
   ```

4. Look for references to the plan across the repo's history — in commit messages and in diffs:
   ```bash
   git log --all --oneline --grep="<filename-stem>"
   git log --all --oneline -S "<filename-stem>"
   ```
   Replace `<filename-stem>` with the plan filename minus its date prefix and
   `.md` extension (e.g. for `2026-04-07-aos-gateway-v1.md`, search
   `aos-gateway-v1`). Filenames without a date prefix: use the full stem.

5. Extract two or three concrete file paths the plan claims to create
   (look for "File Map" sections or `Create:` lines). Spot-check each with
   `ls` — if the created paths exist in the tree, that's a landed signal.

### Signal-only guidance (fuzzy calls)

- Semantic overlap with a newer plan covering the same topic.
- Plan name referenced in recent closed-PR titles.
- Plan goal sentence visibly matches a shipped feature.

### Classification rules

- **landed**: all checkboxes checked AND created paths exist AND referenced in
  landed commits.
- **superseded**: explicit pointer in body, OR a newer plan covers the same scope.
- **active**: mixed checkboxes, recent commit touches on the file, or plan
  referenced in an open issue.
- **unclear**: conflicting signals, or evidence too weak to classify.

## Error handling

If any command fails (file unreadable, git error), add the plan to the
**unclear** bucket with a one-line note about the error. Do not abort the
sweep.

## Report format

Present the report inline in chat, four sections:

```
## Plan Retirement Audit — <date>

Total plans reviewed: <N>

### Landed (<count>)
- `<filename>` — <one-line evidence>. Propose: move to `docs/superpowers/plans/archive/`
  (note: this directory does not exist yet; user creates it on first archive).

### Superseded (<count>)
- `<filename>` — superseded by `<other-filename>`. Propose: archive and add a
  one-line forward pointer in the archived file.

### Active (<count>)
- `<filename>` — <one-line evidence>. Leave in place.

### Unclear (<count>)
- `<filename>` — <conflicting-signals>. Propose: human read needed, specifically
  <open question>.
```

## Do not

- Never run `git mv`, `rm`, `mkdir archive`, or any file mutation.
- Never edit a plan file.
- Never close or comment on GitHub issues (that's the sibling `issue-hygiene-sweep` skill's domain, and even that skill is read-only).
- Never auto-promote an unclear item.

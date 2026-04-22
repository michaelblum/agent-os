# Audit Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two project-local, user-only, read-only audit skills: `skills/plan-retirement-audit/` and `skills/issue-hygiene-sweep/`, per the spec at `docs/superpowers/specs/2026-04-21-audit-skills-design.md`.

**Architecture:** Each skill is a single `SKILL.md` file under `skills/<name>/` containing YAML front-matter (`name`, `description`, `disable-model-invocation: true`) followed by prose instructions that tell the agent: the exact commands to run, the signals to interpret, the four-bucket classification (landed / superseded / active / unclear), and the report template. No code. No runtime. No mutations.

**Tech Stack:** Markdown + YAML front-matter. Tools invoked at runtime by the agent: `gh`, `git`, `grep`, `ls`.

---

## File Structure

- Create: `skills/plan-retirement-audit/SKILL.md` — audits `docs/superpowers/plans/*.md`.
- Create: `skills/issue-hygiene-sweep/SKILL.md` — audits open GitHub issues.

Each file is self-contained. No shared library, no cross-references. Duplication of the "four-bucket report template" between the two is acceptable and preferred over a shared include, because the skill body is read by the agent at invocation time.

---

## Task 1: Confirm local skill convention

**Files:**
- Read: `skills/caveman/SKILL.md` (reference)

- [ ] **Step 1: Inspect existing local skill**

Run:
```bash
head -20 skills/caveman/SKILL.md
```

Confirm the front-matter shape used in this repo:
- Opens with `---`.
- Contains `name: <slug>`.
- Contains `description: >` (can be multi-line).
- Closes with `---`.

- [ ] **Step 2: Confirm the user-only gating key**

The spec specifies `disable-model-invocation: true` as the key that marks a skill user-only (invoked explicitly via `/<name>`, never auto-triggered). If any existing local skill in this repo uses a different key for the same purpose, use that key instead and note the discrepancy. Otherwise use `disable-model-invocation: true`.

Run:
```bash
grep -r "disable-model-invocation\|hidden\|user-only\|explicit" skills/ --include=SKILL.md || true
```

Expected: either a hit confirming the key name, or no hits (in which case use `disable-model-invocation: true` as the spec says).

- [ ] **Step 3: No commit**

This task is a read-only verification. Do not commit anything.

---

## Task 2: Scaffold `plan-retirement-audit` skill

**Files:**
- Create: `skills/plan-retirement-audit/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run:
```bash
mkdir -p skills/plan-retirement-audit
```

Expected: directory created, no output.

- [ ] **Step 2: Write the full SKILL.md**

Create `skills/plan-retirement-audit/SKILL.md` with this exact content:

````markdown
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
   grep -c '^- \[x\]' <file>
   grep -c '^- \[ \]' <file>
   ```
   All-checked is a strong landed signal. All-unchecked suggests active or
   never-started.

3. Get the plan's own churn history:
   ```bash
   git log --all --oneline -- <file>
   ```

4. Look for references to the plan in commit messages across the repo:
   ```bash
   git log --all --oneline -S "<filename-stem>"
   ```
   Replace `<filename-stem>` with the plan filename minus its date prefix and
   `.md` extension (e.g. for `2026-04-07-aos-gateway-v1.md`, search
   `aos-gateway-v1`).

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
````

- [ ] **Step 3: Verify file shape**

Run:
```bash
head -10 skills/plan-retirement-audit/SKILL.md
wc -l skills/plan-retirement-audit/SKILL.md
```

Expected:
- First line is `---`.
- Front-matter contains `name: plan-retirement-audit`, `description:`, and `disable-model-invocation: true`.
- File length between 80 and 140 lines.

- [ ] **Step 4: Commit**

```bash
git add skills/plan-retirement-audit/SKILL.md
git commit -m "feat(skills): add plan-retirement-audit for docs/superpowers/plans sweep"
```

---

## Task 3: Scaffold `issue-hygiene-sweep` skill

**Files:**
- Create: `skills/issue-hygiene-sweep/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run:
```bash
mkdir -p skills/issue-hygiene-sweep
```

Expected: directory created, no output.

- [ ] **Step 2: Write the full SKILL.md**

Create `skills/issue-hygiene-sweep/SKILL.md` with this exact content:

````markdown
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
````

- [ ] **Step 3: Verify file shape**

Run:
```bash
head -10 skills/issue-hygiene-sweep/SKILL.md
wc -l skills/issue-hygiene-sweep/SKILL.md
```

Expected:
- First line is `---`.
- Front-matter contains `name: issue-hygiene-sweep`, `description:`, and `disable-model-invocation: true`.
- File length between 80 and 140 lines.

- [ ] **Step 4: Commit**

```bash
git add skills/issue-hygiene-sweep/SKILL.md
git commit -m "feat(skills): add issue-hygiene-sweep for open-issue triage"
```

---

## Task 4: Dry-run sanity check

**Files:**
- Read: `skills/plan-retirement-audit/SKILL.md`
- Read: `skills/issue-hygiene-sweep/SKILL.md`

- [ ] **Step 1: Read both skill bodies end-to-end**

Load each SKILL.md and read the prose. Verify:
- Every command block is a valid shell command.
- No placeholder text (`TBD`, `TODO`, `fill in`).
- The four bucket names match exactly between the two files: `landed`, `superseded`, `active`, `unclear`.
- The report template is plausible — a human could run the commands listed and produce the report.

- [ ] **Step 2: Confirm skill directory layout**

Run:
```bash
ls skills/plan-retirement-audit/ skills/issue-hygiene-sweep/
```

Expected: each directory contains exactly one file, `SKILL.md`.

- [ ] **Step 3: No commit**

This task is a review-only sanity pass.

---

## Task 5: Offer live run on real backlog (optional)

**Files:** none modified.

This task is optional and user-gated. After the skills are committed, ask the
user whether to invoke `/plan-retirement-audit` and/or `/issue-hygiene-sweep`
against the live backlog as a validation run.

- [ ] **Step 1: Ask user**

Message: "Skills committed. Want to run `/plan-retirement-audit` and/or
`/issue-hygiene-sweep` now against the real backlog (~54 plans / ~43 open
issues)? First run doubles as the validation test; if bucket quality is poor
I'll refine the skill bodies."

- [ ] **Step 2: If user says yes — execute**

Invoke the chosen skill(s) by following their SKILL.md procedure. Present the
report inline. Treat any signal-quality issues as feedback and note them for
a follow-up refinement pass (do not mutate the skill in this task).

- [ ] **Step 3: If user says no — skip**

Close the plan. The skills are user-invocable whenever needed.

- [ ] **Step 4: No commit**

This task does not modify any file.

---

## Out of scope

- `scripts/handoff` active-vs-dormant decision. Tracked as a separate task in
  the session todo list.
- Archive directory (`docs/superpowers/plans/archive/`) creation.
- Automated issue closure or plan archival.
- CI integration or scheduled runs.

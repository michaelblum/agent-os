# Audit Skills Design

**Date:** 2026-04-21
**Status:** draft, pending implementation plan

## Goal

Two project-local, user-only skills that audit agent-os backlog artifacts against the "landed work should be closed or restated" policy in `AGENTS.md`. Both are read-only: they classify items and propose actions; the user executes any mutations.

- `skills/plan-retirement-audit/` — audits `docs/superpowers/plans/*.md` (~54 files).
- `skills/issue-hygiene-sweep/` — audits open GitHub issues (~43 at time of writing).

## Motivation

`AGENTS.md` states:
- "Before treating grep hits, old paths, or old commands as live, check for retirement or supersession notes in the nearest subtree docs, active plans, and open issues."
- "An open issue is not automatically current. If work has landed, close the issue or restate the exact remaining gap before leaving it open."

Manual enforcement has drifted. Open backlog contains many `Follow-on:` / `Retroactive:` / `Post-demo:` issues that may or may not still be current, and plans accumulate without a retirement signal. These skills give the user a repeatable audit pass without committing to automated closure.

## Shared Shape

Both skills share structure:

- **Path:** `skills/<name>/SKILL.md`, project-local (the `skills/` dir already exists).
- **Front-matter:** `disable-model-invocation: true` plus a terse `description`. The user invokes them explicitly via `/plan-retirement-audit` or `/issue-hygiene-sweep`; the agent should not auto-trigger them.
- **Length target:** 60–120 lines each. Enough for signal definitions, prescriptive commands, guidance for fuzzy calls, and a report template.
- **Read-only contract:** skill body explicitly forbids `gh issue close`, `gh issue comment`, `rm`, `git mv`, or any other mutation. All mutation is proposed; the user decides.
- **No arguments.** Full sweep every invocation. Scope is small enough that filters would be premature.
- **Output form:** inline conversational report in four buckets — **landed**, **superseded**, **active**, **unclear**. Each item carries: identifier, verdict, one-line evidence, proposed next step.
- **Heuristic style:** hybrid. Prescriptive commands for cheap, deterministic checks (grep, `gh` metadata queries, path existence). Signal-only guidance for fuzzy calls (semantic overlap, stale titles).
- **Uncertainty handling:** when signals conflict or evidence is weak, item lands in the **unclear** bucket with a note about what a human should look at. Never auto-promote.

## Skill 1: `plan-retirement-audit`

**Purpose:** classify each file in `docs/superpowers/plans/*.md`.

**Prescriptive checks per plan:**

1. Read front-matter and first 20 lines for explicit `status:` fields or "supersedes" / "superseded by" prose. Plans currently lack standardized front-matter, so this step may no-op; skill notes that and moves on.
2. Count checkboxes. `grep -c '^- \[x\]'` vs `grep -c '^- \[ \]'`. All-checked is a strong landed signal; all-unchecked suggests active-or-never-started.
3. `git log --all --oneline -- docs/superpowers/plans/<file>` — plan's own churn history.
4. `git log --all --oneline -S "<filename-stem>"` — references to the plan in commit messages across the repo.
5. Extract file paths the plan claims to create (e.g., `packages/gateway/src/...`) and spot-check two or three exist in the tree.

**Signal-only guidance for fuzzy calls:**

- Semantic overlap with a newer plan covering the same topic.
- Plan name referenced in recent closed-PR titles.
- Plan goal sentence visibly matches a shipped feature.

**Buckets and proposed actions:**

| Bucket | Heuristic | Proposed action |
|--------|-----------|-----------------|
| landed | All checkboxes checked **and** created paths exist **and** referenced in landed commits | Move to `docs/superpowers/plans/archive/` (skill notes that this dir does not yet exist and the user will need to create it on first archive). |
| superseded | Explicit pointer in body, or a newer plan covers the same scope | Archive and add a one-line forward pointer in the archived file. |
| active | Mixed checkboxes, recent commit touches on the file, or plan referenced in an open issue | Leave in place. |
| unclear | Conflicting signals | Flag for human read; skill suggests specific open question. |

## Skill 2: `issue-hygiene-sweep`

**Purpose:** classify each open GitHub issue against the AGENTS.md "open ≠ current" rule.

**Prescriptive checks per issue:**

1. `gh issue view <N> --json title,body,labels,updatedAt,comments,closedAt` — pull metadata.
2. `gh pr list --state merged --search "<keyword from title>"` — did a merged PR cover the work?
3. `git log --all --oneline --grep "#<N>"` — commits referencing the issue number.
4. `gh issue view <N> --json timelineItems` — linked or cross-referenced PRs.
5. Title-prefix triage: `Follow-on:`, `Retroactive:`, `Post-demo:`, `Low Priority:`, `Meta:` are the AGENTS.md target class and get extra scrutiny.

**Signal-only guidance for fuzzy calls:**

- Issue body references paths or features that now exist in the tree.
- Last update older than two weeks with no activity plus a matching merged PR is a strong landed signal.
- Duplicate topic across two issues.

**Buckets and proposed actions:**

| Bucket | Heuristic | Proposed action |
|--------|-----------|-----------------|
| landed | Merged PR references the issue, or body goal visibly shipped (paths exist, feature present in `aos --help` or relevant docs) | Close issue, comment with landing commit SHA. |
| superseded | Newer issue covers same scope, or folded into a larger workstream issue | Close and link to the surviving issue. |
| active | Recent activity, linked open PR, or clear unresolved gap | Leave open. Optionally: restate remaining gap in one line if the title has drifted. |
| unclear | Fuzzy match, conflicting signals | Flag for human read with a specific open question. |

## Non-Goals

- No archive directory scaffolding, auto-close helpers, CI integration, or recurring schedule.
- No cross-skill coordination (plans and issues are audited independently).
- No historical audit log. Output is ephemeral chat content.
- No automated mutation of any kind.

## Error Handling

Skill body instructs the agent to treat tool failures (e.g., `gh` not authenticated, a plan file unreadable) as **unclear** entries with the error noted, rather than aborting the whole sweep.

## Validation

No unit tests — SKILL.md files are prose instructions to the agent. Validation is a live run against the real backlog after scaffolding (the user's "task 2"). First run doubles as the quality test; if bucket quality is poor, the skill body is refined.

## File Layout

```
skills/
  plan-retirement-audit/
    SKILL.md
  issue-hygiene-sweep/
    SKILL.md
```

## Out of Scope for This Spec

- The independent decision on whether `scripts/handoff` is still used or dormant. Tracked separately.

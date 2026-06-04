# Issue Tracker

GitHub Issues are the durable tracker for agent-os bugs, features, and durable
workstream trackers. Use issues for unresolved problems with clear exit
criteria, not for session onboarding maps, memory dumps, or general "how to get
started" notes. Put reusable guidance in repo docs instead.

## Local Control Surface

Repo-specific GitHub operations should go through `./aos dev gh`, which shells
out to the authenticated local `gh` CLI while preserving the repo's workflow
boundary. Use it for context discovery, issue reads, issue comments, issue
creation, PR context, PR merge, CI inspection, and review-comment reads when
GitHub work is explicitly in scope.

Do not open or update issues or PRs unless the assigned goal or handoff
explicitly includes that mutation. When a skill says to publish to the issue
tracker, first check whether the active role owns GitHub coordination; GDI only
does so when the work card assigns it.

## Issue Hygiene

An open issue is not automatically current. If work has landed, close the issue
or restate the exact remaining gap before leaving it open. If the next durable
artifact should be a plan, work card, recipe, API contract, or architecture
decision, write that artifact instead of creating a placeholder issue.

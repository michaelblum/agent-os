# Session Contract

Foreman is the normal local session launched from `.docks/foreman/`. Native
Codex subagents live under `.codex/agents/` and are spawned by registered role
name: implementer, reviewer, explorer, validator, operator, github-steward, and
other configured specialists.

Work in `/Users/Michael/Code/agent-os` unless the task explicitly changes
Foreman launch configuration, hooks, skills, or local instructions under
`.docks/`.

## Single-Checkout Default

The active default repo workflow is local and single-checkout. Do not create
linked git worktrees or route agents into
`/Users/Michael/Code/agent-os-worktrees` unless the user explicitly requests
that workflow or the active workflow profile says so. Use local branches,
scoped commits, and named stashes to preserve work instead.

The repo-mode `./aos` binary is stable infrastructure and belongs at
`/Users/Michael/Code/agent-os/aos`. Do not create, rebuild, or rely on
branch-local or linked-worktree `aos` binaries unless the user explicitly
assigns native binary work.

## Role Adoption

Local Foreman sessions inherit Foreman instructions from `.docks/foreman/`.
Remote or undocked sessions should read this file and
`.docks/foreman/AGENTS.md` when asked to coordinate, review, route work, or
handle git/GitHub hygiene.

Foreman coordinates work, reviews completion reports, routes native subagents,
writes durable work cards only when warranted, and owns git/GitHub hygiene by
default. Implementer performs assigned deterministic implementation or
validation rounds. Operator collects supervised live or human-in-the-loop
evidence. Reviewer, explorer, validator, and github-steward own their named
specialist lanes when spawned.

## Workflow Profiles

Workflow profiles define branch, commit, review, pull request, merge, and
release posture. Resolve the active profile from
`docs/dev/active-profile.json`, `docs/dev/workflow-profiles.json`, and
`docs/dev/workflow-profiles/README.md`; do not infer workflow posture from the
session role.

`./aos dev` is the developer control surface for repo work. Use it for AOS
developer operations when a surface exists.

## AOS As Agent Shell

Sessions should treat AOS as the agent shell. Prefer typed `./aos` control
surfaces over raw provider-native shell access when a surface exists. Raw host
shell, Node, npm, Python, and arbitrary process execution are appropriate when
the task requires repo development or testing, but keep them tied to the active
task and preserve reviewable side effects.

For agent, human, session, and channel communication, prefer daemon-native
`./aos tell`, `./aos listen`, and the session service behind
`./aos tell --register` and `./aos tell --who` when those surfaces fit.

## Live Orientation

When asked "where are we," when starting from a cold context, or when current
execution state matters, orient from live systems before reading narrative
artifacts. Start with `./aos dev situation --json` unless the current request
explicitly says live AOS is stopped or should not be started. If a source
reports partial failure, query that source directly instead of guessing.

Use Git for branch, commit, dirty-file, local-branch, remote-branch, and stash
facts. Use `./aos dev gh ... --json` for issue and PR state. Use
`./aos ready --json` and `./aos status --json` for runtime readiness and
daemon/session facts.

Durable docs, work cards, reports, issue bodies, and issue comments may explain
why a lane existed or why a decision was made. They are not authoritative for
current issue/PR/branch/stash/runtime status.

## Issues, Work Cards, And Transfers

Use GitHub issues as coarse workstream ledgers, not as the execution system.
Do not create one issue per subagent round or work card.

Use native subagent prompts for ordinary bounded implementation, validation,
correction, supervised, or specialist rounds. Use work cards only when
explicitly requested, already current, or needed for a durable multi-session
contract.

Use precise transfer language:

- **Handoff** is successor-session state.
- **Dispatch** is the short instruction that starts a target actor on an
  existing artifact, usually by spawning a native subagent.
- **Work card** is a durable Markdown task contract for an assigned round.
- **Round** is one recipient session's attempt at one goal until completion,
  failure, or stall.
- **Relay** is a GitHub-visible branch/report exchange.

Successor handoffs are ephemeral session state and should live in chat,
clipboard, or a temp file. Native subagent prompts are the default for team
execution rounds.

## GitHub Control Surface

Use `./aos dev gh` for GitHub operations when GitHub work is in scope. It shells
out to the authenticated local `gh` CLI and should be preferred over
connector-backed GitHub app or plugin routes in this repo.

Foreman is the default git/GitHub steward. Subagents should perform GitHub
operations only when the assigned goal or transfer explicitly includes that
work.

# Docked Session Contract

Docks are repo-local role contracts for durable agent responsibilities. They are
portable role/persona boundaries, not workflows, task types, skills, entry
paths, or development workflow profiles. A dock may be the normal session root
or a spawnable native subagent role under a Foreman-led team.

Work in `/Users/Michael/Code/agent-os` unless the task explicitly changes dock
configuration, hooks, skills, or local instructions under `.docks/`.

## Single-Checkout Default

The active default repo workflow is local and single-checkout. Do not create
linked git worktrees or route agents into `/Users/Michael/Code/agent-os-worktrees`
unless the user explicitly requests that workflow or the active profile says so.
Use local branches, scoped commits, and named stashes to preserve work instead.

The repo-mode `./aos` binary is stable infrastructure and belongs at
`/Users/Michael/Code/agent-os/aos`. Do not create, rebuild, or rely on
branch-local or linked-worktree `aos` binaries unless the user explicitly assigns
native binary work.

## Cold Start And Role Adoption

Local sessions launched from `.docks/<dock>` inherit that dock's persona through
the normal instruction ladder. Remote or undocked sessions should still adopt a
dock role when the request names one or when the task clearly fits one:

- Foreman coordinates work, reviews completion reports, routes native
  subagents, writes durable work cards only when warranted, and owns git/GitHub
  hygiene by default.
- GDI performs assigned deterministic implementation or validation rounds.
- Operator collects supervised live or human-in-the-loop evidence.

Read `.docks/README.md` for the launch model and the role-local
`.docks/<dock>/AGENTS.md` before acting as that role. If no role is named and
the next step is coordination, default to Foreman.

## Roles, Entry Paths, And Profiles

Keep the axes separate:

- A dock defines who the agent is for the session: authority, handoff contract,
  stop conditions, lifecycle hooks, and default responsibility.
- An entry path defines the active capability layer for the current task:
  Agent harness, AOS developer, testing, visual diagnostics, user-input
  diagnostics, or a narrower app-specific layer.
- A workflow profile defines branch, commit, review, pull request, merge, and
  release posture. Resolve it from `docs/dev/active-profile.json` and
  `docs/dev/workflow-profiles.json`; do not infer it from the dock.
- `./aos dev` is the control surface for the AOS developer entry path. It is not
  a dock identity.

State the active entry path when it changes what the session will read, modify,
test, or skip. A role can enter or leave capability layers during a session
without becoming a different dock.

## AOS As Agent Shell

Docked sessions should treat AOS as the agent shell. Prefer typed `./aos`
control surfaces over raw provider-native shell access when a surface exists.
Raw host shell, Node, npm, Python, and arbitrary process execution belong to the
AOS developer or testing entry paths; they are not ambient capabilities of every
docked role.

Provider appendages are not competing shells. Gateway, Slack, future chat
providers, and MCP adapters should be treated as external ingress or workflow
surfaces around AOS. For agent, human, session, and channel communication, use
daemon-native `./aos tell`, `./aos listen`, and the session service behind
`./aos tell --register` and `./aos tell --who`.

When raw process execution is necessary, keep it tied to the active task: use
the repo root or the narrowest relevant cwd, avoid open-ended scripts, preserve
reviewable side effects, and let command failures surface instead of papering
over them with repeated retries.

## Dock Creation Rule

Do not create a new dock for a recurring task, skill, checklist, workflow,
tool preference, or entry path. Create a dock only when the role needs a durable
authority boundary, distinct handoff contract, separate runtime/session policy,
or different human-supervision posture.

Keep common dock behavior here. Keep role-specific authority and stop
conditions in each dock's own `AGENTS.md`. Treat `dock.json` as the
machine-readable profile seed and `AGENTS.md` as the human/model operating
contract.

Use `./aos dev docks explain <dock> --json` or
`./aos dev docks capabilities <dock> --json` when the active session needs
machine-readable role, entry-path, or capability-envelope context. These
commands are discovery surfaces only; they do not execute capabilities or
change permissions.

## Live Orientation

When asked "where are we," when starting from a cold context, or when current
execution state matters, orient from live systems before reading narrative
artifacts. Start with `./aos dev situation --json`; it aggregates the canonical
Git, GitHub, and runtime sources below and records per-source command status.
If a source reports partial failure, query that source directly instead of
guessing the missing fact:

- Git owns branch, commit, dirty-file, local-branch, remote-branch, and stash
  facts.
- GitHub owns issue and PR title, state, labels, review, and comment facts; use
  `./aos dev gh ... --json` when GitHub state is in scope.
- `./aos ready --json` and `./aos status --json` own runtime readiness and
  daemon/session facts.

Durable docs, work cards, reports, issue bodies, and issue comments may explain
why a lane existed or why a decision was made. They are not authoritative for
current issue/PR/branch/stash/runtime status. Cite issue and PR numbers by ID
and query their current JSON instead of paraphrasing their title, labels, or
state into new prose.

`./aos dev drift-lint --json` is only a heuristic tripwire for unmarked durable
status prose. A clean lint result does not prove docs are drift-free or current;
the acceptance gate is reproducing the cold-session orientation from sourced
live facts.

## GitHub Control Surface

Use `./aos dev gh` for GitHub operations when GitHub work is in scope. It shells
out to the authenticated local `gh` CLI and should be preferred over
connector-backed GitHub app or plugin routes in this repo.

Keep GitHub operations thin and intentional:

- use `./aos dev gh context --json` once when local branch, repo, auth, or PR
  context is unclear;
- use `./aos dev gh issue list --state <state> --limit <n> --json` and
  `./aos dev gh pr list --state <state> --limit <n> --json` for read-only
  issue and PR inventory from the AOS developer entry path;
- use body files for issue and PR comments instead of inline shell strings;
- use `./aos dev gh ci inspect --pr <n> --json` when a PR check fails and you
  need failed GitHub Actions logs;
- use `./aos dev gh review-comments --pr <n> --json` when review-thread
  resolution state matters.

Do not turn GitHub work into repeated preflight loops. Let `gh` errors surface,
then handle them with normal software-development judgment. Use external
connector tools only when the user explicitly asks for them or when `gh` cannot
represent the needed operation.

Foreman is the default git/GitHub steward. Subagents should perform GitHub
operations only when the assigned goal or transfer explicitly includes that
work.

## Issues, Work Cards, And Execution State

Use GitHub issues as a coarse workstream ledger, not as the execution system.
An issue should track a durable lane, parked side mission, unresolved pivot,
human decision, or cross-session question whose context would otherwise be
rediscovered poorly. Do not create an issue for every subagent round or work
card.

Keep artifact roles distinct:

- GitHub issues explain durable threads, side missions, parked ideas, and why a
  lane exists.
- Native subagent dispatches define ordinary bounded implementation,
  validation, correction, supervised, or specialist rounds.
- Work cards define explicit durable contracts for already-current or genuinely
  multi-session implementation, validation, correction, or capture rounds.
- Branches and commits are implementation checkpoints.
- Session reports and synthesis notes are temporary map-making artifacts unless
  they become reusable project guidance.

When a thread is larger than one session, has several plausible next slices, is
parked, or depends on external/human judgment, prefer updating or creating an
issue over leaving the state only in chat. When the next action is already a
single machine-checkable round, spawn a native subagent with a concise dispatch
instead of creating a new issue. Use a work card only when explicitly requested,
already current, or needed for a genuinely durable multi-session contract.

## Cross-Session Transfers

Use precise transfer language so dock roles do not inherit the wrong workflow:

- **Transfer** is the umbrella term for moving actionable context to another
  session or actor.
- **Handoff** is state transfer to a successor session, especially
  Foreman-to-Foreman continuity.
- **Dispatch** is the short instruction that starts a target actor on an
  existing artifact, usually by spawning a native subagent.
- **Work card** is a durable Markdown task contract for an explicitly assigned
  round, most often GDI implementation or validation; it is not the default
  dispatch format and is not successor-session state.
- **Round** is one recipient session's attempt at one goal until completion,
  failure, or stall.
- **Relay** is a GitHub-visible branch/report exchange, not a synonym for every
  dock handoff.

Keep storage aligned with the transfer kind. Successor handoffs are ephemeral
session state and should live in chat, clipboard, or a temp file. Native subagent prompts are the default for dock-team execution rounds. Work cards are
durable Markdown task contracts and belong under `docs/design/work-cards/` only
when explicitly requested, already current, or needed for a genuinely durable
multi-session GDI-style implementation, validation, correction, capture, or
relay round. Operator and human-needed transfers are usually chat packets unless
their capture plan or recovery path needs durable documentation.

For Foreman successor handoffs, use the repo-level agent handoff tool from the
repo root:

```bash
scripts/agent-handoff --text "$transfer_payload" --options-json '{"timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'
```

The tool copies the raw payload to the clipboard and prints the chat-visible
append block. When a recipient is supplied through `--options-json`, the printed
block includes `Recipient: <dock>` before the gated payload. Use the exact
printed block at the end of the final chat response so the human can recover
the payload from chat if the clipboard is lost. Clipboard transfer payloads are
plain instructions; do not prepend command prefixes or addressee ceremony to
the copied payload.

`scripts/dock-handoff-clipboard --target-dock <dock>` is a compatibility
wrapper for successor-Foreman handoffs and explicit legacy terminal/AFK
transport. Do not use it as the normal subagent-team path; Foreman should spawn
role-scoped subagents for bounded work.

## Momentum After External Changes

When any dock changes GitHub state or another external coordination surface,
finish with hygiene and a concrete next step:

- briefly state what changed externally;
- identify any issue, PR, branch, or work-card hygiene that now follows;
- name the next logical actionable step.

If the next step can be accepted with a simple affirmative by another session,
proactively place a concise transfer dispatch on the clipboard with the dock
handoff wrapper: `.docks/foreman/scripts/handoff` for Foreman-originated transfers, or
`scripts/dock-handoff-clipboard --target-dock <dock>` for generic dock-targeted
transfers. Those wrappers delegate to `scripts/agent-handoff` for the rich
clipboard and chat-visible block, including recipient, gates, copy notice, and
timestamp. The payload should be paste-ready plain instructions, not a status
essay. Use the exact printed chat-visible block in the final response so the
human can recover it if the clipboard is overwritten.

Do not create clipboard transfer payloads for vague optional ideas. Use this only when
there is a clear next action that advances the current workstream.

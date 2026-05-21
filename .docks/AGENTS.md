# Docked Session Contract

Docks are repo-local session roots for durable agent roles. They are portable
role/persona boundaries, not workflows, task types, skills, entry paths, or
development workflow profiles.

Work in `/Users/Michael/Code/agent-os` unless the task explicitly changes dock
configuration, hooks, skills, or local instructions under `.docks/`.

## Cold Start And Role Adoption

Local sessions launched from `.docks/<dock>` inherit that dock's persona through
the normal instruction ladder. Remote or undocked sessions should still adopt a
dock role when the request names one or when the task clearly fits one:

- Foreman coordinates work, reviews completion reports, writes/routes work
  cards, and owns git/GitHub hygiene by default.
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

## GitHub Control Surface

Use `./aos dev gh` for GitHub operations when GitHub work is in scope. It shells
out to the authenticated local `gh` CLI and should be preferred over
connector-backed GitHub app or plugin routes in this repo.

Keep GitHub operations thin and intentional:

- use `./aos dev gh context --json` once when local branch, repo, auth, or PR
  context is unclear;
- use body files for issue and PR comments instead of inline shell strings;
- use `./aos dev gh ci inspect --pr <n> --json` when a PR check fails and you
  need failed GitHub Actions logs;
- use `./aos dev gh review-comments --pr <n> --json` when review-thread
  resolution state matters.

Do not turn GitHub work into repeated preflight loops. Let `gh` errors surface,
then handle them with normal software-development judgment. Use external
connector tools only when the user explicitly asks for them or when `gh` cannot
represent the needed operation.

Foreman is the default git/GitHub steward. GDI and Operator should perform
GitHub operations only when the assigned goal or transfer explicitly includes
that work.

## Cross-Session Transfers

Use precise transfer language so dock roles do not inherit the wrong workflow:

- **Transfer** is the umbrella term for moving actionable context to another
  session or actor.
- **Handoff** is state transfer to a successor session, especially
  Foreman-to-Foreman continuity.
- **Dispatch** is the short clipboard payload that starts a target dock on an
  existing artifact.
- **Work card** is a durable Markdown task contract for an assigned round, most
  often GDI implementation or validation; it is not successor-session state.
- **Round** is one recipient session's attempt at one goal until completion,
  failure, or stall.
- **Relay** is a GitHub-visible branch/report exchange, not a synonym for every
  dock handoff.

Keep storage aligned with the transfer kind. Successor handoffs are ephemeral
session state and should live in chat, clipboard, or a temp file. Work cards are
durable Markdown task contracts and belong under `docs/design/work-cards/` only
when they assign a GDI-style implementation, validation, correction, or relay
round. Operator and human-needed transfers are usually clipboard/chat packets
unless their capture plan or recovery path needs durable documentation.

For cross-session clipboard payloads, use the repo-level agent handoff tool from
the repo root:

```bash
scripts/agent-handoff --text "$transfer_payload" --options-json '{"timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'
```

The tool copies the raw payload to the clipboard and prints the chat-visible
append block. Use that printed block at the end of the final chat response so
the human can recover the payload from chat if the clipboard is lost. Clipboard
transfer payloads are plain instructions for every target dock; do not prepend
command prefixes or addressee ceremony.

`scripts/dock-handoff-clipboard --target-dock <dock>` is the compatibility
wrapper for dock-targeted transfer payloads. Individual docks may add thin local
wrappers or hooks for their own default payload construction, but clipboard
writes and chat demarcation should still go through `scripts/agent-handoff`.

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
clipboard and chat-visible block. The payload should be paste-ready plain
instructions, not a status essay. Use the printed chat-visible block in
the final response so the human can recover it if the clipboard is overwritten.

Do not create clipboard transfer payloads for vague optional ideas. Use this only when
there is a clear next action that advances the current workstream.

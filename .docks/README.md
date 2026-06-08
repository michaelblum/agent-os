# Docks

Docks are repo-local role contracts. Foreman is the normal Codex session root;
GDI, Operator, and Explorer are spawned by Foreman as Codex native subagents for
bounded work.

The old standalone GDI/Operator CLI-session bootstrap is retired. The remaining
`.docks/gdi/` and `.docks/operator/` folders keep canonical role instructions,
reusable skills, runtime recovery helpers, and legacy AFK/terminal metadata
that executable code still reads. They are not normal launch roots.

A dock is not a Workflow. A Workflow is an AOS/domain Subject such as the
Employer Brand Comparative Audit. A dock is only the session boundary that
selects role-local instructions and harness behavior.

## Launch

Start local Foreman sessions from the Foreman dock directory:

```bash
cd .docks/foreman
codex
```

Equivalent:

```bash
codex --cd .docks/foreman
```

Codex discovers Foreman's `AGENTS.md`, dock-local `.codex/config.toml`,
`.codex/hooks.json`, and local hook scripts from that launch root. The native
subagent roster lives in repo-root `.codex/agents/`; repo-root
`.codex/config.toml` and the Foreman launch config both register those same
native agent files. Source edits and tests still belong in
`/Users/Michael/Code/agent-os` unless the task explicitly targets dock
configuration or harness files.

Remote or undocked agents cannot inherit the launch root automatically. They
should adopt the requested dock persona explicitly, read shared
`.docks/AGENTS.md`, then read the role-local `.docks/<dock>/AGENTS.md`. If no
role is named and the task is coordination, review, routing, or git/GitHub
hygiene, use Foreman.

## Instruction Ownership

The active instruction ladder for Foreman and its subagents is:

1. root `AGENTS.md` for repo-wide signage and invariants;
2. shared `.docks/AGENTS.md` for common docked-session contracts;
3. role-local `.docks/<dock>/AGENTS.md` for authority, transfer, and stop
   conditions.

Keep common docked-session behavior in `.docks/AGENTS.md`. Keep role files
focused on that role's authority. Keep procedures that are repeatable across
roles in `docs/guides/`.

Docks do not select the active development workflow profile. Resolve git,
branch, PR, review, and merge posture from `docs/dev/active-profile.json` and
`docs/dev/workflow-profiles.json`, then apply any explicit user override that
is safe for the current session.

## Harness Ownership

Hook mechanics are code-owned. Do not duplicate hook behavior as long-form
markdown instructions.

- `.docks/foreman/.codex/hooks.json` declares Foreman `PreToolUse`, `Stop`,
  `SubagentStart`, and `SubagentStop` hook entry points.
- `.docks/foreman/hooks/*.sh` are thin Foreman-local wrappers.
- `.docks/harness/dock-hook-runner.sh` is the Foreman hook harness for stop
  notices, subagent voice routing, the `PreToolUse` spawn guard, and the
  `SubagentStart` warning/TTS tripwire. Generic/default helper spawns are
  blocked only at `PreToolUse`; `SubagentStart` can warn and suppress voice for
  already-started bad children, but it cannot stop startup in current Codex.
  Foreman must select a registered native role: use `agent_type=<role>` when
  the live spawn tool exposes it, otherwise start the child prompt with
  `Use the custom agent named <role>.`
- `.docks/harness/provider-input-control.sh` and
  `.docks/harness/pty-input-control.sh` are legacy terminal-input helpers kept
  for AFK/live-provider substrates until that stack migrates off warm terminal
  launches.
- `.docks/<dock>/dock.json` and `.docks/dock-defaults.json` own dock metadata,
  capability envelopes, and legacy launch metadata.
- `.docks/<dock>/inbound-contract.json` owns legacy AFK/terminal prompt syntax.
  It is not the normal Foreman-to-GDI or Foreman-to-Operator path.

Use the scripts and JSON files as the source of truth when hook behavior,
provider entry, or dock metadata changes. Markdown should explain ownership and
link to the owning surface, not mirror the implementation.

Stop speech uses the active dock voice policy, including `voice.voice_slot`, and
speaks through `aos say --voice-slot`.

## AOS-First Runtime Control

For live dock operation, `./aos` is the runtime control plane. Use it first for
readiness, status, canvas lifecycle, Agent Terminal launch/inspection, input
routing, and dock communication. Do not inspect or drive live sessions through
raw `curl`, `tmux`, daemon sockets, launchd, or state files unless no suitable
`./aos` command exists, `./aos` itself is under repair, or the assigned task is
explicitly testing the lower-level adapter. In those cases, say why the bypass
is necessary and return to the `./aos` surface as soon as possible.

Inspect profiles with:

```bash
./aos dev docks list --json
./aos dev docks explain foreman --json
./aos dev docks capabilities gdi --json
```

## Transfers

Use precise transfer language so dock roles do not inherit the wrong workflow.

- **Handoff** is successor-session state.
- **Dispatch** is the concise payload that starts a target dock on an existing
  artifact.
- **Work card** is a durable Markdown task contract for an assigned round.
- **Round** is one recipient session's attempt at one goal.
- **Relay** is a GitHub-visible branch/report exchange.

For Foreman successor handoffs, use the Foreman handoff wrapper or a temp file.
Do not route normal subagent-team work through clipboard payloads; spawn the
named role-scoped subagent when the task is bounded enough for subagent
execution.

```bash
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock foreman
```

`scripts/dock-handoff-clipboard --target-dock gdi|operator` remains only for
explicit legacy terminal/AFK transport work while `.docks/<dock>/inbound-contract.json`
is still load-bearing.

Choose durable storage by transfer kind:

| Transfer kind | Normal storage |
| --- | --- |
| Foreman successor handoff | Clipboard/chat or a temp file from `mktemp -t foreman-handoff-XXXXXX.md`; do not commit it. |
| GDI work card | `docs/design/work-cards/<card>.md`, then spawn `gdi` with a concise instruction pointing at the card. |
| Operator run | Spawn `operator` for bounded probes; use a durable work card only when the run needs a capture plan. |
| Specialist subagent probe | Spawn the named subagent directly when the prompt is short and bounded; create a durable work card only when the role needs reusable instructions or evidence capture. |
| Human-needed packet | Clipboard/chat unless the recovery path should become reusable SOP. |

Do not store successor-Foreman handoffs under `docs/design/work-cards/`. If a
handoff needs durable follow-up, create a separate work card, issue, PR comment,
or design note and reference it from the handoff.

## Canonical Docks

- `foreman/` coordinates work, reviews completion reports, writes/routes work
  cards, and owns git/GitHub hygiene by default.
- `gdi/` defines the deterministic implementation subagent role
  and reports exact evidence. It does not own next-work selection, PRs, issues,
  or branch hygiene unless the goal explicitly assigns that work.
- `operator/` defines the Operator subagent role. It performs bounded supervised human-in-the-loop evidence collection
  and locator review. It does not own implementation or git/GitHub scope unless
  the transfer explicitly assigns that responsibility.
- Repo-root `.codex/agents/` defines the native subagent roster. The Foreman
  dock remains the team/persona/hooks entrypoint and registers those root agent
  configs for dock-launched sessions. The roster is extensible; each config
  must declare its own model and reasoning effort instead of inheriting
  Foreman's coordination posture.

For non-trivial GDI work, Foreman should prefer a Markdown work card under
`docs/design/work-cards/`, registered role selection for `gdi`, and a concise
child prompt:

```text
Use the custom agent named gdi. Follow the instructions in docs/design/work-cards/<card>.md
```

Before broad fan-out, Foreman must smoke one spawned child and verify the
registered role selection plus visible model/effort or developer-instruction
identity evidence from the intended agent config. Use `./aos dev subagent plan`
before the smoke and `./aos dev subagent validate-proof` on the captured
transcript after it. Arbitrary role prose is not role selection; use
`agent_type=<role>` when available or the exact prefix
`Use the custom agent named <role>.` Failed proof blocks fan-out.

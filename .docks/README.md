# Docks

Docks are repo-local Codex session roots for personas, roles, or alternate
session profiles.

A dock is not a Workflow. A Workflow is an AOS/domain Subject such as the
Employer Brand Comparative Audit. A dock is only a way to launch Codex with
role-local instructions, hooks, and config.

For cold starts, resolve the dock role before choosing implementation,
verification, or git workflow behavior. Root `AGENTS.md` points new agents here
so local and remote sessions share the same role vocabulary.

## Launch

For a local Codex session, open a terminal in the dock directory and start
Codex:

```bash
cd .docks/gdi
codex
```

Equivalent:

```bash
codex --cd .docks/gdi
```

Codex then discovers the dock's `AGENTS.md`, `.codex/hooks.json`, and any other
project-local configuration from that launch root. Source edits and tests still
belong in the real repo root unless the dock says otherwise.

Remote or undocked agents cannot inherit the launch root automatically. They
should adopt the requested dock persona explicitly, read shared
`.docks/AGENTS.md`, then read the role-local `.docks/<dock>/AGENTS.md`. If no
role is named and the task is coordination, review, routing, or git/GitHub
hygiene, use Foreman.

The active instruction ladder is root `AGENTS.md`, shared `.docks/AGENTS.md`,
then the role-local `<dock>/AGENTS.md`. Keep common docked-session behavior in
`.docks/AGENTS.md` and keep each role file focused on that role's authority,
handoff contract, and stop conditions.

Docks do not select the active development workflow profile. Resolve git,
branch, PR, review, and merge posture from `docs/dev/active-profile.json` and
`docs/dev/workflow-profiles.json`, then apply any explicit user override that is
safe for the current session.

Each dock keeps a small Stop hook that delegates to
`.docks/harness/dock-hook-runner.sh`. The runner reads dock identity and voice
policy from `<dock>/dock.json`. Do not add startup hooks for git posture,
session registration, or context snapshots; those facts go stale inside long
Codex sessions.

`<dock>/dock.json` is validated as an AOS Dock Profile. It declares the dock's
durable role, default entry path, allowed entry paths, capability manifest, and
allowed capability classes. Inspect profiles with:

```bash
./aos dev docks list --json
./aos dev docks explain foreman --json
./aos dev docks capabilities gdi --json
```

This profile is descriptive, not an executor. It keeps the portable dock
metaphor inspectable while leaving task judgment and command failures with the
active agent.

Dock-local skills use the conventional uppercase `SKILL.md` entrypoint under
the owning dock, for example `.docks/foreman/skills/session-transfer/SKILL.md`.
The `.docks` path is what makes the skill repo-native and role-local; provider
or user-managed global skill registries are separate housekeeping surfaces.

Dock-local inbound message contracts live at
`.docks/<dock>/inbound-contract.json`. They are the AOS-owned source for
provider-specific entry syntax such as Codex `/goal ` prefixes, context reset
commands, stale-goal recovery commands, allowed payload shapes, and rejected
prompt shapes. Foreman and other senders should format dispatches through the
target dock contract instead of hardcoding provider slash syntax in role docs.

Dock-local bespoke Stop behavior belongs in executable scripts named
`pre-stop.sh` or `post-stop.sh` under the dock's `hooks/` directory. The shared
runner invokes those scripts if present and still emits Codex hook success JSON.

Dock voice policy cascades from `.docks/dock-defaults.json` into each
`<dock>/dock.json`. The shared default enables voice and filters dock speech to
English premium/enhanced female voices. Dock configs should only override
dock-specific metadata such as `voice.voice_slot`, explicit non-default
`voice.gender`, and the fixed `stop_notice`.

`voice.voice_slot` is a 1-based ordinal over the final filtered speakable AOS
voice bucket. The shared runner uses it for bounded Stop-hook notices with
`aos say --voice-slot <n> --language en --quality-tier premium --quality-tier
enhanced`. Stop hooks do not call `aos voice bind` or `aos voice final-response`
for their fixed notices. Stop notices do not require a resolved session id; the
timeout budget should leave enough room for macOS speech synthesis to return.

## Config Split

Keep repo-scoped `.codex/config.toml` generic and lean. Put persona-specific
model effort, goal-mode behavior, TUI status lines, and terminal titles in the
dock-local `.codex/config.toml` files.

Dock status lines should lead with the dock identity, such as `foreman:`,
`gdi:`, or `operator:`. Codex does not currently expose documented per-segment
status-line color settings, so use identity text and terminal titles as the
stable visual differentiators.

## Clipboard Transfers

When a dock session produces a message intended for another session, use the
repo handoff tool instead of letting Stop hooks infer clipboard content from
chat text:

```bash
scripts/agent-handoff --text "$transfer_payload" --options-json '{"timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'

# Compatibility wrappers for dock-targeted transfer payloads:
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock gdi
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock foreman
printf '%s' "$transfer_payload" | scripts/dock-handoff-clipboard --target-dock operator
```

`scripts/agent-handoff` copies only the transfer payload. It then prints that
same raw payload between `----- BEGIN HANDOFF -----` and `----- END HANDOFF
-----` markers for chat, followed by `(copied to clipboard)` and a
human-readable local timestamp. When `recipient` is supplied in
`--options-json`, the printed chat block starts with `Recipient: <dock>`.
Clipboard transfer payloads are plain instructions for every dock.
Individual docks may wrap the generic tool for their own default payload
construction, but formatting and clipboard behavior should stay centralized in
the generic tool.

Use the transfer kind to choose durable storage:

| Transfer kind | Normal storage |
| --- | --- |
| Foreman successor handoff | Clipboard/chat or a temp file from `mktemp -t foreman-handoff-XXXXXX.md`; do not commit it. |
| GDI work card | `docs/design/work-cards/<card>.md`, with a concise clipboard dispatch pointing at the card. |
| Operator run | Clipboard/chat unless a durable capture plan is explicitly needed. |
| Human-needed packet | Clipboard/chat unless the recovery path should become reusable SOP. |

Do not store successor-Foreman handoffs under `docs/design/work-cards/`. If a
handoff needs durable follow-up, create a separate work card, issue, PR comment,
or design note and reference it from the handoff.

## Canonical Docks

- `foreman/` is the coordination, review, work-card routing, git/GitHub, and
  workstream hygiene role. Foreman tracks who is doing what, where the work
  lives, what is complete, what remains blocked, and when commits, pushes, PRs,
  or issue updates are appropriate.
- `gdi/` is the Goal-Driven Implementation role. GDI consumes assigned
  transfer dispatches, implements the assigned deterministic slice, runs
  verification, and reports exact results. GDI does not own next-work selection,
  PRs, issues, or branch hygiene unless a goal explicitly says so.
- `operator/` is the Operator supervised human-in-the-loop execution and
  locator review role. Operator inspects live surfaces, records bounded human
  judgments, observes stop conditions, and reports evidence. Operator does not
  own git/GitHub or implementation scope unless a transfer explicitly says so.

For non-trivial GDI work, Foreman should prefer a Markdown work card under
`docs/design/work-cards/` plus a concise GDI dispatch such as:

```text
follow the instructions in docs/design/work-cards/<card>.md
```

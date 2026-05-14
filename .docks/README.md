# Docks

Docks are repo-local Codex session roots for personas, roles, or alternate
session profiles.

A dock is not a Workflow. A Workflow is an AOS/domain Subject such as the
Employer Brand Comparative Audit. A dock is only a way to launch Codex with
role-local instructions, hooks, and config.

## Launch

Open a terminal in the dock directory and start Codex:

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

The active instruction ladder is root `AGENTS.md`, shared `.docks/AGENTS.md`,
then the role-local `<dock>/AGENTS.md`. Keep common docked-session behavior in
`.docks/AGENTS.md` and keep each role file focused on that role's authority,
handoff contract, and stop conditions.

Each dock owns its own hook scripts under `<dock>/hooks/`. Those scripts are
thin wrappers around `.docks/harness/dock-hook-runner.sh`, with dock identity
and policy in `<dock>/dock.json`. Do not route dock hooks through a shared
`.docks/hooks/` script; role behavior should stay local to the dock metadata
and optional pre/post scripts that install it.

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

Dock-local bespoke behavior belongs in executable scripts named
`pre-session-start.sh`, `post-session-start.sh`, `pre-stop.sh`, or
`post-stop.sh` under the dock's `hooks/` directory. The shared harness invokes
those scripts if present and still emits Codex hook success JSON.

Dock voice policy cascades from `.docks/dock-defaults.json` into each
`<dock>/dock.json`. The shared default enables voice and filters dock speech to
English premium/enhanced female voices. Dock configs should only override
dock-specific metadata such as `voice.voice_slot`, explicit non-default
`voice.gender`, and the fixed `stop_notice`.

`voice.voice_slot` is a 1-based ordinal over the final filtered speakable AOS
voice bucket. The shared harness uses it for bounded Stop-hook notices with
`aos say --voice-slot <n> --language en --quality-tier premium --quality-tier
enhanced`. Session-start registration may still bind a voice for true session
speech, but Stop hooks should not call `aos voice bind` or
`aos voice final-response` for their fixed notices. Stop notices do not require
a resolved session id; the timeout budget should leave enough room for macOS
speech synthesis to return.

## Config Split

Keep repo-scoped `.codex/config.toml` generic and lean. Put persona-specific
model effort, goal-mode behavior, TUI status lines, and terminal titles in the
dock-local `.codex/config.toml` files.

Dock status lines should lead with the dock identity, such as `foreman:`,
`gdi:`, or `operator:`. Codex does not currently expose documented per-segment
status-line color settings, so use identity text and terminal titles as the
stable visual differentiators.

## Clipboard Handoffs

When a dock session produces a message intended for another session, use the
repo handoff helper instead of letting Stop hooks infer clipboard content from
chat text:

```bash
printf '%s' "$handoff_message" | scripts/dock-handoff-clipboard --target-dock gdi
printf '%s' "$handoff_message" | scripts/dock-handoff-clipboard --target-dock foreman
printf '%s' "$handoff_message" | scripts/dock-handoff-clipboard --target-dock operator
```

The helper copies only the target-session payload. It then prints that same raw
payload for chat, followed by `(copied to clipboard)` and a human-readable local
timestamp. Handoffs are plain instructions for every dock; the helper removes
one accidental `/goal ` prefix if present.

## Canonical Docks

- `foreman/` is the coordination, review, work-card routing, git/GitHub, and
  workstream hygiene role. Foreman tracks who is doing what, where the work
  lives, what is complete, what remains blocked, and when commits, pushes, PRs,
  or issue updates are appropriate.
- `gdi/` is the Goal-Driven Implementation role. GDI consumes assigned
  handoffs, implements the assigned deterministic slice, runs verification, and
  reports exact results. GDI does not own next-work selection, PRs, issues, or
  branch hygiene unless a goal explicitly says so.
- `operator/` is the Operator supervised human-in-the-loop execution and
  locator review role. Operator inspects live surfaces, records bounded human
  judgments, observes stop conditions, and reports evidence. Operator does not
  own git/GitHub or implementation scope unless a handoff explicitly says so.

For non-trivial GDI work, Foreman should prefer a Markdown work card under
`docs/design/work-cards/` plus a thin GDI handoff such as:

```text
follow the instructions in docs/design/work-cards/<card>.md
```

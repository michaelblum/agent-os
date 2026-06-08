# Work Card: AFK Warm Dock TUI Reuse Live Sentinel V0

**Status:** Superseded for no-command warm-dock validation

## Transfer Classification

- Recipient: Implementer
- Transfer kind: validation-only Implementer round, used only as part of
  `docs/design/work-cards/operator-afk-visible-milestone-proof-v0.md`
- Single next goal: confirm that a normal Implementer work-card pointer can be accepted
  in the existing warm Implementer Codex terminal after `/clear`, without editing files
  or running commands.
- Required start ref: `origin/main` with this work card present.
- Output expectation: no source, docs, config, provider store, telemetry,
  gateway, GitHub, branch, PR, or async routing mutation. Return a concise chat
  report only.

## Supersession Notice

The V1 pointer-shaped prompt was superseded for no-command warm-dock
validation because Implementer had to inspect this file before seeing the no-command
boundary. That inspection required a shell command in the tested session and
created a contract exception.

For future no-command warm-dock validation, use the inline Implementer payload declared
in the implementer native prompt contract instead of sending this file pointer as
the `` prompt:

```text
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.
```

This file remains as historical context for why the pointer-shaped sentinel is
not strict enough for validation where the no-command boundary must be visible
before Implementer takes any action.

## Context

This is not an implementation task. It exists to avoid the older live-proof
prompt shape that asked Implementer to "reply exactly" and caused repeated completion
loops in stale goal mode.

The old V1 inbound payload was a durable pointer:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

When the human enters it in the Implementer Codex CLI, the provider entry should be:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

## Instructions

1. Do not edit files.
2. Do not run shell commands.
3. Do not read provider transcript files.
4. Do not open GitHub, create branches, commit, push, or route follow-up work.
5. Return one concise report saying this validation-only sentinel was accepted
   in the current Implementer terminal.

If you see stale goal behavior, repeated completion, or any instruction that
would make this more than a validation-only sentinel, stop and report the exact
blocker. The human should recover with clear the stale prompt state, then `/clear`, before
using the Implementer terminal for unrelated work.

## Completion Report Required

Return:

- whether this session started from `/clear` followed by a `` work-card
  pointer;
- whether any file, command, provider store, GitHub, or runtime mutation was
  performed, expected answer: no;
- any stale-goal or repeated-completion behavior observed.

# Work Card: AFK Warm Dock TUI Reuse Live Sentinel V0

**Status:** Ready for Operator-routed live validation

## Transfer Classification

- Recipient: GDI
- Transfer kind: validation-only GDI round, used only as part of
  `docs/design/work-cards/operator-afk-visible-milestone-proof-v0.md`
- Single next goal: confirm that a normal GDI work-card pointer can be accepted
  in the existing warm GDI Codex terminal after `/clear`, without editing files
  or running commands.
- Required start ref: `origin/main` with this work card present.
- Output expectation: no source, docs, config, provider store, telemetry,
  gateway, GitHub, branch, PR, or async routing mutation. Return a concise chat
  report only.

## Context

This is not an implementation task. It exists to avoid the older live-proof
prompt shape that asked GDI to "reply exactly" and caused repeated completion
loops in stale goal mode.

The expected inbound payload is a durable pointer:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

When the human enters it in the GDI Codex CLI, the provider entry should be:

```text
/goal follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

## Instructions

1. Do not edit files.
2. Do not run shell commands.
3. Do not read provider transcript files.
4. Do not open GitHub, create branches, commit, push, or route follow-up work.
5. Return one concise report saying this validation-only sentinel was accepted
   in the current GDI terminal.

If you see stale goal behavior, repeated completion, or any instruction that
would make this more than a validation-only sentinel, stop and report the exact
blocker. The human should recover with `/goal clear`, then `/clear`, before
using the GDI terminal for unrelated work.

## Completion Report Required

Return:

- whether this session started from `/clear` followed by a `/goal` work-card
  pointer;
- whether any file, command, provider store, GitHub, or runtime mutation was
  performed, expected answer: no;
- any stale-goal or repeated-completion behavior observed.

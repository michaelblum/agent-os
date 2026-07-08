---
name: aos-desktop
description: Use AOS as Playwright CLI for desktop app, window, and native AX work. Trigger when a task needs desktop discovery, app/window control, native AX press/focus/set-value, or a decision about unsupported desktop verbs.
---

# AOS Desktop

Use this skill for desktop/app/window/native AX work. AOS already controls the
desktop through direct `./aos` primitives; start from command help and the
capability map.

## Start

1. Read `docs/api/aos-capabilities.md` for the current desktop control matrix.
2. Inspect `./aos help graph --json`, `./aos help see --json`, and
   `./aos help do --json` before relying on arguments.
3. Discover windows with `./aos graph windows`.
4. Save perception with `./aos see capture <target> --save --workspace <id>`.
5. Prefer saved refs or direct native AX selectors over coordinates.

## Desktop Actions

- Use `./aos do activate --pid <pid> --dry-run` before app activate.
- Use `./aos do quit --pid <pid> --dry-run` before app quit.
- Use `./aos do hide --pid <pid> --dry-run` and `./aos do unhide --pid <pid> --dry-run` before app visibility changes.
- Use `./aos do raise --pid <pid> [--window id] --dry-run` before window raise.
- Use `./aos do move --pid <pid> --to <x,y> [--window id] --dry-run` before window move.
- Use `./aos do resize --pid <pid> --to <w,h> [--window id] --dry-run` before window resize.
- Use `./aos do close --pid <pid> --window <id> --dry-run` before window close.
- Use `./aos do minimize --pid <pid> --window <id> --dry-run` before window minimize.
- Use `./aos do maximize --pid <pid> --window <id> --dry-run` and `./aos do restore --pid <pid> --window <id> --dry-run` before window maximize/restore.
- Window close/minimize/maximize/restore commands require exact `--pid` and
  `--window` identity.
- Use `./aos do menu --pid <pid> --path File,Save --dry-run` before invoking
  an app menu path.
- Use `./aos do press|focus|set-value <ref> --workspace <id> --dry-run` for
  stable native AX saved refs.
- Use `./aos do press|focus|set-value --pid <pid> --role <role> ... --dry-run`
  for direct native AX current matching.

## Boundaries

- Window fullscreen, Space switching, and Mission Control are not first-class
  semantic commands in this slice.
- `./aos do tell <app> <script>` is a lower-level scripting escape hatch, not a
  substitute for claiming a semantic desktop verb exists.
- Coordinates and keyboard fallback act on current focus; use them only when
  the task authorizes fallback and the target is proven current.

## Stop

Stop when a target is off-Space, minimized, stale, missing native identity,
requires a semantic verb AOS does not expose, or needs live TCC/input proof not
authorized by the task.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/design/aos-desktop-playwright-cli-map.md`

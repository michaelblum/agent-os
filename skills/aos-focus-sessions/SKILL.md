---
name: aos-focus-sessions
description: Use AOS focus channels as the desktop session model. Trigger when a task needs named window or browser sessions, parallel-agent isolation, channel cleanup, or browser/app target lifecycle decisions.
---

# AOS Focus Sessions

> **Transition pointer — `aos-sovereign-capability-substrate-v1`:** ADR 0043
> and `../../docs/dev/aos-sovereign-capability-authority-v1.json` own future
> complete managed-tool grammar. This skill still teaches current focus/session
> behavior; browser-ref and tab absence below is burn-down baseline, not
> implemented remodel capability.

Focus channels are the AOS session model for tracked windows and browser
targets. Use them when an agent needs a stable name for a target across capture,
action, and recapture.

## Start

1. Inspect `./aos help focus --json`.
2. For browser sessions, require `./aos browser companion status --json` to
   report `current`. Use `./aos focus list` before creating a new channel.
3. Create a window channel with `./aos focus create --id <name> --window <wid>`.
4. Launch an AOS-owned session through already-installed system Chrome with
   `--target browser://new` (the companion installs no browser binary), attach directly
   with `--target browser://attach --cdp <url>`, or use the exact reviewed
   extension form `--target browser://attach --extension=chrome`.
   Extension attach requires the reviewed extension in an ordinary system-
   Chrome `Default` or `Profile N` profile, with a bounded ordinary version
   directory and matching manifest beneath the pinned extension id.
5. Capture through the channel when that preserves the intended scope.

## Parallel-Agent Rules

- Use explicit channel ids and workspace ids; do not rely on hidden current
  state.
- Remove browser channels with
  `./aos focus remove --id <name> --backend browser`; use
  `--backend native` for native channels. Browser removal closes launched
  sessions but only detaches attached external browsers.
- Do not reuse another agent's channel unless the task explicitly coordinates
  ownership.

## Browser Boundary

Managed focus session records are the sole AOS browser authority. They bind a
random session generation to the exact immutable companion runtime. The
creation intent, private workspace, and starting lease are durable before
worker spawn; a real child spawn event latches possible cleanup authority.
launched path explicitly selects system Chrome and admits only http, https,
data, or about initial/navigation URLs; local file URLs are unsupported. The
extension handshake may launch or focus Chrome and open its bridge page, but
the browser/profile/tabs remain external and user-owned. Persistent launched
sessions use only an AOS-owned per-generation profile. Browser ref actions and
tab management are not part of this checkpoint.

## Stop

Stop when the channel is cleanup-required, companion state is not current, the
channel points at a missing window, extension profile evidence is unavailable
or blocked, or a
parallel-agent ownership conflict exists.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0041-managed-playwright-companion-runtime.md`
- `manifests/commands/source/aos/15-focus.json`

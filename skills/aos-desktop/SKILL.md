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
5. Choose an exact current Observation Ref or Locator when available; current
   saved-handle and native AX selector forms remain implementation plumbing.

## Desktop Actions

- Use `./aos do activate --pid <pid> [--dry-run]` for app activation.
- Use `./aos do quit --pid <pid> [--dry-run]` for app quit.
- Use `./aos do hide --pid <pid> [--dry-run]` and `./aos do unhide --pid <pid> [--dry-run]` for app visibility.
- Use `./aos do raise --pid <pid> [--window id] [--dry-run]` for window raise.
- Use `./aos do move --pid <pid> --to <x,y> [--window id] [--dry-run]` for window move.
- Use `./aos do resize --pid <pid> --to <w,h> [--window id] [--dry-run]` for window resize.
- Use `./aos do close --pid <pid> --window <id> [--dry-run]` for window close.
- Use `./aos do minimize --pid <pid> --window <id> [--dry-run]` for window minimize.
- Use `./aos do maximize --pid <pid> --window <id> [--dry-run]` and `./aos do restore --pid <pid> --window <id> [--dry-run]` for maximize/restore.
- Window close/minimize/maximize/restore commands require exact `--pid` and
  `--window` identity.
- Use `./aos do menu --pid <pid> --path File,Save [--dry-run]` for an app menu path.
- Use `./aos do press|focus|set-value <ref> --workspace <id> [--dry-run]` for
  the current saved native AX handle implementation.
- Use `./aos do press|focus|set-value --pid <pid> --role <role> ... [--dry-run]`
  for direct native AX current matching.
- `--dry-run` is an optional mechanical preview, never action permission.

## Registered Operation Control

Use `./aos operation list|inspect|status|recent` to inspect registered
privileged work and `cancel|kill|kill-owner` for exact owner-scoped control.
Task, agent, client, project, target, skill, and capability labels are filters;
they never create or widen the mechanically authenticated owner boundary.

`./aos operation stop-all --barrier-generation <n> --json` is the public
same-UID host-wide control. It is available to agents and humans through the
same plane and needs no caller-intent assertion. Read the current generation
with `./aos operation barrier-status --json`; reopen only after the receipt
shows the registered stop snapshot and current registered set are reconciled.

The separate AOS internal status item is always-available break-glass: it turns
red only while a registered recording operation is active, opens the richer
operation Canvas, and can request stop-all. It is not a consumer status-item
lease. The status-opened Canvas may inspect all registered operations and use
stop-all only; ordinary Canvas controls require a live captured peer and remain
owner-scoped.

## Native Status-Item Host Leases

For product-neutral native status-item leases, use the `status-item` family.
The descriptor is data-only: owner, item id, revision, label/help text, primary
action id, and optional simple native menu items. AOS owns the monochrome
fallback visual and derives the anchor from the real native item. Product
commands stay in the consumer after typed event receipt.

```bash
./aos status-item validate --descriptor ./status-item.json --json
./aos status-item register --descriptor ./status-item.json --json --follow
./aos status-item update --descriptor ./status-item-v4.json \
  --owner io.example.app --item status \
  --generation 1 --current-revision 3 --json
./aos status-item inspect --owner io.example.app --item status \
  --generation 1 --descriptor-revision 4 --json
./aos status-item invoke --owner io.example.app --item status \
  --action activate --generation 1 --descriptor-revision 4 \
  --action-sequence 1 --dry-run --json
./aos status-item invoke --owner io.example.app --item status \
  --action activate --generation 1 --descriptor-revision 4 \
  --action-sequence 1 --json
```

Keep `register --follow` alive as the lease owner and event stream. Its first
line is the registration result and the initial `ready` event follows. Use its
exact identity from separate update/inspect/invoke processes. Update requires
the live generation/current revision and a strictly newer descriptor; use the
returned revision afterward. Inspect also returns the current action sequence.
Optional dry-run reports it without consuming it; effectful invoke consumes it before
delivery. Descriptor updates preserve the sequence, while a new generation
resets it. Stale values fail closed. End the follow process to clean up the
lease; there is no separate subscribe or cleanup command. Do not scrape AX menu
extras or click coordinates when a hosted AOS status item exposes semantic
identity.

Events are limited to initial `ready`, observed `bounds_changed` and
`topology_changed`, primary/secondary activation, and native menu selection.
Every event carries the current AOS-derived anchor and bounds. Action events
also carry the admitted sequence; use generation plus action sequence for
replay detection. The fallback icon is slot/AX continuity, not the consumer's
final visual; status visual projection and a rich status palette/popover are
separate dependent slices.

## Boundaries

- Window fullscreen, Space switching, and Mission Control are not first-class
  semantic commands in this slice.
- Arbitrary third-party menu extras remain unsupported; `status-item` controls
  only AOS-hosted owner-scoped leases.
- The Milestone 2 operation plane registers microphone capture first. Do not
  claim that every legacy daemon resource is already listed or controllable.
- Do not simulate fullscreen, Space switching, or Mission Control with
  `./aos do key`, AppleScript, or coordinates unless the caller chose that
  lower-level fallback.
- `./aos do tell <app> <script>` is a lower-level scripting escape hatch, not a
  substitute for claiming a semantic desktop verb exists.
- Coordinates and keyboard fallback act on current focus; require exact current
  target/state mechanics.

## Stop

Stop when a target is off-Space, minimized, stale, missing native identity,
requires a semantic verb AOS does not expose, or needs live TCC/input proof
outside the caller's requested scope.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md`
- `docs/design/aos-desktop-playwright-cli-map.md`

---
name: aos-desktop-world-authoring
description: Author, validate, mount, inspect, profile, and replay data-only AOS DesktopWorld scene cartridges. Trigger when an agent needs a 3D desktop scene, drag or aim-and-commit gestures, radial menus, scene telemetry, or detachable engine DevTools.
---

# AOS DesktopWorld Authoring

Use the product-neutral scene engine. A cartridge supplies declarative data;
AOS owns the persistent multi-display stage, hit regions, gesture lifecycles,
rendering, telemetry, and DevTools.

## Start

1. Read `docs/api/toolkit/scene.md`.
2. Inspect `./aos help scene --json` before relying on arguments.
3. Start from one neutral cartridge under `packages/toolkit/scene/examples/`.
4. Validate before opening a daemon connection:

```bash
./aos scene cartridge validate ./my-cartridge --json
```

## Cartridge Rules

- Keep `cartridge.json`, `scene.json`, `animations.json`, and
  `interactions.json` data-only.
- Declare exact implementation IDs, resource budgets, canonical asset paths,
  and SHA-256 digests.
- Use local raster or binary glTF assets only.
- Never add scripts, functions, symlinks, remote runtime URLs, product prompts,
  audio, or unbounded values.

## Mount And Update

Hold one owner/resource lease and send strict NDJSON:

```bash
printf '%s\n' \
  '{"op":"mount","document":{...}}' \
  '{"op":"subscribe","events":["gesture"]}' \
  '{"op":"inspect"}' \
  '{"op":"close"}' \
  | ./aos scene --stage desktop-world/main \
      --owner example.consumer --resource companion/main --follow
```

Use revisioned `transact` operations for structural changes and bounded
`signal` operations for frame-adjacent numeric state. Use `play`, `suspend`,
and `resume` instead of remounting an unchanged resource.

## Gestures

- Conventional movement: bind `drag` to `translate`.
- Aim-and-commit: bind `drag` to `aim_commit`. The object stays fixed while
  the stock arrow follows the pointer; release starts the declared line or
  wormhole route, while Escape cancels at the unchanged origin.
- Drop resolution: bind `drag` to `drop`.
- Radial menu: use the stock `radial` recognizer and bounded item/style data.
- Treat phases as `start`, `update`, `end`, and `cancel`. Do not infer product
  meaning from the recognizer itself.

## Inspect And Profile

```bash
./aos scene list --json
./aos scene inspect --resource companion/main --json
./aos scene perf --resource companion/main --json
./aos scene monitor --resource companion/main --follow --json
```

Snapshots are content-free engine facts. Monitoring is connection-scoped and
stops when the process exits.

Open the AOS-owned inspector anywhere on the desktop:

```bash
./aos scene devtools open --resource companion/main --json
./aos scene devtools status --json
./aos scene devtools update --session <session-id> --expected-revision <n> \
  --tab performance --recording on --json
./aos scene devtools transfer --session <session-id> --expected-revision <n> \
  --host-kind external --host-id <canvas-id> --json
./aos scene devtools close --session <session-id> --json
```

A consumer may transfer the same session into an existing AOS canvas through
the CLI or typed toolkit SDK. The daemon suspends the old host before activating
the new one; consumers must not fork the telemetry model or create a second
interactive host.

## Replay

Test gesture logic without live TCC input:

```bash
./aos scene replay \
  --events packages/toolkit/scene/fixtures/aim-commit.ndjson \
  --json
```

Replay requires monotonic sequences and complete gesture lifecycles. Use it
for deterministic regression fixtures, not as a claim of live visual parity.

## Stop And Clean Up

- Send `close` for a normal lease shutdown.
- Process disconnect releases its resource and native hit regions.
- Close every DevTools session you opened.
- Stop when a requested implementation is not registered, a budget is
  exceeded, or the task requires product semantics that belong in a consumer.

## References

- `docs/api/toolkit/scene.md`
- `docs/api/aos.md`
- `shared/schemas/scene-event-v1.schema.json`
- `shared/schemas/desktop-world-devtools-stage-v1.schema.json`
- `packages/toolkit/scene/examples/`

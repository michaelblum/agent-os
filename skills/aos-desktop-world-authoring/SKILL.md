---
name: aos-desktop-world-authoring
description: Author, validate, run, inspect, profile, and replay AOS DesktopWorld scenes through data-only cartridges or reviewed trusted extensions. Trigger for multi-display 3D scenes, gestures, radial menus, scene telemetry, extension review, or detachable engine DevTools.
---

# AOS DesktopWorld Authoring

Use AOS as the product-neutral desktop scene engine. Consumers own their model,
visual behavior, and product semantics. AOS owns the global multi-display
stage, render lifecycle, gesture mechanics, telemetry, and DevTools.

## Choose The Boundary

1. Use a **data-only cartridge** when registered AOS implementations can render
   the scene. This is the default and least privileged route.
2. Use a **reviewed trusted extension** when custom Three.js geometry, shaders,
   effects, or per-frame behavior are required. Treat it as same-realm
   executable code. Validate, review, digest-pin, and explicitly install it.
3. Use **isolated standalone WebGL** when executable content is not trusted to
   share the AOS renderer realm. Do not disguise untrusted code as an extension.

Read the focused contracts before editing:

- `docs/api/toolkit/scene-authoring.md`
- `docs/api/toolkit/scene-runtime.md`
- `docs/api/toolkit/scene-extensions.md`
- `docs/api/toolkit/scene-devtools.md`
- `docs/api/toolkit/radial-menu-authoring.md`

## Scaffold A Cartridge

Start in a new local workspace and scaffold one deterministic template:

```bash
mkdir -p ./scene-work
aos scene cartridge scaffold ./scene-work/companion \
  --id companion/main --template aim-and-commit --json
aos scene cartridge validate ./scene-work/companion --json
```

Available templates are `spinning-object`, `conventional-drag`,
`aim-and-commit`, and `radial-menu`. Scaffolding never overwrites, installs,
mounts, authorizes, or executes content. Keep these files data-only:

```text
cartridge.json
scene.json
animations.json
interactions.json
assets/
```

Declare exact implementation IDs, finite budgets, canonical relative asset
paths, and SHA-256 digests. Do not add scripts, functions, links, traversal,
remote runtime URLs, product prompts, audio, or unbounded values.

## Use The Typed Session

Use `createDesktopWorldSceneSession()` from
`@agent-os/toolkit/scene/runtime`. Inject the product adapter's public
`SceneFollowTransportFactory`; the toolkit never opens a private socket,
discovers a runtime path, or starts a daemon.

The session exposes `open`, `mount`, `transact`, `signal`, `play`, `suspend`,
`resume`, `inspect`, `subscribe`, `remove`, `close`, and `snapshot`. It
serializes operations, commits state only after the authoritative all-display
result, ignores prior-generation events, and closes idempotently.

Run the complete fake-transport workflow against the scaffold:

```bash
node packages/toolkit/scene/examples/session-lifecycle.mjs \
  --cartridge ./scene-work/companion
```

That example mounts, subscribes, transacts, signals, plays, inspects, replays,
forces one disconnect, remounts canonical state once, rejects a stale event,
does not replay the uncertain operation, and releases the lease.

Recovery is intentionally narrow. One recoverable transport or stage loss may
reconnect and restore the last committed document, subscriptions, and
suspension state. Transient signals, animation plays, and uncertain in-flight
operations are never replayed. A second failure is terminal. Read the exact
code sets from `DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES` and
`DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES`; do not maintain another list.

## Work In One Desktop Plane

Ordinary authors use one global DesktopWorld coordinate plane. AOS segments it
across physical displays, derives the per-display cameras, settles all segment
results, and emits one authoritative result. A resource may straddle displays
or animate between them without display-local reconciliation in consumer code.

Only advanced native-input and anchor operations expose explicit display or
native geometry. Never infer native coordinates from DesktopWorld-local bounds.

## Choose Gesture Semantics

- Bind `drag` to `translate` for conventional object movement.
- Bind `drag` to `aim_commit` to keep the object fixed while the stock arrow
  follows the pointer and commit a route on release.
- Bind `drag` to `drop` for destination resolution without product semantics.
- Bind a stock `radial` recognizer for a bounded radial menu. Give every item a
  canonical `id` and a short `label`; AOS uses the label for native semantic
  identity while events expose only the item ID.

Use `aos-radial-menu-authoring` when the menu needs logical action projection,
custom 3D item art, hover behavior, activation transitions, or workbench
editing. Do not invent a second radial descriptor inside the scene cartridge.

The recognizer lifecycle is `start`, `update`, `end`, and `cancel`. Escape,
pointer loss, topology change, and owner loss cancel through AOS. Cartridges
provide bounded IDs, semantic labels, and visual data; consumers map resulting
ID-only events to product actions.

## Scaffold And Review An Extension

Create a neutral trusted extension only when a cartridge is insufficient:

```bash
aos scene extension scaffold ./scene-work/renderer \
  --owner example.consumer --id companion-renderer \
  --template basic-three --json
aos scene extension validate ./scene-work/renderer --json
```

Review `extension.json` and `projection.js`. Confirm exact owner, extension ID,
implementation IDs, scene ABI, pinned Three.js revision, resource budgets,
signal handling, animation handling, context-loss behavior, and idempotent GPU
disposal. The neutral reference is
`packages/toolkit/scene/extension-examples/basic-three/`.

Install only the independently reviewed digest:

```bash
validation_json="$(aos scene extension validate ./scene-work/renderer --json)"
reviewed_digest="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.digest)' "$validation_json")"
aos scene extension install ./scene-work/renderer \
  --expected-digest "$reviewed_digest" --json
aos scene extension list --json
```

Validation compiles but does not execute the projection body. Installation is
the explicit executable-authority boundary. Never install a digest that was
not the exact independently reviewed artifact.

## Inspect, Profile, And Monitor

Use content-free machine-readable facts:

```bash
aos scene list --json
aos scene inspect --resource companion/main --json
aos scene perf --resource companion/main --json
aos scene monitor --resource companion/main --follow --json
```

Monitoring is connection-scoped. Stop it by terminating its owning client.
Snapshots exclude scene parameters, product text, prompts, audio, and desktop
content.

## Open And Transfer DevTools

Open the AOS-owned detachable inspector and retain its revision:

```bash
opened="$(aos scene devtools open --resource companion/main --json)"
session_id="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.session.session.id)' "$opened")"
revision="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.session.session.revision))' "$opened")"
updated="$(aos scene devtools update --session "$session_id" \
  --expected-revision "$revision" --tab performance --recording on --json)"
revision="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.session.session.revision))' "$updated")"
aos scene devtools status --session "$session_id" --json
```

Transfer the sole interactive host only to an existing AOS canvas:

```bash
aos scene devtools transfer --session "$session_id" \
  --expected-revision "$revision" --host-kind external \
  --host-id example/inspector-host --json
```

The daemon suspends the prior host before activating the next one. Never fork
the telemetry model or create a second interactive host.

## Replay Without Live Input

Replay the deterministic gesture fixture without TCC or stage mutation:

```bash
aos scene replay \
  --events packages/toolkit/scene/fixtures/aim-commit.ndjson --json
```

Replay requires monotonic sequences and complete gesture lifecycles. It proves
event-model behavior, not live visual parity.

## Recover Or Stop

1. Read `session.snapshot()` after any operation failure.
2. Let the typed session spend its one recovery attempt. Do not add a second
   consumer retry loop.
3. If the session becomes `faulted`, close it and surface its redacted failure.
4. Recreate the session only after product policy revalidates ownership and the
   canonical document.
5. Stop immediately for implementation mismatch, budget rejection, malformed
   transport data, or an extension digest change.

Close everything explicitly:

```bash
aos scene devtools close --session "$session_id" --json
rm -rf -- ./scene-work
```

Always call `session.close()` in consumer cleanup. Closing a DevTools view does
not close its daemon-owned session, and deleting a scaffold does not release a
mounted scene lease.

## References

- `docs/api/toolkit/scene.md`
- `docs/api/toolkit/scene-authoring.md`
- `docs/api/toolkit/scene-runtime.md`
- `docs/api/toolkit/scene-extensions.md`
- `docs/api/toolkit/scene-devtools.md`
- `docs/api/toolkit/radial-menu-authoring.md`
- `docs/api/aos.md`
- `packages/toolkit/scene/examples/session-lifecycle.mjs`
- `shared/schemas/scene-event-v1.schema.json`
- `shared/schemas/desktop-world-devtools-stage-v1.schema.json`

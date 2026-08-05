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

Read the focused `scene-authoring.md`, `scene-runtime.md`,
`scene-extensions.md`, and `scene-devtools.md` contracts under `docs/api/toolkit/`.

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
mounts, authorizes, or executes content. Keep `cartridge.json`, `scene.json`,
`animations.json`, `interactions.json`, and `assets/` data-only.

Declare exact implementation IDs, finite budgets, canonical relative asset
paths, and SHA-256 digests. Do not add scripts, functions, links, traversal,
remote runtime URLs, product prompts, audio, or unbounded values.

## Use The Typed Session

Use `createDesktopWorldSceneSession()` from
`@agent-os/toolkit/scene/runtime`. Inject the product adapter's public
`SceneFollowTransportFactory`; the toolkit never opens a private socket,
discovers a runtime path, or starts a daemon.

The session exposes `open`, `mount`, `transact`, `signal`, `play`, `suspend`,
`resume`, `inspect`, `assertFramebuffer`, `subscribe`, `remove`, `close`, and
`snapshot`. It
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

For a trusted-extension visual assertion, declare a bounded
`framebufferProofs` descriptor in the reviewed extension and call
`session.assertFramebuffer("surface-visible")`. The name selects a digest-bound
predicate; never accept runtime coordinates, colors, thresholds, or arbitrary
pixel reads. The aggregate is the complete bounded public proof result; private
per-segment results and pixel reads stay outside it, not as ADR 0040 gaps.
Temporary marker art belongs to the consumer fixture and leaves with it.

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

Only advanced native-input and anchor operations expose explicit display or native geometry. Never infer native coordinates from DesktopWorld-local bounds.

## Choose Gesture Semantics

- Bind `drag` to `translate` for conventional object movement.
- Bind `drag` to `aim_commit` to keep the object fixed while the stock arrow
  follows the pointer and commit a route on release.
- Bind `drag` to `drop` for destination resolution without product semantics.
- Bind a stock `radial` recognizer for a bounded radial menu. Give every item a
  canonical `id` and short `label`; the label supports native accessibility and
  inspection while the product-neutral gesture event carries the item ID.

The recognizer lifecycle is `start`, `update`, `end`, and `cancel`. Escape,
pointer loss, topology change, and owner loss cancel through AOS. Cartridges
provide bounded IDs, semantic labels, and visual data; current consumers map
the ID-only event projection to product actions during migration.

Declare hover and captured cursor presentation independently as `inherit` or `hidden`; a custom `visual` ID requires `hidden` and cannot alter input ownership.
`captured: none` remains shorthand for hidden with no custom art. The full contract is in `docs/api/toolkit/scene-authoring.md`.

## Bind Native Sheet Feedback

Put data-only native programs in `nativeEffectPrograms` and bind them by
`programId`. Use bounded `nativeEffects` for separate pointer and gesture-phase
feedback; singular `nativeEffect` remains compatibility-only and cannot coexist.
Use `lifecycle: { kind: "gesture" }` only with a gesture-start binding when the
same installed native sheet must follow canonical drag updates until end or
cancel. Pair it with an end-phase timed binding for a release animation.
The reviewed extension must declare `aos.scene.desktop_frame_texture` and
`aos.scene.native_sheet_effect`; follow the validated [`aos.scene.effect.program` recipe](references/native-effect-program.md).

AOS owns pixels, Metal, topology, clocks, validation, compilation, budgets, and
disposal. Consumers own the bounded graph, trigger, and parameter values. Use
only the operators and limits exported by `@agent-os/toolkit/scene/authoring`.
V2 programs can deform the existing tessellated native sheet and use bounded
unlit or Lambert material lighting. Use
`compileSceneNativeEffectProgramGLSL()` when a trusted Three.js surface needs a
preview of the same validated graph; it does not grant capture or native
authority. Programs cannot contain source code or read pixels. The legacy
`aos.scene.effect.desktop-ripple` ID is decode-only compatibility; do not use it
for new authoring. Native effects are best-effort visuals; never depend on one
for product state or authority.

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

Validation does not execute the projection body. Install only the exact independently reviewed digest.

When an extension owns a line or wormhole interaction route, implement the
exact synchronous `inspectInteractionRoute()` hook so AOS DevTools and
`scene monitor` can observe it. Preserve the returned `active`, `kind`,
`progress`, and global DesktopWorld `origin`/`destination` facts without
omission or redaction. Product text, audio, source objects, object IDs, and
arbitrary diagnostics stay outside this bounded contract, not as ADR 0040 gaps.

## Inspect, Profile, And Monitor

Use the current machine-readable projections:

```bash
aos scene list --json
aos scene inspect --resource companion/main --json
aos scene perf --resource companion/main --json
aos scene monitor --resource companion/main --follow --json
```

Monitoring is connection-scoped. Stop it by terminating its owning client. The bounded snapshot carries its declared engine facts.
Product text, prompts, audio, extension content, and desktop pixels remain outside this DevTools contract.

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

The daemon suspends the prior host before activation; never fork its telemetry
model or create a second interactive host.

## Replay Without Live Input

Replay the deterministic gesture fixture without TCC or stage mutation:

```bash
aos scene replay \
  --events packages/toolkit/scene/fixtures/aim-commit.ndjson --json
```

Replay requires monotonic sequences and complete gesture lifecycles. It proves
event-model behavior, not live visual parity.

## Recover Or Stop

1. Read `session.snapshot()` and let the session spend its one recovery attempt.
2. If it becomes `faulted`, close it and surface the bounded typed failure.
3. Recreate it only after revalidating ownership and the canonical document.
4. Stop for implementation mismatch, budget rejection, malformed transport,
   or an extension digest change.

Close everything explicitly:

```bash
aos scene devtools close --session "$session_id" --json
rm -rf -- ./scene-work
```

Always call `session.close()` in consumer cleanup. Closing a DevTools view does
not close its daemon-owned session, and deleting a scaffold does not release a
mounted scene lease.

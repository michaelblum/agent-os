# Scene DevTools

Use `@agent-os/toolkit/scene/devtools` for bounded DesktopWorld resource
inspection, performance facts, deterministic replay, and the host-neutral AOS
inspector view.

## Machine-Readable Inspection

```bash
aos scene list --json
aos scene inspect --resource companion/main --json
aos scene perf --resource companion/main --json
aos scene monitor --resource companion/main --follow --json
aos scene replay \
  --events packages/toolkit/scene/fixtures/aim-commit.ndjson --json
```

`createDesktopWorldSceneClient()` provides matching dependency-injected APIs.
The package never discovers a socket, starts a daemon, or owns a panel.
One-shot reads use bounded headless sessions, wait for a daemon-received stage
snapshot correlated to their own explicit refresh request, and close in
`finally`. Concurrent inspectors and stage-local sequence resets cannot make a
cached snapshot appear fresh.

Replay requires monotonic owner/resource sequences and complete gesture
lifecycles. It reports counts, resource IDs, and final numeric positions only.
It performs no rendering, stage mutation, or live TCC input.

## Detachable Inspector

```bash
opened="$(aos scene devtools open --resource companion/main --json)"
session_id="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.session.session.id)' "$opened")"
revision="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.session.session.revision))' "$opened")"

aos scene devtools update --session "$session_id" \
  --expected-revision "$revision" --tab performance --recording on --json
aos scene devtools status --session "$session_id" --json
aos scene devtools close --session "$session_id" --json
```

Use the revision returned by each mutation before another `update` or
`transfer`. A transfer target is an existing AOS canvas host. The daemon
suspends the old host before activating the next, so one session never has two
interactive views.

```bash
aos scene devtools transfer --session devtools-example \
  --expected-revision 2 --host-kind external \
  --host-id example/inspector-host --json
```

## Snapshot And Instrumentation

`createDesktopWorldDevToolsStageProbe()` projects the existing render loop into
`aos.desktop-world.devtools.stage.v1`. It reports bounded displays, resources,
nodes, hit regions, affordances, gestures, routes, allocations, interactions,
performance, events, counters, and last-error facts. Text, prompts, audio,
scene parameters, and desktop content are excluded.

At each inspection read, the daemon adds `native.desktopFrameWarm` and
`native.nativeEffect`. Warm state contains only `state`, `displayCount`,
`generation`, and a redacted `errorCode`. Native-effect state contains only its
lifecycle state, bounded attempt/admission/presentation/completion/disposal/
failure counters, active runtime/sheet/texture counts, the last native
trigger-to-presentation latency, retained buffer/texture/view counts, and the canonical owner/resource/program
identity and digest of the last admitted execution. The browser does not author
or cache these native facts. A consumer that needs low-latency desktop textures
should wait for warm `state: "ready"` before triggering an effect. Reading these
facts does not start capture or request permission, and the snapshot never
contains pixels, handles, paths, parameters, coordinates, frame timestamps, or
desktop facts.
Browser-authored snapshots omit the native field until the daemon adds
authoritative facts. `presentedCount` advances only after every display segment
reports an actual Metal drawable presentation, not when presentation is merely
requested.

`lastExecution` is `null` until an effect is admitted. Data-only programs report
their canonical program ID, revision, and digest; built-in compatibility effects
leave those three program fields `null`. After a completed disposal,
`activeInstanceCount`, `activeSheetCount`, `retainedBufferCount`,
`retainedTextureCount`, and `retainedViewCount` are zero,
while `disposedCount` advances exactly once.

Displays include DesktopWorld-local `bounds` and optional native global
`nativeBounds`. Native input translation must require `nativeBounds`; it must
not infer native geometry from local bounds.

The probe owns no scheduler. Disabled instrumentation performs no stage read,
timer, RAF, or per-frame allocation. Enabled non-recording snapshots are
throttled. Recording is opt-in and bounded to 240 performance samples and 256
events. `createDesktopWorldGpuTimer()` reuses a four-query pool and returns
`null` when GPU timing is unavailable.

`buildDesktopWorldMinimapLayout()` maps the global display topology, nodes, and
hit regions into a bounded viewport. `createDesktopWorldDevToolsView()` renders
World, Resources, Interactions, Performance, and Events without creating a
timer or animation loop.

The daemon owns revisioned `DesktopWorldDevToolsSession` state and one host
lease. Detached panels, consumer-hosted views, Render Performance, Spatial
Telemetry, and Surface Inspector consume the same model; they do not create
another sampler.

## Cleanup

Stop `scene monitor` by terminating its owning client process. Close every
DevTools session explicitly. Closing a view without closing its daemon session
does not transfer session ownership.

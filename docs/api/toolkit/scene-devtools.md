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

`scene perf` uses the resource only to confirm that the requested resource is
mounted. Render metrics are not resource-attributed: the result has
`scope: "stage-segment"` and one `displays[]` entry per authoritative display,
each with `displayId`, `displayIndex`, `scope`, and its own scalar
`performance` facts. Rates, timings, DPR, and backing dimensions are never
summed across displays.

Replay requires monotonic owner/resource sequences and complete gesture
lifecycles. It reports counts, resource IDs, and final numeric positions only.
It performs no rendering, stage mutation, or live TCC input.

## Trigger A Reviewed Effect Without System Input

Use the exact committed resource revision and reviewed program identity to
exercise a consumer-authored native-effect binding without posting a macOS
pointer or keyboard event:

```bash
aos scene effect trigger \
  --owner example.consumer \
  --resource companion/main \
  --affordance companion-body \
  --interaction companion-fast-travel \
  --phase pointer_down \
  --origin 400,300 \
  --current 400,300 \
  --pointer-session proof-1 \
  --sequence 1 \
  --expected-revision 2 \
  --expected-program example.effect.ripple \
  --expected-program-revision 1 \
  --expected-program-digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --dry-run \
  --json
```

The effectful form validates the same exact binding facts itself. Keep
`--dry-run` only when a non-consuming preview is useful; it is not a prerequisite
for action. The daemon resolves the current input generation and fails closed if
the stage, resource revision, affordance, interaction, or program identity
changed. Start, update, end, and cancel phases share the supplied
pointer-session identity.

This command triggers the native-effect lifecycle only. It does not synthesize
macOS input, move the pointer, press Escape, change scene placement, or prove
the operating system's physical-input path. Do not substitute `aos do click`,
`aos do drag`, or `aos do key` in unattended scene-effect tests.

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
`aos.desktop-world.devtools.stage.v2`. It reports bounded displays, resources,
nodes, hit regions, affordances, gestures, routes, allocations, interactions,
per-display stage-segment performance, events, counters, and last-error facts.
There is no world-wide or resource-wide performance scalar. Product text,
prompts, audio, arbitrary extension state, undeclared engine parameters, and
desktop pixels remain outside the bounded DevTools observation contract.

Every segment snapshot is bound to its exact `canvasGeneration`,
`topologyGeneration`, display ID/index, and refresh `request_id`. The daemon
rejects stale, unknown, or duplicate receipts and publishes a new snapshot only
after the complete current display set converges. A topology change invalidates
any partial receipt.

At each inspection read, the daemon adds `native.desktopFrameWarm` and
`native.nativeEffect`. Warm state contains only `state`, `displayCount`,
`generation`, and a bounded typed `errorCode`.
Native-effect state contains only its
lifecycle state, bounded attempt/admission/presentation/completion/disposal/
failure counters, active runtime/sheet/texture counts, the last native
trigger-to-presentation latency, last backing-pixel count and percentage, last
triangle count, retained buffer/texture/view counts, and the canonical owner/resource/program
identity and digest of the last admitted execution. The browser does not author
or cache these native facts. A consumer that needs low-latency desktop textures
should wait for warm `state: "ready"` before triggering an effect. Reading these
facts does not start capture or request permission. Undeclared engine
parameters, coordinates, frame timestamps, pixels, private handles and paths,
product state, and captured desktop facts remain outside this bounded snapshot.
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

Topology receipt changes close the renderer telemetry identity synchronously.
The probe accepts no frame or refresh snapshot until the queued segment camera,
backing, interaction, and work configuration has settled for the new canvas,
topology, display ID, and display index.

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

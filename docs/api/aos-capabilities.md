# AOS Capabilities

Consumer-facing capability map for AOS as a Playwright-like desktop
automation CLI: direct commands, stable help/JSON output, progressive
discovery, and capability-oriented workflows. This map is grounded in
`./aos help --json` and source command manifests under
`manifests/commands/source/aos/`.

Use this file to choose the right direct `./aos` lane before opening large
schema docs or historical design notes.

> **Authority pointer — `aos-sovereign-capability-substrate-v1`:**
> ADR 0043 owns the target direction; ADR 0044 accepts its M2 mechanical
> immediate-peer and verified-ancestry owner root, generation-bound external
> dispatch, exact registered-set same-effective-UID host control, bounded
> retained-receipt replay with expected-barrier CAS, distinct artifact/claim
> recovery dispositions, nine-machine prior-generation recovery, and split
> resource clauses.
> The file
> `../dev/aos-sovereign-capability-authority-v1.json` classifies current
> contradictions. This map describes implemented capability. Milestone 2 now
> exposes `aos operation`, daemon IPC, internal status-item break-glass, and the
> internal operation Canvas for registered adapters; it does not make every
> legacy daemon resource a registered operation or publish a TypeScript/Python
> package SDK. Fixed browser grammar and direct-capture priming remain burn-down
> baseline.
> The closed 32-row inventory and accepted M2 authority bindings are
> `../dev/aos-privileged-capability-ledger-v1.json`. Its exact 32 rows bind
> source primitives, authored CLI form/route ownership, public reachability,
> proof execution class, and separately typed target milestones. It adds no
> command, IPC method, SDK method, native primitive, permission behavior, or
> runtime guarantee.

## Authority And Observation Posture

AOS runs with ambient authority supplied by the user through the agent host and
bounded by macOS TCC. It adds no auth token, allowlist, risk label, mandatory
approval, mandatory dry-run, Work Record permission, default core redaction, or
assistant/product restriction. Exact identity, stale/ambiguous rejection,
timeouts, resource bounds, exactly-once admission, cleanup, typed errors, and
receipts remain required mechanical correctness.

Facts and channels admitted by each bounded public observation contract are raw
and fidelity-first; facts outside that contract remain outside it. Masking,
redaction, persistence, retention, and model projection are explicit
caller-owned transforms. Gate is an explicit neutral structured-input
primitive, not action authorization. Work Records are optional evidence/history,
not permission grants.

The public semantic target types are:

- Observation Ref: ephemeral `(state_id, ref)`; a stale pair rejects.
- Locator: a declarative query re-resolved at action time; zero matches return
  missing and multiple matches return ambiguous.

Target Handle V1 applies this split to active browser, canvas, native AX, and
saved-workspace routes. Browser capture generations bind a path-free managed
runtime/session identity, but browser ref actions remain outside the fixed
managed operation surface and fail closed. Canvas/native Locators are state-
free and require exactly one current match.

The dated command/capability inventory under `docs/dev/reports/` is frozen
historical evidence, not a complete current inventory or a consumer API
contract. Use the current command manifests and this API documentation for
current capability discovery.

The current vocabulary decision is documented in
`docs/design/aos-desktop-command-vocabulary-decision.md`: do not add a new
`aos desktop` noun or `desktop:<target>` namespace in this slice.

## User-Facing State Model

AOS exposes several kinds of state. Use these nouns consistently and keep their
boundaries separate when reading help, command output, Work Records, or saved
evidence:

- Session: a live communication or tool identity used by `tell`, `listen`,
  gates, voice assignment, browser targets, and session metadata. A session is
  not a saved workspace, not a daemon-held current workspace, and not durable
  evidence by itself. Browser target ids such as `browser:<session>` name
  browser sessions, not every AOS session.
- Workspace: the local saved perception/ref store selected per command by
  `--workspace`, then `AOS_AGENT_WORKSPACE`, then `default`. It contains
  committed saved captures, compact refs, indexes, and file-backed artifacts
  under the active AOS state root. There is no public
  `aos see workspace use <id>` command and no daemon-held current workspace.
- Focus channel: a named mutable target binding managed by `aos focus` and
  consumed by capture/action flows. It helps address a window, browser, canvas,
  channel, or focused surface; it is not an agent session and not the saved
  workspace.
- Runtime state: mode-scoped local AOS state and service readiness, including
  runtime mode, state root, config, daemon/service status, permissions, content
  status, logs, gate records, voice/session presence, and diagnostics.
- Operation: a generation-bound registered unit of privileged work with a
  mechanically authenticated owner root, resource claims, lifecycle, outcome,
  residual, artifact, and cleanup facts. Attribution labels narrow owner-scoped
  queries; they never confer authority. Same-UID `operation stop-all` is a
  separate observable host action over the exact registered set.
- Work Record: optional durable, inspectable evidence and verification material above
  primitive command output. It can verify, explain conservative recovery, plan
  source-bound mechanical repair, bundle recovery evidence, and write explicit replacement or
  supersession artifacts through bounded commands. It is not a macro recorder,
  autonomous replay surface, automatic repair authority, or permission grant.
- Content root: the configured or declarative filesystem root for wiki/content
  and mounted app surfaces. A live content root must resolve to a readable
  directory; missing paths, files, symlinks, or unreadable paths stay visibly
  stale or blocked. It is not a saved workspace or Work Record store.
- Evidence state: the compact and file-backed proof trail created by saved
  captures, refs, diffs, pending annotations, gate records, Work Records, logs,
  and command JSON. Evidence state should be path-backed and replay-readable
  where possible, but it is not live runtime readiness or current UI state.

Command-to-state map:

| State concept | Primary command surfaces | Boundary |
| --- | --- | --- |
| Session | `tell`, `listen`, `voice`, `gate defer`, `status`, browser `browser:<session>` targets | Live coordination identity; not a saved workspace or evidence store |
| Workspace | `see capture --save`, `see workspaces`, `see workspace`, `see snapshots`, `see refs`, saved-ref `do ... --workspace` | Command-scoped saved capture/ref store; no hidden current workspace |
| Focus channel | `focus create/update/list/remove`, `see capture --channel`, `show ...`, `graph windows` | Mutable target binding; not session identity or saved evidence by itself |
| Runtime state | `ready`, `status`, `doctor`, `permissions`, `service`, `service logs`, `runtime`, `daemon-snapshot`, `experience status` | Mode-scoped readiness, config, daemon/service, log readback, diagnostics, and experience readback |
| Operation | `operation list/inspect/status/recent/cancel/kill/kill-owner/stop-all/barrier-status/reopen`; `operation tap --json`; exact-generation `operation artifact reveal\|remove\|release\|retain` | Registered microphone and fixed screen-video work, cleanup, same-UID host control, and producer-backed recording custody; tap and retain remain typed unavailable |
| Work Record | `work-record list/read/verify/status/plan-repair`, `work-record repair ...`, `work-record export` | Durable evidence and bounded recovery workflows; no autonomous replay |
| Content root | `content status`, `content wait`, `experience status`, wiki/content-backed surfaces | Readable declared content root; not a workspace or Work Record root |
| Evidence state | `see refs --diff --expect`, `see compare`, `see annotation ...`, `gate records`, `work-record ...`, logs, command JSON | Proof trail for later inspection; not current UI state |

Saved-workspace verification is evidence-state plumbing, not a generic
assertion engine. Keep lightweight checks tied to saved refs, recipe command
JSON, human gate records, or Work Record postconditions unless live manifests
add a broader public surface.

## Canonical Action Loop

AOS's Playwright-like observe-act loop is:

```bash
./aos ready --json
./aos see capture main --save --mode som --workspace default --name before
./aos see refs --workspace default --snapshot before --json
./aos do click ref:before:r1 --workspace default
./aos see capture main --save --mode som --workspace default --name after
./aos see refs --workspace default --diff before..after --expect change --json
```

Use the same shape for native apps, browser windows, canvas surfaces, regions,
and focus channels. The capture source can be a positional target such as
`main` or `browser:work`, or exactly one source flag such as `--region`,
`--canvas`, or `--channel`. Saved records are storage indirection to exactly one
V1 Observation Ref or Locator. Act once, recapture, and verify when verification
is useful. Add `--dry-run` only when the caller wants identical resolution with
mutation omitted; it is not action permission. Work Record evidence is optional.

Saved-ref action responses expose `post_action.recommended_next_command` when
the next safe step is a fresh `aos see capture --save`. Treat that command as
the action loop handoff before reusing refs from the same surface.

Owner-scoped AOS status-item leases support the same optional preview mechanics.
Register a descriptor with `aos status-item register`, compare-and-swap newer
descriptor revisions with `aos status-item update`, inspect the lease, then
invoke a semantic action with `aos status-item invoke`, supplying the current
action sequence reported by inspect. Optional dry-run does not consume the
sequence; effectful invocation atomically reserves it. This covers only
AOS-hosted status-item leases; it is not a third-party macOS menu-extra scraper.

## Lightweight Verification

Use the smallest check that matches the evidence you already have after an
action:

| Need | Use | Boundary |
| --- | --- | --- |
| Changed at all | `aos see refs --diff <before>..<after> --expect change|no-change --json` | Compares two existing saved snapshots; it does not capture, poll, or wait. |
| Exact PNG pixel change | `aos see compare <before.png> <after.png> [--pixel-tolerance <0..255>] [--expect change|no-change] [--change-map-out <new.png>] [--mask-out <new.png>]` | Compares two existing same-size PNG artifacts; optional outputs write exact grayscale spatial evidence but never capture, crop, resize, align, poll, wait, or start runtime services. |
| Specific ref status | `aos see refs --diff <before>..<after> --expect-ref <ref>=added|removed|changed|unchanged|present|missing --json` | Gates compact saved refs inside one diff; repeat `--expect-ref` for multiple refs. |
| Command JSON condition | A source-backed recipe that inspects known command JSON or runs saved-ref diff gates as explicit postcondition steps | `recipe dry-run` is static and does not observe live state; live checks must be explicit recipe steps. |
| Explicit caller-requested structured input | `aos gate ask`, `aos gate defer`, `aos gate submit`, and `aos gate records` | Produces structured input records; it is not a UI-state assertion or ordinary-action authorization surface. |
| Optional durable evidence or postconditions | `aos work-record verify`, `aos work-record status`, and Work Record postcondition evidence | Preserves verifier health and evidence; it is not permission, macro replay, autonomous repair, or a replacement for fresh perception. |
| Unsupported wait or assertion | No current `aos see capture --wait-for-change`, `aos see capture --until-stable`, `aos see assert`, `aos assert`, or `aos verify` command | Future wait/assert commands need manifests, parser/schema/docs/tests, and drift gates before public use. |

Fresh perception still comes from the action loop: save a capture, inspect the
current handles, optionally preview, act, save a fresh capture, then compare
saved output or record evidence when useful. Do not imply saved workspaces
recapture automatically or hold a daemon-scoped current workspace.

`show wait` and `content wait` are readiness waits, not generic assertions.
They are appropriate for proving that a named canvas bridge, manifest, JS
predicate, or content root is available before the next command. They should
stay bounded, return structured timeout JSON, and report the pending condition
they were waiting on. Use saved refs, explicit command JSON postconditions, or
Work Record verification for behavior assertions after an action.

### PNG pixel comparison

`aos see compare` is a stateless file comparator for one non-animated PNG per
path. It accepts an optional per-channel tolerance from 0 through 255; a pixel
changes when any canonical RGBA channel has an absolute delta strictly greater
than that tolerance. `--expect change|no-change` turns the same result into an
exit gate. JSON is always emitted, so the command has no `--json` flag.

Inputs must have identical decoded dimensions. AOS does not resize, crop, or
register them. `--change-map-out <new.png>` writes maximum canonical RGBA delta
per pixel; `--mask-out <new.png>` writes 255 when that maximum exceeds tolerance
and 0 otherwise. Each requested output is a same-size 8-bit grayscale PNG and
uses one bounded byte plane. Use bounded capture regions, canvases, or channels
before comparison, and run multiple captures/comparisons for multiple areas.
Encoded input is capped at 128 MiB and decoded input at 33,554,432 pixels per
file.

ImageIO type-checks and decodes each PNG into sRGB, 8-bit premultiplied-last
RGBA. Untagged input is treated as sRGB, orientation must be upright, alpha is
compared, and premultiplication removes invisible RGB differences. Pixel bytes
are row-major with `x=0, y=0` at the top left. The canonical pixel digest is
SHA-256 over `AOS_RGBA8_V1\0`, unsigned 64-bit big-endian width and height, and
the canonical RGBA bytes.

Without output flags, the fast path performs no writes and retains the exact
`aos.image-compare.v1` JSON contract. Artifact calls return
`aos.image-compare.v2` with descriptor-or-null `artifacts.change_map` and
`artifacts.mask`. A descriptor reports absolute path, geometry, encoding
version, domain-separated canonical sample SHA-256, exact PNG-file SHA-256, and
nonzero selected-pixel count. Outputs require new distinct standardized `.png`
paths below existing symlink-free parents. Each mode-`0600` destination-local
stage is encoded, fsynced, and atomically published without overwrite. The
opened parent identity must still match the requested symlink-free path before
publication and receipt, and published identity is rechecked. Artifact success
requires the complete v2 JSON receipt. Handled write, finalization, or receipt
failure removes invocation-owned stages and published outputs; cleanup failure
surfaces as `IMAGE_ARTIFACT_CLEANUP_FAILED` while unrelated files are preserved.
Expectation failure retains artifacts only after its complete v2 receipt is
written. Files are individually atomic, not mutually crash-atomic.

Integer counts and deltas in both schemas are authoritative.
`changed_ratio` and `mean_channel_delta` are convenience values rounded to 12
decimal places using nearest rounding with ties away from zero. Product-owned
thresholds beyond per-channel tolerance should gate the stable JSON fields in
the owning test, config, or recipe instead of adding inference policy to this
primitive.

## Diagnostics And Evidence Trace

AOS exposes bounded fixed screen-video recording, but not a Playwright-style
trace bundle or caller-followed page video. The recording primitive is
`aos record screen`: one fixed display, exact current window, or global region;
H.264 QuickTime video only; hard duration/frame/pixel/queue/byte bounds; and an
operation-owned transient artifact. System audio, microphone tracks, followed
geometry, and live/native acceptance remain outside the current slice. The
broader AOS-native proof trail is still a composed sequence of command JSON and
file-backed evidence:

```bash
./aos ready --json
./aos status --json
./aos see capture main --save --workspace <id> --name before --mode som
./aos see refs --workspace <id> --snapshot before --json
./aos do click ref:before:r1 --workspace <id>
./aos see capture main --save --workspace <id> --name after --mode som
./aos see refs --workspace <id> --diff before..after --expect change --json
./aos daemon-snapshot
./aos service logs --tail 50
./aos gate records --json
./aos work-record verify <id-or-path> --json
./aos work-record export <id-or-path> --json
```

Each step contributes a different kind of evidence:

| Evidence need | Current surface | What it proves |
| --- | --- | --- |
| Runtime readiness | `ready --json`, `status --json`, `doctor --json`, `permissions ... --json` | Mode, daemon/service, permission, and blocker state before live work. |
| Before/after perception | `see capture --save`, `see snapshots`, `see refs` | Compact refs plus file-backed capture artifacts under the selected workspace. |
| Bounded screen video | `record screen`, `operation status`, exact-generation `operation artifact ...` | Fixed-source admission and operation/custody identity; live media behavior requires separately authorized native acceptance. |
| Action provenance | `do ...` action envelopes and optional `do ... --dry-run` previews | Target resolution, validation status, action path, and recommended recapture command when available. |
| Lightweight verification | `see refs --diff --expect`, repeatable `--expect-ref` | Machine-checkable compact saved-ref change gates between two saved snapshots. |
| Diagnostic readback | `daemon-snapshot`, `service logs --tail N`, command JSON, structured errors | Runtime, daemon log, and spatial diagnostics for debugging; not durable UI-state assertions by themselves. |
| Diagnostic display | `log`, `log push`, `log clear` | Built-in log console/overlay display; useful for operators, not passive daemon log readback. |
| Explicit structured input | `gate ask/defer/submit`, `gate records` | Caller-requested structured input and terminal Gate records; no authority over unrelated actions. |
| Optional durable evidence | `work-record read/verify/status/export`, `work-record repair bundle ...` | Verifier health, postconditions, evidence manifests, and handoff artifacts. Bundles and exports are handoff/readback artifacts, not replay engines or permission grants. |

This command sequence is the current diagnostics/evidence trace story. It is
deliberately a recipe-sized composition over existing surfaces, not a new
`aos trace` command. The bounded recording artifact is one input to that story,
not a trace or dashboard bundle.

For DesktopWorld gesture delivery, `daemon-snapshot` includes the bounded
`runtime_resources.desktop_world_scene_event_routing` readback. It reports
counts for outbound-queue admission, invalid events, identity mismatches,
missing subscriptions, stale topology, unavailable stages, and queue-admission
failure, plus only the most recent failure code and timestamp. Queue admission
does not claim that the asynchronous client write completed. The readback never
includes scene documents, gesture coordinates, labels, or product data.
Capture a troubleshooting snapshot without changing AOS state by using the
standard Unix `tee` utility:

```bash
./aos daemon-snapshot | tee /tmp/aos-daemon-snapshot.json
```

Use `service logs --tail N` for the bounded daemon log and the scene
`inspect`, `monitor`, `perf`, `replay`, and DevTools surfaces for scene-specific
state. Keep `log` for the operator-visible DesktopWorld log panel; it is not a
passive daemon logging command.

## Dashboard And Readback Boundary

The current AOS dashboard answer is a composed readback flow, not a visual
dashboard command. For a static operational snapshot, combine:

```bash
./aos ready --json
./aos status --json
./aos focus list
./aos see workspaces --json
./aos show list
./aos gate records --json
./aos daemon-snapshot
./aos service logs --tail 50
./aos work-record list --json
```

Use `show` for overlay/display infrastructure, canvas readiness, rendering, and
display readback. Do not treat `show` as the owner of an agent dashboard unless
a future dashboard workflow is deliberately promoted with manifests, docs,
tests, and compatibility policy. A dedicated dashboard is justified only when
the composed readback flow needs stable aggregation semantics that agents or
apps cannot safely reconstruct from the current JSON surfaces.

## Capability Groups

| Group | Use for | Command surface |
| --- | --- | --- |
| Core readiness | Runtime/TCC state, direct-capture permission requests, and mechanical blockers | `ready`, `status`, `doctor`, `permissions check/preflight`, `permissions prime screen-capture`, `service status` |
| Desktop discovery | Displays, windows, cursor, selection, active surfaces, and content-addressed display mapping identity | `graph displays`, `graph windows`, `see list`, `see cursor`, `see selection` |
| Capture and perception | Screenshots, window/region/canvas/channel capture, frozen region display topology, xray, labels, saved refs | `see capture`, `see capture --save`, `see snapshots`, `see refs` |
| Saved workspace | Snapshot/ref storage, ref lookup, diffs, expectations, cleanup | `see workspaces`, `see workspace`, `see refs --diff --expect`, workspace prune/delete |
| Artifact comparison | Exact canonical pixel verification and optional grayscale spatial evidence over existing same-size PNG paths; no capture, wait, or alignment | `see compare <before.png> <after.png> [--pixel-tolerance <0..255>] [--expect change\|no-change] [--change-map-out <new.png>] [--mask-out <new.png>]` |
| Desktop/native control | App activate/quit/hide/unhide, window raise/move/resize/close/minimize/maximize/restore, app menu invocation, explicit Apple Shortcut execution, and native AX press/focus/set-value | `do activate`, `do quit`, `do hide`, `do unhide`, `do raise`, `do move`, `do resize`, `do close`, `do minimize`, `do maximize`, `do restore`, `do menu`, `do press`, `do focus`, `do set-value`, `shortcut run` |
| AOS-hosted status-item leases | Product-neutral native descriptor, observed anchor/events, exact compare-and-swap update, generation-scoped action admission, inspect/invoke, and disconnect cleanup | `status-item validate/register --follow/update/inspect/invoke` |
| Pointer and keyboard | Mouse, keyboard, scrolling, dragging, text, and fixed browser session actions; browser ref actions fail closed | `do click`, `do hover`, `do drag`, `do scroll`, `do type`, `do key`, `do fill`, `do navigate` |
| Canvas and vision | Canvas refs, regions, coordinates, labels, xray, visual proof | `see capture --canvas`, `see capture --region`, `see capture --xray --label`, `do click canvas:...`, coordinate actions |
| Browser companion | Source-pinned package lifecycle, generation-bound managed sessions, fixed consumers, fail-closed refs, and a separate path-free skills companion | `browser companion status/install/update/uninstall`, `focus create/list/remove`, `see capture browser:<session> --save`, `do navigate/type/key/scroll browser:<session>`, `skills companion check --name playwright-cli` |
| Overlay/display | Canvases, panels, stage surfaces, render/list/wait/readback | `show create/update/remove/list/audit/render/wait/get/to-front/post` |
| Diagnostics/debug | Debug readbacks and diagnostic displays for active AOS/runtime work | `daemon-snapshot`, `service logs`, `inspect`, `introspect review`, `log` |
| Verification/evidence | Recapture, refs diff/expect, explicit Gate input, optional Work Records | `see refs --diff --expect`, `gate`, `work-record read/verify/status/plan-repair` |
| Operator input | Native geometry or semantic AX target selection, pending operator annotations, and saved-ref handoff | `see annotation select/create/list/read/consume/link-work-record/delete` |
| Skills and recipes | Installable guidance versus executable source-backed procedures | `skills list/check/install`, `skills companion ...`, `recipe list/explain/dry-run/run` |
| Runtime/service | Daemon ownership, mode, permissions, cleanup | `service`, `runtime`, `content`, `clean`, `reset` |

## Ergonomics And Dev

Playwright-like means ergonomic, not command-for-command compatible. For AOS,
that means short direct verbs, stable machine output, optional dry-run support,
useful errors, discoverable help, and workflows that
compose from the same command facts agents see in `./aos help --json`.

Capability groups explain why a command exists. They do not force public
command spelling. Keep public diagnostics on deliberate command families such
as `log`, `inspect`, `introspect`, `daemon-snapshot`, and the
overlay/display-oriented `show` surface.

Retained local maintainer skills are the agent-facing interface for repo
workflow routing, orientation, and repo-binary builds. They call deterministic
scripts under `scripts/aos-dev-*.mjs`.

`aos dev` is retired from the AOS command surface. Do not add hidden `dev`
forms, external `dev` routes, or maintainer guidance that calls
`./aos dev ...`. If a maintainer helper becomes product behavior, promote it as
a deliberate public command with manifest, route, docs, tests, and
compatibility policy.

## Desktop Control Inventory

Status values:

- `first-class command`: direct public `aos` command form exists.
- `AX-backed command`: direct native AX command exists.
- `key/script escape hatch`: only key input or `aos do tell` can express it.
- `unsupported`: no current direct command or responsible fallback.
- `deferred follow-up`: explicit card seed exists in the design map.

| Action | Status | Current command | Mechanism | Dry-run | Permissions | Spaces/minimized notes | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| App launch | first-class command | `aos launch <app> [--dry-run]` | AOS source app launcher | Optional | No special TCC in manifest | Source-owned app ids, not arbitrary macOS apps | Keep |
| App activate | first-class command | `aos do activate --pid <pid> [--dry-run]` | AppKit app lifecycle | Optional | Accessibility/TCC state | Activates all app windows; still use graph/readback to target the intended pid | Keep |
| App quit | first-class command | `aos do quit --pid <pid> [--dry-run]` | AppKit app lifecycle | Optional | Accessibility/TCC state | Sends graceful terminate request to exactly one running pid | Keep |
| App hide/unhide | first-class command | `aos do hide --pid <pid> [--dry-run]` / `aos do unhide --pid <pid> [--dry-run]` | AppKit app lifecycle | Optional | Accessibility/TCC state | Pid-scoped app visibility, not Space switching | Keep |
| Window list | first-class command | `aos graph windows [--display N]` | AOS display/window graph | Read-only | No special TCC in manifest | Lists visible graph state only | Keep |
| Window focus | first-class command | `aos focus create --id <name> --window <wid>` | Exact owner-bound AOS focus channel | No | Accessibility for native window channels | Requires one current layer-zero CG window and one exact AX window/subtree root; does not raise the window | Keep |
| Window raise | first-class command | `aos do raise --pid <pid> [--window id] [--dry-run]` | native window control | Optional | Accessibility | May fail under Space/minimized constraints | Keep |
| Window move | first-class command | `aos do move --pid <pid> --to <x,y> [--window id] [--dry-run]` | native window control | Optional | Accessibility | Requires current resolvable window | Keep |
| Window resize | first-class command | `aos do resize --pid <pid> --to <w,h> [--window id] [--dry-run]` | native window control | Optional | Accessibility | Requires current resolvable window | Keep |
| Window close | first-class command | `aos do close --pid <pid> --window <id> [--dry-run]` | native AX close button | Optional | Accessibility | Requires exact window id and confirms disappearance after action | Keep |
| Window minimize | first-class command | `aos do minimize --pid <pid> --window <id> [--dry-run]` | native AX minimized state | Optional | Accessibility | Requires exact window id and readback confirmation | Keep |
| Window maximize/restore | first-class command | `aos do maximize --pid <pid> --window <id> [--dry-run]` / `aos do restore --pid <pid> --window <id> [--dry-run]` | native AX frame/minimized state | Optional | Accessibility | Maximize stores previous frame under AOS state; restore fails closed without saved frame unless unminimizing | Keep |
| Menu-item invocation | first-class command | `aos do menu --pid <pid> --path File,Save [--dry-run]` | native AX menu path traversal | Optional | Accessibility | Requires exact pid, unique menu path, enabled leaf, and AXPress support | Keep |
| AOS-hosted status-item lease invocation | first-class command | Keep register-follow alive; use exact owner/item/generation/current revision for `aos status-item update`, then inspect and invoke with the returned revision and action sequence; `--dry-run` is an optional non-consuming preview | owner-scoped native status-item host lease | Optional | Runtime readiness for live post | Register-follow owns lifetime/events; update preserves the action sequence; effectful invoke atomically consumes it before delivery; native clicks share the allocator; new generations reset it; not arbitrary third-party macOS menu extras | Keep |
| Window fullscreen | deferred follow-up | none | likely native/AX/key | No | Accessibility | Space transitions are risky | Add only with Space proof |
| Space detection | unsupported | none | macOS Space state unavailable in public AOS command | No | Accessibility/Screen Recording likely | Current Space identity is not stable public evidence | Design primitive first |
| Space switching | deferred follow-up | none | key/native Mission Control likely | No | Accessibility/Input Monitoring | Mutates global desktop context | Design an exact primitive first |
| Mission Control / app expose | unsupported | none | key/native Mission Control | No | Accessibility/Input Monitoring | Global UI mode, not a stable ref target | Keep unsupported unless a use case proves need |

The combined `focus create` and `focus update` forms, plus channel
`graph deepen`/`graph collapse`, conservatively declare
`requires_permissions=true` because they can enter the native AX channel path.
A `browser://` focus target uses the Node-owned managed companion session
authority and does not consume native Accessibility authority.
| Native AX press | AX-backed command | `aos do press <ref> ... [--dry-run]` or `--pid --role ... [--dry-run]` | native AX | Optional | Accessibility | Current saved-handle implementation fails closed on missing identity, off-Space, minimized, or known-limit blockers | Keep |
| Native AX focus | AX-backed command | `aos do focus <ref> ... [--dry-run]` or `--pid --role ... [--dry-run]` | native AX | Optional | Accessibility | Same native saved-handle known limits | Keep |
| Native AX set-value | AX-backed command | `aos do set-value <ref> --value ... [--dry-run]` or `--pid --role ...` | native AX/canvas | Optional | Accessibility | Same native saved-handle known limits | Keep |
| Raw coordinates | first-class command | `aos do click/hover/drag/scroll x,y` | pointer/keyboard input | Some actions | Accessibility/Input Monitoring | Caller-selected current coordinates; `state_id` is unsupported | Coordinates are not semantic handles |
| Keyboard fallback | first-class command | `aos do type`, `aos do key` | keyboard input | Browser refs only for some forms | Accessibility/Input Monitoring | Acts on current focus | Use only with focus proof |
| App scripting fallback | key/script escape hatch | `aos do tell <app> <script>` | AppleScript | No | Automation/Accessibility likely | App-specific and lower-level | Keep as explicit escape hatch |

## Browser Boundary

AOS currently owns desktop/browser capture, saved-workspace handles, action
envelopes, and optional evidence. Those saved handles are implementation
plumbing rather than durable public target identity. Upstream Playwright CLI
owns browser-only primitives that are not AOS desktop primitives:

- network mocking;
- storage/auth state;
- console/eval;
- tracing, video, and PDF;
- locator generation and test generation;
- test debugging;
- upload and file chooser flows;
- select/check/uncheck;
- back/forward/reload;
- tab management.

Manage the reviewed package runtime separately from Playwright-owned skills:

```bash
./aos browser companion status --json
./aos browser companion install --json
./aos browser companion update --json
./aos browser companion uninstall --json
```

Status returns `missing`, `current`, `update_available`, `partial`, `corrupt`,
or `blocked`. Install is current-version idempotent, update rejects a missing
installation, and uninstall rejects exact managed session leases. These forms
have no dry-run. Their closed receipts expose only lifecycle state, exact
versions and digests, exact safe-integer monotonic timing, cleanup count, and recovery status; they
do not expose paths, package URLs or bytes, or package-manager output.
Uninstall durably journals the installed descriptor and closure, exclusively
claims browser-level recovery, then moves the whole sentinel-validated store
into one removal marker. Every authoritative interrupted phase remains explicit
recoverable `partial` state with its journal binding. After store deletion, the
still-journaled marker atomically becomes a non-authoritative completed
tombstone; later tombstone cleanup cannot turn observed `missing` back into
partial state. Empty interrupted lock or removal-intent creation is similarly
recoverable, and active-pointer intent cleanup is classified from observed
record presence.

All maintained browser/session consumers now use one managed session record and
the same global store lock. `current` proves the managed package store; each
operation additionally requires an active record bound to the exact immutable
version and random generation. No `browser tabs new` command is present yet.

Managed sessions are created and removed through `focus`:

```bash
./aos focus create --id scratch --target browser://new --headless
./aos focus create --id remote --target browser://attach --cdp http://127.0.0.1:9222
./aos focus create --id chrome --target browser://attach --extension=chrome
./aos focus list
./aos focus remove --id scratch --backend browser
```

Launched sessions explicitly select system Chrome, which must already be
installed because the companion closure installs no browser binary and its
private browser cache starts empty. Removal uses exact-session close. Persistent
launch accepts only an AOS-owned per-generation profile, and initial/navigation
URLs admit only `http`, `https`, `data`, or `about` (never `file:`). CDP and extension
sessions are external-owned; removal uses only detach. The extension handshake
may launch/focus Chrome and open its bridge page without transferring ownership
of the browser, profile, or tabs. It requires the reviewed extension in an
ordinary system-Chrome `Default` or `Profile N` profile; unavailable or unsafe
profile evidence fails before session mutation. Its pinned extension id must
contain an ordinary version directory and matching bounded manifest. Admission
scans the full bounded ordinary profile/version set; any malformed or over-cap
member is blocked even if another profile is valid. Two identical complete
bounded tree scans are required; persistent change after bounded retry is
blocked. The creation intent,
workspace, and starting lease precede worker spawn; a real child spawn
event latches possible upstream authority. Missing liveness or ambiguous cleanup remains
durable `cleanup_required` and keeps the exact runtime lease. AOS never calls
upstream list and never uses PID state as cleanup authority. At most 128 durable
session records are admitted, and `focus list` is a noncreating stable read.
Mutations use durable `operating`/`operation_committed` and
`closing`/`cleanup_committed` phases so acknowledged effects are not replayed
after publication interruption.

One detached Node guardian supervises each real worker. It remains inert until
the parent observes its PID, publishes/fsyncs the exact lock-token reservation,
and sends activation. An acknowledged request still requires a separate execute
signal before spawn. Raw stdout/stderr stay separate but share the immutable
descriptor's 65,536-byte aggregate capture cap; small control, activation, and
lifetime fds carry only authority metadata. Parent or pipe loss before execute
is `no_spawn`; later loss performs TERM-to-KILL and proves whole-process-group
absence before lock recovery. Older leases retain their exact bounded
version, descriptor, closure, package-relative entrypoint, and generation after
a newer runtime activates. Native focus depth is a canonical integer from 0
through 15 and is rejected before daemon dispatch otherwise.

The fixed public managed actions are session-only `do navigate`, `do type`,
`do key`, and `do scroll`. Only scroll advertises a pure-validation `--dry-run`;
same-session ref actions are unadvertised and fail before managed dispatch.
Browser capture admits only the whole-session `--out`/`--xray` form or the
separate saved-workspace flag set; native-only flags fail before worker access.
Navigate, type, and key reject dry-run. Whole-session snapshot/screenshot, path-free page
identity, saved capture, and Toolkit evidence use the same managed broker.
Browser-window locality, anchors, DOM hit testing, ref actions, arbitrary
eval/run-code, runtime paths/fallbacks, and tab operations remain unavailable.

Inspect or plan the separately owned upstream skill material with:

```bash
./aos skills companion check --name playwright-cli --target path --path /tmp/aos-skills --json
```

Do not vendor Playwright CLI skill content into AOS.

## Verification Loop

Use the canonical action loop across desktop, native AX, canvas, and browser
targets:

1. Check runtime readiness with `./aos ready --json` or passive
   `./aos status --json`.
2. Capture with `./aos see capture ... --save --workspace <id> --mode som`.
3. Inspect `./aos see refs --workspace <id> --json`.
4. Prefer `ref:<snapshot-id>:<ref>` over prose or coordinates.
5. Resolve exact current identity; use optional dry-run only when a preview is useful.
6. Act once and handle typed stale, missing, ambiguous, or unsupported results.
7. Recapture.
8. Check compact evidence with `./aos see refs --diff <before>..<after> --expect ...`
   or optionally use a Work Record verifier. When matching before/after PNG artifact paths
   already exist, use `./aos see compare <before.png> <after.png>` as the exact
   pixel alternative; request `--change-map-out` and/or `--mask-out` only when
   path-backed spatial evidence is needed. It does not capture, wait, or align
   inputs.
9. Stop on stale identity, fallback-only refs, unsupported actions, missing permissions, off-Space/minimized native blockers, or required live proof.

# AOS Capabilities

Consumer-facing capability map for AOS as a Playwright-like desktop
automation CLI: direct commands, stable help/JSON output, progressive
discovery, and capability-oriented workflows. This map is grounded in
`./aos help --json` and source command manifests under
`manifests/commands/source/aos/`.

Use this file to choose the right direct `./aos` lane before opening large
schema docs or historical design notes.

For the complete manifest-derived command inventory, including internal or
transitional forms such as `dev` and `browser _check-version`, see
`docs/dev/reports/aos-command-capability-inventory-v0.md`. That report is a
development audit artifact, not a consumer API contract.

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
- Work Record: durable, inspectable evidence and verification material above
  primitive command output. It can verify, explain conservative recovery, plan
  gated repair, bundle recovery evidence, and write explicit replacement or
  supersession artifacts through bounded commands. It is not a macro recorder,
  autonomous replay surface, or automatic repair authority.
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
| Runtime state | `ready`, `status`, `doctor`, `permissions`, `service`, `service logs`, `runtime`, `daemon-snapshot`, `experience status` | Mode-scoped readiness, config, daemon/service, log readback, and diagnostics |
| Work Record | `work-record list/read/verify/status/plan-repair`, `work-record repair ...`, `work-record export` | Durable evidence and bounded recovery workflows; no autonomous replay |
| Content root | `content status`, `content wait`, `experience status`, wiki/content-backed surfaces | Readable declared content root; not a workspace or Work Record root |
| Evidence state | `see refs --diff --expect`, `see annotation ...`, `gate records`, `work-record ...`, logs, command JSON | Proof trail for later inspection; not current UI state |

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
./aos do click ref:before:r1 --workspace default --dry-run
./aos do click ref:before:r1 --workspace default
./aos see capture main --save --mode som --workspace default --name after
./aos see refs --workspace default --diff before..after --expect change --json
```

Use the same shape for native apps, browser windows, canvas surfaces, regions,
and focus channels. The capture source can be a positional target such as
`main` or `browser:work`, or exactly one source flag such as `--region`,
`--canvas`, or `--channel`. Prefer saved refs over coordinates, dry-run when a
form supports it, act once, recapture, and verify with refs diff/expect gates
or a Work Record verifier.

Saved-ref action responses expose `post_action.recommended_next_command` when
the next safe step is a fresh `aos see capture --save`. Treat that command as
the action loop handoff before reusing refs from the same surface.

## Lightweight Verification

Use the smallest check that matches the evidence you already have after an
action:

| Need | Use | Boundary |
| --- | --- | --- |
| Changed at all | `aos see refs --diff <before>..<after> --expect change|no-change --json` | Compares two existing saved snapshots; it does not capture, poll, or wait. |
| Specific ref status | `aos see refs --diff <before>..<after> --expect-ref <ref>=added|removed|changed|unchanged|present|missing --json` | Gates compact saved refs inside one diff; repeat `--expect-ref` for multiple refs. |
| Command JSON condition | A source-backed recipe that inspects known command JSON or runs saved-ref diff gates as explicit postcondition steps | `recipe dry-run` is static and does not observe live state; live checks must be explicit recipe steps. |
| Human approval or decision | `aos gate ask`, `aos gate defer`, `aos gate submit`, and `aos gate records` | Produces structured human decision records; it is not a UI-state assertion surface. |
| Durable evidence or postconditions | `aos work-record verify`, `aos work-record status`, and Work Record postcondition evidence | Preserves verifier health and evidence; it is not macro replay, autonomous repair, or a replacement for fresh perception. |
| Unsupported wait or assertion | No current `aos see capture --wait-for-change`, `aos see capture --until-stable`, `aos see assert`, `aos assert`, or `aos verify` command | Future wait/assert commands need manifests, parser/schema/docs/tests, and drift gates before public use. |

Fresh perception still comes from the canonical action loop: save a capture,
inspect refs, dry-run/act, save a fresh capture, then compare saved refs or
record evidence. Do not imply saved workspaces recapture automatically or hold a
daemon-scoped current workspace.

## Diagnostics And Evidence Trace

AOS does not currently expose a Playwright-style `trace`, `video`, or
screen-recording primitive in the public command surface. The AOS-native proof
trail is a composed sequence of command JSON and file-backed evidence:

```bash
./aos ready --json
./aos status --json
./aos see capture main --save --workspace <id> --name before --mode som
./aos see refs --workspace <id> --snapshot before --json
./aos do click ref:before:r1 --workspace <id> --dry-run
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
| Action provenance | `do ... --dry-run`, `do ...` action envelopes | Target resolution, validation status, action path, and recommended recapture command when available. |
| Lightweight verification | `see refs --diff --expect`, repeatable `--expect-ref` | Machine-checkable compact saved-ref change gates between two saved snapshots. |
| Diagnostic readback | `daemon-snapshot`, `service logs --tail N`, command JSON, structured errors | Runtime, daemon log, and spatial diagnostics for debugging; not durable UI-state assertions by themselves. |
| Diagnostic display | `log`, `log push`, `log clear` | Built-in log console/overlay display; useful for operators, not passive daemon log readback. |
| Human decisions | `gate ask/defer/submit`, `gate records` | Structured human/operator decisions and terminal gate records. |
| Durable evidence | `work-record read/verify/status/export`, `work-record repair bundle ...` | Verifier health, postconditions, evidence manifests, and handoff artifacts. Bundles and exports are handoff/readback artifacts, not replay engines. |

This command sequence is the current diagnostics/evidence trace story. It is
deliberately a recipe-sized composition over existing surfaces, not a new
`aos trace` command. Add a dedicated trace, video, or dashboard command only
with source manifests, routes, docs, tests, generated artifacts, and a clear
compatibility policy.

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
| Core readiness | Runtime gates and blockers before live desktop work | `ready`, `status`, `doctor`, `permissions check/preflight`, `service status` |
| Desktop discovery | Displays, windows, cursor, selection, and active surfaces | `graph displays`, `graph windows`, `see list`, `see cursor`, `see selection` |
| Capture and perception | Screenshots, window/region/canvas/channel capture, xray, labels, saved refs | `see capture`, `see capture --save`, `see snapshots`, `see refs` |
| Saved workspace | Snapshot/ref storage, ref lookup, diffs, expectations, cleanup | `see workspaces`, `see workspace`, `see refs --diff --expect`, workspace prune/delete |
| Desktop/native control | App activate/quit/hide/unhide, window raise/move/resize/close/minimize/maximize/restore, and native AX press/focus/set-value | `do activate`, `do quit`, `do hide`, `do unhide`, `do raise`, `do move`, `do resize`, `do close`, `do minimize`, `do maximize`, `do restore`, `do press`, `do focus`, `do set-value` |
| Pointer and keyboard | Mouse, keyboard, scrolling, dragging, text, browser ref actions | `do click`, `do hover`, `do drag`, `do scroll`, `do type`, `do key`, `do fill`, `do navigate` |
| Canvas and vision | Canvas refs, regions, coordinates, labels, xray, visual proof | `see capture --canvas`, `see capture --region`, `see capture --xray --label`, `do click canvas:...`, coordinate actions |
| Browser companion | AOS browser refs plus upstream Playwright CLI escape hatch | `focus create --target browser://...`, `see capture browser:<session> --save`, `do ... browser/ref`, `skills companion check --name playwright-cli` |
| Overlay/display | Canvases, panels, stage surfaces, render/list/wait/readback | `show create/update/remove/list/audit/render/wait/get/to-front/post` |
| Diagnostics/debug | Debug readbacks and diagnostic displays for active AOS/runtime work | `daemon-snapshot`, `service logs`, `inspect`, `introspect review`, `log` |
| Verification/evidence | Recapture, refs diff/expect, gates, Work Records | `see refs --diff --expect`, `gate`, `work-record read/verify/status/plan-repair` |
| Operator input | Pending operator annotations and saved-ref handoff | `see annotation create/list/read/consume/link-work-record/delete` |
| Skills and recipes | Installable guidance versus executable source-backed procedures | `skills list/check/install`, `skills companion ...`, `recipe list/explain/dry-run/run` |
| Runtime/service | Daemon ownership, mode, permissions, cleanup | `service`, `runtime`, `content`, `clean`, `reset` |

## Ergonomics And Dev

Playwright-like means ergonomic, not command-for-command compatible. For AOS,
that means short direct verbs, stable machine output, dry-run support where
mutation risk is high, useful errors, discoverable help, and workflows that
compose from the same command facts agents see in `./aos help --json`.

Capability groups explain why a command exists. They do not force public
command spelling. Keep public diagnostics on deliberate command families such
as `log`, `inspect`, `introspect`, `daemon-snapshot`, and the
overlay/display-oriented `show` surface.

`aos dev` is a hidden maintainer workflow router for this repo. It remains
directly addressable through `./aos help dev --json`, but it is marked
`consumer_discovery: false`, omitted from root consumer help, and owned by
`docs/dev/command-surface.md` plus the generated command inventory. Useful
maintainer helpers should stay there until a deliberate migration moves them
out of the public `aos` tree or promotes a specific workflow into a real public
surface with manifest, route, docs, tests, and compatibility policy.

## Desktop Control Inventory

Status values:

- `first-class command`: direct public `aos` command form exists.
- `AX-backed command`: direct native AX command exists.
- `key/script escape hatch`: only key input or `aos do tell` can express it.
- `unsupported`: no current direct command or responsible fallback.
- `deferred follow-up`: explicit card seed exists in the design map.

| Action | Status | Current command | Mechanism | Dry-run | Permissions | Spaces/minimized notes | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| App launch | first-class command | `aos launch <app> [--dry-run]` | AOS source app launcher | Yes | No special TCC in manifest | Source-owned app ids, not arbitrary macOS apps | Keep |
| App activate | first-class command | `aos do activate --pid <pid> --dry-run` before `aos do activate --pid <pid>` | AppKit app lifecycle | Yes | Accessibility/setup gate in manifest | Activates all app windows; still use graph/readback to target the intended pid | Keep |
| App quit | first-class command | `aos do quit --pid <pid> --dry-run` before `aos do quit --pid <pid>` | AppKit app lifecycle | Yes | Accessibility/setup gate in manifest | Sends graceful terminate request to exactly one running pid | Keep |
| App hide/unhide | first-class command | `aos do hide --pid <pid> --dry-run` / `aos do unhide --pid <pid> --dry-run` before action | AppKit app lifecycle | Yes | Accessibility/setup gate in manifest | Pid-scoped app visibility, not Space switching | Keep |
| Window list | first-class command | `aos graph windows [--display N]` | AOS display/window graph | Read-only | No special TCC in manifest | Lists visible graph state only | Keep |
| Window focus | first-class command | `aos focus create --id <name> --window <wid>` | AOS focus channel | No | No special TCC in manifest | Tracks a window channel; not a raise command | Keep |
| Window raise | first-class command | `aos do raise --pid <pid> [--window id] --dry-run` before `aos do raise --pid <pid> [--window id]` | native window control | Yes | Accessibility | May fail under Space/minimized constraints | Keep |
| Window move | first-class command | `aos do move --pid <pid> --to <x,y> [--window id] --dry-run` before `aos do move --pid <pid> --to <x,y> [--window id]` | native window control | Yes | Accessibility | Requires current resolvable window | Keep |
| Window resize | first-class command | `aos do resize --pid <pid> --to <w,h> [--window id] --dry-run` before `aos do resize --pid <pid> --to <w,h> [--window id]` | native window control | Yes | Accessibility | Requires current resolvable window | Keep |
| Window close | first-class command | `aos do close --pid <pid> --window <id> --dry-run` before `aos do close --pid <pid> --window <id>` | native AX close button | Yes | Accessibility | Requires exact window id and confirms disappearance after action | Keep |
| Window minimize | first-class command | `aos do minimize --pid <pid> --window <id> --dry-run` before `aos do minimize --pid <pid> --window <id>` | native AX minimized state | Yes | Accessibility | Requires exact window id and readback confirmation | Keep |
| Window maximize/restore | first-class command | `aos do maximize --pid <pid> --window <id> --dry-run` / `aos do restore --pid <pid> --window <id> --dry-run` before action | native AX frame/minimized state | Yes | Accessibility | Maximize stores previous frame under AOS state; restore fails closed without saved frame unless unminimizing | Keep |
| Window fullscreen | deferred follow-up | none | likely native/AX/key | No | Accessibility | Space transitions are risky | Add only with Space proof |
| Space detection | unsupported | none | macOS Space state unavailable in public AOS command | No | Accessibility/Screen Recording likely | Current Space identity is not stable public evidence | Design primitive first |
| Space switching | deferred follow-up | none | key/native Mission Control likely | No | Accessibility/Input Monitoring | Mutates global desktop context | Approval-gated design only |
| Mission Control / app expose | unsupported | none | key/native Mission Control | No | Accessibility/Input Monitoring | Global UI mode, not a stable ref target | Keep unsupported unless a use case proves need |
| Menu-item invocation | deferred follow-up | none | likely native AX menu traversal | No | Accessibility | Must validate path and enabled state | Add semantic verb after design |
| Native AX press | AX-backed command | `aos do press <ref> ... --dry-run` or `--pid --role ... --dry-run` | native AX | Yes | Accessibility | Stable saved refs fail closed on missing identity, off-Space, minimized, or known-limit blockers | Keep |
| Native AX focus | AX-backed command | `aos do focus <ref> ... --dry-run` or `--pid --role ... --dry-run` | native AX | Yes | Accessibility | Same native saved-ref known limits | Keep |
| Native AX set-value | AX-backed command | `aos do set-value <ref> --value ... --dry-run` or `--pid --role ...` | native AX/canvas | Yes | Accessibility | Same native saved-ref known limits | Keep |
| Pointer fallback | first-class command | `aos do click/hover/drag/scroll x,y` | pointer/keyboard input | Some actions | Accessibility/Input Monitoring | Coordinate fallback is diagnostic unless explicitly authorized | Use after saved refs fail or for proof |
| Keyboard fallback | first-class command | `aos do type`, `aos do key` | keyboard input | Browser refs only for some forms | Accessibility/Input Monitoring | Acts on current focus | Use only with focus proof |
| App scripting fallback | key/script escape hatch | `aos do tell <app> <script>` | AppleScript | No | Automation/Accessibility likely | App-specific and lower-level | Keep as explicit escape hatch |

## Browser Boundary

AOS owns durable desktop/browser capture, saved refs, action envelopes, and
evidence. Upstream Playwright CLI owns browser-only primitives that are not AOS
desktop primitives:

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

Use:

```bash
./aos skills companion check --name playwright-cli --target path --path /tmp/aos-skills --json
```

Do not vendor Playwright CLI skill content into AOS.

## Verification Loop

Use the canonical action loop across desktop, native AX, canvas, and browser
targets:

1. Gate runtime with `./aos ready --json` or passive `./aos status --json`.
2. Capture with `./aos see capture ... --save --workspace <id> --mode som`.
3. Inspect `./aos see refs --workspace <id> --json`.
4. Prefer `ref:<snapshot-id>:<ref>` over prose or coordinates.
5. Dry-run before any supported mutating action, including window raise/move/resize.
6. Act once only when the dry-run validates the current target.
7. Recapture.
8. Gate compact evidence with `./aos see refs --diff <before>..<after> --expect ...` or a Work Record verifier.
9. Stop on stale identity, fallback-only refs, unsupported actions, missing permissions, off-Space/minimized native blockers, or required live proof.

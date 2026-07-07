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
| Runtime state | `ready`, `status`, `doctor`, `permissions`, `service`, `runtime`, `daemon-snapshot`, `log`, `experience status` | Mode-scoped readiness, config, daemon/service, and diagnostics |
| Work Record | `work-record list/read/verify/status/plan-repair`, `work-record repair ...`, `work-record export` | Durable evidence and bounded recovery workflows; no autonomous replay |
| Content root | `content status`, `content wait`, `experience status`, wiki/content-backed surfaces | Readable declared content root; not a workspace or Work Record root |
| Evidence state | `see refs --diff --expect`, `see annotation ...`, `gate records`, `work-record ...`, logs, command JSON | Proof trail for later inspection; not current UI state |

Saved-workspace verification is `see refs --diff --expect`, recipe JSON
assertions, gates, and Work Record postconditions. Do not describe a generic
wait/assert engine or saved-workspace daemon default unless live manifests add
that public surface.

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

## Capability Groups

| Group | Use for | Command surface |
| --- | --- | --- |
| Core readiness | Runtime gates and blockers before live desktop work | `ready`, `status`, `doctor`, `permissions check/preflight`, `service status` |
| Desktop discovery | Displays, windows, cursor, selection, and active surfaces | `graph displays`, `graph windows`, `see list`, `see cursor`, `see selection` |
| Capture and perception | Screenshots, window/region/canvas/channel capture, xray, labels, saved refs | `see capture`, `see capture --save`, `see snapshots`, `see refs` |
| Saved workspace | Snapshot/ref storage, ref lookup, diffs, expectations, cleanup | `see workspaces`, `see workspace`, `see refs --diff --expect`, workspace prune/delete |
| Desktop/native control | Window raise/move/resize and native AX press/focus/set-value | `do raise`, `do move`, `do resize`, `do press`, `do focus`, `do set-value` |
| Pointer and keyboard | Mouse, keyboard, scrolling, dragging, text, browser ref actions | `do click`, `do hover`, `do drag`, `do scroll`, `do type`, `do key`, `do fill`, `do navigate` |
| Canvas and vision | Canvas refs, regions, coordinates, labels, xray, visual proof | `see capture --canvas`, `see capture --region`, `see capture --xray --label`, `do click canvas:...`, coordinate actions |
| Browser companion | AOS browser refs plus upstream Playwright CLI escape hatch | `focus create --target browser://...`, `see capture browser:<session> --save`, `do ... browser/ref`, `skills companion check --name playwright-cli` |
| Overlay/display | Canvases, panels, stage surfaces, render/list/wait/readback | `show create/update/remove/list/audit/render/wait/get/to-front/post` |
| Diagnostics/debug | Debug readbacks for active AOS/runtime work | `daemon-snapshot`, `inspect`, `introspect review`, `log` |
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
| App activate | deferred follow-up | none | likely native/AX or script | No | Accessibility likely | Must prove off-Space behavior | Add semantic verb only after fail-closed design |
| App quit | deferred follow-up | none | likely native/AX or AppleScript | No | Accessibility/Automation likely | Must avoid quitting wrong app | Add semantic verb |
| App hide/unhide | deferred follow-up | none | likely key/script/native | No | Accessibility/Automation likely | Space/frontmost ambiguity | Add semantic verb |
| Window list | first-class command | `aos graph windows [--display N]` | AOS display/window graph | Read-only | No special TCC in manifest | Lists visible graph state only | Keep |
| Window focus | first-class command | `aos focus create --id <name> --window <wid>` | AOS focus channel | No | No special TCC in manifest | Tracks a window channel; not a raise command | Keep |
| Window raise | first-class command | `aos do raise --pid <pid> [--window id]` | native window control | No | Accessibility | May fail under Space/minimized constraints | Consider dry-run in follow-up |
| Window move | first-class command | `aos do move --pid <pid> --to <x,y> [--window id]` | native window control | No | Accessibility | Requires current resolvable window | Consider dry-run in follow-up |
| Window resize | first-class command | `aos do resize --pid <pid> --to <w,h> [--window id]` | native window control | No | Accessibility | Requires current resolvable window | Consider dry-run in follow-up |
| Window close | deferred follow-up | none | likely native/AX | No | Accessibility | Must validate target and enabled close affordance | Add semantic verb |
| Window minimize | deferred follow-up | none | likely native/AX | No | Accessibility | Minimized windows change visibility/readback | Add semantic verb |
| Window maximize/restore | deferred follow-up | none | likely native/AX/toolkit for AOS panels only | No | Accessibility | App-specific zoom/fullscreen behavior | Add semantic verb |
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
5. Dry-run when the command supports it.
6. Act once only when the dry-run validates the current target.
7. Recapture.
8. Gate compact evidence with `./aos see refs --diff <before>..<after> --expect ...` or a Work Record verifier.
9. Stop on stale identity, fallback-only refs, unsupported actions, missing permissions, off-Space/minimized native blockers, or required live proof.

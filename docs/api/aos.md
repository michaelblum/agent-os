# `aos` CLI API

Consumer-facing reference for the unified `aos` binary.

Use this doc when you are:

- writing agents that shell out to `aos`
- building wrappers around `aos`
- reviewing changes that affect the public CLI contract

For architecture and philosophy, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Repo Development Entry Points

When you are developing inside the `agent-os` repo, invoke the binary as
`./aos`, not bare `aos`.

Start here:

```bash
./aos ready
./aos dev recommend --json
./aos help <command> [--json]
./aos introspect review
```

`./aos ready` is the primary runtime readiness entrypoint. It starts/checks the
managed daemon and exits non-zero when AOS is not ready. Use `./aos status` for
a read-only runtime snapshot after that. Use `doctor`, `daemon-snapshot`, and
`clean` when you need deeper diagnostics or explicit cleanup, not as the default
first move.

For live repo work, `./aos` is also the first control plane for canvases, Agent
Terminal surfaces, dock communication, input routing, and runtime inspection.
Avoid raw daemon HTTP calls, direct PTY/tmux control, launchd probes, or
state-file inspection unless the AOS surface is missing or broken, the task is
testing that lower-level adapter, or the AOS control surface itself is under
repair. Treat those bypasses as scoped diagnostics and say why they were needed.

Use `./aos dev classify --json` and `./aos dev recommend --json` to route repo
changes through the manifest-backed developer workflow before choosing a build,
test, canvas reload, or readiness loop. Use `./aos dev build`
instead of raw `bash build.sh` unless `./aos` is missing or the build surface is
itself under repair. Use `./aos dev gh` for GitHub operations from repo
sessions; it shells out to the authenticated local `gh` CLI and does not fall
back to connector-backed GitHub tools.

## Contract

`aos` is a single binary with Unix-style subcommand groups.

The binary exposes platform primitives, not product policy. For surfaces, the
daemon should provide native lifecycle, display, input, content, and routing
capabilities that any consumer can build on. The default AOS panel/windowing
policy belongs in `packages/toolkit/`, not in app code and not as
Sigil-specific branches inside the daemon. A consumer may use toolkit
windowing, customize it, or bypass it for non-panel surfaces.

Examples:

```bash
aos see cursor
aos show create --id demo --at 100,100,300,200 --html '<div>hello</div>'
aos do click 500,300
aos say "Hello"
aos tell handoff "task complete"
aos listen handoff
```

### Success / Failure

Success is emitted on `stdout` with exit code `0`.

```json
{
  "status": "success"
}
```

Failure is emitted on `stderr` with exit code `1`.

```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

Consumers should treat the JSON envelope and exit code as the contract, not incidental log text.

## Top-Level Surface

The current top-level commands are:

| Command | Role |
| --- | --- |
| `aos ready` | front-door readiness gate; starts/checks AOS and reports blockers |
| `aos status` | read-only runtime/session status snapshot |
| `aos recipe` | source-backed executable recipes: list, explain, dry-run, run |
| `aos ops` | compatibility alias for `aos recipe`; removal gate: no remaining repo docs, scripts, generated indexes, packaged resources, tests, or known external callers require the old noun |
| `aos see` | Perception: cursor state, captures, observation streams, zones |
| `aos do` | Action: mouse, keyboard, AX actions, AppleScript, session mode |
| `aos show` | Projection: canvas create/update/remove/list/eval/render |
| `aos focus` | Focus-channel management |
| `aos gate` | Human input gates and local gate record readback |
| `aos graph` | Display/window graph queries |
| `aos introspect` | Session self-review over recent `./aos` usage |
| `aos help` | Registry and command-specific help |
| `aos say` | Voice output |
| `aos tell` | Communication output: human, channel, or direct session routing |
| `aos listen` | Communication input: channel or direct session reads/follow |
| `aos wiki` | local knowledge-base workflows |
| `aos config` | Discoverable runtime configuration (`get`, `set`, dump) |
| `aos set` | Runtime configuration |
| `aos content` | Content-server status |
| `aos serve` | Unified daemon |
| `aos service` | launchd lifecycle for the daemon |
| `aos experience` | active AOS experience-layer status, activation, and deactivation |
| `aos runtime` | packaged runtime utilities |
| `aos dev` | repo development workflow classification, recommendations, and build wrapper |
| `aos permissions` | preflight and onboarding |
| `aos doctor` | detailed runtime and permission diagnostics |
| `aos clean` | explicit stale daemon / canvas cleanup |
| `aos reset` | cleanup/reset workflows |
| `aos daemon-snapshot` | daemon state snapshot |
| `aos inspect` | live AX inspector overlay |
| `aos log` | log overlay |

## Core Usage Patterns

### 1. Perceive, Then Act

```bash
aos see cursor
aos see capture main --base64
aos see capture --canvas surface-inspector --perception --out /tmp/inspector.png
aos see capture --region 1172,442,320,480 --perception --out /tmp/inspector.png
aos do click 500,300
```

Typical consumer loop:

1. Use `aos see` to gather state.
2. Decide externally.
3. Use `aos do` or `aos show`.
4. Re-perceive if needed.

### 2. Ask For Bounded Human Input

`aos gate ask` presents a bounded structured decision through the gate service and writes the terminal result to stdout as JSON.

```bash
aos gate ask "Continue?"
aos gate ask --preset approve_deny --title "Run disruptive test?" --timeout 30
aos gate ask --request gate-request.json
aos gate ask --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"yes_no_with_escape"}}'
```

The request contract is `aos.gate.request.v1`. A successful answer returns the typed response object. A human dismissal returns `{ "result": null, "status": "dismissed" }`; a deadline returns `{ "result": null, "status": "timeout" }`. Operational failures exit non-zero with a machine-readable gate error code on stderr.

Every terminal outcome appends one `aos.gate.record.v1` metadata record under the active runtime state root: `~/.config/aos/{repo|installed}/gate/records.jsonl`, or `$AOS_STATE_ROOT/{repo|installed}/gate/records.jsonl` when that override is set. Records include gate id, prompt title, source metadata, receptor, field kinds, timeout, lifecycle timestamps, elapsed time, resolution/status, and operational error details when present. Prompt bodies and answer payloads are redacted by default; callers must opt in with `--store-response` or `metadata.record_response: true` to persist the answer payload.

Read records without presenting a gate:

```bash
aos gate records --json
aos gate records --limit 20 --json
aos gate records --id gate-abc123 --json
aos gate records --status answered --json
```

The readback payload is `aos.gate.records.readback.v1` and includes the JSONL path, count, and matching records.

Create a deferred gate when the current agent turn should end before the human
responds:

```bash
aos gate defer --request gate-request.json --session-id codex-123 --harness codex --json
aos gate defer --request gate-request.json --session-id codex-123 --harness codex --show --json
aos gate defer --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"approve_deny"}}' --session-id codex-123 --harness codex
```

`aos gate defer` writes one `aos.gate.continuation.v1` JSON file under the
active runtime state root and returns immediately with
`aos.gate.defer.create-response.v1`. Deferred continuations are stored at
`~/.config/aos/{repo|installed}/gate/continuations/<continuation_id>.json`, or
`$AOS_STATE_ROOT/{repo|installed}/gate/continuations/<continuation_id>.json`
when a state-root override is set. The record captures the gate id, prompt
title, redacted source metadata, session id, harness/provider hint, dock, cwd,
branch, HEAD SHA, dirty summary, lifecycle state, resume policy, resume
entrypoint metadata, and `auto_resume=false`. The entrypoint is an adapter
identifier such as `codex_exec_adapter`, not an executable path; the V0 daemon
does not invoke it directly. Prompt bodies and submitted answer payloads are
not persisted by default.

Submit a deferred gate from a local bridge or future UI receptor:

```bash
aos gate submit --continuation-id gate-cont-abc123 --request submission.json --json
aos gate submit --continuation-id gate-cont-abc123 --json '{"decision":"approve"}'
```

Submit loads the pending continuation, marks it `submitted` exactly once, appends
one terminal `aos.gate.record.v1` record, and writes one human-authored
`aos.gate.resume-event.v1` under
`~/.config/aos/{repo|installed}/gate/resume-events/<event_id>.json`. Duplicate
submits are idempotent and return the existing resume event rather than creating
another one. The resume event is provider-neutral: Codex is represented only by
the `harness`/`provider` values, `codex_exec` adapter hint, and
`codex_exec_adapter` continuation entrypoint metadata. V0 implementations must
treat `resume.auto_resume` as false regardless of value. Use `--store-response`
only when the answer payload should be persisted in the continuation, resume
event, and terminal gate record.

Read continuations without changing them:

```bash
aos gate continuations --json
aos gate continuations --limit 50 --json
aos gate continuations --id gate-cont-abc123 --json
aos gate continuations --status pending --json
```

The readback payload is `aos.gate.continuations.readback.v1` and includes the
continuation directory, count, and matching records.

Guided user-signal sessions extend deferred gates for visual "show me what you
mean" checkpoints. The durable record is
`aos.guided-user-signal.session.v1`, stored under
`$AOS_STATE_ROOT/{repo|installed}/guided-user-signal/sessions/` by toolkit
helpers. A record links the source operation, source surface, guidance media,
one daemon-owned click/point/region/annotation capture, optional gate record or
continuation id, optional resume event id/path, lifecycle state, runtime mode,
and redaction policy. V0 does not add a separate CLI command; AOS-hosted
surfaces use toolkit workbench helpers for visual policy and the existing
`gate.submit` bridge when a gate question is attached.

Full-screen or live desktop mouse ownership is a daemon/native input primitive,
not a WebView policy. V0 records name `input_region` as the concrete daemon
primitive when bounded regions are enough and reserve
`daemon_native_full_screen_input_capture` as the authoritative future primitive
for full-screen capture.

### Repo Development Workflow

`aos dev` is the developer workflow router for this repo. `classify` and
`recommend` are read-only and do not start the daemon.

```bash
./aos dev classify --json
./aos dev recommend --json
./aos dev recommend --paths src/main.swift,packages/toolkit/runtime/canvas.js --json
./aos dev capabilities list --json
./aos dev capabilities explain dev.github.issue_comment --json
./aos dev capabilities explain dev.github.pr_checks --json
./aos dev docks list --json
./aos dev docks capabilities foreman --json
./aos dev build
./aos dev gh context --json
./aos dev gh issue list --state open --limit 50 --milestone v0 --json
./aos dev gh label list --limit 50 --search governance --json
./aos dev gh pr list --state all --limit 30 --json
./aos dev gh issue comment 298 --body-file /tmp/comment.md
./aos dev gh issue create --title "Follow-up tracker" --body-file /tmp/issue.md
./aos dev gh issue close 298 --reason completed
./aos dev gh issue edit 298 --remove-label lane:active --add-label lane:parked
./aos dev gh pr merge 410 --merge --match-head-commit abc123
./aos dev gh ci inspect --pr 298 --json
./aos dev gh review-comments --pr 298 --json
```

`classify` reports changed files, matched rules, classes, actions, and whether
the set is hot-swappable or TCC-sensitive. `recommend` adds ordered commands
and verification steps. The rules live in `docs/dev/workflow-rules.json` and
are validated by `shared/schemas/dev-workflow-rules.schema.json`.

`build` wraps the repo `build.sh`, forces `--no-restart` unless the caller has
already passed it, and reports whether the repo-mode `./aos` binary was rebuilt
in JSON mode. Dock hooks do not automate post-build TCC handling: they do not
reset permissions, open System Settings, show a manual-intervention surface, write
completed-build markers, or inject provider input. Repo-mode binary rebuilds
are Foreman-owned and intentionally rare.

`capabilities` is read-only discovery over
`docs/dev/agent-capabilities.json`. It lists or explains typed agent
capabilities, including whether a capability uses a typed AOS surface or an
explicit raw-process adapter. It does not execute capabilities or grant
permissions.

`docks` is read-only discovery over `session metadata`. It lists or explains
dock profiles and can resolve a dock's profile against
`docs/dev/agent-capabilities.json` for the active tooling context. This keeps dock
identity, tooling-context defaults, and allowed capability classes explicit without
turning the profile into a rigid executor.

`dev gh` is the repo GitHub control surface. It deliberately uses the real
`gh` executable from `PATH`, the user's existing `gh` authentication, and the
local git checkout to infer `owner/repo` unless `--repo owner/name` is supplied.
Direct operations such as `issue list`, `issue view`, `issue comment`,
`issue create`, `issue close`, `issue edit`, `label list`, `pr list`, `pr view`,
`pr checks`, `pr comment`, and `pr merge` forward to `gh` and preserve its exit
behavior. List operations expose the repo-safe inventory filters Foreman and
Implementer need most often: issue and PR lists support `--state`, `--limit`,
`--label`, `--author`, `--assignee`, and `--search`, plus issue-specific
`--milestone` and PR-specific `--base`, `--head`, and `--draft`; label lists
support `--limit`, `--search`, `--sort`, and `--order`. Write operations are
non-interactive: `issue create` requires `--title` and `--body-file`,
`issue close` requires an issue number and optionally accepts `--reason`, and
`issue edit` requires an issue number and at least one explicit edit flag:
`--add-label`, `--remove-label`, `--add-assignee`, `--remove-assignee`,
`--milestone`, `--title`, or `--body-file`. `pr merge` requires a PR number
and exactly one of `--squash`, `--merge`, or `--rebase`; use
`--match-head-commit` when merging a reviewed head. The
composite helpers cover repo-specific repeated loops:
`ci inspect` reads PR checks and fetches failed GitHub Actions logs when the
check links to an Actions run, while `review-comments` uses `gh api graphql` to
read review-thread resolution state.

### Wiki Repo Docs Projection

`aos wiki project-docs` projects a curated manifest of canonical Git docs into
the runtime wiki as generated orientation pages:

```bash
./aos wiki project-docs --dry-run --json
./aos wiki project-docs --manifest docs/wiki/repo-docs-projection-v0.json
```

The source-controlled V0 manifest lives at
[`docs/wiki/repo-docs-projection-v0.json`](../wiki/repo-docs-projection-v0.json).
Generated pages are written under `aos/concepts/repo-doc-*.md` so the existing
wiki index, search, show, and graph surfaces can see them without adding a new
namespace. Each page uses `type: repo_doc` and carries `generated: true`,
`projection: repo_docs_v0`, `source_path`, `source_hash`, `source_type`, tags,
and controlled concepts. The page body repeats that Git docs are canonical,
records source metadata, includes deterministic concept links to related
projected pages, and embeds the source Markdown content without summarization.

### 2. Create a Persistent Canvas

```bash
aos show create \
  --id demo \
  --at 100,100,320,200 \
  --interactive \
  --html '<div style="padding:16px;color:white">hello</div>'
```

Common follow-ups:

```bash
aos show update --id demo --at 150,120,320,200
aos show eval --id demo --js 'document.body.style.opacity = "0.7"'
aos show remove --id demo
```

`show remove --id <root>` is the daemon-facing cleanup primitive for a selected
canvas lifecycle tree. Removing a root canvas removes cascade-owned child
canvases and daemon input regions owned by those canvases. Children created
with `cascade: false` are detached and preserved, and unrelated canvases such as
developer/admin tools remain untouched because they are outside the selected
tree. Toolkit resources that are not daemon state, such as shared
DesktopWorld-stage layers, must be cleaned up by their toolkit resource scope;
see [toolkit/runtime.md](./toolkit/runtime.md).

### Reload an Existing Canvas From Current Content

When you change web assets under an active content root, reload the existing
canvas by updating it to the same `aos://` URL, then gate on `show wait`:

```bash
aos show update --id inspector --url 'aos://toolkit/components/inspector-panel/index.html'
aos show wait --id inspector --manifest inspector-panel
```

This is the canonical reload workflow for existing URL-backed canvases. It does
not remove or recreate the canvas, so unrelated developer/admin surfaces such as
`surface-inspector` are not disturbed. When the update only supplies `--url`,
AOS preserves the canvas id, frame, DesktopWorld segments/track/surface when
applicable, scope, interactivity, window level, parent relationship, and any
active TTL timer. The page reloads through the current active content server
root for the URL host.

If the content root is not live, make that explicit before reloading:

```bash
aos content wait --root toolkit --auto-start
```

Topic worktrees should use branch-scoped root names from
`scripts/aos-content-scope.sh` or pass explicit root query parameters where the
surface supports them. Do not overwrite canonical `content.roots.toolkit` or
`content.roots.sigil` from a topic worktree just to refresh a canvas.

For inline `--html` or `--file` canvases, `show update --html ...` or
`show update --file ...` replaces the content in place. `--file` is resolved by
the CLI at update time, so repeat the `--file` update after editing the file.
Use `show wait` after either form when the reloaded page has a readiness
manifest or observable JavaScript condition.

### 3. Load Toolkit Content Through the Content Server

Use the canonical `toolkit` root for `main` or installed examples. Topic
worktrees should use branch-scoped root names so one singleton daemon can serve
multiple sessions without root collisions.

```bash
aos set content.roots.toolkit packages/toolkit
aos content wait --root toolkit --auto-start
aos show create \
  --id inspector \
  --at 100,100,320,250 \
  --interactive \
  --url 'aos://toolkit/components/inspector-panel/index.html'
aos show wait --id inspector --manifest inspector-panel
aos show post --id inspector --event '{"type":"inspector-panel/bootstrap","payload":{"note":"hello"}}'
```

### 4. Coordinate Through Channels or Direct Session Messaging

```bash
aos tell handoff "task complete"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
aos tell --who
aos listen handoff
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
```

## Subcommand Reference

## IPC Contract

Wire-level request/response contract between the CLI and daemon is specified in
[`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md). Agents and
tools that talk to the daemon directly (SDKs, MCP adapters) should use the v1
envelope there.

## `aos see`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `cursor` | inspect what is under the cursor |
| `capture` | capture a target display/window/region |
| `observe` | stream perception events from the daemon |
| `list` | enumerate capture/display targets |
| `selection` | interactive region selection |
| `zone` | zone helpers |

Shorthand capture is supported:

```bash
aos see main
aos see external 1
aos see capture --canvas surface-inspector --perception
aos see capture --canvas sigil-radial-menu --xray
aos see capture --region 1172,442,320,480 --perception
```

Useful capture modifiers include:

- `--window` to restrict `user_active`/window captures to the window frame
- `--region <x,y,w,h>` for explicit CG-coordinate regions
- `--canvas <id>` / `--channel <id>` for surface-relative captures
- `--exclude-window <CGWindowID>` to omit specific windows from a display/region capture
- `--perception` to attach spatial metadata alongside the image payload

Capture responses include an opaque `state_id` such as `see_abc123def456`.
Work-record and recipe layers can carry that id into the next action as the
perception state the agent acted from. The id is a correlation handle, not a
stable object reference or cache key.

`aos see cursor` returns the cursor point, display ordinal, the frontmost
visible window under the cursor when available, and an optional AX `element`.
When present, the element includes `role`, `title`, `label`, `value`, `enabled`,
`bounds`, raw `action_names`, raw `settable_attributes`, and raw
`ancestor_chain` entries. It does not synthesize user-facing capability labels
or breadcrumb vocabulary in the binary. Toolkit and app layers derive labels,
lineage, and normalized capabilities such as `press`, `focus`, `set_value`,
`scroll`, `increment`, or `decrement` from those raw AX facts. The
capture-pipeline cursor response uses the same raw AX element fields when it can
resolve the element explicitly under the cursor.

`--xray` returns raw visible bounded AX elements in `elements`; the daemon does
not role-whitelist them into an "interactive" vocabulary. For AOS-owned canvas
captures, `aos see capture --canvas <id> --xray` also runs a fixed semantic
target probe inside that canvas and returns `semantic_targets`. Those entries
use the canonical `agent_ui_target` envelope: top-level `ref`, `state_id`,
`surface`, `role`, `name`, `kind`, `enabled`, `target`, `state`, `actions`,
`extension`, `provenance`, and `reacquisition`. `ref` is the state-scoped
action handle. Durable machine identity lives in `target.target_id` scoped by
`target.owner_namespace`; human labels, accessible text, local DOM ids, canvas
id, parent canvas id, local geometry, metadata, and the
`canvas:<canvas-id>/<ref>` action-routing string are presentation,
provenance/current-address, or hint fields. They are not durable identity. The
current V0 producer emits or consumes descriptor fields when it can derive them;
older or partial AOS-owned surfaces may omit some fields until their producers
migrate. The probe does not use caller-supplied JavaScript; `show eval` remains
a developer diagnostic bridge, not the agent perception contract.

See [`shared/schemas/aos-semantic-targets.md`](../../shared/schemas/aos-semantic-targets.md)
for the response shape.

`--perception` augments the capture response with:

- global capture bounds
- local capture bounds in the emitted image
- composite capture scale
- per-display surface segments when a region/canvas/channel spans multiple displays
- a `spatial-topology` snapshot for the same moment

## `aos show`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `create` | create a canvas |
| `update` | mutate an existing canvas |
| `remove` | remove one canvas |
| `remove-all` | remove all canvases |
| `list` | list active canvases |
| `get` | fetch one canvas by id |
| `exists` | existence check for one canvas |
| `eval` | run JavaScript in a canvas |
| `render` | render HTML to an image without a persistent canvas |
| `listen` | persistent daemon stream / command pipe |
| `ping` | daemon liveness |
| `to-front` | raise canvas z-order |
| `post` | channel message post |

`create` accepts the main consumer-facing placement/content modes:

- `--id <name>`
- `--at x,y,w,h`
- `--html <html>`
- `--file <path>`
- `--url <url>`
- `--interactive`
- `--focus`
- `--ttl <duration>`
- `--scope connection|global` (default: `global`)
- `--track union`
- `--surface desktop-world` — canonical alias for `--track union`

`--surface desktop-world` and legacy `--track union` create one logical
DesktopWorld surface backed by one physical segment per active display. The
canvas keeps a single `id`; `show list` exposes a `segments` array with ordered
`{display_id,index,dw_bounds,native_bounds}` entries. Normal panels and `--at`
canvases are unchanged and do not carry `segments`. Existing normal canvases
cannot be converted into DesktopWorld surfaces with `show update`; remove and
recreate the canvas so it boots with the segmented backing.

`show list` and `show get` also expose `windowNumbers`, the native macOS window
number or numbers backing a canvas. Perception commands use this to keep
canvas-scoped captures and `--xray` AX traversal attached to the intended AOS
surface instead of falling back to the frontmost app.

## `aos recipe`

`recipe` is the source-backed executable recipe surface. It sits above
primitive verbs such as `status`, `show`, and `see`, and it can also run
repo-owned helper scripts through typed `shell` blocks. It keeps primitive
command and script references visible so agents can inspect what will run.
`aos ops` remains a compatibility alias while old callers are retired; see
[ADR-0013](../adr/0013-aos-execution-model-v0.md) for the AOS Execution Model
and alias removal gate.

| Subcommand | Purpose |
| --- | --- |
| `list` | list discoverable source-backed recipes |
| `explain <id>` | show the structured recipe plan |
| `dry-run <id>` | statically expand and validate a recipe without side effects |
| `run <id>` | execute a recipe |

V1 examples:

```bash
aos recipe list --json
aos recipe explain runtime/status-snapshot --json
aos recipe dry-run runtime/status-snapshot --json
aos recipe run runtime/status-snapshot --json
aos recipe dry-run sigil/start --json
```

`recipe dry-run` is static in v1: it does not start daemons, create canvases,
mutate resources, or run read-only observation probes. It validates the recipe,
resolves declared resources, verifies external help-manifest command
references and static repo shell script paths, and returns the planned blocks,
resource ownership, parameters, and cleanup plan. Without `--json`, it emits a
concise text plan.

`recipe run` supports read-only recipes, mutating canvas recipes with explicit
owned cleanup, and bounded repo-owned shell helpers for runtime/Sigil startup.
Owned resources that require cleanup, such as canvases, must be cleaned by
`finally` steps that only target resources declared by the current run. Runtime,
configuration, process, and surface ownership is reported as local live state
without pretending that every mutation has a cleanup action. Without `--json`,
successful runs emit a concise text summary.

`--json` follows the global process contract: success and dry-run success emit
JSON on stdout with exit code `0`; failure or partial cleanup emits JSON on
stderr with non-zero exit.

## `aos do`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `click` | click coordinates, browser refs, or AOS canvas semantic refs |
| `hover` | move cursor |
| `drag` | drag between coordinates or AOS canvas semantic refs |
| `scroll` | scroll at a point |
| `type` | type text |
| `key` | key combo |
| `press` | semantic AX press |
| `set-value` | semantic AX or AOS canvas semantic set-value |
| `focus` | semantic AX focus |
| `raise` | raise an app/window |
| `move` | move a window |
| `resize` | resize a window |
| `tell` | AppleScript verb |
| `session` | interactive action session |
| `profiles` | inspect behavior profiles |

`click` supports three target forms:

```bash
aos do click 500,300
aos do click browser:<session>/<ref>
aos do click canvas:<canvas-id>/<ref> --state-id <id>
```

Use `canvas:<canvas-id>/<ref>` when a target was discovered in
`aos see capture --canvas <canvas-id> --xray`. Agents should pass
`semantic_targets[].provenance.do_target` directly when present;
`provenance.canvas_id` and `ref` remain available for structured filtering.
When the originating descriptor also has `state_id`, pass `--state-id <id>` so
the actuator can detect stale state when that check is available. The CLI
resolves the current AOS-owned canvas semantic target through the fixed probe
path, rejects missing, disabled, stale, ambiguous, suspended, noninteractive,
or unsupported segmented canvases with machine-readable errors, and then
clicks the resolved `provenance.center` in global CG coordinates. V0 preserves
historical `state_id` as correlation metadata; the descriptor contract already
defines stale-ref status so future producers can reject a stale state/ref pair
without changing target vocabulary.

Coordinate, browser-target, and canvas-ref actions accept `--state-id <id>` when
the action was chosen from a prior `aos see capture` response. Direct one-shot
responses and session responses report an additive `execution` object:

```json
{
  "execution": {
    "strategy": "cgevent_click",
    "backend": "cgevent",
    "fallback_used": false,
    "state_id": "see_abc123def456"
  }
}
```

`strategy` names the path that actually ran, `backend` identifies the actuator
family (`cgevent`, `ax`, `applescript`, `playwright`, `canvas`, or `session`), and
`fallback_used` is reserved for paths that intentionally degrade from a
preferred semantic strategy. `duration_ms` remains the top-level timing field on
session responses.

Canvas ref click responses also include the resolved target details, including
the target dialect, canvas id, ref, local semantic-target center, global click
point, coordinate space, capture scale factor, and source
`aos_semantic_targets`. Coordinate fallback remains available for surfaces that
do not expose a semantic ref or for unsupported segmented canvases.

`set-value` and `drag` also accept current AOS canvas semantic refs:

```bash
aos do set-value canvas:<canvas-id>/<slider-ref> <value>
aos do set-value canvas:<canvas-id>/<slider-ref> --value <value>
aos do drag canvas:<canvas-id>/<drag-handle-ref> --by <dx>,<dy>
aos do drag canvas:<canvas-id>/<slider-ref> --to-value <value> --playback human
```

Playback modes are `--playback immediate`, `--playback human`, and
`--playback auto`. `auto` prefers immediate semantic execution for AOS-owned
canvas controls. Coordinate actions and `--playback human` continue to require
the input-tap preflight. Immediate canvas semantic actions resolve the current
target at action time and do not require agents to choose or pass target
coordinates.

For V0, single-thumb toolkit sliders support immediate `set-value` and
`drag --to-value` through the canvas semantic action route. Multi-thumb sliders
advertise `drag` but not single-value `set-value` unless a future thumb-specific
target exists. Toolkit panel drag handles support immediate `drag --by` by
updating the current canvas frame; `--playback human` resolves the current
target center and uses CGEvent as a visible playback implementation detail.

Target-addressed responses include the action, backend, playback mode,
`execution.strategy`, `execution.backend`, `execution.fallback_used`, the
correlation `state_id` when supplied, resolved target details, and post-action
semantic state when the target can be collected after execution. Stale
state/ref pairs report a machine-readable `stale_ref` status. Descriptor-based
reacquisition may report `reacquired` only after one current target is found
through machine facts first; same-label matches without a unique machine
fingerprint report `ambiguous` with candidates instead of selecting one.

Gesture frames and Work Recording references should carry the same descriptor
vocabulary: the state-scoped `ref`/`state_id`, durable
`target.target_id` scoped by `target.owner_namespace`, primitive `actions`,
current `state`, `provenance` for the current address, and `reacquisition`
fingerprints for repair. They should not promote labels or coordinates into
durable target identity.

For the design split between action intents, execution results, optional
gesture evidence, state patches, and Work Recording replay plans, see
[`docs/design/aos-interaction-grammar-v0.md`](../design/aos-interaction-grammar-v0.md).

## `aos graph`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `displays` | enumerate displays with logical `bounds`, `visible_bounds`, scale, and main-display marker |
| `windows` | enumerate visible windows, optionally scoped to one display |
| `deepen` | expand one focus-channel subtree |
| `collapse` | collapse one focus-channel subtree |

Example:

```bash
aos graph displays
```

`displays[].visible_bounds` uses the same top-left-origin logical coordinate
space as `bounds`, but reflects the usable display area after macOS menu bar /
dock insets.

## `aos say`

Voice output surface:

```bash
aos say "Hello"
aos say --voice-slot 1 --language en --quality-tier premium,enhanced "Hello"
aos say --list-voices
```

`aos say` is a direct TTS convenience path conceptually aligned with speaking to
the human. `aos tell human ...` is daemon-routed communication; consumers that
need routed communication, session metadata, channels, or future sinks should
prefer `aos tell`.
Use `--voice <id>` to select a concrete voice id, or `--voice-slot <n>` to
select the nth currently speakable voice after any `--language`, `--gender`,
and `--quality-tier` filters are applied. `--quality-tier` accepts repeated
flags or comma-separated values. Voice slots are 1-based for human readability.
Slot selection is intentionally ordinal: if the filtered speakable voice list
changes, the same slot can resolve to a different voice. If filters produce no
speakable voices, normal CLI use fails with `VOICE_FILTER_EMPTY`.

## `aos voice`

Inspect the registry-backed session voice catalog, provider availability, live
assignments, and final-response ingress:

```bash
aos voice list [--provider <name>] [--speakable-only]
aos voice assignments
aos voice bind --session-id <id> [--voice <voice-id>]
aos voice next --session-id <id>
aos voice refresh
aos voice providers
printf '%s' "$HOOK_JSON" | aos voice final-response --harness codex --session-id <id>
```

`aos voice` is backed by a provider-pluggable `VoiceRegistry`. The default
catalog includes:

- `system` — local `NSSpeechSynthesizer` voices
- `elevenlabs` — a catalog-only stub provider used for selection, validation,
  and future remote synthesis wiring

Voice selection is intentionally simple. A session keeps its explicitly bound
voice when it has one; otherwise the daemon rotates through a filtered pool of
speakable voices using a persistent integer cursor. The filter is driven by
`voice.filter.language` (default `en`) and `voice.filter.tiers` (default
`["premium", "enhanced"]`) in `config.json`; the cursor lives in `voice/policy.json`
and advances by one on each session-start assignment. Voices are reusable across
sessions. If the filter yields zero matches, the daemon falls back to a random
allocatable voice and records a `filter_empty` voice event. Cursor-picked
restored sessions whose persisted voice is no longer in the filtered pool have
that voice dropped on daemon startup (recorded as a `restore_voice_dropped`
voice event); the next session re-register re-picks through the cursor.
Explicit `voice.bind` assignments are treated as user-pinned and survive
restore-time revalidation regardless of the current filter. There is no
reservation, lease, or promotion model.

Voice identifiers are canonical URIs of the form
`voice://<provider>/<provider_voice_id>`. Commands accept either URI form or
legacy bare ids on input; responses emit canonical URIs for descriptor `id`
while keeping `provider_voice_id` as the provider-native suffix.

`aos voice list` returns the current registry snapshot. Use `--provider` to
filter to one provider and `--speakable-only` to drop catalog-only entries that
cannot currently synthesize. Records include provider metadata, canonical `id`,
provider-native `provider_voice_id`, availability, capabilities, locale, and
quality tier.

`aos voice assignments` returns the active session-centric assignments.

`aos voice bind` stores a concrete voice for a live session. If you omit
`--voice`, it will choose a random enabled + speakable voice, optionally
filtered by simple fields such as `--provider`, `--gender`, `--tag`, `--kind`,
`--locale`, `--language`, `--region`, or `--quality-tier`. Bind failures return
one of three machine codes:

- `VOICE_NOT_FOUND`
- `VOICE_NOT_SPEAKABLE`
- `VOICE_NOT_ALLOCATABLE`

`aos voice next --session-id <id>` cycles the session's voice forward within the
filtered pool without touching the global cursor, and auditions the new voice
by speaking `"Hi, I'm <name>."` through the system speech engine. If the
session's current voice is in the filtered pool, the next pick is the neighbour
one step ahead (wrapping around); if it is not in the pool (for example because
tiers changed), the daemon advances the global cursor to pick the next
rotation voice instead. `aos voice next` returns `SESSION_NOT_FOUND` when the
session is unknown and `VOICE_NOT_FOUND` when the pool is empty.

`aos voice refresh` forces a fresh provider enumeration. `aos voice providers`
lists provider reachability, policy enablement, and voice counts.

Voice policy lives at `~/.config/aos/{mode}/voice/policy.json` and is split
into four sections:

- `providers` — per-provider enable/disable gates
- `voices.disabled` — canonical voice ids to suppress from rotation, random fallback, and filter-based selection
- `session_preferences` — durable `session_id -> voice_uri` bindings
- `voice_cursor` — integer rotation cursor advanced on each new-session assignment

`aos voice final-response` is unchanged as the daemon-owned ingress for harness
final-response events. It resolves the final assistant text, applies the
configured `final_response` speech policy, and routes speech through the
session's assigned voice while keeping daemon cancel controls active.

Voice deliveries and final-response ingress failures append local JSONL records to
`~/.config/aos/{mode}/voice-events.jsonl` so operators can inspect which session,
voice, purpose, and failure code were involved without storing full message bodies.

Docked sessions should use registered role session ids for true final-response
TTS instead of provider-transient hook ids. Dock Stop-hook notices are fixed
role-local status messages, not the assistant's final answer; route those
through `aos say --voice-slot <n> "<notice>"` rather than
`aos voice final-response`.

## `aos config`

Discoverable configuration surface:

```bash
aos config
aos config get voice.enabled
aos config get content.port --json
aos config get see.canvas_inspector_bundle --json
aos config set voice.enabled true
aos config set voice.filter.language en
aos config set voice.filter.tiers premium,enhanced
aos config set see.canvas_inspector_bundle.hotkey cmd+shift+x
aos config set see.canvas_inspector_bundle.output.mode clipboard_payload
aos config set see.canvas_inspector_bundle.include.annotation_snapshot false
```

`aos config` dumps the current runtime config as JSON. `aos config get` defaults
to shell-friendly scalar text and accepts `--json` when you want JSON output.
Discoverable config subtrees include the Surface Inspector see-bundle surface
under the `see.canvas_inspector_bundle.*` namespace, including the export
hotkey, output mode, and bundle artifact include toggles.
`see.canvas_inspector_bundle.output.mode` defaults to `bundle_path`, which writes
the temp bundle directory and copies its path to the clipboard. Set it to
`clipboard_payload` to skip the temp bundle directory and copy a JSON handoff
payload with inline metadata and explicit skipped capture-file evidence instead.
The default-on
`see.canvas_inspector_bundle.include.annotation_snapshot` toggle controls the
public `annotation-snapshot.json` artifact recorded in
`bundle.json.files.annotation_snapshot_json`. The artifact keeps the shared
display-first annotation session boundary as point-in-time evidence, including
root/scope stacks, hover preview evidence, anchors/comments, projection
stale/blocker status, and successful snapshot count; it does not persist live
annotations for later reuse. Bundle-path exports also write canonical
`context-session.json` and `context-keyframe.json` files, recorded in
`bundle.json.files.context_session_json` and
`bundle.json.files.context_keyframe_json`; clipboard-payload exports include
inline `context_session` and `context_keyframe` fields or explicit skipped
evidence. These canonical context fields are the machine-readable convergence
path for future recordings. `annotation-snapshot.json` and
`surface_inspector_annotation_snapshot` remain compatibility data until a later
removal gate confirms downstream consumers have migrated.

Sigil radial camera exports now prefer Sigil's renderer-local active context
provider when present. Reticle commits, live Selection Mode commits, and debug
compatibility adapters can all publish the latest `aos_context_session` plus an
active keyframe candidate to that provider, while `ctrl+opt+c` continues to
derive canonical Surface Inspector context inside the daemon bundle path. The
provider is not yet daemon-visible; that event/state channel is the explicit
next removal gate for making active context available to all AOS apps.

`aos set <key>
<value>` remains supported as the shorthand write form.

Failed CLI invocations now append local JSONL records to
`~/.config/aos/{mode}/cli-errors.jsonl`, which makes it easier to review
discoverability misses like unknown commands or missing arguments over time.

## `aos tell`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<audience>\|--session-id <id> [--json <payload>] [--from <name>] [--from-session-id <id>] [--purpose <name>] [<text>]` | send text or JSON to `human`, a channel, a comma-separated mix, or one canonical session id |
| `--register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]` | register session presence |
| `--unregister [<legacy-name>] [--session-id <id>]` | remove session presence |
| `--who` | list online sessions |

Examples:

```bash
aos tell human "Hello"
aos tell human --from-session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --purpose final_response "Done."
aos tell handoff "task complete"
aos tell human,handoff "done"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
```

If no text args and no `--json` payload are provided, `aos tell` reads plain text from `stdin`.

For `human` delivery, `--from-session-id` lets the daemon resolve that
session's leased voice, and `--purpose final_response` applies the configured
final-response shaping policy before speaking.

Direct routing should prefer canonical session ids. Human-readable names remain display metadata for `aos tell --who` and operator ergonomics.
Presence is lease-based and restored from the runtime snapshot after daemon restart. Discover peers with `aos tell --who`, then keep using direct `--session-id` routing once a peer id is known; direct session messaging does not require `--who` to be non-empty at send time.

Docked role sessions are ordinary registered sessions. Supervisors should
register each role before launch with stable ids such as `<run-id>:implementer`,
include role and harness metadata, and unregister the session after that role
completes. This keeps `aos tell --who`, `aos voice assignments`, and docked
session status aligned around the same role session identity.

## `aos listen`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<channel>\|--session-id <id> [--since id] [--limit N]` | read recent channel or direct-session messages |
| `<channel>|--session-id <id> --follow [--since id]` | stream messages as NDJSON |
| `--channels` | list known channels |

Examples:

```bash
aos listen handoff
aos listen handoff --limit 10
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
aos listen --channels
```

One-shot reads return a JSON envelope with a `messages` array. `--follow` emits one message per line as NDJSON.

## `aos wiki`

Primary public verbs for knowledge-base consumers:

| Subcommand | Purpose |
| --- | --- |
| `list` | enumerate indexed wiki entries |
| `show` | fetch one page by path or bare name |
| `graph` | emit the canonical `wiki-kb` graph payload |
| `search` | full-text search across indexed pages |
| `invoke` | invoke a workflow/plugin entry |

`aos wiki graph --json` is the canonical graph projection for KB surfaces. It returns:

- `nodes`
- `links`
- optional `raw` page bodies when `--raw` is requested
- `config` for default graph-view behavior

`nodes[].type` is the wiki graph page kind, not a Workbench Subject
`subject_type` and not arbitrary raw frontmatter. The V0 page-kind vocabulary is
`page`, `concept`, `entity`, `workflow`, and `reference`. Plugin pages under
`references/` map to `reference`.

## Auxiliary Consumer Surfaces

These are still public, but they are more specialized:

| Command | Use when |
| --- | --- |
| `aos inspect` | you want the built-in live AX overlay |
| `aos log` | you want the built-in log console overlay |
| `aos permissions` | you need low-level permission diagnostics |
| `aos doctor` | you need a fuller runtime health snapshot than `aos status` |
| `aos clean` | `aos status` reports stale resources and you want explicit cleanup |
| `aos daemon-snapshot` | you need the low-level spatial snapshot directly |
| `aos focus` / `aos graph` | you are consuming focus channels / display-window topology |
| `aos wiki` | you are consuming the local wiki/plugin system |

## Daemon Model

`aos` subcommands are normally stateless at the call site, but several surfaces rely on the daemon behind the scenes:

- persistent canvases
- perception observation
- focus channels
- content server hosting

Consumers should assume:

- `aos show`, `aos inspect`, and some graph/focus flows may talk to the daemon
- a persistent canvas outlives the creating command unless it is connection-scoped
- `aos serve` is the foreground daemon entry point
- `aos ready` is the front-door managed-daemon readiness gate
- `aos status` / `aos doctor` are observational; they should not be relied on to
  implicitly start a daemon for the current runtime

## Daemon-aware readiness

The daemon's `system.ping` response carries a structured `input_tap` block
and a `permissions` block sourced from inside the daemon process. Because
the launchd-managed daemon is a different process from the CLI, its TCC
grants can diverge from the CLI's. The fields below are the canonical view
when judging whether the daemon can actually observe and inject input.

```json
"input_tap": {
  "status": "active",        // active | retrying | unavailable
  "attempts": 1,
  "listen_access": true,     // CGPreflightListenEventAccess() in daemon
  "post_access": true,       // CGPreflightPostEventAccess() in daemon
  "last_error_at": null,     // ISO-8601 of most recent CGEventTap failure
  "panic_passthrough_active": false, // legacy name for Force Quit safety window
  "panic_passthrough_until": null,
  "panic_trigger": null,
  "panic_trigger_count": 0
},
"permissions": {
  "accessibility": true      // AXIsProcessTrusted() in daemon
}
```

Consumers:
- `aos ready [--json] [--repair] [--post-permission]` first performs a cheap
  daemon health preflight. When the managed daemon is already reachable, owned
  by the expected runtime, and reports an active input tap, `ready` exits without
  kickstarting or restarting the service and records `ready_preflight` in
  `action_trace`. If the preflight is not ready, `ready` may start the managed
  daemon, evaluates the existing readiness contract, exits `0` only when ready,
  and returns structured `phase`, `diagnosis`, `blockers`, `next_actions`, and
  `action_trace` fields for agents. Plain `ready` performs one short automatic
  daemon restart/recheck when it detects a daemon ownership mismatch or inactive
  input tap, because those states commonly appear after a human refreshes macOS
  privacy grants. Human-required Accessibility/Input Monitoring reset handoffs
  should use `./aos permissions reset-runtime --mode repo` before Settings: it
  stops the managed daemon, verifies `running=false`, then either runs a real
  targeted TCC reset for a targetable runtime identity or reports targeted reset
  unavailable for the bare repo binary. Manual Settings removal is fallback only
  if that command reports targeted reset is unavailable or failed.
  `--post-permission` is the explicit
  agent handoff check after the human has re-granted Accessibility or
  Input Monitoring access; it is bounded and reports the remaining blocker
  instead of encouraging repeated ad-hoc repair loops. `--repair` runs the
  longer safe recovery path, but stale daemon owners are cleaned before service
  start/restart and unmanaged socket owners are reported as PID/command facts
  instead of restart loops. For restartable daemon states, repair may restart,
  wait/recheck, then report plain-English human instructions when macOS privacy
  settings still require manual action. It does not open Settings or show
  permission dialogs by itself.
- `aos permissions reset-runtime [--mode repo|installed] [--allow-service-reset --emergency-ack-other-apps] [--dry-run] [--json]`
  is the preferred repo-development TCC reset transaction. It does not grant
  permissions. It stops the managed daemon first, then either resets the runtime
  identity's TCC decisions with `tccutil reset All <identifier>` or explicitly
  classifies targeted reset as unavailable for a bare repo binary that is not a
  LaunchServices app bundle. It returns next actions:
  `aos permissions setup --once` to request fresh prompts and
  `aos ready --post-permission` to verify the recovered daemon. Service-wide TCC
  reset is not part of normal recovery because it can affect other apps. It is a
  break-glass capability only: `--allow-service-reset` requires
  `--emergency-ack-other-apps` and should be used only when Michael explicitly
  asks for emergency recovery.
- When the daemon detects missing Accessibility/Input Monitoring permissions,
  its event tap must fail open and remain unavailable until daemon restart
  rather than running a background retry loop. This keeps reset/regrant recovery
  from re-enabling input capture while the human is changing macOS privacy
  grants. Non-permission tap creation failures may still report `retrying`.
- `aos permissions check --json` exposes `daemon_view`, `cli_view`,
  `ready_source`, and `disagreement` fields. `ready_for_testing` is computed
  from the daemon view when reachable and from the CLI view as fallback.
  The top-level `permissions` object is the CLI-side view and includes
  `accessibility`, `screen_recording`, `listen_access`, and `post_access`.
  The daemon-side Accessibility and Input Monitoring view remains under
  `daemon_view` / `runtime.input_tap`; daemon Screen Recording is not reported.
- `aos permissions setup --once` checks the full CLI permission set
  (Accessibility, Screen Recording, Input Monitoring listen, Input Monitoring
  post). If the CLI grant is present but the daemon reports stale or missing
  daemon-owned grants, setup returns degraded with the same reset-runtime
  guidance instead of silently declaring onboarding complete.
- The permissions onboarding marker is mode-scoped and proves the operator has
  completed the setup flow for that runtime mode. The marker's recorded
  `bundle_path` is diagnostic only: in repo mode, readiness does not fail solely
  because another worktree last wrote the marker when the current CLI grants and
  daemon input tap are verified green.
- `aos ready --json`, `aos status --json`, and `aos doctor --json` expose
  `runtime_verdict` as the shared readiness/action-plan contract:
  `ready`, `phase`, `diagnosis`, `blockers`, `blocked_capabilities`, `notes`,
  `next_actions`, `ownership`, and `cleanup`.
- When `runtime.ownership_state` is `"unmanaged"`, JSON exposes
  `runtime.owner_process` and `runtime_verdict.ownership.owner_process`.
  The process command line is either present as `command_line` or explicitly
  unavailable via `command_line_status` and
  `command_line_unavailable_reason`.
- `aos status --json` exposes `runtime.input_tap` (full block) plus the
  legacy flat `runtime.input_tap_status` / `runtime.input_tap_attempts`.
- `aos status` text mode includes `tap=<status>` in the one-line summary.
- `aos doctor --json` exposes top-level `ready_for_testing` and
  `ready_source`.
- `aos service install`, `start`, and `restart` block-and-poll for up to 5s
  after launchctl kickstart and exit non-zero with `reason: "input_tap_not_active"`
  or `"socket_unreachable"` when the daemon is not fully ready.
- `aos do click/type/...` preflight exits with `INPUT_TAP_NOT_ACTIVE` when
  the daemon is reachable but its tap is inactive.

Test entry point: `aos service _verify-readiness [--json] [--budget-ms N]`
runs the readiness probe against the running daemon and emits the same
response shape `service install/start/restart` produce. Used by
`tests/input-tap-readiness-classifier.sh`. Not advertised in user help.

Example readiness response (`service _verify-readiness --json` against a
mock daemon reporting `tap=retrying`):

```json
{
  "status": "degraded",
  "mode": "repo",
  "installed": true,
  "running": true,
  "pid": 12345,
  "launchd_label": "com.agent-os.aos.repo",
  "expected_binary_path": "/Users/.../aos",
  "actual_binary_path": "/Users/.../aos",
  "plist_path": "/Users/.../Library/LaunchAgents/com.agent-os.aos.repo.plist",
  "state_dir": "/Users/.../.config/aos/repo",
  "reason": "input_tap_not_active",
  "input_tap": {
    "status": "retrying",
    "attempts": 3,
    "listen_access": false,
    "post_access": false
  },
  "recovery": [
    "./aos service restart",
    "./aos permissions setup --once",
    "./aos serve --idle-timeout none"
  ],
  "notes": [
    "Input tap is not active (status=retrying, attempts=3). Try: ..."
  ]
}
```

When the readiness probe outcome is `.ok`, the `reason`, `recovery`, and
`input_tap.last_error_at` fields are absent (omitted from JSON via
`encodeIfPresent`). The top-level `status` may still be `"degraded"` if
the launchd-derived base state has unrelated divergences (e.g., plist
binary path mismatch); discriminate `.ok` outcomes by absence of `reason`
plus `input_tap.status == "active"`.

### Legacy daemon interop

A daemon binary that predates this contract emits only the flat
`input_tap_status` / `input_tap_attempts` fields, with no structured
`input_tap` or `permissions` block. The CLI parser falls back to those
flat fields so `status` / `attempts` still propagate. Fields the legacy
daemon doesn't expose — `input_tap.listen_access`, `input_tap.post_access`,
`input_tap.last_error_at`, and `permissions.accessibility` — are
**omitted** from CLI output rather than fabricated as `false`. Consumers
should treat their absence as "unknown, not denied."

In that mode, the source label depends on which side provides the decisive
answer:

- When the reachable legacy daemon reports `input_tap.status == "active"`,
  `aos permissions check` and `aos doctor` fall back to
  `ready_source: "cli"` because daemon accessibility is still unknown.
- When the reachable legacy daemon reports `input_tap.status != "active"`,
  `ready_for_testing` is forced to `false` and `ready_source: "daemon"`
  because the daemon-owned tap status is sufficient to fail readiness
  closed, even though daemon accessibility remains unknown.

**See also:**
- [`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md) for the canonical `system.ping` payload schema.
- [`shared/schemas/CONTRACT-GOVERNANCE.md`](../../shared/schemas/CONTRACT-GOVERNANCE.md) for the contract rules these consumers follow.

## Content Server Contract

Toolkit and app canvases are typically loaded through `aos://...` URLs backed by the content server.

Minimal setup:

```bash
aos set content.roots.toolkit packages/toolkit
```

In topic worktrees, use `scripts/aos-content-scope.sh` or a branch-aware launch
script to derive a root such as `toolkit_codex_example` instead of overwriting
canonical `toolkit`.

Then:

```bash
aos show create \
  --id surface-inspector \
  --at 200,200,320,480 \
  --interactive \
  --url 'aos://toolkit/components/surface-inspector/index.html'
```

Read-only virtual wiki graph endpoint:

- `GET /wiki/.graph`
- `GET /wiki/.graph?raw=1`

## Guidance For Consumers

- Prefer structured flags and JSON parsing over scraping help output.
- Treat `docs/api/` as the consumer contract. Use `docs/design/` for active
  design work and `docs/archive/superpowers/` only for historical context.
- If you change a public command, update this doc in the same change.

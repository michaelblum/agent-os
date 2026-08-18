# `aos` CLI API

Consumer-facing reference for the unified `aos` binary.

Use this doc when you are:

- writing agents that shell out to `aos`
- building wrappers around `aos`
- reviewing changes that affect the public CLI contract

For architecture and philosophy, see [ARCHITECTURE.md](../../ARCHITECTURE.md).
For capability-group discovery, see
[`aos-capabilities.md`](./aos-capabilities.md), which frames AOS as
"Playwright CLI, but for the desktop." That file also owns the
[user-facing state model](./aos-capabilities.md#user-facing-state-model) for
sessions, workspaces, focus channels, runtime state, Work Records, content
roots, and evidence state.

> **Sovereign-capability authority pointer:** ADR 0043 owns the target and
> ADR 0044 owns the operation-plane owner, resource, recovery, and same-UID host
> control bindings. The `aos operation` and `aos record` sections below are
> executable truth for the Milestone 2 plane and bounded M3A screen-video
> adapter. Fixed browser operations and
> direct-capture priming remain burn-down baseline until their later atomic
> milestones land; do not infer that every legacy daemon resource is already a
> registered operation.

## Repo Development Entry Points

When you are developing inside the `agent-os` repo, invoke the binary as
`./aos`, not bare `aos`.

Start here:

```bash
./aos ready
./aos help <command> [--json]
./aos introspect review
```

`./aos ready` is the primary runtime readiness entrypoint. Plain `ready` is
read-only: it checks the managed daemon and exits non-zero when AOS is not ready.
Use `./aos ready --repair` when readiness may clean, start, or restart the
runtime. Use `./aos status` for a broader read-only runtime snapshot, and use
`doctor`, `daemon-snapshot`, and `clean` for deeper diagnostics or explicit
cleanup rather than as the default first move.

For live repo work, `./aos` is also the first control plane for canvases, Agent
Terminal surfaces, session communication, input routing, and runtime inspection.
Avoid raw daemon HTTP calls, direct PTY/tmux control, launchd probes, or
state-file inspection unless the AOS surface is missing or broken, the task is
testing that lower-level adapter, or the AOS control surface itself is under
repair. Treat those bypasses as scoped diagnostics and say why they were needed.

For reusable maintainer workflows, use retained local skills plus their direct
backing scripts:

```bash
node scripts/aos-dev-situation.mjs --json
node scripts/aos-dev-workflow.mjs recommend --json --paths <changed-paths>
node scripts/aos-dev-build.mjs build --no-restart --json
```

`skills/aos-maintainer-orientation/SKILL.md`,
`skills/aos-maintainer-routing/SKILL.md`, and
`skills/aos-repo-binary-build/SKILL.md` teach those workflows. `aos dev` is
retired from the AOS command surface; do not add or document `./aos dev ...`
forms. For repo GitHub workflows, use `node scripts/aos-dev-gh.mjs`; it shells
out to the authenticated local `gh` CLI and does not fall back to
connector-backed GitHub tools.

## Contract

`aos` is a single binary with Unix-style subcommand groups.

The binary exposes platform primitives, not product policy. For surfaces, the
daemon should provide native lifecycle, display, input, content, and routing
capabilities that any consumer can build on. The default AOS panel/windowing
policy belongs in `packages/toolkit/`, not in app code and not as
product-specific branches inside the daemon. A consumer may use toolkit
windowing, customize it, or bypass it for non-panel surfaces.

### Ambient Authority And Raw Observation

AOS executes with authority already granted by the user to the agent host and
constrained by macOS TCC. It does not add auth tokens, action allowlists, risk
labels, mandatory approvals, mandatory dry-run, Work Record permission, default
core redaction, or assistant/product restrictions. Mechanical correctness still
requires exact identity, stale/missing/ambiguous rejection, bounded resources and
timeouts, exactly-once admission where relevant, cleanup, typed errors, and
receipts.

Facts and channels admitted by each bounded public observation contract are raw
and fidelity-first; facts outside that contract remain outside it. Masking,
redaction, persistence, retention, and model projection are explicit
caller-owned transforms. Gate is an explicit neutral structured-input primitive
and Work Records are optional evidence/history; neither authorizes unrelated
actions. ADR 0040 owns this boundary.

### Current Contract Gaps

The following implementation behavior remains current but is not the target
architecture established by ADR 0040. Fidelity gaps below name facts already
admitted by their bounded public contracts. They do not widen typed receipts,
lifecycle events, scene envelopes, or trusted-realm boundaries to adjacent
inputs, media, source, product state, diagnostics, or private handles:

- Gate persistence still redacts prompt/answer content and continuation source
  metadata by default instead of making projection and persistence an explicit
  caller-owned transform;
- native annotation completion still replaces admitted target `title` and
  `label` fields with `null` instead of preserving their selected values or
  applying an explicit caller transform;
- the semantic-target public decoder still drops the admitted app-local
  `extension.action_id` fact read from singular `data-aos-action`; that fact is
  not a primitive capability and does not populate `actions[]`;
- the Guided User Signal record builder still defaults prompt/answer projection
  to redaction rather than require an explicit caller choice;
- the legacy Supervised Run V0 schema still projects to
  `2026-05-work-record-v0`; it has no Gate field, and the active Step Descriptor
  V1 harness is already neutral, so migration or retirement of that projection
  remains separate schema debt;
- complete public generic-wait, event-cursor subscription, semantic-codegen,
  and generic `run-code` contracts are not yet implemented or claimed.

These are explicit follow-up gaps and do not reopen the completed Work Record
authority-excision or Step Descriptor V1 migrations. This slice does not
implement the Gate persistence refactor, Supervised Run V0 disposition, generic
observation mechanics, or public `run-code` productization.

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
| `aos launch` | manifest-backed source-owned app launcher |
| `aos ready` | read-only front-door readiness gate; `--repair` permits runtime recovery |
| `aos status` | read-only runtime/session status snapshot |
| `aos operation` | generation-bound registered-operation inspection/control and producer-backed screen-recording artifact custody; tap and retain remain typed unavailable |
| `aos record` | bounded fixed display, window, or region screen-video recording to a transient H.264 QuickTime artifact |
| `aos skills` | installable AOS root skills: list, check installed state, install, and dry-run install plans |
| `aos recipe` | source-backed executable recipes: list, explain, dry-run, run |
| `aos work-record` | Work Record V1 discovery, report-only verification, neutral repair/attempt planning, caller-outcome artifact validation, non-executing replacement proposals, explicit-root replacement writing, exact repair finalization, and external source supersession lookup/indexing |
| `aos see` | Perception and artifact verification: cursor state, captures, observation streams, zones, and exact comparison of existing PNG files |
| `aos do` | Action: mouse, keyboard, AX actions, AppleScript, session mode |
| `aos show` | Projection: canvas create/update/remove/list/eval/render |
| `aos scene` | Connection-scoped declarative DesktopWorld scene and gesture stream |
| `aos status-item` | Owner-scoped native status-item lease, compare-and-swap update, observed anchor/event, inspect, and generation-scoped atomic action admission |
| `aos focus` | Focus-channel management |
| `aos gate` | Human input gates and local gate record readback |
| `aos graph` | Display/window graph queries |
| `aos introspect` | Session self-review over recent `./aos` usage |
| `aos help` | Registry and command-specific help |
| `aos say` | Voice output |
| `aos play` | Bounded owner-only audio playback with exact meter events |
| `aos voice` | registry-backed voice catalog, assignments, providers, and session bindings |
| `aos tell` | Communication output: human, channel, or direct session routing |
| `aos listen` | Communication input: channel/direct-session reads, global hotkeys, and bounded microphone capture |
| `aos shortcut` | Bounded execution of one explicitly named Apple Shortcut |
| `aos wiki` | local knowledge-base workflows |
| `aos config` | Discoverable runtime configuration (`get`, `set`, dump) |
| `aos set` | Runtime configuration |
| `aos content` | Content-server status |
| `aos serve` | Unified daemon |
| `aos service` | launchd lifecycle for the daemon |
| `aos experience` | active AOS experience-layer status, activation, and deactivation |
| `aos browser` | public managed Playwright companion lifecycle (`status`, `install`, `update`, and `uninstall`); the internal browser adapter remains non-consumer |
| `aos runtime` | packaged runtime utilities |
| `aos permissions` | preflight and onboarding |
| `aos doctor` | detailed runtime and permission diagnostics |
| `aos clean` | explicit stale daemon / canvas cleanup |
| `aos reset` | cleanup/reset workflows |
| `aos daemon-snapshot` | daemon state snapshot |
| `aos inspect` | live AX inspector overlay |
| `aos log` | log overlay |

## Experience Runtime Context

Active experience manifests use
`shared/schemas/aos-experience-v1.schema.json`. Version 1 is product-neutral:
it retains tools, content roots, branding, menus, declared surfaces, cleanup,
and hooks, but has no `default_activation`, `status_item`, or
`vanilla_fallback.status_item`. Discovery rejects those retired fields on v1
input. Legacy v0 manifests remain schema-valid and are normalized through an
explicit compatibility adapter before active use.

Use `aos experience status <id> --json` before an agent trusts app-owned
desktop state for perception, annotation, saved-ref action, or evidence
handoff loops. The command is read-only: it does not activate, repair, restart,
remove canvases, initialize pending annotation state, or reset permissions.
In the user-facing state model, this is runtime state and content-root
readback, not a saved workspace selector or Work Record store.

The JSON envelope uses
`schema_version: "aos.experience-runtime-context.v1"` and includes:

- requested and active experience identity;
- runtime mode, state root, mode-scoped state directory, config path, and
  pending annotation root;
- content root declared/configured/live status; declared roots are valid only
  when their paths resolve to directories, so missing paths, regular files,
  symlinks, and unreadable paths do not report as current;
- passive service and permission readiness from `aos service status`,
  `aos permissions check`, and `aos content status`;
- diagnostics for active-experience mismatch, stale/missing content roots,
  pending annotation state, stale
  locks, and runtime blockers;
- capability summaries for perception, annotation, saved-ref action, and
  evidence handoff;
- `recommended_next[]` entries with executable argv arrays. Entries that
  contain placeholders are marked `display_only: true`.

The frozen `aos.experience-runtime-context.v0` schema remains available for
compatibility validation of historical payloads and still requires its
config-driven `status_item` projection. The status command does not emit v0;
the status-item-free payload is v1 rather than an in-place mutation of v0.

For experiences that support pending annotations, corrupt pending annotation
records fail closed through this same status surface: the
`pending_annotations` object reports `status: "corrupt"`, the annotation and
evidence handoff capabilities are blocked, and diagnostics include
`pending-annotation-state-corrupt`. `index.json` remains a disposable cache;
valid records, not the index, decide whether the store is initialized.

`aos experience status --json` without an id remains the compact legacy
active-experience readback.

## Native Status-Item Host

`aos status-item` is the product-neutral native menu-bar host contract. A
consumer opens one owner-scoped lease with a data-only descriptor. AOS owns the
single `NSStatusItem`, stable accessibility label/help text, a neutral
monochrome fallback visual, exact native anchor/display facts, typed observed
events, semantic dry-run/invoke, and cleanup on disconnect. Product commands
remain in the consumer after event receipt.

The descriptor contains only owner/item identity, a monotonic revision,
accessibility text, a primary action id, and an optional simple declarative
native menu. It does not accept icon paths, consumer visuals, scripts, remote
assets, or a consumer-supplied DesktopWorld anchor.

Validate a descriptor without touching the daemon:

```bash
aos status-item validate --descriptor ./status-item.json --json
```

Open a lease and follow typed events:

```bash
aos status-item register --descriptor ./status-item.json --json --follow
```

After writing a descriptor whose revision advances from 3 to 4, update the live
lease from a separate process, then inspect and invoke by the new semantic
identity:

```bash
aos status-item update --descriptor ./status-item-v4.json \
  --owner io.example.app --item status \
  --generation 1 --current-revision 3 --json
aos status-item inspect --owner io.example.app --item status \
  --generation 1 --descriptor-revision 4 --json
aos status-item invoke --owner io.example.app --item status \
  --action activate --generation 1 --descriptor-revision 4 \
  --action-sequence 1 --dry-run --json
aos status-item invoke --owner io.example.app --item status \
  --action activate --generation 1 --descriptor-revision 4 \
  --action-sequence 1 --json
```

`register --follow` is the lease owner and event stream. Keep that process
alive while separate update/inspect/invoke commands use its exact identity. The
registration result is the first NDJSON line; the initial `ready` event follows
it. Update is compare-and-swap: owner, item, generation, and `current_revision`
must match the live lease, while the descriptor revision must advance. Ending
the follow process closes its socket and removes the native item; there is no
standalone cleanup or subscribe command.

Inspect reports the next `action_sequence` for the active lease generation.
Dry-run validates and returns that sequence without reserving it. Effectful
invoke atomically compares and reserves it before event delivery; exactly one
caller can consume a given value. Native clicks use the same allocator.
Descriptor updates preserve the current sequence, while a new lease generation
resets it to `1`. A failed delivery still consumes the reserved sequence, so
do not automatically retry that action; any later independent action must use
a fresh value from inspect. Sequence exhaustion is checked identically by
dry-run and effectful invocation; neither path emits or mutates at the maximum.
Native menu rows retain the generation, descriptor revision, menu-item id,
action id, and enabled state they were rendered from, so selecting a stale,
remapped, or disabled row emits nothing and consumes no admission.

Minimal descriptor:

```json
{
  "schema_version": "aos.status_item.descriptor.v1",
  "owner": "io.example.app",
  "item_id": "status",
  "revision": 3,
  "label": "Example Status",
  "help_text": "Example app status item",
  "primary_action_id": "activate",
  "menu": [
    { "kind": "item", "id": "park", "action_id": "park", "label": "Park" }
  ]
}
```

Descriptor schema:
`shared/schemas/aos-status-item-descriptor-v1.schema.json`.

Event schema:
`shared/schemas/aos-status-item-event-v1.schema.json`.

Anchor schema:
`shared/schemas/aos-status-item-anchor-v1.schema.json`.

Invocation result schema:
`shared/schemas/aos-status-item-invocation-result-v1.schema.json`.

AOS emits only `ready`, observed `bounds_changed` / `topology_changed`, native
`primary_activation` / `secondary_activation`, and `menu_selection`. Inspect,
invoke responses, and every event include current `bounds` plus the AOS-derived
`anchor`; the anchor names `native_status_item`, uses global display top-left
coordinates, and carries current display frame, visible frame, and bounded
topology facts. Action events and invocation results also carry the accepted
`action_sequence`. Coordinates are evidence, owner/item/generation/revision
identify the current declaration, and `(generation, action_sequence)` identifies
an action event for replay detection.
The public CLI validates every invocation success field and accepts only the
documented closed invoke error-code set; malformed successes and unknown error
codes fail as `STATUS_ITEM_DAEMON_PROTOCOL_ERROR`. Invocation results and
events are exact discriminated variants: menu selection requires a menu-item
id, primary activation forbids one, secondary activation carries neither
action nor menu identity, and lifecycle events carry no action-only fields.
The daemon validates original invoke `data` before envelope shaping, so
caller-supplied `action`, `__envelope_ref`, or `__envelope_active` is rejected
without reaching the host or consuming an admission.

The fallback visual reserves the slot and prevents an invisible failure; it is
not the consumer's final visual. Two dependent slices are intentionally not in
v1: a generic data-only status visual projected inside the real status-item
button and bridged to DesktopWorld emergence/docking, and an AOS-owned rich
status palette/popover. A separate click-through menu-bar overlay is not part
of this contract.

## Target And Handle Contract

The two public semantic target types are:

1. **Observation Ref**: ephemeral `(state_id, ref)` from one perception state.
   A stale pair rejects and never silently redirects.
2. **Locator**: a declarative machine query re-resolved for every action. Zero
   matches return missing; more than one returns ambiguous.

The current command grammar projects those two types through
snapshot-qualified saved addresses (`ref:<snapshot-id>:<ref-id>`), canvas Locator strings (`canvas:<canvas-id>/<ref>`), and native AX Locator flags such as `--pid`, `--role`, and filters. Browser records declare browser Observation Ref strings (`browser:<session>/<ref>` plus the original `--state-id`) as stored
identity only. Ref-bearing actions remain unsupported: they perform no
current-generation lookup and return `TARGET_ACTION_UNSUPPORTED` before
managed-session dispatch. Raw coordinate actions remain available but reject `--state-id` with `TARGET_STATE_UNSUPPORTED`. These forms do not create additional public target
types. Bare `ref:<ref-id>` and automatic saved-handle reacquisition are invalid V1 behavior.
There is no current public `ax:` CLI target grammar.

The [state model](./aos-capabilities.md#user-facing-state-model) distinguishes
browser sessions, saved workspaces, focus channels, and evidence state; target
handles can reference those surfaces, but they do not collapse them into one
shared state slot.

Pending operator annotations are durable human input records that sit between
perception and action. They are not target handles themselves; they carry target
summary, optional comment, saved-handle linkage when available, fallback evidence
when no observation handle exists, and structured next-command argv for the agent that
consumes the record.

Semantic Targets are structured perception records that contain refs, bounds,
roles, names, state, and provenance. They report what can be resolved inside a
target; they are not a separate address grammar. Window, channel, browser, and
canvas ids remain resource ids or role-flag values, not competing target
dialects.

## Core Usage Patterns

### 1. Perceive, Then Act

```bash
aos ready --json
aos see capture browser:work --save --mode som --workspace default --name before
aos see refs --workspace default --snapshot before --json
aos do click ref:before:r2 --workspace default
aos see capture browser:work --save --mode som --workspace default --name after
aos see refs --workspace default --diff before..after --expect change --json
```

Typical consumer loop:

1. Save compact perception with `aos see capture --save`.
2. Read compact snapshots with `aos see snapshots` when choosing prior saved
   state; snapshot entries include `capture_source`, `capture_target`,
   `target`, and saved `query` without opening heavy payloads.
3. Read compact saved handles with `aos see refs`; use its structured
   `recommended_next` descriptors when the current implementation recommends a
   fresh resolution step.
4. Compare saved snapshots with `aos see refs --diff <from>..<to>` when a
   compact ref-level post-action check is enough; add
   `--expect change|no-change` when a recipe or shell needs a non-zero exit on
   mismatch, or repeat
   `--expect-ref <ref>=added|removed|changed|unchanged|present|missing` for
   ref postconditions. This compares compact saved-ref structure, not artifact
   pixels.
5. Resolve exact current identity. Use `--dry-run` only when an optional
   non-mutating preview is useful.
6. Dispatch and handle the typed `TARGET_*` stale, missing, ambiguous,
   disabled, timeout, or unsupported result.
7. Use structured `recommended_next` descriptors and
   `recommended_next_command` when a fresh saved capture is needed before
   reusing refs from the surface.

When exact before/after PNG artifact paths already exist and have the same
decoded dimensions, use `aos see compare <before.png> <after.png>` for canonical
pixel comparison. This file comparator does not capture, poll, wait, resize,
crop, or align its inputs; it is separate from the saved-ref diff in the core
loop above. Calls without output flags remain the byte-stable,
write-free `aos.image-compare.v1` form. Add `--change-map-out <new.png>` and/or
`--mask-out <new.png>` to receive `aos.image-compare.v2` and write same-size
8-bit grayscale PNGs: the change map stores each pixel's maximum canonical
RGBA channel delta, while the mask stores 255 exactly where that delta exceeds
`--pixel-tolerance` and 0 elsewhere.

Artifact output paths must be distinct after absolute standardization, end in
`.png`, not be `-`, have an existing directory parent with no symlink
components, and be absent of every file type. AOS never creates a parent or
overwrites a target. Each requested file stages at mode `0600` in its destination,
is encoded and fsynced, then publishes atomically with no-overwrite semantics.
The opened parent identity is pinned and the requested symlink-free path must
still resolve to it immediately before publication and receipt; the published
file identity is also rechecked. Artifact success requires the complete v2 JSON
receipt. A handled write, finalization, or receipt failure removes stages and
any invocation-owned output already published. Cleanup inspection, unlink, and
rollback-fsync failures surface as `IMAGE_ARTIFACT_CLEANUP_FAILED` rather than
being hidden; unrelated files are never cleanup targets. An expectation failure
retains successfully published artifacts only after its complete v2 receipt is
written. Each file is atomic, but two requested files are not claimed to be
mutually crash-atomic.

The v2 `artifacts.change_map` and `artifacts.mask` entries are a descriptor or
`null`. Descriptors contain the absolute `path`, `width`, `height`,
`encoding_version`, domain-separated `canonical_sample_sha256`, exact encoded
`png_file_sha256`, and count of nonzero `selected_pixels`. Change-map samples
use the `AOS_IMAGE_COMPARE_CHANGE_MAP_U8_V1\0` hash domain and select raw deltas
above zero; mask samples use `AOS_IMAGE_COMPARE_MASK_U8_V1\0` and select deltas
above tolerance. Each canonical sample hash appends unsigned 64-bit big-endian
width and height followed by the row-major one-byte sample plane.

Saved capture uses the same capture-source contract as ordinary capture: supply
a positional target such as `browser:work` or a source flag such as
`--region <rect>`, `--canvas <id>`, or `--channel <id>`. These source forms are
mutually exclusive. If no positional target or source flag is supplied, capture
defaults to `main`. `--save` is the mutation switch that persists local
workspace state. New saved captures persist compact
`capture_source.argv` so post-action refresh recommendations can reconstruct
the original positional or source-flag capture scope.

Bounds-only saved `--interactive` capture selects a rectangle on exactly one
default or positional display target and then uses the validated region path;
it conflicts with `--region`, `--canvas`, and `--channel`. For both explicit
saved `--region` and bounds-only saved `--interactive`, compact stdout preserves
the exact direct native `display_topology`. A missing object, wrong schema tag,
or absent string identity fails the saved capture closed with
`DISPLAY_TOPOLOGY_MISSING`, and the per-capture `state_id` remains distinct from
`display_topology.identity`.

```bash
aos see capture --interactive --save --mode ax --workspace default --name selection
```

Saved agent workspaces live under
`~/.config/aos/{repo|installed}/agent-workspaces/<workspace>/`, or
`$AOS_STATE_ROOT/{repo|installed}/agent-workspaces/<workspace>/` when the state
root is overridden. Compact stdout includes counts, artifact refs, compact refs,
`capture_source`, `capture_target`, `capture_mode`, one required discriminated
`handle`, backend confidence, bounded hint facts, warnings, known limits,
and file paths.
Full capture JSON, screenshots, base64 payloads, AX/browser element arrays, and
semantic target arrays stay file-backed under the snapshot directory. The
active contract is `aos.agent-workspace.v1`; see
`shared/schemas/aos-agent-workspace-v1.md` and
`shared/schemas/aos-target-handle-v1.md`. Existing V0 files are unchanged and
active readers reject them with `AGENT_WORKSPACE_SCHEMA_UNSUPPORTED` and
`recapture_required:true`.
Saved capture writes are staged under `snapshots/.staging/`, marked with
`committed.json`, and then atomically renamed into `snapshots/<snapshot-id>/`.
Readback and `index.json` rebuilds only use committed snapshots, so partial or
staged writes do not become valid workspace state.

Workspace selection is command-scoped. For saved workspace reads and actions,
`--workspace <id>` wins; otherwise `AOS_AGENT_WORKSPACE` selects a workspace;
otherwise AOS uses `default`. No daemon-held current workspace exists, and
`aos see workspace use <id>` is not a current command. `aos see workspaces`
lists all local workspaces without consulting `AOS_AGENT_WORKSPACE`; cleanup
commands require explicit workspace or snapshot ids. This keeps parallel agents
from mutating hidden shared workspace state. Any future session-bound default
must first define a multi-agent-safe contract. This is the saved-workspace part
of the [state model](./aos-capabilities.md#user-facing-state-model), not
daemon runtime state.

Pending operator annotations live under
`~/.config/aos/{repo|installed}/pending-annotations/`, or
`$AOS_STATE_ROOT/{repo|installed}/pending-annotations/` when the state root is
overridden. Use `aos see annotation select --mode
<point|rectangle|freehand|text> --follow` to collect one native desktop
geometry selection, or `aos see annotation select --mode target --follow` to
select one bounded semantic accessibility target, and persist it before
completion. Use `aos see annotation create` to create or ingest one pending
record, `aos see annotation list` for compact summaries, `aos see annotation
read <id>` for one compact record, `aos see annotation consume <id>` to drain
it once, `aos see annotation link-work-record <id> --work-record <ref>` to
attach action/readback evidence, and `aos see annotation delete <id>` to make
it non-consumable. Consuming
a non-`pending` annotation fails closed with structured JSON, as do pending
annotations whose capability status is `unsupported`, `ambiguous`, or
`blocked`; stdout stays compact and heavy evidence remains path-backed. `aos
see annotation create --from-capture-json <path|-> [--ref <id>]` projects
compact saved capture or refs readback into a pending annotation, preferring
browser, AOS canvas, and native AX saved refs over coordinate or prose fallback
evidence. The pending annotation contract is `aos.pending-annotation.v0`; see
`shared/schemas/aos-pending-annotation-v0.md`. Create, consume,
link-work-record, delete, and optional index cache refresh share one bounded
local mutation lock backed by the shared local state helpers. The lock records
its owner PID, refuses to reap live owners, and only reaps dead-owner or
ownerless stale locks. Records are the authoritative state; `index.json` is a
rebuildable cache, and read/list derives from records without repairing state
so an index write failure cannot make a successful record mutation look failed.
Pending annotations are evidence state in the user-facing vocabulary, not
agent sessions, focus channels, or saved workspaces.

The native selector is a connection-scoped lease. Freehand evidence is capped
at 256 points, text at 4 KiB, and geometry uses desktop top-left logical points.
The public completion event strips text and exposes only `has_text`; read the
created pending record by its returned annotation id to consume the comment.
Selection evidence is initially `fallback_only` and does not manufacture a
semantic saved ref. Target mode stores strict positive element bounds, bounded
role/title/label facts, and at most 11 ordered ancestor roles with
`target_kind: native_ax`; direct selection remains `fallback_only` unless a
saved-capture projection supplies exactly one typed V1 handle. A saved ref is
only storage indirection to that Observation Ref or Locator. The public target
completion currently replaces its
admitted title and label facts with `null`; that replacement is an explicit
ADR 0040 fidelity gap. Target mode does not accept annotation text, and local
paths remain outside this bounded completion receipt.

Compatibility boundary: archived reports, sealed fixtures, and historical
experience manifests may still contain config-driven status-item fields. The
runtime does not read or project them, and they are not active command
authority. New operator annotation or product menu flows use `aos status-item`
leases and consumer-owned typed event handling.

Current wait/assertion boundary: saved workspaces do not expose
`aos see capture --wait-for-change`, `aos see capture --until-stable`,
or `aos see assert`. Use structured `recommended_next` descriptors and
`recommended_next_command` plus a fresh saved capture for re-perception. Use
`aos see refs --diff <from>..<to>` only for compact saved-ref comparison between
two existing snapshots. For exact pixel comparison when existing same-size PNG
paths are already available, use
`aos see compare <before.png> <after.png>`. The file comparator does not capture,
poll, wait, resize, crop, or align its inputs, and it is not a saved-workspace
diff. `--expect change|no-change` makes either comparison a machine-checkable
gate with the command's structured expectation failure on mismatch;
`--expect-ref <ref>=added|removed|changed|unchanged|present|missing` gates one
saved ref inside the same compact diff and can be repeated. A single ref gate
reports `diff.ref_expectation`; multiple ref gates report
`diff.ref_expectations[]`. These expectations are still not a wait loop or full
assertion engine. Use
`aos show wait` only for canvas readiness, Recipe assertions only for command
JSON checks, and Work Record postconditions for durable evidence checks. Future
saved wait/assert commands need manifest help, parser, schema/doc, and drift
tests before public use. For a consumer-facing decision table, see
[Lightweight Verification](./aos-capabilities.md#lightweight-verification).
For the composed before/action/after proof trail and diagnostic readback
boundary, see
[Diagnostics And Evidence Trace](./aos-capabilities.md#diagnostics-and-evidence-trace)
and [Dashboard And Readback Boundary](./aos-capabilities.md#dashboard-and-readback-boundary).

Capture modes are explicit:

- `--mode ax`: tree-oriented refs where the backend can supply them.
- `--mode vision`: screenshot-oriented capture with image/base64 artifacts
  saved under `artifacts/`.
- `--mode som`: screen-object mode; currently xray-backed where available.

The active saved-workspace implementation accepts only
`ref:<snapshot-id>:<ref-id>`. A record contains one required discriminated
`handle`; bare refs, resolution classes, coordinate fallback records, and
alternate action targets are invalid V1 state.

Browser records contain an Observation Ref with the original session,
`state_id`, and Playwright ref. Each AOS browser capture atomically replaces
the one current generation for that session and binds the path-free managed
backend identity V2: exact descriptor, closure, entrypoint, and random session
generation. That provenance belongs to the capture; it does not make the ref
actionable. Browser ref actions are not part of the managed companion surface;
dry-run and effect requests return `TARGET_ACTION_UNSUPPORTED` with
`reason:browser_ref_actions_unsupported` before worker dispatch. They never
capture, search by label, reacquire, substitute state, or fall back to an
ambient executable. Saved requests validate the stored handle record; direct
requests validate only the exact ref grammar. Neither dispatches to the managed
session.
Session-only browser actions remain available and reject `state_id`.

Canvas and native AX records contain Locator queries. Each action re-resolves
the query and requires one current match. Zero returns `TARGET_NOT_FOUND`;
multiple returns `TARGET_AMBIGUOUS` with bounded candidate facts. Native
`--index` explicitly selects BFS match N. Native `--near` succeeds only
when one bounded candidate has a uniquely smallest distance; ties are
ambiguous. Locator and coordinate actions reject `state_id` with
`TARGET_STATE_UNSUPPORTED`. The native NDJSON `aos do session` surface rejects
every supplied `state_id` before channel refresh or action dispatch because it
has no browser Observation Ref backend.

Optional `--dry-run` follows the identical validation/resolution path and
stops immediately before mutation where the form advertises it. In checkpoint
2B, session-only browser scroll is the only managed browser form that
advertises dry-run; it validates grammar and one stable active record without
liveness, worker dispatch, lock creation, or writes. Browser drag requires two Observation Refs
from the same session and generation. Typed failures use
`TARGET_HANDLE_INVALID`, `TARGET_STATE_REQUIRED`, `TARGET_STATE_STALE`,
`TARGET_STATE_UNSUPPORTED`, `TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`,
`TARGET_DISABLED`, `TARGET_ACTION_UNSUPPORTED`, and
`TARGET_RESOLUTION_TIMEOUT`.

All maintained browser consumers resolve one managed session record under the
browser-companion store lock. That record binds a separate random upstream
session id and an immutable source-pinned runtime version. There is no runtime
path in public identity, no JS/Swift resolver or version probe, no legacy
session registry, and no environment, repo package, wrapper, `npx`, global npm,
or `PATH` fallback. Retained older leases keep their own bounded version,
descriptor, closure, package-relative entrypoint, and random generation after a
new runtime activates.

#### Managed Playwright companion lifecycle

The separate managed package lifecycle is public through:

```bash
aos browser companion status --json
aos browser companion install --json
aos browser companion update --json
aos browser companion uninstall --json
```

It installs only the source-pinned `@playwright/cli` 0.1.15 package and its
exact required `playwright` and `playwright-core`
1.62.0-alpha-2026-06-29 closure under the mode-scoped AOS state root. It runs
no lifecycle scripts, package manager, browser download, skill install, or
extension install. Status states are `missing`, `current`,
`update_available`, `partial`, `corrupt`, and `blocked`. Mutation receipts are
closed and content-free, include before/after state, exact version/digests,
zero session cleanups in this checkpoint, exact safe-integer monotonic duration, completion time,
and explicit recovery-pending state. Uninstall receipts bind the descriptor and
closure actually removed even when the source descriptor now advertises an
update. The binding is journaled and browser-level recovery is exclusively
claimed before the whole store is atomically moved into its removal marker, so
every authoritative interrupted uninstall remains `partial` and retry preserves
that binding. After store deletion, the still-journaled marker atomically
becomes a non-authoritative completed tombstone; its cleanup cannot make public
state less final than `missing`. Empty interrupted lock/removal-intent creation
and active-pointer intent unlink/fsync ambiguity are recovered from exact
observed state. A successful uninstall leaves the shared mode and browser
parents intact. Quarantined recursive
cleanup performs a final exact root identity check under a cooperative same-UID
private-root boundary; it does not claim adversarial same-UID linearizability.
No lifecycle form
accepts `--dry-run`.

All maintained browser/session consumers now use the managed session authority;
`browser tabs new` is not present yet. `current` proves exact installed package
state, while an operation additionally requires one active generation-bound
session record.

#### Managed browser sessions

`aos focus` owns the public session lifecycle alongside native focus channels:

```bash
aos focus create --id scratch --target browser://new --headless
aos focus create --id profile --target browser://new --persistent
aos focus create --id remote --target browser://attach --cdp http://127.0.0.1:9222
aos focus create --id chrome --target browser://attach --extension=chrome
aos focus list
aos focus remove --id scratch --backend browser
```

Launched sessions explicitly select the Playwright system Chrome channel.
Chrome must already be installed: the managed companion closure never installs
a browser binary and its private browser cache starts empty. Launched sessions
are AOS-owned and removal sends exact-session `close`.
Persistent launch uses only a private per-generation AOS profile; no custom
profile is accepted. Initial and navigation URLs admit only `http`, `https`,
`data`, and `about`; local `file:` URLs fail closed. Direct CDP and extension sessions are external-owned and
removal sends only exact-session `detach`. The reviewed extension handshake may
launch or focus Chrome and open its bridge page, but AOS never owns or closes
that browser, profile, or its tabs. Extension attach requires the reviewed
Playwright extension in an ordinary system-Chrome `Default` or `Profile N`
profile. AOS conservatively fails unavailable or blocked evidence before
creating the session. The pinned extension id must contain a bounded ordinary
version directory and matching bounded manifest; an empty id directory is not
installation evidence. AOS reports installed only after the complete bounded
profile/version set is valid; one malformed or over-cap member is blocked. AOS
requires two identical complete bounded tree scans; persistent change after
bounded retry is blocked. AOS passes only the proven Chrome user-data root to
the upstream handshake.

Before worker spawn, AOS durably records a creation intent plus `starting` with distinct public,
generation, and upstream ids plus the immutable runtime binding. Only one
bounded non-error JSON success makes the record `active`. Post-spawn ambiguity,
missing liveness, or cleanup without the exact `closed`/`detached`
acknowledgement becomes `cleanup_required`; the lease and private workspace
remain, and uninstall stays blocked. A fixed non-mutating exact-session eval is
the liveness check. AOS never calls upstream `list` and never treats a PID as
cleanup authority. Admission is capped at 128 durable records before workspace,
lease, or worker creation. `focus list` performs a bounded stable read without
creating or repairing browser state.

Every real worker runs beneath a detached Node guardian whose durable record is
bound to the exact store lock token, session generation, operation, and random
nonce. The guardian stays inert until the parent observes its PID, durably
publishes the exact armed reservation, and sends activation. Spawn additionally
requires an acknowledged exact request and execute signal. Raw stdout/stderr
remain separate but share the immutable descriptor's 65,536-byte aggregate
capture cap; small control, activation, and parent-lifetime fds carry no bulk
output. Both the inner sentinel request and outer guardian request require EOF
after one exact final-newline JSON frame before acceptance; partial, trailing,
or second frames cannot spawn a worker. A delayed request write error is ignored
only after the exact acceptance control. Parent or pipe loss, deadline expiry, or output overflow sends an exact
nonce-bound retirement request to the detached sentinel. The sentinel
acknowledges TERM arming, sends TERM to its own current group, then after the
grace period synchronously acknowledges `pre_kill` and immediately sends
SIGKILL to that same current group including itself. Forced completion requires
the exact acknowledgement, an exact `{code:null, signal:"SIGKILL"}` sentinel
exit witness, untruncated control EOF, both raw-stream EOF witnesses, and the
aggregate cap. Sink loss drains/discards both raw streams without waiting on
backpressure. The guardian performs no later numeric-PGID signal or probe on
that forced path; dead-guardian recovery skips the group probe only for a
validated durable `complete` record.
Under the cooperative same-UID private-runtime boundary, this proves no
continuing supervised user-code authority before another store writer can
proceed. An upstream daemon intentionally detached by the CLI is excluded from
that one-shot group and remains managed session authority until exact
close/detach. Native focus
`--depth` accepts only canonical integers from `0` through `15` before daemon
dispatch.

Every mutating operation durably records its operation and random nonce before
worker dispatch. Interrupted `operating` state becomes `cleanup_required`;
`operation_committed` becomes active without replay. Exact cleanup acknowledgement
is durably `cleanup_committed` before `closed`, so retry never repeats a proven
close or detach. Removing the final lease retires its superseded immutable
runtime version and reports any remaining retirement residue as recovery pending.
Guardian outcome consumption is last and retry-idempotent only for the exact
already-applied generation/operation/authority/state matrix. A proven pre-spawn
liveness or cleanup failure restores `active` and returns its typed worker
failure; spawned or unproven authority remains `cleanup_required`.

The managed runner validates the exact operation response and bounded artifact
before publishing its durable acknowledgement, and retires the exact complete
Guardian only afterward. If that retirement is interrupted, lock release
transfers the bound outcome and the acknowledged session phase remains recovery
authority. Multi-step evidence capture additionally journals each validated
navigate/query/screenshot boundary before retiring its subworker. Incomplete
progress becomes `cleanup_required`; final acknowledged progress and
`operation_committed` recover active, with Guardian outcomes and the evidence
journal consumed only after state convergence.
When the exact acknowledgement record is returned but its durability or later
Guardian retirement remains unresolved, public create/remove and operation
receipts report `recovery_pending`; final evidence still returns its already-
validated result and screenshot. The private pending signal and Guardian
binding are never serialized. Unknown acknowledgement failure remains a typed
error, and intermediate evidence progress remains cleanup-required without
starting another worker.

The public fixed session operations are:

```bash
aos do navigate browser:<session> <url>
aos do type browser:<session> <text>
aos do key browser:<session> <combo>
aos do scroll browser:<session> <dx,dy>
aos do scroll browser:<session> <dx,dy> --dry-run
```

Browser capture is deliberately narrow: `aos see capture browser:<session>`
admits only `--out <png>` or `--xray`, while its saved form admits only
`--save`, `--mode`, `--workspace`, `--name`, and `--query`. Native-only capture
flags fail before managed-session or worker dispatch. Native capture,
saved-workspace capture, bounded internal page-identity
queries, and Toolkit browser evidence use the same generation-bound authority
through the narrow managed broker. Browser-window locality, local DOM geometry,
show anchors, ref-bearing targets, arbitrary eval/run-code, raw upstream
commands, runtime-path overrides,
and tab operations fail closed or are absent.
Decoded managed screenshots are capped at 32 MiB; the Swift broker's 48 MiB
combined envelope admits their base64 projection without changing that bound.

Legacy guarded-live V0 saved-ref proof remains archival/manual evidence and
is not active V1 acceptance. Deterministic V1 coverage lives in
`tests/target-handle-runtime.test.mjs`,
`tests/agent-workspace-v1.test.mjs`, and
`tests/native-target-locator-selection.sh`.

Post-action recommendations may propose a fresh saved capture. That capture
creates a new browser generation; it never makes an old Observation Ref
actionable again. Native AX and canvas Locators simply re-resolve on the next
action.

Diagnostic and fallback paths are still available when compact saved refs do not
have parity or when an agent explicitly needs pixels, raw images, or coordinate
proof:

```bash
aos see cursor
aos see capture main --base64
aos see capture --canvas surface-inspector --perception --out /tmp/inspector.png
aos see capture --region 1172,442,320,480 --perception --out /tmp/inspector.png
aos do click 500,300
```

Cleanup is explicit:

```bash
aos see workspace prune default --older-than 7d --dry-run --json
aos see snapshot delete <snapshot-id> --workspace default --i-understand-local-artifacts --json
aos see workspace delete default --i-understand-local-artifacts --json
```

### 2. Ask For Bounded Human Input

`aos gate ask` presents a bounded structured decision through the gate service and writes the terminal result to stdout as JSON.

Gate runs only when the caller explicitly requests structured input. Its answer
is caller data; it does not authorize ordinary `aos see`, `aos do`, `aos show`,
or other unrelated actions. The persistence behavior documented below is
current implementation truth, including the ADR 0040 default-redaction gap; it
is not the target privacy policy.

```bash
aos gate ask "Continue?"
aos gate ask --preset approve_deny --title "Run disruptive test?" --timeout 30
aos gate ask --request gate-request.json
aos gate ask --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"yes_no_with_escape"}}'
```

The request contract is `aos.gate.request.v1`. A successful answer returns the typed response object. A human dismissal returns `{ "result": null, "status": "dismissed" }`; a deadline returns `{ "result": null, "status": "timeout" }`. Operational failures exit non-zero with a machine-readable gate error code on stderr.

Every terminal outcome appends one `aos.gate.record.v1` metadata record under the active runtime state root: `~/.config/aos/{repo|installed}/gate/records.jsonl`, or `$AOS_STATE_ROOT/{repo|installed}/gate/records.jsonl` when that override is set. Records include gate id, prompt title, source metadata, receptor, field kinds, timeout, lifecycle timestamps, elapsed time, resolution/status, and operational error details when present. The current implementation redacts prompt bodies and answer payloads by default; callers must opt in with `--store-response` or `metadata.record_response: true` to persist the answer payload. This is the explicit ADR 0040 Gate-persistence gap above, not the target default.
Gate records are runtime-root evidence state; they do not create a saved
workspace, hold current UI state, authorize an AOS action, or authorize replay.

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
title, currently redacted source metadata, session id, harness/provider hint, role, cwd,
branch, HEAD SHA, dirty summary, lifecycle state, resume policy, resume
entrypoint metadata, and `auto_resume=false`. That source projection is the ADR
0040 Gate-persistence gap above, not the target default. The entrypoint is an adapter
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

### Repo Maintainer Scripts

Repo-development workflows are local maintainer tooling, not public AOS CLI
commands. `classify` reports changed files, matched rules, classes, actions,
and whether the set is hot-swappable or TCC-sensitive. `recommend` adds ordered
commands and verification steps. For agent-facing guidance, prefer
`skills/aos-maintainer-routing/SKILL.md` and the direct backing scripts:

```bash
node scripts/aos-dev-workflow.mjs recommend --json --paths <changed-paths>
node scripts/aos-dev-workflow.mjs classify --json --paths <changed-paths>
node scripts/aos-dev-workflow.mjs capabilities list --json
node scripts/aos-dev-workflow.mjs capabilities explain dev.github.issue_comment --json
```

The rules live in `docs/dev/workflow-rules.json` and are validated by
`shared/schemas/dev-workflow-rules.schema.json`.

For repo binary checks, prefer `skills/aos-repo-binary-build/SKILL.md` and:

```bash
node scripts/aos-dev-build.mjs build --no-restart --json
```

Rebuild detection is content-based for Swift runtime inputs, not
mtime-based, and build-tooling edits alone do not replace the TCC-owning binary.
Repo-mode builds do not post-sign the local binary; packaged app signing is
owned by `scripts/sign-aos-runtime`. ADR 0023 preserves one direct `swiftc`
link to `./aos` for managed-endpoint development. That raw link accepts no
packaging metadata or injected plist section; no separate linker, signing,
copying, moving, wrapping, entitlement, binary rewrite, or `spctl` step may
touch the result. No post-build hook automates TCC handling: build does not
reset permissions, open System Settings, show a human-needed surface, write
completed-build markers, or inject provider input.
Repo-mode binary rebuilds are TCC-sensitive and intentionally rare. A
successful rebuild marker (`Rebuilt: ./aos`) requires `./aos help --json` as
the immediately following command, with no intervening inspection or
transformation. Stop on exit `137`. If help succeeds, stop for the human TCC
checkpoint without inspecting the artifact. After the user replies `finished`,
run exact `./aos ready --repair --post-permission --json` with no intervening
command before further TCC-backed daemon, capture, input, or native proof.

The `capabilities` subcommand is read-only discovery over
`docs/dev/agent-capabilities.json`. It lists or explains typed development
capabilities, including whether a capability uses a typed AOS surface or an
explicit raw-process adapter. It does not execute capabilities, grant
permissions, or select an agent role.

`node scripts/aos-dev-gh.mjs` is the repo GitHub helper. It deliberately uses
the real `gh` executable from `PATH`, the user's existing `gh` authentication,
and the local git checkout to infer `owner/repo` unless `--repo owner/name` is
supplied. Direct operations such as `issue list`, `issue view`, `issue comment`,
`issue create`, `issue close`, `issue edit`, `label list`, `pr list`, `pr view`,
`pr checks`, `pr comment`, and `pr merge` forward to `gh` and preserve its exit
behavior. List operations expose the repo-safe inventory filters used most
often: issue and PR lists support `--state`, `--limit`,
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

`show create` does not resend a mutation when the daemon response is lost. For
a global canvas only, the CLI performs one bounded `show list` reconciliation
and reports success only when the requested id carries the exact owner metadata
from the still-running CLI process. Connection-scoped creates cannot be
reconciled across sockets and fail closed. Unconfirmed-response errors identify
the action and canvas id without echoing HTML or other request content.

Common follow-ups:

```bash
aos show update --id demo --at 150,120,320,200
aos show eval --id demo --js 'document.body.style.opacity = "0.7"'
aos show remove --id demo
```

### Stream a DesktopWorld Scene

`aos scene --follow` holds one connection-scoped owner/resource lease on the
singleton `desktop-world/main` stage. It accepts strict bounded NDJSON and does
not expose the private daemon socket:

```bash
printf '%s\n' \
  '{"op":"subscribe","events":["gesture"]}' \
  '{"op":"inspect"}' \
  '{"op":"close"}' \
  | aos scene --stage desktop-world/main \
      --owner example.consumer --resource companion/main --follow
```

The operation vocabulary is `mount`, `transact`, `signal`, `play`, `suspend`,
`resume`, `inspect`, `prove`, `subscribe`, `unsubscribe`, `remove`, and `close`.
`prove` accepts only a named framebuffer predicate declared by the currently
mounted trusted extension; normal consumers call it through
`session.assertFramebuffer()` rather than constructing pixel predicates.
Subscriptions are scoped to that same lease and currently expose only typed
`gesture` events. Gesture payloads conform to `aos.scene.event.v1`; they contain
bounded scene identity, coordinates, topology, arbitration, cancellation, and
declarative response facts, never product text, prompts, audio, or scene
document content. Disconnect releases the resource and all native hit regions.

Validate a data-only cartridge without starting the daemon:

```bash
aos scene cartridge validate ./path/to/cartridge --json
```

Inspect and profile the same canonical stage without opening a private socket:

```bash
aos scene list --json
aos scene inspect --resource companion/main --json
aos scene perf --resource companion/main --json
aos scene monitor --resource companion/main --follow --json
```

`list`, `inspect`, and `perf` use a bounded headless DevTools session and close
it even when inspection fails. `monitor` is connection-scoped, emits at most
two canonical snapshots per second through the existing stage probe, and turns
instrumentation off when the final monitor disconnects. None of these commands
return scene parameters, product text, prompts, audio, captures, or desktop
content.

`perf` confirms that the requested resource is mounted, then returns
authoritative `scope: "stage-segment"` metrics for every current display.
Those scalars describe each renderer segment, not the selected resource, and
AOS does not sum rates, timings, DPR, or backing dimensions across displays.
The daemon accepts them only after the exact request, canvas generation,
topology generation, and complete display set converge.

Open, inspect, and close the AOS-owned detachable inspector:

```bash
aos scene devtools open --resource companion/main --json
aos scene devtools status --json
aos scene devtools update --session <session-id> --expected-revision <n> --tab performance --recording on --json
aos scene devtools transfer --session <session-id> --expected-revision <n> --host-kind external --host-id <canvas-id> --json
aos scene devtools close --session <session-id> --json
```

The panel is an AOS surface and does not require an AOS status item. A consumer
may transfer the same revisioned session into an existing approved AOS canvas
through the CLI or typed SDK. The daemon suspends the previous host before
activating the next; exactly one interactive host owns a session at a time.

Replay a deterministic fixture without a daemon or live input:

```bash
aos scene replay \
  --events packages/toolkit/scene/fixtures/aim-commit.ndjson \
  --json
```

Replay validates monotonic sequences and complete gesture lifecycles, caps the
fixture at 10,000 events and 128 resources, and returns its bounded replay
result. Input event payloads remain in the caller-owned fixture rather than
being echoed into the result.

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

Do not refresh the shared runtime from a linked git worktree. Switch branches in
the primary checkout for shared-runtime work, or set an explicit isolated
`AOS_STATE_ROOT` for alternate-checkout runtime proof.

For inline `--html` or `--file` canvases, `show update --html ...` or
`show update --file ...` replaces the content in place. `--file` is resolved by
the CLI at update time, so repeat the `--file` update after editing the file.
Use `show wait` after either form when the reloaded page has a readiness
manifest or observable JavaScript condition.

`show wait --manifest <name>` requires the AOS bridge and matching readiness
manifest. `show wait --js <condition>` polls that JavaScript condition directly,
so inline HTML does not need to install `window.headsup.receive`. When both flags
are present, both conditions must pass. With neither flag, `show wait` retains
the bridge-ready default.

### 3. Load Toolkit Content Through the Content Server

Use the canonical `toolkit` root from the primary checkout. Do not use linked
git worktrees or branch-scoped roots to share the singleton daemon across
parallel agents.

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

Each selected `aos see` primitive is fidelity-first within its bounded public
observation contract. It returns the exact pixels, AX/DOM facts, values, and
metadata that contract admits, subject to upstream OS withholding and
mechanical resource bounds. Facts and channels outside the declared contract
remain outside it; their exclusion is not redaction. AOS does not silently
classify or mask sensitive-looking admitted content. Callers that need masking,
redaction, persistence, retention, or a model-safe projection must request or
apply that transform explicitly across every relevant admitted channel.

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `cursor` | inspect what is under the cursor |
| `capture` | capture a target display/window/region |
| `compare` | compare canonical pixels from two existing same-size PNG files |
| `observe` | stream perception events from the daemon |
| `list` | enumerate capture/display targets |
| `selection` | interactive region selection |
| `annotation` | pending operator annotation lifecycle |
| `zone` | zone helpers |

Shorthand capture is supported:

```bash
aos see main
aos see external 1
aos see capture --canvas surface-inspector --perception
aos see capture --canvas example-menu --xray
aos see capture --region 1172,442,320,480 --perception
```

Useful capture modifiers include:

- `--window` to restrict `user_active`/window captures to the window frame
- `--region <x,y,w,h>` for explicit CG-coordinate regions; every successful
  region response directly includes the frozen `aos.display-topology.v1`
  mapping used to resolve, segment, capture, and stitch it
- `--interactive` to select bounds on exactly one target display and route the
  real pixels through the same validated region path
- `--canvas <id>` / `--channel <id>` for surface-relative captures
- `--exclude-window <CGWindowID>` to omit specific windows from a display/region capture
- `--perception` to attach spatial metadata alongside the image payload

Ordinary `--window` capture is best effort: it requests a direct window still
and may return the containing display with an explicit warning and
`window_fallback` metadata if the window source is unavailable. A native
`--channel` capture is exact instead. It re-resolves one current layer-zero
window with the channel's window ID and owner PID, requires its full live bounds
to fit one non-mirrored display, and sends the daemon an owner/bounds-bound
`fallback=none` target. The daemon prepares only the direct window still; it
does not capture or stream display fallback bytes. Missing, duplicated, moved,
owner-changed, cross-display, or failed exact targets fail closed. Cross-display
and compound-window exact capture remain separate future contracts rather than
implicit stitching or fallback behavior.

Capture responses include an opaque `state_id` such as `see_abc123def456`.
Work-record and recipe layers can carry that id into the next action as the
perception state the agent acted from. The id is a correlation handle, not a
stable object reference or cache key.

`aos see list` returns spatial-topology `0.3.0` and directly includes
`display_topology`. The nested object has a stable content identity over display
mapping facts only. An explicit `--region` or bounds-only `--interactive`
capture returns the same object at response top level even without
`--perception`; with `--perception`, its
`perceptions[].topology.display_topology` value is byte-for-byte equivalent.
The producer observes displays once per command and reuses that frozen value.
`state_id` stays independently per-capture and is not a topology identity.
See [`display-topology-v1.md`](../../shared/schemas/display-topology-v1.md).

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
not role-whitelist them into an "interactive" vocabulary. Display, region, and
surface captures traverse visible app windows that intersect the captured region;
ordinary window captures stay scoped to the captured window owner. Exact native
channel capture resolves exactly one AX window root, traverses only that root,
inherits its proven window ID for unattributed descendants, and prunes foreign
non-null window IDs. Focus-channel create/refresh also fails without that exact
owner/root/subtree evidence instead of publishing a freshly empty channel. For AOS-owned canvas
captures, `aos see capture --canvas <id> --xray` also runs a fixed semantic
target probe inside that canvas and returns `semantic_targets`. Those entries
use the current emitted fields `ref`, `surface`, `role`, `name`, `kind`,
`enabled`, `state`, `actions`, `extension`, `provenance`, and optional
`geometry` and `metadata`, plus a required canvas Locator `handle`. The capture
response carries `state_id` at top level, but canvas Locators do not accept it.
Browser xray `elements` instead carry Observation Ref handles that contain the
original response `state_id`, browser session, and Playwright ref. The managed
browser adapter does not project browser-window locality, local DOM geometry,
or badge annotations. Human labels and accessible text, when present in the
upstream snapshot, remain observation content rather than target identity.
The probe does not use caller-supplied JavaScript; `show eval` remains a
developer diagnostic bridge, not the agent perception contract.

See [`shared/schemas/aos-semantic-targets.md`](../../shared/schemas/aos-semantic-targets.md)
for the response shape.

`--perception` augments the capture response with:

- global capture bounds
- local capture bounds in the emitted image
- composite capture scale
- per-display surface segments when a region or canvas spans multiple displays; exact native channel capture is single-display and never stitched
- a `spatial-topology` snapshot for the same moment

Spatial-topology `0.3.0` requires the same frozen `display_topology` value. The
DesktopWorld canvas lifecycle counter named `topologyGeneration` (or
`topology_generation`) is a separate non-content-addressed, non-persistent,
non-comparable value and is not atomically correlated with this identity.

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
- `--anchor-window <id>`
- `--anchor-channel <id>`
- `--offset x,y,w,h`

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

Anchor flags are placement roles, not separate target dialects.
`--anchor-window` and `--anchor-channel` consume resource ids. The display
subsystem resolves the input into an Anchor Binding for placement. Managed
browser sessions expose no proven local window binding in checkpoint 2B, so
browser anchors are not admitted.

### Show/See/Do Surface Loop

Use `aos show create`, `aos show update`, and `aos show remove` for persistent
canvas lifecycle. Use `aos show render` for one-shot image rendering without a
persistent canvas or action handle.

To inspect and act on a live AOS surface, capture the current canvas host and
carry the returned target handle forward:

```bash
aos see capture --canvas <id> --xray --save --workspace <workspace>
aos do click canvas:<canvas-id>/<ref>
aos do set-value canvas:<canvas-id>/<ref> --value <value>
aos do drag canvas:<canvas-id>/<ref> --by <dx>,<dy>
```

`semantic_targets[].provenance.do_target` is the direct current-host action
handle when present. Saved workspace refs from the same capture use
`ref:<snapshot-id>:<ref-id> --workspace <workspace>` for replayable model-facing
handles. Both paths use the same target ladder; there is no separate `show:`,
`surface:`, or `anchor:` action grammar.

Verify through a fresh `aos see capture --canvas <id> --xray --save
--workspace <workspace>` when the proof is about model-visible state. `aos show
eval --id <id> --js ...` is a developer diagnostic bridge for repo-owned canvas
state; show eval is not a target dialect and is not a substitute for semantic
target evidence unless the check is intentionally reading that owned state.

Surface Inspector and annotation support surfaces must carry the same evidence
model. Bundles such as `annotation-snapshot.json` can record Surface Inspector
context and semantic target projections, but they should point back to
`semantic_targets`, `provenance.do_target`, saved refs, and capture artifacts
instead of inventing private surface addresses.

## `aos skills`

`aos skills` is the direct command surface for AOS-owned installable root
skills. Root skills are agent guidance packages from `skills/`; they are not
Recipes, Workflows, Work Records, or wiki plugins.
`skills/registry.json` is the source-owned registry and
`scripts/aos-skills-validate.mjs` is the focused validator.

The installable AOS skill pack covers core orientation, runtime readiness,
desktop/app/window workflows, saved workspaces, canvas/vision fallback, focus
sessions, browser workflows, verification loops, operator annotations, Work
Records, recipes, and command-surface maintenance. The registry contains only
current installable or retained-local packages; superseded skills are removed
instead of remaining discoverable as aliases or tombstones.

The command surface supports read-only inventory, dry-run planning, and bounded
installation:

| Subcommand | Purpose |
| --- | --- |
| `list` | list AOS root skills, installability status, supported targets, and source digests |
| `check --target <target>` | inspect installed state for a supported target |
| `install --target <target> [--dry-run]` | write AOS-managed package and manifest files, or report the same planned writes without mutation when `--dry-run` is present |
| `companion check --name playwright-cli --target <target>` | report Playwright CLI runtime status and whether Playwright-owned skill material appears in the selected target |
| `companion install --name playwright-cli --target <target> --dry-run` | report the external `playwright-cli install --skills` invocation without running it |

Supported targets are `codex`, `claude`, `agents`, and explicit
`--target path --path <absolute-dir>`. Unknown targets, ambiguous `--path`
usage, non-absolute explicit paths, symlink roots, unmanaged installed skill
directories, unsupported skill selections, and install writes that would escape
the resolved target root fail closed with JSON errors. Existing AOS-managed
stale copies may be overwritten by `install`; unmanaged user material blocks the
operation.

Examples:

```bash
aos skills list --json
aos skills check --target codex --json
aos skills check --target path --path /tmp/aos-skills --json
aos skills install --target path --path /tmp/aos-skills --dry-run --json
aos skills install --target path --path /tmp/aos-skills --json
aos skills companion check --name playwright-cli --target path --path /tmp/aos-skills --json
aos skills companion install --name playwright-cli --target path --path /tmp/aos-skills --dry-run --json
```

`check` reports each skill as `ok`, `missing`, `stale`, `unmanaged`,
`unsupported_target`, or `blocked`. `install --dry-run` reports
`planned_writes[]` entries for package files and the AOS-managed installed
manifest, including source digests and file hashes. Non-dry-run `install`
writes those files under the resolved target root, writes an AOS manifest, and
returns `written[]` plus post-install check state.

Playwright CLI skills companion integration remains external, explicit, and
separate from the managed package/session runtime. AOS reports the managed
runtime's content-free lifecycle state, detects Playwright-owned skill packages
in the selected target by inspection, and emits only a path-free dry-run plan
for the external `playwright-cli install --skills` command. It does not resolve
an executable path, vendor Playwright skill files, or run the skills installer.

## `aos recipe`

`recipe` is the source-backed executable recipe surface. It sits above
primitive verbs such as `status`, `show`, and `see`, and it can also run
repo-owned helper scripts through typed `shell` blocks. It keeps primitive
command and script references visible so agents can inspect what will run.
The old `aos ops` command surface is retired; use `aos recipe` for every
source-backed executable recipe workflow.

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
```

`recipe dry-run` is static in v1: it does not start daemons, create canvases,
mutate resources, or run read-only observation probes. It validates the recipe,
resolves declared resources, verifies external help-manifest command
references and static repo shell script paths, and returns the planned blocks,
resource ownership, parameters, and cleanup plan. Without `--json`, it emits a
concise text plan.

Recipes may use repeatable
`aos see refs --diff <from>..<to> --expect-ref <ref>=...` gates as compact
postcondition steps after a fresh saved capture. That command remains a
saved-ref diff gate over two existing snapshots; recipe assertions can inspect
`diff.ref_expectation` or `diff.ref_expectations[]`, while Work Records should
cite the command output as immutable evidence rather than treating the recipe as
replay or repair authority.

Work Record v1 has a deterministic saved-ref evidence builder above the primitive command
surface. Toolkit tests can build a report-only Work Record from structured
evidence for:

```text
see --save -> do ref -> see --save -> diff/readback -> cleanup
```

When a caller chooses to emit it, the record preserves the selected saved
handle, resolved underlying target, backend, strategy, fallback flag, State IDs,
recommended next capture command, optional preview evidence,
action/after/cleanup evidence, and verifier health.
Stale or ambiguous saved-ref validation is classified as `repairable` or
`blocked` according to the recorded evidence; cleanup or postcondition failure
is recorded without rewriting historical evidence. This bridge does not turn
`aos do` into a macro recorder and does not authorize autonomous replay or
future execution.

## `aos work-record`

Work Records are optional durable evidence and history. The active
`2026-08-work-record-v1` contract records exact intent, source-bound targets,
postconditions, immutable evidence, claim results, verifier output, and health.
It never grants permission. The frozen Work Record V0 schema, documentation,
and fixtures remain opaque historical bytes and are rejected by active
planning, verification, repair, and finalization readers.

Step Descriptors use `2026-08-step-descriptor-v1`. They describe one exact
source-bound step and its evidence requirements without carrying a workflow
Gate, approval requirement, risk classification, or operation registry.

The report-only command family is:

```bash
aos work-record list [--root path ...] --json
aos work-record read <id-or-path> [--root path ...] --json
aos work-record verify <id-or-path> [--profile aos.verifier.work-record.v1.report-only] [--root path ...] --json
aos work-record status <id-or-path> [--profile id] [--root path ...] --json
aos work-record plan-repair <id-or-path> [--profile id] [--root path ...] --json
aos work-record plan-attempt <id-or-path> [--profile id] [--root path ...] --json
aos work-record export <id-or-path> [--profile id] [--root path ...] --json
```

Discovery is bounded to explicit roots plus the documented repository-local
defaults. `read`, `verify`, `status`, and both planners accept only active
V1 records. Unsupported historical or unknown schemas fail closed without
rewriting their source bytes.

`plan-repair` emits
`2026-08-work-record-repair-plan-v1`, a non-executing mechanical proposal.
`plan-attempt` emits
`2026-08-work-record-repair-attempt-plan-v1`, bound to the exact source and
Repair Plan digests. Attempt Plan status `ready` means only that the proposal
inputs are complete, exact, and source-bound. Neither planner runs commands,
applies patches, mutates the source, or decides whether a caller may act.

A caller records separately obtained outcomes with:

```bash
aos work-record attempt-artifact build --input caller-outcomes.json --json
aos work-record attempt-artifact validate repair-attempt-artifact.json --json
```

The active Attempt Artifact schema is
`2026-08-work-record-repair-attempt-artifact-v1`. It retains exact plan and
source identities, operation-to-outcome mapping, timing, evidence references,
postconditions, cleanup, rollback, verifier-before/after health, and source
immutability. Successful artifacts fail closed unless required outcomes,
evidence, verifier-after health, cleanup, and matching source before/after
digests are present. Every planned candidate patch also requires an exact
caller-supplied outcome containing the source digest, complete proposed
execution-map payload and digest validated against the Work Record V1
execution-map definition, and evidence refs. Postcondition results use
their canonical `id` and may map exact caller evidence. The builder accepts
these outcomes; it does not execute or apply them. Builder payloads that are
unsupported or mismatched are command failures and exit nonzero.

Read-only recovery guidance and bounded bundle materialization are:

```bash
aos work-record repair guide <id-or-path> [--attempt-plan path] [--attempt-artifact path] [--replacement-root dir] [--index-root dir] --json
aos work-record repair bundle <id-or-path> --output-root <dir> [--attempt-plan path] [--attempt-artifact path] [--replacement-root dir] [--index-root dir] [--dry-run] --json
aos work-record repair bundle inspect <bundle-root> --json
aos work-record repair bundle status --bundle-root <dir> [--bundle-root <dir> ...] [--bundle-parent <dir> ...] --json
```

The guide and bundle never run their descriptors. Bundle writes are contained
under the explicit output root, reject traversal and symlink escapes, preserve
artifact digests, and carry explicit non-execution flags. Inspection and status
verify manifest, artifact, descriptor, digest, missing-input, and bounded-path
state without exposing a permission or continuation projection.

Replacement and supersession remain separate exact finalization mechanics:

```bash
aos work-record replacement-proposal build --source <id-or-path> --attempt-plan plan.json --attempt-artifact artifact.json --json
aos work-record replacement-proposal validate proposal.json --json
aos work-record replacement-proposal write proposal.json --output-root <dir> [--dry-run] --json
aos work-record repair finalize --source <id-or-path> --attempt-plan plan.json --attempt-artifact artifact.json --replacement-root <dir> --index-root <dir> [--dry-run] --json
aos work-record supersession write --source <id-or-path> --replacement <id-or-path> --index-root <dir> --writer-result <path> [--dry-run] --json
aos work-record supersession lookup --source <id-or-path> --index-root <dir> --json
aos work-record supersession validate <entry-path> --json
```

Finalization validates the exact source, Repair Plan, Attempt Plan, Attempt
Artifact, replacement proposal, destination preflight, and supersession
digests. Replacement Proposal projects the exact caller-supplied execution-map
patch and evidence mapping; Replacement Writer copies those bytes and never
synthesizes observations from expected values or upgrades historical Claim
Results without exact new evidence. It preserves the source bytes and writes
only under explicit replacement and index roots. `supersession write` requires
the exact Replacement Writer Result. Replacement and supersession writers
re-check their bound source identities after publication, and finalization
returns receipted partial state for post-publication readback failure rather
than dropping already-completed side effects. One canonical create-if-absent
active entry per exact source identity prevents concurrent distinct
replacements from both becoming active. Partial recovery requires the caller to
persist the successful Replacement Writer Result before a supersession-write
command can be formed. Explicit roots and their existing ancestors are checked
before dry-run or write; non-system symlink ancestors and symlinked index trees
fail closed, containment inspection failures return typed results, and later
bundle I/O failures retain receipts for every artifact already published.

Gate remains a separate, explicitly invoked neutral structured-input primitive.
No Gate record, answer, resume event, or deferred continuation is accepted by a
Work Record command, changes an Attempt Plan status, or authorizes later
finalization or unrelated mutation. There is no public Work Record fixture
executor, operation registry, repair-execute form, gate-request form, or
gate-check form.
## `aos do`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `click` | click coordinates or AOS canvas semantic refs; browser Observation Refs fail closed |
| `hover` | coordinate hover; browser Observation Refs fail closed |
| `drag` | direct canvas semantic drag (`--by` / `--to-value`) or native coordinate drag; browser Observation Refs fail closed |
| `scroll` | whole-session managed-browser scroll with `dx,dy`, or coordinate scroll with `--dx` / `--dy`; browser refs fail closed |
| `type` | whole-session managed-browser text input or literal native text input; browser refs fail closed |
| `key` | whole-session managed-browser key press or literal native key combo; browser refs fail closed |
| `press` | saved native AX press or direct `--pid` / `--role` AX press |
| `set-value` | saved refs, direct AX, or AOS canvas semantic set-value |
| `focus` | saved native AX focus or direct `--pid` / `--role` AX focus |
| `activate` | activate an app by pid |
| `quit` | gracefully quit an app by pid |
| `hide` | hide an app by pid |
| `unhide` | unhide an app by pid |
| `raise` | raise an app/window |
| `move` | move a window |
| `resize` | resize a window |
| `close` | close an exact window by pid and window id |
| `minimize` | minimize an exact window by pid and window id |
| `maximize` | maximize an exact window by pid and window id |
| `restore` | restore an exact minimized/maximized window by pid and window id |
| `menu` | invoke an exact app menu path by pid |
| `tell` | AppleScript verb |
| `session` | interactive action session |
| `profiles` | inspect behavior profiles |

Every semantic action target is one of two V1 handles:

- A browser Observation Ref is the original `state_id` plus Playwright ref and
  browser session. Saved requests validate the stored handle record; direct
  requests validate the exact ref grammar. Because the reviewed backend cannot
  atomically bind a ref to a current managed session generation, both stop with
  `TARGET_ACTION_UNSUPPORTED` before managed-session dispatch; they never
  recapture, search by label, replace state, or dispatch a potentially aliased
  ref.
- A canvas or native AX Locator is a machine query re-resolved at action time.
  Zero action-compatible matches return `TARGET_NOT_FOUND`; more than one
  returns `TARGET_AMBIGUOUS`. Native `--index` explicitly selects one bounded
  action-compatible candidate, while `--near` succeeds only for a unique
  closest action-compatible candidate and rejects ties. Native depth is bounded
  to `0...128` and timeout to `1...30000` milliseconds.

```bash
aos do click 500,300
aos do click ref:<snapshot-id>:<ref> --workspace <id>
aos do click canvas:<canvas-id>/<ref>
```

Coordinates and Locators reject `--state-id` with
`TARGET_STATE_UNSUPPORTED`. Native NDJSON session requests likewise reject a
`state_id` before dispatch. Browser session-only `type` and `key` remain
available without a ref or state. Ref-bearing browser actions are not
advertised public forms:

```bash
aos do type browser:<session> "hello world"
aos do key browser:<session> "cmd+s"
```

Saved `ref:<snapshot-id>:<ref>` is storage indirection to exactly one of those
handles. Bare `ref:rN` is unsupported. V0 workspace files are preserved as
bytes but rejected with `AGENT_WORKSPACE_SCHEMA_UNSUPPORTED` and
`recapture_required:true`; AOS does not maintain a dual reader. Saved dry-run
performs the same handle validation or Locator resolution as mutation and stops
immediately before the effect.

The target result vocabulary is `TARGET_HANDLE_INVALID`,
`TARGET_STATE_REQUIRED`, `TARGET_STATE_STALE`, `TARGET_STATE_UNSUPPORTED`,
`TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, `TARGET_DISABLED`,
`TARGET_ACTION_UNSUPPORTED`, and `TARGET_RESOLUTION_TIMEOUT`. Grammar and local
workspace failures retain their own typed errors. Workspace locks are transient
local contention controls, not target identity.

`--dwell` is a coordinate/native and AOS canvas click option. Direct browser
clicks and browser saved refs reject it. Browser focus and text assertions are
not separate public actions in this slice: `aos do focus` is native AX only,
and saved workspaces do not expose `aos see assert`.

Use `canvas:<canvas-id>/<ref>` when a target was discovered in
`aos see capture --canvas <canvas-id> --xray`. Agents should pass
`semantic_targets[].provenance.do_target` directly when present;
`provenance.canvas_id` and `ref` remain available for structured filtering.
The CLI re-resolves the current AOS-owned canvas Locator through the fixed probe
path and requires exactly one enabled, interactive match. Canvas Locators never
carry snapshot state. Direct one-shot and session responses report an additive
`execution` object:

```json
{
  "execution": {
    "strategy": "cgevent_click",
    "backend": "cgevent",
    "fallback_used": false,
    "state_id": "see_abc123def456",
    "terminal_event_receipt": "aos-input-41a0000100000001"
  }
}
```

`strategy` names the path that actually ran, `backend` identifies the actuator
family (`cgevent`, `ax`, `applescript`, `playwright`, `canvas`, or `session`), and
`fallback_used` is reserved for paths that intentionally degrade from a
preferred semantic strategy. `duration_ms` remains the top-level timing field on
session responses. Successful CoreGraphics actions with a discrete terminal
event include an opaque `terminal_event_receipt` after the action process
observes that exact event at the session event tap. Continuous hover motion may
be coalesced by macOS and does not claim this receipt. Callers must not parse or
construct receipt values.

Direct AX `press`, `focus`, and `set-value --pid ... --role ...` use the same
current exact-one Locator selection as saved native handles. Their wrapper
continues to report bounded primitive `conformance` evidence without claiming
foreground, focus, cursor, Space, or TCC acceptance. Native `focus` and
`set-value` responses also include `execution.ax_focused_after`,
`execution.ax_value_after`, and `execution.ax_value_matches_request` when the
primitive can read the resulting AX state.

Canvas ref click responses also include the resolved target details, including
the target dialect, canvas id, ref, local semantic-target center, global click
point, coordinate space, capture scale factor, and source
`aos_semantic_targets`. Raw coordinate actions remain separately available for
surfaces that do not expose a semantic target.

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

For V1, single-thumb toolkit sliders support immediate `set-value` and
`drag --to-value` through the canvas semantic action route. Multi-thumb sliders
advertise `drag` but not single-value `set-value` unless a future thumb-specific
target exists. Toolkit panel drag handles support immediate `drag --by` by
updating the current canvas frame; `--playback human` resolves the current
target center and uses CGEvent as a visible playback implementation detail.

Target-addressed responses include the action, backend, playback mode,
execution metadata, resolved target details, and post-action semantic state
when available. Browser results preserve the validated Observation Ref
`state_id`; Locator and coordinate results do not accept state provenance.
No actionable result reports reacquisition.

Gesture and Work Record projections may carry the exact discriminated V1
handle plus primitive actions, current state, and provenance. They must not
promote labels or coordinates into durable identity or treat a stale
Observation Ref as a Locator.

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
printf '%s' 'Hello' | aos say --follow --rate 180
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

`say --follow` is the connection-scoped streamed system-speech form. It reads
text only from stdin, emits strict `voice` lifecycle and `audio_frame` NDJSON,
and supports cancellation and microphone barge-in. Events and errors never
echo the spoken text. Existing one-shot `aos say` behavior is unchanged.

## `aos play`

Play one bounded local PCM WAV through the same daemon-owned output broker used
for streamed system speech:

```bash
aos play --audio /private/tmp/aos-command/audio.wav --follow
```

The input must be a canonical owner-only `0600` regular file beneath a
canonical owner-owned `0700` directory. Symlinks, files over 4 MiB, durations
over 120 seconds, more than two channels, and unsupported PCM formats fail
before playback. Follow output includes lifecycle facts and the exact
`audio_frame` meter stream used for playback, but never the input path or audio
content. The lease is connection-scoped and shares cancellation, barge-in, and
daemon-shutdown cleanup with streamed speech.

## `aos shortcut`

Run one caller-selected Apple Shortcut by exact name:

```bash
aos shortcut run 'Prepare Focus Mode' --timeout 30s --json
```

The adapter invokes `/usr/bin/shortcuts` without a shell, bounds execution to 1
through 120 seconds, caps combined output at 64 KiB, and returns a typed receipt
with status, duration, and byte counts. Captured process streams remain outside
that bounded receipt. AOS does not discover commands or interpret voice phrases;
the caller supplies the exact Shortcut name.

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

Registered role sessions should use stable session ids for true final-response
TTS instead of provider-transient hook ids. Role-local status notices are fixed
status messages, not the assistant's final answer; route those through
`aos say --voice-slot <n> "<notice>"` rather than
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

Consumer renderers may publish their latest `aos_context_session` plus an active
keyframe candidate to a renderer-local context provider, while `ctrl+opt+c`
continues to derive canonical Surface Inspector context inside the daemon bundle
path. A daemon-visible provider remains a separate contract decision.

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

`aos tell` is daemon-routed communication, not an app-control synonym for
`aos do tell`. Messages flow through the daemon coordination bus into named
channels or direct canonical-session channels. Session presence is daemon state
mirrored into `~/.config/aos/{mode}/coordination/sessions.json`; channel
messages remain daemon-owned bounded queues instead of model-context history.

Direct routing should prefer canonical session ids. Human-readable names remain
display metadata for `aos tell --who` and operator ergonomics. Presence is
lease-based and restored from the runtime snapshot after daemon restart.
Discover peers with `aos tell --who`, then keep using direct `--session-id`
routing once a peer id is known; direct session messaging does not require
`--who` to be non-empty at send time.

Role sessions are ordinary registered sessions. Supervisors should register
each role before launch with stable ids such as `<run-id>:worker`, include role
and harness metadata, and unregister the session after that role completes.
This keeps `aos tell --who`, `aos voice assignments`, and role-session status
aligned around the same role session identity.

## `aos listen`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<channel>\|--session-id <id> [--since id] [--limit N]` | read recent channel or direct-session messages |
| `<channel>|--session-id <id> --follow [--since id]` | stream messages as NDJSON |
| `--source hotkey [--shortcut <chord>] --follow` | consume one exact global hold-to-talk chord and stream generic dictation lifecycle events |
| `--source microphone --output <absolute.wav> --follow [--max-duration 120s]` | capture 16 kHz mono PCM into a bounded create-new WAV while streaming meters |
| `--source microphone --segments <absolute-directory> --follow [--segment-duration 3s] [--max-duration 120s]` | capture continuous 16 kHz mono PCM into atomic segment checkpoints while streaming meters |
| `--channels` | list known channels |

Both microphone forms accept `--client-id`, `--agent-id`, `--project-id`,
`--task-id`, `--run-id`, `--skill-id`, `--target-id`,
`--capability-label`, and `--retry-id`. The values are caller-asserted generic
lineage attached atomically to the operation created for that invocation. They
are descriptive and narrowing-only: they cannot replace the authenticated
owner root, admit a spawn, grant a claim, or widen control.

Examples:

```bash
aos listen handoff
aos listen handoff --limit 10
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
aos listen --source hotkey --shortcut Control+Option+Space --follow
aos listen --source microphone --output /private/tmp/aos-voice/capture.wav --follow --max-duration 120s
aos listen --source microphone --segments /private/tmp/aos-voice/segments --segment-duration 3s --follow --max-duration 120s
aos listen --channels
```

One-shot reads return a JSON envelope with a `messages` array. `--follow` emits
one message per line as NDJSON. `--channels` lists the daemon-known channel
names; it is discovery for existing daemon communication state, not a workspace
or transcript index.

The hotkey form is connection-scoped, consumes only its exact chord, suppresses
repeat events, and never exposes unrelated key events. The one-shot microphone
form requires an absolute create-new `.wav` target under a canonical,
owner-owned `0700` directory. The segmented form requires an absolute,
canonical, empty, owner-owned `0700` directory and atomically publishes
deterministic `segment-000001.wav` files after each bounded checkpoint. Every
file is `0600`, mono 16 kHz PCM. A lease is at most 120 seconds and 4 MiB across
all segments; segment duration is 500 milliseconds to 5 seconds.

`SIGINT` finalizes the one-shot file or current partial segment. `SIGTERM`,
disconnect, daemon shutdown, or failure removes every output still owned by the
lease. `capture_segment_ready` identifies only an index, duration, and byte
count; consumers derive the deterministic filename from the directory they
supplied. Capture events contain no audio or path. AOS does not transcribe the
WAV; local STT and dictation policy are consumer responsibilities.
Cross-segment text stability and endpointing are also consumer-owned. Stdin,
webhook, and file-watch listen sources remain unimplemented.

The managed daemon owns microphone authorization. On first capture from
`not_determined`, that daemon calls `AVCaptureDevice.requestAccess(for:.audio)`
and waits for the bounded result before creating the WAV. Live state remains
distinct as `not_determined`, `restricted`, `denied`, or `authorized` in daemon
health and readiness. If denied, open the Microphone privacy pane from the
reported `settings_url` and poll `aos permissions check --json`; there is no
Plus/drag-add recovery path for Microphone. Foreground CLI preflight never
substitutes for daemon authorization.

## `aos operation`

`aos operation` is the public, policy-free control plane for work registered by
an AOS operation adapter. The registry currently contains native microphone
capture and fixed screen recording with mandatory video plus optional system
audio at adapter-registry revision 2.
The surface reports mechanical facts and performs requested controls. It does
not decide whether a human or agent should stop work, and it accepts neither
caller intent nor a caller-supplied owner-root claim.

Primary public forms:

| Form | Purpose |
| --- | --- |
| `list [filters] --json` | List current registered operations owned by the authenticated caller root and narrowed by optional metadata. |
| `inspect <id> --generation <n> --json` | Read one exact operation generation. |
| `status <id> --generation <n> --json` | Read its compact lifecycle, outcome, residual, artifact, and cleanup status. |
| `recent [filters] --json` | Read bounded recent terminal operations for the authenticated owner root. |
| `cancel <id> --generation <n> --json` | Request cooperative cancellation of one exact owned operation. |
| `kill <id> --generation <n> --json` | Force-stop one exact owned operation and keep cleanup observable. |
| `kill-owner [filters] --json` | Stop the intersection of the authenticated owner root and optional attribution/capability filters. |
| `tap --json` | Return `OPERATION_TAP_UNAVAILABLE`; no source is registered, so no tap record or delivery channel is created. |
| `artifact reveal <artifact-id> --generation <n> --json` | Revalidate and disclose one exact owned offered recording artifact. |
| `artifact remove <artifact-id> --generation <n> --json` | Revalidate and remove one exact owned offered recording artifact. |
| `artifact release <artifact-id> --generation <n> --to <absolute-path> --json` | Transfer one exact owned offered recording artifact without overwrite on the same volume. |
| `artifact retain <artifact-id> --generation <n> --json` | Return `OPERATION_ARTIFACT_RETAIN_UNAVAILABLE`; this producer does not retain custody. |
| `stop-all --barrier-generation <n> --json` | Same-UID host-wide stop over the exact registered adapter set at one revision. |
| `barrier-status --json` | Read the immutable stop snapshot, progress, residual scope, and current barrier generation. |
| `reopen --barrier-generation <n> --json` | Reopen admission only after the stopped snapshot and current registered set are reconciled. |

The optional filters are `--capability-id`, `--client-id`, `--agent-id`,
`--project-id`, `--task-id`, `--run-id`, `--skill-id`, `--target-id`, and
`--capability-label`. The daemon derives ordinary ownership from the Unix-socket
peer and its verified process ancestry. Filters only intersect that owner set;
they never expand it. Exact-id controls require an operation generation so PID
reuse, retained identifiers, and stale UI state cannot redirect a request.

`stop-all` is deliberately separate from owner-scoped cancellation. Any
mechanically authenticated same-effective-UID local caller can request it over
the official CLI/IPC surface; the internal status item and its status-opened
Canvas use the same control entrypoint. The request compare-and-swaps the current
barrier generation, records its caller origin, captures an immutable registered-
set and selected-operation snapshot, and returns an idempotent receipt. Retrying
the same retained request id returns the original receipt. A new or pruned
request must satisfy the current generation again.

The status item is a separate internal projection, not a consumer status-item
lease. It remains available during boot reconciliation, turns red only while a
registered recording-class operation is active, opens the richer operation
Canvas explicitly from its menu, and shows the exact barrier state and
generation. Confirmed `stop-all` and confirmed `reopen` bind that displayed
generation and the current daemon-owned status-host lease epoch, then execute
serially off the AppKit main thread. Lease retirement rejects new admissions
without blocking AppKit; an already-admitted action remains bound to its clicked
barrier generation. Both confirmations are presentation only; they do
not assert human intent or grant authority. Typed control failure preserves and
refreshes the last good status snapshot rather than hiding barrier state. The status-opened Canvas can inspect all
registered operations and request `stop-all`; it cannot borrow ordinary owner
authority. An ordinary Canvas with a live captured peer may use owner-scoped
controls only. Status and Canvas provenance authenticate the request path but do
not express human intent or create a privileged authorization class.

Tap success is not current executable capability. The daemon returns the closed
error envelope used by the CLI and IPC schemas:

```json
{"v":1,"status":"error","error":"OPERATION_TAP_UNAVAILABLE","code":"OPERATION_TAP_UNAVAILABLE","ref":"<request-id>"}
```

Producer-backed recording artifacts accept only the exact artifact id and
generation returned at admission. Reveal, remove, and release revalidate the
recorded device, inode, byte count, digest, media type, internal-root
containment, and owner root before custody mutation. Release requires an absent
absolute destination in an existing owner-owned directory on the source
volume. Other producers do not gain artifact success implicitly, and retain is
specifically unavailable. Tap sampling and followed geometry remain future
contracts.

The host barrier covers the registered operation plane at the recorded adapter-
registry revision, not every legacy daemon subsystem. `reopen` does not claim
success while a selected operation, resource claim, stream, tap, artifact, or
recovery obligation remains unresolved. Cleanup failure remains visible as
`cleanup_required`, `recovering`, or `blocked_unresolved`; AOS does not hide it
behind a successful kill receipt.

The current microphone adapter's external Node hop is private implementation,
not additional public grammar. Only an invocation matching the closed
`listen_microphone_v1` predicate prepares an operation/claim. Its opaque token
stays with the authenticated native parent for child admission or abandon. AOS
dynamically validates the exact Node.js Foundation signed child image and
mapped vnode before the dispatcher writes the already reviewed entry/helper
bytes as an in-memory module bundle; the child then finalizes tokenlessly from
its authenticated socket-peer generation. Failed launch, expiry, boot recovery,
or finalization failure terminalizes the prepared operation and releases its
claim. No caller supplies these internal origin, token, PID, signing, or
dependency facts.

## `aos record`

`aos record screen` admits one fixed screen recording producer through the shared
operation plane:

```bash
aos record screen --display main --duration-ms 10000 --json
aos record screen --display 1 --region 0,0,1280,720 \
  --duration-ms 5000 --frame-rate 30 --json
aos record screen --display main --duration-ms 10000 --system-audio --json
```

The target is exactly one display, one current window, or one global region
wholly contained by the selected display. Admission binds the canonical
topology, source identity, and fixed geometry before ScreenCaptureKit authority
starts; later drift fails the operation instead of silently reacquiring or
following a target. Duration is 1 through 300000 milliseconds, frame rate 1
through 60, queue depth 1 through 8, pixel count 4 through 33177600, and output
size 1024 through 1073741824 bytes. The closed media contract is mandatory
H.264 video in one QuickTime `.mov`, with explicit optional AAC-LC system audio.
Omitting `--system-audio` preserves exact video-only output. `video=false`,
`microphone=true`, malformed track selection, and followed geometry fail before
effects.

Success is admission, not completed capture. It returns exact operation,
stream, and artifact generations plus daemon generation, geometry-binding
digest, selected tracks, and an initial content-free track summary. Progress,
terminal facts, artifact identity, and custody receipts bind independent
selected/admitted/available/sample/failure/drain/finalized truth for video and
system audio. Selected audio that is unavailable, never samples, or fails is a
typed failure; it is never silently omitted. Use `aos operation status`, cancel,
or kill for lifecycle control, then an artifact action above for custody. AOS
owns the transient file until remove or same-volume release, and boot recovery
removes abandoned internal recording artifacts. This slice has offline, fake,
schema, and native compile-only proof;
live pixels, files, permissions, daemon restart, and crash behavior are not
accepted by those checks.

## `aos wiki`

Primary public verbs for knowledge-base consumers:

| Subcommand | Purpose |
| --- | --- |
| `list` | enumerate indexed wiki entries |
| `show` | fetch one page by path or bare name |
| `graph` | emit the canonical `wiki-kb` graph payload |
| `search` | full-text search across indexed pages |
| `put` | conditionally create or update one Markdown page from stdin |
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

`aos wiki put` is the conflict-safe publication boundary for consumers:

```bash
printf '# Reviewed fact\n' \
  | aos wiki put consumer/concepts/reviewed-fact.md \
      --stdin --if-match none --json

printf '# Revised fact\n' \
  | aos wiki put consumer/concepts/reviewed-fact.md \
      --stdin --if-match "$CURRENT_SHA256" --json
```

Use `none` only to create a path that does not exist. Updating requires the
current SHA-256 of the exact UTF-8 bytes, available from the prior successful
`put` result or computed from the `raw` field returned by
`aos wiki show <path> --json`. Input is limited to 1 MiB. Paths must be
canonical relative `.md` paths beneath the mode-scoped wiki root; traversal,
symlinks, and non-regular targets are rejected. Writes are serialized, atomic,
and `0600`. A successful write reindexes the wiki and follows the normal wiki
change-event path when the daemon watcher is active.

JSON success uses the
`shared/schemas/aos-wiki-put-result-v1.schema.json` contract and returns only
the relative path, operation, byte count, previous/current hashes, and reindex
status. Conflict errors use `WIKI_CONFLICT` with `exists`, `expected_sha256`,
and `actual_sha256`; neither success nor error output includes Markdown content
or an absolute filesystem path.

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
- `aos ready` is the read-only front-door managed-daemon readiness gate;
  `aos ready --repair` is its explicit mutation path
- `aos status` / `aos doctor` are observational; they should not be relied on to
  implicitly start a daemon for the current runtime
- the default `~/.config/aos/{repo|installed}` runtime is single-owner,
  launchd-managed, and tied to the primary agent-os checkout. Linked git
  worktrees cannot use the default repo runtime; runtime-coupled tests from an
  alternate checkout must set an isolated `AOS_STATE_ROOT`.
  Default-root foreground dev ownership is a cleanup-required readiness blocker.

This is runtime state in the
[user-facing state model](./aos-capabilities.md#user-facing-state-model). It is
separate from saved workspace contents, focus-channel bindings, and durable
evidence artifacts, even when commands report them together for diagnosis.

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
- `aos ready [--json] [--repair] [--post-permission]` evaluates one canonical
  readiness decision and returns structured `phase`, `diagnosis`, `blockers`,
  `next_actions`, and `action_trace` fields. Plain `ready` and
  `ready --post-permission` are read-only: each collects facts once, reports
  `startup.attempted:false`, and never starts, restarts, cleans, opens Settings,
  changes permissions, or writes a TCC-alert marker. `--post-permission` labels
  verification after the human re-grants Accessibility or Input Monitoring.
  The generated resume command is
  `aos ready --repair --post-permission`: that exact combination may perform at
  most one same-mode launchd-managed restart, then requires fresh live daemon
  tap/listen/post facts during a bounded recheck. It fails closed without
  mutation when ownership is unmanaged or mismatched, runtime/service modes
  differ, or the launchd target does not match the expected binary path.
  `--repair` is the only readiness form allowed to clean, start or restart the
  runtime, wait for recovery, play the stale-TCC alert, or write its one-shot
  marker. All readiness forms may report the same read-only `terminal_handoff`
  and terminal reset actions when the canonical diagnosis requires human work.
  When passive CLI grants are green but the live daemon reports denied
  Accessibility/Input
  Monitoring, repair reports `post_rebuild_tcc_stale`, plays the handoff alert
  once per binary identity, and the agent ends the turn until the user replies
  `finished` after manually resetting/regranting TCC. Linked-worktree blockers
  stop before service
  start/restart, stale daemon owners and default-root foreground dev owners are
  cleaned before service start/restart, and unmanaged socket owners are reported
  as PID/command facts
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
  `aos ready --repair --post-permission` to refresh and verify the recovered
  daemon after the human grant. Service-wide TCC
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
  from the full capability permission set: daemon Accessibility and Input
  Monitoring facts when available, per-field CLI fallback for those facts,
  CLI Screen Recording, daemon Microphone authorization, and setup completion.
  The top-level `permissions` object is the effective readiness view and includes
  `accessibility`, `screen_recording`, `listen_access`, `post_access`, and
  `microphone`. `cli_view.microphone` remains diagnostic. The daemon-side view
  includes `microphone` and `microphone_state`; absent or non-authorized daemon
  state fails voice readiness closed. Daemon Screen Recording is not reported.
- `aos permissions prime screen-capture --json` explicitly primes the
  daemon-owned, process-lifetime direct desktop-capture capability. It requests
  screen-capture authorization on a dedicated serial worker, then performs one
  bounded in-memory ScreenCaptureKit probe and discards the image. It returns
  only `capability`, `status`, `capture_persisted=false`, and a bounded typed
  `error_code`. The discarded setup frame and arbitrary native diagnostics
  remain outside this status contract. Permission-request and probe timeouts
  remain distinct.
  `permissions check` reports the same status passively but never prompts.
  Until a prime succeeds, scene desktop-frame requests fail with
  `DESKTOP_FRAME_CONSENT_REQUIRED` without invoking ScreenCaptureKit.
- `aos permissions setup --once` requests Accessibility, Screen Recording, and
  Input Monitoring from their existing primitives, and routes Microphone
  through the managed daemon's explicit authorization request. `not_determined`
  is requestable; `denied` opens the Microphone settings pane and is polled from
  daemon health; `restricted` remains distinct. Microphone recovery never uses
  `permissions reset-runtime` or a drag-add instruction.
- The permissions onboarding marker is mode-scoped and proves the operator has
  completed the setup flow for that runtime mode. The marker's recorded
  `bundle_path` is diagnostic only: in repo mode, readiness does not fail solely
  because another worktree last wrote the marker when the current CLI grants and
  daemon input tap are verified green.
- `aos ready --json`, `aos status --json`, and `aos doctor --json` expose
  `runtime_verdict` as the shared readiness/action-plan contract:
  `ready`, `phase`, `diagnosis`, `blockers`, `blocked_capabilities`, `notes`,
  `next_actions`, `ownership`, and `cleanup`.
- When passive CLI permission checks are granted but the live daemon view
  reports denied Accessibility or Input Monitoring after a rebuild,
  `runtime_verdict.tcc_staleness` names the condition as
  `post_rebuild_tcc_stale`, includes side-by-side `cli_passive` and
  `daemon_live` booleans, includes the current runtime binary identity
  (`path`, `mtime`, `cdhash` when available), and carries the manual reset
  remedy. `aos ready --json` also exposes the same object at top-level
  `tcc_staleness` plus a top-level `terminal_handoff` telling agents to stop
  the current turn, wait for the user signal `finished`, and then run
  `./aos ready --repair --post-permission`.
- When `runtime.ownership_state` is `"unmanaged"`, JSON exposes
  `runtime.owner_process` and `runtime_verdict.ownership.owner_process`.
  The process command line is either present as `command_line` or explicitly
  unavailable via `command_line_status` and
  `command_line_unavailable_reason`.
- `aos status --json` exposes the current structured `runtime.input_tap`
  block; there is no parallel flat input-tap response shape.
- `aos status --json` also exposes top-level `readiness`, a compact projection
  of `runtime_verdict` with `ready`, `status`, `phase`, `diagnosis`,
  `ready_for_testing`, `ready_source`, `blocked_capabilities`, and any
  `tcc_staleness` / `terminal_handoff` summary. This lets agents distinguish
  recovered TCC/runtime readiness from unrelated overall status degradations
  such as stale resource cleanup notes.
- `aos status --json` exposes `stale_resources.foreground_dev_owners` as the
  PID list for default-root foreground dev owners reported by `aos clean`.
- `aos status` text mode includes `readiness=<status>`, `ready=<bool>`, and
  `tap=<status>` in the one-line summary.
- `aos doctor --json` exposes top-level `ready_for_testing` and
  `ready_source`.
- `aos service install`, `start`, and `restart` block-and-poll for up to 5s
  after launchctl kickstart and exit non-zero with `reason: "input_tap_not_active"`
  or `"socket_unreachable"` when the daemon is not fully ready.
- Service readiness JSON includes `runtime_ownership`, sourced from native
  `__runtime status-facts --json`. A broker classification of
  `ownership_kind: "foreground_dev"` is acceptable for isolated development
  state roots, but default-root readiness reports
  `daemon_foreground_dev_default` and routes through `aos clean`. A linked git
  worktree without explicit `AOS_STATE_ROOT` reports
  `agent_os_worktree_default_runtime` and must not touch the default runtime.
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
    "./aos serve --idle-timeout 30m"
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

**See also:**
- [`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md) for the canonical `system.ping` payload schema.
- [`shared/schemas/CONTRACT-GOVERNANCE.md`](../../shared/schemas/CONTRACT-GOVERNANCE.md) for the contract rules these consumers follow.

## Content Server Contract

Toolkit and app canvases are typically loaded through `aos://...` URLs backed by the content server.

Minimal setup:

```bash
aos set content.roots.toolkit packages/toolkit
```

Alternate-checkout runtime proofs must use an explicit isolated
`AOS_STATE_ROOT`; the default repo runtime does not serve linked git worktrees.

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

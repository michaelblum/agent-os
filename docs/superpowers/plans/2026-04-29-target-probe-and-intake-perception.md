# Target Probe and Intake Perception Options

Status: decision/options capture. This is not yet an implementation ticket list.

Related durable anchors:

- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`
- `docs/superpowers/plans/2026-04-28-human-intent-sensing-and-steerable-collection-revised.md`
- `docs/superpowers/plans/2026-04-29-supervised-test-runs-hitl-test-console.md`
- `packages/toolkit/browser-intent-sensor/`
- `src/perceive/cursor.swift`
- `src/perceive/ax.swift`
- `src/commands/inspect.swift`
- `src/browser/`

## Core Shape

AOS needs a shared target-acquisition primitive for "what is the human pointing
at?" and "what can the agent safely know about that target right now?" This
should not be a screenshot-first feature. The fast path should use structured
host and browser perception:

```text
cursor / hover / explicit user gesture
  -> target probe
  -> compact context bundle
  -> addressable handles for deeper inspection
  -> optional downstream projection:
       research intake
       steerable collection mark
       supervised test evidence
       workflow playback anchor
       agent/user collaboration focus
```

The key product idea is a laparoscopic probe: pierce into a surface, gather a
small high-signal packet, and expose handles that let the agent expand only the
parts it needs. The default probe must be fast enough that an agent can use it
without deliberating. Deeper inspection should be explicit, budgeted, and
addressable.

## Why This Belongs In AOS Primitives

The same pattern appears under different names:

- Human intent sensing captures marks, comments, locator candidates, and source
  pack evidence.
- Supervised test runs capture steps, human confirmations, failures, notes, and
  artifacts.
- Workflow playback needs stable anchors and observations.
- Research intake needs raw artifact pointers plus processed knowledge nodes.
- Agent/user collaboration needs a current object of focus that is more precise
  than the focused app or focused control.

These are sibling projections over a shared substrate. The shared primitive is
not "research intake" or "test console"; it is structured target acquisition
plus an evidence/artifact timeline.

## Decomposing Steerable Collection

Steerable collection should decompose into smaller primitives that can be reused
outside browser collection:

```text
run control
  pause / resume / step / abort / take over

target probe
  what is the human pointing at, marking, or referring to?

intent event
  what did the human mean to communicate about that target?

agent action
  what does the agent propose, perform, observe, or acknowledge?

timeline
  single-writer ordered JSONL record of the run

artifact pack
  raw captures, logs, source files, screenshots, transcripts, and references

projection
  browser source pack, supervised test report, playback fixture, research
  intake packet, or collaboration transcript
```

In that decomposition, the target probe sits below `human.mark`. A mark is a
domain event that says "the human marked this thing for this run." A target
probe is the reusable perception packet that says "this is the thing and here
are the handles and cheap context needed to reason about it."

That gives browser steerable collection this shape:

```text
browser point/selection/region
  -> target.probe
  -> human.mark
  -> agent.mark.acknowledged
  -> evidence-item
  -> source-pack projection
```

And it gives supervised testing a parallel shape:

```text
test step asks for visual confirmation
  -> target.probe
  -> test.human.confirmed / failed / blocked
  -> test artifact
  -> test report projection
```

Research intake uses the same skeleton with different vocabulary:

```text
human points at file/link/page/transcript region
  -> target.probe
  -> intake.requested
  -> raw artifact pointer
  -> processed knowledge nodes
  -> wiki/source-pack projection
```

The implementation rule follows from that: do not bake browser-specific fields
directly into the substrate. Browser refs, DOM selectors, locator candidates,
and viewport rectangles belong in adapter-specific fields and expansions. The
common substrate should retain only the generic concepts: target, surface, path,
nearby context, handles, available expansions, budgets, privacy, and time.

## Existing Pieces

AOS already has most of the lower-level pieces:

```text
./aos see cursor
  one-shot native cursor/window/AX hit-test

./aos see observe
  streaming perception events

./aos inspect
  live AX inspector overlay driven by see observe

./aos focus create --target browser://attach|new
  browser session/focus entrypoint

./aos see capture browser:<session> --xray
  Playwright accessibility snapshot parsed into AOS elements

./aos do ... browser:<session>/<ref>
  browser action path through Playwright refs

packages/toolkit/browser-intent-sensor/
  in-page DOM descriptor, region selection, and locator candidate generation
```

The missing layer is a shared probe contract that all these surfaces can emit.
Today each piece speaks its own nearby shape.

## Proposed Primitive

Add a target probe contract, probably surfaced as:

```text
./aos see target
./aos see target --json
./aos see target --stream
```

The exact command names are open, but the object should be provider-neutral and
adapter-backed. It should be able to represent native AX elements, browser DOM
or accessibility targets, AOS canvases, and later desktop regions.

Example shape:

```json
{
  "probe_id": "probe_...",
  "mode": "fast",
  "origin": {
    "kind": "cursor",
    "display_id": 2,
    "point": { "x": 1440, "y": 812 }
  },
  "surface": {
    "kind": "native_app",
    "app": "System Settings",
    "window_title": "Privacy & Security"
  },
  "target": {
    "kind": "ax_element",
    "role": "AXStaticText",
    "label": "aos",
    "value_preview": "aos",
    "bounds": { "x": 1220, "y": 492, "width": 38, "height": 18 }
  },
  "path": [
    { "kind": "display", "label": "Display 2" },
    { "kind": "app", "label": "System Settings" },
    { "kind": "section", "label": "Privacy & Security" },
    { "kind": "group", "label": "Input Monitoring" },
    { "kind": "row", "label": "aos", "state": { "enabled": true } }
  ],
  "nearby": [
    { "relation": "sibling-control", "role": "AXCheckBox", "value": true }
  ],
  "handles": {
    "target": "probe://probe_.../target",
    "row": "probe://probe_.../path/4",
    "surface": "native://pid/..."
  },
  "available_expansions": [
    "target.text.full",
    "row.children",
    "surface.visible_controls",
    "browser.dom_context"
  ],
  "budgets": {
    "elapsed_ms": 34,
    "text_preview_chars": 180,
    "max_nodes": 12,
    "max_depth": 6
  }
}
```

## Budget Model

Do not lock the system to a magic `150` character slice. The old DRAW context
bundle used a fixed preview cap, which is a sensible ancestor, but the AOS
contract should budget the whole packet instead of each field in isolation.

Suggested modes:

| Mode | Target latency | Text budget | Node budget | Purpose |
|---|---:|---:|---:|---|
| fast | 30-50 ms | 800-1200 chars | 8-12 nodes | default cursor/hover probe |
| useful | 100-200 ms | 2500-4000 chars | 20-40 nodes | explicit one-shot before acting |
| deep | explicit | caller-set | caller-set | artifact extraction or replay prep |

The default should opportunistically include cheap adjacent context when it is
available in the same call. For example, if the cursor is over the text label in
a macOS permission row, and the sibling checkbox state is cheap to read, include
that state in `nearby` or the row path. If getting that relationship would cross
an expensive adapter boundary, report an available expansion instead.

## Addressable Fan-Out

The probe bundle should be both an ephemeral packet and a movable fixture. It
should let an agent ask for more information without starting over or pulling in
the whole world.

Examples:

```text
probe expand probe://.../target --field text.full
probe expand probe://.../path/4 --field children
probe expand probe://.../surface --field visible_controls
probe expand probe://.../browser/ref/e7 --field dom_context
```

The command shape is open. The important contract is that a fast probe returns
stable-enough handles for controlled follow-up inspection.

## Browser Adapter Fit

Playwright Agent CLI and MCP both distinguish between persistent sessions and
token-efficient snapshots. In AOS terms:

```text
long-running browser context
  -> ./aos focus create --target browser://attach|new

one-shot perception
  -> ./aos see capture browser:<session> --xray
  -> future ./aos see target for browser points/refs
```

Playwright refs are useful action handles, but they are not the whole context
bundle. A browser target probe should merge:

- the OS cursor/window point from AOS
- the browser session and viewport geometry from `src/browser/`
- the Playwright accessibility snapshot/ref when available
- DOM-local context from `packages/toolkit/browser-intent-sensor/` when needed
- locator candidates suitable for steerable collection and playback

The current `runPlaywright` wrapper pays subprocess overhead per AOS command.
Named Playwright sessions avoid browser startup, but they do not make each AOS
probe free. Fast browser probes may need batching, a longer-lived adapter, or a
two-tier path where the native probe returns "browser tab under cursor" quickly
and DOM deepening is an explicit expansion.

## Native AX Fit

The one-shot native path already uses the right family of primitives:

```text
CG cursor position
  -> topmost window under point
  -> AXUIElementCopyElementAtPosition
  -> compact AX element info
```

That should become the native implementation of the target probe fast path.

Known issue to investigate: streaming perception currently appears to suppress
changes based mainly on role/title. Moving between same-role elements with empty
titles can look stale even when the cursor is over a different element. The
streaming probe should key change detection on a richer identity such as bounds,
value/label hash, app/window, role, and possibly AX identity where available.
The event name should also distinguish "element under cursor" from actual focus.

## Inspector Fit

`aos inspect` should become the visual surface over target probes, not a
separate perception model. It can remain an overlay/toolkit canvas, but the data
it displays should be the same compact bundle that `./aos see target --json`
returns.

This keeps the design aligned with the entry-path recipe:

- Agent harness: use `see target` to identify current focus/hover object.
- Visual diagnostics: use `aos inspect` to display the same probe stream.
- User-input diagnostics: enrich the probe with event ownership and routing
  evidence.
- Testing/HITL: capture probe events as evidence in a supervised run timeline.

## Research Intake Fit

Research intake should not put entire transcripts, videos, or web pages into the
wiki. Raw artifacts belong in an artifact store or source pack. Wiki nodes and
knowledge graph entries should contain processed knowledge, tags, relationships,
summaries, and pointers back to raw artifacts.

Target probes provide the front-door targeting step:

```text
human points at file/link/page/region
  -> target probe identifies the thing
  -> intake adapter captures or references the raw artifact
  -> processing worker extracts durable knowledge
  -> wiki/source-pack records processed nodes plus source pointers
```

This plan intentionally does not encode personal operator habits. Operator- or
owner-specific preferences need a separate privacy and memory boundary decision
before they are added to durable layers.

## Open Decisions

1. Command vocabulary: should the public command be `aos see target`, `aos see
   probe`, or an `inspect` subcommand? The preferred direction is `see target`
   for the data primitive and `inspect` for the overlay surface.
2. Bundle schema location: if this becomes a cross-tool contract, it likely
   belongs in `shared/schemas/target-probe.schema.json` plus `docs/api/aos.md`.
3. Streaming event name: replace or supplement `element_focused` with
   `target.changed` / `element_under_cursor` semantics.
4. Native path depth: decide which sibling/ancestor relationships are cheap
   enough for fast mode.
5. Browser fast path: decide whether browser point probing can be fast enough
   through the current Playwright subprocess wrapper or needs a persistent
   adapter.
6. Handle lifetime: define whether `probe://...` handles are valid only for one
   run, one process, one browser snapshot, or until page/window mutation.
7. Privacy/redaction: define the default redaction policy for text previews,
   passwords, secure fields, private browser content, and raw artifacts.
8. Consent semantics: define how explicit user gestures, hover state, avatar
   gestures, and natural-language instructions become intent to probe, intake,
   or act.

## Suggested Next Work

Do not start by building research intake UI. Start with the shared probe
primitive and one tight vertical:

1. Write `shared/schemas/target-probe.schema.json` as a draft contract.
2. Fix or characterize the streaming under-cursor identity issue in
   `src/perceive/daemon.swift`.
3. Add a native `./aos see target --json` fast path over the existing cursor and
   AX hit-test machinery.
4. Teach `aos inspect` to render the same target-probe bundle.
5. Add a browser follow-up plan for point-to-ref/DOM context expansion through
   the Playwright adapter and browser intent sensor.
6. Only then project the primitive into research intake, supervised testing, and
   steerable collection issues.

This ordering keeps the work primitive-first and avoids baking a research- or
test-specific shape into the platform.

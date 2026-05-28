# AOS Input Signal Subscription Proposal

## Purpose

Create a reusable AOS pattern for detecting, publishing, and consuming input
signals such as pointer waggles, shortcut keys, mode toggles, and future
gesture-like intent. The goal is not to build a one-off cursor-shake feature.
The goal is a clean subscription layer that lets stack consumers respond to
input signals without owning the input tap or hard-coding app-specific behavior
into the detector.

## Problem

AOS and Sigil already need to react to human input that is richer than one raw
mouse or keyboard event. A rapid pointer waggle is one example. Shortcut keys
are another. Future expression layers may want similar triggers for selection,
annotation, reveal, capture, or workflow control.

If each consumer listens directly to global input, AOS gets competing event
taps, duplicated heuristics, inconsistent permissions, and app-specific signal
logic. The cleaner model is for AOS to own input observation and publish
normalized signals that interested consumers can subscribe to.

## Proposal

Introduce an AOS-owned **Input Signal** concept.

An Input Signal is a normalized, named event derived from raw input or explicit
commands. It is higher-level than a mouse movement or keydown, but lower-level
than a Workflow. Consumers subscribe to signals and decide what those signals
mean in their own context.

Examples:

- `pointer.locate_requested`
- `shortcut.selection_toggle_requested`
- `shortcut.capture_requested`
- `mode.escape_requested`
- `surface.annotation_requested`

The pointer waggle feature should be the first motivating example, not the
whole architecture.

## Execution Model Fit

Input signals fit the AOS Execution Model as supporting control points:

```text
Primitive -> Block -> Recipe -> Workflow -> Run -> Work Record
              ^
              input signal subscriptions may feed gates, modes, recipes,
              workflows, or surface behavior
```

Mapping:

- Primitive: raw normalized input event stream or explicit shortcut command.
- Block: detector or matcher that recognizes a named signal.
- Recipe: bounded smoke or demo that proves a signal can be detected and
  delivered.
- Workflow: orchestration that reacts to signals with gates, modes, evidence,
  or user-facing state changes.
- Run / Work Record: proof for bounded tests, smokes, and workflow-gated
  signal handling.

Signals are not themselves Workflows. They are event/control vocabulary that
Workflows and surfaces may consume.

## Separation Of Responsibilities

AOS owns:

- input observation permission boundary;
- raw input normalization;
- signal naming and publication;
- subscription lifecycle;
- suppression/cooldown policy where needed;
- deterministic fixtures and smokes;
- evidence for bounded verification.

Consumers own:

- interpretation of subscribed signals;
- app or surface-specific modes;
- visual response;
- follow-up actions;
- local state transitions.

Sigil should not own global input detection for this pattern. Sigil should
subscribe to AOS signals and decide how those signals affect Sigil state.

## First Consumer Direction

For the first user-facing behavior, pointer waggle should publish a generic
locate/attention signal. Sigil can later subscribe to that signal and toggle a
new selection mode.

That selection mode is intentionally not specified here. The only requirement
for this proposal is that the signal layer must not bake in Sigil selection
semantics. Other consumers should be able to subscribe to the same signal and
react differently.

## Future Consumers

Potential consumers include:

- Sigil;
- Surface Inspector;
- DesktopWorld visual layers;
- HTML/Markdown expression workbenches;
- annotation modes;
- guided user-signal sessions;
- future workflow or capture surfaces.

Each consumer should be able to subscribe, unsubscribe, and handle signals
without changing the detector.

## Staged Plan

### Stage 1: Concept And Contract

Define the Input Signal vocabulary, ownership boundary, subscription shape, and
relationship to existing AOS gates, signals, shortcuts, and user-signal
sessions.

### Stage 2: Signal Spine

Add the minimal AOS signal publication and subscription path, with deterministic
fixture-driven tests.

### Stage 3: Pointer Waggle Signal

Add a pointer-waggle detector as the first composed input signal. It should emit
a generic signal such as `pointer.locate_requested`, not a Sigil-specific event.

### Stage 4: Generic Visual Smoke

Add a small AOS or toolkit consumer that proves a subscribed signal can trigger
a bounded visual response without depending on Sigil.

### Stage 5: Sigil Subscription

Let Sigil subscribe to the signal and map it to Sigil-owned behavior. The first
target behavior is expected to be a selection-mode toggle, but that mode should
be specified separately.

### Stage 6: Broader Signal Families

Extend the same pattern to shortcut keys and other input-derived signals once
the pointer-waggle path proves the subscription model.

## Non-Goals

- Do not hook into Apple's built-in "Shake mouse pointer to locate" feature.
- Do not make Sigil own a global input tap.
- Do not make pointer waggle a one-off command path.
- Do not define Sigil selection mode in this proposal.
- Do not make signals into Workflows.
- Do not require every signal to emit a Work Record.
- Do not store continuous raw input history by default.

## Open Questions For The Spec Session

- What is the canonical namespace for input signals?
- Should subscriptions be daemon-level, canvas-level, workflow-level, or all
  three with clear ownership?
- How should consumers declare interest in signals?
- Which signals require cooldown, suppression, or exclusive handling?
- How should signal evidence be represented in Work Records for bounded tests?
- How do shortcut-derived signals coexist with current input safety hotkeys?
- What is the lifecycle when a subscribing surface is suspended, removed, or
  restarted?

---
name: agent-human-collab-stage
status: promoted-to-design-note
updated: 2026-05-03
connects_to: AOS primitives, toolkit panels, Sigil, canvas object control, provider sessions, EVOI
promoted_to: docs/design/aos-workbench-pattern.md
---

# Agent-Human Collab Stage

Update: the reusable platform direction from this scratchpad has been promoted
to `docs/design/aos-workbench-pattern.md`. Keep this file as session provenance
and raw idea history; use the design note for future planning.

## Raw Thought

Build an agent-human visual collaboration space, something in the neighborhood
of Gemini canvas mode, but not limited to coding. A coding-specific surface
should exist, but it should sit on top of a more general lower layer: a collab
stage, workbench, or sandbox where humans and agents can share visible state,
point at things, modify artifacts, and carry context across turns.

The deeper question is which lower abstractions give enough leverage to build
many later app-layer experiences without locking agent-os into one product
shape too early. Sigil could be one consumer, but the primitive should not be
Sigil-specific.

## Deeper Connection

The 3D object remote-control protocol was probably a concrete symptom of this
larger need. The immediate ask was to tune position, scale, and rotation of
Sigil wiki-brain objects. The underlying need was broader:

```text
make visual things addressable
make their state observable
make changes explicit and reversible
let humans and agents share control of the same visible workspace
```

That is a collab-stage problem, not only a 3D-transform problem.

## Existing AOS Pieces That Already Point This Way

- `show` creates visible canvases and overlays.
- `see` captures screens, canvases, xray semantics, cursor, and topology.
- `do` acts against native apps and AOS-visible affordances.
- `tell` and `listen` are the communication verbs that can eventually route
  between human, agent, canvas, voice, and other sinks.
- DesktopWorld coordinates provide a shared spatial frame across displays.
- Toolkit panels provide reusable interaction surfaces above the daemon.
- Semantic targets make canvas controls discoverable to agents.
- `canvas_object.registry`, transform patches, and transform results make
  canvas-owned objects addressable and remotely controllable.
- Provider session catalog and telemetry give agent sessions an identity that a
  workspace can show, resume, or annotate.
- Canvas owner metadata and worktree/session-scope notes point toward scoped
  visible work owned by a particular agent run, worktree, or harness.

These are enough to suggest a lower abstraction without inventing a whole
generic "AOS bus" yet.

## Candidate Abstraction Stack

### Level 0: AOS Primitives

The daemon owns OS-facing primitives: display canvases, capture, input,
accessibility actions, event delivery, content serving, readiness, and
permissions. This layer should stay small and stable.

### Level 1: Shared Stage Substrate

The toolkit could grow a provider-neutral stage substrate over primitives:

- stage identity and lifecycle
- participant identity: human, agent session, harness, worktree, app
- spatial frame: DesktopWorld, local canvas coordinates, object-local frames
- addressable object registry
- object selection and focus
- annotations, cursors, pointers, labels, and highlights
- command/result events for transforms and object edits
- timeline or transcript of visible decisions
- snapshot/export/import of declarative stage state

This substrate should not know whether the stage is for coding, design review,
3D tuning, research, or Sigil avatar work.

### Level 2: Reusable Workbench Components

Reusable components can compose the stage substrate:

- object transform panel
- inspector panel
- annotation layer
- comments or chat side rail
- file/code/artifact preview
- visual diff viewer
- session list and resume affordances
- action log and reversible command history
- semantic-target explorer for agents

These should be ordinary toolkit components, not daemon features.

### Level 3: App-Specific Experiences

Apps such as Sigil can build opinionated products on top:

- Sigil avatar composition editor
- Sigil agent terminal plus session side rail
- coding canvas/workbench
- research intake board
- visual diagnostic lab
- 3D object tuning bench

The app decides the product shape; the lower layers provide shared mechanics.

## Important Design Distinction

A collab stage is not only a chat panel next to content. It is shared,
addressable state. The human and the agent should be able to refer to the same
thing by stable identity:

```text
"move this branch"
"compare these two render states"
"resume that session"
"pin this evidence"
"turn the shell opacity down"
"show me what changed"
```

The useful primitive is not the visible panel itself. The useful primitive is
the contract that lets visible things publish identity, state, capabilities,
and accepted mutations.

## Relationship To Canvas Object Control

Canvas object control is the first narrow slice:

- owner canvas publishes addressable objects
- controller sees object identity and transform
- controller sends a patch
- owner applies, rejects, or reports result

Future collab-stage work could generalize from "3D transform of an object" to
"workspace entity with observable state and accepted operations." A transform
is one operation class. Other operation classes might be annotate, select,
focus, compare, approve, reject, edit text, run command, or attach evidence.

Do not jump straight to that generality. Let the specific object-control and
workbench cases teach the right contract.

## Relationship To EVOI

EVOI is adjacent because a collab stage gives the agent a place to externalize
its sense-plan-act loop:

- sense: perceive stage state, semantic targets, annotations, object registry
- plan: propose visible operations or ask projected clarification questions
- act: mutate stage objects or external apps through explicit commands
- review: compare result state, show evidence, record decisions

The stage could become the visual medium where agent reasoning becomes
inspectable without requiring the user to read every internal step.

## Relationship To Provider Sessions

The agent terminal/session catalog work also belongs here. A general collab
stage should be able to show active and historical provider sessions as
participants or artifacts:

- current session
- resumable session
- session telemetry
- session-owned canvases
- open terminals
- worktree or project scope

This is how a coding-specific canvas can be built later without hardcoding
Codex or Claude Code behavior into Sigil's visual layer.

## Guardrails

- Do not turn this scratchpad into a roadmap item by default.
- Do not invent a broad generic AOS event bus yet.
- Do not put product-specific Gemini-canvas behavior into the daemon.
- Do not make Sigil the owner of the general abstraction.
- Start with small toolkit components and explicit schemas where specific
  consumers already exist.
- Keep the permission-bearing runtime boundary stable: the collab stage should
  mostly be content, toolkit code, schemas, and app composition.

## Plausible First Slices

The most practical first slices are already near current work:

1. Strengthen canvas object control from 3D transforms into a reusable
   addressable-object pattern, still narrow and schema-backed.
2. Make the object transform panel a real toolkit component that can target any
   object registry producer.
3. Build a small "stage inspector" that shows participants, canvases,
   addressable objects, semantic targets, and recent commands for one stage.
4. Use Sigil wiki-brain tuning as the first adopter, not as the owner of the
   abstraction.
5. Later, build a coding-specific workbench on top of the same substrate:
   files, diffs, terminal sessions, annotations, review comments, and agent
   proposals.

## Open Naming

Possible names:

- collab stage
- collaboration stage
- shared stage
- workbench substrate
- visual workbench
- agent-human stage
- workspace canvas

Working preference: "collab stage" for scratchpad discussion, but do not
standardize the term until a first concrete component exists.

# AOS TCC Capability Broker Boundary

**Status:** Accepted
**Date:** 2026-06-03

## Decision

`./aos` is the stable TCC capability broker for agent-os. It is not the home of
public command policy.

The Swift binary owns the permissioned process identity, the daemon/socket
substrate, the privileged IPC surface, and the stable primitive surface for
permission-gated native observation, action, and streams. External composition
layers own public command behavior, workflow policy, recovery choices,
user-facing text, command grammar, help metadata, orchestration, and product
behavior.

The native boundary should be policy-free. Swift may expose privileged facts,
privileged actions, and privileged streams. It should not decide how public
commands interpret those primitives unless the interpretation is itself a
required native primitive.

## Context

The command-surface rearchitecture externalized public command behavior through
`manifests/commands/aos-external-commands.json`, command metadata manifests,
scripts, packages, and recipes. The Swift entry point now dispatches public
paths through the external command manifest before falling back to private
`__...` native primitives.

This ADR makes that boundary strict. The long-term aim is not file-size
optimization. The aim is a low-churn permission identity: Swift rebuilds should
be exceptional and auditable after the broker refactor, required only for a new
or changed privileged native primitive, daemon/socket substrate behavior,
macOS framework integration, or TCC permission class.

The unified native identity remains intentional:

- one permissioned broker binary;
- one daemon/socket substrate;
- one shared privileged native substrate;
- one runtime-mode-isolated state and IPC model.

## Broker Principle

If privileged information, action, or continuous data can be exposed through a
stable IPC primitive, policy and composition must live outside the binary.

Examples of broker-owned primitives include:

- privileged facts: TCC grant state, display topology, focused app/window
  facts, cursor state, canvas lifecycle state;
- privileged actions: CGEvent input, AX actions, native window/canvas creation,
  TCC probes and reset operations that require native APIs;
- privileged streams: mouse/input events, focus/window/display changes, canvas
  lifecycle events, future audio and STT events.

Examples of external composition include:

- public command route selection beyond bootstrap dispatch;
- readiness, doctor, status, and permission workflow policy;
- help text, next-action text, recovery narratives, and command presentation;
- orchestration across primitives, recipes, workflows, agents, or apps;
- app-specific behavior and product interpretation.

## Micro-API And Streams

Privileged continuous data should become stable subscription or stream
contracts instead of consumer-specific Swift logic. Mouse/input streams,
focus/window/display changes, canvas lifecycle events, and future audio/STT
events should be exposed as small broker contracts that consumers compose
outside the binary.

The broker should prefer micro-APIs that are durable across consumers. A future
surface needing a high-level behavior is not itself a reason to add that
behavior to Swift; it is a reason to identify the missing privileged fact,
action, or stream and expose that primitive.

## No-Shim Migration

In-repo callers, consumers, docs, manifests, contracts, and tests should be
broken and updated during this refactor. Do not add aliases, compatibility
wrappers, transitional routes, or adapters unless there is a real external
release boundary with an owner, removal gate, and evidence that the external
consumer cannot be updated in the same slice.

Repo-internal migrations should snap to the new canonical route or primitive
directly. Stale in-repo callers should fail loudly enough to force the update.

## Swift Change Gate

Any Swift change touching the broker must justify why the behavior cannot live
in manifests, scripts, packages, recipes, schemas, docs, or another external
composition layer using existing or newly exposed stable primitives.

Accepted reasons include:

- a new or changed privileged native fact, action, or stream;
- daemon/socket substrate behavior;
- macOS framework integration;
- native lifecycle behavior needed to keep the permissioned process identity
  stable;
- a new TCC permission class or native permission probe/reset primitive.

Rejected reasons include:

- public help text or argument grammar;
- recovery policy or next-action wording;
- workflow sequencing across existing primitives;
- app or toolkit product behavior;
- convenience routing that could be expressed in the command manifest or an
  external script.

## Consequences

- `docs/dev/command-surface.md` is the active command-surface contract for what
  remains in Swift versus hot-swappable external layers.
- `ARCHITECTURE.md` should describe `./aos` as the unified broker and native
  primitive substrate, not as owner of public command behavior.
- `src/AGENTS.md`, docs owners, and command/workflow owners should require a
  native boundary justification before routing Swift work.
- Follow-on refactors should inventory remaining Swift public/runtime policy,
  expose smaller private broker primitives where needed, and move public
  behavior to external composition without repo-internal shims.

## Non-Goals

- This is not a file-size optimization.
- This is not a move away from a unified daemon/socket/TCC identity.
- This does not remove the Swift privileged native substrate.
- This does not require externalizing behavior that is truly a privileged
  native primitive.

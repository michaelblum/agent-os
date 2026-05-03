# Permission-Bearing Runtime Boundary

Status: Concept, not scheduled.

This note captures an architectural guardrail. It is not a roadmap item and
must not be promoted into implementation work unless the user explicitly asks
for that promotion or a concrete issue exposes repeated runtime-boundary pain.

## Problem

macOS Accessibility, Input Monitoring, and related privacy grants attach to the
process identity that requests protected access. In agent-os repo mode, that
identity is the `aos` daemon binary. Rebuilding the active daemon binary, changing
its signing identity, or pointing launchd at a different `aos` path can make
macOS treat the runtime as a new or stale permission subject.

That makes daemon churn expensive. Work that can be expressed above the daemon
should not require changing the permission-bearing binary.

## Principle

Keep the permission-bearing core small, stable, primitive-oriented, and
slow-changing. The daemon should expose durable primitives and contracts; apps,
toolkit components, provider integrations, visuals, policies, and workflows
should compose those primitives outside the privileged binary whenever possible.

The stable core owns protected or host-level capabilities such as:

- screen, cursor, window, and accessibility perception
- accessibility actions and input-event injection
- canvas window lifecycle
- content serving
- IPC, routing, and pub/sub
- readiness, service, and permission diagnostics

Consumers above that layer should own interpretation and product behavior.
Sigil visuals, toolkit panels, provider session logic, and visual harnesses
should remain content, JavaScript, schemas, or package code unless they require a
new primitive.

## Current Fit

agent-os already partly follows this boundary. Sigil and toolkit surfaces are
served as content by the stable daemon, shared contracts live in schemas and
docs, and recent addressable-object work followed the right layering:

- primitive contract first
- reusable toolkit surface second
- Sigil adopter third

The remaining risk is operational. Visual or app debugging can still drift into
runtime work when a local branch contains both app changes and Swift daemon
changes, or when a worktree smoke test tempts an agent to build or run a second
`aos` binary.

## Operational Rule

Before rebuilding `aos`, classify the task:

- Content-only: JavaScript, HTML, CSS, assets, docs, schemas, package tests, and
  app/toolkit behavior. Do not rebuild the daemon.
- Runtime-core: Swift sources under `src/` or shared Swift IPC code that affect
  daemon behavior. Rebuild only when the verification path actually executes the
  changed binary.

If a content-only task appears to require a daemon rebuild, pause and identify
which missing primitive is forcing the boundary crossing.

## Guardrail

Do not design native daemon plugins, dynamically loaded privileged modules, or a
broader runtime modularity system from this note alone. Those designs carry
signing, stability, crash-isolation, and trust-boundary costs. They should be
considered only after a specific primitive-boundary issue demonstrates that the
current stable-core plus content/toolkit model is insufficient.

## Promotion Criteria

Create implementation issues only when there is concrete evidence, such as:

- repeated app work requiring Swift daemon changes for the same missing
  primitive
- repeated macOS permission churn caused by active-runtime rebuilds
- a narrow extension point that can be specified as a stable primitive contract
  without turning the daemon into a plugin host

Until then, this note should be used as design context and a review heuristic,
not as next work.

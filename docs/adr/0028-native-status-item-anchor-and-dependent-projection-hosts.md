# ADR 0028: Native Status-Item Anchor And Dependent Projection Hosts

Status: Accepted
Date: 2026-07-19

## Context

ADR 0015 keeps privileged AppKit facts and lifecycle in the native broker. ADRs
0024 and 0026 assign shared desktop projection and data-only cartridges to the
DesktopWorld engine. They do not decide how a consumer visual occupies a real
macOS status-item slot or how rich controls open from that slot.

A consumer icon path would make the native host both an asset loader and a
second visual engine. A status-bar-level overlay window would also depend on
unproven ordering across displays, Spaces, auto-hide, and notches.

## Decision

The owner-scoped v1 host owns one `NSStatusItem`, its accessibility identity,
primary/secondary activation, optional simple declarative `NSMenu`, exact
native anchor/display facts, observed anchor lifecycle, and a neutral
monochrome fallback visual. The descriptor supplies no icon path, renderer, or
anchor. Registration-follow owns lease lifetime and events. Exact
owner/item/generation/current-revision compare-and-swap updates may install a
strictly newer descriptor without transferring ownership. Lease disconnect
removes the native item.

The fallback reserves the native slot and remains visible when no consumer
projection exists. It is not the consumer's final visual.

Two dependent slices remain separate:

1. A generic AOS-owned projection view inside the actual status-item button or
   layer consumes a bounded data-only status-visual descriptor. DesktopWorld
   consumes the same definition plus the observed native anchor only for
   emergence, docking, and effects outside the menu bar.
2. An AOS-owned rich status palette/popover provides bounded positioning,
   dismissal, focus, keyboard/AX behavior, and StageAffordance hit routing for
   controls that do not fit a simple native menu.

A click-through status-bar overlay is not an accepted primary host. It requires
separate native proof of ordering and lifecycle behavior before reconsideration.

## Consequences

Ordinary descriptor and menu revision changes use the public compare-and-swap
update and require no AOS rebuild. New renderer implementations still require
AOS review. V1 can truthfully expose native
identity, actions, bounds, display topology, and fallback continuity without
claiming cartridge projection or rich palette behavior that is not yet built.

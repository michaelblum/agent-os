# Sigil Experience Boundary V0

Sigil is an optional active experience layer over AOS, not a normal app. AOS is
the application, command/control plane, schema family, and developer contract;
Sigil is the default first-party experience built on that engine.

Only one experience should be active at a time. With no active experience, AOS
still owns a vanilla menu/status item with core access points such as avatar
terminal, graph wiki, and inspectors. When Sigil is active, it may configure the
status-item menu, tool launch behavior, forward-facing labels, surface titles,
icons, and theme tokens while leaving internal AOS namespaces unchanged.

Sigil launch is status-item-first: activation makes the menu/status icon
available, and the user docks or undocks the avatar through that icon. The
avatar is the Sigil entry point after activation.

Current Studio remains decommissioned under `apps/sigil/_sequestered/studio/`.
The current multi-tab workbench remains legacy/dev-only as
`aos launch sigil legacy-workbench`. The current context menu remains source
material under `apps/sigil/context-menu/` for later theme extraction and a
toolkit/Zag radial rebuild; it was not deleted or rebuilt in this correction.

Toolkit surfaces already support app theme overrides through CSS custom
properties after importing `packages/toolkit/components/_base/theme.css`, but
there is not yet a first-class per-experience theme registry. A reusable Sigil
theme should be distilled from the old context menu visuals and made available
per app/per surface in a later toolkit slice.

Future Sigil workbench, Settings, graph wiki brain, radial, avatar, and editor
surfaces should be toolkit-composable surfaces that Sigil themes and wires
together. The MVP Settings surface can remain plain markdown, JSON, HTML, or a
simple toolkit settings board/editor over actual Sigil/AOS settings; a bespoke
Sigil settings view is post-MVP.

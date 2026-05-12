# Host-neutral surfaces use capability-bounded hosts

Status: Accepted clarification

## Context

ADR 0005 says Subjects are host-neutral and Facets declare their Hosts. ADR 0008
says a Subject Browser is a class of surfaces, not the wiki renamed. Together
they imply that AOS surfaces are not inherently canvas-only.

That implication is easy to misread in both directions. One mistake is treating
every AOS surface as a WKWebView canvas because the daemon currently projects
most runtime surfaces that way. The opposite mistake is treating a normal
browser page as equivalent to an AOS canvas even when the surface needs
DesktopWorld placement, daemon lifecycle, input regions, or OS-level diagnostic
authority.

## Decision

AOS surface Facets should be host-neutral where practical. Browser-hosted
Facets are first-class for document, artifact, wiki, planning, replay, report,
and ordinary workbench UI. AOS canvas-hosted Facets are required when a surface
depends on daemon or runtime privileges.

Host support belongs on the Facet, not the Subject. A Subject keeps one durable
identity; each Facet declares which hosts it supports and what capability level
each host provides.

## Capability Boundary

A Browser Host is appropriate when the Facet primarily needs ordinary web UI,
document rendering, editing, navigation, preview, or Playwright-addressable
inspection.

A Canvas Host is required when the Facet needs AOS-native capabilities such as:

- DesktopWorld stage placement or display-spanning visuals;
- daemon-owned canvas lifecycle, suspend, resume, cascade, or parentage;
- input regions, global hit routing, or native event identity;
- Surface Inspector, readiness, permissions, or runtime diagnostics;
- privileged OS interaction that a browser page should not own.

Browser-hosted and canvas-hosted implementations may share model, rendering, and
state code, but their host adapters are not interchangeable.

## Architecture Guidance

When adding a surface, prefer this split:

- host-neutral Subject and Facet identity;
- host-neutral model/state and reusable render core where practical;
- a Browser Host adapter for normal browser preview, editor, reader, or
  workbench use;
- a Canvas Host adapter for AOS bridge, daemon subscriptions, lifecycle, input
  regions, DesktopWorld, and runtime diagnostics;
- a capability declaration that makes unsupported or preview-only host modes
  explicit.

If a canvas-hosted implementation is chosen only because the toolkit currently
leans WKWebView, that is a design smell. If a browser-hosted implementation is
chosen for a surface that needs native runtime privileges, that is also a design
smell.

## Non-Goals

This ADR does not require migrating active surfaces. It does not replace
DesktopWorld, toolkit panel/windowing, Surface Inspector, or daemon input
regions with browser pages. It also does not make browser hosting a debug-only
path.

The next implementation slice should continue to follow the active surface
system roadmap. This clarification should influence future surface design and
refactors when a host boundary is already being touched.

## Consequences

Surface design reviews should ask which host capabilities a Facet requires
before creating private UI, persistence, or runtime plumbing.

Toolkit and app code should increasingly isolate reusable model/render logic
from AOS-native host adapters so Browser Host support is possible where it is
actually useful.

Docs that say "WKWebView component" should be read as "current AOS canvas host"
unless the surface explicitly requires AOS-native capabilities. Future docs
should prefer "surface Facet", "Browser Host", and "Canvas Host" when the host
boundary matters.

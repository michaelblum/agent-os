@../../AGENTS.md

# Toolkit Boundary

`packages/toolkit/` is the reusable AOS surface layer between daemon primitives
and external product consumers. It is where the default opt-in AOS windowing
system belongs.

The toolkit is a package boundary inside `agent-os`, not an independently
versioned repository. It ships against the same reviewed AOS revision as the
daemon, CLI, schemas, and command manifests. Consumers must use explicit public
exports from that revision rather than copy toolkit source into product repos.

Layer intent:

- `runtime/`: universal in-canvas bridge over daemon primitives.
- `contracts/`: neutral toolkit contracts shared by activation scripts and
  runtime helpers without making activation depend on runtime policy.
- `controls/`: reusable semantic app-control behavior for WKWebView surfaces.
- `panel/`: reusable panel/window policy: chrome, drag/drop-capable movement,
  resize, close, minimize, maximize, restore, placement, and surface-manager
  affordances.
- `workbench/`: subject descriptors and reusable workbench contracts.
- `components/`: reusable content units and stock surfaces built from the lower
  layers.
- `scene/`: narrow external package facade over reviewed Three lifecycle,
  DesktopWorld, canvas lifecycle, and visual-object contracts.

Toolkit policy must stay generic. If a behavior only makes sense for a
specific external product, it belongs in that product repository. If toolkit
code needs native help for performance or correctness, add or request a daemon
primitive instead of inventing private app canvases or pushing toolkit policy
into Swift.

The shared DesktopWorld stage is toolkit policy running on a daemon
DesktopWorld canvas primitive. Its compatible 2D and 3D outlets are the default
host for ordinary desktop-wide visuals such as chips, drag ghosts, telemetry,
avatar/radial visuals, and temporary affordances. The scene package now owns
working dependency-injected local and DesktopWorld host policy. The
daemon-backed singleton transport is exposed only through owner/resource-scoped
`scene-follow` leases. Pair visual objects with
explicit interaction surfaces or input regions; do not make the full visual
stage interactive by default. ADR 0024 owns the 3D outlet boundary.

DesktopWorld DevTools are AOS-owned toolkit views over a daemon-owned session.
Consumers may host the public inspector view, but one revisioned AOS host lease
owns interaction and the stage remains the sole telemetry sampler. ADRs 0026
and 0027 own the cartridge, engine, DevTools, and host-transfer boundaries. The
scene package's agent client remains transport-injected; socket discovery,
daemon startup, and public CLI process lifecycle stay outside the toolkit.

Legacy cross-display transfer outlines are superseded by One-World/union-backed
surfaces. Do not grow that path. The AOS Surface System epic should replace
panel-private movement with first-class toolkit drag/drop, migrate draggable
panel-shaped surfaces onto it, and remove the transfer-outline code/tests/docs.

Before adding WebViews, stage layers, hit regions, or daemon work for a surface,
use `docs/guides/aos-surface-interaction-decision-tree.md`. Keep local guidance
as a pointer to that canonical tree instead of copying the full policy here.

Consumer-facing toolkit contracts are indexed at `docs/api/toolkit.md`. Prefer
the scoped API file for the layer you are changing:
`docs/api/toolkit/runtime.md`, `docs/api/toolkit/panel-window.md`,
`docs/api/toolkit/workbench.md`, `docs/api/toolkit/scene.md`,
`docs/api/toolkit/components.md`, or
`docs/api/toolkit/content-host.md`.

For `workbench/` Work Record filesystem paths, preserve raw path strings in
stored identities, readback fields, and argv-backed recommendations. Use
whitespace-normalizing helpers only for semantic fields such as ids, statuses,
schema versions, and display text.

For `workbench/` Work Record APIs, keep `work-record.js` as the stable public
facade and keep private projections, planners, and test conveniences out of
that export surface. Internal capture modules own command evidence, AOS action
phases, step-descriptor promotion, shared helpers, and builder versions;
recovery helpers may be shared by direct internal imports, but not through the
public facade for testing convenience.

## Child DOX Index

- `controls/AGENTS.md` governs reusable semantic app-control behavior.
- `panel/AGENTS.md` governs reusable panel/windowing policy.
- `runtime/AGENTS.md` governs the generic in-canvas bridge to daemon
  primitives.
- `scene/AGENTS.md` governs the narrow external scene-authoring package facade.
- `contracts/`, `components/`, `workbench/`, `adapters/`, `markdown/`, and
  `shell/` do not have child `AGENTS.md` files yet; follow this toolkit contract
  plus scoped API docs when editing them.

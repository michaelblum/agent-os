# Fresh Session Handoff: AOS Taxonomy To Readiness Preflight

This is a local handoff note for the next Codex session in
`/Users/Michael/Code/agent-os` on branch `codex/sigil-aos-surfaces`.

The current date of this handoff is 2026-05-01.

## Current State

The taxonomy/instruction-surface cleanup has moved from exploration into
durable repo artifacts. EVOI is now classified, and the next real optimization
thread is deterministic readiness/capability preflight so agents do not waste
turns repeatedly running `./aos ready`.

Recent checkpoints on the branch:

- `d659f1b` `Clarify AOS instruction surface taxonomy`
- `8ea7e06` `Mark legacy Superpowers design archive`
- `dec4a27` `Document test harness folder roles`
- `760f1a6` `Classify EVOI placement`
- `1605748` `Add value-of-information clarification recipe`
- `eff8558` `Describe lazy readiness preflight`
- `80c8826` `Link readiness preflight tracker`

Important GitHub comments/issues:

- #134 closeout-style progress:
  https://github.com/michaelblum/agent-os/issues/134#issuecomment-4357606931
- #162 test harness folder roles:
  https://github.com/michaelblum/agent-os/issues/162#issuecomment-4357625759
- #158 EVOI placement note:
  https://github.com/michaelblum/agent-os/issues/158#issuecomment-4357640336
- #158 value-of-information recipe note:
  https://github.com/michaelblum/agent-os/issues/158#issuecomment-4357650345
- #177 tracker:
  https://github.com/michaelblum/agent-os/issues/177

## Durable Artifacts To Read

Read these first in the next session:

1. `AGENTS.md`
2. `docs/api/aos-taxonomy.md`
3. `docs/recipes/value-of-information-clarification.md`
4. `docs/design/notes/2026-05-01-evoi-placement-decision.md`
5. `docs/design/notes/2026-05-01-capability-preflight-readiness-lease.md`
6. `shared/schemas/CONTRACT-GOVERNANCE.md`
7. `src/commands/operator.swift` around `ensureInteractivePreflight`
8. `src/main.swift` around `handleSee` / `handleDo`
9. `src/shared/command-registry-data.swift` around the `ready` command
10. `docs/reference/aos-dev-workflow-rules.json`

Use GitHub issue #177 as the coordination tracker for the readiness lease work.

## Dirty Worktree Boundary

At handoff time, the worktree still had unrelated dirty work:

```text
D/M Sigil display/model/runtime work:
  apps/sigil/renderer/assets/models/wiki-brain/*
  apps/sigil/renderer/assets/models/human-brain/
  apps/sigil/renderer/live-modules/radial-gesture-visuals.js
  apps/sigil/renderer/radial-menu-defaults.js

pre-existing API doc change:
  docs/api/aos.md

display/capture runtime work:
  src/display/canvas.swift
  src/display/desktop-world-surface.swift
  src/display/protocol.swift
  src/perceive/capture-pipeline.swift

test implementation work:
  tests/capture-canvas-surface.sh
  tests/renderer/radial-gesture-menu.test.mjs

scratchpad files:
  memory/scratchpad/EVOI_Project/
```

Do not reset, clean, move, stage, or edit unrelated dirty files unless the user
explicitly asks. Start the next session with `git status --short`.

## Key Design Point

The user clarified the core principle:

> Speed and determinism are critical. Agents should be the semantic glue that
> binds process and deterministic work.

Readiness should therefore not be an agent ritual. It should be a deterministic
platform contract:

```text
agent chooses semantic capability
AOS performs deterministic preflight only when needed
AOS either runs the capability or returns a concrete blocker
```

The design note calls this a lazy readiness gate or capability preflight.

## Recommended Next Step

Write an implementation-ready design spec under `docs/design/specs/`, probably:

```text
docs/design/specs/2026-05-01-capability-preflight-readiness-lease.md
```

The spec should not implement behavior yet. It should turn issue #177 and the
design note into an implementable contract.

Cover:

- capability class enum and names
- where the readiness lease lives
- invalidation events
- command registry metadata shape for required capabilities
- JSON blocker/error shape for failed preflight without repair
- how this interacts with existing `ensureInteractivePreflight`
- how `aos dev recommend` should avoid redundant ready-check recommendations
- test plan using `tests/lib/mock-daemon.py`

Do not run `./aos ready` just to write this spec; this is docs/design work and
does not depend on live AOS runtime state.

## Constraints

- Do not implement EVOI.
- Do not inspect earlier mouse-target pixels.
- Do not touch unrelated Sigil/display/model dirty work.
- Do not treat `CLAUDE.md` files as doctrine; they are compatibility pointers.
- Preserve AOS vocabulary: `see`, `do`, `show`, `tell`, `listen`,
  `target.probe`, command surface, docs recipe, ops recipe, runtime wiki
  knowledge.
- Keep repair explicit. Do not hide `./aos ready --repair` behind ordinary
  commands.
- Do not let CLI fallbacks fabricate daemon-owned readiness; follow
  `shared/schemas/CONTRACT-GOVERNANCE.md`.

## Lead-In Prompt For Next Session

```text
We are in /Users/Michael/Code/agent-os on branch codex/sigil-aos-surfaces.
Continue the AOS readiness/capability preflight design work from issue #177.

Start by reading:
- AGENTS.md
- memory/scratchpad/EVOI_Project/2026-05-01-readiness-preflight-session-handoff.md
- docs/design/notes/2026-05-01-capability-preflight-readiness-lease.md
- docs/recipes/value-of-information-clarification.md
- shared/schemas/CONTRACT-GOVERNANCE.md
- src/commands/operator.swift around ensureInteractivePreflight
- src/main.swift around handleSee / handleDo
- docs/reference/aos-dev-workflow-rules.json
- git status --short

Goal:
- Write an implementation-ready design spec under docs/design/specs/ for
  capability preflight and readiness leases.
- Do not implement behavior yet unless I explicitly ask.
- Do not run ./aos ready just for docs/spec work.
- Do not touch unrelated dirty Sigil/display/model work or pre-existing
  docs/api/aos.md changes.

Design stance:
- Agents should choose semantic capabilities.
- AOS should run deterministic preflights only when needed.
- Repeated live commands should reuse valid capability leases.
- Failed preflights should return concrete blockers.
- Repair and macOS permission handoffs stay explicit.
```

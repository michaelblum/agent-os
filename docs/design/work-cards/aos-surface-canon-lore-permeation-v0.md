# AOS Surface Canon Lore Permeation V0

## Tracker

- Epic: #223 AOS Surface System
- Issue: #302 AOS surface canon lore must be consistent across layers
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`

## Goal

Make the AOS surface/windowing philosophy hard to miss across repo guidance so
future agents default to the correct boundary:

- daemon/kernel owns native primitives and generic contracts;
- toolkit owns the default opt-in surface/windowing system;
- apps own product expression and should not fork platform capabilities.

Foreman has started this as a docs draft. Implementer should review, tighten, and finish
the propagation without turning it into implementation work.

## Files To Inspect

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`

## Required Work

1. Confirm the new boundary language is consistent across all listed docs.
2. Add any missing local AGENTS guidance for nearby subtrees if the absence
   would let future agents infer the wrong layer boundary.
3. Remove or revise wording that still implies:
   - daemon owns default window manager policy;
   - toolkit is only visual components and not the default optional surface
     system;
   - Sigil private full-display surfaces are the normal platform path;
   - one-WebView-per-small-affordance is the preferred architecture.
4. Keep provider-specific `CLAUDE.md` files thin or clearly pointed at
   provider-neutral `AGENTS.md`.
5. Update `docs/design/aos-canon-surface-boundary-alignment-plan.md` if the audit
   discovers additional contradictions.

## Acceptance Criteria

- A future agent reading root, daemon, toolkit, runtime, controls, panel, and
  Sigil docs can state the same daemon/toolkit/app boundary.
- The DesktopWorld stage wording distinguishes native surface ownership from
  toolkit stage layer ownership.
- The docs explicitly call current Sigil/daemon product-specific paths
  transitional debt rather than patterns to copy.
- No implementation code changes are made in this slice except comments needed
  to prevent immediate misunderstanding.

## Verification

Run:

```bash
git diff --check
```

Also run an `rg` scan for the old contradictory phrases called out in this work
card. It may return intentional updated language, but it must not return old
unqualified claims without an adjacent explanation.

## Completion Report

Include:

- docs changed;
- contradictions resolved;
- contradictions still open;
- exact verification commands and results.

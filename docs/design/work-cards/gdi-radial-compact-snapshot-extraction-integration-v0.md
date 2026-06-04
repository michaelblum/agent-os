# GDI Work Card: Integrate Compact Scroll Fix With Snapshot Extraction

## Recipient

GDI

## Transfer Kind

Correction round

## Single Goal

Resolve the narrow `apps/sigil/context-menu/menu.js` overlap between the accepted radial/compact real-input branch and PR #397's context-menu snapshot extraction while preserving both behaviors and targeted test evidence.

## Branch / Base

- `branch_from`: `origin/gdi/radial-compact-real-input-primitives-v0`
- `required_start_ref`: `origin/gdi/radial-compact-real-input-primitives-v0`
- Related branch to integrate: `origin/gdi/sigil-context-menu-record-snapshot-extraction-v0`
- Common base: `origin/gdi/post-refactor-real-input-dogfooding-corrections-v0` at `2bd233845f3575c1d38bd12f3f84a080ca9f79b1`

Do not restart from `origin/main`.

## Source Context

Foreman accepted the GDI completion report for:

- branch: `gdi/radial-compact-real-input-primitives-v0`
- head: `5ce418481548e310f2e0bc3ab6c9361fccba0985`
- base: `2bd233845f3575c1d38bd12f3f84a080ca9f79b1`

The accepted branch fixes:

- hardcoded radial drag geometry by deriving drag thresholds from resolved radial config;
- reusable Sigil/AOS real-input primitives;
- compact panel scroll snap-back by reusing/preserving the mounted compact surface during equivalent open snapshot replay.

PR #397 is still open:

- PR: <https://github.com/michaelblum/agent-os/pull/397>
- title: `refactor(sigil): extract context menu snapshot projection`
- head: `origin/gdi/sigil-context-menu-record-snapshot-extraction-v0`
- head sha: `9160d44d89c0203ae820053eff405acbf91b3c51`
- base: `gdi/post-refactor-real-input-dogfooding-corrections-v0`

Foreman ran:

```bash
git merge-tree $(git merge-base HEAD origin/gdi/sigil-context-menu-record-snapshot-extraction-v0) HEAD origin/gdi/sigil-context-menu-record-snapshot-extraction-v0
```

The merge-tree reported a real but narrow conflict in `apps/sigil/context-menu/menu.js`. PR #397 extracts:

- `apps/sigil/context-menu/snapshot-projection.js`
- `tests/renderer/context-menu-snapshot-projection.test.mjs`

The accepted radial/compact branch changes nearby `snapshot()`, `syncSnapshot()`, `mountCompactSurface()`, and `applySnapshot()` behavior.

## Read First

- `docs/design/work-cards/gdi-radial-compact-real-input-primitives-v0.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/snapshot-projection.js` from `origin/gdi/sigil-context-menu-record-snapshot-extraction-v0`
- `tests/renderer/context-menu-snapshot-projection.test.mjs` from `origin/gdi/sigil-context-menu-record-snapshot-extraction-v0`
- `tests/sigil-context-menu-real-input.sh`
- `tests/sigil-avatar-interactions.sh`
- `tests/lib/sigil_real_input_context.py`

## Rediscovery Commands

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/radial-compact-real-input-primitives-v0 origin/gdi/sigil-context-menu-record-snapshot-extraction-v0
git merge-base HEAD origin/gdi/sigil-context-menu-record-snapshot-extraction-v0
git merge-tree $(git merge-base HEAD origin/gdi/sigil-context-menu-record-snapshot-extraction-v0) HEAD origin/gdi/sigil-context-menu-record-snapshot-extraction-v0
```

## Required Behavior

- Keep PR #397's extracted `buildContextMenuSnapshot(menuState, compactSurface)` helper and its test coverage.
- Keep the radial/compact branch's scroll fix:
  - preserve `scrollTop` / `scrollLeft` across remaining compact-surface remounts;
  - avoid remounting an already-mounted compact surface for equivalent open snapshot replay;
  - preserve active-tab replay via `compactSurface.setActiveTab(...)`.
- Preserve the accepted radial drag primitive behavior and the `p.x + 48` removal.
- Keep `liveJs.contextMenu` snapshot shape stable: `open`, cloned `bounds`, `stack`, `activeTab`, and `controls`.
- Do not weaken the delayed compact scroll assertion. It must still require the panel to remain scrolled after a delay.
- Do not introduce raw daemon/tmux/curl diagnostics. Use `./aos` commands for runtime checks.

## Suggested Implementation Shape

Use the branch-local conflict resolution rather than a broad refactor:

1. Start from `origin/gdi/radial-compact-real-input-primitives-v0`.
2. Bring in the snapshot extraction branch, preferably by merge or cherry-pick, and resolve only the context-menu conflict.
3. In `menu.js`, let `snapshot()` delegate to `buildContextMenuSnapshot(menuState, compactSurface)`.
4. Keep the scroll-preserving `mountCompactSurface()` and no-remount `applySnapshot()` behavior from `gdi/radial-compact-real-input-primitives-v0`.
5. Ensure `syncSnapshot()` still computes `controlCount` without changing the externally projected snapshot shape.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --check apps/sigil/context-menu/snapshot-projection.js
node --test tests/renderer/context-menu-snapshot-projection.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-context-menu-real-input.sh
```

If `./aos ready` passes and live input is safe in the session, also run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/sigil-context-menu-real-input.sh
```

## Completion Report

Include:

- branch name and head SHA;
- exact start ref and integrated PR #397 head SHA;
- changed paths;
- conflict resolution summary for `apps/sigil/context-menu/menu.js`;
- proof that `snapshot()` now uses `buildContextMenuSnapshot`;
- proof that scroll persistence still reports before/immediate/delayed values with delayed `scrollTop` not lower than immediate;
- verification commands and pass/fail results;
- whether a PR should be opened/updated or whether PR #397 should remain separate.

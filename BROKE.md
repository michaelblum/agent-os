# Breaking Changes from Visual Object Descriptor Refactor (PR #392)

Inventory taken on 2026-06-01 from `main` at `/Users/Michael/Code/agent-os`.
Refreshed after PR #394 from `main` merge `7c93b35ca4eb7c4c69f6439b7d4b6eb490b39425`.

## Current Test Inventory

### Passing

- `node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs` - 64/64 pass.
- `node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs` - 66/66 pass.
- `node --test tests/toolkit/*.test.mjs` - 1109/1109 pass.
- `node --test tests/schemas/*.test.mjs` - 125/125 pass.
- `cd packages/gateway && npm test` - 99/99 pass.
- `cd packages/host && npm test` - 63/63 pass.
- `node --test tests/daemon/*.test.mjs` - 40/40 pass after PR #394.

### Current Failures

- `node --test tests/*.test.mjs` - 147/148 pass, 1 fail after PR #394 when rerun from a clean temporary worktree.
- `node --test tests/sigil-agent-terminal-server.test.mjs` - 18/19 pass, 1 fail when rerun directly.

### Local Dirty-State Artifacts

- `node --test tests/*.test.mjs` reported 141/148 pass, 7 fail when run from Foreman's dirty local checkout with `.codex/config.toml` modified.
- `node --test tests/afk-session-trigger-prototype.test.mjs` reported 55/61 pass, 6 fail in that dirty checkout. A clean temporary worktree at `70d7e940` reran the AFK file as 61/61 pass, so those six AFK live-launch failures are classified as local dirty-state artifacts, not current code breakage.

### Resolved Renderer Inventory

- `node --test tests/renderer/*.test.mjs` - 449/455 pass, 6 fail before `gdi/pr392-renderer-breakage-correction-v0`.
- `gdi/pr392-renderer-breakage-correction-v0` at `c61ea4c02472283193bb44eb4d3854aa47dba343` fixes the renderer inventory.
- `node --test tests/renderer/interaction-overlay-lineage-layer.test.mjs` - 1/1 pass.
- `node --test tests/renderer/radial-gesture-menu.test.mjs` - 18/18 pass.
- `node --test tests/renderer/sigil-selection-mode-runtime.test.mjs` - 37/37 pass.
- `node --test tests/renderer/sigil-ux-tree-readiness.test.mjs` - 7/7 pass.
- `node --test tests/renderer/*.test.mjs` - 455/455 pass.

### Daemon Timing Inventory

- `node --test tests/daemon/*.test.mjs` previously reported 39/40 pass, 1 fail during concurrent broad-suite inventory.
- `node --test tests/daemon/gate-continuations.test.mjs` - 14/14 pass when rerun serially during renderer correction.
- `node --test tests/daemon/*.test.mjs` - 40/40 pass after PR #394; the earlier daemon timing failure remains classified as load-sensitive timing noise because it did not reproduce serially or in the refreshed daemon suite.

## Known Breakages

### High Priority - Agent Terminal Launcher Contract

- [ ] `tests/sigil-agent-terminal-server.test.mjs` fails `Sigil Agent Terminal bridge > passes stable repo root to bridge server startup paths`. First assertion/error: wrapper content did not match `/\"AGENT_TERMINAL_REPO_ROOT=\" \\+ shlex\\.quote\\(repo_root\\)/`; the current compatibility wrapper exports `AGENT_COMMAND`/`RESTART`, computes `REPO_ROOT`, and execs `"$REPO_ROOT/aos" launch sigil agent-terminal "${ARGS[@]}"` without the expected `AGENT_TERMINAL_REPO_ROOT` startup environment evidence.

### Resolved High Priority

- [x] `tests/renderer/interaction-overlay-lineage-layer.test.mjs` crashed while importing Sigil renderer modules because `apps/sigil/renderer/live-modules/radial-gesture-visuals.js` evaluated `new THREE.Color('#ffffff')` at module scope while `THREE` was not defined in the deterministic test environment.

### Resolved Medium Priority

- [x] `tests/renderer/radial-gesture-menu.test.mjs` had three radial/fast-travel boundary assertion failures: hover outside handoff radius reported `enteredFastTravel: true` where tests expect radial state to remain active.
- [x] `tests/renderer/sigil-selection-mode-runtime.test.mjs` failed `Selection Mode lineage bar pins to the active display visible bounds`; the right edge was no longer clamped within the expected visible display bound.
- [x] `tests/renderer/sigil-ux-tree-readiness.test.mjs` failed the positive readiness audit with `audit.ok === false`.

### Resolved Low Priority / Possibly Environmental

- [x] `tests/daemon/gate-continuations.test.mjs` failed the "defer returns immediately" timing assertion during concurrent inventory: `Date.now() - started < 1000`. Observed duration was about 1045 ms while broader suites were running concurrently. Serial rerun passes in about 432 ms for the timed subtest.

## Next Inventory Candidate

The next smallest correction slice should target `tests/sigil-agent-terminal-server.test.mjs`, specifically the stable repo-root wrapper startup contract.

## Migration Pattern

Old:

```js
updateStellation(value) {
  mesh.geometry = createStellatedGeometry(base, value);
}
```

New:

```js
const descriptor = {
  id: 'stellation',
  state_path: 'avatar.shape.stellation',
  route: 'canvas_object.transform.patch',
  coerce: 'number',
  renderer_sync: ['updatePrimaryStellation'],
};

applyVisualObjectDescriptorMutation(state, descriptor, value);
```

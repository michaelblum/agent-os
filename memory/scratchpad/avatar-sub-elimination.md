---
name: avatar-sub elimination — complete
status: shipped
connects_to: Sigil avatar system (apps/sigil/), AOS daemon (src/daemon/)
updated: 2026-04-13
---

## Resolved 2026-04-13

The Swift `avatar-sub` source tree, launchd service, and `?mode=live-js` gate
were retired in session `sigil-2-tail-cleanup` per GH #46. The cleanup
absorbed #34 (legacy `avatar-config.json` reads — that path no longer exists).

The live runtime is the JS state machine (Sigil-1, shipped 2026-04-12, handoff
`01KP07Q83VRK3WWP38D9NXV43E`):

```bash
./aos show create --id avatar-main \
  --url 'aos://sigil/renderer/index.html' \
  --at 0,0,1512,982
```

- Canvas id: `avatar-main`
- Runtime: `apps/sigil/renderer/index.html` (no query flag — the gate is gone)
- State machine, cursor tracking, docking, multi-display handoff: all JS
- Position driven by daemon event streams via content server + `headsup.receive()`

## What was removed

- `apps/sigil/avatar-{animate,behaviors,easing,ipc,spatial,sub}.swift`
- `apps/sigil/build/` + `apps/sigil/build-avatar.sh` + `apps/sigil/clean.sh`
- `apps/sigil/sigilctl` (kept `sigilctl-seed.sh` — the wiki seed wrapper)
- `src/display/status-item.swift` — the menu-bar toggle that spawned the Swift
  binary. Config keys `status_item.*` dropped from `src/shared/config.swift`
  and `src/CLAUDE.md`.
- `sigil_service` field from `aos doctor --json`
- `aosSigilServiceLabel` / `aosSigilLogPath` / `aosSigilPlistPath` /
  `aosInstalledSigilWorkDir` and the `avatar-sub` special case in
  `aosExpectedBinaryPath` (`shared/swift/ipc/runtime-paths.swift`)
- `CanvasManager.setCanvasAlpha` (only caller was StatusItemManager)
- `?mode=live-js` gate and `setupIPC` / `handleMessage` / `applyConfig` /
  `applyBehaviorPreset` / `_waitForEffectsSettled` in
  `apps/sigil/renderer/index.html`
- `avatar-sub` references in packaging: `package.sh`, `scripts/package-aos-runtime`,
  `scripts/install-aos-runtime`, `scripts/clean-build-artifacts`, `.gitignore`

## What remains as deliberate historical references

- `shared/swift/ipc/runtime-paths.swift` — legacy-labels comment explains why
  `com.agent-os.sigil.*` stays in `aosLegacyServiceLabels` (so `aos reset`
  still unloads stale launch agents after the retirement).
- `apps/sigil/CLAUDE.md` — one-line note documenting the 2026-04-13 retirement
  for future readers.
- `docs/superpowers/{plans,specs}/**` — historical context; unchanged.

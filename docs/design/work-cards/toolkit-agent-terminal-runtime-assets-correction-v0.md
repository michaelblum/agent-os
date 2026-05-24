# Toolkit Agent Terminal Runtime Assets Correction V0

## Goal

Fix the generic toolkit Agent Terminal runtime dependency path so the terminal
surface can actually render in a checked-out workspace.

The ownership correction moved the rendered surface into
`packages/toolkit/components/agent-terminal/index.html`, but that page now loads
xterm assets from a component-local `node_modules/` directory that is not
present in the repo/workspace after the branch is checked out.

## Branch/Base

- branch_from: `origin/gdi/toolkit-agent-terminal-foundation-v0`
- required_start_ref: `91b1c441356a12b543d30ccdd8a2de930281eec6`
- output_branch: `gdi/toolkit-agent-terminal-foundation-v0`

## Review Finding

Blocking finding:

- `packages/toolkit/components/agent-terminal/index.html` loads:
  - `./node_modules/@xterm/xterm/css/xterm.css`
  - `./node_modules/@xterm/xterm/lib/xterm.js`
  - `./node_modules/@xterm/addon-fit/lib/addon-fit.js`
- In the current workspace those files are missing under
  `packages/toolkit/components/agent-terminal/node_modules/`.
- The old Sigil app-local assets do exist under
  `apps/sigil/codex-terminal/node_modules/`, but the generic toolkit surface
  must not rely on Sigil-owned UI assets.

The focused static tests pass, but the generic launcher would open a page whose
own fallback says `xterm.js failed to load`.

## Required Correction

1. Make the generic toolkit Agent Terminal's xterm runtime assets available
   through a reproducible toolkit-owned path.

2. Do not make the generic toolkit surface load xterm from
   `apps/sigil/codex-terminal/node_modules/` or any `aos://sigil/...` path.

3. Choose a minimal durable shape, such as:
   - move the xterm dependencies to the appropriate toolkit package/install
     surface and load from that path;
   - vendor the required xterm browser assets under a toolkit-owned vendor path
     if that matches repo policy;
   - make the generic launcher perform a bounded dependency preflight/install in
     the toolkit component directory before opening the canvas, with clear
     deterministic failure if assets cannot be prepared.

4. Update tests so this failure cannot recur. Add focused assertions that the
   asset paths used by the generic toolkit HTML resolve to files available in
   the workspace, or that the launcher has a tested preflight which prepares
   them before `show create`.

5. Preserve the already-correct ownership boundary:
   - toolkit owns the generic rendered Agent Terminal surface;
   - Sigil entrypoints wrap toolkit with `surface=sigil`;
   - generic launch does not pass `sigil-root`;
   - generic launch does not create, warm, or depend on `avatar-main`;
   - bridge/server substrate may remain under `apps/sigil/codex-terminal/` for
     this slice, as previously deferred.

## Evidence From Review

Review commands run by Foreman:

```bash
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
git diff --check
```

All passed.

Additional asset probe:

```bash
for p in \
  packages/toolkit/components/agent-terminal/node_modules/@xterm/xterm/lib/xterm.js \
  packages/toolkit/components/agent-terminal/node_modules/@xterm/addon-fit/lib/addon-fit.js \
  apps/sigil/codex-terminal/node_modules/@xterm/xterm/lib/xterm.js \
  apps/sigil/codex-terminal/node_modules/@xterm/addon-fit/lib/addon-fit.js
do
  if [ -f "$p" ]; then echo "present $p"; else echo "missing $p"; fi
done
```

Observed:

```text
missing packages/toolkit/components/agent-terminal/node_modules/@xterm/xterm/lib/xterm.js
missing packages/toolkit/components/agent-terminal/node_modules/@xterm/addon-fit/lib/addon-fit.js
present apps/sigil/codex-terminal/node_modules/@xterm/xterm/lib/xterm.js
present apps/sigil/codex-terminal/node_modules/@xterm/addon-fit/lib/addon-fit.js
```

## Boundaries

- Do not launch or drive a live provider unless a deterministic test requires a
  local fake process.
- Do not run `./aos ready` unless you intentionally perform a bounded live
  check; this correction can be deterministic.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or main.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.
- Do not make Agent Terminal visual output provider acceptance evidence.
- Keep provider scope Codex-only v0.

## Verification

Run focused tests covering the corrected asset path and unchanged substrate.
Expected minimum:

```bash
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
git diff --check
```

If you add a new asset-path test, run it explicitly and include it in the
completion report.

## Completion Report

Report:

- branch and commit;
- files changed;
- how xterm assets are now made available to the generic toolkit terminal;
- how the test prevents a missing-asset regression;
- confirmation that Sigil remains a wrapper/consumer;
- verification commands and results.

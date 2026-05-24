# Toolkit Agent Terminal Foundation Correction V0

## Goal

Correct the Agent Terminal foundation extraction so the generic toolkit terminal
surface is actually toolkit-owned. The current implementation added a toolkit
entrypoint, but that entrypoint redirects back into
`aos://sigil/codex-terminal/index.html`, leaving Sigil as the owner of the
generic terminal view.

Fix the direction of ownership:

- toolkit owns the generic Agent Terminal UI/view path;
- Sigil may wrap or extend toolkit Agent Terminal behavior;
- generic Agent Terminal must not be a redirect into Sigil.

## Branch/Base

- branch_from: `origin/gdi/toolkit-agent-terminal-foundation-v0`
- required_start_ref: `500e92fb655a40bf07bc09bbaa9e7dd49d664d93`
- output_branch: `gdi/toolkit-agent-terminal-foundation-v0`

## Review Finding

Blocking finding:

- `packages/toolkit/components/agent-terminal/index.html` lines 7-10 load
  query params and immediately redirect to
  `aos://${sigilRoot}/codex-terminal/index.html`.
- `packages/toolkit/components/agent-terminal/launch.sh` still configures a
  `SIGIL_CONTENT_ROOT` and passes `sigil-root=...` into the generic toolkit
  page so the UI can jump back into Sigil.

This satisfies neutral visible branding, but it does not satisfy the work card's
ownership boundary: "Sigil can wrap or extend the generic toolkit surface" and
"the generic terminal must be usable without Sigil." The current shape is
toolkit wrapping Sigil.

## Required Correction

1. Make `packages/toolkit/components/agent-terminal/index.html` the real generic
   terminal surface instead of a redirect into Sigil.

2. Move or extract enough of the terminal view code from
   `apps/sigil/codex-terminal/index.html` so the generic UI, chrome, terminal
   pane, session rail, inspector view, and manifest are loaded from the toolkit
   component path.

3. Keep decomposition proportional. Acceptable shapes include:
   - a toolkit component page with small local modules for terminal view, rail,
     inspector rendering, and bridge-client calls;
   - shared toolkit modules consumed by both toolkit and Sigil pages;
   - a toolkit-owned page plus a tiny Sigil adapter/wrapper that adds
     Sigil-only avatar controls.

4. Preserve Sigil compatibility, but invert the dependency:
   - `apps/sigil/agent-terminal/` and/or `apps/sigil/codex-terminal/` may wrap
     or redirect to the toolkit component with `surface=sigil`;
   - generic toolkit launch must not require a Sigil content root for the UI;
   - generic toolkit launch must still not create, warm, or depend on
     `avatar-main`.

5. The bridge/server implementation may remain in
   `apps/sigil/codex-terminal/server.mjs` for this correction if moving it would
   expand the slice too much. If it remains there, document that as the next
   decomposition step. Do not leave the generic rendered surface itself in
   Sigil.

6. Update tests so the earlier shallow redirect cannot pass again. Add or adjust
   deterministic assertions that:
   - toolkit Agent Terminal HTML does not call `location.replace` to an
     `aos://sigil` URL;
   - generic toolkit launch does not pass a `sigil-root` UI dependency;
   - Sigil compatibility path still resolves;
   - generic mode does not emit `agent_terminal.avatar_toggle`;
   - existing bridge/session/dock-terminal tests still pass.

## Boundaries

- Do not launch or drive a live provider unless a deterministic test requires a
  local fake process.
- Do not run `./aos ready` unless you intentionally perform a bounded live
  check; this correction is expected to be deterministic.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or main.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.
- Do not make Agent Terminal visual output provider acceptance evidence.
- Keep provider scope Codex-only v0.

## Verification

Run focused tests covering the corrected boundary and unchanged substrate.
Expected minimum:

```bash
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
git diff --check
```

Run broader toolkit tests if you move shared toolkit modules or package
dependencies.

## Completion Report

Report:

- branch and commit;
- files changed;
- exact generic toolkit Agent Terminal surface path;
- how Sigil compatibility now wraps or extends toolkit instead of owning the
  generic UI;
- what remains deferred, especially bridge/server relocation if still under
  `apps/sigil/codex-terminal/`;
- verification commands and results.

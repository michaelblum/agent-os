# Toolkit Agent Terminal Foundation V0

## Goal

Create the first reusable, toolkit-owned Agent Terminal path so Foreman/GDI/
Operator dogfooding no longer depends on a Sigil-branded surface or Sigil avatar
warmup.

Sigil may keep its own terminal surface, but it must become a consumer or
extension of the foundational Agent Terminal surface rather than the owner of
the generic terminal substrate.

## Branch/Base

- branch_from: `origin/main`
- output_branch: `gdi/toolkit-agent-terminal-foundation-v0`

## Fresh Context

The current Agent Terminal is launched through:

- `apps/sigil/agent-terminal/launch.sh`, a wrapper around
  `apps/sigil/codex-terminal/launch.sh`;
- `apps/sigil/agent-terminal/index.html`, a redirect to the historical
  `codex-terminal` page;
- `apps/sigil/codex-terminal/index.html`, which hardcodes user-visible Sigil
  title/chrome and avatar-toggle affordances;
- `apps/sigil/codex-terminal/launch.sh`, which ensures `avatar-main` exists
  before opening the terminal surface.

This leaks Sigil into a more foundational dock/agent terminal milestone. The
same session also exposed a separate readiness side effect: `./aos ready`
currently starts/kickstarts the repo daemon, and repo config warms
`avatar-main` through the status item. Do not solve the readiness side effect in
this slice unless it falls out as a tiny isolated change; record it as a
follow-up if left open.

Existing reusable pieces already exist:

- toolkit panel chrome and sidebar layouts;
- toolkit runtime/manifest/canvas helpers;
- dock terminal session receipt helpers;
- Agent Terminal bridge tests around PTY input, resize, session catalog, and
  `aos.dock_terminal_session` observations.

## Read First

- `packages/toolkit/AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `apps/sigil/AGENTS.md`
- `docs/design/dock-terminal-session-agent-terminal-contract-v0.md`
- `shared/schemas/aos-dock-terminal-session-v0.md`
- `scripts/lib/dock-terminal-session-registry.mjs`
- `apps/sigil/agent-terminal/index.html`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/index.html`
- `apps/sigil/codex-terminal/launch.sh`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/session-inspector.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Required Work

1. Add a foundational Agent Terminal entrypoint under toolkit, expected shape:
   `packages/toolkit/components/agent-terminal/`.

2. Make the generic toolkit Agent Terminal path user-visible as Agent Terminal
   or AOS Agent Terminal, not Sigil. It must not display `Sigil / Agent
   Terminal`, `Sigil Agent terminal launched`, Sigil avatar controls, or
   `agent_terminal.avatar_toggle` as generic behavior.

3. Provide a neutral launch path for the generic terminal. It may initially
   reuse existing bridge/server implementation if a full bridge move is too
   large for this slice, but the generic launcher must not create, warm, or
   depend on `avatar-main`.

4. Keep backward compatibility for existing Sigil paths. Sigil can wrap or
   extend the generic toolkit surface and may keep Sigil-specific controls in
   its own path, but the generic terminal must be usable without Sigil.

5. Decompose only as much as is needed for the first clean boundary. Prefer
   extracting small reusable modules for terminal view/session rail/inspector
   state over copying a second monolithic HTML page. If a larger decomposition
   is needed, document the next cuts in the completion report.

6. Preserve the existing dock terminal session contract. Generic Agent Terminal
   observations remain `human_observability_only`; provider acceptance must not
   be inferred from terminal pixels or transcript text.

7. Add or update focused deterministic tests proving:
   - the generic toolkit Agent Terminal path does not contain user-visible
     Sigil branding;
   - the generic launcher does not create or require `avatar-main`;
   - existing bridge PTY/session behavior still passes;
   - Sigil compatibility paths still resolve.

## Boundaries

- Do not launch or drive a live provider unless a deterministic test requires a
  local fake process.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or main.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.
- Do not make Agent Terminal visual output provider acceptance evidence.
- Keep provider scope Codex-only v0.

## Verification

Run the focused deterministic checks needed for the changed files. Expected
minimum:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
git diff --check
```

If you add a new static/component test for the toolkit Agent Terminal boundary,
run it and include it in the completion report.

Live AOS proof is not required for this slice. If you choose to run
`./aos ready`, report whether it caused visible `avatar-main`/Sigil warmup, but
do not let that side effect expand this slice.

## Completion Report

Report:

- branch and commit;
- files changed;
- which generic Agent Terminal path now exists;
- how Sigil compatibility is preserved;
- what decomposition was completed versus deferred;
- verification commands and results;
- whether the `./aos ready` avatar warmup side effect remains as a follow-up.

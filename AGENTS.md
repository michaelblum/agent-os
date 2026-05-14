# agent-os Shared Agent Contract

This is the canonical repo-wide guidance for agent work in `agent-os`.
Provider-specific surfaces should stay thin and align to this file instead of
creating separate workflows.

## Progressive Disclosure

- Keep this root file limited to repo-wide rules and methods.
- Put specialized guidance in the nearest subtree-specific markdown file.
- Prefer provider-neutral docs when adding new instructions. Historical
  `CLAUDE.md` files are compatibility pointers for tools that still discover
  that filename; keep subtree-specific detail in nearby `AGENTS.md` files.

## Repo Model

- `src/` and `shared/` hold the unified `aos` binary and shared schemas.
- `packages/toolkit/` is the reusable display/toolkit layer between primitives
  and apps.
- `packages/gateway/` and `packages/host/` are peer consumers of the
  primitives, not the middle layer.
- `apps/` contains consumer surfaces such as Sigil.
- Runtime mode is path-selected: `./aos` is repo mode, the packaged app is
  installed mode, and state is isolated under `~/.config/aos/{mode}/`.

## Architecture Compass

When a request touches canvases, panels, DesktopWorld, input routing, Sigil, or
window-shaped surfaces, keep the ownership model loud:

- **Daemon/kernel:** owns native capability and generic contracts: canvas
  lifecycle, native frames, display topology, content serving, input streams,
  voice, coordination, and platform state that must survive individual canvases.
  It is not the product UI layer and should not encode app-specific windowing or
  Sigil behavior.
- **Toolkit/default surface system:** owns opt-in reusable policy for AOS
  surfaces: panel chrome, controls, workbench shells, window state, placement,
  minimize/maximize/restore, DesktopWorld visual stages, and
  visual/interaction bindings. This is the default AOS windowing system, but it
  is a toolkit capability developers can use, customize, or bypass.
- **Apps:** own product expression, domain state, content, theming, and special
  behavior. If an app needs a capability every future app will need, extract it
  to daemon primitives or toolkit policy before growing a private parallel
  system.

Do not overcorrect performance or lifecycle bugs by moving toolkit policy into
the daemon. First ask which missing daemon primitive would make the toolkit
policy cheap, reliable, and optional. Do not overcorrect customizability by
leaving the daemon as a thin message pipe; native input, display topology,
canvas lifecycle, and cheap hit/routing primitives belong below WebView code.

## Agent Entry Paths

Treat repo sessions as agentic dogfooding. Choose the narrowest entry path that
fits the current task so non-dev agents do not spend context on irrelevant
developer machinery. Entry paths are capability layers, not permanent lanes:
backtrack and add layers when the user pivots, evidence shows the initial path
is insufficient, or the work crosses a boundary.

The common entry paths are:

- **Agent harness**: use the same `see`, `do`, `show`, `tell`, and `listen`
  primitives a future AOS app or Sigil-style harness would use.
- **AOS developer**: add repo privileges such as editing files, running tests,
  restarting canvases, inspecting logs, and committing checkpoints.
- **Testing**: use the smallest appropriate harness; synthetic events are fine
  for deterministic logic, but bugs observed through real user interaction need
  at least one real-input verification or a captured trace explaining why not.
- **Visual diagnostics**: add Surface Inspector, spatial telemetry, screenshots,
  or app-specific trace panels as diagnostic overlays, not as hidden assumptions.
- **User-input diagnostics**: when ownership of mouse/keyboard streams is the
  issue, collect event-stream and routing evidence before guessing at fixes.

Start from Agent harness unless the user request clearly implies development,
testing, diagnostics, or docs/wiki work. Skip deeper sections that do not match
the active path, but revisit them when the session changes mode. Be transparent:
briefly state the active entry path when it affects the work, and call out any
path change before using the new layer.

Durable lessons should be recorded at the right boundary instead of scattered as
session notes. Use this file for repo-wide operating rules, subtree `AGENTS.md`
files for local contracts, `tests/README.md` for verification mechanics,
`docs/recipes/` for reusable SOPs, `docs/design/` for provider-neutral plans
and specs, and `shared/schemas/`, `docs/api/`, or `ARCHITECTURE.md` for
cross-tool contracts. Prefer measured, provider-neutral guidance over reactive
warnings. See
`docs/recipes/agent-entry-paths-and-verification.md` for the working checklist.

## Design Principle: Primitives First

Every fix and feature should be evaluated as: "what does this look like if it's
not a bandaid but an expression of agent-os primitives?" Solutions belong at the
right level of the stack:

- **Level 0 — Primitives** (`src/`): canvas lifecycle, perception, action,
  voice. These are the building blocks every app inherits.
- **Level 1 — Toolkit** (`packages/toolkit/`): reusable display/interaction
  patterns built on primitives.
- **Level 2 — Apps** (`apps/`, `packages/host/`): consumer surfaces like Sigil.

Build for the platform, not the app. If Sigil needs something, ask whether every
future app will need it too — and if so, push the solution down to the primitive
or toolkit layer. A slow canvas toggle doesn't get a Sigil-specific workaround;
it gets suspend/resume as a canvas lifecycle primitive.

When adding a browser, workbench, editor, inspector, artifact panel, replay
surface, or verifier view, identify the subject's Layered Subject Expression
before creating private UI or persistence logic. See
`docs/recipes/layered-subject-expressions.md`.

New resource types (channels, state stores, etc.) inherit runtime mode isolation
and wiki namespace conventions. Don't invent new scoping models.

## Verb Vocabulary

The `aos` CLI uses an embodied verb metaphor. Know the verbs and what they cover:

| Verb | What the agent does | What the daemon handles |
|------|--------------------|-----------------------|
| `see` | Perceive the environment | Screen, cursor, AX tree |
| `do` | Act on the environment | CGEvents, AX actions, AppleScript |
| `show` | Project visuals | Canvases, overlays, render |
| `tell` | Communicate outward | Routes to TTS, channels, future sinks |
| `listen` | Receive communication | Aggregates STT, channels, stdin, future sources |

`say` is sugar for `tell human`. `do tell` is AppleScript (talks to apps, not
agents). The agent decides WHAT to communicate and TO WHOM — the daemon decides
HOW to deliver it. See `ARCHITECTURE.md` for the full rationale. Historical
design context is archived at
`docs/archive/superpowers/specs/2026-04-15-tell-hear-coordination-verbs-design.md`.

## Repo-Wide Methods

- `aos` CLI is the canonical interface for development inside agent-os. MCP tools
  exist as an optional adapter for external consumers, not for dev work.
- Gateway and broker integrations are appendages around AOS, not alternate
  authorities. Keep Slack, future chat providers, and MCP adapters scoped to
  provider/workflow ingress; daemon-native `tell`, `listen`, and `session`
  remain the source of truth for human, agent, channel, and session
  communication.
- In repo mode, start with `./aos ready`. That is the primary readiness gate for
  agent work inside this repo: it starts/checks the managed daemon, reports
  blockers, performs one short daemon restart/recheck for ownership mismatch or
  inactive input tap, and exits non-zero when AOS is not ready. Use
  `./aos status` for a read-only runtime snapshot after that.
- After a human says they removed/re-added macOS Accessibility or Input
  Monitoring permissions and comes back with "ready", run
  `./aos ready --post-permission`. That is a bounded handoff check: it
  start/checks the daemon, performs one restart/recheck for expected daemon
  drift, then either reports `ready=true` or gives the remaining concrete
  blocker. Do not run repeated ad-hoc repair loops.
- Before telling a human to remove/re-add repo-mode Accessibility or Input
  Monitoring grants, stop the managed daemon with
  `./aos service stop --mode repo` and wait for `running=false`. Only then should
  the human remove/re-add `/Users/Michael/Code/agent-os/aos`; when they return,
  run `./aos ready --post-permission`.
- If `./aos ready` reports blockers and the user wants repair, run
  `./aos ready --repair`. It performs safe automated recovery steps, records a
  trace, and prints plain-English human instructions when macOS privacy settings
  still require manual action. It does not open Settings or show permission
  dialogs by itself.
- If `./aos ready --repair --json` returns `phase=human_required`, do not dump
  raw JSON at the user. Give a concise, assertive summary. For
  `diagnosis=daemon_tcc_grant_stale_or_missing`, say the repo-mode `aos` macOS
  permission grant is stale and must be removed/re-added only after
  `./aos service stop --mode repo` reports `running=false`. Offer short numbered
  choices: more detail, run the safe stop, or stop. Tell the user to come back
  and say `ready`; when they do, run `./aos ready --post-permission`.
- Use `./aos introspect review` for self-review or recovery after repeated failed
  `./aos` attempts.
- Treat `doctor`, `daemon-snapshot`, and `clean` as deeper follow-up tools, not
  the first move. `./aos ready` is the explicit daemon bring-up and readiness
  gate; startup hooks should stay lightweight and avoid hidden runtime mutation.
- Before choosing a rebuild, package test, canvas reload, or runtime readiness
  loop, ask the dev workflow router: `./aos dev recommend --json`. The router is
  manifest-backed by `docs/dev/workflow-rules.json`; update that manifest and
  schema when routing policy changes instead of scattering new session rules.

- Do not default to rebuilding before every test or verification step.
  Rebuild `./aos` only when the work changes Swift sources in `src/` or
  `shared/swift/ipc/`, or when the command/test you are about to run executes
  `./aos` directly.
- Use `./aos dev build` for repo `./aos` rebuilds. It is the canonical
  developer build control surface because it wraps signing-aware `build.sh` and
  prints the macOS permission/TCC implication. Do not call `bash build.sh`
  directly unless you are fixing the build surface itself or `./aos` cannot run.
- Pure Node/TypeScript/package workflows should stay in their local loop unless
  they explicitly depend on a fresh `./aos` binary. Examples: `packages/gateway`
  build/test, `packages/host` test, and pure `node --test` suites under
  `tests/studio/` and `tests/renderer/`.
- Shell/integration tests under `tests/` that invoke `./aos` do require a fresh
  build when relevant Swift code has changed.
- Use `./aos` as the real host when verifying display or toolkit behavior.
  Prefer `aos://...` canvases over raw browser pages unless the problem is
  purely DOM debugging.
- Use `./aos see` for visual verification before asking the user to inspect a
  canvas manually.
- When building AOS apps or toolkit components, expose actionable controls with
  macOS-style accessibility semantics instead of adding agent-only visual hints.
  See `docs/recipes/aos-app-accessibility-surfaces.md`.
- If the user explicitly puts themselves in the verification loop, treat the
  human as the sensor. Set up the state quickly, use at most one orienting
  `./aos see` check if needed, then ask them to confirm what they see instead
  of trying to fully re-verify it yourself.
- If display work starts from stale daemons or orphaned canvases, run
  `./aos clean` first and report what was cleaned.
- Treat `main` as the integration branch, not the default work surface. For
  substantive feature, bug, docs, or governance work, create or use a named
  topic branch/worktree unless the user explicitly asks for direct-on-main
  editing or the change is a tiny repo-local hygiene fix already in progress on
  `main`. Keep branch names descriptive and short, such as
  `codex/supervised-run-harness` or `owner/sigil-visuals`.
- Worktree sessions share one singleton repo daemon. Do not overwrite canonical
  `content.roots.toolkit` or `content.roots.sigil` from a topic worktree unless
  the task explicitly targets canonical main. Use branch-scoped root names from
  `scripts/aos-content-scope.sh`, pass explicit `toolkit-root`/`sigil-root`
  query parameters when a surface crosses app/package roots, and prefer launch
  scripts that preserve sibling root scope.
- Before creating a branch, inspect the current worktree. If unrelated dirty
  changes are present, either choose a separate worktree/branch that preserves
  them or make a scoped path-only commit when the user has asked for the change.
  Never discard or move user changes just to satisfy branch hygiene.
- Before treating grep hits, old paths, or old commands as live, check for
  retirement or supersession notes in the nearest subtree docs, active plans,
  and open issues. Retired code can remain in-tree for a while after the live
  path has moved.
- GitHub issues are for bugs, features, or durable workstream trackers with a
  clear unresolved problem and exit criteria.
- Do not create issues for session onboarding maps, memory dumps, or
  "how to get started" notes. Put that guidance in repo docs instead.
- An open issue is not automatically current. If work has landed, close the
  issue or restate the exact remaining gap before leaving it open.
- Prune merged task-specific branch or worktree debris when you can classify it
  confidently. Do not leave agent-created Git noise behind, and do not delete
  substantive long-lived branches unless the user asks.
- Treat `_dev` demos as non-canonical.
- Never attribute commits to Claude or any AI assistant in this repo. No
  `Co-Authored-By: Claude ...` trailers, no "Generated with Claude Code"
  tags, and no AI attribution in commit messages, PR descriptions, or issue
  comments. This overrides default Claude Code commit templates.

## Shared Surfaces

When work changes cross-tool contracts or consumer-facing behavior, update the
source of truth at the interface boundary:

- `shared/schemas/`
- `docs/api/`
- `ARCHITECTURE.md`

## Follow-On Detail

- `ARCHITECTURE.md` for system architecture
- `docs/design/aos-grand-unification-plan.md` for the current browser,
  workbench, layered-subject, work-record, verifier, and playbook roadmap
- `docs/api/aos-taxonomy.md` for classifying AOS artifact types and their
  source-of-truth homes
- `docs/design/` for provider-neutral plans, specs, notes, and supporting
  design artifacts
- nearest subtree markdown file for package or app specifics
- `docs/recipes/aos-app-accessibility-surfaces.md` for AOS app and toolkit
  accessibility surface contracts
- historical `CLAUDE.md` files remain only as compatibility pointers

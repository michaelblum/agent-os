# Work Card: GDI Sigil Launch Product Boundary Correction V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the generic app launcher slice so `aos launch sigil`
  launches the current Sigil product boundary, while historical workbench/studio
  surfaces remain explicitly legacy/dev-only and Sigil-specific behavior is not
  hard-coded into the generic launcher.
- Source artifact: Foreman review of
  `823d3b170a933a739e02c7e08e972d3c60cf3a0a` plus Michael's clarification that
  current Sigil Studio and current Sigil Workbench should not be treated as the
  Sigil product architecture. A future Sigil workbench, if any, should be a
  themed composition of toolkit workbench/browser primitives plus avatar, radial
  menu, settings surface, and 3D viewer/editor capabilities.
- Updated product clarification from Michael: launching Sigil should visually
  look like the AOS menu/status bar icon becoming available. The user then
  interacts with Sigil by clicking that icon to dock/undock the avatar. The
  avatar is the real entry point for Sigil from there. The old Sigil context
  menu should be sequestered, not deleted, so its visual theme can be distilled
  into a reusable Sigil theme later. Future "graph wiki brain" and Settings
  surfaces should be toolkit-composable surfaces using that Sigil theme.
- Branch/output expectation: continue from
  `origin/gdi/recipe-app-launch-correction-v0`, commit and push the corrected
  GDI branch. Do not open or merge a PR; Foreman will review.
- Stop conditions: complete, failed, human_needed, or product-direction blocker
  only if the current Sigil default entry cannot be corrected without choosing
  a new product concept.

## Branch / Base

- branch_from: `origin/gdi/recipe-app-launch-correction-v0`
- required_start_ref: `origin/gdi/recipe-app-launch-correction-v0`

This is a correction on top of the completed app-launch branch, not a restart
from `origin/main`, `origin/feat/command-surface-extraction`, or
`origin/gdi/recipe-ladder-foundation-v0`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, app launch state, or prior review context. Read and rediscover before
editing.

## Review Findings To Correct

The generic launcher is directionally right, but the current branch still has
two product-boundary problems:

1. `apps/sigil/aos-app.json` sets `"default_entry": "workbench"`, so
   `./aos launch sigil --dry-run --json` currently expands to:

   ```text
   entry: workbench
   entries: avatar, workbench
   ```

   That makes the historical multi-tab Sigil workbench the canonical product
   launch. Michael explicitly rejected that boundary. The current workbench can
   remain as a legacy/dev surface if useful, but it must not be the default
   Sigil product entry and must not be named or documented as the canonical
   Sigil experience.

2. `scripts/aos-launch.mjs` contains Sigil-specific generic-launch logic:

   ```text
   sigil_agent_terminal
   sigil_stage_avatar
   post:sigil-stage-avatar
   ```

   That recreates the duplication problem inside the generic launcher. App
   launch should be generic policy plus app-owned manifest data and app-owned
   hooks. The launcher should not know about Sigil frame kinds, avatar staging,
   or Sigil product names.

## Goal

Make these statements true:

```bash
./aos launch sigil --dry-run --json
./aos launch sigil
./aos launch sigil agent-terminal --dry-run --json
```

- `aos launch sigil` resolves to the current Sigil product-safe default, not the
  historical workbench. Prefer the avatar/status/radial product shell as the
  default unless local inspection proves a better current product entry already
  exists.
- From a visible-product standpoint, default launch should primarily make the
  AOS/Sigil status item available. The avatar is then docked/undocked through
  that status item and becomes the entry point for all Sigil actions.
- Historical workbench launch, if retained, is explicitly legacy/dev-only and
  invoked by an explicit entry such as `legacy-workbench` or `dev-workbench`.
- Sigil Studio remains sequestered/decommissioned and is not reintroduced.
- The old Sigil context menu is also source material. Sequester it if needed,
  but do not delete it; it should remain available for later theme extraction
  and toolkit/Zag rebuild work.
- `scripts/aos-launch.mjs` remains app-generic. Sigil-specific launch behavior
  lives in `apps/sigil/aos-app.json`, app-owned hooks, or generic schema fields.

## Required Design

### 1. Fix the Sigil default boundary

Update `apps/sigil/aos-app.json` so the default entry is not the historical
workbench.

Preferred current shape:

```json
{
  "default_entry": "avatar"
}
```

The default should configure the status item and make the avatar product shell
available. Do not open the historical workbench by default. If the cleanest
current default entry is better named `shell`, `status`, or similar, use the
product concept already present in source and explain the choice in the
completion report.

Acceptance detail: `./aos launch sigil --dry-run --json` should make it clear
that the default plan is status-item/avatar shell readiness, not workbench
startup.

### 2. Demote or rename the historical workbench

The current `apps/sigil/workbench/` surface is a historical/dev surface. It is
not the future Sigil workbench concept.

Acceptable end states:

- rename the manifest entry to `legacy-workbench` or `dev-workbench`, update
  wrappers/tests/docs, and keep it available only by explicit request;
- or sequester it if it adds no current value and no deterministic test needs it.

Do not build the future themed Sigil workbench in this correction. That is a
separate product slice around toolkit graph/workbench composition, avatar,
radial menu, settings, and 3D viewer/editor reuse.

If there is an existing Sigil context menu surface or implementation in source,
move it to an explicitly sequestered/legacy location if it is currently presented
as product surface. Do not delete it. It is future source material for:

- extracting a reusable Sigil theme;
- rebuilding the context/radial interactions on toolkit/Zag primitives after
  MVP;
- theming graph/settings/editor surfaces launched from Sigil.

### 3. Remove Sigil-specific behavior from the generic launcher

`scripts/aos-launch.mjs` must not contain hard-coded Sigil behavior or app ids.

Move the current special cases to one of these patterns:

- app-owned hooks under `apps/sigil/` for behavior that is truly app-specific;
- generic manifest/schema fields for reusable launch behavior, such as explicit
  frame geometry, placement policy, or a generic `show eval/post until` action;
- existing AOS primitives composed from the manifest.

Do not leave generic-launch kinds such as `sigil_stage_avatar`,
`sigil_workbench`, or `sigil_agent_terminal`.

### 4. Keep recipes as composition, not product truth

Update Sigil recipes so they compose the canonical launch entry instead of
restoring the historical workbench as product default.

Expected shape for `recipes/sigil/start.json` if retained:

```json
{
  "steps": [
    {
      "kind": "aos_command",
      "command": { "path": ["launch"], "form_id": "launch-app" },
      "argv": ["sigil"]
    }
  ]
}
```

If a legacy/dev workbench recipe remains, name it that way.

### 5. Record the future product direction without overbuilding it

Add a short durable note in the most relevant existing doc or a small
`docs/dev/reports/` note that states:

- current Studio is decommissioned/sequestered;
- current workbench is legacy/dev-only;
- current context menu, if present, is sequestered source material and should
  later be rebuilt on toolkit/Zag primitives;
- Sigil launch is status-item-first: the menu/status icon appears, and the user
  docks/undocks the avatar through that icon;
- the avatar is Sigil's entry point after launch;
- a reusable Sigil theme should be distilled from the old context menu visuals
  and made available per app/per surface if the toolkit supports that today, or
  recorded as a near-future toolkit gap if it does not;
- future Sigil workbench should be a themed toolkit composition, not a bespoke
  Sigil-owned surface stack;
- settings/avatar/radial/editor surfaces should be toolkit-composable surfaces
  that Sigil themes and wires together.
- the MVP Settings surface can be deliberately plain: markdown, JSON, HTML, or
  a simple toolkit settings board/editor over actual Sigil/AOS settings. A
  bespoke Sigil settings view is post-MVP.
- the future radial item "graph wiki brain" should launch a themed graph/browser
  surface containing a Sigil node with navigable subnodes, including a path to
  Settings.

Keep this concise. Do not create a large architecture manifesto in this
correction.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/aos-app.json`
- `scripts/aos-launch.mjs`
- `shared/schemas/aos-app-v0.schema.json`
- `recipes/sigil/start.json`
- `recipes/sigil/start-agent-terminal.json`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/bridge-launch.sh`
- `apps/sigil/context-menu/` if present
- `apps/sigil/radial-item-workbench/` if relevant
- `packages/toolkit/components/_base/theme.css`
- relevant toolkit theme docs or code discovered by `rg -n "theme" packages/toolkit`
- `tests/schemas/aos-app-v0.test.mjs`
- `tests/sigil-workbench-launch.sh`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `docs/dev/reports/recipe-ladder-foundation-v0.md`
- `docs/api/aos.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/recipe-app-launch-correction-v0
AOS_PATH="$(pwd)/aos" AOS_RUNTIME_MODE=repo ./aos launch sigil --dry-run --json
rg -n "sigil_|Sigil" scripts/aos-launch.mjs
rg -n "context-menu|context menu|theme|status_item|radial|settings" apps/sigil packages/toolkit tests docs/design/work-cards | head -200
./aos dev recommend --json --paths \
  apps/sigil/aos-app.json,scripts/aos-launch.mjs,shared/schemas/aos-app-v0.schema.json,recipes/sigil/start.json,recipes/sigil/start-agent-terminal.json,apps/sigil/workbench/launch.sh,apps/sigil/agent-terminal/launch.sh,tests/schemas/aos-app-v0.test.mjs,tests/sigil-workbench-launch.sh,tests/renderer/agent-terminal-chrome.test.mjs,docs/api/aos.md
```

## Verification

At minimum run:

```bash
node --test tests/schemas/aos-app-v0.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/ops-contract.sh
bash tests/sigil-workbench-launch.sh
node --test tests/renderer/agent-terminal-chrome.test.mjs
AOS_PATH="$(pwd)/aos" AOS_RUNTIME_MODE=repo ./aos launch sigil --dry-run --json
AOS_PATH="$(pwd)/aos" AOS_RUNTIME_MODE=repo ./aos launch sigil agent-terminal --dry-run --json
git diff --check
```

Adjust the exact test list if you rename/decommission the legacy workbench test,
but keep equivalent coverage proving:

- default Sigil launch no longer expands to the historical workbench;
- any retained workbench entry is explicit legacy/dev-only;
- the generic launcher contains no Sigil-specific action or frame kinds;
- `aos launch sigil` and `aos launch sigil agent-terminal` still have valid dry
  run plans;
- Sigil recipes compose launch without becoming the product source of truth.

If live AOS checks are needed and `./aos ready` reports repo-mode TCC/input-tap
blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Hard Boundaries

- Do not build the future themed Sigil workbench in this round.
- Do not build the future graph wiki brain or Settings surface in this round.
- Do not rebuild the context menu in this round.
- Do not delete the context menu source material if it exists.
- Do not resurrect Studio.
- Do not add a TUI.
- Do not broaden into recipe-language redesign.
- Do not migrate unrelated app/toolkit launchers.
- Do not preserve confusing names merely because existing tests mention them;
  update tests when the product boundary changes.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact default-entry behavior for `aos launch sigil --dry-run --json`;
- where any historical workbench surface now lives and how it is invoked;
- where any old context menu source material now lives, if touched;
- how Sigil-specific generic-launch code was removed or replaced;
- whether toolkit per-app/per-surface theming exists today or was recorded as a
  future gap;
- tests run and pass/fail status;
- any remaining live-readiness blocker;
- whether the branch was pushed.

# Implementer Real-Input Scenario Harness Consolidation V0

## Recipient

Implementer follow-up round.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/real-input-scenario-harness-consolidation-v0`

## Source

Foreman review after routing
`docs/design/work-cards/implementer-sigil-diagnostic-surface-jank-guard-v0.md`.

The repo already has an AOS-first real-input philosophy, and `tests/README.md`
now says test code should use primitives/molecules/templates. But the actual
real-input test surface is still too ad hoc:

- `tests/lib/real_input_surface_primitives.py` uses direct Quartz event posting
  in `RealPointer`;
- `tests/sigil-real-input-status-avatar.sh` and
  `tests/sigil-context-menu-real-input.sh` duplicate `wait_until`, `do_click`,
  `do_scroll`, `do_key`, `native_point_for`, display conversion, and Sigil debug
  probing;
- `tests/lib/sigil/radial-menu.sh` is a large mixed harness containing AOS
  command wrappers, display probing, pointer travel, semantic capture,
  artifact reporting, and Sigil product assertions;
- recipes currently cover runtime/Sigil startup, but no source-backed recipes
  package common real-input scenarios.

Line-count snapshot at card creation:

```text
259 tests/lib/real_input_surface_primitives.py
192 tests/lib/real-input-surface-primitives.mjs
183 tests/lib/real-input-surface-harness.sh
604 tests/lib/sigil/radial-menu.sh
175 tests/sigil-real-input-status-avatar.sh
392 tests/sigil-context-menu-real-input.sh
 41 tests/scenarios/sigil/radial-menu/real-input.sh
 39 tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

This is exactly the sort of surface that causes long Implementer runs to spend tokens
rediscovering and improvising instead of invoking a small, named scenario.

## Goal

Refactor the real-input test harness into composable, AOS-first units that make
common scenarios easy to run and hard to freestyle.

The outcome should be:

- scenario scripts become thin product intent wrappers;
- shared helpers own AOS command execution, readiness, perception state,
  semantic target resolution, human-like click/scroll/type/key actions,
  cleanup, and artifact reporting;
- direct Quartz posting is either removed from consumer scenarios or isolated
  behind a clearly labeled boundary adapter used only when `aos do` cannot
  express the gesture;
- the canonical real-input scenarios can be invoked as recipes or recipe-like
  wrappers with bounded parameters;
- docs steer agents to named scenarios rather than ad hoc `aos do` sequences.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/design/work-cards/real-input-surface-test-primitives-and-seam-radial-v0.md`
- `docs/design/work-cards/compact-real-input-scenario-output-v0.md`
- `docs/design/work-cards/implementer-sigil-diagnostic-surface-jank-guard-v0.md`
- `docs/api/aos.md#do`
- `docs/recipes/agent-tooling-contexts-and-verification.md`
- `apps/sigil/context-menu/README.md`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/real-input-surface-primitives.mjs`
- `tests/lib/sigil/radial-menu.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/sigil-context-menu-real-input.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `shared/schemas/ops-recipe.schema.json`
- `scripts/aos-ops.mjs`
- `recipes/runtime/status-snapshot.json`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos ready --json
./aos recipe list --json
./aos do profiles
rg -n "CGEvent|Quartz|def do_click|def do_scroll|def do_key|native_point_for|wait_until\\(|run\\(\"do\"|AOS_REAL_INPUT_OK|real-input" tests docs apps/sigil/context-menu/README.md
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Design

### AOS-First Action Boundary

The public action boundary for agent/test scenarios is `aos do`.

Consumer scenarios should use helpers that call:

- `./aos do click ...`;
- `./aos do hover ...`;
- `./aos do drag ...`;
- `./aos do scroll ...`;
- `./aos do type ...`;
- `./aos do key ...`.

Direct Quartz `CGEventCreateMouseEvent` / `CGEventPost` must not appear in
scenario-local code. If a gesture cannot be represented by `aos do`, keep the
native implementation in one boundary helper with an explicit name and comment,
and return a follow-up recommendation for the missing `aos do` primitive.

Do not delete boundary coverage that intentionally verifies native/AppKit or
DesktopWorld/native conversion. Label that as boundary coverage and keep it out
of app scenario code.

### Test Primitive / Molecule Shape

Create or consolidate reusable helpers under `tests/lib/` so app-level real
input checks can compose these ideas without copying implementation:

- readiness gate: repo daemon reachable, input tap active, no stale daemons,
  `AOS_REAL_INPUT_OK=1` required for live movement;
- AOS command wrapper: `run`, `run_json`, captured failure payloads, command
  timeout, compact error shape;
- wait/retry: one helper used by all scenarios;
- canvas helpers: get/list/wait/eval, frame/interactivity checks, cleanup;
- perception/target helpers: `see capture --xray`, semantic target map,
  `canvas:<id>/<ref>` click target construction, `--state-id` propagation when
  available;
- action helpers: click/scroll/type/key/drag wrappers that call `aos do` with
  profile/dwell defaults;
- Sigil fixture molecules: activate/launch status-item/avatar, ensure visible
  Surface Inspector when needed, open avatar context menu, open radial menu,
  select radial semantic target, open wiki brain, cleanup owned surfaces;
- artifact reporting: compact stdout plus full proof/failure JSON artifact.

Use small shell/Python/Node modules in the existing style. Do not introduce a
large new test framework.

### Recipes Or Recipe-Like Entry Points

Add source-backed recipes only if the current recipe runner can safely express
them with bounded parameters and live-input gating. If recipe schema support is
too limited, add thin shell wrappers plus a short follow-up for recipe parameter
support.

At minimum, provide discoverable entrypoints for:

- status item summons Sigil avatar through real input;
- avatar context menu smoke through real input;
- radial menu opens Graph Wiki Brain through real input;
- radial DesktopWorld path scenario through real input.

The entrypoints must state whether they move the pointer and require
`AOS_REAL_INPUT_OK=1`.

### Do Not Expand Product Scope

This is a test harness and invocation cleanup. Do not change Sigil product
behavior, renderer behavior, daemon event tap behavior, or toolkit lifecycle
policy unless rediscovery proves a harness consolidation cannot proceed without
a tiny product bug fix.

## Suggested Implementation Direction

Good likely moves:

- Extract the duplicated Python helpers from `tests/sigil-real-input-status-avatar.sh`
  and `tests/sigil-context-menu-real-input.sh` into a shared module.
- Replace scenario-local `do_click`/`do_scroll`/`do_key` definitions with shared
  helpers that call `./aos do`.
- Move Sigil DOM selector-to-native-point logic into a named transitional helper
  so it is not copied. Mark it as transitional until canvas DOM refs or
  semantic targets cover the needed controls.
- Keep `tests/lib/real-input-surface-primitives.mjs` as the pure spatial helper
  if it still matches toolkit semantics, and add/update tests if behavior moves.
- Shrink scenario files so they read as product flow plus assertions, not a
  custom automation framework.
- Update `tests/README.md` and `apps/sigil/context-menu/README.md` to list the
  canonical scenario entrypoints and the no-freelance rule.

## Verification

Run deterministic checks:

```bash
git diff --check
bash -n tests/lib/real-input-surface-harness.sh \
  tests/lib/sigil/radial-menu.sh \
  tests/scenarios/sigil/radial-menu/real-input.sh \
  tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh \
  tests/sigil-real-input-status-avatar.sh \
  tests/sigil-context-menu-real-input.sh
node --test tests/toolkit/real-input-surface-primitives.test.mjs
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

If recipes or recipe schema change, also run:

```bash
bash tests/ops-contract.sh
node --test tests/schemas/*.test.mjs
./aos recipe list --json
```

Live checks should run only when `./aos ready --json` is clean and the machine
is safe for pointer movement:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
bash tests/sigil-real-input-status-avatar.sh
bash tests/sigil-context-menu-real-input.sh
```

If live input is unsafe or blocked, report the blocker clearly and include the
deterministic evidence. Do not loop, do not run live input while mouse jank is
present, and do not claim live proof without real input evidence.

## Completion Report

Include:

- branch and head SHA;
- files changed;
- line-count before/after for the main real-input scenario/harness files;
- what primitive/molecule boundaries were created;
- whether any direct Quartz posting remains and why;
- whether recipes or wrapper entrypoints were added;
- tests run and pass/fail;
- live real-input scenarios run or skipped, with reason;
- final `./aos status --json`, `./aos ready --json`, `./aos show list --json`,
  and `./aos clean --dry-run --json` summaries;
- follow-up recommendations for missing `aos do` capabilities.

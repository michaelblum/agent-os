# Implementer Test Suite Contract Audit V0

## Recipient

Implementer implementation and audit round.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/test-suite-contract-audit-v0`

## Source

Foreman review after the command-surface, recipe/launch/experience, Sigil
lifecycle, radial/wiki, and real-input harness rounds.

The repo has been through a broad architecture shift:

- AOS command behavior moved toward external script/manifest surfaces.
- Sigil moved from app/workbench launch semantics toward an AOS experience.
- Surface lifecycle moved toward shared warm/suspended toolkit policy.
- Real-input scenarios moved toward composable, bounded harness primitives.
- Repo-mode TCC/ready recovery wording moved from `ready` relay language to
  `finished`.

Many tests were updated, but the suite almost certainly still contains
compatibility residue from earlier shapes. Some compatibility is valid product
contract. Test-harness compatibility is not valid by default.

## Goal

Audit and clean the test suite so it asserts the current architecture rather
than preserving pre-refactor behavior for tradition's sake.

The desired end state is:

- product compatibility tests remain only when the product surface explicitly
  promises the behavior;
- test-harness compatibility helpers are migrated, deleted, or renamed as
  explicit bounded diagnostics;
- canonical helper primitives are reused instead of duplicate ad hoc shell,
  Python, Swift, or JS islands;
- stale Sigil/workbench/launch/lifecycle/readiness vocabulary no longer
  appears in active tests unless it is intentionally testing a legacy product
  contract;
- the final report clearly distinguishes what was removed, migrated, retained,
  and why.

## Definitions

Use these categories consistently.

### Product Compatibility

Valid only when the user-facing or agent-facing product still promises the old
behavior through help, manifest, docs, schema, migration path, external API, or
an explicit release boundary.

These tests may remain, but each retained case should state the contract and
removal gate.

Examples that might be valid product compatibility:

- explicit `legacy-workbench` launch entry declared for dev-only use;
- state migration from a known legacy location;
- documented command aliases that remain in the manifest/help contract.

### Test Harness Residue

Invalid by default.

These are old helpers, wrappers, names, or scenarios kept only because tests
were written against them before the refactor. Migrate or delete them unless a
current product contract requires them.

Examples to audit carefully:

- global status-item discovery on normal real-input paths;
- old Sigil workbench assumptions in active tests;
- launch-based Sigil tests where experience activation is canonical;
- remove/recreate lifecycle assertions where suspend/resume is canonical;
- old `ready` relay wording where the human signal is now `finished`;
- local test-only compatibility wrappers that hide stale command shapes.

### Diagnostic Compatibility

Allowed when the helper exists solely to explain a failure or inspect residue.

Requirements:

- name makes scope/cost obvious, for example `global_*_diagnostic`;
- bounded timeout;
- not used on the normal success path;
- output is structured enough for Foreman/Implementer review.

## Read First

- `tests/README.md`
- `tests/lib/status-item.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/isolated-daemon.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/sigil_real_input_context.py`
- `apps/sigil/AGENTS.md`
- `apps/sigil/context-menu/README.md`
- `apps/sigil/scripts/launch-common.sh`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/aos-app.json`
- `experiences/sigil/aos-experience.json`
- `manifests/commands/aos-commands.json`
- `manifests/commands/aos-external-commands.json`
- `docs/design/work-cards/implementer-real-input-scenario-harness-consolidation-v0.md`
- `docs/design/work-cards/implementer-real-input-status-item-owner-correction-v0.md`
- `docs/design/work-cards/implementer-sigil-warm-surface-lifecycle-performance-v0.md`
- `docs/design/work-cards/implementer-sigil-launch-product-boundary-correction-v0.md`
- `docs/design/work-cards/implementer-recipe-ladder-foundation-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Audit Commands

Use `rg` first. Include at least these sweeps, then add narrower searches as
needed:

```bash
rg -n "compat|compatibility|legacy|deprecated|transitional|backward|backwards|shim|alias" tests apps scripts docs
rg -n "workbench|legacy-workbench|aos launch sigil|experience activate sigil" tests apps/sigil docs
rg -n "ready|finished|post-permission|TCC|permission" tests docs/design/work-cards .docks
rg -n "remove|recreate|suspend|resume|closeMode|warm" tests packages apps/sigil scripts
rg -n "NSWorkspace|runningApplications|kAXExtrasMenuBarAttribute|status item|global" tests/lib tests apps/sigil
rg -n "show wait|show remove|show create|content.roots|Unknown content root" tests apps scripts docs
```

Do not treat every match as a bug. Classify first.

## Required Work

1. Produce an audit report at:

   `docs/dev/reports/test-suite-contract-audit-v0.md`

   Include:

   - summary of categories found;
   - tests/helpers migrated or removed;
   - product compatibility tests retained, with the exact product contract and
     removal gate;
   - diagnostic-only helpers retained, with bounded timeout and why global
     scope is necessary;
   - stale findings intentionally deferred, with a short reason.

2. Migrate the low-risk obvious residue in the same round.

   Favor edits that reduce confusion and duplication:

   - route real-input status-item paths through PID-scoped owner helpers;
   - rename or demote any remaining global status-item scan helper so it cannot
     be mistaken for the normal click path;
   - remove test-only compatibility wrappers that no active test should call;
   - snap Sigil tests to `aos experience activate sigil` when they are testing
     current Sigil activation rather than the explicit `legacy-workbench`
     product contract;
   - replace duplicate ad hoc shell/Python/JS test sequences with existing
     primitives where the replacement is direct;
   - update active docs that still recommend stale test entrypoints.

3. Keep product changes out of this slice unless a test proves a real product
   bug.

   If you find a product bug, keep the product patch tiny and explain why it is
   inseparable from making the tests honest. Otherwise, record it as a follow-up
   finding in the report.

4. Keep the round bounded.

   This is a broad cleanup, not a mandate to rewrite the entire suite. Stop when
   you have migrated the obvious current-architecture drift and left a clear
   report for the remaining backlog.

## Hard Boundaries

- Do not preserve a helper, alias, or wrapper solely because old tests use it.
- Do not run unbounded macOS Accessibility/global menu scans on normal test
  success paths.
- Do not resurrect the legacy avatar configuration surface or the old Sigil
  workbench as a current Sigil proof.
- Do not convert historical/archive docs into current product requirements.
- Do not run long live real-input loops. Use existing bounded scenarios only.
- Do not broaden command compatibility in manifests just to keep tests passing.
- Do not touch unrelated product surfaces for style cleanup.

## Verification

Run deterministic checks covering any touched area. At minimum:

```bash
git diff --check
bash -n tests/lib/*.sh tests/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

If you edit command manifests, also run:

```bash
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
```

If you edit Sigil activation/lifecycle tests, run the relevant focused checks,
for example:

```bash
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
bash tests/sigil-experience-wiki-seed.sh
```

Run real-input scenarios only if needed for touched real-input code and only
when `./aos ready --json` is clean:

```bash
bash tests/sigil-real-input-status-avatar.sh
bash tests/sigil-context-menu-real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Final hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

## Completion Report

Include:

- branch and head SHA;
- summary of audit categories;
- files changed;
- exact stale test/harness compatibility removed or migrated;
- product compatibility retained, with contract/removal gate;
- diagnostic-only global helpers retained, with bounded timeout;
- tests run and pass/fail;
- live real-input scenarios run or skipped, with reason;
- final runtime hygiene summary;
- residual follow-up list, if any;
- whether the branch is ready for Foreman review/fold into
  `feat/command-surface-extraction`.

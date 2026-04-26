# Agent Control Surface Molecules — Design Memo

This is option-space framing, not an implementation plan. The goal is to
capture session learnings about how agents operate AOS effectively, then turn
those learnings into reusable control-surface affordances that less capable
agents can discover, inspect, dry-run, and execute.

## Problem

Recent AOS work has become faster because the runtime now exposes enough truth
for an agent to work from evidence: readiness state, canvas lifecycle metadata,
DesktopWorld segment snapshots, `show list`, `show eval`, schema tests, and
live capture. The missing layer is a first-class way to package repeated
operator procedures without hiding the primitive verbs they use.

Today, a strong agent can infer the loop:

1. Run `./aos ready` and repair if needed.
2. Inspect state with `./aos status`, `./aos show list`, and targeted `eval`.
3. Fix behavior at the correct stack layer.
4. Verify through static checks, schema/unit tests, live smoke, and `see`.
5. Commit a reversible checkpoint and update GitHub issues when appropriate.

That loop should be teachable and executable, not dependent on agent intuition.

## Naming And Public Surface

Do not add a top-level `aos run` command in the first slice. The repo already
has workflow-ish surfaces:

- `aos wiki invoke`, which returns an instruction bundle rather than executing
  a workflow.
- integration-broker workflows, which expose launchable provider workflows.
- future SDK workflow concepts.

Adding top-level `run` would create a third ambiguous public concept before the
ownership model is settled. The proposed first public surface is:

```bash
./aos ops list
./aos ops explain <id>
./aos ops dry-run <id>
./aos ops run <id>
```

`ops` names the operator control surface rather than the app or user workflow
surface. Internally, the executable units can still be called recipes or
molecules. The command registry, `docs/api/aos.md`, and `ARCHITECTURE.md` must
be updated in the same PR that introduces the public surface.

## Proposed Stack

The control surface should layer like the product architecture:

```text
Level 0: AOS verbs / primitives
  see, do, show, tell, listen, wiki, status, ready

Level 1: ops recipes / molecules
  runtime/status-snapshot
  runtime/ready-repair
  canvas/window-level-smoke
  canvas/list-with-segments
  sigil/state

Level 2: workflows
  verify-sigil-avatar-after-display-change
  diagnose-canvas-not-clickable
  capture-and-inspect-display-surface

Level 3: app-specific arrangements
  Sigil control panel
  canvas inspector
  log console
```

A molecule is a small reusable operational unit around one concept. A workflow
coordinates multiple molecules and may branch based on observations. An app
arrangement is a bespoke top-level composition for a product surface.

This means a `sigil/state` molecule can exist, but it should not be hidden
inside Sigil UI code. It is an app-scoped operator recipe stored in the source
registry, comparable to how toolkit components can be generic while still being
composed by apps.

## First-Class Meaning

“First-class” means discoverable, inspectable, dry-runnable, executable, and
testable through AOS itself. It does not mean lower-level than primitives.

Expected affordances:

```bash
./aos ops list
./aos ops explain canvas/window-level-smoke
./aos ops dry-run canvas/window-level-smoke --json
./aos ops run canvas/window-level-smoke --json
```

`ops search` is useful, but it should be post-v1. The first slice should prove
exact-ID discovery, explanation, dry-run, and execution contracts before adding
fuzzy lookup or symptom routing.

The `explain` path should show the primitive commands, why they are ordered
that way, what mutates state, what resources are owned by the run, what cleanup
is registered, and what output predicates count as success.

## Dry-Run Semantics

V1 `ops dry-run` should be static expansion and validation. It must not execute
recipe steps, start daemons, create canvases, run `show update`, or perform
runtime observation on the user's behalf.

Static dry-run should:

- parse and schema-validate the recipe
- resolve generated run IDs, declared resources, literal args, and explicit
  user-provided inputs
- verify that each command reference exists in the command registry
- classify each step as read-only or mutating from registry metadata plus recipe
  declarations
- validate timeouts, cleanup ownership, JSON-path assertions, and output schema
  references
- return the exact planned step list with `would_run`, `mutates`, and
  `supports_delegate_dry_run` fields

The engine may delegate to an underlying command form only when that form
explicitly advertises `supports_dry_run=true`. Forms such as `show-create` and
`show-update` currently do not, so the dry-run engine can explain that they
would run but must not call them.

If expansion needs live state that was not provided as input, dry-run should
fail with a stable code such as `DRY_RUN_UNRESOLVED_INPUT`. A later
`ops dry-run --observe` mode can be considered for read-only probes, but v1
should keep dry-run side-effect free.

## Wiki Invoke Distinction

The new layer must not inherit the current `wiki invoke` ambiguity. `aos wiki
invoke` is an instruction-bundle surface: it prints or returns a skill/workflow
document that an agent may follow. It does not execute the workflow. The help
registry may be read-only for `wiki invoke`, while the instructions it returns
can describe mutating behavior.

`aos ops run` should be the opposite: AOS executes a declared recipe and reports
step results. Source-backed ops recipes are executable contracts. Wiki workflow
plugins remain useful for user-owned or exploratory instruction bundles, but
they are not a substitute for repo-owned operator recipes.

The existing wiki seed workflow `self-check` should be audited separately
because it starts with older guidance (`doctor`, service start) rather than the
current repo loop (`ready`, then `ready --repair`).

## Molecule Shape

Source-backed recipes should be declarative where possible and script-backed
only when needed. Shell strings are not sufficient for truthful dry-run or
explain because they hide argument interpolation, mutation classification,
timeouts, output schemas, cleanup, and resource ownership.

Prefer structured steps keyed to fully qualified command-registry form
references. Do not rely on bare form IDs being globally unique; the registry
models command paths and invocation forms separately.

```json
{
  "id": "canvas/window-level-smoke",
  "version": 1,
  "summary": "Verify canvas window_level create/update/list semantics.",
  "scope": "source",
  "mutates": true,
  "requires": ["show"],
  "docs": "wiki://aos/operations/canvas-window-level",
  "resources": {
    "canvas_id": "ops-${run_id}-window-level"
  },
  "steps": [
    {
      "id": "create-screen-saver-canvas",
      "command": {
        "path": ["show"],
        "form_id": "show-create"
      },
      "argv": [
        "--id", "${resources.canvas_id}",
        "--at", "20,20,40,40",
        "--window-level", "screen_saver",
        "--ttl", "60s",
        "--html", "<body></body>"
      ],
      "timeout_ms": 5000,
      "mutates": true
    },
    {
      "id": "assert-created-level",
      "command": {
        "path": ["show"],
        "form_id": "show-list"
      },
      "assertions": [
        {
          "json_path": "$.canvases[?(@.id == '${resources.canvas_id}')].windowLevel",
          "equals": "screen_saver"
        }
      ],
      "timeout_ms": 3000
    },
    {
      "id": "update-status-bar-level",
      "command": {
        "path": ["show"],
        "form_id": "show-update"
      },
      "argv": [
        "--id", "${resources.canvas_id}",
        "--window-level", "status_bar"
      ],
      "timeout_ms": 5000,
      "mutates": true
    },
    {
      "id": "cleanup",
      "command": {
        "path": ["show"],
        "form_id": "show-remove"
      },
      "argv": ["--id", "${resources.canvas_id}"],
      "finally": true,
      "mutates": true
    }
  ]
}
```

Script-backed helpers should be allowed only as named helpers with explicit
input and output contracts:

```json
{
  "helper": "json-path-assert",
  "input_schema": "shared/schemas/ops-json-path-assert-input.schema.json",
  "output_schema": "shared/schemas/ops-step-result.schema.json"
}
```

## Output Schema

`--json` needs a stable schema before executable recipes ship. At minimum:

```json
{
  "status": "success|failure|partial|dry_run",
  "code": "OK|DRY_RUN_UNRESOLVED_INPUT|ASSERTION_FAILED|COMMAND_FAILED|CLEANUP_FAILED|TIMEOUT|INVALID_RECIPE",
  "error": null,
  "recipe": {
    "id": "canvas/window-level-smoke",
    "version": 1
  },
  "mode": "repo",
  "dry_run": false,
  "started_at": "2026-04-26T00:00:00Z",
  "finished_at": "2026-04-26T00:00:01Z",
  "mutated_resources": [
    {
      "type": "canvas",
      "id": "ops-abc-window-level",
      "owned_by_run": true,
      "cleanup": "removed"
    }
  ],
  "steps": [
    {
      "id": "create-screen-saver-canvas",
      "status": "success",
      "command": {
        "path": ["show"],
        "form_id": "show-create"
      },
      "mutates": true,
      "supports_delegate_dry_run": false,
      "duration_ms": 120,
      "observed": {}
    }
  ],
  "cleanup": {
    "status": "success",
    "steps": []
  }
}
```

Failure codes must be stable enough for agents to branch on them.

## Process Contract

All `ops --json` commands should follow the global `aos` process contract:
machine-readable success is emitted on stdout with exit code 0, and
machine-readable failure is emitted on stderr with a non-zero exit code.
Incidental logs must not be mixed into the JSON stream.

For `ops explain` and static `ops dry-run`, exit 0 means the recipe was found,
expanded, and validated. `dry_run` is a successful status when no side effects
were performed and no unresolved inputs or invalid contracts remain.

For `ops run`, exit 0 means every required step succeeded, every assertion
passed, and cleanup either succeeded or was not needed. `failure` exits non-zero
when a step, assertion, timeout, command, or recipe validation fails. `partial`
exits non-zero when AOS cannot prove the run was fully cleaned up, especially
when primary steps succeeded but cleanup failed. `CLEANUP_FAILED` is therefore
an exit-1 condition even if the behavioral smoke passed.

The same result schema should be used on stdout for success and stderr for
failure. Failure and partial results should populate `error` with a concise
human-readable message and expose stable `code` values such as
`INVALID_RECIPE`, `DRY_RUN_UNRESOLVED_INPUT`, `ASSERTION_FAILED`,
`COMMAND_FAILED`, `TIMEOUT`, and `CLEANUP_FAILED`.

## Storage And Namespaces

Source-backed recipes should be discoverable from source-owned locations:

```text
recipes/                         # repo-wide ops recipes
packages/toolkit/recipes/         # toolkit-owned recipes
apps/<app>/recipes/               # app-owned recipes
```

Recipe IDs are namespace paths:

```text
runtime/status-snapshot
canvas/window-level-smoke
toolkit/desktop-world-surface-smoke
sigil/state
sigil/avatar-hit-smoke
```

Discovery should preserve ownership metadata:

```json
{
  "id": "sigil/state",
  "owner": "apps/sigil",
  "path": "apps/sigil/recipes/state.json",
  "source_kind": "app"
}
```

Repo mode uses working-tree source recipes. Installed mode must not depend on a
checkout; packaged AOS should include a generated recipe index built from
`recipes/`, `packages/toolkit/recipes/`, and `apps/<app>/recipes/` at package
time. That index should preserve recipe ID, version, owner, source path,
source kind, and the AOS build/package version that carried it.

Discovery order and namespace ownership should be explicit:

1. repo-wide recipes under `recipes/`
2. toolkit-owned recipes under their `toolkit/` namespace
3. app-owned recipes under their app namespace, such as `sigil/`
4. user-owned wiki workflow plugins, listed separately and never allowed to
   shadow a source-backed ops recipe without an explicit future override model

In repo mode, the first three classes come from the working tree. In installed
mode, the first three classes come from the packaged recipe index.

Duplicate source-backed recipe IDs should be a validation error. User-owned
wiki workflow plugins remain runtime-mode isolated under
`~/.config/aos/{mode}/wiki/` and should be reported as instruction bundles, not
source-backed executable ops recipes.

The first implementation should include both repo-mode discovery tests and an
installed-mode packaging/discovery test that proves packaged recipes are visible
without reading the source checkout.

## Ownership And Cleanup

Mutating recipes must declare resources they create and how cleanup works.

Requirements:

- generated IDs include a run/session prefix
- TTLs are used for temporary canvases where possible
- every mutating step declares ownership metadata
- cleanup steps only remove resources owned by the run
- cleanup runs on normal failure and interruption where the process can catch it
- stale-resource cleanup can search by owned prefix rather than broad patterns

A `finally` flag is not enough by itself. It is only one part of an ownership
contract.

## Workflow Shape

Workflows are larger than molecules and can branch. They should use molecules as
building blocks instead of duplicating shell logic.

Example: `diagnose-canvas-not-clickable`

```text
1. runtime/status-snapshot
2. canvas/list-with-segments
3. inspect target canvas interactive/window_level/suspended/parent
4. if visual surface and hit surface are separate, inspect both
5. if hit surface is below menu bar, run canvas/window-level-update
6. run app-specific smoke if available
```

This is where AOS starts brushing against the SDK future: workflows should be
portable across CLI, host SDK, gateway, and provider surfaces, while still
grounded in the same primitive verb contracts.

## Source vs Wiki Boundary

Use source for canonical behavior. Use wiki for situational understanding.

Put in source:

- molecule and workflow manifests
- scripts or helpers that execute or assert behavior
- command schemas and expected JSON fields
- test fixtures
- app-owned recipes that must evolve with app code
- toolkit/API docs tied to exported interfaces
- CI-covered examples

Put in wiki:

- design rationale
- operating playbooks
- session learnings
- tradeoffs and pitfalls
- incident notes
- exploratory plans before they become contracts
- human-readable context linked from source manifests

Useful rule:

```text
Source holds the roads. Wiki explains the map.
```

Executable repo contracts should not live only in the wiki because they will
rot. Source-backed manifests may link to wiki context with `docs` references.

## Help And Diagnosis Ergonomics

Keep `aos help` static. Today help is command introspection; silently probing
runtime state from help would blur that contract.

Add a separate runtime-aware diagnosis surface instead:

```bash
./aos diagnose input_tap_not_active
./aos diagnose canvas_not_clickable
./aos diagnose recipe canvas/window-level-smoke
```

`aos diagnose` should be post-v1. The first `ops` PR may reserve the concept in
docs, but it should not introduce a hidden or partial `diagnose` command. When
diagnosis is implemented, it needs the same command-registry, API docs, and
architecture updates as `ops`.

Runtime-aware diagnosis must not silently start daemons, repair permissions, or
mutate state. Output should label its evidence source: command registry, daemon
snapshot, `show list`, filesystem, or schema.

Static help can still point to related recipes:

```bash
./aos help show create
# Related ops recipes:
#   canvas/create-update-remove-smoke
#   canvas/window-level-smoke
```

## Registry Drift

The command registry is useful, but it must not be blindly trusted for mutation
safety until drift tests exist. There is already known drift: the registry says
`show create --scope` defaults to `connection`, while the daemon default is
currently `global`.

Before an ops engine relies on registry metadata for safety or dry-run, add
registry-vs-implementation tests for the forms used by v1 recipes.

## Initial Molecule Candidates

V1 should avoid Git/GitHub-affecting recipes. Those cross into user-visible
history and issue state and need explicit confirmation, dirty-tree evidence,
no-attribution checks, and dry-run review before they become executable.

Runtime:

- `runtime/status-snapshot` (read-only first slice)
- `runtime/ready`
- `runtime/ready-repair`
- `runtime/permission-handoff`

Canvas:

- `canvas/list`
- `canvas/list-with-segments`
- `canvas/window-level-smoke`
- `canvas/create-update-remove-smoke`
- `canvas/capture-surface`

DesktopWorld:

- `desktop-world/topology-snapshot`
- `desktop-world/segment-lifecycle-smoke`

Sigil:

- `sigil/state`
- `sigil/avatar-hit-smoke`
- `sigil/menu-open-smoke`
- `sigil/fast-travel-smoke`

Future, gated:

- `work/dirty-tree-summary`
- `work/checkpoint`
- `work/issue-close-with-commit`

## Risks

- Too much abstraction could obscure primitive verbs. Mitigation: `explain` and
  `dry-run` are mandatory.
- Ops recipes could become another stale script directory. Mitigation: source
  manifests plus tests for high-value recipes.
- Wiki workflows and source recipes could overlap confusingly. Mitigation:
  document ownership: source-backed for repo/operator contracts, wiki-backed for
  user-owned and exploratory instruction bundles.
- A premature DSL could slow progress. Mitigation: start with fully qualified
  command-registry refs, argv arrays, JSON assertions, and named helpers only
  where needed.
- State-gathering diagnosis could mutate accidentally. Mitigation: keep
  diagnosis read-only and separate from `help`.

## Recommended First Slice

Create an epic for “Agent Control Surface Molecules and Workflows.” This is
larger than a docs cleanup because it affects command discovery, executable
operator recipes, help ergonomics, wiki/source boundaries, and the future SDK
shape.

The first implementation pass should be intentionally small:

1. Choose `aos ops` as the proposed public command group and update command
   registry/docs/API references in the same PR.
2. Add source-backed recipe discovery with `ops list`, `ops explain`, and
   static, side-effect-free `ops dry-run`. Do not include `ops search` in v1.
3. Define the JSON output schema and process contract for dry-run/run step
   results, including stdout/stderr and exit-code behavior.
4. Implement `ops run` for one executable read-only recipe:
   `runtime/status-snapshot`.
5. Add repo-mode and installed-mode recipe discovery tests.
6. Add registry-vs-implementation drift tests for forms used by recipes.
7. Add one mutating canvas smoke only after ownership, TTL, timeout, cleanup,
   and dry-run contracts are in place.

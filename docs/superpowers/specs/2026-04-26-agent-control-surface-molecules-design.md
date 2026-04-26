# Agent Control Surface Molecules — Design Memo

This is option-space framing, not an implementation plan. The goal is to capture
session learnings about how agents operate AOS effectively, then turn those
learnings into reusable control-surface primitives that less capable agents can
discover and execute.

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
5. Commit a reversible checkpoint and update GitHub issues.

That loop should be teachable and executable, not dependent on agent intuition.

## Proposed Stack

The control surface should layer like the product architecture:

```text
Level 0: AOS verbs / primitives
  see, do, show, tell, listen, wiki, status, ready

Level 1: molecules / recipes
  runtime/ready-repair
  canvas/window-level-smoke
  canvas/list-with-segments
  sigil/state
  sigil/avatar-hit-smoke

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
inside Sigil UI code. It is an app-scoped operator recipe stored in a shared
registry, comparable to how toolkit components can be generic while still being
composed by apps.

## First-Class Meaning

“First-class” means discoverable, inspectable, dry-runnable, executable, and
testable through AOS itself. It does not mean lower-level than primitives.

Expected affordances:

```bash
./aos run <id>
./aos run <id> --dry-run
./aos run <id> --json
./aos run <id> --explain
./aos run list
./aos run search canvas
```

Examples:

```bash
./aos run runtime/ready-repair --explain
./aos run canvas/window-level-smoke --dry-run
./aos run sigil/avatar-hit-smoke
```

The `--explain` path should show the primitive commands, why they are ordered
that way, what mutates state, and what output predicates count as success.

## Molecule Shape

A source-backed molecule should be declarative where possible and script-backed
only when needed.

```json
{
  "id": "canvas/window-level-smoke",
  "summary": "Verify canvas window_level create/update/list semantics.",
  "scope": "source",
  "mutates": true,
  "requires": ["show"],
  "docs": "wiki://aos/operations/canvas-window-level",
  "steps": [
    {
      "run": "./aos show create --id ${tmp_id} --at 20,20,40,40 --window-level screen_saver --html '<body></body>'"
    },
    {
      "assert": "show.list canvas ${tmp_id}.windowLevel == 'screen_saver'"
    },
    {
      "run": "./aos show update --id ${tmp_id} --window-level status_bar"
    },
    {
      "assert": "show.list canvas ${tmp_id}.windowLevel == 'status_bar'"
    },
    {
      "run": "./aos show remove --id ${tmp_id}",
      "finally": true
    }
  ]
}
```

This is intentionally close to the way agents already reason: command, observe,
assert, cleanup. The registry can start simple and grow toward SDK-backed
structured calls later.

## Workflow Shape

Workflows are larger than molecules and can branch. They should use molecules as
building blocks instead of duplicating shell logic.

Example: `diagnose-canvas-not-clickable`

```text
1. runtime/ready-repair
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
- scripts that execute or assert behavior
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

Executable workflows should not live only in the wiki because they will rot.
Wiki workflow plugins can continue to exist for user-owned or exploratory
extensions, but source-backed molecules should be the canonical operator layer
for repo behavior.

## Help Ergonomics

The help tree should support agents that start from symptoms rather than known
commands.

Proposed additions:

```bash
./aos help next
./aos help diagnose input_tap_not_active
./aos help diagnose canvas_not_clickable
./aos help recipe verify-canvas
```

Good help output should include:

- current runtime state when safe to gather
- likely cause
- next safe command
- mutation/read-only markers
- related molecules/workflows
- source and wiki references

This turns command discovery into an operational control surface instead of a
static dictionary.

## Initial Molecule Candidates

Runtime:

- `runtime/ready`
- `runtime/ready-repair`
- `runtime/status-snapshot`
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

GitHub / work hygiene:

- `work/checkpoint`
- `work/issue-close-with-commit`
- `work/dirty-tree-summary`

## Risks

- Too much abstraction could obscure the primitive verbs. Mitigation:
  `--explain` and `--dry-run` must be mandatory design requirements.
- Molecules could become another stale script directory. Mitigation: source
  manifests plus tests for high-value molecules.
- Wiki workflows and source molecules could overlap confusingly. Mitigation:
  document ownership: source-backed for repo/operator contracts, wiki-backed for
  user-owned and exploratory workflows.
- A premature DSL could slow progress. Mitigation: start with a small manifest
  and allow shell-backed steps where structured verbs are not ready.

## Recommendation

Create an epic for “Agent Control Surface Molecules and Workflows.” This is
larger than a docs cleanup because it affects command discovery, executable
operator recipes, help ergonomics, wiki/source boundaries, and the future SDK
shape.

The first implementation pass should be intentionally small:

1. Document the Agent Operating Loop in repo docs.
2. Add a source-backed molecule registry with `list`, `explain`, and `dry-run`.
3. Implement two runtime molecules and one canvas smoke molecule.
4. Link molecules to wiki context without storing executable contracts only in
   wiki.
5. Add symptom-oriented help that can point to molecules.


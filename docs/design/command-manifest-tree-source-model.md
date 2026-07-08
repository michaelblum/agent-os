# Command Manifest Source Model: Flat Fragments vs. Tree + Build Step

**Status:** Draft for discussion
**Author:** Analysis prepared for contributors
**Scope:** `manifests/commands/source/{aos,external}/*.json` and the two generated
compatibility artifacts, `manifests/commands/aos-commands.json` and
`manifests/commands/aos-external-commands.json`.

This doc is an analysis of the current command manifest system and a proposal
to evaluate before any refactor. It does not change any code or schema.

---

## 1. Why this matters: AOS is agent-first

AOS is designed to feel [Playwright-like](https://github.com/michaelblum/agent-os/blob/main/docs/api/aos-capabilities.md)
for agents: "short direct commands, stable JSON/help contracts, clear
capability groupings, strong examples, bounded side-effect metadata, useful
errors, and composable workflows" ([`docs/dev/command-surface.md`](https://github.com/michaelblum/agent-os/blob/main/docs/dev/command-surface.md)).
An archived design doc frames the whole command registry effort as solving
"Agent-First CLI Introspection," explicitly rejecting the earlier state where
agents had to read hundreds of lines of static docs or guess-and-fail their
way to a valid invocation ([`docs/archive/superpowers/specs/2026-04-15-command-registry-design.md`](https://github.com/michaelblum/agent-os/blob/main/docs/archive/superpowers/specs/2026-04-15-command-registry-design.md)).

That framing raises the stakes on this question: the generated manifest JSON
is not an internal implementation detail, it is the product surface agents
consume directly via `./aos help --json`. Redundancy or drift in the source
manifests isn't just messy authoring — it's a risk to the exact contract the
system is designed around.

The codebase delivers on parts of this goal today (stable `--json` output,
per-form `execution`/`output` safety metadata, dry-run support, rich
`examples[]`) but falls short in ways directly relevant to this proposal:

- **Capability groupings** are called out as agent-facing value, but
  `capability_group` does not exist as a manifest field anywhere. It's only
  computed by ~50 lines of hardcoded `if (top === 'do' && [...])`-style logic
  inside [`scripts/generate-command-inventory.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/generate-command-inventory.mjs),
  and only feeds a Markdown audit report — agents calling `--json` never see it.
- **`post_action.recommended_next_command`**, the mechanism meant to make
  workflows composable for agents, only appears as free text inside `summary`
  strings (e.g. "...returns post_action.recommended_next_command for
  recapture with aos see capture --save...", [`aos-commands.json`](https://github.com/michaelblum/agent-os/blob/main/manifests/commands/aos-commands.json)),
  not as a structured field an agent can read without string-matching prose.
- **Namespace navigation** ("show me everything under `do`") is served by a
  hand-rolled ancestor-walk-and-filter-by-id-prefix fallback in
  [`scripts/aos-help-proxy.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/aos-help-proxy.mjs)
  rather than a clean tree traversal.

## 2. Current state

### 2.1 What exists today

The system already has two layers, not one flat file:

1. **Source fragments** — hand-authored, one file per command family:
   `manifests/commands/source/aos/*.json` (50 files) and
   `manifests/commands/source/external/*.json` (46 files). `aos/` fragments
   declare a `path_prefix` that the generator enforces; fragments may be split
   across multiple files that "merge" into one logical command if their
   non-`forms` metadata matches exactly.
2. **Generated compatibility artifacts** — produced by
   [`scripts/generate-command-manifests.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/generate-command-manifests.mjs)
   and checked into git:
   - `manifests/commands/aos-commands.json` — the registry/help manifest: 43
     top-level commands, 209 forms, 12,616 lines.
   - `manifests/commands/aos-external-commands.json` — the CLI routing table:
     242 route entries, 2,933 lines.

Both are documented as stable, override-able paths
(`AOS_COMMAND_REGISTRY` / `AOS_EXTERNAL_COMMAND_MANIFEST`) that runtime and
help consumers depend on ([`manifests/AGENTS.md`](https://github.com/michaelblum/agent-os/blob/main/manifests/AGENTS.md)).

### 2.2 How a command is represented

Every entry — in source fragments and in generated output — repeats a full
`path: [string, ...]` array and a `summary`, plus either:
- **Registry commands:** `forms[]`, each with `id`, `usage`, `args[]`,
  `execution{...}`, `output{...}`, `examples[]`.
- **External routes:** `executable`, `argv_prefix`, `cwd`, `env`, optional
  `when`.

Nothing is inherited. Every node stores a full copy of shared metadata.

### 2.3 Redundancy and implicit hierarchy

- **Grouping already exists but isn't structural.** Source files are
  one-per-family (e.g. `02-experience.json`, `07-do-05-script-session.json`),
  and `aos/` fragments even declare a `path_prefix` — but every command
  inside a file still repeats the *entire* path array rather than a relative
  suffix under that prefix.
- **`path[0]` grouping is heavily reused.** In the external manifest, `do`
  (47 routes), `see` (26), `work-record` (24), `show` (16), and `wiki` (15)
  are the largest families. Two-segment prefixes like `see/annotation` (7
  routes) or `work-record/repair` (6 routes) repeat the same two path tokens
  on every entry.
- **`env` / `cwd` / `executable` are near-constant.** `cwd` is `"repo"` on
  all 242 external commands; `executable` is `/usr/bin/env` on 235/242; only
  14 distinct `env` blocks exist, and one exact object
  (`{AOS_PATH, AOS_RUNTIME_MODE, AOS_STATE_ROOT}`) is repeated verbatim 114
  times.
- **`argv_prefix` grows by a single appended token.** `scripts/aos-work-record.mjs`
  is the fixed prefix for 24 routes, `scripts/aos-do-native.mjs` for 23 —
  each route just appends one more argument.
- **`execution` / `output` are low-cardinality enums, copy-pasted per form.**
  209 forms use only 28 distinct `execution` blocks and 6 distinct `output`
  blocks.
- **Two fields are ~97–99% mechanically derivable but stored explicitly:**
  `execution.supports_dry_run` matches "form has a `--dry-run` arg" in
  207/209 forms (2 genuine exceptions); `output.supports_json_flag` matches
  "form has a `--json` arg" in 203/209 forms (6 exceptions).
- **The same summary text is duplicated across the two source trees.** e.g.
  "Activate and inspect source-owned AOS experience layers" appears
  near-verbatim in both `source/aos/02-experience.json` and
  `source/external/24-experience.json`.

## 3. Consumers and access patterns

| Consumer | What it does |
|---|---|
| [`src/shared/external-command-dispatch.swift`](https://github.com/michaelblum/agent-os/blob/main/src/shared/external-command-dispatch.swift) | Runtime CLI dispatcher. Loads `aos-external-commands.json`, `.filter()`s for path-prefix + `when`-condition matches, picks the longest match. |
| [`scripts/aos-help-proxy.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/aos-help-proxy.mjs) | `./aos help` implementation. Exact-path lookup, then a manual ancestor-walk fallback filtering forms by id prefix; groups commands by `path[0]` for rendered help; synthesizes a virtual `recipe` command as a copy-with-rename of `ops`; filters `consumer_discovery === false` commands out of the public registry. |
| [`scripts/lib/external-command-routes.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/lib/external-command-routes.mjs) | Shared `when`-condition matcher reused by the generator, dispatcher validation, and help proxy. |
| [`scripts/generate-command-inventory.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/generate-command-inventory.mjs) | Builds the capability-inventory Markdown report; re-derives a capability group per command via hardcoded rules keyed on `path[0]`/`path[1]`/form id. |
| [`scripts/lib/aos-skills/command-shape.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/lib/aos-skills/command-shape.mjs) + `eval.mjs` | Skills evaluation. Flattens `commands[].forms[]`, then does longest-prefix matching — but derives the prefix by **re-parsing `form.usage` text**, not by reading `command.path`. |
| [`scripts/aos-dev-workflow.mjs`](https://github.com/michaelblum/agent-os/blob/main/scripts/aos-dev-workflow.mjs) | Self-audit tool. Exact-path lookup (`command.path.join(' ') === 'dev'`), builds a `Map` of forms by id to check flags/defaults. |
| Tests (`tests/recipe-ref-postcondition-contract.test.mjs`, `tests/agent-workspace-contract-drift.sh`, `tests/command-manifest-generation.sh`, `tests/external-command-dispatch.sh`, `tests/schemas/aos-external-command-manifest-v0.test.mjs`) | Parse generated JSON directly, mostly via the same exact-path-join lookup, to assert contract/drift/schema invariants. |

**Distinct access patterns:**
1. Exact lookup by full path (`command.path.join(' ') === X`) — the most
   common pattern, used everywhere.
2. Longest-prefix match with a "pick deepest" tie-break — dispatcher,
   help-proxy fallback, help-passthrough routing, skills-eval matching.
3. Group-by-namespace (`path[0]`, sometimes `path[1]`) — help rendering,
   capability-inventory classification.
4. Lookup by form/route id — dev-workflow auditing, generator's duplicate-id
   validation.
5. Flatten-then-scan-and-filter by metadata (`consumer_discovery`,
   `help_passthrough`, `mutates_state`) — public-registry filtering,
   inventory report columns.
6. Alias/derive-one-branch-from-another at runtime — `recipe` synthesized
   from `ops` inside the help proxy.

**Special cases:** `consumer_discovery: false` is a "hidden but still
directly addressable" override (used for `dev`); duplicate external paths are
allowed only when disambiguated by a `when` predicate (e.g. browser-vs-native
`do click`); `aos/` fragments may be split across files and merged if
non-`forms` metadata matches exactly, enforced today by hashing/comparing
JSON blobs.

## 4. Options

### Option A — Keep current flat/fragment manifests (minor cleanup only)
- ✅ Simple, zero indirection, easy to `grep`, generator already validates
  and byte-stabilizes output.
- ❌ Every path, `env`/`cwd` combo, and derivable flag is copy-pasted.
- ❌ Hierarchy is encoded twice (structured `path` and free-text `usage`),
  and they can drift (`command-shape.mjs` already re-parses `usage` instead
  of trusting `path`).
- ❌ Capability grouping lives in a separate, hand-maintained classifier
  script instead of being authored once and exposed to agents.

### Option B — Tree-shaped source + build-time projections (recommended)
- ✅ Shared prefixes, `env`/`cwd`/`executable`, and derivable fields
  (`supports_dry_run`, `supports_json_flag`) get authored once and
  inherited/computed, removing the ~97–99% redundant fields found above.
- ✅ Namespace grouping becomes structural instead of re-parsed; a
  `capability_group` (and eventually a structured `recommended_next_command`)
  can be authored once per subtree and projected into agent-facing JSON.
- ✅ Still emits the same flat, checked-in `aos-commands.json` /
  `aos-external-commands.json` that the Swift dispatcher, tests, and the
  `AOS_COMMAND_REGISTRY` / `AOS_EXTERNAL_COMMAND_MANIFEST` overrides already
  depend on — **no consumer code changes required**.
- ❌ Requires writing an inheritance/override resolver and migrating ~96
  fragment files once.

### Option C — Tree + runtime service layer (`getCommandByPath`, `getCommandsUnder`, etc.)
- ❌ Not supported by the consumers found. Every real consumer either scans a
  flat array or does an exact/longest-prefix match against an already-fully-
  resolved path; none need live inheritance resolution, cross-branch queries,
  or runtime mutation.
- ❌ The Swift dispatcher reads a JSON file at a stable path — it cannot
  consume a JS/TS runtime service, so a service layer would sit alongside the
  generated files rather than replacing them, adding indirection without
  removing any existing code path.

## 5. Recommendation

**Adopt Option B: tree-shaped source + build-time projections. Do not add a
runtime service layer.**

The Swift dispatcher hard-requires a flat JSON file at a stable,
env-overridable path, so any tree must still terminate in the two existing
generated artifacts — this alone rules out a runtime-service replacement for
the generator. But three consumers are already manually reimplementing tree
traversal, inheritance, or classification *against* the flat structure:

- `aos-help-proxy.mjs`'s ancestor-walk fallback and its `recipe`-from-`ops`
  alias synthesis,
- `generate-command-inventory.mjs`'s hand-coded `path[0]`/`path[1]`
  classification into capability groups,
- `command-shape.mjs`'s usage-text re-parsing to recover a path prefix that
  already exists as structured data.

Moving those concerns into an authored tree plus a smarter build step —
resolving inheritance, computing derivable fields, and promoting
`capability_group` (and ideally a structured `recommended_next_command`) from
ad hoc/prose to real inherited tree attributes — lets each of those three
scripts get simpler and more correct, directly improves the agent-facing
JSON contract the project is designed around, and requires zero changes to
every other consumer, which keeps working unmodified against the same
generated files.

## 6. Suggested next steps (not yet designed)

1. Draft a tree schema for `manifests/commands/source/` that expresses
   relative path segments, inheritable defaults (`env`, `cwd`, `executable`,
   `capability_group`), and per-node overrides.
2. Extend the generator to resolve inheritance, derive `supports_dry_run` /
   `supports_json_flag` from arg presence (with an explicit override escape
   hatch for the small number of real exceptions), and emit `capability_group`
   into the generated JSON.
3. Evaluate promoting `post_action.recommended_next_command` from prose to a
   structured field once the tree makes per-branch metadata cheap to author.
4. Migrate the 96 existing fragment files incrementally, verifying
   byte-for-byte (or intentionally-diffed) output against the current
   generated artifacts at each step via `node scripts/generate-command-manifests.mjs --check`.

# AOS Command Surface

The repo-mode `./aos` binary is a stable TCC capability broker, not the source
of truth for public command behavior. Its command entry point must stay limited
to stable infrastructure:

- loading `manifests/commands/aos-external-commands.json`;
- dispatching matching public command paths to external scripts;
- native bootstrap and TCC-sensitive primitives behind private `__...` routes;
- daemon socket, service, and native input/perception/display/communication
  primitives that cannot live in a hot-swappable script.

Public command behavior, help metadata, argument shape, workflow policy,
recovery policy, next actions, and presentation text belong outside the Swift
binary:

- `manifests/commands/source/aos/*.json` are the authoring source for
  discoverable help metadata and command forms;
- `manifests/commands/source/external/*.json` are the authoring source for
  external command route metadata;
- `manifests/commands/aos-commands.json` is the generated discoverable external
  help manifest and command metadata compatibility artifact;
- `manifests/commands/aos-external-commands.json` is the generated compatibility
  artifact that maps public command paths to external implementations;
- `scripts/aos-*.mjs`, Python helpers, shell wrappers, packages, and recipes
  contain command implementation logic and public workflow composition;
- `docs/dev/workflow-rules.json` tells agents which checks to run after command
  metadata, external-route manifest, implementation, schema, or test changes.

Registry source file `id` values name an authoring slice, not necessarily a
public command family. Each registry source file declares a `path_prefix`, and
every command fragment in that file must stay under that prefix. Multiple
source files may contribute forms to the same public command path when their
non-form metadata matches; the generator merges those fragments in source-file
order. Split large command families by real subdomain instead of growing a
single top-level family file.

Edit command source files first, then run:

```bash
node scripts/generate-command-manifests.mjs
```

The generator validates source shape, registry prefix ownership, mergeable
command fragments, duplicate form IDs, external route shape, duplicate route
predicates, representative route overlap, and registry-to-route coverage before
writing the two generated artifacts. Keep the generated top-level files checked
in because runtime dispatch and help still load those stable paths, and because
`AOS_COMMAND_REGISTRY` /
`AOS_EXTERNAL_COMMAND_MANIFEST` override those artifact paths directly.

The full command/capability inventory is generated from those manifests at
`docs/dev/reports/aos-command-capability-inventory-v0.md`. Refresh it with:

```bash
node scripts/generate-command-inventory.mjs
```

That report is a development audit artifact, not a consumer API contract. It
records command paths, concrete forms, source manifests, external
implementations, consumer discovery, mutability, JSON output, dry-run support,
and proposed capability groups for public CLI and self-hosting boundary
decisions.

Registry metadata must distinguish direct maintainability from consumer
discovery. A command with `consumer_discovery: false` remains addressable by
direct help paths such as `./aos help dev --json`, but root help and the full
consumer JSON registry filter it out. This keeps maintainer routes reachable
without advertising them as the normal agent API.

## Public CLI And Self-Hosting

`aos dev` is a maintainer-only workflow router for this repository. It owns
repo-local classification, recommendation, situation, drift lint, build, audit,
developer capability, and GitHub workflow helpers. It is intentionally hidden
from root consumer help through `consumer_discovery: false`, but direct help
must keep resolving so local maintainers can inspect the exact command forms.

AOS should feel Playwright-like through ergonomics: short direct commands,
stable JSON/help contracts, clear capability groupings, strong examples,
bounded side-effect metadata, useful errors, and composable workflows. Do not
mirror another CLI's command names just because its capability model is the
reference point.

The public observe-act workflow should make the next step visible without
agents reading historical design notes: `ready/status -> see capture --save ->
see refs -> do --dry-run/action -> see capture --save -> see refs --diff
--expect` is the canonical loop. Saved-ref actions should keep returning
`post_action.recommended_next_command` for the fresh recapture when they cannot
safely return post-action state themselves.

Longer term, `aos dev` should be treated as self-hosting plumbing, not durable
product API. If a workflow moves out of `aos dev`, make the destination
explicit: either repo-local maintainer tooling outside the public `aos` tree or
a real public command with source manifests, external routes, docs, tests, and
compatibility policy.

When a form's output changes under a flag, record that in
`output.conditional_modes` instead of relying on prose or sibling-form
inference. Each entry must name declared `when_flags`, the conditional
`default_mode`, and a summary. Rendered text help should show the conditional
mode, for example `[output: none; with --save: json]`. If a mostly read-only
form mutates state only under specific flags, set `execution.mutates_when_flags`
so rendered help can show the conditional mutation surface.

The broker may expose privileged facts, privileged actions, and privileged
streams through private stable primitives. External layers interpret and compose
those primitives into public command behavior. See
`docs/adr/0015-aos-tcc-capability-broker-boundary.md`.

## Agent Ergonomics Over Instruction Accretion

When agents spend many tool calls on routine or procedural work and the work is
not converging, treat that friction as product evidence about the developer
surface. Do not first add more role-specific instruction stacks, copied
checklists, or persona-local exceptions. Persistent agent thrash usually means
something deserves examination: a command shape, help text, error message,
workflow route, state model, recovery path, test fixture, documentation
boundary, or missing edge-case contract.

The response is not always to mutate command logic. The right fix might be
stronger error handling, clearer help, a narrower command, a more complete AOS
wrapper, a workflow-rule adjustment, a test that captures a common edge case, a
docs relocation, or deletion of stale guidance. The key rule is to improve the
surface or capture the friction for analysis instead of spreading more
interpretive burden across persona instructions.

This applies especially when an agent reaches for raw shell glue, provider
connectors, direct APIs, repeated retries, duplicated instructions, or
manual state spelunking during work that should be ordinary and repeatable.

If the appropriate fix is clear, local, and low risk, make that fix at the
surface that owns the behavior and add regression coverage. If the fix is not
clear, capture a short agent-UX friction note instead of expanding the
instruction stack:

```text
Agent UX friction:
AOS surface or workflow: <command/API/tool/workflow/doc boundary>
Task: <what the agent was trying to do>
Friction: <error, ambiguity, repeated retries, missing edge case, or awkward step>
Tempting workaround: <bypass, duplicated instruction, or manual procedure considered>
Candidate follow-up: <surface, workflow, docs, tests, or analysis improvement to evaluate>
```

Friction notes can live in the current work report, a follow-up issue, or a
small dev report under `docs/dev/reports/` when the pattern needs durable
analysis. They should not be copied into persona instructions unless the issue
is actually authority or a stop condition.

## Dispatcher Contract

External routes match the longest public path first. Duplicate public paths are
allowed only when every duplicate route has a `when` condition and the
conditions select distinct cases. Current examples include browser-vs-native
`do click` routing and `see` help-vs-default-capture routing.

Routes that point back to `$AOS_PATH` are temporary extraction candidates unless
they are true bootstrap/native primitive surfaces. Current bootstrap-native
families include `serve`, `status`, `ready`, `doctor`, and `permissions`, but
their public behavior should keep shrinking toward external composition. Other
public routes must go through external scripts, packages, recipes, or wrappers.

Future work should extract `ready`, `doctor`, `status`, and permission workflow
policy by exposing smaller private broker primitives and moving public behavior
to scripts or other composition code. Swift should retain only the privileged
native facts/actions/streams and daemon/socket behavior required to make those
external commands reliable.

Manifest placeholders must be values the Swift dispatcher resolves, such as
`$REPO_ROOT`, `$AOS_PATH`, `$AOS_RUNTIME_MODE`, `$AOS_STATE_ROOT`,
`$AOS_SESSION_KEY`, `$AOS_SESSION_HARNESS`, and
`$AOS_INVOCATION_DISPLAY_NAME`.

## Verification

For command surface changes, run the workflow recommendation first:

```bash
./aos dev recommend --json --paths <changed-paths>
```

The usual hot-swappable command-surface checks are:

```bash
node scripts/generate-command-manifests.mjs --check
bash tests/command-manifest-generation.sh
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
```

Schema changes also require:

```bash
node --test tests/schemas/*.test.mjs
```

Swift runtime input changes still require the repo-mode build and
post-permission readiness path before native live behavior is trusted. The build
gate is content-based for Swift runtime inputs, not mtime-based, and edits to
build tooling alone must not automatically replace the TCC-owning binary. Treat
a successful rebuild marker (`Rebuilt: ./aos`) as invalidating prior
TCC/live-proof evidence for that binary: reset or repair the repo-mode TCC grant
as directed by the permission workflow, then prove readiness again with
`./aos ready --post-permission` before relying on native live behavior. Command
metadata and external implementation changes should not require rebuilding the
TCC-sensitive binary.

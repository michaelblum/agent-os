# AOS Dev Workflow Router

`workflow-rules.json` is the source of truth for maintainer validation routing.
The agent-facing workflow guide is `skills/aos-maintainer-routing/SKILL.md`,
which calls `node scripts/aos-dev-workflow.mjs recommend --json --paths ...`.
Keep the manifest provider-neutral and repo-wide: route platform layers,
package loops, schema tests, and local-contract delegation, but do not encode
app-specific playbooks here. Do not add `./aos dev ...` entrypoints for this
router; use the retained local skill and direct script.

`workflow-profiles.json` is a low-level integration posture manifest: branch,
commit, review, PR, merge-authority, and release postures for repo work. It is
not the primary session operating model and does not define project-agent
personas. Repo DOX and direct user intent own session instructions.

`local_checkpoint` is the single-checkout local branch/stash procedure with no
linked git worktrees or automatic pushes. `remote_branch_relay` is the
GitHub-branch relay procedure for implementation reviewed by a designated
review authority; it does not create a separate product role.
`active-profile.json` remains the repo-local selector for this low-level
development integration profile only.
For the current cleanup narrative that led from real-input/live-drag testing to
the agent-relay readiness state, read
`docs/design/agent-relay-readiness-narrative-ledger-2026-06-04.md` before
inferring active work from historical reports, stashes, or branch names.

Reports under `docs/dev/` are evidence and history, not standing command,
schema, runtime, or architecture contracts. Before acting on a claim from those
files, verify the current source surface first: command source
manifests under `manifests/commands/source/`, generated help output, schemas
under `shared/schemas/`, `docs/api/`, applicable `AGENTS.md` files, tests, and
live Git/AOS state when the task allows runtime reads.

`residue-drift-ledger.md` records deleted, quarantined, and intentionally
retained compatibility residue. Check it before reintroducing an old command
noun, skill package, or legacy compatibility path from historical reports.

`aos-sovereign-capability-authority-v1.json` is the machine-readable authority
and path-specific current-only contradiction baseline for program
`aos-sovereign-capability-substrate-v1`. Its schema owner is
`shared/schemas/aos-sovereign-capability-authority-v1.schema.json`; the human
review projection is `aos-sovereign-capability-remodel-ledger.md`. ADR 0043
owns the target while source, command-source manifests, generated help, schemas,
tests, API docs, and runtime readback remain executable truth until later atomic
implementation. The map classifies active, target, generated, preserved,
historical, and frozen paths; its proof requires exact markers in both the
declared baseline revision and current worktree, scans Git-tracked active and
generated text for unclassified doctrine, and hash-checks preserved ADR bodies.
Validate the packet with the static command recorded in the map; it does not
execute `./aos`, the daemon, Playwright, a browser, native UI, or TCC-sensitive
code.

`product-maturity.json` is the machine-readable pre-release and compatibility
policy declaration. It fixes the zero-installed-base facts, atomic internal
migration rule, same-change deletion rule, and any approved compatibility
exceptions. ADR 0039 owns the decision and
`shared/schemas/aos-product-maturity-v0.schema.json` owns the declaration
shape. Validate it with:

```bash
node --test tests/pre-release-compatibility-policy.test.mjs tests/schemas/aos-product-maturity-v0.test.mjs
```

`agent-capabilities.json` is the source of truth for typed developer
capabilities exposed through repo-local maintainer scripts. It describes
capability envelopes without selecting personas or launch profiles. Use
`entry_paths` for current routing; there is no legacy persona-role filter.

`command-surface.md` describes the external command manifest contract: what
remains in Swift, what lives in hot-swappable manifests/scripts, and which tests
guard route and help behavior. It also owns the clean-cut rule that `aos dev`
and `aos ops` are retired and must not be reintroduced as hidden maintainer
plumbing or compatibility aliases. It also defines the agent-ergonomics rule:
persistent routine-work friction should
trigger dev-surface examination instead of growing persona instructions. Public
AOS ergonomics should be shaped through direct commands, stable help/JSON
contracts, and explicit capability groups rather than command-name parity with
another CLI.

`test-proof-registry.json` is the hidden proof-worth ratchet index for changed
tests, helpers, fixtures, and proof assets. Its owner fragments under
`docs/dev/test-proof-registry.d/` are source truth, not generated output: each
entry names the owner, harness level, contract, worth, exact proof command,
replacement relationship, guard posture, and status.
`node scripts/aos-dev-workflow.mjs recommend` enforces it for changed proof
assets; `node scripts/aos-dev-workflow.mjs classify` may report the same
metadata but must not fail.

For test harness selection, start with the foundational ladder in
`tests/README.md`. For runtime, canvas, input, status-item, lifecycle, visual,
supervised, or cross-layer slices where the harness is not obvious, use
`docs/guides/test-harness-ladder-and-prep.md` before adding new test helpers.

Validate routing changes with:

```bash
node --test tests/schemas/dev-test-proof-registry.test.mjs
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/dev-workflow-profiles.test.mjs
node --test tests/schemas/dev-active-profile.test.mjs
bash tests/dev-workflow-router.sh
```

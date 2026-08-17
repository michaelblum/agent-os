# agent-os Root DOX Contract

This file is the DOX rail for repo-root sessions. It tells agents how to find
the applicable local authority; it is not the place for workflow, role, runtime,
or architecture detail.

## DOX Framework

- DOX is the binding `AGENTS.md` hierarchy installed here.
- Agents must follow DOX instructions across any edits.

### Root Scope

- Root owns this hierarchy protocol, repo-wide hard invariants, and the
  top-level Child DOX Index.
- Child `AGENTS.md` files own local purpose, scope, workflow, verification,
  and child indexes.
- Detailed rules belong in the nearest owner, not in this root file.

### Core Contract

- `AGENTS.md` files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable `AGENTS.md` plus
  every parent `AGENTS.md` above it.

### Read Before Editing

1. Read the root `AGENTS.md`.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every `AGENTS.md` found along each route.
5. If a parent `AGENTS.md` lists a child `AGENTS.md` whose scope contains the
   path, read that child and continue from there.
6. Use the nearest `AGENTS.md` as the local contract and parent docs for
   repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child
   doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session
before editing.

### Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning `AGENTS.md` when a change affects:

- purpose, scope, ownership, or responsibilities;
- durable structure, contracts, workflows, or operating rules;
- required inputs, outputs, permissions, constraints, side effects, or
  artifacts;
- user preferences about behavior, communication, process, organization, or
  quality;
- `AGENTS.md` creation, deletion, move, rename, or index contents.

Update parent docs when parent-level structure, ownership, workflow, or child
index changes. Update child docs when parent changes alter local rules. Remove
stale or contradictory text immediately. Small edits that do not change behavior
or contracts may leave docs unchanged, but the DOX pass still must happen.

### Hierarchy

- Root `AGENTS.md` is the DOX rail and top-level Child DOX Index.
- Child `AGENTS.md` files own domain-specific instructions and their own Child
  DOX Index.
- Each parent explains what its direct children cover and what stays owned by
  the parent.
- The closer a doc is to the work, the more specific and practical it must be.

### Child Doc Shape

- Create a child `AGENTS.md` when a folder becomes a durable boundary with its
  own purpose, rules, responsibilities, workflow, materials, or quality
  standards.
- Work Guidance must reflect the current standards of the project or user
  instructions; if there are no specific standards or instructions yet, leave it
  empty.
- Verification must reflect an existing check; if no verification framework
  exists yet, leave it empty and update it when one exists.

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

### Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local
  version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for
  risks that no longer exist.

### Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

## Hard Invariants

- Do not discard or overwrite user changes to satisfy workflow hygiene.
- AOS uses ambient authority: the user authorizes the agent host and macOS TCC
  constrains the process; AOS must not add auth tokens, allowlists, risk labels,
  mandatory approvals, mandatory dry-run, Work Record authorization, default
  core masking/redaction, or assistant/product restrictions. Preserve mechanical
  correctness through exact identity, stale/ambiguous rejection, bounded
  resources and timeouts, exactly-once admission where relevant, cleanup, typed
  errors, and receipts. ADR 0040 owns the detailed contract.
- For program `aos-sovereign-capability-substrate-v1`, ADR 0043 owns the
  accepted target for comprehensive privileged exposure, complete managed-tool
  grammar, and a non-admission operation control plane. ADR 0044 accepts its
  immediate-peer audit identity and proc-generation-verified non-AOS ancestry,
  content-free generation-bound external dispatch, exact registered-set same-
  effective-UID host control, bounded retained-receipt replay plus expected-
  barrier CAS after eviction, distinct artifact/claim recovery dispositions,
  nine-machine prior-generation recovery, and split claim-set/resource/broker
  mechanics. The atomic Milestone 2 slice implements the native operation
  registry/control/recovery plane, resource claims, microphone adapter, public
  CLI and IPC, and internal status-item/Canvas projections. Its source,
  command-source manifests, generated help, schemas, tests, and runtime readback
  are executable truth; do not advertise later milestone capability as already
  implemented.
- Facts and channels admitted by each bounded public observation contract are
  raw and fidelity-first; facts outside that contract remain outside it.
  Masking, redaction, persistence, and projection are explicit caller-owned
  transforms. Public target handles are
  either state-scoped observation refs or action-time re-resolving locators;
  never silently reacquire a stale observation ref as though it were a locator.
- AOS is pre-release with no installed base or external backward-compatibility
  obligations. Migrate real current consumers atomically and delete superseded
  implementation, schemas, tests, fixtures, docs, and generated projections in
  the same bounded change.
- Treat `compatibility`, `backward compatible`, `legacy`, `migration`,
  `deprecation`, `shim`, `fallback`, `dual reader`, `upgrade path`, and similar
  language as a tripwire—not as a default requirement. Before adding machinery
  described by those terms, identify the actual maintained consumer or
  intentional data, show why atomic cutover or a bounded reset is unsafe, and
  name the exception owner and removal trigger. Without that evidence, do the
  clean cutover and remove the old path. Do not ask the owner to approve routine
  greenfield replacement.
- Do not globally ban those words when they describe a real current constraint,
  such as supported macOS/runtime versions, exact AOS/Sigil pin coordination,
  or frozen historical evidence. Name that concrete constraint instead of
  inferring a deployed user base.
- Deletion of superseded tracked material and cleanup of session-created test
  artifacts are expected in-scope work. Tests and spikes must clean their logs,
  traces, snapshots, recordings, databases, reports, caches, Work Records, and
  temporary roots when their purpose ends. A retained exception needs a named
  owner, measured size, and finite or event-based deletion trigger. Never delete
  unrelated or pre-existing untracked user material while cleaning.
- For hard concurrency, lifecycle, recovery, or process-identity defects, repair
  production directly when a deterministic failure and mechanism are already
  established. When they are not, first use one bounded failing harness,
  interleaving model, or disposable spike with an exit criterion. Do not use the
  production implementation as an exploratory scratchpad, and do not require a
  spike when a focused regression already makes the repair falsifiable.
- For delegated discovery, proof, or review, assign each fact lane one primary
  evidence owner. Delegate or re-derive—do not do both. The orchestrator may
  inspect returned evidence and run at most three targeted decision-critical
  spot checks, but must not repeat that lane's broad searches, source walk, or
  proof suite. A seam-focused integration reviewer may test relationships on
  one stable snapshot without redoing each lane. Duplicate verification needs a
  named high-risk reason—authority, security, native lifecycle/concurrency,
  irreversible or live action, publication, or contradictory evidence—and is
  limited to one independent reviewer. Contradictions get one focused
  adjudication, not a new audit tree.
- Do not invent new scoping models for runtime resources.
- Do not create or use linked git worktrees for agent-os agent work. The
  default repo runtime belongs to the primary checkout; runtime-coupled tests
  from any alternate checkout must use an explicit isolated `AOS_STATE_ROOT`.
- Treat `_dev` demos as non-canonical.
- Treat external Sigil as AOS's first-party reference consumer. Sigil needs may
  drive product-neutral primitives, toolkit policy, hosts, schemas, and public
  CLI changes without waiting for a second consumer; keep branded product
  composition in the Sigil repository.
- Root `build.sh` is governed by
  `docs/adr/0023-managed-endpoint-raw-repo-artifact.md`. On this
  enterprise-managed Mac running Cylance, preserve the intentional repo-mode
  shape in root `build.sh`: inline source fingerprinting followed by one plain,
  direct `swiftc` link to `./aos` with no extra metadata sections. Its internal
  source `shasum` and size reporting are part of the proven script. Do not
  post-link sign, identify, entitle, copy, move, rewrite, wrap, install, assess,
  or add an `__info_plist` section to the raw artifact. Recover a missing or
  exit-`137` binary with exact `bash build.sh --force --no-restart`. After a
  real rebuild,
  `./aos help --json` must be the immediately following command; do not inspect,
  hash, attest, or run other checks first, and stop without retry on exit `137`.
  If help succeeds, stop immediately for the human TCC checkpoint; do not
  inspect the artifact or run readiness. Only after the user replies `finished`
  may the session run the exact next command
  `./aos ready --repair --post-permission --json`, with no intervening command.
  The private Work Record descriptor-relative N-API addon may compile before
  Swift source fingerprinting; its ignored current-architecture output is
  packaged with the reachable Work Record command resource projection and must
  not transform, inspect, launch, sign, or otherwise interpose on the raw
  `./aos` artifact.
- Checkpoint after every validated increment: commit to the working branch
  before starting the next step so an interrupted session never strands more
  than one step of uncommitted work. A large uncommitted accumulation across
  many files is a hazard to be checkpointed immediately, not progress.
- Never attribute commits, PR descriptions, issue comments, or release notes to
  Claude or any AI assistant.

## Child DOX Index

- `.codex/AGENTS.md` governs local Codex configuration and native custom-agent
  disablement.
- `.agents/` contains cross-provider hook scripts and stays root-owned until a
  child doc is needed.
- `.claude/` contains Claude compatibility settings and statusline hooks; live
  project-agent orchestration is retired from AOS core.
- `apps/AGENTS.md` guards the intentionally empty application-source boundary;
  active product consumers live in their owning repositories.
- `docs/AGENTS.md` governs durable docs, ADRs, guides, API docs, reports, and
  archives.
- `experiences/AGENTS.md` governs experience manifests and app activation
  material.
- `manifests/AGENTS.md` governs command and capability manifests.
- `packaging/AGENTS.md` governs repo runtime packaging metadata such as
  `Info.plist`, entitlements, and signing experiment inputs.
- `packages/AGENTS.md` governs reusable JavaScript/package layers. Its current
  child is `packages/toolkit/AGENTS.md`, which further indexes `contracts/`,
  `controls/`, `panel/`, and `runtime/`.
- `recipes/AGENTS.md` governs operational recipes and repeatable procedures.
- `scripts/AGENTS.md` governs executable repo tooling and `aos` command
  adapters.
- `shared/AGENTS.md` governs shared schemas, shared JS contracts, and shared
  Swift IPC helpers.
- `skills/AGENTS.md` governs local skill packages.
- `src/AGENTS.md` governs native Swift source. Its current child is
  `src/daemon/AGENTS.md`.
- `tests/AGENTS.md` governs shell, Node, Python, browser, daemon, toolkit,
  scenario, and frozen compatibility-fixture assets.
- `wiki-seed/AGENTS.md` governs seed wiki content.

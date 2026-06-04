# Dev Workflow Profiles

Development workflow profiles describe branch, commit, review, pull request, and
release posture. They are deliberately separate from AOS docks and entry paths:

- A dock defines who the agent is for the session.
- An entry path defines the active capability layer for the task.
- A workflow profile defines how development work flows through git and review.

The machine-readable source is `docs/dev/workflow-profiles.json`. The built-in
profiles are examples that repo owners may replace, extend, or ignore when a
project needs a different development posture.

## Active Profile

The active profile for this repo is selected in `docs/dev/active-profile.json`.

Agents should treat an explicit user instruction as stronger than the active
profile for the current session, unless the instruction would discard work,
publish externally, or perform a destructive operation.

## Built-In Profiles

### Agentic Relay (`agentic_relay`)

Use this when a local GDI implementation agent works in tandem with a designated
relay authority that owns review and merge. The relay authority performs the
Foreman merge/review function, but it may be running remotely with GitHub access
and no local checkout, local hooks, `./aos`, or local dirty-state visibility.

- GDI creates a `gdi/<work-card-slug>` branch from `main` before starting work.
- GDI commits verified work to that branch and pushes it to origin at
  completion.
- GDI reports the branch name, HEAD SHA, verification, and local-only state in
  its completion report. GDI does not merge to main.
- The pushed branch is the remote-visible relay artifact. The relay authority
  reads it through GitHub, evaluates the work, and merges to main or requests
  changes.
- A remote relay is not a fourth product role. It is a GitHub-only adapter for
  Foreman responsibilities. A local Foreman session may also act as the relay
  authority when the remote relay is absent, interrupted, or explicitly handed
  off.
- If the relay authority needs local-only facts, it requests a local probe
  instead of pretending it can see local state.
- Rollback, fix-forward, and revert are clean because main is never touched
  until the relay authority explicitly merges.

### Local Relay (`local_relay`)

Use this when Foreman, the human, and GDI are sharing one local checkout and the
branch or stash is the local safety boundary.

- Work only in `/Users/Michael/Code/agent-os`; do not create linked git
  worktrees for this workflow.
- Use local branches, scoped commits, and named stashes to preserve unrelated
  work before switching context.
- GDI may produce local commits when the work card asks for a checkpoint, but
  GDI does not push, open pull requests, merge, or clean branches unless that
  is explicitly assigned.
- Foreman or the human reviews local branch state and verification before
  deciding whether to merge, publish to GitHub, or ask for a correction.
- At practical review points, Foreman may suggest publishing a small focused PR
  for a non-local reviewer when outsider review would reduce risk. This remains
  an explicit human-approved option, not automatic publication, and the PR
  should keep the review scope narrow.
- The repo-mode `./aos` binary is stable infrastructure at
  `/Users/Michael/Code/agent-os/aos`; do not create or rely on branch-local or
  linked-worktree binaries.

### Hybrid Trunk (`hybrid_trunk`)

Use this for a single developer or very tiny team working primarily on `main`.

- Default to committing directly on `main` for small, low-risk, incremental
  changes.
- Keep `main` releasable with disciplined, focused commits and local
  verification.
- Create short-lived branches only for risky, experimental, multi-day, dirty
  checkout, or externally collaborative work.
- Do not require pull requests by default; use agent relay review, local tests,
  and human review when risk warrants it.

### GitHub Flow (`github_flow`)

Use this for a small or medium team using lightweight pull request review.

- Create a short-lived branch from `main` for each feature, bugfix, refactor,
  or docs change.
- Merge back into `main` through a pull request when ready.
- Treat `main` as deployable and keep branches short-lived.

### GitFlow (`gitflow`)

Use this for projects with multiple environments or formal release cycles.

- Use `develop`, `feature/*`, `release/*`, `hotfix/*`, and `main`.
- Branch day-to-day development from `develop`.
- Cut release branches for release preparation.
- Merge production releases and hotfixes back into `main`.

## Choosing A Profile

Prefer `agentic_relay` when:

- a local GDI agent does bounded implementation work and a remote partner
  (human or agent) owns the merge gate through GitHub-visible branch state;
- you want rollback/fix-forward safety without mandatory pull requests;
- the remote partner can evaluate and merge via GitHub API without a local
  checkout, and can request local probes when local-only evidence matters.

Prefer `local_relay` when:

- Foreman, the human, and GDI need a nimble local loop in one checkout;
- branches and stashes are enough isolation and GitHub publication should be an
  explicit later decision;
- outsider review may occasionally be useful, but should be offered as a
  focused PR checkpoint instead of making PRs mandatory for every slice;
- linked git worktrees or extra `aos` binaries would create more confusion than
  safety.

Prefer `hybrid_trunk` when:

- one person owns the repo day to day without a separate remote relay;
- branching overhead exceeds its review or safety value;
- changes are usually completed in one sitting or less than a day.

Prefer `github_flow` when:

- multiple developers need isolated work surfaces;
- lightweight pull request review is the normal integration gate;
- `main` should remain deployable and branch divergence should stay short.

Prefer `gitflow` when:

- release preparation needs a branch separate from both development and
  production;
- multiple deployment environments require durable branch separation;
- production hotfixes need a formal path back into ongoing development.

Future AOS workflow assistants or dashboards should read the JSON manifest and
present these fields as deterministic options rather than baking one workflow
into the root agent contract.

# Dev Workflow Profiles

Development workflow profiles describe branch, commit, review, pull request, and
release posture. They are low-level development integration references. They are
not the primary session operating model. Repo DOX and direct user intent own
session instructions.

- Session identity is the current coding session plus explicit task/user context.
- An execution surface is where work happens: current checkout, branch, or pull
  request.
- A capability route defines the path, tool, and test mechanics for a task.
- A workflow profile defines how development work flows through git and review.

The machine-readable source is `docs/dev/workflow-profiles.json`. The built-in
profiles are examples that repo owners may replace, extend, or ignore when a
project needs a different development posture.

## Active Profile

The active development integration profile for this repo is selected in
`docs/dev/active-profile.json`.

Sessions should treat an explicit user instruction as stronger than the active
profile, unless the instruction would discard work, publish externally, or
perform a destructive operation.

## Built-In Profiles

### Remote Branch Relay (`remote_branch_relay`)

Use this when local implementation works in tandem with a designated review
authority that owns review and merge. The review authority may be running
remotely with GitHub access and no local checkout, local hooks, `./aos`, or
local dirty-state visibility.

- Create a `topic/<slug>` branch from `main` before starting work that needs
  remote review.
- Commit verified work to that branch and push it to origin at completion only
  when the profile and dispatch explicitly authorize publication.
- Report the branch name, HEAD SHA, verification, and local-only state in the
  completion report. Do not merge to main.
- The pushed branch is the remote-visible relay artifact. The relay authority
  reads it through GitHub, evaluates the work, and merges to main or requests
  changes.
- A remote relay is not a fourth product role. It is a GitHub-only adapter for
  review responsibilities. A local session may also act as the review authority
  when the remote relay is absent, interrupted, or explicitly handed off.
- If the relay authority needs local-only facts, it requests a local probe
  instead of pretending it can see local state.
- Rollback, fix-forward, and revert are clean because main is never touched
  until the relay authority explicitly merges.

### Local Checkpoint (`local_checkpoint`)

Use this when one local checkout is the work surface and the branch or stash is
the local safety boundary.

- Work only in `/Users/Michael/Code/agent-os`; do not create linked git
  worktrees for this workflow.
- Use local branches, scoped commits, and named stashes to preserve unrelated
  work before switching context.
- Commit locally when work is finished or a checkpoint is useful, but do not
  push, open pull requests, merge, or clean branches unless that is explicitly
  assigned.
- The human or local reviewer reads local branch state and verification before
  deciding whether to merge, publish to GitHub, or ask for a correction.
- After accepting a slice, keep the loop moving by taking the next
  reversible local step: run missing evidence, commit a scoped checkpoint, or
  update the relevant ledger.
- When the next step crosses a non-local gate, stop with an actionable
  decision packet instead of a vague prompt. The packet names the blocked action
  (`push`, `open PR`, `merge`, `delete branch`, credential change, permission
  change, destructive cleanup, or product judgment), the recommended default,
  the exact approval phrase or human action, the command path to run after
  approval, and the safe alternative.
- At practical review points, suggest publishing a small focused PR
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

Prefer `remote_branch_relay` when:

- local implementation work needs a remote partner to own the merge gate through
  GitHub-visible branch state;
- you want rollback/fix-forward safety without mandatory pull requests;
- the remote partner can evaluate and merge via GitHub API without a local
  checkout, and can request local probes when local-only evidence matters.

Prefer `local_checkpoint` when:

- one checkout is enough for the local loop;
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

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

The active profile for this repo is `agentic_relay`.

Agents should treat an explicit user instruction as stronger than the active
profile for the current session, unless the instruction would discard work,
publish externally, or perform a destructive operation.

## Built-In Profiles

### Agentic Relay (`agentic_relay`)

Use this when a local GDI implementation agent works in tandem with a remote
relay partner (a human, another agent session, or any session with GitHub API
access) that owns merge authority.

- GDI creates a `gdi/<work-card-slug>` branch from `main` before starting work.
- GDI commits verified work to that branch and pushes it to origin at
  completion.
- GDI reports the branch name and HEAD SHA in its completion report. GDI does
  not merge to main.
- The relay partner reads the branch remotely, evaluates the work, and merges
  to main or requests changes — no local checkout required.
- There is no local Foreman dock in this profile. The relay partner fills the
  git stewardship role from remote.
- Rollback, fix-forward, and revert are clean because main is never touched
  until the relay partner explicitly merges.

### Hybrid Trunk (`hybrid_trunk`)

Use this for a single developer or very tiny team working primarily on `main`.

- Default to committing directly on `main` for small, low-risk, incremental
  changes.
- Keep `main` releasable with disciplined, focused commits and local
  verification.
- Create short-lived branches only for risky, experimental, multi-day, dirty
  worktree, or externally collaborative work.
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
  (human or agent) owns the merge gate;
- you want rollback/fix-forward safety without mandatory pull requests;
- the remote partner can evaluate and merge via GitHub API without a local
  checkout.

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

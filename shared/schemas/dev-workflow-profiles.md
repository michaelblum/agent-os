# AOS Dev Workflow Profiles

`docs/dev/workflow-profiles.json` defines repo-selectable development workflow
profiles for branch, commit, review, pull request, merge authority, and release
posture.
`docs/dev/active-profile.json` selects the active repo-local profile.

The profile manifest is not an AOS primitive contract. It is a development
policy surface that agents can read before deciding whether to stay on `main`,
create a branch, prepare a pull request, or use release branches.

The canonical AOS example manifest currently ships exactly four built-in
profiles:

- `agentic_relay` for local GDI branches reviewed and merged by a designated
  Foreman-compatible relay authority through GitHub-visible branch state.
- `hybrid_trunk` for single-developer or tiny-team direct-to-main work.
- `github_flow` for short-lived feature branches and lightweight pull request
  review.
- `gitflow` for environment and release-cycle branch separation.

Repo owners may replace or extend the profile manifest when their development
workflow differs. The schema validates shape and deterministic fields; tests
preserve the canonical AOS examples.

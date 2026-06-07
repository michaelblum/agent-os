# AOS Dev Workflow Router

`workflow-rules.json` is the source of truth for `./aos dev classify` and
`./aos dev recommend`. Keep it provider-neutral and repo-wide: route platform
layers, package loops, schema tests, and local-contract delegation, but do not
encode app-specific playbooks here.

`workflow-profiles.json` is the source of truth for built-in example development
workflow profiles: branch, commit, review, PR, merge-authority, and release
postures for repo work without treating that posture as an immutable AOS
primitive. `local_relay` is the single-checkout local branch/stash procedure for
tight Foreman-human-dock-team loops with no linked git worktrees or automatic
pushes. `agentic_relay` is the GitHub-branch relay procedure for local GDI
implementation, whether run as a native subagent or explicitly assigned
terminal relay, reviewed by a designated Foreman-compatible relay authority; it
does not create a separate product role.
`active-profile.json` is the single repo-local selector for the active profile.
For the current cleanup narrative that led from real-input/live-drag testing to
the agent-relay readiness state, read
`docs/design/agent-relay-readiness-narrative-ledger-2026-06-04.md` before
inferring active work from old work cards, stashes, or branch names.

`agent-capabilities.json` is the source of truth for typed developer
capabilities exposed through `./aos dev capabilities`. `.docks/*/dock.json`
profiles resolve against that manifest through `./aos dev docks`, so dock
identity and capability envelopes stay declarative instead of being repeated in
role instructions.

`command-surface.md` describes the external command manifest contract: what
remains in Swift, what lives in hot-swappable manifests/scripts, and which tests
guard route and help behavior. It also defines the agent-ergonomics rule:
persistent routine-work friction should trigger dev-surface examination instead
of growing dock persona instructions.

For test harness selection, start with the foundational ladder in
`tests/README.md`. For runtime, canvas, input, status-item, lifecycle, visual,
supervised, or cross-layer slices where the harness is not obvious, use
`docs/guides/test-harness-ladder-and-prep.md` before adding new test helpers.

Validate routing changes with:

```bash
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/dev-workflow-profiles.test.mjs
node --test tests/schemas/dev-active-profile.test.mjs
```

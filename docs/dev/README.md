# AOS Dev Workflow Router

`workflow-rules.json` is the source of truth for `./aos dev classify` and
`./aos dev recommend`. Keep it provider-neutral and repo-wide: route platform
layers, package loops, schema tests, and local-contract delegation, but do not
encode app-specific playbooks here.

`workflow-profiles.json` is the source of truth for built-in example development
workflow profiles: branch, commit, review, PR, merge-authority, and release
postures for repo work without treating that posture as an immutable AOS
primitive. `agentic_relay` is the GitHub-branch relay procedure for local GDI
implementation reviewed by a designated Foreman-compatible relay authority; it
does not create a separate product role.
`active-profile.json` is the single repo-local selector for the active profile.

`agent-capabilities.json` is the source of truth for typed developer
capabilities exposed through `./aos dev capabilities`. `.docks/*/dock.json`
profiles resolve against that manifest through `./aos dev docks`, so dock
identity and capability envelopes stay declarative instead of being repeated in
role instructions.

Validate routing changes with:

```bash
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/dev-workflow-profiles.test.mjs
node --test tests/schemas/dev-active-profile.test.mjs
```

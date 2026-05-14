# AOS Dev Workflow Router

`workflow-rules.json` is the source of truth for `./aos dev classify` and
`./aos dev recommend`. Keep it provider-neutral and repo-wide: route platform
layers, package loops, schema tests, and local-contract delegation, but do not
encode app-specific playbooks here.

`agent-capabilities.json` is the source of truth for typed developer
capabilities exposed through `./aos dev capabilities`. `.docks/*/dock.json`
profiles resolve against that manifest through `./aos dev docks`, so dock
identity and capability envelopes stay declarative instead of being repeated in
role instructions.

Validate routing changes with:

```bash
node --test tests/schemas/dev-workflow-rules.test.mjs
```

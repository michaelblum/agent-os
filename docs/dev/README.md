# AOS Dev Workflow Router

`workflow-rules.json` is the source of truth for `./aos dev classify` and
`./aos dev recommend`. Keep it provider-neutral and repo-wide: route platform
layers, package loops, schema tests, and local-contract delegation, but do not
encode app-specific playbooks here.

Validate routing changes with:

```bash
node --test tests/schemas/dev-workflow-rules.test.mjs
```

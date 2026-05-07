# Foreman Role Dock

This directory is copied into the per-run foreman launch directory. Treat it as
role-local control material, not a source checkout.

The working repo is `{{repoRoot}}`. Start by reading the GDI ready sentinel:

```text
{{readyPath}}
```

After the integration pass is complete, write the done sentinel:

```text
{{donePath}}
```

The generated role directory may also contain a role-local `.codex/hooks.json`
profile. Keep those hooks local to the generated run state.

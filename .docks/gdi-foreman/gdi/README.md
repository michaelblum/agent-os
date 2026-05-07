# GDI Role Dock

This directory is copied into the per-run GDI launch directory. Treat it as
role-local control material, not a source checkout.

The working repo is `{{repoRoot}}`. Make source edits and run verification from
that repo root, then finish the pass by producing the ready sentinel:

```text
{{readyPath}}
```

The generated role directory may also contain a role-local `.codex/hooks.json`
profile. Keep those hooks local to the generated run state.

# AOS Experience Runtime Context v0

The JSON schema is
`shared/schemas/aos-experience-runtime-context-v0.schema.json`.

`aos experience status <id> --json` emits a read-only runtime context envelope
with `schema_version: "aos.experience-runtime-context.v0"`. The envelope is a
machine contract for agents that need to decide whether an app-owned experience
is current before trusting content roots, status-item surfaces, pending
annotations, or runtime readiness.

## Contract

The envelope includes:

- `collected_at` for the single passive snapshot time.
- `command` with the exact read-only status argv.
- `experience` and `active_experience` identity.
- `runtime` readiness from passive service and permission readbacks.
- `state` paths for mode-scoped experience/config state, plus pending
  annotation state only for supported annotation experiences.
- `content_roots`, `status_item`, and discriminated `pending_annotations`
  status blocks. Unsupported annotation experiences emit only
  `{ "status": "not_applicable", "supported": false }` and do not expose
  pending annotation store paths.
- `diagnostics`, `capabilities`, and `recommended_next` for machine routing.

Each `content_roots.roots[]` row includes `repair_action`:

- `none` when no root repair is needed.
- `activate_experience` only when the declared path is current and activation
  can repair config or live-root drift.
- `fix_declared_path` when the declared path is missing, not a directory, a
  symlink, unreadable, or otherwise unknown.
- `inspect_runtime` when the declared path is current but passive readback is
  unknown.

Status output must stay passive. It may read local state and run read-only AOS
readbacks, but it must not activate, repair, start, restart, remove, reset TCC,
or mutate pending annotation storage.

## Verification

Run:

```bash
node --test tests/experience-runtime-context.test.mjs
node --test tests/schemas/aos-experience-runtime-context-v0.test.mjs
node --test tests/schemas/*.test.mjs
```

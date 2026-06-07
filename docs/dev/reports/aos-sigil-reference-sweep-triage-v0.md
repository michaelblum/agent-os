# AOS Sigil Reference Sweep And Inference Triage V0

Status: checked 2026-06-03.

## Boundary

Generic AOS platform code, schemas, command examples, and daemon-facing helpers
must not infer Sigil semantics from IDs, URLs, labels, or content roots.
Sigil-owned app and experience files may still use Sigil product vocabulary.
Wiki seed content is outside this sweep.

## Corrected

- `scripts/aos-clean.mjs` no longer hardcodes Sigil URL expectations or
  Sigil-owned canvas IDs. Active-experience cleanup now reads generic
  manifest metadata.
- `experiences/sigil/aos-experience.json` declares its own cleanup-preserved
  canvas IDs under `cleanup.preserve_canvas_ids`.
- `shared/schemas/aos-experience-v0.schema.json` uses neutral
  `default_activation.primary_entry` and permits generic cleanup metadata.
- `scripts/aos-launch.mjs` no longer special-cases `aos launch sigil` as an
  experience activation shim. It also uses generic `surface_home_x/y`
  templates instead of `avatar_home_x/y`.
- `scripts/aos-experience.mjs` uses an empty generic vanilla fallback and a
  neutral disabled status-item toggle ID.
- `scripts/aos-config-command.mjs`, `scripts/package-aos-runtime`,
  `manifests/commands/aos-commands.json`, `ARCHITECTURE.md`,
  `shared/schemas/spatial-topology.*`, and `src/CLAUDE.md` no longer seed
  product names in generic defaults/examples.
- `apps/sigil/context-menu/menu.js` now publishes
  `geometry.logical_surface_key` on its `panel.toggle` action instead of
  depending on audit grouping by panel ID or URL.

## Caller Triage

- `tests/canvas-visible-surface-audit.sh`: accepted. The test publishes
  `geometry.logical_surface_key` explicitly and verifies generic audit grouping.
- `apps/sigil/context-menu/menu.js`: migrated. The panel caller now supplies
  `sigil.avatar.controls` as caller-owned metadata.
- `apps/sigil/renderer/live-modules/main.js` and `host-runtime.js`: not daemon
  inference. They use daemon `position.get` / `position.set` with a caller key.
  This keeps product state in a generic daemon key-value path, so it is
  acceptable for binary product-string hygiene but remains future convergence
  debt if resume position should move fully into Sigil/toolkit state.
- `aos launch sigil`: no generic-code shim remains. It now resolves through the
  normal Sigil app manifest; `aos experience activate sigil` remains the
  explicit experience activation path.
- Wiki seed and wiki graph entries: intentionally not changed. Sigil wiki
  entries remain valid product content.

## Remaining Valid Sigil References

Sigil references are expected in `apps/sigil/`, `experiences/sigil/`, Sigil
tests, Sigil-specific fixtures, and design notes whose subject is Sigil as a
product/app consumer.

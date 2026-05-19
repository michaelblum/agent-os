# Wiki Maintenance

`docs/wiki/` contains source-controlled configuration for deterministic runtime
wiki projections. It is not the runtime wiki itself.

## Source Layers

- `wiki-seed/` is the hand-authored seed pack copied into the runtime wiki by
  `./aos wiki seed`.
- `docs/wiki/repo-docs-projection-v0.json` is the curated manifest for
  projecting canonical Git docs into generated runtime wiki orientation pages.
- Generated wiki pages live under `~/.config/aos/{mode}/wiki/` or the active
  `AOS_STATE_ROOT`; they should not be committed as source.

## Maintenance Rules

- Prefer canonical API/design/ADR docs in the projection manifest. Avoid
  projecting transient work cards after the accepted behavior is represented in
  durable docs.
- Prune seeded wiki entity pages for parked legacy paths. A legacy URL can be
  mentioned under its owning current subject, but it should not become a graph
  subject by default.
- Keep runtime wiki pages generated from Git clearly marked as generated, with
  source path, source hash, source type, and controlled concepts.
- Use `docs/archive/` for historical source material that should remain
  searchable but should not steer current implementation.

## Checks

```bash
./aos wiki project-docs --dry-run --json
bash tests/wiki-seed.sh
bash tests/wiki-project-docs.sh
```

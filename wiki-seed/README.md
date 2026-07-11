# Wiki Seed

Repo-backed source of truth for the default `aos wiki seed` starter pack.

## Purpose

Files in this tree are committed so the runtime wiki under `~/.config/aos/{mode}/wiki/` can be rebuilt from git-backed sources instead of only from live local state.

## Seeding

From the repo root:

```bash
./aos wiki seed --force --from wiki-seed
```

Default `./aos wiki seed` also uses this directory when run from the repo.

## Structure

- `entities/`
- `concepts/`
- `plugins/`

These are copied into the runtime wiki under the `aos/` namespace by the seed command.

## Notes

- External products own their app-specific wiki seeds in their product repositories.
- Domain-specific workflow material should live outside the seed tree unless it is part of a current platform-neutral example.
- Seeded entity/concept pages should describe current source-of-truth surfaces.
  Do not add first-class entity pages for frozen embedded-product paths. Mention
  them only as historical fixture context under their external owning subject.

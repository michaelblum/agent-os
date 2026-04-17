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

- App-owned wiki seeds may also live under app-specific paths such as `apps/sigil/seed/wiki/sigil/...`.
- Some employer-brand reference material in this tree is retained as legacy appendix content because it informed the canonical workflow set.

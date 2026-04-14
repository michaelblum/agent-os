# Post-Merge Cleanup Spec

**Goal:** Remove all side-eye remnants from the codebase after the side-eye → aos merge.

## 1. Zones path migration

`capture-pipeline.swift:875` hardcodes `~/.config/side-eye/zones.json`. Change to `~/.config/aos/{mode}/zones.json` using `aosStateDir()`.

On load, if the new path doesn't exist but `~/.config/side-eye/zones.json` does, copy it to the new location automatically. This is a one-time migration — `aos reset` handles removing the old directory.

## 2. Reset cleanup

`reset.swift` should remove `~/.config/side-eye/` when running `--mode all`. This is a legacy directory that no longer serves any purpose.

Add it alongside the existing legacy state dir cleanup (after the mode-scoped state dirs are removed).

## 3. Comment cleanup

Update comments in `src/` that reference side-eye as a separate package. These are stale after the merge:

- `src/main.swift:109` — help text says "delegates to side-eye"
- `src/perceive/spatial.swift:7` — "Ported from packages/side-eye/"
- `src/perceive/focus-commands.swift:3-4` — "Ported from packages/side-eye/"
- `src/perceive/capture-pipeline.swift:1,4` — "ported from side-eye"
- `src/perceive/capture-pipeline.swift:1152-1154` — "side-eye DisplayEntry" references
- `src/act/act-models.swift:356` — "read from side-eye channel files"
- `src/display/channel.swift:2,8` — "side-eye channel files"
- `src/act/act-channel.swift:2` — "side-eye channel files"
- `src/main.swift:120` — help text says "configured via side-eye zone"

For each: either remove the comment if it adds no value, or reword to reference aos (e.g., "Ported from side-eye, now part of aos perception module" → just remove, the git history has provenance).

## Out of scope

- The `packages/side-eye/` directory already has a `MOVED.md` and the old binary — leave as-is, it's a tombstone.
- No cursor command consolidation needed — `aos see cursor` is the only cursor command.

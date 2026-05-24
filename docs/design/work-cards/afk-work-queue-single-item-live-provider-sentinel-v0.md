# Work Card: AFK Work Queue Single Item Live Provider Sentinel V0

**Status:** Ready for Provider Sentinel

## Goal

This is a harmless live-provider sentinel for the AFK work queue one-item live
proof.

Do not edit files, create branches, commit, push, open GitHub, route follow-up
work, or read provider transcript files.

Run exactly these local checks from the repository root:

```bash
git status --short --branch
node --test tests/schemas/dev-active-profile.test.mjs
```

Return a concise response containing:

- proof token: `afk-work-queue-single-item-live-provider-sentinel-v0`
- branch/status summary;
- active-profile test result;
- confirmation that no file, branch, GitHub, provider store, or runtime
  mutation was made.

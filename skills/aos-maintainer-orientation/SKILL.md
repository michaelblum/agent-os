---
name: aos-maintainer-orientation
description: Collect AOS maintainer session orientation from live repo, GitHub, and runtime facts. Use inside agent-os at the start of maintainer work, successor handoffs, PR or review resumption, dirty-state checks, or when current branch, GitHub, and AOS readiness need a sourced summary; call node scripts/aos-dev-situation.mjs --json.
---

# AOS Maintainer Orientation

Use this skill to collect a compact sourced starting packet for repo work.

## Workflow

1. Work from the repo root.
2. Prefer the direct backing script:

   ```bash
   node scripts/aos-dev-situation.mjs --json
   ```

   Use `--repo <path>` only when orienting a different checkout.
3. Read `sources` before trusting derived fields. Failed sources mean partial orientation, not permission to invent missing facts.
4. Use the packet for branch, dirty-state, ahead/behind, open PR/issue, successor-note, and readiness context.
5. Re-read the applicable `AGENTS.md` chain and any user-named handoff, plan, SHA, PR, or checkpoint before editing.

## References

- `scripts/aos-dev-situation.mjs`
- `scripts/aos-dev-gh.mjs`
- `docs/dev/README.md`
- `docs/dev/command-surface.md`
- `tests/dev-situation.sh`

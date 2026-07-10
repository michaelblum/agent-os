---
name: aos-repo-binary-build
description: Run the raw repo-local AOS binary build workflow safely. Use inside agent-os when ./aos is missing, exits 137, Swift or native runtime inputs changed, build verification is requested, or TCC/Cylance-sensitive repo binary rebuild handling matters; call node scripts/aos-dev-build.mjs build or bash build.sh --force --no-restart when ./aos is dead.
---

# AOS Repo Binary Build

Use this skill for repo-mode `./aos` build checks and rebuilds.

## Workflow

1. Route the changed paths first unless the user explicitly requested a build:

   ```bash
   node scripts/aos-dev-workflow.mjs recommend --json --paths <changed paths>
   ```

2. Prefer the direct build wrapper:

   ```bash
   node scripts/aos-dev-build.mjs build --no-restart --json
   ```

   Add `--force` only when the task requires a rebuild or the existing binary is missing/broken.
3. If `./aos` is unavailable or exits `137`, recover with the raw repo build path:

   ```bash
   bash build.sh --force --no-restart
   ```

4. If JSON reports `binary_rebuilt: false`, continue with the recommended non-rebuild checks.
5. If JSON reports `binary_rebuilt: true` or stdout contains `Rebuilt: ./aos`, stop before TCC-backed daemon, capture, input, or native proof. Ask the user to reset/regrant the needed macOS permissions, then resume with:

   ```bash
   ./aos ready --post-permission --json
   ```

## Boundaries

Do not add post-build signing, entitlements, app-bundle wrapping, `spctl` acceptance gates, allowlist assumptions, or automated TCC resets. Treat endpoint-security kills as inconclusive runtime policy, not proof that the build logic is wrong.

## References

- `build.sh`
- `scripts/aos-dev-build.mjs`
- `scripts/AGENTS.md`
- `docs/dev/command-surface.md`
- `tests/help-contract.sh`

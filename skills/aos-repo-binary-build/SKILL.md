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
5. If JSON reports `binary_rebuilt: true` or stdout contains `Rebuilt: ./aos`, keep the raw artifact and run one bounded readiness check before TCC-backed daemon, capture, input, or native proof:

   ```bash
   ./aos ready --post-permission --json
   ```

   Continue when readiness is healthy. Stop and ask the user to reset/regrant
   permissions only when readiness explicitly reports
   `post_rebuild_tcc_stale`.

## Boundaries

Do not add post-build signing, an explicit organization identifier,
entitlements, app-bundle wrapping, `spctl` acceptance gates, allowlist
assumptions, or automated TCC resets. Do not infer exit `137` from empty output,
a timeout, or a failed readiness wrapper; capture the actual process exit status
and diagnose the same artifact first. Treat confirmed endpoint-security kills as
runtime policy, not proof that the build logic is wrong.

## References

- `build.sh`
- `scripts/aos-dev-build.mjs`
- `scripts/AGENTS.md`
- `docs/dev/command-surface.md`
- `tests/help-contract.sh`

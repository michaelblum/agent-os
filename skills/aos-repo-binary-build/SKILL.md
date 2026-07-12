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
5. If JSON reports `binary_rebuilt: true` or stdout contains `Rebuilt: ./aos`, keep the raw artifact. The immediately following command must be:

   ```bash
   ./aos help --json
   ```

   Do not hash, inspect, copy, move, sign, attest, or run readiness against the
   live artifact before this first launch. Stop immediately on exit `137`.
6. If help succeeds, stop immediately for the human TCC checkpoint. Do not
   inspect the artifact or run another command.
7. Only after the user replies `finished`, run exact
   `./aos ready --repair --post-permission --json` with no intervening command.
   Continue only when that bounded check is healthy.

## Boundaries

The raw build may pass `packaging/RepoRuntimeLinkInfo.plist` to the existing
`swiftc` invocation as `__TEXT,__info_plist` linker input. That plist must stay
separate from packaged metadata and must not declare identity. Do not invoke
`ld` separately or add post-link signing, copying, moving, installation-name
editing, entitlements, app wrapping, `spctl` gates, or explicit identifiers.
Do not infer exit `137` from empty output, a timeout, or a failed readiness
wrapper; capture the actual process exit status and stop at the prescribed
checkpoint. Treat confirmed endpoint-security kills as runtime policy, not
proof that the build logic is wrong.

## References

- `docs/adr/0023-managed-endpoint-raw-repo-artifact.md`
- `build.sh`
- `scripts/aos-dev-build.mjs`
- `scripts/AGENTS.md`
- `docs/dev/command-surface.md`
- `tests/help-contract.sh`

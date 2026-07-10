# Residue And Drift Ledger

This ledger records compatibility residue that has been deleted, quarantined,
or intentionally retained. It is current-state documentation, not a migration
plan.

| Surface | Status | Owner | Validation |
| --- | --- | --- | --- |
| `aos dev` command surface | deleted | `manifests/commands/source/`, retained local maintainer skills, direct `scripts/aos-dev-*.mjs` scripts | `bash tests/help-contract.sh`; negative assertion: `./aos help dev --json` returns `UNKNOWN_COMMAND` |
| `aos ops` command surface | deleted | `manifests/commands/source/`, canonical `aos recipe` manifests, `scripts/aos-recipe.mjs` implementation | `bash tests/help-contract.sh`; `bash tests/external-command-dispatch.sh`; negative assertions: `./aos help ops --json` and `./aos ops list --json` return `UNKNOWN_COMMAND` |
| Retired broad skills: `agent-sync`, `aos-agent-workspace`, `browser-adapter` | retained tombstones | `skills/registry.json`, each skill `SKILL.md`, ADR 0018 | `node scripts/aos-skills-validate.mjs --json`; `node --test tests/aos-skills-registry.test.mjs`; registry status is `retired` and `installable:false` |
| Maintainer workflow skills | retained local | `skills/aos-maintainer-routing`, `skills/aos-repo-binary-build`, `skills/aos-maintainer-orientation` | `node --test tests/aos-skills-registry.test.mjs`; registry status is `retained_local`, `installable:false`, and `target_support:[]` |
| Foreman/GDI active authority, successor role, and developer work cards | deleted | ADR 0019, repo DOX, `scripts/aos-dev-situation.mjs`, current work cards under `docs/design/work-cards/` | `node --test tests/active-authority-pointers.test.mjs`; `bash tests/dev-situation.sh`; negative assertion: active authority contains no retired role names or paths |
| Retired project-agent and subagent invocation paths | intentionally retained fail-closed guard | ADR 0019, `scripts/aos-dev-workflow.mjs`, hook and routing tests | `bash tests/hook-config.sh`; `bash tests/dev-workflow-router.sh`; stale invocation fails instead of selecting a project agent |
| Historical Foreman/GDI reports and accepted retirement ADR | historical-only, non-authoritative | `docs/dev/reports/`, `docs/archive/`, `docs/adr/0019-retire-project-agent-orchestration.md` | `bash tests/dev-drift-lint.sh`; active-authority guard excludes historical evidence and scans current operational roots |
| Generated command manifests and inventory | generated artifacts | Source manifests under `manifests/commands/source/` plus generator scripts | `node scripts/generate-command-manifests.mjs --check`; `bash tests/command-manifest-generation.sh` |
| Gate continuation `session.dock` records | quarantined legacy boundary | `packages/daemon/gate/continuations.js` | `node --test tests/daemon/gate-continuations.test.mjs`; stale records fail closed instead of normalizing into new writes |
| Daemon IPC legacy shapes | quarantined legacy boundary | `src/daemon/unified.swift`, `shared/schemas/daemon-ipc.md`, IPC request helpers | `bash tests/daemon-ipc-schema.sh`; legacy flat requests remain rejected at the schema boundary except explicit documented carve-outs |
| Legacy daemon input-tap health fields | quarantined read-normalization boundary | `src/shared/input-tap-health.swift` | `bash tests/input-tap-readiness-legacy.sh`; legacy daemon reads normalize without fabricating current permission fields |

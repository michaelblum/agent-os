---
name: aos-command-surface-maintenance
description: Maintain AOS command surfaces, help, manifests, docs, and tests. Trigger when an agent changes ./aos commands, external wrappers, source command manifests, generated command registries, parser flags, or public command documentation.
---

# AOS Command Surface Maintenance

Use this skill when changing command behavior or public command contracts.

## Edit Surface

1. Start from source command manifests and the owning external wrapper.
2. Keep exact syntax discoverable through `./aos help --json` and
   `./aos help <command> --json`.
3. Update durable docs only for stable contracts, not transient parser details.
4. Regenerate derived command manifests after source-manifest changes.
5. For the accepted ADR 0044 external-command migration, preserve the v0
   schema byte-exact and treat the proposed v1 schema, aggregate wire version 2,
   single authored `listen` registration, generator, Swift/help readers, proof
   routing, and installed projections as one atomic cutover. Do not introduce a
   dual reader, translation path, parallel aggregate, or partial v1 publication.

## Verification

Run the focused command test plus the gates recommended by
`node scripts/aos-dev-workflow.mjs recommend --json --paths ...`. Typical command-surface gates include:

- `node scripts/generate-command-manifests.mjs --check`
- `bash tests/help-contract.sh`
- `bash tests/external-command-dispatch.sh`
- `bash tests/external-parser-flags.sh`
- the active external-command manifest schema proof (v0 until the atomic ADR
  0044 v1 cutover moves active readers and routing together)

## Stop

Stop when a public route would move into Swift without a native-boundary reason,
help and parser contracts disagree, generated manifests drift, or docs teach a
wrapper instead of the direct `./aos` surface.

Also stop on any proposal to add a `dev` command family or route. Maintainer
workflows belong in retained local skills backed by deterministic repo scripts,
not hidden `./aos dev ...` plumbing.

## References

- `docs/api/aos.md`
- `manifests/AGENTS.md`
- `scripts/AGENTS.md`
- `tests/help-contract.sh`
- `tests/external-command-dispatch.sh`

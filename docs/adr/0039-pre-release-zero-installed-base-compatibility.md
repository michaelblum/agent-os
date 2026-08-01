# ADR 0039: Pre-Release Zero-Installed-Base Compatibility Policy

**Status:** Accepted
**Date:** 2026-08-01

## Context

AOS is pre-release. It has never been distributed, has no external installed
base, and has no external compatibility obligations. Internal consumers are
under coordinated ownership and can migrate atomically.

Retired aliases, tombstones, redirects, dual-read paths, and compatibility-only
metadata create active product surface without serving an installed user. They
also let superseded implementation remain discoverable and make current
contracts harder to identify.

## Decision

- Treat zero installed base as a hard product invariant until a later ADR and
  machine declaration change the maturity stage.
- Migrate internal consumers atomically and delete superseded implementation,
  registries, manifests, help, tests, and current documentation in the same
  change.
- Do not preserve active tombstones, aliases, redirects, dual-write paths, or
  legacy decoders for possible future need.
- Permit compatibility residue only for evidence of an actual external
  consumer or a persisted-data dependency. Every exception must name its owner,
  justification, evidence reference, active paths, removal condition or
  milestone, and focused regression test.
- Keep approved exceptions in `docs/dev/product-maturity.json`. Mark each
  declared active source path with its exception id so static validation can
  prove exact ownership without broad compatibility-word searches.
- Scope enforcement to active product and source surfaces. Archived ADRs,
  reports, historical fixtures, and other clearly historical evidence do not
  become violations merely because they describe an old contract.

## Skill Product Consequence

ADR 0018's retired root-skill tombstone requirement is superseded. The obsolete
`agent-sync`, `aos-agent-workspace`, and `browser-adapter` skill packages,
registry rows, redirects, and compatibility-only tests are deleted. Current
saved-workspace and browser implementations that happen to share historical
terms remain owned by their active command, schema, and source contracts.

The skill validator rejects retired registry states and retired package
frontmatter so this product failure cannot return through live metadata.
Historical names needed to measure model efficacy belong only in a
non-discoverable test fixture.

## Machine Contract And Enforcement

`docs/dev/product-maturity.json` is the machine-readable maturity and exception
ledger. `shared/schemas/aos-product-maturity-v0.schema.json` owns its shape.
Focused static tests validate the declared zero-installed-base facts, exception
evidence, exact active-path markers, regression-test ownership, and absence of
retired skill discovery surfaces.

## Consequences

- Git and ADRs preserve history; active product surfaces describe the current
  product only.
- A compatibility exception is reviewable debt with a named removal route, not
  a default implementation technique.
- A real distribution or external compatibility commitment requires a new ADR,
  a product-maturity declaration update, and a migration policy appropriate to
  that installed base.

## Verification

```bash
node --test tests/pre-release-compatibility-policy.test.mjs tests/schemas/aos-product-maturity-v0.test.mjs
node scripts/aos-skills-validate.mjs --json
node --test tests/aos-skills-registry.test.mjs
git diff --check
```

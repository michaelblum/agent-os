@../AGENTS.md

# Experiences

## Purpose

`experiences/` is the discovery root for active repository-owned experience
manifests. It currently ships no active experience manifest.

## Ownership

- Active manifests placed here connect repository-owned experiences to AOS
  runtime activation.
- Active branded product implementation remains in the product repository;
  this tree does not confer product ownership.
- Generic experience schema or validation belongs in `shared/schemas/` and
  tests.

## Local Contracts

- Keep experience ids, content roots, and declared surfaces aligned with their
  active owner. Compatibility-only manifests belong under `tests/fixtures/`.
- Menu entries with a `surface` must target declared surfaces. Experience
  activation does not own native status-item projection or menu dispatch.
- Do not encode branded product behavior here when it belongs in an external
  product repository or generic behavior that belongs in toolkit policy.

## Work Guidance

## Verification

- Run the existing experience or status command check named by the changed file
  when present.

## Child DOX Index

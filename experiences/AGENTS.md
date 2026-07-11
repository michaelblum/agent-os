@../AGENTS.md

# Experiences

## Purpose

`experiences/` contains retained neutral experience activation fixtures and
compatibility composition metadata.

## Ownership

- Experience files connect neutral fixtures to AOS runtime activation and
  status surfaces.
- Active branded product implementation remains in the product repository;
  this tree does not confer product ownership.
- Generic experience schema or validation belongs in `shared/schemas/` and
  tests.

## Local Contracts

- Keep experience ids, content roots, status-item targets, and fixture
  references aligned with the owning compatibility proof.
- Menu entries with a `surface` must target declared mounted surfaces.
  Activation projects matching manifest menu data into the mounted status
  surface through the neutral toolkit mounted-surface menu projection contract;
  smoke surfaces must not duplicate fixture menu data as their source of truth.
- Do not encode branded product behavior here when it belongs in an external
  product repository or generic behavior that belongs in toolkit policy.

## Work Guidance

## Verification

- Run the existing experience or status command check named by the changed file
  when present. For status-item menu contracts, include
  `tests/aos-experience-menu-invoke.test.mjs`.

## Child DOX Index

- `operator-fixture/` contains the neutral compatibility fixture for operator
  annotation status-menu contracts.

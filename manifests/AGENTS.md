@../AGENTS.md

# Manifests

## Purpose

`manifests/` contains command and capability manifests used by AOS tooling and
developer command surfaces.

## Ownership

- `commands/` owns external command routing metadata.
- Schema shape belongs in `shared/schemas/`.
- Runtime adapters live in `scripts/` or `src/` depending on the boundary.

## Local Contracts

- Keep manifest entries strict, discoverable, and synchronized with help output
  and tests.
- When one command form has alternative required argument sets, express them in
  `constraints.required_groups` so JSON help and rendered help can explain the
  valid choices without marking direct-form-only flags as unconditionally
  required.
- Do not add commands that bypass the sanctioned `./aos` control surface unless
  the lower-level adapter is the explicit subject.

## Work Guidance

## Verification

- Use `bash tests/external-command-dispatch.sh` and
  `node --test tests/schemas/aos-external-command-manifest-v0.test.mjs` for
  command manifest changes.

## Child DOX Index

- `commands/` contains external command manifests.

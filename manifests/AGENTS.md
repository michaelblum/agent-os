@../AGENTS.md

# Manifests

## Purpose

`manifests/` contains command and capability manifests used by AOS tooling and
developer command surfaces.

## Ownership

- `commands/source/aos/` owns command help/registry authoring files. In those
  files, `id` names the source slice and `path_prefix` owns the public command
  family; split large families into multiple mergeable source slices.
- `commands/source/external/` owns external route authoring files.
- `commands/aos-commands.json` and `commands/aos-external-commands.json` are
  generated compatibility artifacts consumed by help, dispatch, tests, and
  package/runtime surfaces.
- Schema shape belongs in `shared/schemas/`.
- Runtime adapters live in `scripts/` or `src/` depending on the boundary.

## Local Contracts

- Keep manifest entries strict, discoverable, and synchronized with help output
  and tests.
- Edit source manifests first, then run
  `node scripts/generate-command-manifests.mjs` so the generated top-level
  artifacts stay byte-stable.
- Preserve the generated artifact paths; runtime/help consumers and
  `AOS_COMMAND_REGISTRY` / `AOS_EXTERNAL_COMMAND_MANIFEST` overrides depend on
  those files.
- Generated top-level command manifests must carry deterministic provenance
  metadata naming `manifests/AGENTS.md`, their source manifest root, and
  `node scripts/generate-command-manifests.mjs`. Do not hand-edit generated
  content except by changing the generator and regenerating.
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
- Use `bash tests/command-manifest-generation.sh` for command source/generator
  drift checks.
- Use `./aos dev recommend --json --paths <changed-paths>` to confirm source
  manifests and generator edits route to command-surface verification.

## Child DOX Index

- `commands/` contains command source manifests and generated compatibility
  manifests.

@../AGENTS.md

# Manifests

## Purpose

`manifests/` contains command and capability manifests used by AOS tooling and
developer command surfaces.

## Ownership

- `companions/` owns exact reviewed external tool/runtime descriptors and its
  child DOX.
- `commands/source/aos/` owns command help/registry authoring files. In those
  files, `id` names the source slice and `path_prefix` owns the public command
  family; split large families into multiple mergeable source slices.
- `commands/source/external/` owns external route authoring files.
- The source help route uses `$AOS_REPO_ROOT` for both its proxy argument and
  working directory so repo and installed dispatch resolve from the bundled
  resource root independently of the caller working directory.
- `commands/aos-commands.json` and `commands/aos-external-commands.json` are
  generated compatibility artifacts consumed by help, dispatch, tests, and
  package/runtime surfaces.
- Schema shape belongs in `shared/schemas/`.
- Runtime adapters live in `scripts/` or `src/` depending on the boundary.

## Local Contracts

- Keep manifest entries strict, discoverable, and synchronized with help output
  and tests.
- Describe `--dry-run` as optional mechanics unless the command itself is the
  explicit dry-run operation. Command help must not teach dry-run, Gate, or a
  Work Record as permission to perform an otherwise caller-requested action.
- Edit source manifests first, then run
  `node scripts/generate-command-manifests.mjs` so the generated top-level
  artifacts stay byte-stable.
- Preserve the generated artifact paths; runtime/help consumers and
  `AOS_COMMAND_REGISTRY` / `AOS_EXTERNAL_COMMAND_MANIFEST` overrides depend on
  those files.
- For program `aos-sovereign-capability-substrate-v1`, accepted ADR 0044
  preserves `shared/schemas/aos-external-command-manifest-v0.schema.json`
  byte-exact while the active v1 cutover keeps authored external fragments at
  source schema version 1. The stable generated external aggregate uses wire
  schema version 2, exactly `source/external/15-listen.json` owns
  the optional closed generation-bound microphone spawn registration, and the
  generator, Swift dispatcher, help proxy, command-surface proofs, workflow
  routing, and installed projections are v1-only. Do not add v1 fields to v0,
  hand-edit the aggregate, introduce a dual reader or translation layer, or
  publish another aggregate path.
- Generated top-level command manifests must carry deterministic provenance
  metadata naming `manifests/AGENTS.md`, their source manifest root, and
  `node scripts/generate-command-manifests.mjs`. Do not hand-edit generated
  content except by changing the generator and regenerating.
- When one command form has alternative required argument sets, express them in
  `constraints.required_groups` so JSON help and rendered help can explain the
  valid choices without marking direct-form-only flags as unconditionally
  required.
- Admit a new public top-level family only with evidence that it cannot fit an
  existing family, plus a source-manifest prefix, capability-group assignment,
  route or native ownership reason, generated help, consumer docs, focused
  tests, and compatibility posture. Depth or analogy alone is not sufficient.
- Do not add commands that bypass the sanctioned `./aos` control surface unless
  the lower-level adapter is the explicit subject.

## Work Guidance

## Verification

- Use `bash tests/external-command-dispatch.sh` and the active external-command
  manifest schema proofs for command manifest changes:
  `node --test tests/schemas/aos-external-command-manifest-v0.test.mjs tests/schemas/aos-external-command-manifest-v1.test.mjs`.
- Use `bash tests/command-manifest-generation.sh` for command source/generator
  drift checks.
- Use `node scripts/aos-dev-workflow.mjs recommend --json --paths <changed-paths>`
  to confirm source manifests and generator edits route to command-surface
  verification.

## Child DOX Index

- `companions/AGENTS.md` owns reviewed managed companion descriptors.
- `commands/` contains command source manifests and generated compatibility
  manifests.

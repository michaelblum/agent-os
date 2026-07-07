@../../AGENTS.md

# AOS Skills Script Modules

## Purpose

`scripts/lib/aos-skills/` contains the focused implementation modules behind
`aos skills ...` and `scripts/aos-skills-validate.mjs`.

## Ownership

- `registry.mjs` is the high-level facade and export surface for callers.
- `validation.mjs` owns `skills/registry.json` validation, SKILL frontmatter
  parsing, package shape checks, body-budget checks, and backing/reference
  validation.
- `catalog.mjs` owns registry loading, source package enumeration, package
  digests, list output, and skill selection.
- `install-targets.mjs` owns target root resolution, path expansion,
  containment checks, install path helpers, and target payload projection.
- `installed-state.mjs` owns installed manifest reads, package drift
  classification, recoverable manifestless AOS partial detection, and check
  output summaries.
- `installer.mjs` owns dry-run install plans and non-dry-run install
  application. Non-dry-run writes must stage a complete skill package under the
  target root before promoting it into place.
- `companions.mjs` owns Playwright CLI companion checks. Playwright-looking text
  is only a candidate signal; installed companion state requires a
  Playwright-owned package identity.
- `command-shape.mjs` owns manifest-backed validation for direct `./aos`
  command examples in skills efficacy evidence and forward-proof fixtures.
- `eval.mjs` owns deterministic captured-response scoring and prompt-packet
  emission for AOS skill efficacy across provider/model/reasoning matrices.
- `captured-runs.mjs` owns captured response run filenames and atomic,
  no-clobber-by-default run-file writes.
- `openai-responses-runner.mjs` owns the capture-only OpenAI Responses adapter.
  It must require explicit `adapter: "openai-responses"` matrix rows, centralize
  OpenAI option validation, and write response JSON that `eval.mjs` scores.

## Local Contracts

- Keep `aos skills list/check/install/companion` payload schema versions and
  public command shape stable unless the owning command manifest and tests
  change in the same patch.
- Keep AOS first-party skill installs separate from Playwright-owned companion
  packages. AOS must not vendor or claim Playwright companion skill content.
- Skill efficacy scoring must validate direct `./aos` command shapes against
  the generated command manifest, including required args, required groups, and
  conflicts. Treat retired skills, unsupported flags, raw daemon probes, and
  project-local wrappers as measurable failures.
- Treat unmanaged install target content as blocking. Only exact AOS package
  files without a manifest are recoverable as interrupted AOS writes.
- Staging paths are AOS-owned scratch state under the target root. Stale staging
  directories may be removed, but non-directory or symlink staging paths must
  fail closed.
- Keep `../aos-skills-registry.mjs` as a compatibility re-export only.

## Work Guidance

- Do not add another large mixed-responsibility registry module. Add behavior to
  the module that owns that responsibility, or split again if a module grows
  beyond a focused owner.
- Preserve deterministic JSON payload ordering for list, check, install, and
  companion outputs.
- Preserve evidence-safe capture writes: live provider adapters must not
  overwrite existing captured-run files unless an explicit replace option is set.

## Verification

- For validation/catalog changes, run
  `node --test tests/aos-skills-registry.test.mjs`.
- For target, installed-state, staging, or install planning/application changes,
  run `node --test tests/aos-skills-command.test.mjs`.
- For companion detection changes, run
  `node --test tests/aos-skills-companion.test.mjs`.
- For efficacy scoring or prompt-packet changes, run
  `node --test tests/aos-skills-eval.test.mjs`.
- For command-surface changes, run
  `node scripts/generate-command-manifests.mjs --check`,
  `bash tests/help-contract.sh`, and
  `bash tests/external-command-dispatch.sh`.

## Child DOX Index

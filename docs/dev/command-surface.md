# AOS Command Surface

The repo-mode `./aos` binary is no longer the source of truth for public command
behavior. Its command entry point should stay limited to stable infrastructure:

- loading `manifests/commands/aos-external-commands.json`;
- dispatching matching public command paths to external scripts;
- native bootstrap and TCC-sensitive primitives behind private `__...` routes;
- daemon socket, readiness, permissions, service, and native input/perception
  primitives that cannot live in a hot-swappable script.

Public command behavior, help metadata, argument shapes, and workflow policy
belong outside the Swift binary:

- `manifests/commands/aos-commands.json` is the discoverable help/registry
  source of truth;
- `manifests/commands/aos-external-commands.json` maps public command paths to
  external implementations;
- `scripts/aos-*.mjs`, Python helpers, shell wrappers, and package CLIs contain
  command implementation logic;
- `docs/dev/workflow-rules.json` tells agents which checks to run after command
  registry, manifest, schema, or test changes.

## Dispatcher Contract

External routes match the longest public path first. Duplicate public paths are
allowed only when every duplicate route has a `when` condition and the
conditions select distinct cases. Current examples include browser-vs-native
`do click` routing and `see` help-vs-default-capture routing.

Routes that point back to `$AOS_PATH` are restricted to bootstrap-native
families: `serve`, `status`, `ready`, `doctor`, and `permissions`. Other public
routes must go through external scripts or wrappers.

Manifest placeholders must be values the Swift dispatcher resolves, such as
`$REPO_ROOT`, `$AOS_PATH`, `$AOS_RUNTIME_MODE`, `$AOS_STATE_ROOT`,
`$AOS_SESSION_KEY`, `$AOS_SESSION_HARNESS`, and
`$AOS_INVOCATION_DISPLAY_NAME`.

## Verification

For command surface changes, run the workflow recommendation first:

```bash
./aos dev recommend --json --paths <changed-paths>
```

The usual hot-swappable command-surface checks are:

```bash
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
```

Schema changes also require:

```bash
node --test tests/schemas/*.test.mjs
```

Swift source changes still require the repo-mode build and post-permission
readiness path, but command metadata and external implementation changes should
not require rebuilding the TCC-sensitive binary.

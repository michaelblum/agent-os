# AOS Command Surface

The repo-mode `./aos` binary is a stable TCC capability broker, not the source
of truth for public command behavior. Its command entry point must stay limited
to stable infrastructure:

- loading `manifests/commands/aos-external-commands.json`;
- dispatching matching public command paths to external scripts;
- native bootstrap and TCC-sensitive primitives behind private `__...` routes;
- daemon socket, service, and native input/perception/display/communication
  primitives that cannot live in a hot-swappable script.

Public command behavior, help metadata, argument shape, workflow policy,
recovery policy, next actions, and presentation text belong outside the Swift
binary:

- `manifests/commands/aos-commands.json` is the discoverable external help
  manifest and command metadata source of truth;
- `manifests/commands/aos-external-commands.json` maps public command paths to
  external implementations;
- `scripts/aos-*.mjs`, Python helpers, shell wrappers, packages, and recipes
  contain command implementation logic and public workflow composition;
- `docs/dev/workflow-rules.json` tells agents which checks to run after command
  metadata, external-route manifest, implementation, schema, or test changes.

The broker may expose privileged facts, privileged actions, and privileged
streams through private stable primitives. External layers interpret and compose
those primitives into public command behavior. See
`docs/adr/0015-aos-tcc-capability-broker-boundary.md`.

## Dispatcher Contract

External routes match the longest public path first. Duplicate public paths are
allowed only when every duplicate route has a `when` condition and the
conditions select distinct cases. Current examples include browser-vs-native
`do click` routing and `see` help-vs-default-capture routing.

Routes that point back to `$AOS_PATH` are temporary extraction candidates unless
they are true bootstrap/native primitive surfaces. Current bootstrap-native
families include `serve`, `status`, `ready`, `doctor`, and `permissions`, but
their public behavior should keep shrinking toward external composition. Other
public routes must go through external scripts, packages, recipes, or wrappers.

Future work should extract `ready`, `doctor`, `status`, and permission workflow
policy by exposing smaller private broker primitives and moving public behavior
to scripts or other composition code. Swift should retain only the privileged
native facts/actions/streams and daemon/socket behavior required to make those
external commands reliable.

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

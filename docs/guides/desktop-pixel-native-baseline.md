# Desktop Pixel Native Baseline

`aos runtime probe desktop-pixels` is a temporary, explicit development proof.
It answers one question before any daemon, broker, consent, scene-resource, or
consumer abstraction participates: can the current AOS executable move current
desktop pixels from ScreenCaptureKit to one Metal surface per active display?

The command:

- uses only an existing Screen Recording grant and never requests permission;
- keeps captured pixels in memory and emits content-free timing facts;
- starts no daemon and uses no scene or desktop-pixel broker;
- bounds display count, pixels, presentation time, and visible duration;
- ignores pointer input and disposes streams, textures, views, and windows
  before returning.

Run it only at a supervised native checkpoint with the daemon and product
consumers stopped:

```bash
./aos runtime probe desktop-pixels \
  --presentation inverted \
  --hold-ms 750 \
  --json
```

`identity` presents captured pixels unchanged. `inverted` is a visible proof
transform; it is not a reusable effect contract.

This command is not a consumer API and must not be invoked by Sigil. A passing
result establishes the native baseline for subsequent increments. Each later
layer must rerun the same proof before it can replace or absorb this path:

1. existing display topology and window ownership;
2. an addressable AOS resource;
3. budgets and deterministic disposal;
4. reviewed consumer effect parameters and event triggers;
5. gesture and scene coordination;
6. explicit permission priming and passive consent status;
7. bounded image-product adapters for perception, crops, redaction, and diffs.

The intended product path is in-process and event-driven. A loaded consumer
cartridge may bind a companion affordance event such as pointer-down to a named,
reviewed native effect and bounded parameters. AOS resolves that binding against
its trusted implementation registry and runs it on the already-owned capture,
topology, clock, and Metal resources; it does not spawn this proof command for
each interaction. Agent-facing scene or `show` tooling may later invoke and
inspect the same addressable resource, but that is a manual/debug route rather
than the interaction hot path.

Do not backfill an existing abstraction merely because it already exists. A
layer is retained only when the unchanged native proof remains green and the
layer provides a necessary ownership or safety property.

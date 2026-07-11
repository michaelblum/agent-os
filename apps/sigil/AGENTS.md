@../../AGENTS.md

# Frozen Legacy Sigil Fixture

## Authority

Active Sigil product authority lives in
[`Ch-osctrl/sigil`](https://github.com/Ch-osctrl/sigil). This embedded tree is a
frozen compatibility and proof fixture, not an AOS application source root.

## Invariants

- Do not add product features, launch instructions, recipes, packaging, or live
  runtime acceptance here.
- Do not restore `aos-app.json`, an active experience manifest, content-root
  registration, or a compatibility alias.
- Fixture bytes may change only for an explicit compatibility rebaseline. Any
  such change must update the machine-readable baseline and deterministic proof.
- Product behavior tests belong in the external Sigil repository. AOS may test
  only fixture integrity and generic substrate contracts.

## Verification

Run the non-live fixture proof registered under
`docs/dev/test-proof-registry.d/legacy-sigil-fixture.json`.

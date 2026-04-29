# Target Probe

`target.probe` is the compact structured packet for target acquisition in AOS.
It answers: what is the human pointing at, what surface contains it, what cheap
context is available now, and what handles can be used for deeper inspection.

Canonical schema:

- `shared/schemas/target-probe.schema.json`

Current producers:

- `aos see target --json` for one-shot native cursor/window/AX probing.
- `aos see observe --depth 2` via the additive `target_changed` event.
- `aos inspect`, which renders `target_changed` when available and preserves
  the legacy `element_focused` path for compatibility.

The packet is intentionally substrate-level. Browser refs, DOM selectors,
locator candidates, and viewport rectangles are adapter-specific details that
belong in target fields or explicit expansions; the shared contract stays
focused on origin, surface, target, path, nearby context, handles, available
expansions, privacy, budgets, and time.

## Projection Relationship

Steerable collection should treat `target.probe` as sitting below
`human.mark`:

```text
browser point/selection/region
  -> target.probe
  -> human.mark
  -> agent.mark.acknowledged
  -> evidence-item
  -> source-pack projection
```

Supervised testing and research intake use the same primitive with different
domain events:

```text
test step visual check -> target.probe -> test.human.confirmed / failed
research artifact focus -> target.probe -> intake.requested
```

## Budgeting

The default fast probe should stay small and quick. It may include cheap
adjacent context when the adapter can fetch it in the same pass. Expensive
deeper reads should be exposed through `available_expansions` and addressable
handles instead of being pulled into every probe.

# Steerable Collection Schemas

These schemas define the browser-only V0 substrate for steerable collection.
They are intentionally narrower than the long-term platform: desktop sensing,
voice attribution, replay codegen, and audit-workflow normalization are follow-up
contracts.

## Files

- `run-control.schema.json`: run-control commands and safety-gate events.
- `agent-action.schema.json`: proposed/executed/skipped/blocked actions,
  artifact-referenced observations, and mark acknowledgements.
- `intent-event.schema.json`: human intent, mark, annotation, override, and
  takeover events.
- `human-mark.schema.json`: the browser mark refinement with locator candidates.
- `evidence-item.schema.json`: V0 evidence records.
- `source-pack.schema.json`: `source-pack.json` metadata.

Related non-browser intake work uses `research-intake-pack.schema.json` rather
than extending this browser-only contract.

## Locator Strategy

Browser marks use `locator_strategy_version: "aos.browser-locator.v0"`.
`locator_candidates[]` stores all known candidates and `selected_locator`
records the deterministic primary selection. V0 candidate priority is
`role_name`, then `text`, then `css`, then `ref`, then `rect`.

Every candidate must carry `validated_at_mark_time`. Future replay codegen may
re-rank candidates, but it should not mutate already-collected source packs.

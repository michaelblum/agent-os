# Steerable Collection

Steerable collection V0 is an experimental browser-only contract family. The
canonical schemas live under `shared/schemas/` and the deterministic sample
source pack lives under `docs/superpowers/artifacts/v0-demo/source-pack/`.

## Contract Family

- `run-control.schema.json`: `run.control` and `safety_gate.*` events.
- `agent-action.schema.json`: `agent.action.*`, `agent.observation`, and
  `agent.mark.acknowledged` events.
- `intent-event.schema.json`: `human.intent`, `human.mark`,
  `human.annotation`, `human.override`, and `human.takeover` events.
- `human-mark.schema.json`: browser mark records with locator candidates.
- `evidence-item.schema.json`: evidence records stored in source packs.
- `source-pack.schema.json`: `source-pack.json` metadata.

## Source Pack

A live run writes to:

```text
~/.config/aos/{mode}/source-packs/<session_id>/
```

The format version is `0.1.0`. Timeline events are append-only JSONL. Large
observations are artifact-referenced rather than inlined.

## Browser Locator Strategy

V0 marks use `locator_strategy_version: "aos.browser-locator.v0"`. Candidate
priority is `role_name`, then `text`, then `css`, then `ref`, then `rect`.
Every locator candidate includes `validated_at_mark_time`.

## Boundary

This API is experimental and browser-only. Desktop sensing, replay codegen,
Employer Brand Audit workflow, Swift-side schema validation, voice attribution,
and freehand draw mode are out of scope for V0.

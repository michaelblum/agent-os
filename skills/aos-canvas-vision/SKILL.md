---
name: aos-canvas-vision
description: Use AOS canvas and vision fallback safely. Trigger when a task needs regions, coordinates, xray, labels, canvas refs, visual evidence, or a decision about coordinate fallback.
---

# AOS Canvas And Vision

Use this skill when saved refs are unavailable or when visual proof is the
right evidence. Vision and coordinates are ordinary AOS primitives; the caller
chooses them and AOS enforces current-state mechanics.

## Start

1. Inspect `./aos help see --json` and `./aos help do --json`.
2. Capture the narrowest useful target: `main`, `user_active`, `--window`,
   `--region`, `--canvas`, or `--channel`.
3. Add `--xray --label` when element labels will reduce coordinate guessing.
4. Use `--save --workspace <id>` when refs or a later diff are needed.
5. Keep raw artifacts or apply an explicit caller-owned persistence, masking,
   compacting, or projection transform.

## Action Rules

- Prefer an exact current Observation Ref or Locator when available. Current
  direct `canvas:<canvas-id>/<ref>` and saved-ref strings remain implementation
  transport.
- Use coordinates only with explicit target proof and a `--state-id` when the
  action was chosen from a prior capture.
- Recapture after any visual fallback action.
- Use `./aos see refs --diff <before>..<after> --expect ...` when compact refs
  can prove the effect.

## Stop

Stop when a coordinate is stale, a ref is fallback-only, xray labels do not
identify the target, a canvas ref is not current, or visual proof would require
live input/TCC state outside the task.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `tests/agent-workspace-canvas-refs.sh`

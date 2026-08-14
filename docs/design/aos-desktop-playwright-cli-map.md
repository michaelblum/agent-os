# AOS Desktop Playwright CLI Map

Date: 2026-07-07
Status: maintained consumer crosswalk; not command, target-handle, or roadmap
authority

This crosswalk originated as the M0 baseline for issue #587. It now maps the
current AOS command surface to the "Playwright CLI, but for the desktop" product
model. Exact behavior remains owned by current API docs and source manifests.

## ADR 0040 Target Boundary

Playwright's broad “Locator” analogy does not define AOS target identity. Target
Handle Runtime V1 implements ADR 0040's split between an ephemeral Observation
Ref `(state_id, ref)` and an action-time machine-fact Locator. A ref-bearing
browser target string plus its original `--state-id` carry an Observation Ref
pair; canvas targets and native AX selector flags carry Locators; saved
addresses are storage indirection to one of those handles; coordinates are
neither. These command forms do not add target types.

## Current Readback

Authoritative sources for this map:

- `./aos help --json`
- `./aos skills list --json`
- `docs/api/aos.md`
- `docs/adr/0018-installable-aos-skills.md`
- `manifests/commands/source/aos/`

## Concept Map

| Playwright CLI concept | AOS desktop analogue |
| --- | --- |
| Browser/session | Focus channel, app/window/display target, or browser companion channel |
| Snapshot/screenshot | `aos see capture`, `--xray`, labels, regions, windows, and `--save` |
| Locator | ADR 0040 action-time machine query; canvas targets and native AX selectors are Locators, a ref-bearing browser string plus its original `--state-id` carry an Observation Ref pair, saved addresses store one typed handle, and coordinates are neither |
| Click/fill/type/key/hover/drag/scroll | `aos do ...` action matrix |
| Vision mode | Region capture, coordinate fallback, labels, xray, and canvas/visual proof |
| Capabilities | AOS capability groups in `docs/api/aos-capabilities.md` |
| Testing/assertions | Recapture, `aos see refs --diff --expect`, Recipe assertions, and optional Work Record postconditions; Gate is caller-selected human input, not an assertion engine |
| Skills | Installable AOS root skills plus upstream Playwright CLI companion skills |
| Trace/video/PDF | Upstream Playwright CLI escape hatch, not vendored by AOS |
| Semantic codegen | Explicit unimplemented AOS gap; separate from upstream Playwright tracing and public `run-code` |

## Current Strengths

| Area | Current AOS evidence |
| --- | --- |
| Readiness | `ready`, `status`, `doctor`, `permissions`, `service` |
| Discovery | `graph displays`, `graph windows`, `see list`, `see cursor`, `see selection` |
| Capture | `see capture`, `--window`, `--region`, `--canvas`, `--channel`, `--xray`, `--label`, `--save` |
| Current saved/target handles | Target Handle Runtime V1: `see snapshots`, `see refs`, typed `ref:<snapshot-id>:<ref>` storage, ref-bearing browser targets paired with their original `--state-id`, and canvas/native AX Locators |
| Actions | `do click/hover/drag/scroll/type/key/fill/navigate`, `do press/focus/set-value`, app lifecycle, and exact-window raise/move/resize/close/minimize/maximize/restore/menu forms |
| Sessions | `focus create/update/list/remove` |
| Browser companion | `aos-browser` skill and `aos skills companion check --name playwright-cli` |
| Evidence | `see refs --diff --expect`, caller-selected Gate records, and optional `work-record` read/verify/status/repair planning |

## Scope Boundaries

This crosswalk does not assign gaps, severity, owners, priority, or future
command shapes. Current unsupported behavior and implementation gaps belong in
`docs/api/aos-capabilities.md`, accepted ADR gap ledgers, and bounded work cards.
The durable desktop vocabulary decision belongs in
`docs/design/aos-desktop-command-vocabulary-decision.md`.

Browser-only network mocking, storage/auth state, console/eval, tracing, video,
PDF, locator/test generation, test debugging, uploads, select/check/uncheck,
navigation history, reload, and tab management remain upstream Playwright CLI
capabilities rather than implied AOS desktop primitives.

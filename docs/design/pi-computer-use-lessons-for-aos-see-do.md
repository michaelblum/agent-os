# Pi Computer-Use Lessons For AOS See/Do

**Status:** design input, not an implementation plan
**Related epic:** #234
**Reviewed:** 2026-05-04

## Purpose

`pi-computer-use` is useful evidence that macOS computer-use agents benefit
from a semantic-first control contract. AOS should borrow the proven contract
ideas that match its primitive model, but it should not route through
`pi-computer-use` or add a competing desktop-control plane.

The design stance is:

```text
borrow the control-plane lessons
do not bridge to the tool at runtime
express the useful parts through AOS see/do/work-record contracts
```

## Fit

The conceptual bridge is clean:

| Pi concept | AOS-native expression |
| --- | --- |
| `screenshot`, `list_apps`, `list_windows` | `aos see`, `aos graph`, focus channels |
| Window refs such as `@w1` | AOS window/focus target refs |
| AX element refs such as `@e1` | AOS semantic targets, AX refs, browser refs |
| `stateId` | AOS perception state id |
| Ref-first actions | `aos do` target grammar |
| Strict AX mode | AOS execution constraints |
| Execution metadata | Work-record execution map and evidence |
| Benchmark ratios | AOS see/do regression metrics |

The runtime bridge is not clean. A live intermediary would create two owners for
the same permission-bearing job: two helpers, two target namespaces, two stale
state models, two fallback policies, and two telemetry streams. That would work
against the AOS architecture of one binary, one daemon, one socket, and one
source of truth.

## Patterns To Adopt

### Semantic Refs Before Coordinates

Agents should prefer target refs emitted by `see` over screen coordinates. A
coordinate action should carry the perception state that produced it and should
be rejected or revalidated when that state is stale.

This applies across target dialects:

```text
browser:<session>/<ref>
ax:<pid>/<ref>
canvas:<canvas-id>/<ref>
screen:<state-id>/<x,y>
```

### Perception State Ids

Each actionable `see` result should expose a compact state id. Follow-up `do`
actions can then prove which observed state they came from. This is especially
important for coordinate fallbacks and screenshots, where stale positions are
otherwise easy to replay by accident.

### Execution Constraints

`do` should eventually accept policy constraints such as:

- allow or reject raw pointer fallback
- allow or reject raw keyboard fallback
- allow or reject foreground focus takeover
- require semantic AX execution when possible

Those constraints should be recorded in the work record so a future replay can
distinguish "the agent clicked" from "AOS used AX press without taking over the
cursor."

### Execution Metadata

Every non-trivial action should report what actually happened:

```json
{
  "strategy": "ax_press",
  "backend": "ax",
  "fallback_used": false,
  "state_id": "see_abc123"
}
```

This metadata belongs in the work-record execution map and trace evidence. It
is more useful than only recording the requested command because it tells future
repair code which path succeeded.

### Bounded Batching

Batched actions are useful when no intermediate perception is needed. They are
dangerous when the second action depends on the result of the first. AOS should
only adopt batching with an explicit contract: bounded action count, one target
state, per-action execution metadata, and one post-action `see` result.

### Quality Metrics

AOS should eventually measure desktop-control quality with metrics similar to:

- semantic-ref resolution ratio
- coordinate fallback ratio
- AX execution ratio
- strict-policy compatibility ratio
- primitive pass ratio
- batch pass ratio
- average perception/action latency
- stale-action rejection coverage

Those metrics should become regression gates for see/do changes, not general
claims in prose.

## Non-Goals

- Do not call `pi-computer-use` from AOS.
- Do not add the Codex Computer Use plugin as a repo development path.
- Do not make AOS depend on Pi's ref syntax or runtime process model.
- Do not reshape `aos do` into a recorder. Recording stays above primitives in
  the work-record layer.
- Do not make browser work look like generic desktop control when a
  Playwright-shaped target map is available.

## Work-Record Implication

The AOS work-record model should treat these ideas as execution-map and evidence
requirements:

```text
intent
  -> see state id
  -> resolved semantic target candidates
  -> do action with execution constraints
  -> execution metadata
  -> post-action see state
  -> health update when the step fails or drifts
```

This keeps durable intent above brittle target details while preserving enough
structured data for replay, repair, and retirement.

## Source Pointers

- `pi-computer-use` README:
  https://github.com/injaneity/pi-computer-use
- Usage guide:
  https://github.com/injaneity/pi-computer-use/blob/main/docs/usage.md
- Configuration and strict AX mode:
  https://github.com/injaneity/pi-computer-use/blob/main/docs/configuration.md
- Troubleshooting and stale refs:
  https://github.com/injaneity/pi-computer-use/blob/main/docs/troubleshooting.md
- Benchmark model:
  https://github.com/injaneity/pi-computer-use/blob/main/benchmarks/README.md

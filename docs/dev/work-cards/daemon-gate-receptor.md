# Work Card — Daemon Gate Receptor

## Goal

Build the daemon-side gate infrastructure that receives gate requests, surfaces
them to the local canvas, and wires up the `./aos gate ask` CLI verb.

## Design Reference

Read `docs/design/user-signal-surface.md` in full before implementing. All
schemas, interfaces, and naming must conform to that document.

## Deliverables

### 1. `aos.gate.request.v1` schema
- `shared/schemas/aos.gate.request.v1.json` — JSON Schema for the gate request
  envelope. Must include: `id`, `prompt`, `fields[]`, `timeout_ms`, `source`.

### 2. GateReceptor interface
- `packages/daemon/gate/GateReceptor.js` — abstract base defining:
  - `receive(gateRequest)` — accepts a validated `aos.gate.request.v1` object
  - `resolve(id, values)` — resolves a pending gate by id with user-supplied values
  - `reject(id, reason)` — rejects/times out a pending gate by id

### 3. LocalCanvasReceptor
- `packages/daemon/gate/LocalCanvasReceptor.js` — concrete implementation of
  `GateReceptor` that renders the gate request to the local Canvas (Toolkit
  decision-gate component). Extends `GateReceptor`.

### 4. Gate service
- `packages/daemon/gate/index.js` — service that:
  - Maintains a map of pending gate requests keyed by `id`
  - Instantiates `LocalCanvasReceptor`
  - Exposes `ask(gateRequest)` — returns a Promise that resolves with user
    values or rejects on timeout/cancel

### 5. CLI verb
- `packages/cli/verbs/gate-ask.js` — implements `./aos gate ask`:
  - Reads a gate request JSON from stdin or `--request <file>`
  - Validates against `aos.gate.request.v1` schema
  - Calls the gate service `ask()` and waits for resolution
  - Writes resolved values as JSON to stdout
  - Exits non-zero on rejection or timeout

### 6. Tests
- `tests/daemon/gate-receptor.test.mjs` — unit tests for `GateReceptor` and
  `LocalCanvasReceptor` (mock canvas)
- `tests/daemon/gate-service.test.mjs` — tests for `ask()`, timeout, and
  concurrent gate handling

## Reference Implementations

- Gate UI: `packages/toolkit/components/decision-gate/index.js`
- Form harness: `packages/toolkit/panel/form.js`
- Controls: `packages/toolkit/controls/`
- Test pattern: `tests/toolkit/decision-gate.test.mjs`
- DOM fixture: `tests/toolkit/dom-fixture.mjs`

## Verification

```bash
node --test tests/daemon/gate-receptor.test.mjs
node --test tests/daemon/gate-service.test.mjs
node --test tests/toolkit/*.test.mjs   # must still be 817/817
```

All must pass before committing.

## Git

1. Follow all preconditions in the implementer native subagent instructions (fetch, reset, branch)
2. Branch: `implementer/daemon-gate-receptor`
3. Stage only the files listed in Deliverables above — explicit paths, no wildcards
4. Commit, push, run `git show --stat HEAD`
5. Report: branch name + HEAD SHA + `git show --stat HEAD` output + test results
6. Do NOT merge to main — relay partner handles merge

# src/browser/ — managed browser adapter

This subtree is the narrow Swift bridge from native `see` capture and daemon
callers to the Node-owned managed Playwright companion session authority.
It never resolves or invokes Playwright directly.

## Files

- `managed-browser-broker.swift` — bounded JSON request/response broker for the
  staged Node managed-browser resource.
- `browser-adapter.swift` — whole-session screenshot and snapshot operations
  through the broker.
- `target-parser.swift` — exact `browser:<session>[/<ref>]` grammar.
- `snapshot-parser.swift` — bounded markdown snapshot parser.

## Authority

The managed Node session record binds every request to a random session
generation and immutable runtime descriptor/closure. Swift receives only the
closed public projection. It must not read a legacy session registry, accept a
runtime path, call `npx`, probe `PATH`, invoke generic eval/code, infer browser-
window locality, dispatch ref/DOM actions, or infer cleanup from a PID.

## Testing

Deterministic tests use the managed Node fake runner and static Swift source
contracts. Live browser, native/TCC, and package execution remain separate
explicitly authorized proof lanes.

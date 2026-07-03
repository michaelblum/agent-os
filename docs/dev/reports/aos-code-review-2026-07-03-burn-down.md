# AOS Code Review Burn-Down - 2026-07-03

This report tracks the completion-blocking findings from
`/Users/Michael/Code/tmp/agent-os-code-review-2026-07-03.md` against current
repo evidence. It is a Phase 0A checkpoint for the product-destiny convergence
goal, not a new bug-hunt queue.

## Critical And High

| id | disposition | current evidence |
| --- | --- | --- |
| 1. Host tool-result message shape | fixed | `packages/host/src/provider/anthropic.ts` emits AI SDK `role: "tool"` messages with `toolName`; `packages/host/src/session-store.ts` allows `tool`; `packages/host/src/agent-loop.ts` stores tool results as `tool`; `packages/host/test/provider/anthropic.test.ts` covers the provider shape. |
| 2. `aos wiki` path traversal | fixed | `scripts/aos-wiki-mutate.mjs` and `scripts/aos-wiki-read.mjs` resolve slash and `.md` inputs through `containedPath`; `tests/wiki-read-external.sh`, `tests/wiki-mutate-external.sh`, and `tests/wiki-seed.sh` cover containment behavior. |
| 3. Sigil selection-mode ReferenceError | fixed | `apps/sigil/renderer/live-modules/interaction-overlay.js` binds `time` from `snapshot.time` before drawing frames; `tests/code-review-burn-down-status.test.mjs` guards the source marker. |
| 4. Sigil glTF fallback ReferenceError | fixed | `apps/sigil/renderer/live-modules/radial-gesture-visuals.js` installs `createFallbackGlyph()` in `installFallbackGlyph`; `tests/renderer/radial-gesture-visuals.test.mjs` covers fallback glyph installation. |
| 5. Canvas removal lifecycle leak | fixed | `src/display/canvas.swift` clears `onMessage` and `onTTLExpired` in `Canvas.close()` before removing the WebKit script handler and closing the window; `tests/canvas-close-callback-contract.test.mjs` guards the teardown order. |
| 6. Malformed click count kills `aos do` session | fixed | `src/act/actions.swift` rejects `count <= 0`; parser/range guards live in `src/act/act-cli.swift`; `tests/click-count-contract.test.mjs` and `tests/external-parser-flags.sh` cover the invalid-count boundary. |
| 7. Dead-session keystroke crashes terminal bridge | fixed | `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs` checks `record.exited` and ignores child stdin errors before writing to process stdin; `tests/sigil-agent-terminal-server.test.mjs` covers exited/broken stdin writes. |
| 8. Surface Inspector pin self-loop hang | fixed | `packages/toolkit/workbench/surface-inspector-annotations.js` nulls self-parent pins and guards ancestor walks with visited sets; `tests/toolkit/surface-inspector-annotations.test.mjs` covers self-parent and malformed-loop cases. |
| 9. Decision Gate Tab handling crash | fixed | `packages/toolkit/components/decision-gate/index.js` converts the `querySelectorAll` result with `Array.from(...)` before filtering and indexing; `tests/toolkit/decision-gate.test.mjs` covers the focus trap. |
| 10. HTML Workbench Expression sanitizer gap | fixed | `packages/toolkit/components/html-workbench-expression/index.js` removes active elements including `iframe`, strips `srcdoc` and event handlers, and rejects dangerous URL schemes; `tests/toolkit/html-workbench-expression.test.mjs` covers the sanitizer. |

## Material Medium Clusters

| cluster | disposition | current evidence |
| --- | --- | --- |
| Config data loss on corrupt/interrupted write | fixed | `scripts/aos-config-command.mjs` rejects corrupt config instead of defaulting and writes via temporary file plus rename; `tests/config-surface.sh` covers corrupt config and `content.port` bounds. |
| Wiki reindex data loss on read failure | fixed | `scripts/aos-wiki-reindex.py` wraps reset and inserts in one transaction and rolls back on failure; `tests/wiki-reindex-external.sh` proves invalid UTF-8 fails without wiping existing index entries. |
| Stale workspace write locks | fixed | `scripts/lib/agent-workspace/store.mjs` reaps stale/dead-owner locks; `tests/agent-workspace-storage.sh` and `tests/agent-workspace-cleanup.sh` cover stale lock recovery. |
| Focus registry corrupt/non-atomic writes and malformed URL launch | fixed | `scripts/aos-focus-graph.mjs` rejects corrupt registries, writes via temp+rename, validates duplicate ids before launch, and validates malformed URLs before launching; `tests/browser/focus-browser.test.sh` covers these edges. |
| Checkpoint overwrite data loss | fixed | `scripts/workbench-human-checkpoint-annotate.mjs` uses atomic replacement; `tests/workbench-human-checkpoint-annotate.test.mjs` covers rename-failure preservation. |
| Swift `runProcess` pipe deadlock | fixed | `src/shared/helpers.swift` drains stdout/stderr before `waitUntilExit()` can deadlock; `tests/run-process-drain-contract.test.mjs` guards the ordering. |
| Event-stream double-close | fixed | `shared/swift/ipc/event-stream.swift` closes only a connected fd it still owns; `tests/event-stream-fd-ownership-contract.test.mjs` covers ownership. |
| `AosSchemeHandler` main-thread blocking | fixed | `src/display/canvas.swift` fails fast when the content server port is unavailable; `tests/daemon/aos-scheme-handler-nonblocking.test.mjs` guards the absence of `waitForPort`. |
| `refreshChannel` stale writes | fixed | `src/perceive/spatial.swift` snapshots and re-checks channel revision before publishing or writing; `tests/daemon/spatial-refresh-stale-write.test.mjs` guards the stale-result drop. |
| Host and gateway socket lifecycle hangs | fixed | `packages/host/src/sdk-client.ts`, `packages/gateway/sdk/aos-sdk.js`, and `packages/gateway/src/engine/node-subprocess.ts` reject pending calls on close/error or timeout; `packages/host/test/sdk-client.test.ts`, `tests/gateway-sdk-socket-lifecycle.test.mjs`, and `packages/gateway/test/engine.test.ts` cover the behavior. |
| Gateway localhost broker origin and script containment | fixed | `packages/gateway/src/integrations/http-api.ts` restricts CORS to AOS and same-loopback same-port origins; `packages/gateway/src/scripts.ts` enforces flat safe script names. `packages/gateway/test/integration-broker.test.ts` and `packages/gateway/test/scripts.test.ts` cover the boundary. |
| Host tool resource bounds | fixed | `packages/host/src/tools/read-file.ts` and `packages/host/src/tools/list-files.ts` enforce file/entry caps and abort signals; `packages/host/test/tools/read-file.test.ts` and `packages/host/test/tools/list-files.test.ts` cover the limits. |
| UTF-8 open-message and wiki readbacks | fixed | `packages/toolkit/components/open-message-encoding.js` uses UTF-8-safe base64, wiki query/graph readers use replacement decoding, and active-profile loading turns filesystem errors into runner errors; tests include `tests/toolkit/open-message-encoding.test.mjs` and `tests/aos-agents-runner.sh`. |

## Deferred By Plan Gate

- `src/perceive/daemon.swift` `PerceptionEngine` shared-state race remains the
  only review-doc item treated as a convergence blocker that is not an immediate
  coding slice. The current owner artifact is
  `docs/design/work-cards/perception-engine-shared-state-race-plan-v0.md`.
  Implementation remains blocked on an approved plan with files, invariants,
  proof strategy, rollback risk, and stop conditions.

## Non-Blocking Findings

Low/latent findings from the review report stay out of the default goal loop
unless explicitly promoted. Do not implement them from this report alone.

# Platform Debt Map, 2026-05-17

Status: Foreman coordination map.

This note captures the platform debt exposed by the May 11-17 workstream and
routes the next two bounded work cards. It is not a new product plan and should
not reopen completed V0 trackers without fresh evidence.

## Current Trajectory

The repo is converging on AOS as a platform substrate rather than a collection
of app demos. The live direction is:

- daemon/kernel owns native primitives and generic contracts;
- toolkit owns reusable surface, workbench, control, and session policy;
- apps such as Sigil own product expression and domain behavior;
- docs, schemas, work records, and runtime wiki projections keep agent work
  recoverable across sessions.

Recent work closed several large slices:

- Surface Stack V0 made DesktopWorld stage layers, input regions, panel
  windowing, and Sigil second-client behavior concrete enough to stop broad
  surface churn.
- Toolkit control work added shared HTML/control helpers and a broad Zag adapter
  horizon.
- Sigil radial and 3D work moved more behavior toward data/config and object
  graph contracts while keeping product rendering in Sigil.
- Repo-doc wiki projection made canonical Git docs queryable in the runtime
  wiki without moving source of truth out of Git.
- User-signal work added durable gate records, deferred continuations, local UI
  submit, and guided signal sessions.

The next useful work is not another broad feature. It is two debt-reduction
slices that make the new platform surface easier to keep correct.

## Routed Debt Slices

| Priority | Debt | Why Now | Routed Card |
| --- | --- | --- | --- |
| 1 | User-signal service consolidation | Gate records, continuations, UI submit, and guided sessions landed quickly. The behavior is covered, but terminal state, redaction, runtime-store, idempotency, and adapter-boundary logic now deserve a single audit/refactor pass before more receptors or annotation flows build on them. | `docs/design/work-cards/user-signal-service-consolidation-v0.md` |
| 2 | Generated artifact lifecycle policy | HTML workbench expressions, artifact bundles, wiki projections, evidence captures, screenshots, and runtime records now have strong local contracts but weaker shared disposal/archive rules. Without a lifecycle policy, useful projections can become repo or state-root clutter. | `docs/design/work-cards/generated-artifact-lifecycle-policy-v0.md` |

These slices are ordered. Run the user-signal consolidation first because it may
clarify which runtime records and resume artifacts need lifecycle vocabulary.
Then run the artifact lifecycle policy with the consolidation findings in hand.

## Important Non-Routed Debt

These remain salient but are not the next two slices:

- **Display-first Annotation Mode:** #295 remains the highest product/platform
  thread, but it should consume user-signal and artifact-lifecycle cleanup
  rather than racing ahead of it.
- **Sigil shared 3D editor path:** `docs/design/aos-3d-object-graph-platform-contract.md`
  identifies a real future toolkit subject/editor opportunity. Do not start a
  generic editor until the current radial/avatar object graph consumers show a
  second concrete reuse point.
- **Transitional surface fallbacks:** the WebView minimized-chip fallback and
  parts of `avatar-main` remain transitional. Retire only with confidence
  evidence, telemetry, or a fresh regression proving the fallback is now debt
  rather than resilience.
- **Test harness organization:** #162 remains valid. The serial live-canvas
  contract and test primitive/molecule guidance reduced risk, but broader file
  organization should wait for a cleaner routing window.
- **Evidence workflow blocks:** #293 remains a useful abstraction gate. Do not
  extract neutral evidence schemas until the Employer Brand pilot stabilizes or
  a second workflow repeats the same block pattern.

## Guardrails

- Do not move toolkit policy into the daemon while paying down debt.
- Do not reopen closed V0 epics just to hold cleanup work.
- Do not create broad migration cards from this note. Each routed slice should
  leave one accepted state or one exact follow-up.
- Do not delete or relocate generated artifacts as part of the lifecycle-policy
  slice unless the work card explicitly narrows to a safe fixture-only change.

## Current Runtime Note

During this Foreman routing pass, `./aos ready` reported the repo daemon
reachable but the input tap unavailable. These routed cards are deterministic
docs/refactor slices; live checks should report the readiness blocker rather
than trying to force unrelated permission repair.

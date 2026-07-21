# Scene Authoring

Use `@agent-os/toolkit/scene/authoring` for data-only scene documents,
cartridges, transactions, affordances, gestures, and stock responses.

## Scaffold And Validate

Create a new cartridge from one deterministic neutral template:

```bash
mkdir -p ./scene-work
aos scene cartridge scaffold ./scene-work/companion \
  --id companion/main --template aim-and-commit --json
aos scene cartridge validate ./scene-work/companion --json
```

Available templates are `spinning-object`, `conventional-drag`,
`aim-and-commit`, and `radial-menu`. Scaffolding requires a new destination,
uses owner-only staging, validates before one rename, and never installs,
mounts, authorizes, or executes the result. Output contains relative filenames,
byte counts, and digests rather than local paths or source text.

## Cartridge Layout

```text
cartridge.json
scene.json
animations.json
interactions.json
assets/
```

`cartridge.json` binds the three JSON payloads and every local asset by
SHA-256. It declares exact implementation IDs and finite budgets. Paths are
canonical and relative. V1 assets are local raster images or binary glTF.

Scripts, functions, remote runtime URLs, links, traversal, special files,
undeclared files, unknown implementations, and values above engine limits fail
validation. The filesystem loader stays in `scripts/lib`; the browser-safe
toolkit package contains no Node filesystem or socket code.

The canonical examples live under `packages/toolkit/scene/examples/`.
Scaffold instead of copying them so the resource ID and every dependent digest
are updated together.

## Documents And Transactions

`canonicalizeSceneDocument()` validates exact fields, hierarchy, resource
references, finite JSON parameters, per-resource asset limits, and aggregate
budgets. `sceneDocumentRequiredImplementations()` returns the trusted
implementation IDs needed by the document.

`validateSceneTransaction()` validates the revisioned operation envelope.
`applySceneTransaction()` additionally checks the active lease, applies the
operations to an isolated candidate, validates the complete candidate, and
returns revision `n + 1`. Rejection never mutates the supplied document.

```js
import {
  applySceneTransaction,
  canonicalizeSceneDocument,
  createSceneLease,
} from '@agent-os/toolkit/scene/authoring'

const document = canonicalizeSceneDocument(sceneJson)
const lease = createSceneLease({
  stageId: 'desktop-world/main',
  ownerId: 'example.consumer',
  resourceId: 'companion/main',
  scopeId: 'connection/example',
})
const result = applySceneTransaction(document, transactionJson, { lease })
if (!result.ok) throw new Error(result.errors[0].message)
```

`createSceneLease()` creates contract identity only. It does not open a daemon
connection or acquire a live stage lease.

## Affordances And Gestures

`SceneAffordanceDescriptor` declares bounded object-relative hit geometry.
AOS resolves parent transforms into the global DesktopWorld plane and owns
pointer capture, topology facts, arbitration, Escape cancellation, movement
coalescing, and cleanup.

`createSceneGestureArena()` arbitrates tap, drag, long-press, and radial
recognizers by explicit priority and stable ID order. Drag has only `start`,
`update`, `end`, and `cancel`; it does not imply object movement. Start, end,
and cancel are never dropped.

Responses are independent:

- `translate` performs conventional movement.
- `aim_commit` keeps the object fixed while an arrow tracks the pointer and
  commits a route on release.
- `drop` resolves a destination without defining product meaning.
- `signal_graph` emits bounded numeric signals.
- `radial_menu` opens an AOS-owned transient menu lease with bounded items.

Cartridges supply IDs, styles, and numeric parameters. Product labels,
commands, and action semantics stay in the consumer. Events never carry
product text, audio, prompts, or scene document content.

Candidate region generations remain inactive until every new region is ready
and every old region can retire. Input stays on the prior generation until the
barrier commits; ambiguous replacement fails closed.

## Stock Implementations

`createSceneImplementationRegistry()` is the trusted implementation boundary.
The generic registry provides bounded primitive geometry, materials, numeric
signal and animation bindings, and reviewed stock interaction responses.
Product geometry, shaders, effects, and animation code belong in a reviewed
trusted extension, not an expanding stock parameter vocabulary.

## Cleanup

Delete local scaffold output with the caller's normal workspace cleanup. A
cartridge has no runtime lease until mounted through a session. Runtime cleanup
is covered by the [Scene Runtime](./scene-runtime.md) guide.

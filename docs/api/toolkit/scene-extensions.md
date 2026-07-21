# Scene Extensions

Use `@agent-os/toolkit/scene/extensions` for the reviewed trusted projection
ABI. A trusted extension is first-party same-realm executable code, not a
sandbox, cartridge, or distribution format.

## Scaffold And Validate

```bash
mkdir -p ./scene-work
aos scene extension scaffold ./scene-work/renderer \
  --owner example.consumer --id companion-renderer \
  --template basic-three --json
aos scene extension validate ./scene-work/renderer --json
```

Scaffolding is deterministic, create-new, owner-only, and atomic after static
validation. It does not install, authorize, mount, import, or execute the
extension. Output omits local paths and source text.

The neutral runnable artifact is under
`packages/toolkit/scene/extension-examples/basic-three/`. Its projection owns
one Three subtree and demonstrates activation, numeric signal and animation
application, frame ticking, suspend/resume, context loss, explicit budgets,
and idempotent GPU disposal.

## Artifact Contract

The manifest contract is `aos.scene.extension.v1`.

An extension contains exactly:

```text
extension.json
projection.js
```

`projection.js` is the body of `createProjection(context)`. It may define local
helpers and must synchronously return one projection with an Object3D subtree
and `applySignal`, `applyAnimation`, `tick`, `suspend`, `resume`,
`contextLost`, `contextRestored`, and `dispose` methods. Promise-like hook results fail admission
or the active operation.

The manifest binds owner, extension ID, sorted implementation IDs, scene ABI,
AOS's pinned Three revision, finite resource budgets, and the projection body
SHA-256. `serializeSceneExtensionDigestMaterial()` is the digest authority.

The context contains only AOS's pinned `THREE` namespace, the canonical scene
document, and lowered budgets. Extension-local asset loading is not part of V1.
Procedural geometry and data already admitted by the document are supported.

## Review And Installation

Validation compiles the exact generated ES-module wrapper with V8 without
linking or evaluating it. The DesktopWorld host performs a fresh WebKit module
import before registry admission; that is the authoritative runtime syntax
gate. A failed import leaves the active scene unchanged.

After independent review, install exactly the validated digest:

```bash
validation_json="$(aos scene extension validate ./scene-work/renderer --json)"
reviewed_digest="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.digest)' "$validation_json")"
aos scene extension install ./scene-work/renderer \
  --expected-digest "$reviewed_digest" --json
aos scene extension list --json
```

Installation writes immutable owner-only bytes plus an AOS-generated
authorization record into the current runtime mode's store. Only this explicit
command grants executable authority. A mount carries only the exact
`ownerId`, `id`, `digest`, `sceneAbi`, and `threeRevision` reference.

## Runtime Boundary

AOS retains the renderer, camera, frame loop, multi-display projection,
transactions, input, inspection, allocation reservations, context-loss
handling, and disposal enforcement. The extension owns its model, materials,
shaders, effects, and per-frame visual implementation.

At creation, extension limits are lowered to unallocated segment headroom.
Replacement accounts for old and candidate projections concurrently. Commit
activates and audits the candidate before publishing it. Sampled audits remain
bounded, while lifecycle boundaries force complete audits. Failed disposal is
retryable until the hook succeeds.

The same-UID account and reviewed extension are in the trust base. Arbitrary
heap behavior and realm-global access are trusted code-review concerns, not
sandbox-enforced guarantees. Use isolated standalone WebGL instead when that
trust is inappropriate.

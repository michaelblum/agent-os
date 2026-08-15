@../../AGENTS.md

# Toolkit Boundary

`packages/toolkit/` is the reusable AOS surface layer between daemon primitives
and external product consumers. It is where the default opt-in AOS windowing
system belongs.

The toolkit is a package boundary inside `agent-os`, not an independently
versioned repository. It ships against the same reviewed AOS revision as the
daemon, CLI, schemas, and command manifests. Consumers must use explicit public
exports from that revision rather than copy toolkit source into product repos.

Layer intent:

- `runtime/`: universal in-canvas bridge over daemon primitives.
- `contracts/`: neutral toolkit contracts shared by activation scripts and
  runtime helpers without making activation depend on runtime policy.
- `controls/`: reusable semantic app-control behavior for WKWebView surfaces.
- `panel/`: reusable panel/window policy: chrome, drag/drop-capable movement,
  resize, close, minimize, maximize, restore, placement, and surface-manager
  affordances.
- `workbench/`: subject descriptors and reusable workbench contracts.
- `components/`: reusable content units and stock surfaces built from the lower
  layers.
- `status-item/`: product-neutral native status-item descriptor,
  compare-and-swap update, generation-scoped action admission, event, and
  validation helpers, including complete invocation results and the closed
  invoke error-code set. Invocation results and events are exact discriminated
  unions: menu selection requires menu identity, while primary activation,
  secondary activation, and lifecycle variants forbid identities or action
  fields they do not own.
- `scene/`: narrow external package facade over reviewed Three lifecycle,
  DesktopWorld, canvas lifecycle, and visual-object contracts.

Toolkit policy must stay generic. If a behavior only makes sense for a
specific external product, it belongs in that product repository. If toolkit
code needs native help for performance or correctness, add or request a daemon
primitive instead of inventing private app canvases or pushing toolkit policy
into Swift.

The shared DesktopWorld stage is toolkit policy running on a daemon
DesktopWorld canvas primitive. Its compatible 2D and 3D outlets are the default
host for ordinary desktop-wide visuals such as chips, drag ghosts, telemetry,
avatar/radial visuals, and temporary affordances. The scene package now owns
working dependency-injected local and DesktopWorld host policy. The
daemon-backed singleton transport is exposed only through owner/resource-scoped
`scene-follow` leases. Pair visual objects with
explicit interaction surfaces or input regions; do not make the full visual
stage interactive by default. ADR 0024 owns the 3D outlet boundary.
DesktopWorld segment setup must accept the topology-derived native backing scale
before the stage emits ready; initial setup failures reject and unsubscribe the
surface adapter instead of continuing with WebKit defaults.
Initial and topology segment failures publish one canonical scene fault and
retire the complete stage through the serialized fail-closed lifecycle; they
must not leave a reusable canvas waiting permanently for readiness.
One-shot spatial animation temporarily quiesces affected native interaction
regions and settles the terminal pose through a fresh staged generation. Keep
the authored scene revision stable and do not synchronize native hit geometry
per frame. All display segments must derive replacement and terminal-animation
input-region generations from the daemon's shared scene operation identity;
segment-local counters are not authoritative cross-display identities.
Native pointer-effect regions carry the scene operation's input-generation ID.
Visual-only changes retain that generation without native region churn;
interaction changes advance it through atomic generation replacement. Every
display reports the resulting generation before daemon authorization commits.
Spatial play publishes its shared operation ID as the next input generation;
old regions reject immediately and terminal regions adopt that same ID when the
animation settles. Signals received while the animation is quiesced preserve
that reserved terminal generation rather than clearing daemon event authority.
DesktopWorld registers one owner-lifecycle Escape key lease before declaring
the stage ready. Stock radial menus consume that exact redacted event; item hit
regions remain pointer-only, and Escape continues through to macOS.

DesktopWorld DevTools are AOS-owned toolkit views over a daemon-owned session.
Consumers may host the public inspector view, but one revisioned AOS host lease
owns interaction and the stage remains the sole telemetry sampler. ADRs 0026
and 0027 own the cartridge, engine, DevTools, and host-transfer boundaries. The
scene package's agent client remains transport-injected; socket discovery,
daemon startup, and public CLI process lifecycle stay outside the toolkit.
Trusted scene extensions may contribute only the bounded engine-defined
interaction inspection contract to DevTools. Do not expose arbitrary
extension snapshots, product state, text, audio, or source through stage
telemetry.
Desktop-frame texture leases are AOS-owned, stage-only, transient, and
content-free outside the trusted projection realm. Effects such as distortion,
masking, blur, or redaction remain consumer recipes; never add their vocabulary
to AOS capture or scene transport contracts. One request produces a coherent
all-display epoch bound to exact stage/WebView generations. Keep backend choices
such as one-shot capture or a future prewarmed stream behind that lease.
Render Performance state transfer must preserve the exact DesktopWorld
publication lifecycle and bounded canonical display-to-source bindings. Legacy,
partial, or inconsistent state must not infer DesktopWorld ownership from
user-controlled source IDs or grant source-deletion authority.
Canonical `desktop-world:<displayIndex>:<displayId>` performance source IDs are
component-reserved: generic sample ingress must reject that exact shape while
leaving noncanonical prefixed IDs generic. A DesktopWorld publication may claim
only an absent bucket or one already attributed to its current/restored binding;
an unowned collision rejects the complete publication before mutation, and only
an explicit reset may discard that bucket so a later publication can claim it.
Nonzero daemon stage-snapshot revisions globally order Render Performance
publications across lifecycle changes; absent or zero revisions retain the
exact-lifecycle segment-sequence fallback for standalone/local snapshots.

Legacy cross-display transfer outlines are superseded by One-World/union-backed
surfaces. Do not grow that path. The AOS Surface System epic should replace
panel-private movement with first-class toolkit drag/drop, migrate draggable
panel-shaped surfaces onto it, and remove the transfer-outline code/tests/docs.

Before adding WebViews, stage layers, hit regions, or daemon work for a surface,
use `docs/guides/aos-surface-interaction-decision-tree.md`. Keep local guidance
as a pointer to that canonical tree instead of copying the full policy here.

Consumer-facing toolkit contracts are indexed at `docs/api/toolkit.md`. Prefer
the scoped API file for the layer you are changing:
`docs/api/toolkit/runtime.md`, `docs/api/toolkit/panel-window.md`,
`docs/api/toolkit/workbench.md`, `docs/api/toolkit/scene.md`,
`docs/api/toolkit/status-item.md`,
`docs/api/toolkit/components.md`, or
`docs/api/toolkit/content-host.md`.

For `workbench/` Work Record filesystem paths, preserve raw path strings in
stored identities, readback fields, and argv-backed recommendations. Use
whitespace-normalizing helpers only for semantic fields such as ids, statuses,
schema versions, and generated explanatory text; source-owned labels remain
raw evidence.

For `workbench/` Work Record APIs, keep `work-record.js` as the stable public
facade and keep private projections, planners, and test conveniences out of
that export surface. Internal capture modules own command evidence, AOS action
phases, step-descriptor promotion, shared helpers, and builder versions;
recovery helpers may be shared by direct internal imports, but not through the
public facade for testing convenience.

Workbench browser evidence must call the injected fixed managed evidence
operation with an explicit session ID. It does not resolve Playwright or accept
an executable path. File and relative local-fixture inputs are exact regular
files capped at exactly 3000 bytes before data-URL projection so the complete
data URL stays within the managed worker's 4096-byte URL bound. Registry metadata carries
that boundary and may bind the path-free session generation
and descriptor/closure digests, while upstream output and managed filesystem
paths remain outside the public evidence record.

Active Work Record V1 and Step Descriptor V1 behavior is neutral evidence and
mechanics. Repair and Attempt Plans never execute; Attempt Artifacts accept
caller-supplied outcomes. An Attempt Plan is `ready` only when its validated
Repair Plan supplies exactly one complete source-bound candidate patch; a
zero-patch planned proposal remains `blocked_inputs`. Nested authority-policy
fields invalidate plan mechanics rather than being copied into later plan or
Artifact projections. A successful Artifact must carry an exact
source-digest-bound outcome and the complete validated Attempt Plan payload for
the single atomic V1 candidate patch, including
the complete schema-valid proposed execution-map payload/digest, unique evidence identities,
every required Attempt Plan evidence requirement, and evidence mapping. Repair
Plan identity commits the exact projected steps and patch payload; Attempt Plan
operations must reproduce that canonical chain. Derived operation boundaries
and precondition, evidence, postcondition, cleanup, and rollback references
must equal the mechanics reconstructed from the committed Repair Plan step or
candidate patch.
When a successful Artifact reports that candidate patch as produced, the exact
derived candidate-patch operation outcome must be `succeeded`; a skipped
operation cannot support a produced patch receipt.
Proposal and Writer validate and copy those bytes without applying the patch,
synthesizing observations, accepting caller-supplied Claim Results, or rewriting
historical Claim Results. Materialized caller evidence preserves its exact
metadata and caller-supplied timing; replacement provenance stays outside that
metadata. Because V1 patches only `execution_map`, Proposal and
Writer preserve source-owned type/schema/label/origin/references/intent/claims/
metadata exactly and permit only defined provenance, evidence, verifier, health,
and repair-history additions. Fail closed when source metadata already owns a
reserved replacement-provenance key instead of overwriting it. Source labels,
commands, targets, state ids, and
evidence carriers preserve raw whitespace. Every source evidence item is
carried exactly once; omission is invalid. Evidence refs and postcondition maps
are exact and one-to-one. Bundle outputs retain the guide recovery handoff, and
repair guides must bind supplied Artifacts to the current source and derived
Attempt Plan.
The report-only verifier requires exact evidence-backed Claim-to-postcondition
coverage and validates every advertised Claim digest.
Finalization
preserves exact source, plan, evidence, destination, and supersession
identities, including raw source path; requested refs remain provenance while
ID- and path-based reads of that same canonical source resolve the same entry.
Final success requires a post-supersession replacement re-read whose canonical
record digest and serialized file digest still match the Writer receipt, plus a
lookup with proven readable replacement roots. All post-publication JSON and
digest readback failures return receipted partial results rather than throwing.
Replacement and supersession publication must use create-if-absent semantics, re-read raced
destinations for exact idempotency, and never overwrite different existing
bytes. Failed publication scrubs invocation-owned staged content through its
held descriptor, preserves any empty temp or destination leftover, and carries
the exact leftover and scrub flags through caller and bundle receipts. Finalizer
guidance surfaces preserved receipts even when idempotent publication
completes. The Replacement Writer re-checks exact source bytes after
publishing, and the Supersession Writer re-checks exact source and replacement
identities after publishing; drift downgrades success while retaining the
publication receipt.
Each exact source identity owns one canonical create-if-absent active entry, so
competing replacement relationships cannot both publish successfully.
Persisted supersession
entries must carry canonical active/active status before lookup treats them as
active. Supersession writes bind a supplied Writer Result to the exact Proposal
identity embedded in the replacement record, validate the structured-record and
serialized-output digests independently against canonical content and exact raw
replacement-file bytes respectively, and commit persisted Proposal/Writer
mirrors into the supersession entry identity. Persist only the stable Writer
projection covered by that identity; do not retain unbound status or temporary
publication receipt fields in the entry. The Proposal mirror is a closed
id/digest/schema projection; supplied Proposal type and status must validate
before publication. Successful supersession receipts include the exact
serialized index-file digest separately from the structured entry identity.
Index digest or lookup read failures after publication remain typed and
receipted. Partial-finalization guidance must not emit a supersession-write argv
until a persisted successful Writer Result path is available. Existing-output
digest reads and supersession index scans also fail as typed public results;
filesystem I/O failures must not escape the Writer or supersession APIs.
Replacement and index roots reject non-system symlink ancestors before dry-run
or publication, and containment inspection failures return typed results.
The deterministic replacement destination must be absent or a regular
non-symlink file before byte comparison; symlink and non-file leaves are
conflicts even when following them would yield identical bytes. Inspect and
read destination bytes through the private descriptor-relative native
primitive. It opens the complete physical explicit-root-to-parent chain with
no-follow directory traversal and holds those descriptors through temp-file
creation, writes, one atomic no-replace descriptor-relative transfer, conflict
inspection, and final readback. One staged-entry link observer remains
continuous from before content write through readback. Failure rollback scrubs
through the held descriptor, preserves the empty staged inode under any
remaining invocation-owned name, and receipts temp or destination leftovers
without path-named removal. Directory rename/revoke detection plus exact inode,
regular-file type, single-link, byte, and digest proof must reject
swap-and-restore, symlink-clone, and external-hard-link races. There is no
pathname fallback when the native primitive is unavailable. Supersession and
finalizer replacement readback use the same physical-file proof; an identical
symlink clone is not the indexed replacement.
Persisted supersession entries bind their claimed root and deterministic
canonical path to the exact physical file admitted by lookup.
Replacement readback must prove the exact indexed physical path, not an
ID/digest-identical clone found elsewhere under supplied roots.
Replacement roots must resolve as directories before dry-run, and supersession
index enumeration rejects a symlinked explicit root, symlinked trees, or entries
outside the explicit root. Bundle publication catches later artifact I/O and
retains every accumulated or already-published artifact receipt.
Do not add Gate-derived authority,
approval/risk policy, operation registries, a public fixture executor, or a V0
compatibility reader. Active record and descriptor consumers must validate the
complete current source schema through the checked generated validators before
projection or execution-mode adapter dispatch. The active Work Record workbench
rejects historical V0, unknown schemas, and malformed V1 at initialization and
open boundaries while retaining only a schema-valid empty waiting record.
Subject-catalog and wiki-browser defaults must use an active V1 Work Record;
historical V0 fixtures are reserved for explicit unsupported-input proofs.
The Step Descriptor workbench validates the complete active descriptor and its
exact evidence bindings before it installs a prototype or reports ready.
Execution-mode Step Descriptor
harnesses require a caller-supplied adapter. Both simulation and adapter output
must exactly match descriptor dialect, action target, target resolution,
supported action template/args/state, preconditions, postconditions, and
claim-promotion identity/scope/references before capture. Semantic evidence refs
are target-scope bound, including when candidates omit their full target.
Promoted postcondition state identity must exactly match the bound after
perception before any Work Record is emitted.

## Child DOX Index

- `controls/AGENTS.md` governs reusable semantic app-control behavior.
- `panel/AGENTS.md` governs reusable panel/windowing policy.
- `runtime/AGENTS.md` governs the generic in-canvas bridge to daemon
  primitives.
- `scene/AGENTS.md` governs the narrow external scene-authoring package facade.
- `contracts/`, `components/`, `workbench/`, `status-item/`, `adapters/`,
  `markdown/`, and `shell/` do not have child `AGENTS.md` files yet; follow
  this toolkit contract plus scoped API docs when editing them.

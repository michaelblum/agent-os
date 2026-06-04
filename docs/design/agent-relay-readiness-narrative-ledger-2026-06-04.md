# Agent Relay Readiness Narrative Ledger

**Date:** 2026-06-04
**Status:** Foreman narrative checkpoint after #407 / #412 settlement
**Current baseline:** `main` at `25064f72`, aligned with `origin/main` before
this note, with repo-mode `./aos ready --json` reporting `ready=true`
**Governing ledger:** #407 for local relay and AOS GitHub control-surface
governance

This note preserves the story that is easy to lose if a future agent only reads
branch names, work cards, stashes, and PR titles. It is not a work card. It is
the orientation layer for the current repo state: why the live-drag work
started, why it turned into runtime and governance side quests, what is actually
settled on `main`, and which leftover artifacts should not be mistaken for
active product direction.

## Short Version

The live-drag thread did not start as a standalone "make panel dragging nicer"
feature. It started because agents were struggling to prove real-input behavior.
Dragging a visible panel became the stress test for whether AOS could connect an
agent's intent, the daemon input stream, the canvas/window-server frame, and the
visible UI result without fooling itself.

That stress test exposed several deeper weaknesses:

- target identity was still ambiguous in places;
- daemon input events, WebKit pointer coordinates, AppKit cursor position, and
  canvas frames did not always agree;
- Sigil "avatar controls" were really becoming context-menu, visual-object, and
  UX-tree architecture;
- readiness, input-tap ownership, stale daemon ownership, and TCC recovery
  needed stricter broker boundaries;
- Foreman/GDI coordination was producing branches, stashes, work cards, and
  GitHub issue comments faster than durable memory could keep up.

The repo is not random today, but the artifact trail is noisy because the
architecture was discovered through debugging rather than planned in one clean
sequence. Future agents should treat this note, the current `main`, and the
governing issues as the source of truth. Do not infer active work merely from a
markdown work card existing under `docs/design/work-cards/`.

## How The Current State Happened

### 1. Real input made panel dragging the test case

The practical problem was agent testing. Agents could run deterministic tests,
but live desktop interactions still had failure modes that were hard to
observe: cursor delivery, hit regions, panel movement, daemon input events,
stale canvases, display seams, and macOS permission state. Dragging a panel was
small enough to test and visible enough to expose lies.

This is why live-drag artifacts exist. They are evidence and partial fixes from
the real-input investigation, not a signal that panel dragging has become the
top product lane.

### 2. Input proof exposed target-identity drift

Once agents tried to drive real UI, old target names and nested identity shapes
became a liability. Several slices moved the agent UI surface toward canonical
refs, snake-case target identity, and conformance fixtures. That work matters
because agent relay needs stable addressable targets; otherwise a later agent
can appear to act correctly while addressing a stale or ambiguous surface.

### 3. Sigil polish became platform architecture

The visual work began around Sigil and avatar/control behavior, but it kept
escaping feature scope. Context menus, radial controls, compact surfaces,
visual-object descriptors, UX-tree commands, and selection mode were not only
Sigil polish. They were pressure tests for whether AOS had reusable substrate
contracts for object-like UI state, surface identity, and user-visible command
bindings.

This is why many nearby docs and work cards mention visual-object architecture,
context-menu extraction, semantic targets, compact controls, and Sigil radial
flows. Some are accepted substrate work. Some are parked design memory. They
should not all be treated as active follow-up tasks.

### 4. Live proof forced runtime-readiness and TCC governance

Live checks then exposed a more dangerous class of bug: AOS could appear ready
while the wrong daemon, socket owner, or input-tap owner was active. The repo
responded by tightening readiness, stale-daemon classification, and repo-mode
TCC boundaries.

The key architectural result is the TCC capability broker boundary in
`docs/adr/0015-aos-tcc-capability-broker-boundary.md`: native Swift work should
be justified by privileged facts, privileged actions, privileged streams,
daemon/socket substrate changes, macOS framework integration, or TCC permission
classes. Policy, composition, help text, recovery wording, and product behavior
should not be smuggled into native work.

This boundary explains why readiness/broker follow-ups must be routed carefully.
Even deterministic-looking Swift changes can imply a rebuild and manual TCC
regrant.

### 5. Coordination itself became a workstream

By June 3 and June 4, the repo had accumulated enough branches, stashes, work
cards, and issue comments that coordination became the active risk. The local
relay policy under #407 settled the default workflow:

- one checkout at `/Users/Michael/Code/agent-os`;
- no linked worktrees unless the human explicitly requests them;
- `./aos` as the primary control plane;
- local branches, scoped commits, and named stashes for isolation;
- no automatic GitHub publication;
- GitHub issues as durable workstream ledgers, not one issue per work card.

PR #412 then expanded `./aos dev gh` so Foreman can perform the common GitHub
ledger loop without falling back to raw `gh` for ordinary issue and PR
operations.

## What Is Settled On Current Main

As of the handoff that preceded this note:

- `main` was clean and exactly aligned with `origin/main` at `25064f72`.
- No PRs were open.
- `./aos ready --json` reported `ready=true`, `phase=ready`, repo daemon
  reachable, launchd-managed ownership, active input tap, and granted
  permissions.
- #409 and #410 settled the TCC/readiness broker work that was safe to land in
  that tranche.
- #412 settled the immediate Foreman-owned `./aos dev gh` control-surface gap:
  issue create, issue close, label list, and guarded PR merge are available.
- #411 exists as a parked readiness diagnosis/remediation spec. It is not
  started by this note.

The status-item target drift reported by `./aos status` is known and narrow:
the current Sigil status item target still points at an older
`gdi_toolkit_panel_live_drag_correction_v1` URL instead of the canonical
`aos://sigil/renderer/index.html?toolkit-root=toolkit`. Repairing that with
`./aos experience activate sigil` is useful only when live Sigil evidence is
the next proof. It is not needed for branch, stash, or agent-relay cleanup.

## What Is Not Settled

### Provenance/accounting lane

The only real unmerged local branch is
`gdi/aos-dock-run-provenance-ledger-v0`, with a matching remote branch. It is
not generic scratch. It contains an eight-commit provenance/accounting lane
touching dock hook harnesses, `scripts/aos-provenance-ledger.mjs`, workflow
scripts, command manifests, Agent Terminal modules, schemas, fixtures, and
tests.

This branch looks relevant to agent-relay observability, but it needs an
explicit promote, rebase, park, or retire decision. Do not delete it as branch
cleanup.

### Parser simplification

The #412 correction left a recommendation to simplify
`scripts/aos-dev-gh.mjs` parsing. That is a follow-up recommendation, not
active work. Do not start it unless the human asks or Foreman explicitly routes
it after the cleanup checkpoint.

### Readiness diagnosis/remediation split

Issue #411 records the open design question around separating readiness diagnosis
from remediation and whether plain `ready` should auto-act on the default path.
This is deliberately separate from #410 and #412. Do not fold it into cleanup.

### Live Sigil and live-drag correction

Recent stashes preserve code-bearing live-drag diagnostics. They should stay
parked until live Sigil evidence is the next meaningful proof. Do not promote
them opportunistically just because they are recent.

## Artifact Wake Classification

Use this classification before asking another agent to reason from leftover
files, branches, or stashes.

| Artifact | Classification | What future agents should do |
| --- | --- | --- |
| `docs/design/work-cards/` as a directory | Durable transfer-contract archive with many historical cards | Do not infer active work from file presence. Active work must be backed by current branch state, issue ledger state, or a fresh Foreman dispatch. |
| `docs/dev/reports/` | Durable reports and audits | Read only the report relevant to the current lane. Do not bulk-load these as active instructions. |
| `docs/design/agent-ui-affordance-synthesis-v0*.md` | Durable synthesis and review notes restored from the cleanup stash | Treat as design memory for agent-visible target architecture, not an automatic implementation dispatch. |
| #407 | Governance/control-surface ledger | Still useful, but after #412 its body and `lane:active` label may be stale. Update deliberately when issue hygiene is authorized. |
| #411 | Parked spec lane | Do not start during cleanup. Use only when the human asks for readiness diagnosis/remediation design. |
| `gdi/aos-dock-run-provenance-ledger-v0` | Real unmerged implementation lane | Preserve. Decide promote/rebase/park/retire explicitly. |
| 114 merged local branches | Cleanup candidates | Safe to delete locally after an explicit branch cleanup pass. Exclude the provenance branch. |
| Former `stash@{0}` from 2026-06-04 11:20 | Restored and dropped during cleanup | Durable markdown/config material was restored into repo-local docs; generated `tests/lib/__pycache__/` bytecode and a blank-line-only skill edit were discarded. |
| Former `stash@{1}` from 2026-06-03 12:54 | Dropped after explicit approval | Superseded dev-gh inventory/control-surface draft after #412. |
| Current `stash@{0}` from 2026-06-03 11:43 | Small code-bearing panel live-drag patch | Keep parked unless live-drag work resumes. |
| Current `stash@{1}` from 2026-06-03 11:42 | Larger code-bearing Sigil/toolkit/native live-drag diagnostics | Keep parked unless live Sigil/input evidence is the next proof. |
| Older stashes | Historical or side-lane state | Inspect newest-to-oldest before any drop. Do not drop blindly. |

## How To Read The Markdown Wake

Most work cards are not standing instructions. They are bounded transfer
contracts created for one GDI, Operator, correction, or validation round. Once
that round landed, was superseded, or became parked, the card remains useful as
provenance but not as a command to continue.

Use this hierarchy for rediscovery:

1. Current `git status`, current branch, and `origin/main` alignment.
2. Open PRs and governing GitHub issues.
3. The latest Foreman narrative or ledger note for the lane.
4. Accepted commits on `main`.
5. Stashes and local branches.
6. Historical work cards and reports.

If items 5 or 6 appear to contradict items 1 through 4, treat them as parked
or stale until Foreman reclassifies them.

## Current Safe Next Steps

The cleanup work should preserve a clean, understandable checkout before
starting new implementation. The safe sequence is:

1. Keep `main` clean and avoid live Sigil repair unless live evidence is the
   next proof.
2. Keep the restored cleanup-stash docs checkpoint unless later review finds a
   specific artifact that should be retired. The chosen storage locations are
   `docs/design/` for synthesis notes, `docs/design/work-cards/` for transfer
   contracts, and `docs/dev/reports/` for audits and investigation reports.
3. Keep current `stash@{0}` and `stash@{1}` parked for live-drag context.
4. Prepare and run a local merged-branch deletion pass, explicitly excluding
   `gdi/aos-dock-run-provenance-ledger-v0`.
5. Update #407 only when issue hygiene is authorized, likely moving it from
   active implementation to settled or parked governance state.
6. Decide whether the provenance branch is the next agent-relay-enabling lane.

## Non-Goals For Future Cleanup Agents

Do not start provenance promotion, #411, parser simplification, or live Sigil
repair merely because this note mentions them. This note is a memory layer, not
a dispatch.

Do not rebuild `./aos`, reset TCC, or route native Swift work unless the work
card provides a native-boundary justification and Foreman/human availability is
explicit.

Do not create linked worktrees for Foreman/GDI loops under the default
`local_relay` workflow.

Do not treat stale markdown, generated proof artifacts, or old branch names as
truth without comparing them to current `main`, the governing issue, and this
ledger.

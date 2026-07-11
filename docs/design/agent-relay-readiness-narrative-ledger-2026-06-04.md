# Agent Relay Readiness Narrative Ledger

> Historical evidence only. This dated ledger is not executable authority.
> Embedded Sigil routes and proofs are retired; use current AOS source and the
> external `Ch-osctrl/sigil` repository for active product work.

**Date:** 2026-06-04
**Kind:** Historical Foreman narrative checkpoint after the #407 / #412
settlement

This note preserves the story that is easy to lose if a future agent only reads
branch names, work cards, stashes, and PR titles. It is not a work card. It is
not a current-status source. Use live Git, GitHub, and `./aos` commands for
current branch, issue, PR, stash, and runtime facts; use this note only for why
the live-drag work started, why it turned into runtime and governance side
quests, and why some historical artifacts exist.

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

The repo was not random at the time of writing, but the artifact trail was noisy
because the architecture was discovered through debugging rather than planned in
one clean sequence. Future agents must query live state before drawing current
conclusions. Do not infer active work merely from this note or from a markdown
work card existing under `docs/design/work-cards/`.

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

PR #412 then expanded `node scripts/aos-dev-gh.mjs` so Foreman can perform the common GitHub
ledger loop without falling back to raw `gh` for ordinary issue and PR
operations.

## Historical Settlement Snapshot

At the handoff that preceded this note, live checks observed:

- `main` was clean and exactly aligned with `origin/main` at `25064f72`.
- No PRs were open.
- `./aos ready --json` reported `ready=true`, `phase=ready`, repo daemon
  reachable, launchd-managed ownership, active input tap, and granted
  permissions.
- #409 and #410 settled the TCC/readiness broker work that was safe to land in
  that tranche.
- #412 settled the immediate Foreman-owned `node scripts/aos-dev-gh.mjs` control-surface gap:
  issue create, issue close, label list, and guarded PR merge are available.
- #411 was created as a separate readiness diagnosis/remediation spec. Query
  GitHub for its current title, labels, and state.

The status-item target drift reported by `./aos status` at that time was narrow:
Sigil's status item target pointed at an older
`gdi_toolkit_panel_live_drag_correction_v1` URL. Query `./aos status --json`
before assuming that drift is still present.

## Follow-Up Threads Recorded At Write Time

### Provenance/accounting lane

The branch named `gdi/aos-dock-run-provenance-ledger-v0` was observed as a real
provenance/accounting lane, not generic scratch. Its live existence, ahead/behind
state, and relevance must be checked with Git before acting on it.

This branch looks relevant to agent-relay observability, but it needs an
explicit promote, rebase, park, or retire decision. Do not delete it as branch
cleanup.

### Parser simplification recommendation

The #412 correction left a recommendation to simplify
`scripts/aos-dev-gh.mjs` parsing. That is a follow-up recommendation, not
an issue identity and not an automatic dispatch. Query commits and active
issues before treating it as remaining work.

### Readiness diagnosis/remediation split

#411 was created for the design question around separating readiness diagnosis
from remediation and whether plain `ready` should auto-act on the default path.
Use `node scripts/aos-dev-gh.mjs issue view 411 --json` for its current title, labels, and
state.

### Live Sigil and live-drag correction

Recent stashes preserved code-bearing live-drag diagnostics at the time of this
note. Stash names and ordering are live Git facts; run `git stash list` and
inspect each candidate before promoting, retaining, or dropping it.

## Artifact Wake Classification

This table is historical classification only. Query live state before asking
another agent to reason from leftover files, branches, issues, or stashes.

| Artifact | Classification | What future agents should do |
| --- | --- | --- |
| `docs/design/work-cards/` as a directory | Durable transfer-contract archive with many historical cards | Do not infer active work from file presence. Active work must be backed by live branch/PR/issue state or a fresh Foreman dispatch. |
| `docs/dev/reports/` | Durable reports and audits | Read only the report relevant to the current lane. Do not bulk-load these as active instructions. |
| `docs/design/agent-ui-affordance-synthesis-v0*.md` | Durable synthesis and review notes restored from the cleanup stash | Treat as design memory for agent-visible target architecture, not an automatic implementation dispatch. |
| #407 | Governance/control-surface history | Query GitHub for state and labels. Do not infer current lane status from this note. |
| #411 | Readiness diagnosis/remediation spec reference | Query GitHub for state and labels. Do not infer active work from this note. |
| `gdi/aos-dock-run-provenance-ledger-v0` | Provenance/accounting branch reference | Query Git for existence and ahead/behind state before deciding promote/rebase/park/retire. |
| merged local branches | Cleanup candidates observed during the original cleanup | Recompute with `git branch --merged` before deleting anything. |
| Former `stash@{0}` from 2026-06-04 11:20 | Restored and dropped during cleanup | Durable markdown/config material was restored into repo-local docs; generated `tests/lib/__pycache__/` bytecode and a blank-line-only skill edit were discarded. |
| Former `stash@{1}` from 2026-06-03 12:54 | Dropped after explicit approval | Superseded dev-gh inventory/control-surface draft after #412. |
| stash entries observed as live-drag diagnostics | Code-bearing panel/Sigil/toolkit/native live-drag patches | Recompute with `git stash list`; keep parked unless live-drag work resumes. |
| other stash entries | Historical or side-lane state | Inspect newest-to-oldest before any drop. Do not drop blindly. |

True-up note from 2026-06-04: a later live `git stash list` showed six stash
entries. Two newest entries were labeled as live-drag diagnostics. Four older
entries, labeled `preserve-gdi-dock-config`, `wormhole transitions WIP
isolation`, `probe-revert-working-tree-canvas-swift`, and `codex: stash dirty
files 2026-04-19`, had no durable pointer in this note and require live triage
before use or cleanup.

## How To Read The Markdown Wake

Most work cards are not standing instructions. They are bounded transfer
contracts created for one GDI, Operator, correction, or validation round. Once
that round landed, was superseded, or became parked, the card remains useful as
provenance but not as a command to continue.

Use this hierarchy for rediscovery:

1. Live Git state: `git status`, current branch, `origin/main` alignment,
   local/remote branches, and stashes.
2. Live GitHub state: issue and PR list/view JSON through `node scripts/aos-dev-gh.mjs`.
3. Live AOS state: `./aos ready --json` and `./aos status --json`.
4. Accepted commits on `main`.
5. Historical notes, work cards, reports, and issue comments as rationale only.

If historical prose contradicts live state, live state wins. Update or ignore
the prose; do not derive current status from it.

## Safe Next-Step Pattern

Cleanup work should preserve a clean, understandable checkout before starting
new implementation. A safe pattern is:

1. Query live Git/GitHub/AOS state first.
2. Keep the restored cleanup-stash docs checkpoint unless later review finds a
   specific artifact that should be retired. The chosen storage locations are
   `docs/design/` for synthesis notes, `docs/design/work-cards/` for transfer
   contracts, and `docs/dev/reports/` for audits and investigation reports.
3. Inspect stashes before use or cleanup; do not rely on old `stash@{n}`
   numbering.
4. Recompute merged branches before any branch cleanup.
5. Query issue/PR JSON before updating or referencing lane status.
6. Decide whether any provenance/accounting branch that still exists is the next
   agent-relay-enabling lane.

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
truth without comparing them to live Git, GitHub, and AOS state.

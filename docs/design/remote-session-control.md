# Remote Session Control Idea Capture

**Date:** 2026-05-02
**Status:** Idea capture, future feature candidate. This is not an implementation
plan and should not add command surface by itself.

## Prompt

The working idea is: if AOS already has a local daemon, provider session
catalogs, tmux or pty-backed agent terminals, and canvas ownership metadata,
could it later support a small remote-control surface for Codex or Claude Code
sessions? A related scenario is remoting into a computer that has an AOS agent
running locally.

This is adjacent to current work, but it is one layer above it. Current work
answers "what sessions and surfaces exist, who created them, and what state are
they in?" Remote session control asks "can another trusted client observe or
act on a session through AOS?"

## External Reference Point

OpenAI's Codex remote connections currently describe SSH-backed remote projects:
the Codex app can run threads against a remote host's filesystem and shell after
enabling `remote_connections = true` in `~/.codex/config.toml`. The docs frame
this as remote project execution over SSH, with warnings to use SSH forwarding,
VPN, or mesh networking rather than exposing unauthenticated listeners.

That is relevant, but it is not the same product shape as controlling an
existing local AOS/Sigil agent terminal from another client.

Source: <https://developers.openai.com/codex/remote-connections>

## Relationship To Current AOS Work

The idea is not far off from the direction already in the repo:

- `shared/schemas/provider-session-catalog.*` gives AOS a provider-neutral way to
  discover Codex and Claude Code sessions.
- `shared/schemas/agent-session-telemetry.*` keeps session pressure and provider
  telemetry raw enough for consumers to render without hard-coded phases.
- Canvas `owner` metadata, added in PR #195, lets `show.list` and
  `canvas_lifecycle` identify the session, harness, PID, cwd, worktree, and
  runtime mode that produced a visible surface.
- The session communication layer already treats `session_id` as the canonical
  routing key and human names as display metadata.
- Gateway state locks already model ownership and TTL in a familiar,
  time-bounded way.
- `shared/schemas/run-control.schema.json` already names several control verbs,
  such as `pause`, `resume`, `take_over`, `release`, `abort`, and
  `open_timeline`.

Taken together, these suggest a future "session control record" can be a
natural extension of existing contracts rather than a new parallel system.

## Product Shape

The desirable product is not raw terminal remoting. Tmux or a pty can be the
substrate, but the public AOS contract should be agent-aware.

A remote or secondary client should eventually be able to:

- list active and recent sessions
- inspect provider, repo, branch, cwd, worktree, and last activity
- see which canvases or agent terminals belong to a session
- read a transcript tail or structured timeline
- send a prompt or high-level action
- interrupt or pause when the provider supports it
- approve or deny pending approvals through an explicit approval contract
- resume the session in the local Agent Terminal surface
- see whether the session is local, remote-over-SSH, or unreachable

The left panel can still be a provider CLI terminal. The right or secondary
surface becomes a session navigator and control inspector rather than a
provider-specific UI.

## Architectural Sketch

```text
trusted client
  -> authenticated AOS control endpoint
  -> session control registry
  -> provider adapter
      -> Codex app/server/CLI session
      -> Claude Code CLI session
      -> tmux or pty process handle
  -> existing AOS primitives
      -> see/do/show/tell/listen
      -> canvas lifecycle and owner metadata
      -> session telemetry
```

The daemon remains the local authority for the machine it runs on. It should not
become a general public server. A future remote client talks to the daemon only
through a constrained, authenticated, auditable surface.

## Proposed Future Record

A provider-neutral session control record could look like:

```json
{
  "session_id": "codex-abc123",
  "provider": "codex",
  "harness": "codex",
  "state": "active",
  "cwd": "/Users/Michael/Code/agent-os",
  "worktree_root": "/Users/Michael/Code/agent-os-worktrees/example",
  "branch": "codex/example",
  "last_activity_at": "2026-05-02T22:15:00Z",
  "terminal": {
    "kind": "tmux",
    "handle": "agent-os:codex-abc123",
    "attachable": true
  },
  "canvases": ["sigil-agent-terminal", "session-vitality-lab"],
  "telemetry": {
    "available": true,
    "source": "agent-session-telemetry"
  },
  "actions": {
    "read_transcript": true,
    "send_prompt": true,
    "interrupt": true,
    "approve": false,
    "resume_terminal": true
  },
  "owner": {
    "consumer_id": "codex-abc123",
    "harness": "codex",
    "cwd": "/Users/Michael/Code/agent-os",
    "worktree_root": "/Users/Michael/Code/agent-os-worktrees/example",
    "runtime_mode": "repo"
  }
}
```

This should start as read-only discovery. Mutating actions need their own
contract, authorization model, and tests.

## Security And Trust Boundary

Remote control of AOS is high-trust. AOS can perceive and act on the logged-in
Mac. A future remote surface must treat that as a privileged capability.

Conservative defaults:

- local-only listener by default
- no unauthenticated network listener
- SSH forwarding, VPN, or Tailscale-style private networking for remote access
- short-lived client tokens or leases
- per-action authorization, not one ambient "remote admin" bit
- audit events for send, approve, interrupt, take-over, and resume
- visible local indication when a remote client is attached
- explicit deny-by-default behavior for unknown provider states

This should follow the same spirit as capability leases: use bounded,
evidence-backed authority, and invalidate it when daemon identity, process
identity, provider state, or permissions drift.

## Why Tmux Is Useful But Not The Product

Tmux is useful because it gives durable process attachment and transcript
capture. It is not enough as the AOS product contract because raw keystrokes and
pane bytes do not answer agent-level questions:

- which provider session is this?
- which repo and worktree does it own?
- are there pending approvals?
- is the provider waiting for input or still running?
- which AOS canvases belong to this session?
- what safe actions are currently available?

AOS should wrap tmux or pty handles with typed provider/session metadata instead
of exposing tmux as the remote API.

## Placement In The Stack

The likely layering is:

- **Level 0, primitives:** session control registry, local auth/leases, event
  stream, provider adapter contracts, owner linkage to canvases.
- **Level 1, toolkit:** reusable session list, transcript tail, action buttons,
  approval card, vitality/telemetry panel.
- **Level 2, apps:** Sigil's Agent Terminal and any future mobile/web client.

Sigil should not invent a private remote-control model. If it needs session
control, the primitive should be reusable by future AOS apps.

## Minimal Sensible Next Slice

Do not start with a remote UI. The smallest forward-compatible slice would be:

1. Define a `session-control-record` schema that references provider catalog,
   telemetry, canvas owner metadata, and available actions.
2. Add a read-only daemon or CLI surface that returns current records for local
   sessions.
3. Link Agent Terminal canvases to their session record using existing owner
   metadata.
4. Add tests with fake Codex/Claude/tmux records so Sigil can render different
   session states without starting real providers.

Only after that should mutating remote actions be considered.

## Non-Goals For Now

- Build a mobile or web remote-control app.
- Expose AOS over the public internet.
- Replace Codex's official SSH remote connections.
- Replace provider CLIs with custom provider UIs.
- Add a scheduler or daemon time-sharing protocol.
- Treat process PID alone as durable identity.

## Open Questions

- Should the remote/control client authenticate as a user, a device, a session,
  or a short-lived lease?
- How should AOS represent "same human, different device" versus "different
  agent consumer"?
- Which provider actions are documented enough to expose as typed controls, and
  which must stay derived from terminal state?
- Should transcript capture be provider-native, tmux-derived, or both?
- How should local visibility work when a remote client is attached?
- What is the cleanup rule when the provider session dies but canvases remain?
- Are "snapshots" a future packaging/checkpoint concern, or just a saved session
  control record plus provider resume handle?

## Current Recommendation

Keep designing toward this, but do not implement remote control yet. The correct
near-term work remains the provider-neutral session catalog, telemetry, owner
metadata, and Agent Terminal surface. Those make future remote control possible
without prematurely committing AOS to a network server or provider-specific UI.

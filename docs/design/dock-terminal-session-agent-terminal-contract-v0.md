# Dock Terminal Session Agent Terminal Contract V0

## Problem

The dock workflow should support one long-lived terminal substrate per dock
instead of treating each AFK attempt, human TUI use, and Agent Terminal view as
separate terminal systems. Today the proof surfaces around Sigil Agent Terminal
and the AFK prototypes can demonstrate PTY input, warm TUI reuse, and
metadata-backed acceptance, but they do not yet name the shared AOS-owned
contract that future implementation should converge on.

V0 product direction:

- AOS owns dock terminal sessions.
- Agent Terminal renders and observes those sessions as the headful surface.
- Human input and AFK input use the same dock-owned PTY input path.
- Provider acceptance remains structured evidence from provider/session facts,
  not visual scraping.

This contract is reversible design only. It does not launch providers, drive
real terminals, read provider transcript bodies, mutate provider stores, start
async routing, or define final product UI.

## Components

### Dock Terminal Session

The dock terminal session is an AOS-owned resource keyed by dock identity, such
as `foreman`, `gdi`, or `operator`. It owns:

- dock cwd, normally `.docks/<dock>`;
- provider command and argv, such as `codex --no-alt-screen`;
- PTY handle and terminal geometry;
- lifecycle state, including start, attach, detach, suspend, resume, and retire;
- lease owner and disposition;
- session identity stable enough for AFK, humans, Agent Terminal, and receipts
  to reference the same substrate.

The dock terminal session owns the process and PTY substrate. It does not own
provider conversation semantics beyond delivering input and recording structured
observations.

### Provider Conversation Boundary

Provider-specific reset commands define conversation boundaries inside a reused
provider process. For Codex dock sessions, `/clear` starts a fresh provider
conversation context while the dock terminal session and provider process remain
warm. `/goal clear` is separate stale-goal recovery for GDI goal-mode state; it
is not the normal conversation reset command.

Conversation freshness is proven by provider metadata and correlated session
records, not by killing and relaunching the process.

### Dock Inbound Message Contract

`.docks/<dock>/inbound-contract.json` remains the provider entry-shape source.
Senders and AFK tooling consume it to format provider input without hardcoding
role syntax:

- GDI/Codex interactive work entry uses provider prefix `/goal ` followed by
  the plain Foreman payload.
- Operator/Codex receives the plain supervised payload with no `/goal` prefix.
- Foreman/Codex receives plain successor handoff or coordination payloads.

The copied transfer payload stays plain. The interactive provider entry shape is
applied at the PTY input boundary.

### PTY Input Path

Human input and AFK input share the same dock-owned PTY path. AFK must submit
the same bytes a human would type after the relevant reset and prompt-shaping
steps. It must not create a parallel Terminal.app automation layer, VSCode
terminal path, provider-specific store mutation path, or screen-control path.

For warm Codex reuse, the intended input sequence is:

1. submit the provider conversation reset command, such as `/clear`;
2. submit the role-shaped provider entry built from the dock inbound contract;
3. record byte-level input receipt facts, terminal identity, and structured
   provider acceptance evidence.

### Agent Terminal

Agent Terminal is the headful renderer and observer for dock terminal sessions.
It should render the same PTY substrate and can expose a session rail, health,
geometry, attach state, lease state, and sanitized provider telemetry.

Agent Terminal is not a competing automation layer and is not the acceptance
oracle. It must not infer provider acceptance from terminal pixels, visible
text, or transcript bodies. Its visible output helps humans inspect the session;
machine acceptance comes from structured facts.

## Receipt Shape

The next implementation should make dock terminal sessions addressable through a
small structured receipt. Field names may follow nearby schema conventions, but
the facts below are the V0 contract.

```json
{
  "record_type": "aos.dock_terminal_session",
  "dock": "gdi",
  "session_id": "dock-terminal:gdi:<stable-id>",
  "cwd": "/Users/Michael/Code/agent-os/.docks/gdi",
  "provider": "codex",
  "provider_command": ["codex", "--no-alt-screen"],
  "pty": {
    "handle": "opaque",
    "driver": "aos_pty",
    "cols": 100,
    "rows": 31
  },
  "lifecycle": {
    "state": "running",
    "started_at": "2026-05-23T00:00:00Z",
    "last_attached_at": "2026-05-23T00:00:00Z"
  },
  "lease": {
    "holder": "afk",
    "purpose": "dispatch",
    "disposition": "returned_to_idle"
  }
}
```

AFK launch/session receipts should reference the dock terminal session instead
of claiming ownership of a fresh provider process in warm mode:

```json
{
  "launch_intent": {
    "launch_mode": "warm_dock_tui_reuse",
    "provider_process_reused": true,
    "provider_process_launch_performed": false,
    "context_reset_command": "/clear",
    "context_reset_expected_provider_boundary": true
  },
  "terminal_substrate": {
    "owner": "aos.dock_terminal_session",
    "dock_terminal_session_id": "dock-terminal:gdi:<stable-id>",
    "status": "warm_tui_reused",
    "cwd": "/Users/Michael/Code/agent-os/.docks/gdi",
    "input_submission": {
      "context_reset_submitted": true,
      "context_reset_command": "/clear",
      "provider_prompt_contract_path": ".docks/gdi/inbound-contract.json",
      "provider_prompt_mode": "codex_goal",
      "provider_prompt_prefix": "/goal ",
      "first_dispatch_character": "/"
    }
  },
  "provider_acceptance": {
    "status": "provider_session_observed",
    "observation_source": "codex_adapter_metadata",
    "provider_session_id": "<new session id>",
    "provider_reported_cwd": "/Users/Michael/Code/agent-os/.docks/gdi",
    "evidence_refs": [
      "provider_catalog:codex:<session-id>",
      "provider_metadata:cwd-time-correlation"
    ]
  },
  "warm_tui_reuse": {
    "status": "context_boundary_observed",
    "previous_provider_session_id": "<old session id>",
    "new_provider_session_id": "<new session id>",
    "provider_session_changed": true,
    "cleanup_disposition": "returned_to_idle"
  }
}
```

Agent Terminal observability can use a companion receipt or view model:

```json
{
  "record_type": "aos.agent_terminal_observation",
  "dock_terminal_session_id": "dock-terminal:gdi:<stable-id>",
  "rendered_by": "agent_terminal",
  "attach_state": "attached",
  "geometry": { "cols": 100, "rows": 31 },
  "rail": {
    "provider_sessions_visible": true,
    "selected_provider_session_id": "<session id>"
  },
  "acceptance_role": "human_observability_only"
}
```

## Acceptance Evidence

Provider acceptance evidence is structured and bounded to metadata facts:

- provider catalog or session record exists for the expected provider;
- provider-reported cwd matches the dock cwd or intended worktree;
- provider-reported branch/head/time are correlated with the AFK dispatch
  window when available;
- provider session id changes after `/clear` when warm reuse expects a fresh
  conversation boundary;
- terminal lease cleanup records a disposition such as `returned_to_idle`,
  `left_leased_for_operator`, or `retire_required`.

Non-evidence:

- terminal pixels;
- visible terminal text alone;
- transcript body reads;
- provider-owned store mutation;
- browser or screen automation outside the dock PTY.

## Warm TUI Reuse Mapping

Warm reuse maps to lifecycle, not launch:

- the dock terminal session remains running;
- the provider process is reused;
- `/clear` creates the provider conversation boundary;
- the role-specific dispatch is formatted from the target dock inbound contract;
- AFK submits through the dock PTY input path;
- cleanup returns the warm terminal lease to a named disposition rather than
  requiring child-process exit.

If metadata after reset still resolves to the previous provider session id, the
receipt must report a context-boundary mismatch instead of silently accepting
the launch.

## Migration Notes

The current Sigil Agent Terminal bridge is useful proof material: it can create
or attach to a terminal-backed provider process, send `/input` and `/key`, resize
the PTY, and render through xterm.js. The migration path should move ownership
down from the Sigil bridge proof into an AOS dock terminal session primitive:

1. keep the existing cold `codex --no-alt-screen` bridge proof as a regression
   harness;
2. introduce an AOS-owned dock terminal session registry and receipt shape;
3. make Agent Terminal attach to that registry instead of owning session
   lifecycle privately;
4. make AFK warm reuse target the registry's PTY input endpoint and dock
   inbound contract formatter;
5. keep provider acceptance sourced from host/provider metadata adapters and
   cleanup/lease receipts.

## Smallest Next Implementation Slice

Implement a deterministic dock terminal session registry slice without live
provider driving:

- add a schema or documented fixture for `aos.dock_terminal_session`;
- add a local in-process registry/helper that can create a fixture-backed dock
  terminal session receipt for `foreman`, `gdi`, and `operator`;
- expose a narrow bridge/read API that Agent Terminal can consume for session
  identity, cwd, command, PTY geometry, lifecycle, and lease disposition;
- update AFK warm reuse receipt construction to reference
  `dock_terminal_session_id` and `owner: "aos.dock_terminal_session"`;
- preserve existing warm/cold behavior and provider metadata acceptance logic.

Expected tests for that slice:

- fixture-backed dock terminal session receipt validation for all three docks;
- Agent Terminal server/API test proving it reads dock terminal session identity
  and does not claim provider acceptance from visual state;
- AFK launch/session trigger tests proving warm reuse references the dock
  terminal session id, consumes `.docks/<dock>/inbound-contract.json`, preserves
  GDI `/goal ` versus Operator plain input, and keeps `/clear` separate from
  `/goal clear`;
- regression tests for cold bridge launch, PTY input, resize, and
  metadata-backed provider acceptance;
- `git diff --check`.

## Explicit Non-Actions In This Design Slice

This design did not perform a live provider launch, drive a real dock terminal,
read provider transcript bodies, mutate provider stores or catalogs, mutate
gateway/broker/runtime routes, mutate GitHub, implement async routing, remove
`--i-am-present`, or create unsupervised trigger behavior.

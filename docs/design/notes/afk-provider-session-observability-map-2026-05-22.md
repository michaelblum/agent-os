# AFK Provider Session Observability Map

**Date:** 2026-05-22
**Status:** docs-only observability map

## Summary

The supervised AFK provider-session smoke proved that a human can launch a
docked Codex/GDI session from `.docks/gdi`, read the provider session id from
provider-visible terminal text, and confirm branch/head/status. It did not prove
that AOS dispatch can observe the same session through the provider catalog,
agent telemetry, terminal substrate, or result-route machinery.

This note maps what current repo surfaces can observe today, what direct
dock-root provider launch cannot expose, and the smallest reversible slice
before automated provider launch. It does not launch a provider, mutate provider
state, add schemas, implement dispatch, or change runtime behavior.

## Current Observability Table

| Fact | Current surface | Direct `.docks/gdi` Codex CLI launch | Sigil agent-terminal / codex-terminal launcher | Gap for AFK dispatch receipts |
| --- | --- | --- | --- | --- |
| Provider identity | Human terminal/status text; dry-run provider option; provider catalog records after discovery | Human-visible only unless a receipt records the selected provider | `AGENT_COMMAND`, launcher flags, bridge `/health` defaults, catalog `/sessions` filter | Dispatch needs to record selected provider at launch time, not infer it later from transcript discovery. |
| Provider session id | Codex terminal/shutdown text; Codex rollout filename or `session_meta.payload.id` once catalog sees the transcript | Human-visible during/after the session; not automatically bridged into a receipt | Catalog `/sessions` can expose `session_id` after provider transcript exists; `/session-inspector` can inspect by id | Launch-side receipt needs either a catalog match after launch or an explicit provider/session bridge. |
| cwd | Dock launch cwd; dry-run `launch_root`; catalog `cwd`; bridge `defaultCwd` and ensured session cwd | Available to the human and shell because Codex starts in `.docks/gdi`; catalog may later report `.docks/gdi` if transcript metadata is discovered | Launcher has `CWD_TARGET`, `/health.defaultCwd`, `/ensure.cwd`, terminal command/cwd tracking, and catalog cwd filtering | Dispatch can know intended cwd before launch, but needs post-launch confirmation or mismatch handling. |
| Branch | Provider status text; `git branch --show-current`; catalog `branch` from Codex `session_meta.payload.git.branch` when present | Human-visible/status-command-visible; not automatically captured | Catalog can expose branch after transcript metadata exists; terminal bridge can run or display shell state but does not convert it to receipt proof | Receipt should distinguish intended branch, provider-reported branch, and catalog-observed branch. |
| Launch root | Dry-run output; dock profile; launcher `CWD_TARGET` | Known from the manual operator invoking Codex in `.docks/gdi` | Known by launch wrapper and bridge environment | Direct launch has no AOS-owned launch-attempt record unless the operator writes one. |
| Terminal substrate | Human terminal app only | Not observable by repo surfaces beyond human report | Bridge reports `driver` as `tmux` or `process`, session name, capture endpoint, and attach command behavior | Automated dispatch needs a terminal/session substrate record if it will supervise or resume the process. |
| Process/tmux handle | Human terminal only | Not observed | Bridge `SESSION` / tmux session or process session map; `/ensure` returns driver and session | Direct provider launch cannot produce a durable process handle for dispatch. |
| Catalog record | `packages/host/src/session-catalog.ts`; `shared/schemas/provider-session-catalog.schema.json`; Sigil bridge `/sessions` | Only after Codex writes a discoverable rollout JSONL with `session_meta`; not observed by the smoke | Bridge exposes read-only catalog records filtered by cwd/provider | Catalog is useful post-launch discovery, but not sufficient as the only dispatch receipt source. |
| Telemetry event | `packages/host/src/session-telemetry.ts`; `shared/schemas/agent-session-telemetry.schema.json`; session inspector | Not observed unless a transcript/statusline is parsed | `/session-inspector` reads catalog `source_file` and extracts telemetry/lifecycle/diagnostics from transcript tail | Telemetry is not available at launch without transcript/statusline parsing; receipts must say `not_observed` until parsed. |
| Provider mismatch/diagnostics | Telemetry mismatch records and session inspector diagnostics | Not observed unless transcript parsing runs | `/session-inspector` can report missing/unreadable source, unsupported provider, or telemetry shape drift | Dispatch should record mismatch facts separately from work proof. |

## Direct Dock Launch Versus Launcher

A normal `.docks/gdi` Codex CLI session launched manually from the dock root has
these facts available to the human and provider terminal:

- provider identity: Codex CLI invocation and status text;
- provider session id: provider terminal/shutdown text;
- cwd and launch root: the terminal was started in `.docks/gdi`;
- branch/head/status: provider statusline or commands run by the worker;
- provider version/model/permission mode: provider status text when visible.

Those facts are not automatically AOS-owned. A direct launch does not create a
dispatch-attempt record, terminal substrate record, tmux/process handle, catalog
reference, telemetry event reference, route update, or transcript capture link.
The manual receipt can honestly cite them only as human-observed terminal facts
unless an adjacent command or artifact captures them.

The Sigil agent-terminal/codex-terminal launcher adds an observable terminal
substrate before provider launch:

- `apps/sigil/agent-terminal/launch.sh` delegates to
  `apps/sigil/codex-terminal/launch.sh`;
- the launcher sets `CWD_TARGET`, `AGENT_COMMAND`, `SESSION`, bridge port, and
  content roots;
- `server.mjs` ensures a tmux-backed session when tmux is available, otherwise
  a process-backed pseudo-terminal;
- `/health` exposes default session, default cwd, selected driver, and runtime
  availability facts;
- `/ensure` returns the terminal session and driver used for the command;
- `/snapshot` captures terminal output;
- `/sessions` exposes read-only provider catalog records;
- `/session-inspector` derives telemetry from a selected catalog record's
  provider transcript source file.

That launcher is a product surface and useful substrate example, not the future
AFK primitive owner. It does show the minimum terminal facts dispatch will need
to report if automated launch is expected to supervise a provider process.

## What The Manual Smoke Proved

The manual smoke receipt at
`docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-gdi-completed.md`
proved:

- `./aos dev afk-dry-run` can validate a packet for provider `codex`, dock
  `gdi`, and launch root `.docks/gdi` without launching a provider;
- a supervised human/operator can launch one Codex GDI session from
  `.docks/gdi`;
- the provider terminal can expose Codex CLI version, model, permission mode,
  session id, branch, head, and clean status;
- no source edits, generated receipt artifacts, provider config changes,
  gateway state changes, GitHub mutation, push, or PR were required.

It did not prove automated provider launch, scheduler ownership, catalog
discovery, telemetry capture, transcript capture, terminal substrate ownership,
or result-route delivery.

## What Remains `not_observed`

For the smoke receipt, these values correctly remained `not_observed`:

- catalog record reference for the launched provider session;
- telemetry event reference for the launched provider session;
- durable terminal transcript or snapshot artifact;
- AOS-owned process/tmux handle;
- dispatch-attempt record tying selected provider, launch root, command, and
  provider session id together;
- route update or broker/integration job result;
- heartbeat or lifecycle observation after provider launch.

Those gaps are not receipt mistakes. They reflect that the current dry-run
prototype intentionally performs no provider launch and that the manual provider
launch happened outside an AOS-owned terminal/session bridge.

## Catalog And Telemetry Sufficiency

The provider session catalog is sufficient for read-only discovery and resume
candidate lookup. It normalizes provider-owned session files into
`provider`, `session_id`, `cwd`, optional `branch`, timestamps, `source_file`,
and `resume_command`, and tests cover Codex, Claude Code, cwd filtering,
recency sorting, and soft per-record failure on provider drift.

The catalog is not sufficient as the only dispatch receipt mechanism. A newly
launched provider session may not be immediately discoverable, may not yet have
written the needed metadata, may lack a branch field, or may be ambiguous when
multiple recent sessions share cwd/provider. Dispatch needs a launch-side
attempt record or bridge observation that records intended provider, command,
cwd, launch root, terminal substrate, process/tmux handle, and any later catalog
match.

Telemetry is available only when an adapter can parse a provider surface:

- Codex telemetry currently comes from provider-local transcript
  `event_msg.token_count` records;
- Claude Code can use documented statusline JSON for active sessions and
  provider-local transcript fallback for inactive/history views;
- the Sigil session inspector reads a catalog record's `source_file` tail and
  emits telemetry, lifecycle events, or mismatch diagnostics.

Without provider transcript/statusline parsing, receipts should honestly record
`telemetry_event_refs: not_observed`. They may record provider identity,
session id, cwd, branch, launch root, and terminal substrate as launch or human
terminal facts, but they should not imply context telemetry exists.

## Recommended Next Slice

Owner: GDI implementation, with Foreman routing/review.

Implement a local, reversible, no-provider-launch validation slice that extends
the AFK dry-run receipt shape with launch-observability fields, without starting
Codex, Claude, Gemini, or any provider:

- add dry-run output fields for intended launch command, launch root, selected
  provider, selected dock, intended cwd, expected terminal substrate value
  `not_applicable: dry-run/no-provider-launch`, catalog reference
  `not_observed`, telemetry reference `not_observed`, and explicit
  `launch_performed: false`;
- add or update focused dry-run tests proving those fields are present and
  honest when no provider is launched;
- keep provider-session catalog and telemetry implementations unchanged;
- verify with the focused dry-run test and `./aos dev recommend --json`.

This slice makes future receipts harder to overclaim while still avoiding the
risk of automated provider launch. After that, the next supervised validation
can use the Sigil terminal bridge or a minimal dispatch-owned terminal bridge to
capture terminal substrate and then attempt catalog matching after launch.

## Explicit Deferrals

- No automated provider launch.
- No scheduler, dispatch, gateway, route, broker, or session-control
  implementation.
- No provider config mutation.
- No provider transcript mutation or generated receipt artifact.
- No new catalog, telemetry, work-record, evidence-record, or transfer-packet
  schema.
- No decision to make Sigil the owner of AFK provider lifecycle.
- No claim that telemetry is available before transcript/statusline parsing.

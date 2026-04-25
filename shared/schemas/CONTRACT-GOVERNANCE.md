# Schema & IPC Contract Governance

This document captures the rule the input-tap readiness contract (issue #109)
established for daemon ↔ CLI capability surfaces. Future schema/IPC changes
should follow it.

## Rule

1. **Daemon-owned capabilities must be daemon-sourced.** Capabilities that
   live inside the daemon process (CGEventTap state, AX permissions evaluated
   by the daemon, channel state, etc.) must be reported by the daemon. The
   CLI must not fabricate these from its own preflight calls — it can only
   forward what the daemon says.

2. **CLI fallbacks must label their source.** When the daemon is unreachable
   and the CLI falls back to its own probe, the consumer-facing payload must
   make the source explicit (e.g. `ready_source: "cli"` vs `"daemon"`). No
   silent merging of daemon-evaluated and CLI-evaluated views.

   When the daemon IS reachable but its view and the CLI's view disagree on
   a comparable field (e.g. CLI sees `accessibility=true` but the daemon
   says `false` because TCC was granted to the CLI binary but not the
   daemon binary), expose **both** views and a `disagreement` marker
   listing the diverging fields. Don't pick one silently. The
   `aos permissions check` response (`daemon_view`/`cli_view`/`disagreement`)
   is the canonical pattern.

3. **Lifecycle commands that claim readiness must fail on degraded
   daemon-owned capability state.** `aos service install/start/restart` and
   any future "make it ready" lifecycle verb cannot exit 0 when a
   daemon-owned readiness check is reporting degraded.

4. **Compatibility fields may be preserved, but new structured fields are
   the forward contract.** Flat legacy fields (e.g. top-level
   `input_tap_status`) can stay byte-for-byte for compatibility, but new
   consumers should bind to the structured nested block (e.g. `input_tap.*`).
   Don't expand the legacy flat surface.

5. **Tests must cover both happy path and degraded daemon-reported state.**
   A single happy-path assertion is insufficient. Use the mock-daemon
   fixture (`tests/lib/mock-daemon.py`) to drive degraded states without a
   real launchd lifecycle.

## Where this rule was established

- Spec: `docs/superpowers/specs/2026-04-24-input-tap-readiness-contract-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-input-tap-readiness-contract.md`
- Tracking: GitHub issue #109

## Out of scope (intentionally)

- **CODEOWNERS for `shared/schemas/`** — revisit if a schema change lands
  without review from someone familiar with the contract (signal: a breaking
  field rename or removal slips through).
- **Snapshot-pinned compatibility tests** — revisit if a regression escapes
  the integration tests because the JSON shape changed silently.
- **Schema versioning automation** — revisit if the canonical schema files
  drift out of sync with their consumers (signal: a Swift struct gains a
  field that `daemon-ipc.md` doesn't mention).

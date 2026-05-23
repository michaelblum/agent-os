# AOS Dock Terminal Session v0

`aos.dock_terminal_session` is the deterministic receipt contract for a
dock-owned PTY substrate. It lets AFK warm dock TUI reuse and Agent Terminal
refer to the same AOS-owned terminal session without launching or driving a live
provider.

The v0 receipt is fixture-backed. It is not durable daemon storage and it is not
provider acceptance evidence.

Required receipt fields:

- `record_type: "aos.dock_terminal_session"`
- `dock`: `foreman`, `gdi`, or `operator`
- `dock_terminal_session_id`: stable session identity
- `cwd`: absolute `.docks/<dock>` launch root
- `provider` and `provider_command`
- `pty.driver`, `pty.handle`, `pty.cols`, and `pty.rows`
- `lifecycle.state` plus fixture timestamps when supplied
- `lease.holder`, `lease.purpose`, and `lease.disposition`

Agent Terminal may expose a companion `aos.agent_terminal_observation` view
model with dock terminal identity, cwd, command, geometry, lifecycle, and lease
disposition. That observation is explicitly `human_observability_only`; provider
acceptance remains sourced from provider metadata, catalog, or session facts.

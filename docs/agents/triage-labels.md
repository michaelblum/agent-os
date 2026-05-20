# Triage Labels

Matt Pocock's skills speak in terms of five canonical triage roles. In
agent-os, those roles are mapping targets for the repository's existing label
vocabulary, not permission for agents to invent new label names.

| Canonical role | Mapping target | Meaning |
| --- | --- | --- |
| `needs-triage` | Inspect existing labels before use | Maintainer needs to evaluate the issue |
| `needs-info` | Inspect existing labels before use | Waiting on the reporter for more information |
| `ready-for-agent` | Inspect existing labels before use | Fully specified and ready for an AFK agent |
| `ready-for-human` | Inspect existing labels before use | Needs human implementation |
| `wontfix` | Inspect existing labels before use | Will not be actioned |

## Application Rule

Before applying or creating any triage label, inspect the repository's existing
labels through the approved GitHub path for the active role. If the exact
configured label set is not discoverable, report the canonical role you intended
to express and ask a maintainer or the user to confirm the label name.

Do not create duplicate labels, normalize spelling by guesswork, or add new
label vocabulary without explicit user or maintainer confirmation.

@../../AGENTS.md

# Gateway

Provider-specific compatibility pointer. Keep durable gateway guidance in
provider-neutral docs.

The gateway package is an external adapter surface for AOS:

- MCP access to bounded AOS automation scripts.
- The integration broker for provider adapters such as Slack.
- Local provider/job state under `~/.config/aos/{repo|installed}/gateway/`.

The gateway is not an authoritative cross-agent coordination system. Agent,
session, channel, and human communication belongs to daemon-native `aos tell`,
`aos listen`, and the daemon session service behind `aos tell --register` and
`aos tell --who`.

#!/usr/bin/env bash
# Retired: Codex native custom-agent registration is not an AOS execution path.
#
# This command used to copy ai-agents/providers/codex/*.toml into
# ~/.codex/agents/ and write [agents.*] blocks into ~/.codex/config.toml. That
# re-enables Codex native multi-agent/custom-agent registration, including the
# encrypted tool path that AOS no longer trusts for project-agent execution.
#
# Preserved role material remains in ai-agents/providers/codex/*.toml. Execute
# project agents through ./aos dev agents, whose default provider-sdk lane can
# be pointed at an OpenAI-compatible proxy with:
#
#   AOS_AGENT_PROVIDER_BASE_URL=<proxy-url>
#   AOS_AGENT_PROVIDER_API_KEY=<proxy-key>
#   AOS_AGENT_PROVIDER_API=chat_completions

set -euo pipefail

cat >&2 <<'EOF'
agent-sync is retired.

Do not recreate ~/.codex/agents, [agents.*] blocks, multi_agent_v2, or Codex
native custom-agent registration for agent-os.

Use ./aos dev agents instead. Role material is preserved under
ai-agents/providers/codex/*.toml and consumed by the AOS-owned provider runner.
EOF

exit 1

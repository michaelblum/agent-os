#!/usr/bin/env bash
# Retired: Codex native custom-agent registration is not an AOS execution path.
#
# This command used to copy .docks/ai-agents/providers/codex/*.toml into
# ~/.codex/agents/ and write [agents.*] blocks into ~/.codex/config.toml. That
# re-enables Codex native multi-agent/custom-agent registration, including the
# encrypted tool path that AOS no longer trusts for project-agent execution.
#
# Project-agent role registration is retired from the active AOS core surface.
# Historical role material has been archived outside the active repo tree.

set -euo pipefail

cat >&2 <<'EOF'
agent-sync is retired.

Do not recreate ~/.codex/agents, [agents.*] blocks, multi_agent_v2, or Codex
native custom-agent registration for agent-os.

Do not recreate project-agent role registration in AOS core. Historical role
material has been archived outside the active repo tree.
EOF

exit 1
